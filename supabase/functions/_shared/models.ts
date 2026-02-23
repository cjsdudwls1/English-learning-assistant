export const MODEL_SEQUENCE = [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemma-3-27b-it',
] as const;

// Lowest possible temperature for deterministic extraction
export const EXTRACTION_TEMPERATURE = 0.0;

// Keep retries modest; we fail over to next model on errors.
export const MODEL_RETRY_POLICY: Record<(typeof MODEL_SEQUENCE)[number], { maxRetries: number; baseDelayMs: number }> = {
    'gemini-3.1-pro-preview': { maxRetries: 1, baseDelayMs: 4000 },
    'gemini-3-flash-preview': { maxRetries: 1, baseDelayMs: 3000 },
    'gemini-2.5-flash': { maxRetries: 1, baseDelayMs: 3000 },
    'gemini-2.5-flash-lite': { maxRetries: 1, baseDelayMs: 3000 },
    'gemini-2.5-pro': { maxRetries: 1, baseDelayMs: 4000 },
    'gemma-3-27b-it': { maxRetries: 1, baseDelayMs: 3000 },
};

