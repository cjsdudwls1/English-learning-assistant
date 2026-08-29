-- 단원 정보 테이블 생성
CREATE TABLE unit_info (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES subject_info(id) ON DELETE CASCADE,
    major_category VARCHAR(100),
    medium_category VARCHAR(100),
    minor_category VARCHAR(100),
    area VARCHAR(100),
    core_concept TEXT,
    problem_info TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_unit_info_subject_id ON unit_info(subject_id);
CREATE INDEX idx_unit_info_major_category ON unit_info(major_category);
CREATE INDEX idx_unit_info_medium_category ON unit_info(medium_category);
CREATE INDEX idx_unit_info_minor_category ON unit_info(minor_category);
CREATE INDEX idx_unit_info_area ON unit_info(area);

-- 업데이트 트리거 생성
CREATE TRIGGER update_unit_info_updated_at 
    BEFORE UPDATE ON unit_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
