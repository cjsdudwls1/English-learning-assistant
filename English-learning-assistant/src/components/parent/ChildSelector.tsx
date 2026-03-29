import React, { useState } from 'react';
import { linkChild, unlinkChild, fetchMyChildren, type ChildInfo } from '../../services/db';

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
      setError(e instanceof Error ? e.message : '자녀 연결에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleUnlink = async (childId: string) => {
    try {
      await unlinkChild(childId);
      const updated = children.filter((c) => c.user_id !== childId);
      onChildrenUpdate(updated);
      if (selectedId === childId) onSelect(updated[0]?.user_id ?? null);
    } catch {
      alert('자녀 연결 해제에 실패했습니다.');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">내 자녀</h2>

      <div className="flex gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="자녀 이메일로 연결" className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm" />
        <button onClick={handleLink} disabled={adding} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
          {adding ? '...' : '연결'}
        </button>
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}

      {children.length === 0 ? (
        <p className="text-slate-400 text-sm py-2 text-center">연결된 자녀가 없습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {children.map((child) => (
            <div key={child.user_id} className={`flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer transition-colors ${selectedId === child.user_id ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
              <button onClick={() => onSelect(child.user_id)} className="text-sm font-medium">
                {child.email}{child.grade ? ` (${child.grade})` : ''}
              </button>
              <button onClick={() => handleUnlink(child.user_id)} className={`text-xs ${selectedId === child.user_id ? 'text-indigo-200 hover:text-white' : 'text-slate-400 hover:text-red-500'}`}>
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
