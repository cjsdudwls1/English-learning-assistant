import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
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

function readStoredLanguage(): Language {
  const saved = localStorage.getItem('preferredLanguage');
  if (saved === 'ko' || saved === 'en') {
    return saved;
  }
  return detectBrowserLanguage();
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  const [isLoading, setIsLoading] = useState(true);

  // "이 사용자의 프로필 언어는 이미 읽었다"는 표시.
  //
  // 이건 화면에 그려지는 값이 아니므로 state면 안 된다. 예전엔 hasCheckedProfile이라는
  // state였고 아래 이펙트가 그 값을 쓰면서 동시에 의존성으로도 걸었는데, 그게 무한 루프였다:
  //   프로필 읽음 → setHasCheckedProfile(true) → 의존성 변경으로 이펙트 재실행
  //   → onAuthStateChange 재구독 → auth-js가 구독 즉시 INITIAL_SESSION을 무조건 발화
  //     (GoTrueClient.onAuthStateChange → _emitInitialSession)
  //   → 콜백이 setHasCheckedProfile(false) → 다시 이펙트 재실행 → 처음으로.
  // 두 상태를 오가며 영원히 돌고, 매 바퀴마다 getUser()·getSession()·profiles 조회가 나갔다.
  // 실패한 CI trace에서 /auth/v1/user 가 51초 동안 281건, 175ms 간격으로 직렬로 찍힌 이유다.
  // auth-js는 이 호출들을 하나의 Web Lock으로 직렬화하므로, 락이 사실상 영구 점유됐고
  // 다른 화면의 인증 호출(교사 과제 상세의 데이터 로딩 등)이 대기 상한을 넘겨
  // "Lock broken by another request with the 'steal' option." 로 끊겼다.
  //
  // ref로 두면 갱신이 렌더를 유발하지 않아 루프 자체가 성립하지 않는다.
  // userId를 담는 이유는 계정 전환 시에는 다시 읽어야 하기 때문이다 — 예전 코드가
  // setHasCheckedProfile(false)로 노렸던 것도 그거였다.
  const syncedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const applyLocalPreference = () => {
      setLanguageState(readStoredLanguage());
    };

    const syncFromProfile = async (userId: string) => {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('language')
        .eq('user_id', userId)
        .maybeSingle();

      if (!mounted || error) return;
      if (profile?.language === 'ko' || profile?.language === 'en') {
        setLanguageState(profile.language);
        localStorage.setItem('preferredLanguage', profile.language);
      }
    };

    // 최초 조회를 따로 하지 않는다. auth-js는 구독 직후 INITIAL_SESSION을 반드시 한 번
    // 발화하므로(위 주석 참조) 이 콜백이 초기 상태도 겸한다. 세션도 인자로 들어오니
    // getUser()를 부를 이유가 없다 — 인증 왕복이 0번이 된다.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const userId = session?.user?.id ?? null;

      // 이 콜백은 auth 락을 쥔 채 호출된다(_emitInitialSession이 _acquireLock 안에 있다).
      // 여기서 곧장 supabase를 부르면 그 조회가 락 점유 시간에 얹힌다. 한 틱 미뤄 밖에서 돈다.
      setTimeout(() => {
        if (!mounted) return;

        if (!userId) {
          syncedUserIdRef.current = null;
          applyLocalPreference();
          setIsLoading(false);
          return;
        }

        // 같은 사용자면 다시 읽지 않는다. 토큰 갱신(TOKEN_REFRESHED)은 50분마다 오는데,
        // 그때마다 프로필을 다시 읽을 이유가 없다.
        if (syncedUserIdRef.current === userId) {
          setIsLoading(false);
          return;
        }
        syncedUserIdRef.current = userId;

        syncFromProfile(userId)
          .catch((error) => {
            // 다시 시도할 수 있도록 표시를 되돌린다.
            if (syncedUserIdRef.current === userId) syncedUserIdRef.current = null;
            console.error('Error checking user language:', error);
          })
          .finally(() => { if (mounted) setIsLoading(false); });
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('preferredLanguage', lang);

    // 로그인된 경우 프로필에도 저장.
    // getUser() 로 로그인 여부를 먼저 묻지 않는다 — getCurrentUserId()가 이미 그 호출이고
    // (services/db/auth.ts, 동시 호출 병합), 로그아웃이면 거절된다. 예전엔 둘 다 불러
    // /auth/v1/user 왕복이 두 번씩 나갔다.
    try {
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
