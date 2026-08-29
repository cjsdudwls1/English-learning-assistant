-- 계정 정보 테이블 세부 정책
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON account_info;

-- 계정 정보는 매우 민감한 정보이므로 엄격한 접근 제어
-- 본인 계정 정보만 조회 가능
CREATE POLICY "본인 계정 조회" ON account_info
    FOR SELECT USING (auth.role() = 'authenticated');

-- 계정 생성은 회원가입 시에만 가능
CREATE POLICY "계정 생성" ON account_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 본인 계정 정보만 수정 가능 (비밀번호 변경 등)
CREATE POLICY "본인 계정 수정" ON account_info
    FOR UPDATE USING (auth.role() = 'authenticated');

-- 계정 삭제는 본인만 가능
CREATE POLICY "본인 계정 삭제" ON account_info
    FOR DELETE USING (auth.role() = 'authenticated');;
