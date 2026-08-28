import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// getSession만 쓴다. 토큰 값 자체는 검사 대상이 아니고, Authorization 헤더가 붙는지만 본다.
vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { startAgentRun, AgentRequestError } from './agentRuns';

const GCF = 'https://gcf.example/analyze';

/** 상태코드 + 본문으로 Response 흉내. text()만 쓰이므로 그것만 채운다. */
const resp = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(body),
});

const run = () => startAgentRun({
  runId: '00000000-0000-4000-8000-000000000001',
  agentType: 'consultant',
  input: { language: 'ko' },
  language: 'ko',
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('VITE_ANALYZE_GCF_URL', GCF);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ── definitive 분기 ─────────────────────────────────────────────────────
 * 이 플래그가 폴백 전체를 결정한다. useAgentRun은 definitive면 즉시 reject하고,
 * useConsulting은 그 reject를 받아 단발 Edge Function으로 떨어진다.
 * 반대로 definitive=false면 실패로 확정하지 않고 폴링에 판단을 맡긴다 —
 * 서버가 아직 돌고 있을 수 있고, 거기서 버리면 **이미 과금된 결과를 버리는 것**이다.
 * 서버측 킬 스위치(AGENT_DISABLED)의 계약이 성립하는 지점도 정확히 여기다:
 * 서버 테스트(cloud-functions/.../agentBudget.test.mjs)는 503을 내보내는 데까지만 보장하고,
 * 그 503이 폴백으로 이어지는지는 여기서만 고정된다. */

describe('startAgentRun의 실패 분류', () => {
  it('503(킬 스위치) 은 확정 실패다 — 폴백이 여기서 걸린다', async () => {
    // 서버는 agentDisabled:true도 같이 보내지만 클라이언트는 그 필드를 안 본다.
    // 폴백을 여는 건 **상태코드**다. 그래서 서버가 플래그 이름을 바꿔도 폴백은 안 깨진다.
    fetchMock.mockResolvedValue(resp(503, JSON.stringify({
      error: '에이전트가 비활성화되어 있습니다: consultant',
      agentDisabled: true,
    })));

    await expect(run()).rejects.toMatchObject({
      definitive: true,
      message: '에이전트가 비활성화되어 있습니다: consultant',
    });
  });

  it('409(같은 런이 이미 도는 중) 만 확정이 아니다', async () => {
    // 새로 시작할 건 없지만 그 런은 살아있다. 여기서 실패로 확정하면 곧 도착할 결과를 버린다.
    fetchMock.mockResolvedValue(resp(409, JSON.stringify({ error: '이미 진행 중인 실행입니다' })));

    await expect(run()).rejects.toMatchObject({ definitive: false });
  });

  it('fetch 자체가 끊기면 확정이 아니다 — 서버는 계속 돌 수 있다', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));

    await expect(run()).rejects.toMatchObject({ definitive: false, message: 'network error' });
  });

  it('409 외의 4xx/5xx는 전부 확정 실패다', async () => {
    for (const status of [400, 401, 403, 500, 504]) {
      fetchMock.mockResolvedValue(resp(status, JSON.stringify({ error: `e${status}` })));
      await expect(run(), `HTTP ${status}`).rejects.toMatchObject({ definitive: true });
    }
  });

  it('본문이 JSON이 아니어도(프록시 HTML 등) 상태코드로 판정한다', async () => {
    // 502를 게이트웨이가 HTML로 돌려주는 경우. 파싱 실패로 판정이 흔들리면 안 된다.
    fetchMock.mockResolvedValue(resp(502, '<html>Bad Gateway</html>'));

    await expect(run()).rejects.toMatchObject({ definitive: true, message: '<html>Bad Gateway</html>' });
  });

  it('URL 미설정은 확정 실패다 — 재시도해도 안 고쳐진다', async () => {
    vi.stubEnv('VITE_ANALYZE_GCF_URL', '');

    await expect(run()).rejects.toMatchObject({ definitive: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('startAgentRun이 보내는 요청', () => {
  it('runId·agentType·input과 Authorization을 싣는다', async () => {
    fetchMock.mockResolvedValue(resp(200, '{}'));

    await expect(run()).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GCF);
    expect(init.headers.Authorization).toBe('Bearer tok');
    // runId를 서버가 아니라 **프론트가** 만들어 보낸다. 그래야 응답을 기다리는 동안에도
    // 그 id로 agent_steps를 구독해 진행 상황을 볼 수 있다.
    expect(JSON.parse(init.body)).toEqual({
      mode: 'agent',
      runId: '00000000-0000-4000-8000-000000000001',
      agentType: 'consultant',
      input: { language: 'ko' },
    });
  });
});

describe('AgentRequestError', () => {
  it('Error를 상속해 instanceof로 걸러진다', async () => {
    // useAgentRun이 `e instanceof AgentRequestError`로 분기하므로 이게 깨지면
    // 모든 실패가 definitive=true로 취급돼 네트워크 단절에도 폴백이 돈다.
    expect.assertions(2);
    fetchMock.mockRejectedValue(new Error('boom'));

    await run().catch((e) => {
      expect(e).toBeInstanceOf(AgentRequestError);
      expect(e).toBeInstanceOf(Error);
    });
  });
});
