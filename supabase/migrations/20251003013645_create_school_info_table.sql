-- 학교 정보 테이블 생성
CREATE TABLE school_info (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES region_info(id) ON DELETE CASCADE,
    curriculum_id INTEGER NOT NULL REFERENCES curriculum_info(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subject_info(id) ON DELETE CASCADE,
    school_name VARCHAR(200) NOT NULL,
    class_count INTEGER DEFAULT 0,
    student_count INTEGER DEFAULT 0,
    contact VARCHAR(50),
    establishment_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_school_info_region_id ON school_info(region_id);
CREATE INDEX idx_school_info_curriculum_id ON school_info(curriculum_id);
CREATE INDEX idx_school_info_subject_id ON school_info(subject_id);
CREATE INDEX idx_school_info_school_name ON school_info(school_name);

-- 업데이트 트리거 생성
CREATE TRIGGER update_school_info_updated_at 
    BEFORE UPDATE ON school_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
