
import React, { useState, useCallback, useRef } from 'react';
import { ImageRotator } from './ImageRotator';

interface ImageUploaderProps {
  onImageSelect: (file: File) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelect }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setCurrentFile(file);
      onImageSelect(file); // 즉시 호출하여 업로드 버튼 활성화
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, [onImageSelect]);

  const handleRotate = useCallback((rotatedBlob: Blob) => {
    if (!currentFile) return;
    
    // Blob을 File로 변환
    const rotatedFile = new File([rotatedBlob], currentFile.name, {
      type: rotatedBlob.type,
      lastModified: Date.now(),
    });
    
    setCurrentFile(rotatedFile);
    onImageSelect(rotatedFile);
    
    // 미리보기 업데이트
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(rotatedBlob);
  }, [currentFile, onImageSelect]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4 text-slate-700">1. 문제 이미지 업로드</h2>
      <div className="space-y-4">
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="mb-4"
          />
        </div>
        {previewUrl && (
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="max-h-96 overflow-hidden rounded-md border">
              <ImageRotator
                imageUrl={previewUrl}
                onRotate={handleRotate}
                className="w-full h-auto object-contain max-h-96"
              />
            </div>
            <p className="text-sm text-slate-500 mt-2 text-center">
              회전 버튼을 사용하여 이미지 방향을 조정할 수 있습니다
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
