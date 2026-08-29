-- 교육과정 관련 테이블 세부 정책

-- 교육과정 정보
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON curriculum_info;
CREATE POLICY "교육과정 정보 읽기" ON curriculum_info
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "교육과정 정보 생성" ON curriculum_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "교육과정 정보 수정" ON curriculum_info
    FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "교육과정 정보 삭제" ON curriculum_info
    FOR DELETE USING (auth.role() = 'authenticated');

-- 교과 정보
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON subject_category_info;
CREATE POLICY "교과 정보 읽기" ON subject_category_info
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "교과 정보 생성" ON subject_category_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "교과 정보 수정" ON subject_category_info
    FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "교과 정보 삭제" ON subject_category_info
    FOR DELETE USING (auth.role() = 'authenticated');

-- 과목 정보
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON subject_info;
CREATE POLICY "과목 정보 읽기" ON subject_info
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "과목 정보 생성" ON subject_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "과목 정보 수정" ON subject_info
    FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "과목 정보 삭제" ON subject_info
    FOR DELETE USING (auth.role() = 'authenticated');

-- 학년 정보
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON grade_info;
CREATE POLICY "학년 정보 읽기" ON grade_info
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "학년 정보 생성" ON grade_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "학년 정보 수정" ON grade_info
    FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "학년 정보 삭제" ON grade_info
    FOR DELETE USING (auth.role() = 'authenticated');

-- 단원 정보
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON unit_info;
CREATE POLICY "단원 정보 읽기" ON unit_info
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "단원 정보 생성" ON unit_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "단원 정보 수정" ON unit_info
    FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "단원 정보 삭제" ON unit_info
    FOR DELETE USING (auth.role() = 'authenticated');

-- 사교육 정보
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON private_education_info;
CREATE POLICY "사교육 정보 읽기" ON private_education_info
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "사교육 정보 생성" ON private_education_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "사교육 정보 수정" ON private_education_info
    FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "사교육 정보 삭제" ON private_education_info
    FOR DELETE USING (auth.role() = 'authenticated');

-- 가족 정보
DROP POLICY IF EXISTS "인증된 사용자만 접근 가능" ON family_info;
CREATE POLICY "가족 정보 읽기" ON family_info
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "가족 정보 생성" ON family_info
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "가족 정보 수정" ON family_info
    FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "가족 정보 삭제" ON family_info
    FOR DELETE USING (auth.role() = 'authenticated');;
