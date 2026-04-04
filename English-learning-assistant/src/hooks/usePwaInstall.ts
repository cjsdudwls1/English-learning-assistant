import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// 글로벌 변수: React 마운트 전에 beforeinstallprompt가 발생해도 캡처
let deferredPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
}

export function usePwaInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(deferredPrompt);
  const [isInstallable, setIsInstallable] = useState(!!deferredPrompt);
  const [isInstalled, setIsInstalled] = useState(false);

  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
  const isMobile = isIOS || isAndroid;
  const isStandalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches || 
    (window.navigator as any).standalone === true
  );

  useEffect(() => {
    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // 마운트 시 이미 캡처된 프롬프트가 있으면 사용
    if (deferredPrompt && !installPrompt) {
      setInstallPrompt(deferredPrompt);
      setIsInstallable(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      deferredPrompt = promptEvent;
      setInstallPrompt(promptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    
    const installedHandler = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setInstallPrompt(null);
      deferredPrompt = null;
    };

    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, [isStandalone, installPrompt]);

  const promptInstall = useCallback(async () => {
    const prompt = installPrompt || deferredPrompt;
    if (!prompt) return false;
    await prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') {
      setIsInstalled(true);
    }
    setInstallPrompt(null);
    setIsInstallable(false);
    deferredPrompt = null;
    return result.outcome === 'accepted';
  }, [installPrompt]);

  return { isInstallable, isInstalled, isIOS, isAndroid, isMobile, isStandalone, promptInstall };
}