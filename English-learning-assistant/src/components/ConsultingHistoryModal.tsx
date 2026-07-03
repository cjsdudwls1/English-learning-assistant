// 학습 컨설팅 보고서 히스토리 조회/삭제 모달. 개별 보고서 렌더는 ConsultingReportModal을 재사용한다.
import React, { useEffect, useState } from 'react';
import { getTranslation } from '../utils/translations';
import { fetchConsultingReports, deleteConsultingReport, type ConsultingReportRow } from '../services/db';
import { ConsultingReportModal } from './ConsultingReportModal';

interface ConsultingHistoryModalProps {
  language: 'ko' | 'en';
  isOpen: boolean;
  onClose: () => void;
}

export const ConsultingHistoryModal: React.FC<ConsultingHistoryModalProps> = ({
  language,
  isOpen,
  onClose,
}) => {
  const t = getTranslation(language);
  const [reports, setReports] = useState<ConsultingReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConsultingReportRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const rows = await fetchConsultingReports();
        if (!cancelled) setReports(rows);
      } catch (e) {
        console.error('컨설팅 기록 조회 실패:', e);
        if (!cancelled) {
          setError(language === 'ko' ? '기록을 불러오는 중 오류가 발생했습니다.' : 'Failed to load history.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, language]);

  if (!isOpen) return null;

  const handleDelete = async (id: string) => {
    try {
      setDeletingId(id);
      await deleteConsultingReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      setConfirmDeleteId(null);
    } catch (e) {
      console.error('컨설팅 기록 삭제 실패:', e);
      setError(language === 'ko' ? '삭제 중 오류가 발생했습니다.' : 'Failed to delete.');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US');
    } catch {
      return iso;
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              {t.stats.consultingHistoryTitle}
            </h3>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              {t.common.close}
            </button>
          </div>

          <div className="p-5 overflow-y-auto space-y-2">
            {loading && (
              <p className="text-center text-slate-500 dark:text-slate-400 py-6">{t.stats.consultingHistoryLoading}</p>
            )}
            {!loading && error && (
              <p className="text-center text-red-600 dark:text-red-400 py-6">{error}</p>
            )}
            {!loading && !error && reports.length === 0 && (
              <p className="text-center text-slate-500 dark:text-slate-400 py-6">{t.stats.consultingHistoryEmpty}</p>
            )}
            {!loading && !error && reports.map((r) => {
              const total = r.stats?.total ?? 0;
              const correct = r.stats?.correct ?? 0;
              const rate = total > 0 ? Math.round((correct / total) * 100) : 0;
              const isConfirming = confirmDeleteId === r.id;
              return (
                <div
                  key={r.id}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => setSelected(r)}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {formatDate(r.created_at)}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400 truncate">
                        {r.scope_label || t.stats.consultingAllCategories}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                        {t.stats.accuracy}: {rate}% ({correct}/{total})
                      </p>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isConfirming ? (
                        <>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {language === 'ko' ? '삭제하시겠어요?' : 'Delete this?'}
                          </span>
                          <button
                            onClick={() => handleDelete(r.id)}
                            disabled={deletingId === r.id}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400 transition-colors"
                          >
                            {t.common.confirm}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 text-xs bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-300 dark:hover:bg-slate-500 transition-colors"
                          >
                            {t.common.cancel}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(r.id)}
                          title={t.common.delete}
                          className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <ConsultingReportModal
          report={selected.report}
          scopeLabel={selected.scope_label ?? undefined}
          isOpen
          onClose={() => setSelected(null)}
          language={language}
        />
      )}
    </>
  );
};
