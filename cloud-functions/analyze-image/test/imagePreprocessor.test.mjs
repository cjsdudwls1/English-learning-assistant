/**
 * 서버 전처리 사양 테스트.
 *
 * 이 파일이 존재하는 이유는 하나다. 2026-08-16, 프론트 compressImage()를 1200px→2048px로
 * 올렸는데 서버 preprocessImage()가 1200px로 남아 개선이 통째로 무효화됐다. 증상이 없었다 —
 * 에러도 경고도 없이 그냥 모델이 저해상도 이미지를 받았고, 프론트 번들에는 2048이 분명히
 * 들어가 있어 "반영됐다"고 오판하기 딱 좋았다.
 *
 * 두 상수는 물리적으로 다른 파일(하나는 TSX 프론트, 하나는 Node 백엔드)에 있어 타입으로
 * 묶을 수가 없다. 그래서 여기서 소스를 직접 읽어 비교한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import sharp from 'sharp';
import { preprocessImage, MAX_DIMENSION, JPEG_QUALITY } from '../shared/imagePreprocessor.js';

const here = dirname(fileURLToPath(import.meta.url));
const APP_TSX = resolve(here, '../../../English-learning-assistant/src/App.tsx');

/** 지정 크기의 JPEG를 만들어 base64로 돌려준다. */
async function makeJpeg(width, height) {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } },
  }).jpeg({ quality: 92 }).toBuffer();
  return buf.toString('base64');
}

test('프론트 compressImage()와 서버 preprocessImage()의 사양이 일치한다', () => {
  if (!existsSync(APP_TSX)) {
    // cloud-functions만 따로 체크아웃한 경우. 비교 대상이 없으면 검증을 건너뛴다.
    console.warn(`[skip] 프론트 소스를 찾을 수 없음: ${APP_TSX}`);
    return;
  }
  const src = readFileSync(APP_TSX, 'utf8');

  const dim = src.match(/maxDimension\s*=\s*(\d+)/);
  const qual = src.match(/quality\s*=\s*([\d.]+)/);
  assert.ok(dim, 'App.tsx에서 compressImage의 maxDimension 기본값을 찾지 못했다');
  assert.ok(qual, 'App.tsx에서 compressImage의 quality 기본값을 찾지 못했다');

  assert.equal(
    Number(dim[1]), MAX_DIMENSION,
    `해상도 불일치: 프론트 ${dim[1]}px vs 서버 ${MAX_DIMENSION}px. `
    + '서버가 더 작으면 프론트 설정이 무효화되고, 서버가 더 크면 프론트가 이미 깎은 것을 '
    + '되돌리지 못한다. 한쪽을 바꿨으면 다른 쪽도 바꿀 것.',
  );
  // 프론트는 0~1(Canvas toBlob), 서버는 0~100(sharp). 단위만 다르고 같은 값이어야 한다.
  assert.equal(
    Math.round(Number(qual[1]) * 100), JPEG_QUALITY,
    `JPEG 품질 불일치: 프론트 ${qual[1]} vs 서버 ${JPEG_QUALITY}/100`,
  );
});

test('프론트 사양으로 도착한 이미지는 재인코딩 없이 그대로 통과한다', async () => {
  // 프론트를 거친 이미지는 이미 MAX_DIMENSION 이하이고 EXIF도 없다(Canvas 출력).
  // 여기서 한 번 더 JPEG를 먹이면 손실만 쌓인다.
  const b64 = await makeJpeg(MAX_DIMENSION, Math.round(MAX_DIMENSION * 0.75));
  const out = await preprocessImage(b64, 'image/jpeg');
  assert.equal(out.imageBase64, b64, '변환이 불필요한 이미지인데 재인코딩됐다');
  assert.equal(out.mimeType, 'image/jpeg');
});

test('원본 해상도 이미지는 MAX_DIMENSION으로 축소된다', async () => {
  // 스마트폰 원본(4000x3000)이 서버로 직접 오는 경로(legacy-inline·eval).
  const b64 = await makeJpeg(4000, 3000);
  const out = await preprocessImage(b64, 'image/jpeg');
  const meta = await sharp(Buffer.from(out.imageBase64, 'base64')).metadata();
  assert.equal(meta.width, MAX_DIMENSION);
  assert.equal(meta.height, Math.round(MAX_DIMENSION * 0.75));
});
