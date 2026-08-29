-- 교육과정 정보 테이블 생성
CREATE TABLE curriculum_info (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES region_info(id) ON DELETE CASCADE,
    curriculum_year INTEGER NOT NULL,
    curriculum_session INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_curriculum_info_region_id ON curriculum_info(region_id);
CREATE INDEX idx_curriculum_info_year ON curriculum_info(curriculum_year);
CREATE INDEX idx_curriculum_info_session ON curriculum_info(curriculum_session);

-- 업데이트 트리거 생성
CREATE TRIGGER update_curriculum_info_updated_at 
    BEFORE UPDATE ON curriculum_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
