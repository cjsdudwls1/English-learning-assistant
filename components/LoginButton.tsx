import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';

export const LoginButton: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('회원가입 완료! 이메일을 확인하거나 바로 로그인하세요.');
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // 로그인 성공 시 /upload로 리다이렉트
        window.location.href = '/upload';
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            placeholder="your@email.com"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            placeholder="••••••••"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-slate-400"
        >
          {loading ? '처리 중...' : isSignUp ? '회원가입' : '로그인'}
        </button>
      </form>
      
      <button
        onClick={() => setIsSignUp(!isSignUp)}
        className="mt-3 text-sm text-indigo-600 hover:text-indigo-800 underline"
      >
        {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-100 border border-red-300 text-red-800 rounded text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-4 p-3 bg-green-100 border border-green-300 text-green-800 rounded text-sm">
          {message}
        </div>
      )}
    </div>
  );
};

export const LogoutButton: React.FC = () => {
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };
  return (
    <button onClick={handleLogout} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-md font-medium hover:bg-slate-300">
      로그아웃
    </button>
  );
};


