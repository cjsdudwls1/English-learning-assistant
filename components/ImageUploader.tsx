
import React, { useState, useCallback, useRef } from 'react';

interface ImageUploaderProps {
  onImageSelect: (file: File) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelect }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onImageSelect(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, [onImageSelect]);
  
  const handleAreaClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4 text-slate-700">1. 문제 이미지 업로드</h2>
      <div
        className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition-colors"
        onClick={handleAreaClick}
      >
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
          ref={fileInputRef}
        />
        {previewUrl ? (
          <img src={previewUrl} alt="문제 미리보기" className="max-h-80 mx-auto rounded-md shadow-md" />
        ) : (
          <div className="text-slate-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="mt-2 font-semibold">이곳을 클릭하거나 파일을 드래그하여 업로드하세요.</p>
            <p className="text-sm">PNG, JPG, WEBP 형식 지원</p>
          </div>
        )}
      </div>
    </div>
  );
};
