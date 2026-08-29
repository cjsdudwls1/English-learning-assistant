-- 모든 테이블에 RLS 활성화
ALTER TABLE region_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_category_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_education_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE problem_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_info ENABLE ROW LEVEL SECURITY;

-- 기본 정책: 인증된 사용자만 접근 가능
CREATE POLICY "인증된 사용자만 접근 가능" ON region_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON person_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON family_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON account_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON permission_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON curriculum_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON subject_category_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON subject_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON school_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON grade_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON private_education_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON unit_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON problem_info
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "인증된 사용자만 접근 가능" ON learner_info
    FOR ALL USING (auth.role() = 'authenticated');;
