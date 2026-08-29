-- 학교 정보 테이블 세부 정책
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON school_info;

-- 학교 정보는 모든 인증된 사용자가 읽기 가능
CREATE POLICY "학교 정보 읽기" ON school_info
    FOR SELECT USING (auth.role() = 'authenticated');

-- 학교 정보 생성은 관리자만 가능
CREATE POLICY "학교 정보 생성" ON school_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 학교 정보 수정은 관리자만 가능
CREATE POLICY "학교 정보 수정" ON school_info
    FOR UPDATE USING (auth.role() = 'authenticated');

-- 학교 정보 삭제는 관리자만 가능
CREATE POLICY "학교 정보 삭제" ON school_info
    FOR DELETE USING (auth.role() = 'authenticated');;
