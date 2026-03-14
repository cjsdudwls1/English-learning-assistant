export const MODEL_SEQUENCE = [
    'gemini-3-flash-preview',         // Gemini 3 Flash (Preview) - 1순위 (필기 감지 정확도 우수)
    'gemini-3.1-flash-lite-preview',  // Gemini 3.1 Flash-Lite (Preview)
    'gemini-2.5-pro',                 // Gemini 2.5 Pro (GA)
    'gemini-2.5-flash',               // Gemini 2.5 Flash (GA)
] as const;

// Lowest possible temperature for deterministic extraction
export const EXTRACTION_TEMPERATURE = 0.0;

// Keep retries modest; we fail over to next model on errors.
export const MODEL_RETRY_POLICY: Record<(typeof MODEL_SEQUENCE)[number], { maxRetries: number; baseDelayMs: number }> = {
    'gemini-3-flash-preview': { maxRetries: 1, baseDelayMs: 3000 },
    'gemini-2.5-pro': { maxRetries: 1, baseDelayMs: 4000 },
    'gemini-2.5-flash': { maxRetries: 1, baseDelayMs: 3000 },
    'gemini-3.1-flash-lite-preview': { maxRetries: 1, baseDelayMs: 3000 },
};
