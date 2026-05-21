export const MODEL_SEQUENCE = [
    'gemini-flash-latest',         // Latest Flash alias (auto hot-swap, 2주 전 이메일 공지)
    'gemini-3-flash-preview',      // Gemini 3 Flash (Preview)
    'gemini-3.1-flash-lite',       // Gemini 3.1 Flash-Lite (GA, 2026-05-07)
    'gemini-2.5-flash',            // Gemini 2.5 Flash (GA)
] as const;

// Lowest possible temperature for deterministic extraction
export const EXTRACTION_TEMPERATURE = 0.0;

// Keep retries modest; we fail over to next model on errors.
export const MODEL_RETRY_POLICY: Record<(typeof MODEL_SEQUENCE)[number], { maxRetries: number; baseDelayMs: number }> = {
    'gemini-flash-latest': { maxRetries: 1, baseDelayMs: 3000 },
    'gemini-3-flash-preview': { maxRetries: 1, baseDelayMs: 3000 },
    'gemini-3.1-flash-lite': { maxRetries: 1, baseDelayMs: 3000 },
    'gemini-2.5-flash': { maxRetries: 1, baseDelayMs: 3000 },
};
