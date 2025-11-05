import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { getCurrentUserId } from '../services/db';

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState<string>('');
  const [age, setAge] = useState<string>('');
  const [grade, setGrade] = useState<string>('');
  const [language, setLanguage] = useState<string>('');

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);
        const userId = await getCurrentUserId();
        
        // 프로필 정보 불러오기
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('email, gender, age, grade, language')
          .eq('user_id', userId)
          .single();

        if (profileError && profileError.code !== 'PGRST116') {
          throw profileError;
        }

        if (profileData) {
          setEmail(profileData.email || '');
          setGender(profileData.gender || '');
          setAge(profileData.age ? profileData.age.toString() : '');
          setGrade(profileData.grade || '');
          setLanguage(profileData.language || '');
        } else {
          // 프로필이 없으면 사용자 정보에서 이메일만 가져오기
          const { data: userData } = await supabase.auth.getUser();
          if (userData.user?.email) {
            setEmail(userData.user.email);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '프로필을 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);

    try {
      const userId = await getCurrentUserId();
      
      const { error: updateError } = await supabase
        .from('profiles')
        .upsert({
          user_id: userId,
          email: email,
          gender: gender || null,
          age: age ? parseInt(age, 10) : null,
          grade: grade || null,
          language: language || null,
        }, {
          onConflict: 'user_id'
        });

      if (updateError) throw updateError;
      
      setMessage('프로필이 성공적으로 저장되었습니다.');
      setTimeout(() => {
        setMessage(null);
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로필 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
        <div className="text-center text-slate-600 dark:text-slate-400 py-10">불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">내 프로필</h2>
        <button
          onClick={() => navigate('/upload')}
          className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline"
        >
          돌아가기
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">이메일</label>
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
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">성별</label>
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
              남성
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
              여성
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">연령</label>
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            placeholder="예: 15"
            min="1"
            max="100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">학년</label>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
          >
            <option value="">선택하세요</option>
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
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">언어</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors ${
                language === 'en'
                  ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage('ko')}
              className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors ${
                language === 'ko'
                  ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}
            >
              한국어
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/upload')}
            className="flex-1 px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-slate-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>

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

