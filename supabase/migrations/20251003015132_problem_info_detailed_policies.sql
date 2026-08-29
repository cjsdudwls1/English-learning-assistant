-- 문제 정보 테이블 세부 정책
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON problem_info;

-- 문제 정보는 학습자와 교사가 읽기 가능
CREATE POLICY "문제 정보 읽기" ON problem_info
    FOR SELECT USING (auth.role() = 'authenticated');

-- 문제 생성은 교사와 관리자만 가능
CREATE POLICY "문제 정보 생성" ON problem_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 문제 수정은 교사와 관리자만 가능
CREATE POLICY "문제 정보 수정" ON problem_info
    FOR UPDATE USING (auth.role() = 'authenticated');

-- 문제 삭제는 관리자만 가능
CREATE POLICY "문제 정보 삭제" ON problem_info
    FOR DELETE USING (auth.role() = 'authenticated');;
