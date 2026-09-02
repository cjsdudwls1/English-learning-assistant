/**
 * 지연 썸네일 백필의 **캔버스 없이 검증 가능한 부분**.
 *
 * 캔버스는 테스트 환경(node)에 없다. 그래서 인코딩 자체는 못 돌리지만, 조용히 잘못될 수 있는
 * 세 가지는 여기서 고정한다:
 *  (1) 축소 비율 — 틀리면 썸네일이 뭉개지거나 원본만 한 파일이 올라간다(고치려던 것이 되살아난다).
 *  (2) 소유자 판정 — RLS가 어차피 막지만, 막힐 걸 알면서 요청을 보내면 낭비다.
 *  (3) 1회 시도 — 재시도를 허용하면 실패하는 이미지 하나가 렌더마다 업로드를 되풀이한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploads: string[] = [];
let sessionUserId: string | null = null;
let getSessionCalls = 0;

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => {
        getSessionCalls += 1;
        return Promise.resolve({
          data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
        });
      },
    },
    storage: {
      from: () => ({
        upload: (path: string) => {
          uploads.push(path);
          return Promise.resolve({ error: null });
        },
        createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
      }),
    },
  },
}));

import {
  backfillThumb,
  canWriteThumb,
  claimThumbBackfill,
  disableThumbBackfill,
  fitWithin,
  isThumbBackfillDisabled,
  resetThumbBackfills,
  THUMB_MAX_DIMENSION,
} from './thumbnail';

const OWNER = '3f7c1a2e-9b04-4d51-8e6a-1c2d3e4f5a6b';
const OTHER = '00000000-1111-2222-3333-444444444444';

beforeEach(() => {
  uploads.length = 0;
  getSessionCalls = 0;
  sessionUserId = OWNER;
  resetThumbBackfills();
});

describe('fitWithin', () => {
  it('가로 원본을 긴 변 기준으로 줄인다', () => {
    // 스마트폰 사진을 2048px로 압축한 것이 업로드 원본의 전형이다.
    expect(fitWithin(2048, 1536, 320)).toEqual({ width: 320, height: 240 });
  });

  it('세로 원본도 긴 변 기준이다', () => {
    expect(fitWithin(1536, 2048, 320)).toEqual({ width: 240, height: 320 });
  });

  it('이미 작으면 확대하지 않는다', () => {
    // 확대하면 파일만 커지고 화질은 그대로다 — 송신량을 줄이려는 목적과 정반대다.
    expect(fitWithin(200, 150, 320)).toEqual({ width: 200, height: 150 });
  });

  it('경계값은 그대로 둔다', () => {
    expect(fitWithin(320, 240, 320)).toEqual({ width: 320, height: 240 });
  });

  it('한 변만 넘쳐도 줄인다', () => {
    expect(fitWithin(321, 100, 320)).toEqual({ width: 320, height: 100 });
  });

  it('크기를 못 읽으면 0을 준다 — 호출부가 인코딩을 포기한다', () => {
    // naturalWidth가 0인 <img>(디코드 실패)를 그리면 캔버스가 0×0이 돼 toBlob이 죽는다.
    expect(fitWithin(0, 100, 320)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 100, 320)).toEqual({ width: 0, height: 0 });
  });

  it('썸네일 규격은 320이다', () => {
    // 목록 최대 박스 96 CSS px × DPR 3 = 288px를 덮는 값. 바뀌면 의도적이어야 한다.
    expect(THUMB_MAX_DIMENSION).toBe(320);
  });
});

describe('canWriteThumb', () => {
  it('내 폴더면 쓸 수 있다', () => {
    expect(canWriteThumb(`${OWNER}/thumb/a.jpg`, OWNER)).toBe(true);
  });

  it('남의 폴더면 못 쓴다 — RLS가 403을 준다', () => {
    expect(canWriteThumb(`${OWNER}/thumb/a.jpg`, OTHER)).toBe(false);
  });

  it('로그인 안 됐으면 못 쓴다', () => {
    expect(canWriteThumb(`${OWNER}/thumb/a.jpg`, null)).toBe(false);
    expect(canWriteThumb(`${OWNER}/thumb/a.jpg`, undefined)).toBe(false);
  });

  it('thumb 폴더가 아니면 거부한다 — 원본을 덮어쓸 뻔한 경로다', () => {
    expect(canWriteThumb(`${OWNER}/a.jpg`, OWNER)).toBe(false);
  });

  it('path가 아니면 거부한다', () => {
    expect(canWriteThumb(null, OWNER)).toBe(false);
    expect(canWriteThumb('', OWNER)).toBe(false);
    expect(canWriteThumb('thumb/a.jpg', OWNER)).toBe(false);
  });
});

describe('claimThumbBackfill', () => {
  it('같은 path는 한 번만 통과시킨다', () => {
    expect(claimThumbBackfill(`${OWNER}/thumb/a.jpg`)).toBe(true);
    expect(claimThumbBackfill(`${OWNER}/thumb/a.jpg`)).toBe(false);
  });

  it('다른 path는 서로 막지 않는다', () => {
    expect(claimThumbBackfill(`${OWNER}/thumb/a.jpg`)).toBe(true);
    expect(claimThumbBackfill(`${OWNER}/thumb/b.jpg`)).toBe(true);
  });
});

describe('backfillThumb 사전 차단', () => {
  // 캔버스가 필요한 지점 **앞에서** 끝나는 경로들. 여기서 안 끊으면 실패할 요청이 나간다.
  const fakeImage = { naturalWidth: 2048, naturalHeight: 1536 } as HTMLImageElement;

  it('업로드 전 로컬 미리보기는 건드리지 않는다', async () => {
    // blob:/data: 미리보기는 storage path가 아니다. 세션 조회조차 할 이유가 없다.
    await expect(backfillThumb(fakeImage, 'blob:http://localhost:3001/abcd')).resolves.toBe(false);
    expect(getSessionCalls).toBe(0);
    expect(uploads).toEqual([]);
  });

  it('legacy 버킷은 건너뛴다', async () => {
    const legacy = `https://x.supabase.co/storage/v1/object/public/uploaded-images/${OWNER}/a.jpg`;
    await expect(backfillThumb(fakeImage, legacy)).resolves.toBe(false);
    expect(uploads).toEqual([]);
  });

  it('남의 이미지는 업로드를 시도조차 하지 않는다', async () => {
    sessionUserId = OTHER;
    await expect(backfillThumb(fakeImage, `${OWNER}/a.jpg`)).resolves.toBe(false);
    expect(getSessionCalls).toBe(1);
    expect(uploads).toEqual([]);
  });

  it('로그아웃 상태면 건너뛴다', async () => {
    sessionUserId = null;
    await expect(backfillThumb(fakeImage, `${OWNER}/a.jpg`)).resolves.toBe(false);
    expect(uploads).toEqual([]);
  });

  it('세션 전역 스위치를 끄면 아무것도 하지 않는다', async () => {
    // CORS로 이미지가 깨진 환경에서 켜 두면 장당 송신이 2배가 된다 — 끄면 즉시 멎어야 한다.
    expect(isThumbBackfillDisabled()).toBe(false);
    disableThumbBackfill();
    expect(isThumbBackfillDisabled()).toBe(true);

    await expect(backfillThumb(fakeImage, `${OWNER}/a.jpg`)).resolves.toBe(false);
    expect(getSessionCalls).toBe(0);
    expect(uploads).toEqual([]);
  });

  it('resetThumbBackfills가 전역 스위치도 되살린다', () => {
    disableThumbBackfill();
    resetThumbBackfills();
    expect(isThumbBackfillDisabled()).toBe(false);
  });
});
