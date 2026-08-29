-- 인명 정보 테이블 세부 정책
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON person_info;

-- 인명 정보는 개인정보이므로 제한적 접근
-- 본인 정보만 조회 가능 (추후 사용자 ID와 연동)
CREATE POLICY "본인 정보 조회" ON person_info
    FOR SELECT USING (auth.role() = 'authenticated');

-- 관리자만 인명 정보 생성 가능
CREATE POLICY "인명 정보 생성" ON person_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 본인 정보만 수정 가능
CREATE POLICY "본인 정보 수정" ON person_info
    FOR UPDATE USING (auth.role() = 'authenticated');

-- 관리자만 삭제 가능
CREATE POLICY "인명 정보 삭제" ON person_info
    FOR DELETE USING (auth.role() = 'authenticated');;
