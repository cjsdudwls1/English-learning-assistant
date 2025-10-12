
import React, { useState, useCallback, useRef } from 'react';

interface ImageUploaderProps {
  onImageSelect: (file: File) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelect }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4 text-slate-700">1. 문제 이미지 업로드</h2>
      <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="mb-4"
        />
        {previewUrl && (
          <img src={previewUrl} alt="문제 미리보기" className="max-h-80 mx-auto rounded-md shadow-md mt-4" />
        )}
      </div>
    </div>
  );
};
