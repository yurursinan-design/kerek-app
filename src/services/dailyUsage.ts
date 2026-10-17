// Today's usage counters of the signed-in account (usage/{uid}_{yyyymmdd}, UTC day). The security
// rules accept a new request, message, report or chat file only when the same batch counts it here
// (firestore.rules, countedToday) and the day's limit is not reached.
import { doc, getDoc, increment, Timestamp, type Firestore, type WriteBatch } from 'firebase/firestore';

export type UsageField = 'requests' | 'messages' | 'reports' | 'files';

/** Today's key as the rules compute it from the server clock, e.g. "20261017" */
export function usageDayKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
}

/** Adds "one more <field> today" to a batch that also writes the counted document. */
export function countInBatch(batch: WriteBatch, db: Firestore, uid: string, field: UsageField): void {
  batch.set(
    doc(db, 'usage', `${uid}_${usageDayKey()}`),
    // A Firestore TTL policy on usage.expireAt removes old counters (firestore.indexes.json)
    { uid, [field]: increment(1), expireAt: Timestamp.fromMillis(Date.now() + 3 * 24 * 3600 * 1000) },
    { merge: true }
  );
}

/** The day's limits, the same numbers as firestore.rules (DAILY_*) */
export const DAILY_LIMITS: Record<UsageField, number> = { requests: 10, messages: 300, reports: 20, files: 30 };

/**
 * After the database refused a counted write: when today's counter is at the limit, the refusal
 * becomes a "daily-limit-reached" error the app can explain; otherwise the original error stays.
 */
export async function explainRefusal(err: unknown, db: Firestore, uid: string, field: UsageField): Promise<never> {
  const code = (err as { code?: string })?.code || '';
  if (code === 'permission-denied' || /permission/i.test(String((err as Error)?.message || ''))) {
    const used = await getDoc(doc(db, 'usage', `${uid}_${usageDayKey()}`))
      .then((snap) => Number(snap.data()?.[field]) || 0)
      .catch(() => 0);
    if (used >= DAILY_LIMITS[field]) throw new Error('daily-limit-reached');
  }
  throw err;
}
