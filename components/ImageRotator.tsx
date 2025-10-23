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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const rotateImage = (degrees: number) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 정규화된 회전 각도 계산 (0, 90, 180, 270도만 허용)
    const newRotation = ((rotation + degrees) % 360 + 360) % 360;
    setRotation(newRotation);

    // Canvas 크기 설정 - 90도/270도일 때만 가로세로 교체
    const isRotated90or270 = newRotation === 90 || newRotation === 270;
    canvas.width = isRotated90or270 ? img.naturalHeight : img.naturalWidth;
    canvas.height = isRotated90or270 ? img.naturalWidth : img.naturalHeight;

    // Canvas 초기화
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 회전 변환 적용 - 원본 이미지를 newRotation 각도로 회전
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((newRotation * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    // Blob으로 변환
    canvas.toBlob((blob) => {
      if (blob) {
        onRotate(blob);
      }
    }, 'image/jpeg', 0.9);
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
        onLoad={() => {
          // 이미지 로드 후 초기 Canvas 설정
          const canvas = canvasRef.current;
          const img = imgRef.current;
          if (canvas && img) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
          }
        }}
      />
      
      <div className="absolute top-2 right-2 flex gap-2">
        <button
          onClick={handleRotateLeft}
          className="px-3 py-1 bg-white bg-opacity-80 text-slate-700 rounded text-sm hover:bg-opacity-100 shadow-md"
          title="좌회전"
        >
          ↶
        </button>
        <button
          onClick={handleRotateRight}
          className="px-3 py-1 bg-white bg-opacity-80 text-slate-700 rounded text-sm hover:bg-opacity-100 shadow-md"
          title="우회전"
        >
          ↷
        </button>
      </div>
      
      {/* 숨겨진 Canvas */}
      <canvas
        ref={canvasRef}
        style={{ display: 'none' }}
      />
    </div>
  );
};
