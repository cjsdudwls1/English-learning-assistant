-- 과목 정보 테이블 생성
CREATE TABLE subject_info (
    id SERIAL PRIMARY KEY,
    subject_category_id INTEGER NOT NULL REFERENCES subject_category_info(id) ON DELETE CASCADE,
    grade INTEGER NOT NULL,
    subject_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_subject_info_subject_category_id ON subject_info(subject_category_id);
CREATE INDEX idx_subject_info_grade ON subject_info(grade);
CREATE INDEX idx_subject_info_subject_name ON subject_info(subject_name);

-- 업데이트 트리거 생성
CREATE TRIGGER update_subject_info_updated_at 
    BEFORE UPDATE ON subject_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
