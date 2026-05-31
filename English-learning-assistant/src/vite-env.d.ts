/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_API_KEY: string;
  readonly VITE_ANALYZE_GCF_URL: string;
  readonly VITE_AI_GEMINI_ENABLED: string;
  readonly VITE_AI_OPENAI_ENABLED: string;
  readonly VITE_AI_CLAUDE_ENABLED: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

