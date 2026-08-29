-- 권한 정보 테이블 생성
CREATE TABLE permission_info (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES account_info(id) ON DELETE CASCADE,
    is_super_admin BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    is_group_admin BOOLEAN DEFAULT FALSE,
    is_organization_leader BOOLEAN DEFAULT FALSE,
    is_teacher BOOLEAN DEFAULT FALSE,
    is_learner BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_permission_info_account_id ON permission_info(account_id);
CREATE INDEX idx_permission_info_super_admin ON permission_info(is_super_admin);
CREATE INDEX idx_permission_info_admin ON permission_info(is_admin);
CREATE INDEX idx_permission_info_teacher ON permission_info(is_teacher);
CREATE INDEX idx_permission_info_learner ON permission_info(is_learner);

-- 업데이트 트리거 생성
CREATE TRIGGER update_permission_info_updated_at 
    BEFORE UPDATE ON permission_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
