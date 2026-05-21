-- GCF analyze-image 마무리 단계의 25P02 cascade 근본 차단 + idempotency 보장
-- N개 problem.metadata UPDATE + sessions.status='completed' 를 단일 PL/pgSQL 트랜잭션으로 atomic 처리.
-- 중복 호출 시: sessions가 이미 completed/failed/labeled 라면 no-op 반환 (problem_metadata 덮어쓰기 차단).
-- 잘못된 problem.id 입력 시: session_id 가드로 타 세션 problem 덮어쓰기 차단.

CREATE OR REPLACE FUNCTION public.finalize_analysis_session(
  p_session_id uuid,
  p_analysis_model text,
  p_problem_updates jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_problems_updated int := 0;
  v_session_updated int := 0;
  v_current_status text;
BEGIN
  -- 0) 진입 가드: sessions row를 FOR UPDATE로 락 → 동시 finalize 호출 직렬화
  SELECT status INTO v_current_status
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'problems_updated', 0,
      'session_completed', false,
      'reason', 'session_not_found'
    );
  END IF;

  -- 이미 종결된 세션(completed/failed/labeled 등)은 problem_metadata 덮어쓰기 차단
  IF v_current_status <> 'processing' THEN
    RETURN jsonb_build_object(
      'problems_updated', 0,
      'session_completed', false,
      'reason', 'already_finalized',
      'current_status', v_current_status
    );
  END IF;

  -- 1) bulk UPDATE: session_id 가드로 잘못된 problem 업데이트 차단
  WITH src AS (
    SELECT (e->>'id')::uuid AS id,
           e->'metadata' AS metadata
    FROM jsonb_array_elements(p_problem_updates) e
    WHERE e ? 'id' AND e ? 'metadata'
  )
  UPDATE public.problems p
  SET problem_metadata = src.metadata
  FROM src
  WHERE p.id = src.id
    AND p.session_id = p_session_id;
  GET DIAGNOSTICS v_problems_updated = ROW_COUNT;

  -- 2) sessions 상태 업데이트 (이미 락 보유, 별도 가드 불필요)
  UPDATE public.sessions
  SET status = 'completed',
      analysis_model = p_analysis_model,
      models_used = jsonb_build_object('ocr', 'none (direct multimodal)', 'analysis', p_analysis_model)
  WHERE id = p_session_id;
  GET DIAGNOSTICS v_session_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'problems_updated', v_problems_updated,
    'session_completed', v_session_updated > 0
  );
END $$;

-- service_role 및 authenticated 호출 가능 (GCF는 service_role 키 사용)
REVOKE ALL ON FUNCTION public.finalize_analysis_session(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_analysis_session(uuid, text, jsonb) TO service_role, authenticated;
