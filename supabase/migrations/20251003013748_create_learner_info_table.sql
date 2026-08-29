-- 학습자 정보 테이블 생성
CREATE TABLE learner_info (
    id SERIAL PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES person_info(id) ON DELETE CASCADE,
    school_id INTEGER NOT NULL REFERENCES school_info(id) ON DELETE CASCADE,
    grade_id INTEGER NOT NULL REFERENCES grade_info(id) ON DELETE CASCADE,
    curriculum_id INTEGER NOT NULL REFERENCES curriculum_info(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES account_info(id) ON DELETE CASCADE,
    problem_id INTEGER REFERENCES problem_info(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_learner_info_person_id ON learner_info(person_id);
CREATE INDEX idx_learner_info_school_id ON learner_info(school_id);
CREATE INDEX idx_learner_info_grade_id ON learner_info(grade_id);
CREATE INDEX idx_learner_info_curriculum_id ON learner_info(curriculum_id);
CREATE INDEX idx_learner_info_account_id ON learner_info(account_id);
CREATE INDEX idx_learner_info_problem_id ON learner_info(problem_id);

-- 업데이트 트리거 생성
CREATE TRIGGER update_learner_info_updated_at 
    BEFORE UPDATE ON learner_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
