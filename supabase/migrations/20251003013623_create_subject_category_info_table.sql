-- 교과 정보 테이블 생성
CREATE TABLE subject_category_info (
    id SERIAL PRIMARY KEY,
    curriculum_id INTEGER NOT NULL REFERENCES curriculum_info(id) ON DELETE CASCADE,
    grade INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_subject_category_info_curriculum_id ON subject_category_info(curriculum_id);
CREATE INDEX idx_subject_category_info_grade ON subject_category_info(grade);

-- 업데이트 트리거 생성
CREATE TRIGGER update_subject_category_info_updated_at 
    BEFORE UPDATE ON subject_category_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
