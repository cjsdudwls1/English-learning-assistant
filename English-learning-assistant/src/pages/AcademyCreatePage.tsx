import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createAcademy } from '../services/db/academies';

export const AcademyCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const id = await createAcademy(name.trim(), description.trim() || undefined);
      navigate('/academies');
    } catch (e) {
      setError(e instanceof Error ? e.message : '학원 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">학원 만들기</h1>
          <button
            type="button"
            onClick={() => navigate('/academies')}
            className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
          >
            취소
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              학원 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 영어나라 학원"
              required
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              설명 (선택)
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="학원에 대한 간단한 설명"
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 resize-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? '생성 중...' : '학원 만들기'}
          </button>
        </form>
      </div>
    </div>
  );
};
