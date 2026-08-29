-- 학년 정보 테이블 생성
CREATE TABLE grade_info (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES region_info(id) ON DELETE CASCADE,
    curriculum_id INTEGER NOT NULL REFERENCES curriculum_info(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subject_info(id) ON DELETE CASCADE,
    school_id INTEGER NOT NULL REFERENCES school_info(id) ON DELETE CASCADE,
    grade INTEGER NOT NULL,
    class_number INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_grade_info_region_id ON grade_info(region_id);
CREATE INDEX idx_grade_info_curriculum_id ON grade_info(curriculum_id);
CREATE INDEX idx_grade_info_subject_id ON grade_info(subject_id);
CREATE INDEX idx_grade_info_school_id ON grade_info(school_id);
CREATE INDEX idx_grade_info_grade ON grade_info(grade);
CREATE INDEX idx_grade_info_class_number ON grade_info(class_number);

-- 업데이트 트리거 생성
CREATE TRIGGER update_grade_info_updated_at 
    BEFORE UPDATE ON grade_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
