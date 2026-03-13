import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { getCurrentUserId } from '../services/db';
import { useLanguage } from '../contexts/LanguageContext';
import type { QuestionType } from '../types';

interface ProblemRow {
  id: string;
  index_in_image: number;
  content: any;
  session_id: string;
  created_at: string;
  session_created_at?: string;
  image_url?: string;
  user_answer?: string;
  correct_answer?: string;
  user_mark?: string;
  is_correct?: boolean | null;
  classification?: any;
}

type FilterCorrectness = 'all' | 'correct' | 'incorrect' | 'unmarked';

const PAGE_SIZE = 30;

export const AllProblemsPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const [problems, setProblems] = useState<ProblemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCorrectness, setFilterCorrectness] = useState<FilterCorrectness>('all');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    loadProblems();
  }, []);

  const loadProblems = async () => {
    try {
      setLoading(true);
      setError(null);
      const userId = await getCurrentUserId();

      // problems + labels + sessions 조인
      const { data, error: fetchError } = await supabase
        .from('problems')
        .select(`
          id,
          index_in_image,
          content,
          session_id,
          created_at,
          sessions!inner (
            user_id,
            created_at,
            image_urls
          ),
          labels (
            user_answer,
            correct_answer,
            user_mark,
            is_correct,
            classification
          )
        `)
        .eq('sessions.user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500);

      if (fetchError) throw fetchError;

      const rows: ProblemRow[] = (data || []).map((p: any) => {
        const label = p.labels?.[0] || {};
        const session = p.sessions || {};
        return {
          id: p.id,
          index_in_image: p.index_in_image,
          content: p.content || {},
          session_id: p.session_id,
          created_at: p.created_at,
          session_created_at: session.created_at,
          image_url: session.image_urls?.[0] || '',
          user_answer: label.user_answer || '',
          correct_answer: label.correct_answer || '',
          user_mark: label.user_mark || '',
          is_correct: label.is_correct ?? null,
          classification: label.classification || {},
        };
      });

      setProblems(rows);
      setHasMore(rows.length >= 500);
    } catch (err) {
      console.error('Failed to load all problems:', err);
      setError(language === 'ko' ? '문제를 불러오는 중 오류가 발생했습니다.' : 'Error loading problems.');
    } finally {
      setLoading(false);
    }
  };

  // 필터링된 결과
  const filtered = useMemo(() => {
    let result = problems;

    // 정답/오답 필터
    if (filterCorrectness === 'correct') {
      result = result.filter(p => p.is_correct === true);
    } else if (filterCorrectness === 'incorrect') {
      result = result.filter(p => p.is_correct === false);
    } else if (filterCorrectness === 'unmarked') {
      result = result.filter(p => p.is_correct === null);
    }

    // 텍스트 검색
    if (searchText.trim()) {
      const lower = searchText.toLowerCase();
      result = result.filter(p => {
        const stem = (p.content?.stem || p.content?.question_text || '').toLowerCase();
        const classStr = JSON.stringify(p.classification || {}).toLowerCase();
        return stem.includes(lower) || classStr.includes(lower);
      });
    }

    return result;
  }, [problems, filterCorrectness, searchText]);

  // 페이지네이션
  const paged = useMemo(() => {
    return filtered.slice(0, (page + 1) * PAGE_SIZE);
  }, [filtered, page]);

  const correctCount = problems.filter(p => p.is_correct === true).length;
  const incorrectCount = problems.filter(p => p.is_correct === false).length;
  const unmarkedCount = problems.filter(p => p.is_correct === null).length;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 dark:border-indigo-400 mx-auto"></div>
          <p className="mt-4 text-slate-600 dark:text-slate-400">
            {language === 'ko' ? '문제 불러오는 중...' : 'Loading problems...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">
          {language === 'ko' ? '등록 문제 일람' : 'All Registered Problems'}
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          {language === 'ko'
            ? `총 ${problems.length}개의 문제가 등록되어 있습니다.`
            : `${problems.length} problems registered in total.`}
        </p>
      </div>

      {/* 통계 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 text-center">
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{problems.length}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{language === 'ko' ? '전체' : 'Total'}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-blue-200 dark:border-blue-800 text-center">
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{correctCount}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{language === 'ko' ? '정답' : 'Correct'}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-red-200 dark:border-red-800 text-center">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{incorrectCount}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{language === 'ko' ? '오답' : 'Incorrect'}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 text-center">
          <p className="text-2xl font-bold text-slate-500 dark:text-slate-400">{unmarkedCount}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{language === 'ko' ? '미채점' : 'Unmarked'}</p>
        </div>
      </div>

      {/* 검색 + 필터 */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <input
          type="text"
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setPage(0); }}
          placeholder={language === 'ko' ? '문제 내용 또는 분류로 검색...' : 'Search by content or classification...'}
          className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex gap-2">
          {(['all', 'correct', 'incorrect', 'unmarked'] as FilterCorrectness[]).map(f => (
            <button
              key={f}
              onClick={() => { setFilterCorrectness(f); setPage(0); }}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                filterCorrectness === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}
            >
              {f === 'all' && (language === 'ko' ? '전체' : 'All')}
              {f === 'correct' && (language === 'ko' ? '정답' : 'Correct')}
              {f === 'incorrect' && (language === 'ko' ? '오답' : 'Incorrect')}
              {f === 'unmarked' && (language === 'ko' ? '미채점' : 'Unmarked')}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg">
          {error}
        </div>
      )}

      {/* 문제 테이블 */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-700 dark:text-slate-300">#</th>
                <th className="px-4 py-3 text-left font-medium text-slate-700 dark:text-slate-300">
                  {language === 'ko' ? '문제 내용' : 'Problem'}
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-700 dark:text-slate-300">
                  {language === 'ko' ? '분류' : 'Classification'}
                </th>
                <th className="px-4 py-3 text-center font-medium text-slate-700 dark:text-slate-300">
                  {language === 'ko' ? '사용자 답안' : 'User Ans'}
                </th>
                <th className="px-4 py-3 text-center font-medium text-slate-700 dark:text-slate-300">
                  {language === 'ko' ? '정답' : 'Correct'}
                </th>
                <th className="px-4 py-3 text-center font-medium text-slate-700 dark:text-slate-300">
                  {language === 'ko' ? '결과' : 'Result'}
                </th>
                <th className="px-4 py-3 text-center font-medium text-slate-700 dark:text-slate-300">
                  {language === 'ko' ? '등록일' : 'Date'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {paged.map((p, idx) => {
                const stem = p.content?.stem || p.content?.question_text || '';
                const truncated = stem.length > 60 ? stem.substring(0, 60) + '...' : stem;
                const classLabel = [p.classification?.depth1, p.classification?.depth2].filter(Boolean).join(' > ') || '-';
                const dateStr = p.session_created_at ? new Date(p.session_created_at).toLocaleDateString() : '-';

                return (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/session/${p.session_id}`)}
                  >
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{idx + 1}</td>
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-200 max-w-xs">
                      <span title={stem}>{truncated || (language === 'ko' ? '내용 없음' : 'No content')}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 max-w-[150px] truncate">
                      {classLabel}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-700 dark:text-slate-300 font-mono">
                      {p.user_answer || '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-green-600 dark:text-green-400 font-mono font-medium">
                      {p.correct_answer || '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.is_correct === true && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300">O</span>
                      )}
                      {p.is_correct === false && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300">X</span>
                      )}
                      {p.is_correct === null && (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
                      {dateStr}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {paged.length === 0 && (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400">
            {language === 'ko' ? '검색 결과가 없습니다.' : 'No results found.'}
          </div>
        )}
      </div>

      {/* 더 보기 버튼 */}
      {paged.length < filtered.length && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setPage(p => p + 1)}
            className="px-6 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
          >
            {language === 'ko'
              ? `더 보기 (${paged.length}/${filtered.length})`
              : `Load more (${paged.length}/${filtered.length})`}
          </button>
        </div>
      )}

      {/* 결과 요약 */}
      <div className="mt-4 text-sm text-slate-500 dark:text-slate-400 text-center">
        {language === 'ko'
          ? `${filtered.length}개 중 ${paged.length}개 표시`
          : `Showing ${paged.length} of ${filtered.length}`}
      </div>
    </div>
  );
};
