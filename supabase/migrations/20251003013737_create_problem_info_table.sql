-- 문제 정보 테이블 생성
CREATE TABLE problem_info (
    id SERIAL PRIMARY KEY,
    curriculum_id INTEGER NOT NULL REFERENCES curriculum_info(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subject_info(id) ON DELETE CASCADE,
    unit_id INTEGER NOT NULL REFERENCES unit_info(id) ON DELETE CASCADE,
    problem_text TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    difficulty_level INTEGER CHECK (difficulty_level >= 1 AND difficulty_level <= 5),
    correct_answer TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_problem_info_curriculum_id ON problem_info(curriculum_id);
CREATE INDEX idx_problem_info_subject_id ON problem_info(subject_id);
CREATE INDEX idx_problem_info_unit_id ON problem_info(unit_id);
CREATE INDEX idx_problem_info_difficulty_level ON problem_info(difficulty_level);
CREATE INDEX idx_problem_info_score ON problem_info(score);

-- 업데이트 트리거 생성
CREATE TRIGGER update_problem_info_updated_at 
    BEFORE UPDATE ON problem_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
