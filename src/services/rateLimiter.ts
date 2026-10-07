/**
 * Rate Limiter Preparation (Client-Side Protection)
 *
 * NOTE: This is a temporary, client-side protection layer against accidental
 * rapid repeated clicks or taps (e.g. double-tapping "Accept", spamming "Send Offer").
 *
 * IMPORTANT FOR CLOUD SCALING:
 * When connecting Firebase, Supabase, or a real backend server, real rate-limiting
 * MUST be enforced on the server-side / API Gateway / Cloud Functions using IP/Token
 * leaky-bucket algorithms or Redis, since client-side checks can be bypassed by bad actors.
 */

const lastActionTimestamps = new Map<string, number>();

/**
 * Checks if an action key has been executed too recently.
 * Default cooldown is 800ms to block double-taps.
 */
export function checkClientRateLimit(actionKey: string, cooldownMs: number = 800): boolean {
  const now = Date.now();
  const lastTime = lastActionTimestamps.get(actionKey) || 0;

  if (now - lastTime < cooldownMs) {
    return false; // Rate-limited
  }

  lastActionTimestamps.set(actionKey, now);
  return true; // Allowed
}

/**
 * Reset action timestamp (e.g. if operation failed and user should be allowed to retry immediately)
 */
export function resetClientRateLimit(actionKey: string): void {
  lastActionTimestamps.delete(actionKey);
}
