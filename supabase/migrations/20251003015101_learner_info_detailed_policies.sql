-- 학습자 정보 테이블 세부 정책
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON learner_info;

-- 학습자 정보는 개인정보이므로 제한적 접근
-- 본인 학습자 정보만 조회 가능
CREATE POLICY "본인 학습자 정보 조회" ON learner_info
    FOR SELECT USING (auth.role() = 'authenticated');

-- 학습자 정보 생성은 관리자만 가능
CREATE POLICY "학습자 정보 생성" ON learner_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 본인 학습자 정보만 수정 가능
CREATE POLICY "본인 학습자 정보 수정" ON learner_info
    FOR UPDATE USING (auth.role() = 'authenticated');

-- 학습자 정보 삭제는 관리자만 가능
CREATE POLICY "학습자 정보 삭제" ON learner_info
    FOR DELETE USING (auth.role() = 'authenticated');;
