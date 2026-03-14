// 바운딩 박스 테스트 클라이언트 스크립트
// Node.js로 실행: node test-bbox-client.mjs
import { readFileSync, readdirSync, existsSync } from 'fs';
import { basename, join, resolve } from 'path';

const SUPABASE_URL = 'https://vkoegxohahpptdyipmkr.supabase.co';
const FUNCTION_NAME = 'test-bbox';

// 프로젝트 내 test_image 폴더에서 jpg 파일 자동 탐색
function findTestImage() {
  const baseDir = resolve('.');
  // test_image 폴더 내 하위 디렉토리에서 jpg 찾기
  const testImageDir = join(baseDir, 'test_image');
  if (!existsSync(testImageDir)) {
    console.log('test_image 디렉토리 없음, 직접 경로를 지정해주세요.');
    console.log('현재 디렉토리:', baseDir);
    // 현재 디렉토리에서 모든 jpg 검색
    return null;
  }

  const subdirs = readdirSync(testImageDir, { withFileTypes: true });
  for (const d of subdirs) {
    if (d.isDirectory()) {
      const subPath = join(testImageDir, d.name);
      const files = readdirSync(subPath).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'));
      if (files.length > 0) {
        const found = join(subPath, files[0]);
        console.log(`발견: ${found}`);
        return found;
      }
    }
  }

  // 바로 아래 jpg 파일
  const topFiles = readdirSync(testImageDir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'));
  if (topFiles.length > 0) return join(testImageDir, topFiles[0]);

  return null;
}

async function main() {
  console.log(`\n=== 바운딩 박스 검출 테스트 ===`);

  const imagePath = findTestImage();
  if (!imagePath) {
    console.error('테스트 이미지를 찾을 수 없습니다. test_image/ 폴더에 jpg 파일을 넣어주세요.');
    return;
  }

  console.log(`이미지: ${basename(imagePath)}`);

  // 이미지를 base64로 인코딩
  const imageBuffer = readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  console.log(`이미지 크기: ${(imageBuffer.length / 1024).toFixed(1)} KB`);

  // Edge Function 호출
  console.log(`\nEdge Function 호출 중...`);
  const startTime = Date.now();

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64,
      mimeType: 'image/jpeg',
    }),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`응답 시간: ${elapsed}초 (상태: ${response.status})`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`에러:`, errorText);
    return;
  }

  const result = await response.json();

  console.log(`\n--- 결과 ---`);
  console.log(`AI Provider: ${result.provider}`);
  console.log(`Model: ${result.model}`);

  if (result.bounding_boxes?.problems) {
    const problems = result.bounding_boxes.problems;
    console.log(`\n감지된 문제 수: ${problems.length}`);
    console.log(`\n문제별 바운딩 박스:`);
    for (const p of problems) {
      const bbox = p.answer_area_bbox;
      console.log(`  Q${p.problem_number}: (${bbox.x1}, ${bbox.y1}) -> (${bbox.x2}, ${bbox.y2})  [${p.description || ''}]`);
    }
  } else {
    console.log(`\n원시 응답:`, JSON.stringify(result.bounding_boxes, null, 2));
  }
}

main().catch(console.error);
