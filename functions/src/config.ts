/**
 * Configuration for KEREK AI Request Parser Cloud Function
 */
export const GEMINI_CONFIG = {
  // Configurable Gemini model: defaults to current fast model 'gemini-3.8-flash'
  // Can be adjusted via environment variable GEMINI_MODEL without touching code
  model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  region: 'asia-south1',
  secretName: 'GEMINI_API_KEY',
  maxInputChars: 500,
  temperature: 0.1,
} as const;
