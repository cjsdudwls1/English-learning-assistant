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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  const rotateImage = (degrees: number) => {
    // 즉시 연속 클릭 허용 (서버 업로드는 중첩 가능)
    
    const canvas = canvasRef.current;
    const img = imgRef.current;
    
    if (!canvas || !img) return;

    setIsRotating(true);
    // 안전 타이머: 예기치 못한 경우에도 버튼이 장시간 비활성화되지 않도록 보장
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setIsRotating(false);
    }, 3000);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setIsRotating(false);
      return;
    }

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

    // 즉시 미리보기 반영: 캔버스 데이터를 dataURL로 반영
    try {
      const preview = canvas.toDataURL('image/jpeg', 0.9);
      setLocalPreviewUrl(preview);
    } catch (_e) {
      // ignore
    }

    // Blob으로 변환 (회전 결과를 실제 픽셀 데이터로 저장)
    canvas.toBlob((blob) => {
      if (blob) {
        onRotate(blob);
      }
      // 회전 완료 후 상태 해제
      setTimeout(() => {
        setIsRotating(false);
        if (resetTimerRef.current) {
          window.clearTimeout(resetTimerRef.current);
          resetTimerRef.current = null;
        }
      }, 100);
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
        src={localPreviewUrl || imageUrl}
        alt="회전할 이미지"
        className="w-full h-auto"
        crossOrigin="anonymous"
        onLoad={() => {
          // 이미지 로드 후 초기 Canvas 설정
          const canvas = canvasRef.current;
          const img = imgRef.current;
          if (canvas && img) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
          }
          // 이미지가 새로 로드되면 버튼 비활성화 상태를 해제하여 재회전 가능
          setIsRotating(false);
        }}
      />
      
      <div className="absolute bottom-2 left-2 flex gap-2">
        <button
          onClick={handleRotateLeft}
          className={`px-3 py-1 bg-white bg-opacity-80 text-slate-700 rounded text-sm shadow-md hover:bg-opacity-100`}
          title="좌회전"
        >
          ↶
        </button>
        <button
          onClick={handleRotateRight}
          className={`px-3 py-1 bg-white bg-opacity-80 text-slate-700 rounded text-sm shadow-md hover:bg-opacity-100`}
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
