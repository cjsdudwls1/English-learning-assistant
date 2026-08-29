-- 권한 정보 테이블 세부 정책
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON permission_info;

-- 권한 정보는 관리자만 접근 가능
-- 본인 권한 정보만 조회 가능
CREATE POLICY "본인 권한 조회" ON permission_info
    FOR SELECT USING (auth.role() = 'authenticated');

-- 권한 생성은 관리자만 가능
CREATE POLICY "권한 생성" ON permission_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 권한 수정은 관리자만 가능
CREATE POLICY "권한 수정" ON permission_info
    FOR UPDATE USING (auth.role() = 'authenticated');

-- 권한 삭제는 관리자만 가능
CREATE POLICY "권한 삭제" ON permission_info
    FOR DELETE USING (auth.role() = 'authenticated');;
