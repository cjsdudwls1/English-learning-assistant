/**
 * Storage 스텁 판별 규칙의 회귀 테스트.
 *
 * E2E 자체는 앱이 살아 있어야 돌지만(2026-09-01 현재 프로덕션이 402라 못 돈다),
 * "무엇을 막고 무엇을 통과시키는가"는 앱 없이도 확정할 수 있어야 한다.
 * 이 파일이 지키는 것 두 가지:
 *  (1) 서명 URL **발급**(POST)은 절대 막지 않는다 — 막으면 화면이 통째로 빈다.
 *  (2) 이미지 **다운로드**(GET)는 빠짐없이 막는다 — 하나라도 새면 그게 송신량이다.
 */
import { describe, it, expect } from 'vitest';
import {
  isStorageObjectDownload,
  isStorageObjectPath,
  STUB_IMAGE_CONTENT_TYPE,
  stubImageBytes,
} from './storage-stub';

const HOST = 'https://example-ref.supabase.co';
const UID = '3f7c1a2e-9b04-4d51-8e6a-1c2d3e4f5a6b';

describe('isStorageObjectDownload', () => {
  it('서명 URL 발급(POST)은 통과시킨다 — 앱 로직이다', () => {
    // 경로만 보고 막으면 여기서 죽는다. 발급이 죽으면 목록에 이미지가 하나도 안 뜬다.
    expect(
      isStorageObjectDownload('POST', `${HOST}/storage/v1/object/sign/analyze-uploads/${UID}/a.jpg`),
    ).toBe(false);
  });

  it('발급된 서명 URL의 다운로드(GET)는 막는다', () => {
    expect(
      isStorageObjectDownload(
        'GET',
        `${HOST}/storage/v1/object/sign/analyze-uploads/${UID}/a.jpg?token=eyJhbGciOi.zz`,
      ),
    ).toBe(true);
  });

  it('legacy 공개 버킷 다운로드도 막는다', () => {
    // uploaded-images는 썸네일을 만든 적이 없는 옛 버킷이라 항상 원본이 나간다.
    expect(
      isStorageObjectDownload('GET', `${HOST}/storage/v1/object/public/uploaded-images/${UID}/a.jpg`),
    ).toBe(true);
  });

  it('인증 다운로드와 이미지 변환 엔드포인트도 막는다', () => {
    expect(
      isStorageObjectDownload('GET', `${HOST}/storage/v1/object/authenticated/analyze-uploads/a.jpg`),
    ).toBe(true);
    expect(
      isStorageObjectDownload('GET', `${HOST}/storage/v1/render/image/public/analyze-uploads/a.jpg?width=320`),
    ).toBe(true);
  });

  it('메서드 대소문자를 가리지 않는다', () => {
    expect(isStorageObjectDownload('get', `${HOST}/storage/v1/object/public/x/a.jpg`)).toBe(true);
  });

  it('Storage가 아닌 요청은 건드리지 않는다', () => {
    // 이걸 막으면 로그인도 데이터 조회도 죽는다.
    expect(isStorageObjectDownload('GET', `${HOST}/rest/v1/sessions?select=*`)).toBe(false);
    expect(isStorageObjectDownload('POST', `${HOST}/auth/v1/token?grant_type=password`)).toBe(false);
    expect(isStorageObjectDownload('GET', `${HOST}/functions/v1/analyze`)).toBe(false);
    expect(isStorageObjectDownload('GET', 'http://localhost:3001/assets/index-abc123.js')).toBe(false);
    expect(isStorageObjectDownload('GET', 'http://localhost:3001/upload')).toBe(false);
  });

  it('업로드(POST)는 통과시킨다 — 스펙이 올리지는 않지만 막을 이유도 없다', () => {
    expect(
      isStorageObjectDownload('POST', `${HOST}/storage/v1/object/analyze-uploads/${UID}/a.jpg`),
    ).toBe(false);
  });

  it('URL이 아닌 문자열은 false다 — 매처가 던지면 라우팅 전체가 죽는다', () => {
    expect(isStorageObjectPath('not a url')).toBe(false);
    expect(isStorageObjectPath('')).toBe(false);
    expect(isStorageObjectDownload('GET', 'not a url')).toBe(false);
  });
});

describe('스텁 이미지', () => {
  it('유효한 PNG여야 한다', () => {
    // 깨진 바이트를 주면 StorageThumb의 onError가 원본으로 폴백해서,
    // 막으려던 다운로드가 결국 일어난다 — 조용히 실패하는 종류의 버그다.
    const bytes = stubImageBytes();
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(bytes.subarray(-12).toString('hex')).toBe('0000000049454e44ae426082');
    expect(STUB_IMAGE_CONTENT_TYPE).toBe('image/png');
  });
});
