import React, { useState, useEffect } from 'react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useLanguage } from '../contexts/LanguageContext';

export function InstallBanner() {
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePwaInstall();
  const { language } = useLanguage();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem('pwa-install-banner-dismissed');
    if (dismissed === 'true') {
      return;
    }
    
    if (isInstalled) {
      setIsVisible(false);
      return;
    }

    if (isInstallable || (isIOS && !isInstalled)) {
      setIsVisible(true);
    }
  }, [isInstallable, isInstalled, isIOS]);

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

  if (!isVisible || isInstalled) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-indigo-600 text-white p-4 shadow-lg flex justify-between items-center z-50">
      <div className="flex-1 mr-4">
        {isIOS ? (
          <p className="text-sm font-medium">
            {language === 'ko' ? 'Safari 공유 버튼을 누르고 "홈 화면에 추가"를 선택하여 앱을 설치하세요.' : 'Tap the Safari share button and select "Add to Home Screen" to install the app.'}
          </p>
        ) : (
          <p className="text-sm font-medium">
            {language === 'ko' ? '홈 화면에 앱을 추가하여 더 빠르고 편리하게 이용하세요.' : 'Add the app to your home screen for faster and easier access.'}
          </p>
        )}
      </div>
      <div className="flex space-x-2">
        {!isIOS && isInstallable && (
          <button
            onClick={handleInstallClick}
            className="bg-white text-indigo-600 px-3 py-1 rounded text-sm font-bold shadow hover:bg-indigo-50 transition-colors"
          >
            {language === 'ko' ? '앱 설치하기' : 'Install App'}
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="text-white bg-indigo-500 hover:bg-indigo-700 px-2 py-1 rounded text-sm transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}