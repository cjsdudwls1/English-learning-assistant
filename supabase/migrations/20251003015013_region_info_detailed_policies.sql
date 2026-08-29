-- 지역 정보 테이블 세부 정책
-- 기본 정책 삭제 후 세부 정책 생성
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON region_info;

-- 지역 정보는 모든 인증된 사용자가 읽기 가능
CREATE POLICY "지역 정보 읽기" ON region_info
    FOR SELECT USING (auth.role() = 'authenticated');

-- 지역 정보는 관리자만 수정 가능 (추후 권한 시스템과 연동)
CREATE POLICY "지역 정보 수정" ON region_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "지역 정보 업데이트" ON region_info
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "지역 정보 삭제" ON region_info
    FOR DELETE USING (auth.role() = 'authenticated');;
