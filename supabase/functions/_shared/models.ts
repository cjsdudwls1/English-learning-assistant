export const MODEL_SEQUENCE = [
    'gemini-3-flash-preview',         // Gemini 3 Flash (Preview) - 최고 성능
    'gemini-2.5-pro',                 // Gemini 2.5 Pro (GA) - 안정적 고성능
    'gemini-2.5-flash',               // Gemini 2.5 Flash (GA) - 범용 안정
    'gemini-3.1-flash-lite-preview',  // Gemini 3.1 Flash-Lite (Preview) - 비용 효율 fallback
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
