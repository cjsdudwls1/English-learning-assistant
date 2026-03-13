// imageUploader.ts — 이미지 Storage 업로드 모듈
// 이미지 리스트를 Supabase Storage에 업로드하고 public URL을 반환

// ─── 타입 정의 ─────────────────────────────────────────────

export interface UploadImagesParams {
  supabase: any;
  userId: string;
  imageList: Array<{ imageBase64: string; mimeType: string; fileName: string }>;
}

// ─── 메인 함수: 이미지 업로드 ──────────────────────────────

/**
 * 이미지 리스트를 Supabase Storage의 problem-images 버킷에 업로드한다.
 *
 * 경로 형식: {emailLocal}/{timestamp}_{index}_{safeName}
 *
 * @returns 업로드된 이미지들의 public URL 배열
 */
export async function uploadImages(params: UploadImagesParams): Promise<string[]> {
  const { supabase, userId, imageList } = params;

  console.log(`Step 1: Upload ${imageList.length} image(s) to storage...`);

  const timestamp = Date.now();
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const email = userData.user?.email || userId;
  const emailLocal = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');

  const imageUrls: string[] = [];

  for (let i = 0; i < imageList.length; i++) {
    const img = imageList[i];
    const safeName = img.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const path = `${emailLocal}/${timestamp}_${i}_${safeName}`;

    const buffer = new Uint8Array(atob(img.imageBase64).split('').map(c => c.charCodeAt(0)));
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('problem-images')
      .upload(path, buffer, {
        contentType: img.mimeType,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('problem-images').getPublicUrl(uploadData.path);
    imageUrls.push(urlData.publicUrl);
    console.log(`Step 1: Image ${i + 1}/${imageList.length} uploaded to`, urlData.publicUrl);
  }

  console.log(`Step 1 completed: ${imageList.length} image(s) uploaded, main image URL:`, imageUrls[0]);
  return imageUrls;
}
