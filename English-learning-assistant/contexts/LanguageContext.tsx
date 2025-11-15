import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { getCurrentUserId } from '../services/db';

type Language = 'ko' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// 브라우저 언어 감지 (ko/en만)
function detectBrowserLanguage(): Language {
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith('ko')) {
    return 'ko';
  }
  return 'en'; // 기본값
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    // localStorage에서 저장된 언어 불러오기
    const saved = localStorage.getItem('preferredLanguage');
    if (saved === 'ko' || saved === 'en') {
      return saved as Language;
    }
    // 브라우저 언어 감지
    return detectBrowserLanguage();
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [hasCheckedProfile, setHasCheckedProfile] = useState(false);

  // 로그인 상태 확인 및 프로필에서 언어 설정 불러오기
  useEffect(() => {
    const checkUserLanguage = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user && !hasCheckedProfile) {
          // 로그인된 경우 프로필에서 언어 가져오기
          const userId = await getCurrentUserId().catch(() => null);
          
          if (userId) {
            const { data: profile, error } = await supabase
              .from('profiles')
              .select('language')
              .eq('user_id', userId)
              .single();
            
            if (!error && profile?.language && (profile.language === 'ko' || profile.language === 'en')) {
              setLanguageState(profile.language as Language);
              localStorage.setItem('preferredLanguage', profile.language);
            }
          }
          
          setHasCheckedProfile(true);
        } else if (!user) {
          // 로그아웃된 경우 localStorage 또는 브라우저 언어 사용
          const saved = localStorage.getItem('preferredLanguage');
          if (saved === 'ko' || saved === 'en') {
            setLanguageState(saved as Language);
          } else {
            setLanguageState(detectBrowserLanguage());
          }
          setHasCheckedProfile(true);
        }
      } catch (error) {
        console.error('Error checking user language:', error);
        setHasCheckedProfile(true);
      } finally {
        setIsLoading(false);
      }
    };

    checkUserLanguage();
    
    // 인증 상태 변경 감지
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setHasCheckedProfile(false);
      checkUserLanguage();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [hasCheckedProfile]);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('preferredLanguage', lang);
    
    // 로그인된 경우 프로필에도 저장
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const userId = await getCurrentUserId().catch(() => null);
        if (userId) {
          await supabase
            .from('profiles')
            .upsert({
              user_id: userId,
              language: lang,
            }, {
              onConflict: 'user_id'
            });
        }
      }
    } catch (error) {
      console.error('Error saving language to profile:', error);
      // 프로필 저장 실패해도 계속 진행
    }
  };

  const toggleLanguage = () => {
    const newLang = language === 'ko' ? 'en' : 'ko';
    setLanguage(newLang);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, isLoading }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};

