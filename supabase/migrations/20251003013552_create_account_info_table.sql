-- 계정 정보 테이블 생성
CREATE TABLE account_info (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_account_info_username ON account_info(username);

-- 업데이트 트리거 생성
CREATE TRIGGER update_account_info_updated_at 
    BEFORE UPDATE ON account_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
