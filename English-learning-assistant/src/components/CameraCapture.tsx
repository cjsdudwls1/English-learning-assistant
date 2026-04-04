import React, { useState, useRef, useCallback, useEffect } from 'react';

interface CameraCaptureProps {
  isOpen: boolean;
  maxImages: number;
  currentImageCount: number;
  onCapture: (files: File[]) => void;
  onClose: () => void;
}

export function CameraCapture({ isOpen, maxImages, currentImageCount, onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [flashEffect, setFlashEffect] = useState(false);

  const remainingSlots = maxImages - currentImageCount;

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsCameraReady(true);
        };
      }
    } catch (err: any) {
      console.error('[CameraCapture] Camera error:', err);
      if (err.name === 'NotAllowedError') {
        setError('카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 카메라 권한을 허용해주세요.');
      } else if (err.name === 'NotFoundError') {
        setError('카메라를 찾을 수 없습니다.');
      } else {
        setError(`카메라를 시작할 수 없습니다: ${err.message?.substring(0, 100) || '알 수 없는 오류'}`);
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraReady(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      setCapturedPhotos(prev => {
        prev.forEach(p => URL.revokeObjectURL(p.url));
        return [];
      });
    }
    return () => stopCamera();
  }, [isOpen, startCamera, stopCamera]);

  const takePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !isCameraReady) return;

    const totalPhotos = capturedPhotos.length;
    if (totalPhotos >= remainingSlots) {
      setError(`최대 ${maxImages}장까지만 촬영할 수 있습니다.`);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // 셔터 효과
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 150);

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        setCapturedPhotos(prev => [...prev, { blob, url }]);
      }
    }, 'image/jpeg', 0.9);
  }, [isCameraReady, capturedPhotos.length, remainingSlots, maxImages]);

  const removePhoto = useCallback((index: number) => {
    setCapturedPhotos(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleDone = useCallback(() => {
    if (capturedPhotos.length === 0) {
      onClose();
      return;
    }
    const files = capturedPhotos.map((photo, idx) => {
      return new File([photo.blob], `camera_${Date.now()}_${idx}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    });
    // URL 해제
    capturedPhotos.forEach(p => URL.revokeObjectURL(p.url));
    setCapturedPhotos([]);
    onCapture(files);
    onClose();
  }, [capturedPhotos, onCapture, onClose]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#000', display: 'flex', flexDirection: 'column',
    }}>
      {/* 카메라 뷰 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
          }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* 셔터 플래시 효과 */}
        {flashEffect && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'white', opacity: 0.7,
            pointerEvents: 'none',
            transition: 'opacity 0.15s',
          }} />
        )}

        {/* 에러 메시지 */}
        {error && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.8)', padding: '2rem',
          }}>
            <div style={{ textAlign: 'center', color: 'white' }}>
              <p style={{ fontSize: '1rem', marginBottom: '1rem' }}>{error}</p>
              <button
                onClick={onClose}
                style={{
                  background: '#4f46e5', color: 'white',
                  padding: '0.75rem 2rem', borderRadius: '0.5rem',
                  border: 'none', fontSize: '1rem', cursor: 'pointer',
                }}
              >
                닫기
              </button>
            </div>
          </div>
        )}

        {/* 상단 바: 닫기 + 촬영 수 */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: 'max(1rem, env(safe-area-inset-top)) 1rem 0.5rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)', border: 'none',
              color: 'white', fontSize: '1.5rem', width: '44px', height: '44px',
              borderRadius: '50%', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
          <div style={{
            background: 'rgba(79,70,229,0.9)', color: 'white',
            padding: '0.25rem 0.75rem', borderRadius: '1rem',
            fontSize: '0.875rem', fontWeight: 600,
          }}>
            {capturedPhotos.length} / {remainingSlots}장
          </div>
        </div>
      </div>

      {/* 촬영된 사진 미리보기 스트립 */}
      {capturedPhotos.length > 0 && (
        <div style={{
          background: '#111', padding: '0.5rem',
          display: 'flex', gap: '0.5rem', overflowX: 'auto',
          minHeight: '80px',
        }}>
          {capturedPhotos.map((photo, idx) => (
            <div key={idx} style={{
              position: 'relative', flexShrink: 0,
              width: '60px', height: '60px', borderRadius: '0.25rem', overflow: 'hidden',
            }}>
              <img
                src={photo.url}
                alt={`촬영 ${idx + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                onClick={() => removePhoto(idx)}
                style={{
                  position: 'absolute', top: -2, right: -2,
                  background: '#ef4444', color: 'white', border: 'none',
                  width: '20px', height: '20px', borderRadius: '50%',
                  fontSize: '0.625rem', cursor: 'pointer', lineHeight: '1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 하단 컨트롤 바 */}
      <div style={{
        background: '#111',
        padding: '1rem',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      }}>
        {/* 갤러리 버튼 (빈 공간 유지) */}
        <div style={{ width: '60px' }} />

        {/* 셔터 버튼 */}
        <button
          onClick={takePhoto}
          disabled={!isCameraReady || capturedPhotos.length >= remainingSlots}
          style={{
            width: '72px', height: '72px', borderRadius: '50%',
            border: '4px solid white', background: 'transparent',
            cursor: isCameraReady ? 'pointer' : 'not-allowed',
            padding: '4px', opacity: isCameraReady ? 1 : 0.5,
          }}
        >
          <div style={{
            width: '100%', height: '100%', borderRadius: '50%',
            background: capturedPhotos.length >= remainingSlots ? '#666' : 'white',
            transition: 'transform 0.1s',
          }} />
        </button>

        {/* 완료 버튼 */}
        <button
          onClick={handleDone}
          disabled={capturedPhotos.length === 0}
          style={{
            background: capturedPhotos.length > 0 ? '#4f46e5' : '#333',
            color: 'white', border: 'none',
            padding: '0.75rem 1.25rem', borderRadius: '0.5rem',
            fontSize: '0.875rem', fontWeight: 700,
            cursor: capturedPhotos.length > 0 ? 'pointer' : 'not-allowed',
            minWidth: '60px',
          }}
        >
          완료 ({capturedPhotos.length})
        </button>
      </div>
    </div>
  );
}
