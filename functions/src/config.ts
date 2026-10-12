/**
 * Configuration for KEREK AI Request Parser Cloud Function
 */
export const GEMINI_CONFIG = {
  model: 'gemini-flash-latest',
  fallbackModel: 'gemini-flash-lite-latest',
  region: 'asia-south1',
  maxInputChars: 500,
  maxOutputTokens: 1024,
  temperature: 0.1,
} as const;
