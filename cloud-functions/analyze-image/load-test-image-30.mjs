/**
 * 이미지 분석 부하 테스트: 30명 × 3장 = 90장 동시 분석
 *
 * 설계 목표:
 *  - 학원 실제 시나리오 (stagger 100-300ms)
 *  - 3개 폴더 (이어지는 지문 / 맨 처음 받은거 / 정갈함) round-robin 분산
 *  - 단계별 실패 진단 (HTTP / background / sessions.failure_stage / failure_message)
 *  - 결과 JSON 파일 저장 (재현·비교 가능)
 *  - 완전 cleanup
 *
 * 사용법:
 *   node load-test-image-30.mjs
 *
 * 결과 파일:
 *   load-test-results-{ISO}.json
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import sharp from 'sharp';

// ─── 설정 ─────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vkoegxohahpptdyipmkr.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_y0ZeufG01WW57EWJs4GJUw_tFsr34qV';
const GCF_URL = process.env.GCF_URL || 'https://analyze-image-jg35qrg4wa-du.a.run.app';
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var required');

const N_USERS = 30;
const IMAGES_PER_USER = 3;
const STAGGER_MIN_MS = 100;
const STAGGER_MAX_MS = 300;
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 600_000;  // 10분

const TEST_IMAGE_BASE = '../../test_image';
const FOLDERS = [
  '맨 처음 받은거',
  '이어지는 지문',
  '정갈함',
];

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const anon = createClient(SUPABASE_URL, ANON_KEY);

const ts = () => new Date().toISOString().slice(11, 23);
const log = (tag, ...args) => console.log(`[${ts()}] [${tag}]`, ...args);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randStagger = () => STAGGER_MIN_MS + Math.random() * (STAGGER_MAX_MS - STAGGER_MIN_MS);

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function mimeFromExt(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

// ─── 이미지 풀 준비 (3 폴더 → 압축 후 base64) ───────────
// 프론트엔드 App.tsx:compressImage와 동일 (1200px 긴 변 + JPEG 0.8)
async function loadImagePool() {
  const pool = []; // { folder, filename, imageBase64, mimeType, bytes }
  for (const folder of FOLDERS) {
    const dir = join(TEST_IMAGE_BASE, folder);
    let files;
    try {
      files = readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    } catch (e) {
      throw new Error(`이미지 폴더 읽기 실패 [${dir}]: ${e.message}`);
    }
    if (files.length === 0) throw new Error(`이미지 없음: ${dir}`);
    for (const f of files) {
      const path = join(dir, f);
      const originalBytes = statSync(path).size;
      // 프론트엔드와 동일하게 1200px + JPEG 80%로 압축
      const compressedBuffer = await sharp(readFileSync(path))
        .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const imageBase64 = compressedBuffer.toString('base64');
      pool.push({
        folder, filename: f, imageBase64,
        mimeType: 'image/jpeg',
        bytes: compressedBuffer.length,
        originalBytes,
      });
    }
  }
  return pool;
}

// user[i] → 폴더 i%3 에서 3장 (순환 선택)
function assignImagesToUsers(pool) {
  const byFolder = FOLDERS.map(f => pool.filter(p => p.folder === f));
  const assignments = []; // [{userIdx, folder, images: [{filename, imageBase64, mimeType, bytes}]}]
  for (let i = 0; i < N_USERS; i++) {
    const folder = FOLDERS[i % FOLDERS.length];
    const folderPool = byFolder[i % FOLDERS.length];
    const userInFolder = Math.floor(i / FOLDERS.length); // 같은 폴더 내 사용자 순번
    const images = [];
    for (let j = 0; j < IMAGES_PER_USER; j++) {
      const idx = (userInFolder * IMAGES_PER_USER + j) % folderPool.length;
      images.push(folderPool[idx]);
    }
    assignments.push({ userIdx: i, folder, images });
  }
  return assignments;
}

// ─── user 생성 ───────────────────────────────────────────
async function createTestUser(idx) {
  const email = `loadtest-img-${Date.now()}-${idx}@example.com`;
  const password = 'TestPassword12345!';

  const { data: createData, error: e1 } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (e1) throw new Error(`createUser[${idx}]: ${e1.message}`);

  const { data: signIn, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn[${idx}]: ${e2.message}`);

  return { userId: createData.user.id, token: signIn.session.access_token, email };
}

// ─── GCF 호출 (analyze-image) ────────────────────────────
async function callAnalyzeImage(user, images, idx) {
  const t0 = Date.now();
  const payload = {
    images: images.map(im => ({ imageBase64: im.imageBase64, mimeType: im.mimeType })),
    userId: user.userId,
    language: 'ko',
  };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');

  try {
    const resp = await fetch(GCF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const elapsed = Date.now() - t0;
    return {
      idx,
      payloadBytes,
      httpStatus: resp.status,
      httpOk: resp.status === 200,
      elapsed,
      sessionId: parsed?.sessionId || null,
      errorBody: resp.status !== 200 ? text.slice(0, 500) : null,
    };
  } catch (err) {
    return {
      idx,
      payloadBytes,
      httpStatus: 0,
      httpOk: false,
      elapsed: Date.now() - t0,
      sessionId: null,
      errorBody: `FETCH_ERROR: ${err.message}`,
    };
  }
}

// ─── sessions 테이블 polling (백그라운드 분석 완료까지) ────
async function pollSessions(sessionIds) {
  const start = Date.now();
  const seen = new Map(); // sessionId → {status_history, last_state}

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const { data, error } = await admin
      .from('sessions')
      .select('id, status, failure_stage, failure_message, analysis_model, models_used, image_urls')
      .in('id', sessionIds);
    if (error) {
      log('POLL', 'error:', error.message);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    let completed = 0, failed = 0, inProgress = 0, notFound = 0;
    for (const sid of sessionIds) {
      const row = data.find(r => r.id === sid);
      if (!row) { notFound++; continue; }
      if (!seen.has(sid)) seen.set(sid, { history: [], last: null });
      const entry = seen.get(sid);
      if (entry.last !== row.status) {
        entry.history.push({ status: row.status, at: Date.now() - start });
        entry.last = row.status;
        entry.failure_stage = row.failure_stage;
        entry.failure_message = row.failure_message;
        entry.analysis_model = row.analysis_model;
        entry.models_used = row.models_used;
      }
      if (row.status === 'completed' || row.status === 'labeled') completed++;
      else if (row.status === 'failed') failed++;
      else inProgress++;
    }
    log('POLL', `완료:${completed} 실패:${failed} 진행:${inProgress} 미발견:${notFound} (${Math.round((Date.now() - start) / 1000)}s)`);

    if (completed + failed >= sessionIds.length) break;
    await sleep(POLL_INTERVAL_MS);
  }
  return seen;
}

// ─── problems 카운트 ────────────────────────────────────
async function countProblems(sessionIds) {
  const { data, error } = await admin
    .from('problems')
    .select('session_id')
    .in('session_id', sessionIds);
  if (error) return {};
  return data.reduce((acc, r) => { acc[r.session_id] = (acc[r.session_id] || 0) + 1; return acc; }, {});
}

// ─── cleanup ─────────────────────────────────────────────
async function cleanup(users, sessionIds) {
  if (sessionIds.length > 0) {
    try {
      const { data: probs } = await admin.from('problems').select('id').in('session_id', sessionIds);
      const probIds = (probs || []).map(p => p.id);
      if (probIds.length > 0) await admin.from('labels').delete().in('problem_id', probIds);
      await admin.from('problems').delete().in('session_id', sessionIds);
      await admin.from('sessions').delete().in('id', sessionIds);
    } catch (e) { log('CLEANUP', 'DB cleanup 일부 실패:', e.message); }
  }
  const userIds = users.map(u => u.userId).filter(Boolean);
  if (userIds.length > 0) {
    await Promise.allSettled(userIds.map(uid => admin.auth.admin.deleteUser(uid)));
  }
}

// ─── 메인 ───────────────────────────────────────────────
async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const results = {
    runId,
    config: { N_USERS, IMAGES_PER_USER, STAGGER_MIN_MS, STAGGER_MAX_MS, GCF_URL, FOLDERS },
    setup: {},
    fire: {},
    poll: {},
    perUser: [],
    diagnosis: {},
  };

  let users = [];
  let sessionIds = [];
  const sessionToUser = new Map();

  try {
    // 1) 이미지 풀 로드 (프론트엔드와 동일하게 1200px + JPEG 80% 압축)
    log('LOAD', '이미지 풀 로드 + 압축 중...');
    const pool = await loadImagePool();
    const totalOriginalBytes = pool.reduce((s, p) => s + (p.originalBytes || 0), 0);
    const totalBytes = pool.reduce((s, p) => s + p.bytes, 0);
    log('LOAD', `${pool.length}장 압축 완료 (폴더별 분포: ${FOLDERS.map(f => `${f}:${pool.filter(p => p.folder === f).length}`).join(', ')})`);
    log('LOAD', `원본 총 ${(totalOriginalBytes / 1024 / 1024).toFixed(1)}MB → 압축 ${(totalBytes / 1024 / 1024).toFixed(1)}MB (${((1 - totalBytes / totalOriginalBytes) * 100).toFixed(1)}% 감소)`);

    const assignments = assignImagesToUsers(pool);
    const userPayloadBytes = assignments.map(a => a.images.reduce((s, im) => s + im.bytes * 1.34, 0));
    log('LOAD', `예상 user당 평균 payload: ${(userPayloadBytes.reduce((a,b)=>a+b,0) / N_USERS / 1024 / 1024).toFixed(2)}MB (base64 환산)`);
    log('LOAD', `최대 user payload: ${(Math.max(...userPayloadBytes) / 1024 / 1024).toFixed(2)}MB`);

    // 2) user 생성
    log('SETUP', `${N_USERS}명 user 병렬 생성 시작...`);
    const setupStart = Date.now();
    const setupResults = await Promise.allSettled(
      Array.from({ length: N_USERS }, (_, i) => createTestUser(i))
    );
    users = setupResults.map((r, i) => r.status === 'fulfilled' ? r.value : { userId: null, idx: i, error: r.reason?.message });
    const validUsers = users.filter(u => u.userId);
    results.setup = {
      requested: N_USERS,
      succeeded: validUsers.length,
      failed: users.length - validUsers.length,
      elapsed: Date.now() - setupStart,
    };
    log('SETUP', `${validUsers.length}/${N_USERS} 성공 (${results.setup.elapsed}ms)`);
    if (validUsers.length === 0) throw new Error('user 생성 모두 실패');

    // 3) GCF warmup — 30개 spike로 미리 인스턴스 띄움 (학원 시작 직전 시나리오)
    log('WARMUP', '인스턴스 30개 warmup spike...');
    const warmupStart = Date.now();
    await Promise.all(Array.from({ length: 30 }, () =>
      fetch(`${GCF_URL}?warmup=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null)
    ));
    log('WARMUP', `warmup 30개 완료 (${Date.now() - warmupStart}ms)`);
    await sleep(3000);  // 인스턴스 안정화 대기

    // 4) stagger 발사
    log('FIRE', `${validUsers.length}개 발사 (stagger ${STAGGER_MIN_MS}-${STAGGER_MAX_MS}ms)`);
    const fireStart = Date.now();
    const callPromises = [];
    for (let i = 0; i < validUsers.length; i++) {
      const user = validUsers[i];
      const assignment = assignments[user.idx ?? i] || assignments[i];
      callPromises.push(callAnalyzeImage(user, assignment.images, i).then(r => ({ ...r, userId: user.userId, folder: assignment.folder })));
      if (i < validUsers.length - 1) await sleep(randStagger());
    }
    const callResults = await Promise.all(callPromises);
    const fireElapsed = Date.now() - fireStart;
    log('FIRE', `전체 응답 수신 완료 (${fireElapsed}ms)`);

    const httpOks = callResults.filter(r => r.httpOk);
    const httpFails = callResults.filter(r => !r.httpOk);
    results.fire = {
      total: callResults.length,
      httpOk: httpOks.length,
      httpFail: httpFails.length,
      elapsed: fireElapsed,
      avgResponseMs: httpOks.length ? Math.round(httpOks.reduce((s, r) => s + r.elapsed, 0) / httpOks.length) : null,
      p50: percentile(httpOks.map(r => r.elapsed), 50),
      p95: percentile(httpOks.map(r => r.elapsed), 95),
      p99: percentile(httpOks.map(r => r.elapsed), 99),
      max: httpOks.length ? Math.max(...httpOks.map(r => r.elapsed)) : null,
      statusDistribution: httpFails.reduce((acc, r) => { acc[r.httpStatus] = (acc[r.httpStatus] || 0) + 1; return acc; }, {}),
      errorSamples: httpFails.slice(0, 5).map(r => ({ idx: r.idx, status: r.httpStatus, body: r.errorBody })),
    };
    log('FIRE', `HTTP 성공: ${httpOks.length}/${callResults.length}, p50=${results.fire.p50}ms p95=${results.fire.p95}ms`);
    if (httpFails.length > 0) {
      log('FIRE', '실패 분포:', JSON.stringify(results.fire.statusDistribution));
      log('FIRE', '실패 샘플:', JSON.stringify(results.fire.errorSamples[0]));
    }

    sessionIds = httpOks.map(r => r.sessionId).filter(Boolean);
    httpOks.forEach(r => { if (r.sessionId) sessionToUser.set(r.sessionId, r); });

    if (sessionIds.length === 0) throw new Error('sessionId가 하나도 생성되지 않음');

    // 5) sessions polling
    log('POLL', `${sessionIds.length}개 sessions 백그라운드 분석 polling (최대 ${POLL_TIMEOUT_MS / 1000}s)`);
    const sessionStates = await pollSessions(sessionIds);

    // 6) problems 카운트
    const problemCounts = await countProblems(sessionIds);

    // 7) 결과 집계
    const finalStates = Array.from(sessionStates.entries()).map(([sid, info]) => ({
      sessionId: sid,
      finalStatus: info.last,
      failure_stage: info.failure_stage,
      failure_message: info.failure_message?.slice(0, 300),
      analysis_model: info.analysis_model,
      models_used: info.models_used,
      problemCount: problemCounts[sid] || 0,
      history: info.history,
    }));

    const completed = finalStates.filter(s => s.finalStatus === 'completed' || s.finalStatus === 'labeled');
    const failed = finalStates.filter(s => s.finalStatus === 'failed');
    const stuck = finalStates.filter(s => s.finalStatus !== 'completed' && s.finalStatus !== 'failed' && s.finalStatus !== 'labeled');

    results.poll = {
      total: sessionIds.length,
      completed: completed.length,
      failed: failed.length,
      stuck: stuck.length,
      totalProblemsExtracted: Object.values(problemCounts).reduce((s, c) => s + c, 0),
    };

    // 8) 실패 단계 분류
    const failureStageCount = {};
    const failureMessagePatterns = {};
    for (const f of failed) {
      const stage = f.failure_stage || 'unknown';
      failureStageCount[stage] = (failureStageCount[stage] || 0) + 1;
      const msg = (f.failure_message || '').slice(0, 80);
      failureMessagePatterns[msg] = (failureMessagePatterns[msg] || 0) + 1;
    }
    results.diagnosis = {
      failureStageDistribution: failureStageCount,
      failureMessagePatterns,
      stuckSessions: stuck.map(s => ({ sessionId: s.sessionId, history: s.history })),
      sampleFailures: failed.slice(0, 5),
    };

    log('RESULT', '═══════════════════════════════');
    log('RESULT', `성공:    ${completed.length}/${sessionIds.length} (${(completed.length / sessionIds.length * 100).toFixed(1)}%)`);
    log('RESULT', `실패:    ${failed.length}/${sessionIds.length}`);
    log('RESULT', `정체:    ${stuck.length}/${sessionIds.length}`);
    log('RESULT', `추출문제: 총 ${results.poll.totalProblemsExtracted}개`);
    if (failed.length > 0) {
      log('RESULT', '실패 단계 분포:', JSON.stringify(failureStageCount));
      log('RESULT', '실패 메시지 패턴 Top 5:');
      Object.entries(failureMessagePatterns)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([msg, n]) => log('RESULT', `  [${n}회] ${msg}`));
    }

    // 9) per-user 상세 (디버깅용)
    results.perUser = callResults.map(r => {
      const sstate = r.sessionId ? sessionStates.get(r.sessionId) : null;
      return {
        idx: r.idx,
        folder: r.folder,
        payloadMB: (r.payloadBytes / 1024 / 1024).toFixed(2),
        httpStatus: r.httpStatus,
        httpElapsed: r.elapsed,
        sessionId: r.sessionId,
        finalStatus: sstate?.last,
        failure_stage: sstate?.failure_stage,
        failure_message: sstate?.failure_message?.slice(0, 200),
        problemCount: r.sessionId ? (problemCounts[r.sessionId] || 0) : 0,
      };
    });

    // 10) 결과 파일 저장
    const fname = `load-test-results-${runId}.json`;
    writeFileSync(fname, JSON.stringify(results, null, 2));
    log('SAVE', `결과 → ${fname}`);

    // 최종 판정
    if (completed.length === sessionIds.length) {
      log('VERDICT', '✅ 30명 동시 이미지 분석 100% 성공');
    } else if (completed.length / sessionIds.length >= 0.9) {
      log('VERDICT', `⚠️ ${(completed.length / sessionIds.length * 100).toFixed(1)}% 부분 성공 (목표 100% 미달)`);
      process.exitCode = 1;
    } else {
      log('VERDICT', `❌ ${(completed.length / sessionIds.length * 100).toFixed(1)}% 실패 — 진단 필요`);
      process.exitCode = 2;
    }

  } catch (err) {
    log('FATAL', err.message);
    log('FATAL', err.stack);
    results.fatalError = { message: err.message, stack: err.stack };
    process.exitCode = 3;

    // 부분 결과라도 저장
    try {
      writeFileSync(`load-test-results-${runId}-PARTIAL.json`, JSON.stringify(results, null, 2));
    } catch {}
  } finally {
    log('CLEANUP', `${users.length} users / ${sessionIds.length} sessions 정리...`);
    await cleanup(users, sessionIds);
    log('CLEANUP', '완료');
  }
}

main();
