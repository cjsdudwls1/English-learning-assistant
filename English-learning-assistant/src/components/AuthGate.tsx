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
      <div className="flex items-center justify-center py-20 text-slate-600">로딩 중...</div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-8 mt-10">
        <h2 className="text-xl font-bold mb-4 text-center">로그인이 필요합니다</h2>
        <p className="text-slate-600 mb-6 text-center">이메일로 회원가입하거나 로그인하여 서비스를 이용하세요.</p>
        <LoginButton />
      </div>
    );
  }

  return <>{children}</>;
};


