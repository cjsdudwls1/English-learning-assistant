-- 인명 정보 테이블 생성
CREATE TABLE person_info (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES region_info(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    birth_date DATE,
    gender VARCHAR(10) CHECK (gender IN ('남', '여', '기타')),
    contact VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_person_info_region_id ON person_info(region_id);
CREATE INDEX idx_person_info_name ON person_info(name);
CREATE INDEX idx_person_info_birth_date ON person_info(birth_date);

-- 업데이트 트리거 생성
CREATE TRIGGER update_person_info_updated_at 
    BEFORE UPDATE ON person_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
