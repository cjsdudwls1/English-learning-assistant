import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  listApiKeys,
  saveApiKey,
  deleteApiKey,
  activateProvider,
  type ApiKeyInfo,
  type ApiKeyProvider,
} from '../services/apiKeys';

type Selection = 'gemini' | ApiKeyProvider;

const PROVIDER_META: Record<ApiKeyProvider, { ko: string; en: string; placeholder: string; help: { ko: string; en: string } }> = {
  anthropic: {
    ko: 'Claude (Anthropic)',
    en: 'Claude (Anthropic)',
    placeholder: 'sk-ant-...',
    help: {
      ko: 'console.anthropic.com 에서 발급한 API 키',
      en: 'API key from console.anthropic.com',
    },
  },
  openai: {
    ko: 'ChatGPT (OpenAI)',
    en: 'ChatGPT (OpenAI)',
    placeholder: 'sk-...',
    help: {
      ko: 'platform.openai.com 에서 발급한 API 키',
      en: 'API key from platform.openai.com',
    },
  },
};

export const ApiKeySettings: React.FC = () => {
  const { language } = useLanguage();
  const ko = language === 'ko';

  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selected, setSelected] = useState<Selection>('gemini');
  const [keyInput, setKeyInput] = useState('');

  const activeProvider: Selection = keys.find((k) => k.is_active)?.provider ?? 'gemini';

  const load = async () => {
    try {
      setLoading(true);
      const data = await listApiKeys();
      setKeys(data);
      setSelected(data.find((k) => k.is_active)?.provider ?? 'gemini');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const savedKeyFor = (p: ApiKeyProvider): ApiKeyInfo | undefined => keys.find((k) => k.provider === p);

  const clearMsg = () => {
    setError(null);
    setMessage(null);
  };

  // 시스템 Gemini로 전환
  const handleUseGemini = async () => {
    clearMsg();
    setSaving(true);
    try {
      await activateProvider(null);
      setMessage(ko ? '시스템 AI(Gemini)로 설정되었습니다.' : 'Switched to system AI (Gemini).');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // 저장된 키로 전환
  const handleActivate = async (p: ApiKeyProvider) => {
    clearMsg();
    setSaving(true);
    try {
      await activateProvider(p);
      setMessage(ko ? `${PROVIDER_META[p].ko}(으)로 전환되었습니다.` : `Switched to ${PROVIDER_META[p].en}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // 키 저장(검증 포함)
  const handleSave = async (p: ApiKeyProvider) => {
    clearMsg();
    if (keyInput.trim().length < 8) {
      setError(ko ? 'API 키를 올바르게 입력하세요.' : 'Please enter a valid API key.');
      return;
    }
    setSaving(true);
    try {
      await saveApiKey(p, keyInput.trim());
      setKeyInput('');
      setMessage(ko ? '키가 저장되고 활성화되었습니다.' : 'Key saved and activated.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // 키 삭제
  const handleDelete = async (p: ApiKeyProvider) => {
    clearMsg();
    setSaving(true);
    try {
      await deleteApiKey(p);
      setMessage(ko ? '키가 삭제되었습니다.' : 'Key deleted.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center text-slate-500 dark:text-slate-400 py-8">{ko ? '불러오는 중...' : 'Loading...'}</div>;
  }

  const optionCard = (value: Selection, title: string, desc: string) => {
    const isActive = activeProvider === value;
    const isSelected = selected === value;
    return (
      <button
        type="button"
        onClick={() => { setSelected(value); clearMsg(); }}
        className={`w-full text-left p-4 rounded-xl border transition-colors ${
          isSelected
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-400'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</span>
          {isActive && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
              {ko ? '사용 중' : 'Active'}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{desc}</p>
      </button>
    );
  };

  const renderProviderPanel = (p: ApiKeyProvider) => {
    const meta = PROVIDER_META[p];
    const saved = savedKeyFor(p);
    const isActive = activeProvider === p;
    return (
      <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-700/40">
        {saved ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-700 dark:text-slate-300">
              {ko ? '저장된 키' : 'Saved key'}: <span className="font-mono">{saved.key_hint ?? '****'}</span>
            </div>
            <div className="flex gap-2">
              {!isActive && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleActivate(p)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 dark:bg-indigo-500 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {ko ? '이 키 사용' : 'Use this key'}
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => handleDelete(p)}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 disabled:opacity-50"
              >
                {ko ? '삭제' : 'Delete'}
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
            {saved ? (ko ? '키 교체' : 'Replace key') : (ko ? 'API 키 입력' : 'Enter API key')} · {meta.help[ko ? 'ko' : 'en']}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={selected === p ? keyInput : ''}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={meta.placeholder}
              className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(p)}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 dark:bg-indigo-500 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
            >
              {saving ? (ko ? '확인 중...' : 'Checking...') : (ko ? '저장' : 'Save')}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {ko
              ? '저장 시 키 유효성을 1회 확인합니다(소량 토큰 사용). 키는 암호화되어 서버에만 저장됩니다.'
              : 'The key is verified once on save (minimal token use) and stored encrypted on the server only.'}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
          {ko ? 'AI 모델 선택 (API 키)' : 'AI Model (API Key)'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {ko
            ? '본인 API 키를 등록하면 문제 생성·예시·분류에 Claude 또는 ChatGPT를 사용할 수 있습니다. 등록하지 않으면 시스템 기본 AI(Gemini)가 사용됩니다.'
            : 'Register your own API key to use Claude or ChatGPT for generation, examples, and classification. Without a key, the system default AI (Gemini) is used.'}
        </p>
      </div>

      <div className="space-y-2">
        {optionCard('gemini', ko ? '시스템 기본 (Gemini)' : 'System default (Gemini)', ko ? '키 불필요 · 이미지 분석 최적화' : 'No key needed · optimized for image analysis')}
        {optionCard('anthropic', PROVIDER_META.anthropic.ko, ko ? '본인 Claude 키 사용' : 'Use your Claude key')}
        {optionCard('openai', PROVIDER_META.openai.ko, ko ? '본인 ChatGPT 키 사용' : 'Use your ChatGPT key')}
      </div>

      {selected === 'gemini' && (
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/40">
          {activeProvider === 'gemini' ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">{ko ? '현재 시스템 기본 AI(Gemini)를 사용 중입니다.' : 'Currently using system default AI (Gemini).'}</p>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleUseGemini}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 dark:bg-indigo-500 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {ko ? '시스템 Gemini로 전환' : 'Switch to system Gemini'}
            </button>
          )}
        </div>
      )}

      {selected === 'anthropic' && renderProviderPanel('anthropic')}
      {selected === 'openai' && renderProviderPanel('openai')}

      {/* 이미지 분석 정확도 경고 */}
      {(selected === 'anthropic' || selected === 'openai') && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs">
          {ko
            ? '⚠️ 이미지 분석(시험지 채점)은 Gemini 전용 정밀 파이프라인(영역 크롭·좌표 추출)에 최적화되어 있습니다. Claude/ChatGPT로 이미지 분석 시 단순 경로로 동작하여 정확도가 낮아질 수 있습니다. 문제 생성·예시·분류 등 텍스트 작업은 영향이 적습니다.'
            : '⚠️ Image analysis (grading) is optimized for a Gemini-only precision pipeline (region crop & coordinate extraction). Using Claude/ChatGPT for image analysis falls back to a simpler path with lower accuracy. Text tasks (generation, examples, classification) are largely unaffected.'}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-800 text-green-800 dark:text-green-200 rounded text-sm">
          {message}
        </div>
      )}
    </div>
  );
};
