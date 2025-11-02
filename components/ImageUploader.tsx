
import React, { useState, useCallback } from 'react';
import { ImageRotator } from './ImageRotator';

interface ImageFile {
  file: File;
  previewUrl: string;
  id: string;
}

interface ImageUploaderProps {
  onImagesSelect: (files: File[]) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImagesSelect }) => {
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newImageFiles: ImageFile[] = [];
    
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const id = `${Date.now()}_${Math.random()}`;
        const reader = new FileReader();
        reader.onloadend = () => {
          const previewUrl = reader.result as string;
          const imageFile: ImageFile = { file, previewUrl, id };
          
          setImageFiles(prev => {
            const updated = [...prev, imageFile];
            // 부모 컴포넌트에 파일 목록 전달
            onImagesSelect(updated.map(img => img.file));
            return updated;
          });
        };
        reader.readAsDataURL(file);
      }
    });
  }, [onImagesSelect]);

  const handleRotate = useCallback((index: number, rotatedBlob: Blob) => {
    setImageFiles(prev => {
      const updated = [...prev];
      const imageFile = updated[index];
      
      if (!imageFile) return prev;
      
      // Blob을 File로 변환
      const rotatedFile = new File([rotatedBlob], imageFile.file.name, {
        type: rotatedBlob.type,
        lastModified: Date.now(),
      });
      
      // 미리보기 업데이트
      const reader = new FileReader();
      reader.onloadend = () => {
        const previewUrl = reader.result as string;
        updated[index] = { ...imageFile, file: rotatedFile, previewUrl };
        setImageFiles([...updated]);
        onImagesSelect(updated.map(img => img.file));
      };
      reader.readAsDataURL(rotatedBlob);
      
      return prev;
    });
  }, [onImagesSelect]);

  const handleRemove = useCallback((index: number) => {
    setImageFiles(prev => {
      const updated = prev.filter((_, i) => i !== index);
      onImagesSelect(updated.map(img => img.file));
      return updated;
    });
  }, [onImagesSelect]);

  const handleClearAll = useCallback(() => {
    setImageFiles([]);
    onImagesSelect([]);
  }, [onImagesSelect]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4 text-slate-700 dark:text-slate-300">1. 문제 이미지 업로드</h2>
      <div className="space-y-4">
        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center bg-slate-50/50 dark:bg-slate-900/30">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="mb-4"
          />
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            여러 이미지를 한번에 선택할 수 있습니다
          </p>
        </div>
        
        {imageFiles.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                선택된 이미지: {imageFiles.length}개
              </p>
              <button 
                onClick={handleClearAll}
                className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/70 transition-colors"
              >
                전체 삭제
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {imageFiles.map((imageFile, index) => (
                <div key={imageFile.id} className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 relative">
                  <button
                    onClick={() => handleRemove(index)}
                    className="absolute top-2 right-2 w-6 h-6 bg-red-500 dark:bg-red-600 text-white rounded-full flex items-center justify-center hover:bg-red-600 dark:hover:bg-red-700 z-10 transition-colors"
                    title="삭제"
                  >
                    ×
                  </button>
                  <div className="max-h-[400px] overflow-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 flex items-center justify-center p-4">
                    <ImageRotator
                      imageUrl={imageFile.previewUrl}
                      onRotate={(blob) => handleRotate(index, blob)}
                      className="max-w-full max-h-[400px] object-contain"
                    />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
                    {imageFile.file.name}
                  </p>
                </div>
              ))}
            </div>
            
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
              회전 버튼을 사용하여 각 이미지 방향을 조정할 수 있습니다
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
