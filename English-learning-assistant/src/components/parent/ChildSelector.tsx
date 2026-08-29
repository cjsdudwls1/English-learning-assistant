import React, { useState } from 'react';
import { linkChild, unlinkChild, fetchMyChildren, type ChildInfo } from '../../services/db';
import { useLanguage } from '../../contexts/LanguageContext';
import { getTranslation } from '../../utils/translations';
import { translateError } from '../../utils/errorI18n';

interface Props {
  children: ChildInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChildrenUpdate: (children: ChildInfo[]) => void;
}

export const ChildSelector: React.FC<Props> = ({ children, selectedId, onSelect, onChildrenUpdate }) => {
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { language } = useLanguage();
  const t = getTranslation(language);

  const handleLink = async () => {
    if (!email.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await linkChild(email.trim());
      const updated = await fetchMyChildren();
      onChildrenUpdate(updated);
      if (updated.length > 0 && !selectedId) onSelect(updated[0].user_id);
      setEmail('');
    } catch (e) {
      setError(translateError(e, language, t, t.parent.linkChildFailed));
    } finally {
      setAdding(false);
    }
  };

  const handleUnlink = async (childId: string) => {
    if (!window.confirm(language === 'ko' ? '이 자녀 연결을 해제할까요?' : 'Unlink this child?')) return;
    setError(null);
    try {
      await unlinkChild(childId);
      const updated = children.filter((c) => c.user_id !== childId);
      onChildrenUpdate(updated);
      if (selectedId === childId) onSelect(updated[0]?.user_id ?? null);
    } catch (e) {
      setError(translateError(e, language, t, t.parent.unlinkChildFailed));
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 sm:p-5 space-y-3 sm:space-y-4">
      <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-200">{t.parent.myChildren}</h2>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.parent.linkByEmailPlaceholder} className="min-h-[40px] sm:min-h-0 flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-base sm:text-sm" />
        <button onClick={handleLink} disabled={adding} className="min-h-[40px] sm:min-h-0 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
          {adding ? '...' : t.parent.link}
        </button>
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}

      {children.length === 0 ? (
        <p className="text-slate-400 text-sm py-2 text-center">{t.parent.noChildrenLinked}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {children.map((child) => (
            <div key={child.user_id} className={`flex min-h-[40px] sm:min-h-0 items-center gap-2 px-3 py-2 sm:px-4 rounded-xl cursor-pointer transition-colors ${selectedId === child.user_id ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
              <button onClick={() => onSelect(child.user_id)} className="flex items-center self-stretch text-left text-sm font-medium">
                {child.name || child.email}{child.grade ? ` (${child.grade})` : ''}
              </button>
              <button onClick={() => handleUnlink(child.user_id)} aria-label={language === 'ko' ? '자녀 연결 해제' : 'Unlink child'} title={language === 'ko' ? '연결 해제' : 'Unlink'} className={`inline-flex h-8 w-8 -mr-1 shrink-0 items-center justify-center text-xs ${selectedId === child.user_id ? 'text-indigo-200 hover:text-white' : 'text-slate-400 hover:text-red-500'}`}>
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
