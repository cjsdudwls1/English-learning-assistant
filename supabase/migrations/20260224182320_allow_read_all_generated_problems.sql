
-- 기존 SELECT 정책 삭제
DROP POLICY IF EXISTS "Users can view their own generated problems" ON public.generated_problems;

-- 새 SELECT 정책: 모든 인증된 사용자가 문제를 읽을 수 있음 (기존 문제 공유 풀)
CREATE POLICY "Authenticated users can view all generated problems" 
ON public.generated_problems 
FOR SELECT 
TO authenticated
USING (true);
;
