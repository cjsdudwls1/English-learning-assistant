
-- uploaded-images 버킷에 대한 public 읽기 정책
CREATE POLICY "uploaded_images_read_public"
ON storage.objects FOR SELECT
USING (bucket_id = 'uploaded-images');

-- uploaded-images 버킷에 대한 인증 사용자 업로드 정책
CREATE POLICY "uploaded_images_insert_authenticated"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'uploaded-images' AND auth.role() = 'authenticated');

-- uploaded-images 버킷에 대한 서비스 역할 업로드 정책 (Cloud Function용)
-- Note: service_role key를 사용하면 RLS를 완전히 우회하므로 별도 정책 불필요
;
