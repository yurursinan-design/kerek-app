import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK once for every module (singleton pattern)
if (!getApps().length) {
  initializeApp();
}

export const DAY_MS = 24 * 3600 * 1000;

/**
 * Counts calls per key in a time window (rateLimits/{key}); false once max is reached.
 * expireAt lets a Firestore TTL policy on rateLimits delete old counters automatically.
 */
export async function allowCall(key: string, max: number, now: number, windowMs = 60000): Promise<boolean> {
  const db = getFirestore();
  const ref = db.collection('rateLimits').doc(key);
  const expireAt = Timestamp.fromMillis(now + Math.max(windowMs, 60000) + DAY_MS);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const windowStart = typeof data.windowStart === 'number' ? data.windowStart : 0;
    const count = typeof data.callCount === 'number' ? data.callCount : 0;
    if (now - windowStart >= windowMs) {
      tx.set(ref, { windowStart: now, callCount: 1, lastCallAt: now, expireAt });
      return true;
    }
    if (count >= max) return false;
    tx.set(ref, { windowStart, callCount: count + 1, lastCallAt: now, expireAt });
    return true;
  });
}

/**
 * Caller's address. Google's front end appends the address it saw to X-Forwarded-For, so the last
 * entry is the real one; earlier entries can be anything the caller sent.
 */
export function clientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> } | undefined): string {
  const fwd = req?.headers?.['x-forwarded-for'];
  const parts = (Array.isArray(fwd) ? fwd.join(',') : fwd || '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || req?.ip || '';
}
