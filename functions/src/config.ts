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

/**
 * The review check's judge (reviewModeration.ts): reads the review together with the job's timeline,
 * both accounts and the master's other reviews. Used once the owner stores an API key
 * (scripts/cloudshell-claude-key.sh); until then Gemini alone reads the text.
 */
export const CLAUDE_CONFIG = {
  model: 'claude-opus-5-5',
  effort: 'medium',
  maxTokens: 16000,
  timeoutMs: 75_000,
} as const;
