#!/usr/bin/env node
/**
 * test-all.js — 4개 테스트 이미지 통합 테스트 러너
 *
 * 사용법:
 *   node test-all.js [--verbose]
 *
 * 기능:
 *   1. test-config.js의 4개 이미지를 순차 실행 (Pass A → Pass 0 → Crop → Pass B)
 *   2. user_answer / correct_answer 검증 (flexible 허용값 포함)
 *   3. 안전성 체크: passage, choices, 문제 수 검증
 *   4. 리그레션 체크: 이전 test-results.json과 비교
 *   5. test-results.json에 머신 리더블 결과 저장
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

import { VERTEX_PROJECT_ID, VERTEX_LOCATION } from './shared/config.js';
import { preprocessImage } from './shared/imagePreprocessor.js';
import { cropRegions } from './shared/imageCropper.js';
import { executePassA, executePass0, executePassB, executePassBFullImage } from './shared/passes.js';
import { TEST_CASES, checkUserAnswer } from './test-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_PATH = path.join(__dirname, 'test-results.json');
const VERBOSE = process.argv.includes('--verbose');
const ROUNDS_ARG = process.argv.findIndex(a => a === '--rounds');
const NUM_ROUNDS = ROUNDS_ARG >= 0 ? parseInt(process.argv[ROUNDS_ARG + 1]) || 3 : 1;

// ─── 환경 변수 로드 ─────────────────────────────────────
function loadEnvYaml() {
  const envPath = path.join(__dirname, '.env.yaml');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*'(.+)'$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

// ─── 유틸 ────────────────────────────────────────────────
function sep(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function printTable(headers, rows) {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] ?? '-').length))
  );
  const divider = colWidths.map(w => '─'.repeat(w + 2)).join('┼');
  console.log('┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐');
  console.log('│ ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' │ ') + ' │');
  console.log('├' + divider + '┤');
  for (const row of rows) {
    console.log('│ ' + row.map((c, i) => String(c ?? '-').padEnd(colWidths[i])).join(' │ ') + ' │');
  }
  console.log('└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');
}

// ─── 단일 이미지 파이프라인 ──────────────────────────────
async function runSingleImage(ai, testCase) {
  const { id, imagePath } = testCase;
  const expectedUser = testCase.expectedUser.split(',').map(s => s.trim());
  const expectedCorrect = testCase.expectedCorrect.split(',').map(s => s.trim());

  if (!fs.existsSync(imagePath)) {
    console.error(`  [오류] 파일 없음: ${imagePath}`);
    return { id, error: 'FILE_NOT_FOUND', problems: [] };
  }

  // 이미지 로드 & 전처리
  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const originalMimeType = mimeMap[ext] || 'image/jpeg';
  const imageBase64 = imageBuffer.toString('base64');

  const { imageBase64: resizedBase64, mimeType: resizedMimeType } = await preprocessImage(imageBase64, originalMimeType);
  const sessionId = `test-${id}-${Date.now()}`;

  // Pass A: 구조 추출
  console.log(`  [Pass A] 구조 추출...`);
  const passAResult = await executePassA({
    ai, sessionId,
    imageBase64: resizedBase64,
    mimeType: resizedMimeType,
    pageNum: 1, totalPages: 1,
    taxonomyData: [],
  });
  const pageItems = passAResult.parsed?.items || passAResult.parsed?.problems || [];
  console.log(`    추출 문제 수: ${pageItems.length} (기대: ${expectedUser.length})`);

  // Pass 0: 바운딩 박스
  console.log(`  [Pass 0] 바운딩 박스...`);
  const pass0Result = await executePass0({
    ai, sessionId,
    imageBase64: resizedBase64,
    mimeType: resizedMimeType,
  });
  console.log(`    감지 bbox: ${pass0Result.bboxes.length}개`);

  // 크롭
  let answerAreaCrops = [];
  let fullCrops = [];
  if (pass0Result.bboxes.length > 0) {
    const cropResult = await cropRegions(resizedBase64, resizedMimeType, pass0Result.bboxes);
    answerAreaCrops = cropResult.answerAreaCrops;
    fullCrops = cropResult.fullCrops;
    console.log(`    크롭: 답안영역 ${answerAreaCrops.length}개, 전체영역 ${fullCrops.length}개`);
  }

  // Pass B: 필기 인식 (프로덕션 index.js processPage와 동일한 로직)
  console.log(`  [Pass B] 필기 인식...`);
  let passBResult;

  if (answerAreaCrops.length > 0) {
    // 1차: 크롭 기반 분석
    passBResult = await executePassB({ ai, sessionId, answerAreaCrops, fullCrops });
    console.log(`    크롭 기반 marks: ${passBResult.marks.length}개 (기대: ${pageItems.length}개)`);

    // marks 부족 시 전체 이미지 fallback 보충 (프로덕션 index.js processPage와 동일)
    if (passBResult.marks.length < pageItems.length) {
      console.log(`    marks 부족 (${passBResult.marks.length}/${pageItems.length}) → 전체 이미지 fallback`);
      const fallbackResult = await executePassBFullImage({
        ai, sessionId,
        imageBase64: resizedBase64,
        mimeType: resizedMimeType,
        totalPages: 1,
      });
      console.log(`    fallback marks: ${fallbackResult.marks.length}개`);

      for (const fbMark of fallbackResult.marks) {
        const existing = passBResult.marks.find(m => String(m.problem_number) === String(fbMark.problem_number));
        if (!existing) {
          passBResult.marks.push(fbMark);
        } else {
          if (!existing.user_answer && fbMark.user_answer) existing.user_answer = fbMark.user_answer;
          if (!existing.correct_answer && fbMark.correct_answer) existing.correct_answer = fbMark.correct_answer;
        }
      }
    }
  } else {
    // bbox 없음 → 전체 이미지 fallback
    console.log(`    bbox 없음 → 전체 이미지 fallback`);
    passBResult = await executePassBFullImage({
      ai, sessionId,
      imageBase64: resizedBase64,
      mimeType: resizedMimeType,
      totalPages: 1,
    });
  }
  console.log(`    최종 marks: ${passBResult.marks.length}개`);

  // marks → pageItems에 머지 (범위 검증 포함)
  for (const mark of passBResult.marks) {
    // 객관식 범위 검증 (프로덕션 mergeHandwritingMarks와 동일)
    if (mark.user_answer) {
      const ansNum = parseInt(mark.user_answer, 10);
      if (!isNaN(ansNum) && String(ansNum) === String(mark.user_answer).trim() && (ansNum < 1 || ansNum > 5)) {
        mark.user_answer = null;
      }
    }
    const matched = pageItems.find(item => String(item.problem_number) === String(mark.problem_number));
    if (matched) {
      matched.user_answer = mark.user_answer;
      matched.correct_answer = mark.correct_answer;
    }
  }

  // ─── 안전성 체크 ───
  const safetyChecks = {
    problemCountMatch: pageItems.length === expectedUser.length,
    passagePresent: pageItems.every(item => item.passage || item.shared_passage_ref || item.visual_context),
    choicesPresent: pageItems.every(item => Array.isArray(item.choices) && item.choices.length > 0),
    bboxValid: pass0Result.bboxes.every(b => {
      const fb = b.full_bbox;
      return fb && fb.x1 >= 0 && fb.x1 <= 1000 && fb.y1 >= 0 && fb.y1 <= 1000;
    }),
  };

  // ─── 문제별 검증 ───
  const problems = [];
  const maxLen = Math.max(pageItems.length, expectedUser.length);
  for (let i = 0; i < maxLen; i++) {
    const item = pageItems[i];
    const pNum = item?.problem_number || `?${i + 1}`;
    const actU = String(item?.user_answer ?? '');
    const actC = String(item?.correct_answer ?? '');
    const expU = expectedUser[i] || '?';
    const expC = expectedCorrect[i] || '?';

    const userPass = checkUserAnswer(testCase, i, actU);
    const correctPass = expC === actC;

    problems.push({
      num: pNum,
      userAnswer: { expected: expU, actual: actU, pass: userPass,
        flexible: !!testCase.flexibleUser[i] },
      correctAnswer: { expected: expC, actual: actC, pass: correctPass },
      // 실패 시 Pass 원인 분석용 힌트
      passAData: item ? {
        hasPassage: !!(item.passage || item.shared_passage_ref),
        hasChoices: Array.isArray(item.choices) && item.choices.length > 0,
        instruction: (item.instruction || '').substring(0, 80),
      } : null,
    });
  }

  return {
    id,
    imagePath,
    problems,
    safetyChecks,
    allPass: problems.every(p => p.userAnswer.pass && p.correctAnswer.pass),
    rawData: VERBOSE ? { passA: passAResult.parsed, pass0: pass0Result.bboxes, passB: passBResult.marks, pageItems } : undefined,
  };
}

// ─── 리그레션 체크 ───────────────────────────────────────
function checkRegressions(currentResults) {
  if (!fs.existsSync(RESULTS_PATH)) return [];
  try {
    const previous = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
    const regressions = [];
    for (const prevImg of (previous.images || [])) {
      for (const prevProb of (prevImg.problems || [])) {
        if (prevProb.userAnswer?.pass && prevProb.correctAnswer?.pass) {
          const currImg = currentResults.find(r => r.id === prevImg.id);
          const currProb = currImg?.problems.find(p => p.num === prevProb.num);
          if (currProb && (!currProb.userAnswer.pass || !currProb.correctAnswer.pass)) {
            regressions.push({
              imageId: prevImg.id,
              num: prevProb.num,
              prev: 'PASS',
              curr: !currProb.userAnswer.pass ? `user_answer: ${currProb.userAnswer.actual}` : `correct_answer: ${currProb.correctAnswer.actual}`,
            });
          }
        }
      }
    }
    return regressions;
  } catch { return []; }
}

// ─── 메인 ────────────────────────────────────────────────
async function main() {
  loadEnvYaml();

  sep('analyze-image 통합 테스트');
  console.log(`  테스트 케이스: ${TEST_CASES.length}개 이미지, 총 ${TEST_CASES.reduce((s, t) => s + t.expectedUser.split(',').length, 0)}문제`);

  // Vertex AI 초기화
  const aiOptions = {
    vertexai: true,
    project: VERTEX_PROJECT_ID,
    location: VERTEX_LOCATION,
  };
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      aiOptions.googleAuthOptions = { credentials: JSON.parse(serviceAccountJson) };
      console.log('  인증: Vertex AI 서비스계정');
    } catch (e) {
      console.error('[경고] 서비스계정 파싱 실패, ADC 폴백:', e.message);
    }
  } else {
    console.log('  인증: ADC');
  }
  const ai = new GoogleGenAI(aiOptions);

  // 순차 실행
  const allResults = [];
  for (const testCase of TEST_CASES) {
    sep(`이미지: ${testCase.id} (${path.basename(testCase.imagePath)})`);
    try {
      const result = await runSingleImage(ai, testCase);
      allResults.push(result);
    } catch (err) {
      console.error(`  [치명적 오류] ${testCase.id}:`, err.message);
      allResults.push({ id: testCase.id, error: err.message, problems: [], allPass: false, safetyChecks: {} });
    }
  }

  // 리그레션 체크
  const regressions = checkRegressions(allResults);

  // 결과 집계
  const allProblems = allResults.flatMap(r => r.problems);
  const passed = allProblems.filter(p => p.userAnswer.pass && p.correctAnswer.pass).length;
  const failed = allProblems.length - passed;
  const allPass = failed === 0 && regressions.length === 0;

  const failedProblems = [];
  for (const r of allResults) {
    for (const p of r.problems) {
      if (!p.userAnswer.pass || !p.correctAnswer.pass) {
        failedProblems.push({
          imageId: r.id,
          num: p.num,
          userFail: !p.userAnswer.pass ? { expected: p.userAnswer.expected, actual: p.userAnswer.actual, flexible: p.userAnswer.flexible } : null,
          correctFail: !p.correctAnswer.pass ? { expected: p.correctAnswer.expected, actual: p.correctAnswer.actual } : null,
        });
      }
    }
  }

  // JSON 결과 저장
  const summary = {
    timestamp: new Date().toISOString(),
    allPass,
    total: allProblems.length,
    passed,
    failed,
    regressions,
    images: allResults.map(r => ({
      id: r.id,
      allPass: r.allPass,
      error: r.error || null,
      safetyChecks: r.safetyChecks,
      problems: r.problems,
      rawData: r.rawData,
    })),
    failedProblems,
  };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(summary, null, 2));

  // ─── 콘솔 출력 ───
  sep('결과 요약');

  const rows = [];
  let globalIdx = 0;
  for (const r of allResults) {
    for (const p of r.problems) {
      globalIdx++;
      const uIcon = p.userAnswer.pass ? '✓' : '✗';
      const cIcon = p.correctAnswer.pass ? '✓' : '✗';
      const flex = p.userAnswer.flexible ? '*' : '';
      rows.push([
        `${globalIdx}`,
        r.id,
        p.num,
        `${uIcon} ${p.userAnswer.actual || '-'}${flex} (${p.userAnswer.expected})`,
        `${cIcon} ${p.correctAnswer.actual || '-'} (${p.correctAnswer.expected})`,
      ]);
    }
  }
  printTable(['#', '이미지', '문제', 'user_answer', 'correct_answer'], rows);

  // 안전성 체크
  sep('안전성 체크');
  for (const r of allResults) {
    const sc = r.safetyChecks;
    if (!sc) { console.log(`  ${r.id}: 오류로 체크 불가`); continue; }
    const items = [
      ['문제 수 일치', sc.problemCountMatch],
      ['지문 존재', sc.passagePresent],
      ['선택지 존재', sc.choicesPresent],
      ['bbox 유효', sc.bboxValid],
    ];
    for (const [name, ok] of items) {
      console.log(`  ${r.id} - ${name}: ${ok ? 'OK' : 'FAIL'}`);
    }
  }

  // 리그레션
  if (regressions.length > 0) {
    sep('⚠ 리그레션 감지');
    for (const reg of regressions) {
      console.log(`  ${reg.imageId} Q${reg.num}: 이전 PASS → 현재 FAIL (${reg.curr})`);
    }
  }

  // 실패 문제 상세
  if (failedProblems.length > 0) {
    sep('실패 문제 상세');
    for (const fp of failedProblems) {
      if (fp.userFail) {
        console.log(`  ${fp.imageId} Q${fp.num} user_answer: 기대=${fp.userFail.expected}${fp.userFail.flexible ? '(유연)' : ''}, 실제=${fp.userFail.actual}`);
      }
      if (fp.correctFail) {
        console.log(`  ${fp.imageId} Q${fp.num} correct_answer: 기대=${fp.correctFail.expected}, 실제=${fp.correctFail.actual}`);
      }
    }
  }

  // 최종 결과
  console.log();
  console.log(`  총 ${allProblems.length}문제: ${passed} PASS, ${failed} FAIL, 리그레션 ${regressions.length}건`);
  console.log(`  ====> ${allPass ? '전체 PASS ✓' : '실패 있음 ✗'}`);
  console.log(`  결과 저장: ${RESULTS_PATH}`);
  console.log(`  (* = 유연 허용 user_answer)`);
  console.log();

  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('[치명적 오류]', err);
  process.exit(2);
});
