-- sessions 테이블을 Supabase Realtime publication에 추가
-- Realtime을 통해 sessions 테이블의 변경사항을 실시간으로 감지할 수 있도록 설정

-- 먼저 publication이 존재하는지 확인하고, 없으면 생성
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- sessions 테이블을 publication에 추가
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;

-- 확인: publication에 추가된 테이블 목록 조회
SELECT 
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname, tablename;;
