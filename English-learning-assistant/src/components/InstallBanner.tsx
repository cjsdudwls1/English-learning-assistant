import React, { useState, useEffect } from 'react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

export function InstallBanner() {
  const { isInstallable, isInstalled, isIOS, isAndroid, isMobile, isStandalone, promptInstall } = usePwaInstall();
  const [isVisible, setIsVisible] = useState(false);
  const { language } = useLanguage();
  const t = getTranslation(language);

  useEffect(() => {
    const dismissed = sessionStorage.getItem('pwa-install-banner-dismissed');
    if (dismissed === 'true') return;
    if (isInstalled || isStandalone) {
      setIsVisible(false);
      return;
    }

    // 모바일이면 무조건 배너 표시 (beforeinstallprompt 없어도)
    // 데스크톱은 isInstallable일 때만 표시
    if (isMobile || isInstallable) {
      setIsVisible(true);
    }
  }, [isInstallable, isInstalled, isIOS, isMobile, isStandalone]);

  const handleDismiss = () => {
    sessionStorage.setItem('pwa-install-banner-dismissed', 'true');
    setIsVisible(false);
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      await promptInstall();
      setIsVisible(false);
    }
  };

  if (!isVisible || isInstalled || isStandalone) return null;

  // Android: beforeinstallprompt가 잡혔으면 바로 설치 버튼, 아니면 수동 안내
  // iOS: Safari 홈 화면 추가 안내
  // 데스크톱: beforeinstallprompt 기반 설치

  const renderContent = () => {
    if (isIOS) {
      return (
        <div className="flex-1 mr-4">
          <p className="text-sm font-bold mb-1">{t.install.installAsApp}</p>
          <p className="text-xs opacity-90">
            {t.install.iosInstructions}
          </p>
        </div>
      );
    }

    if (isAndroid && !isInstallable) {
      // beforeinstallprompt가 안 잡혔을 때 수동 안내
      return (
        <div className="flex-1 mr-4">
          <p className="text-sm font-bold mb-1">{t.install.installAsApp}</p>
          <p className="text-xs opacity-90">
            {t.install.androidInstructions}
          </p>
        </div>
      );
    }

    // isInstallable인 경우 (Android 또는 Desktop)
    return (
      <div className="flex-1 mr-4">
        <p className="text-sm font-medium">
          {t.install.installable}
        </p>
      </div>
    );
  };

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 bg-indigo-600 text-white p-4 shadow-lg z-50"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex justify-between items-center max-w-lg mx-auto">
        {renderContent()}
        <div className="flex space-x-2 flex-shrink-0">
          {isInstallable && (
            <button
              onClick={handleInstallClick}
              className="bg-white text-indigo-600 px-4 py-2 rounded-lg text-sm font-bold shadow hover:bg-indigo-50 transition-colors"
            >
              {t.install.install}
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="text-white/80 hover:text-white px-2 py-1 rounded text-lg transition-colors"
            aria-label={t.common.close}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}