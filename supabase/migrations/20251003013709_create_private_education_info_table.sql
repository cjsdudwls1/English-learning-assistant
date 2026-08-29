-- 사교육 정보 테이블 생성
CREATE TABLE private_education_info (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES region_info(id) ON DELETE CASCADE,
    grade_id INTEGER NOT NULL REFERENCES grade_info(id) ON DELETE CASCADE,
    academy_name VARCHAR(200) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    teacher VARCHAR(100),
    location VARCHAR(200),
    evaluation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_private_education_info_region_id ON private_education_info(region_id);
CREATE INDEX idx_private_education_info_grade_id ON private_education_info(grade_id);
CREATE INDEX idx_private_education_info_academy_name ON private_education_info(academy_name);
CREATE INDEX idx_private_education_info_subject ON private_education_info(subject);

-- 업데이트 트리거 생성
CREATE TRIGGER update_private_education_info_updated_at 
    BEFORE UPDATE ON private_education_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
