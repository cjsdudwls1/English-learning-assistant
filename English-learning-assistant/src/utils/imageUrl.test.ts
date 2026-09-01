/**
 * signed URL 발급의 **동시성 제어** 회귀 테스트.
 *
 * 이 파일이 지키는 것 두 가지:
 *  (1) 동시 발급은 MAX_INFLIGHT(6)를 넘지 않는다 — 목록 화면이 요청 수백 개를 한꺼번에 쏘면
 *      브라우저 큐가 막혀 모바일에서 첫 화면이 통째로 늦어진다.
 *  (2) 같은 path의 동시 요청은 하나로 합쳐진다 — 합치지 않으면 매번 새 URL이 발급돼
 *      캐시가 마지막 것으로 덮이고 앞선 컴포넌트는 곧 버려질 URL을 잡는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let concurrent = 0;
let peak = 0;
let calls: string[] = [];
/** path별로 "응답을 언제 돌려줄지"를 테스트가 직접 잡는다. */
let releasers: Array<() => void> = [];

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: (path: string) => {
          calls.push(path);
          // **요청 시점**의 순번을 고정한다. 응답 시점의 calls.length를 쓰면 동시에 뜬 두 요청이
          // 같은 URL을 돌려줘서 "어느 쪽이 캐시에 앉았는지" 구별할 수 없다.
          const seq = calls.length;
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          return new Promise((resolve) => {
            releasers.push(() => {
              concurrent -= 1;
              resolve({ data: { signedUrl: `https://signed/${path}?t=${seq}` }, error: null });
            });
          });
        },
      }),
    },
  },
}));

import { resolveImageUrl, resolveImageUrls, invalidateImageUrl, toThumbPath } from './imageUrl';

/**
 * 대기 중인 응답을 전부 흘려보낸다.
 * 매 라운드 마이크로태스크를 **먼저** 흘린다 — 요청은 게이트(await acquireSlot) 뒤에 등록되므로
 * 곧바로 releasers를 보면 아직 비어 있다. 비었다고 멈추면 영영 응답이 안 온다.
 * 게이트가 큐를 풀며 새 요청을 만들기 때문에 고정 라운드로 충분히 돌린다.
 */
async function drain(rounds = 80) {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
    if (releasers.length > 0) {
      const batch = releasers;
      releasers = [];
      batch.forEach((r) => r());
    }
  }
}

/**
 * 응답은 **풀지 않고** 마이크로태스크만 흘린다.
 * drain과 달리 releasers를 건드리지 않아, 테스트가 도착 순서를 직접 지정할 수 있다.
 */
async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

beforeEach(() => {
  concurrent = 0;
  peak = 0;
  calls = [];
  releasers = [];
});

describe('resolveImageUrl 동시성', () => {
  it('동시 발급이 6개를 넘지 않는다', async () => {
    const paths = Array.from({ length: 40 }, (_, i) => `run-a/img${i}.png`);
    const p = resolveImageUrls(paths);
    await Promise.resolve();
    await Promise.resolve();

    expect(peak).toBeLessThanOrEqual(6);

    await drain();
    // 상한에 **실제로 닿는지**까지 본다. `<= 6`만 두면 MAX_INFLIGHT를 1로 낮춰도 통과해서
    // "동시성이 죽었다"는 성능 회귀를 못 잡는다. 40개를 6칸에 밀어 넣으면 반드시 6에 닿는다.
    expect(peak).toBe(6);
    const urls = await p;
    expect(urls).toHaveLength(40);
    // 상한을 걸어도 전부 발급된다 — 요청을 버리는 게 아니라 순서를 세우는 것이다.
    expect(urls.every((u) => u.startsWith('https://signed/'))).toBe(true);
  });

  it('같은 path의 동시 요청은 한 번만 발급한다', async () => {
    const p = Promise.all([
      resolveImageUrl('run-b/same.png'),
      resolveImageUrl('run-b/same.png'),
      resolveImageUrl('run-b/same.png'),
    ]);
    await Promise.resolve();
    await drain();
    const [a, b, c] = await p;

    expect(calls.filter((c2) => c2 === 'run-b/same.png')).toHaveLength(1);
    // 셋이 같은 URL을 받아야 한다. 다르면 컴포넌트마다 다른 URL을 잡는다는 뜻.
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('두 번째 호출은 캐시를 쓴다', async () => {
    const p1 = resolveImageUrl('run-c/cached.png');
    await drain();
    const first = await p1;

    const second = await resolveImageUrl('run-c/cached.png');
    expect(second).toBe(first);
    expect(calls.filter((c2) => c2 === 'run-c/cached.png')).toHaveLength(1);
  });

  it('발급 중 invalidate되면 그 응답을 캐시에 남기지 않는다', async () => {
    // 회귀: 회전 직후 도착한 **회전 전** URL이 캐시에 앉아 원래 이미지가 다시 보였다.
    const p1 = resolveImageUrl('run-d/rotated.png');
    await Promise.resolve();
    invalidateImageUrl('run-d/rotated.png');
    await drain();
    await p1;

    const after = resolveImageUrl('run-d/rotated.png');
    await drain();
    await after;
    // 캐시에 남았다면 두 번째는 발급 없이 끝났을 것이다.
    expect(calls.filter((c2) => c2 === 'run-d/rotated.png')).toHaveLength(2);
  });

  it('invalidate 후 뜬 새 요청이 먼저 도착해도, 늦게 온 낡은 응답이 캐시를 차지하지 않는다', async () => {
    // 회귀: invalidateImageUrl이 pending을 지우므로 같은 path의 요청이 **둘 동시에** 뜬다.
    // "무효화됨"을 Set 하나로만 들고 있으면 먼저 도착한 쪽이 그 표시를 소비해 버려서,
    // 뒤늦게 온 회전 **전** 응답이 정상으로 통과해 캐시에 앉는다.
    // 위 run-d 테스트는 A를 끝낸 뒤 B를 만들어서 이 뒤바뀜을 표현하지 못한다.
    const path = 'run-e/race.png';

    const pA = resolveImageUrl(path); // 회전 **전** 요청 → ?t=1
    await flush();
    expect(releasers).toHaveLength(1);

    invalidateImageUrl(path); // 회전. pending이 지워져 다음 호출은 새로 발급한다.

    const pB = resolveImageUrl(path); // 회전 **후** 요청 → ?t=2
    await flush();
    expect(releasers).toHaveLength(2); // 두 요청이 동시에 떠 있다 — 이게 이 테스트의 전제다

    releasers[1]!(); // B(새 것)가 **먼저** 도착
    await flush();
    releasers[0]!(); // A(낡은 것)가 나중에 도착
    await flush();
    releasers = [];

    const [a, b] = await Promise.all([pA, pB]);
    expect(a).toBe(`https://signed/${path}?t=1`);
    expect(b).toBe(`https://signed/${path}?t=2`);

    // 캐시에 앉아야 하는 건 회전 **후**인 B다. A가 앉았다면 회전한 이미지가 잠깐 보였다가
    // 캐시 수명 동안 원래 것으로 돌아간다 — 이 파일이 막으려던 증상 그대로다.
    const cached = await resolveImageUrl(path);
    expect(cached).toBe(`https://signed/${path}?t=2`);
    expect(calls.filter((c2) => c2 === path)).toHaveLength(2); // 캐시 적중이라 재발급 없음
  });
});

describe('resolveImageUrl 입력 처리', () => {
  it('absolute URL은 그대로 반환하고 발급하지 않는다', async () => {
    expect(await resolveImageUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
    expect(calls).toHaveLength(0);
  });

  it('빈 값은 빈 문자열이다', async () => {
    expect(await resolveImageUrl('')).toBe('');
    expect(await resolveImageUrl(null)).toBe('');
    expect(await resolveImageUrl(undefined)).toBe('');
    expect(await resolveImageUrls(null)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

/**
 * 썸네일 path 규칙.
 *
 * 여기가 틀어지면 조용히 망가진다: userId를 맨 앞에서 밀어내면 `analyze-uploads`의 RLS
 * (`{userId}/` prefix = auth.uid())에 걸려 업로드도 조회도 죽고, 반대로 null만 돌려주면
 * 아무도 눈치 못 챈 채 목록이 계속 2048px 원본을 받는다 — 송신 한도를 태운 그 경로 그대로다.
 */
describe('toThumbPath', () => {
  const UID = '3f7c1a2e-9b04-4d51-8e6a-1c2d3e4f5a6b';

  it('userId prefix를 유지한 채 thumb 폴더를 끼운다', () => {
    expect(toThumbPath(`${UID}/1756000000000_0_sheet.jpg`)).toBe(
      `${UID}/thumb/1756000000000_0_sheet.jpg`,
    );
  });

  it('이미 썸네일 path면 그대로 둔다 (중첩 방지)', () => {
    expect(toThumbPath(`${UID}/thumb/a.jpg`)).toBe(`${UID}/thumb/a.jpg`);
  });

  it('발급된 signed URL에서도 path를 되짚어 썸네일을 만든다', () => {
    expect(
      toThumbPath(
        `https://x.supabase.co/storage/v1/object/sign/analyze-uploads/${UID}/a.jpg?token=zz`,
      ),
    ).toBe(`${UID}/thumb/a.jpg`);
  });

  it('legacy bucket은 대상이 아니다 — 썸네일을 만든 적이 없다', () => {
    expect(
      toThumbPath(`https://x.supabase.co/storage/v1/object/public/uploaded-images/${UID}/a.jpg`),
    ).toBeNull();
  });

  it('업로드 전 로컬 미리보기는 null이다 — 헛된 서명 요청을 막는다', () => {
    expect(toThumbPath('blob:http://localhost:3001/9c8b-77')).toBeNull();
    expect(toThumbPath('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBeNull();
  });

  it('userId prefix가 없는 옛 형태와 빈 값은 null이다', () => {
    expect(toThumbPath('a.jpg')).toBeNull();
    expect(toThumbPath('legacy-folder/a.jpg')).toBeNull();
    expect(toThumbPath('')).toBeNull();
    expect(toThumbPath(null)).toBeNull();
    expect(toThumbPath(undefined)).toBeNull();
  });
});
