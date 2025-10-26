import React, { useState, useRef } from 'react';

interface ImageRotatorProps {
  imageUrl: string;
  onRotate: (rotatedBlob: Blob) => void;
  className?: string;
}

export const ImageRotator: React.FC<ImageRotatorProps> = ({ 
  imageUrl, 
  onRotate, 
  className = '' 
}) => {
  const [rotation, setRotation] = useState(0);
  const [isRotating, setIsRotating] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const rotateImage = async (degrees: number) => {
    // 중복 클릭 방지
    if (isRotating) return;
    
    setIsRotating(true);

    // 정규화된 회전 각도 계산 (0, 90, 180, 270도만 허용)
    const newRotation = ((rotation + degrees) % 360 + 360) % 360;
    setRotation(newRotation);

    // 회전 완료 후 상태 해제
    setTimeout(() => {
      setIsRotating(false);
      // onRotate는 각도만 전달 (서버에서 처리)
      onRotate(newRotation as unknown as Blob);
    }, 100);
  };

  const handleRotateLeft = () => {
    rotateImage(-90);
  };

  const handleRotateRight = () => {
    rotateImage(90);
  };

  return (
    <div className={`relative ${className}`}>
      <img
        ref={imgRef}
        src={imageUrl}
        alt="회전할 이미지"
        className="w-full h-auto"
        style={{ transform: `rotate(${rotation}deg)` }}

      />
      
      <div className="absolute top-2 right-2 flex gap-2">
        <button
          onClick={handleRotateLeft}
          disabled={isRotating}
          className={`px-3 py-1 bg-white bg-opacity-80 text-slate-700 rounded text-sm shadow-md ${
            isRotating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-opacity-100'
          }`}
          title="좌회전"
        >
          ↶
        </button>
        <button
          onClick={handleRotateRight}
          disabled={isRotating}
          className={`px-3 py-1 bg-white bg-opacity-80 text-slate-700 rounded text-sm shadow-md ${
            isRotating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-opacity-100'
          }`}
          title="우회전"
        >
          ↷
        </button>
      </div>
    </div>
  );
};
