/**
 * 이미지 분석에 사용 가능한 AI provider/모델 정의.
 *
 * 활성화 여부는 Vite 환경변수로 판단한다.
 * - VITE_AI_GEMINI_ENABLED (기본 true)
 * - VITE_AI_OPENAI_ENABLED
 * - VITE_AI_CLAUDE_ENABLED
 *
 * 비활성 provider 선택 시 "서비스 준비중입니다" 안내가 표시되며 분석 요청이 차단된다.
 * 백엔드(cloud-functions/analyze-image)에서도 동일한 가드를 수행한다.
 */

export type AIProviderId = 'gemini' | 'openai' | 'claude';

export interface AIModelOption {
  id: string;
  label: string;
}

export interface AIProviderDef {
  id: AIProviderId;
  label: string;
  models: AIModelOption[];
  envFlagKey: keyof ImportMetaEnv;
  defaultEnabled: boolean;
}

export const AI_PROVIDERS: AIProviderDef[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    envFlagKey: 'VITE_AI_GEMINI_ENABLED',
    defaultEnabled: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ],
    envFlagKey: 'VITE_AI_OPENAI_ENABLED',
    defaultEnabled: false,
  },
  {
    id: 'claude',
    label: 'Anthropic Claude',
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    envFlagKey: 'VITE_AI_CLAUDE_ENABLED',
    defaultEnabled: false,
  },
];

export const DEFAULT_PROVIDER_ID: AIProviderId = 'gemini';

export function getProvider(id: AIProviderId): AIProviderDef | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

export function isProviderEnabled(id: AIProviderId): boolean {
  const def = getProvider(id);
  if (!def) return false;
  const flag = (import.meta.env as Record<string, string | undefined>)[def.envFlagKey as string];
  if (flag === undefined || flag === '') return def.defaultEnabled;
  return flag === 'true' || flag === '1';
}

export function getDefaultModelId(providerId: AIProviderId): string {
  const def = getProvider(providerId);
  return def?.models[0]?.id ?? '';
}

const STORAGE_KEY_PROVIDER = 'ela.imageAnalysis.providerId';
const STORAGE_KEY_MODEL = 'ela.imageAnalysis.modelId';

export function loadSavedSelection(): { providerId: AIProviderId; modelId: string } {
  try {
    const savedProvider = (typeof window !== 'undefined'
      ? window.localStorage.getItem(STORAGE_KEY_PROVIDER)
      : null) as AIProviderId | null;
    const savedModel = typeof window !== 'undefined'
      ? window.localStorage.getItem(STORAGE_KEY_MODEL)
      : null;

    if (savedProvider && getProvider(savedProvider)) {
      const provider = getProvider(savedProvider)!;
      const modelValid = savedModel && provider.models.some((m) => m.id === savedModel);
      return {
        providerId: savedProvider,
        modelId: modelValid ? savedModel! : getDefaultModelId(savedProvider),
      };
    }
  } catch {
    // localStorage 미지원 환경(SSR/시크릿 모드 등) 무시
  }
  return {
    providerId: DEFAULT_PROVIDER_ID,
    modelId: getDefaultModelId(DEFAULT_PROVIDER_ID),
  };
}

export function saveSelection(providerId: AIProviderId, modelId: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY_PROVIDER, providerId);
    window.localStorage.setItem(STORAGE_KEY_MODEL, modelId);
  } catch {
    // localStorage 미지원 환경 무시
  }
}
