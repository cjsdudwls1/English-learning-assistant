-- 지역 정보 테이블 생성
CREATE TABLE region_info (
    id SERIAL PRIMARY KEY,
    country VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_region_info_country ON region_info(country);
CREATE INDEX idx_region_info_region ON region_info(region);

-- 업데이트 시간 자동 갱신을 위한 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 업데이트 트리거 생성
CREATE TRIGGER update_region_info_updated_at 
    BEFORE UPDATE ON region_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
