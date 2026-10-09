/**
 * Configuration for KEREK AI Request Parser Cloud Function
 */
export const GEMINI_CONFIG = {
  model: 'gemini-3.8-flash',
  region: 'asia-south1',
  secretName: 'GEMINI_API_KEY',
  maxInputChars: 500,
  temperature: 0.1,
} as const;
