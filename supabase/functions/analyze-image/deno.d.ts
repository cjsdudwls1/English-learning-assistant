// Deno 런타임 및 Supabase Edge Function 타입 선언

declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
}

// Supabase Edge Runtime
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
} | undefined;

// serve 함수 타입
declare function serve(handler: (req: Request) => Promise<Response> | Response): void;

// Google GenAI 타입 (기본)
declare class GoogleGenAI {
  constructor(options: { apiKey: string });
  models: {
    generateContent: (params: {
      model: string;
      contents: unknown;
      generationConfig?: {
        responseMimeType?: string;
        temperature?: number;
      };
      safetySettings?: Array<{
        category: string;
        threshold: string;
      }>;
    }) => Promise<{
      text?: string | (() => Promise<string>);
      response?: {
        text?: string | (() => Promise<string>);
      };
      candidates?: Array<{
        finishReason?: string;
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    }>;
  };
}
