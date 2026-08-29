-- 가족 정보 테이블 생성
CREATE TABLE family_info (
    id SERIAL PRIMARY KEY,
    father_id INTEGER REFERENCES person_info(id) ON DELETE SET NULL,
    mother_id INTEGER REFERENCES person_info(id) ON DELETE SET NULL,
    child_id INTEGER REFERENCES person_info(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX idx_family_info_father_id ON family_info(father_id);
CREATE INDEX idx_family_info_mother_id ON family_info(mother_id);
CREATE INDEX idx_family_info_child_id ON family_info(child_id);

-- 업데이트 트리거 생성
CREATE TRIGGER update_family_info_updated_at 
    BEFORE UPDATE ON family_info 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();;
