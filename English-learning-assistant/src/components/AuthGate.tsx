import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { LoginButton } from './LoginButton';

interface AuthGateProps {
  children: React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setIsAuthed(!!data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-600 dark:text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
          <span>로딩 중...</span>
        </div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 pt-16 pb-8">
        <div className="w-full max-w-md">
          {/* 로고 섹션 */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              AI 영어문제 분석기
            </h1>
            <p className="text-slate-500 dark:text-slate-400">
              로그인하여 AI 기반 학습 분석을 시작하세요
            </p>
          </div>

          {/* 로그인 카드 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl dark:shadow-2xl shadow-slate-200/50 dark:shadow-black/20 border border-slate-200 dark:border-slate-700 p-6 sm:p-8">
            <LoginButton />
          </div>

          {/* 푸터 */}
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
            로그인 시 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};


