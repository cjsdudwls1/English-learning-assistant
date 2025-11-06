import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';

export const LoginButton: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  
  // 회원가입 시 추가 정보
  const [gender, setGender] = useState<string>('');
  const [age, setAge] = useState<string>('');
  const [grade, setGrade] = useState<string>('');
  const [profileLanguage, setProfileLanguage] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (isSignUp) {
        // 회원가입 시 추가 정보 검증
        if (!gender || !age || !grade || !profileLanguage) {
          throw new Error(language === 'ko' ? '성별, 연령, 학년, 언어를 모두 입력해주세요.' : 'Please fill in all fields: gender, age, grade, and language.');
        }
        
        const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        
        // 프로필 정보 저장
        if (authData.user) {
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
              user_id: authData.user.id,
              email: email,
              gender: gender,
              age: parseInt(age, 10),
              grade: grade,
              language: profileLanguage,
            }, {
              onConflict: 'user_id'
            });
          
          if (profileError) throw profileError;
        }
        
        setMessage(language === 'ko' ? '회원가입 완료! 이메일을 확인하거나 바로 로그인하세요.' : 'Sign up complete! Please check your email or log in now.');
        setIsSignUp(false);
        // 폼 초기화
        setGender('');
        setAge('');
        setGrade('');
        setProfileLanguage('');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // 로그인 성공 시 /upload로 리다이렉트
        window.location.href = '/upload';
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : (language === 'ko' ? '오류가 발생했습니다.' : 'An error occurred.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.login.email}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            placeholder="your@email.com"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.login.password}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            placeholder="••••••••"
            required
          />
        </div>
        
        {isSignUp && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.login.gender || t.profile.gender}</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setGender('male')}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors ${
                    gender === 'male'
                      ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {t.profile.male}
                </button>
                <button
                  type="button"
                  onClick={() => setGender('female')}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors ${
                    gender === 'female'
                      ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {t.profile.female}
                </button>
              </div>
              {isSignUp && !gender && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {language === 'ko' ? '성별을 선택해주세요.' : 'Please select a gender.'}
                </p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.login.age}</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                placeholder={t.profile.agePlaceholder}
                min="1"
                max="100"
                required={isSignUp}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.login.grade}</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                required={isSignUp}
              >
                <option value="">{t.profile.selectGrade}</option>
                <option value="초등학교 1학년">초등학교 1학년</option>
                <option value="초등학교 2학년">초등학교 2학년</option>
                <option value="초등학교 3학년">초등학교 3학년</option>
                <option value="초등학교 4학년">초등학교 4학년</option>
                <option value="초등학교 5학년">초등학교 5학년</option>
                <option value="초등학교 6학년">초등학교 6학년</option>
                <option value="중학교 1학년">중학교 1학년</option>
                <option value="중학교 2학년">중학교 2학년</option>
                <option value="중학교 3학년">중학교 3학년</option>
                <option value="고등학교 1학년">고등학교 1학년</option>
                <option value="고등학교 2학년">고등학교 2학년</option>
                <option value="고등학교 3학년">고등학교 3학년</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.login.language}</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setProfileLanguage('en')}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors ${
                    profileLanguage === 'en'
                      ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {t.login.english}
                </button>
                <button
                  type="button"
                  onClick={() => setProfileLanguage('ko')}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors ${
                    profileLanguage === 'ko'
                      ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {t.login.korean}
                </button>
              </div>
              {isSignUp && !profileLanguage && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t.login.selectLanguage}</p>
              )}
            </div>
          </>
        )}
        
        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-slate-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? t.login.processing : (isSignUp ? t.login.signup : t.login.login)}
        </button>
      </form>
      
      <button
        onClick={() => setIsSignUp(!isSignUp)}
        className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 underline transition-colors"
      >
        {isSignUp 
          ? (language === 'ko' ? '이미 계정이 있으신가요? 로그인' : 'Already have an account? Login')
          : (language === 'ko' ? '계정이 없으신가요? 회원가입' : "Don't have an account? Sign Up")}
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-4 p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-800 text-green-800 dark:text-green-200 rounded text-sm">
          {message}
        </div>
      )}
    </div>
  );
};

export const LogoutButton: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };
  return (
    <button onClick={handleLogout} className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
      {t.header.logout}
    </button>
  );
};


