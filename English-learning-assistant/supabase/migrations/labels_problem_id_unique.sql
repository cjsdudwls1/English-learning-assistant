-- labels.problem_id UNIQUE 제약 — "문제당 라벨 1행" 전제를 스키마로 고정
--
-- 배경: 통계 집계(src/services/stats.ts)는 문제당 라벨 1행을 전제로 labels를
-- 전량 조회해 합산한다. 현재 이 전제는 코드 관례로만 지켜진다:
--   - insert: cloud-functions/analyze-image/shared/dbOperations.js saveLabels
--     (세션 분석 완료 시 1회)뿐
--   - 프론트엔드(services/db/labels.ts, problems.ts, reports.ts)는 update만 수행
-- 재분석·재시도 등으로 중복 insert가 생기면 통계가 조용히 이중 집계되므로
-- DB 제약으로 원천 차단한다.
--
-- 적용 전 중복 현황 확인(있어도 아래 DELETE가 정리함):
--   SELECT problem_id, count(*) FROM public.labels
--   GROUP BY problem_id HAVING count(*) > 1;
--
-- 적용: python supabase/migrations/_apply.py labels_problem_id_unique.sql
--       (SUPABASE_PAT 환경변수 필요 — Management API 경유)

BEGIN;

-- 혹시 존재할 중복 정리 — 같은 problem_id 중 나중에 삽입된 행(ctid 큰 쪽)을 남긴다.
-- labels에는 created_at 컬럼이 없어 물리 위치(ctid)로 삽입 순서를 근사한다.
DELETE FROM public.labels a
USING public.labels b
WHERE a.problem_id = b.problem_id
  AND a.ctid < b.ctid;

-- 재실행 안전(idempotent): 제약이 이미 있으면 건너뛴다
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'labels_problem_id_key'
  ) THEN
    ALTER TABLE public.labels
      ADD CONSTRAINT labels_problem_id_key UNIQUE (problem_id);
  END IF;
END $$;

COMMIT;
