/**
 * agent_runs / agent_steps 기록
 *
 * 두 가지 역할이 겹쳐 있다:
 *   - 감사 로그(무슨 도구를 왜 썼나, 토큰 얼마 썼나)
 *   - **실시간 진행 채널** — 프론트가 agent_steps INSERT를 Realtime으로 구독한다.
 *     즉 appendStep은 "로그 쓰기"가 아니라 "UI 갱신"이다. 스텝 하나 끝날 때마다 즉시 써야 한다.
 *
 * 실패 정책: createRun만 throw한다(runId 없이는 프론트가 구독할 대상이 없으므로 요청 자체가 실패).
 * appendStep/finishRun은 절대 throw하지 않는다 — 기록이 실패했다고 이미 정상인 추론을 죽일 이유가 없다.
 *
 * 쓰기는 service-role 클라이언트로만 한다. agent_runs/agent_steps에는 INSERT 정책이 없어서
 * 사용자 토큰으로는 애초에 쓸 수 없다(위조 경로 차단).
 */

// jsonb 한 칸이 무한정 커지면 Realtime 페이로드와 DB가 같이 상한다.
// 관측은 모델에 되먹인 뒤라 여기선 "사람이 보는 요약"이면 충분하다.
const MAX_JSON_CHARS = 4000;
const MAX_THOUGHT_CHARS = 1500;

function truncateJson(value) {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    if (text.length <= MAX_JSON_CHARS) return value;
    return { _truncated: true, _originalChars: text.length, preview: text.slice(0, MAX_JSON_CHARS) };
  } catch {
    return { _unserializable: true, preview: String(value).slice(0, 500) };
  }
}

/**
 * 실행 레코드를 만든다.
 *
 * id는 **프론트가 만들어 보낸다**. 루프가 응답을 끝까지 붙잡고 있어도(=fire-and-forget이 아니어도)
 * 프론트가 POST 전에 그 id로 agent_steps를 미리 구독할 수 있어야 하기 때문이다.
 * 서버가 id를 정하면 구독은 응답이 끝난 뒤에나 가능해져 트레이스가 통째로 사라진다.
 *
 * 같은 id로 두 번 오면(중복 POST·재시도) unique 위반이라 여기서 걸린다 — 그대로 멱등성 가드다.
 */
export async function createRun(supabase, { id, userId, agentType, input }) {
  const row = { user_id: userId, agent_type: agentType, status: 'running', input: truncateJson(input) };
  if (id) row.id = id;

  const { data, error } = await supabase.from('agent_runs').insert(row).select('id').single();

  if (error) {
    const e = new Error(`agent_runs 생성 실패: ${String(error.message ?? error).slice(0, 200)}`);
    e.duplicate = error.code === '23505';
    throw e;
  }
  return data.id;
}

export async function appendStep(supabase, runId, { seq, thought, tool, args, observation, ok = true }) {
  try {
    const { error } = await supabase.from('agent_steps').insert({
      run_id: runId,
      seq,
      thought: thought ? String(thought).slice(0, MAX_THOUGHT_CHARS) : null,
      tool: tool ?? null,
      args: truncateJson(args),
      observation: truncateJson(observation),
      ok,
    });
    if (error) console.error('[agent:trace] 스텝 기록 실패(무시):', { runId, seq, error: String(error.message ?? error).slice(0, 200) });
  } catch (e) {
    console.error('[agent:trace] 스텝 기록 예외(무시):', { runId, seq, message: e?.message });
  }
}

export async function finishRun(supabase, runId, { status, stopReason, result, error, totalTokens, modelCalls }) {
  try {
    const { error: dbError } = await supabase
      .from('agent_runs')
      .update({
        status,
        stop_reason: stopReason ?? null,
        result: truncateJson(result),
        error: error ? String(error).slice(0, 1000) : null,
        total_tokens: totalTokens ?? 0,
        model_calls: modelCalls ?? 0,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (dbError) console.error('[agent:trace] 런 종료 기록 실패(무시):', { runId, error: String(dbError.message ?? dbError).slice(0, 200) });
  } catch (e) {
    console.error('[agent:trace] 런 종료 기록 예외(무시):', { runId, message: e?.message });
  }
}
