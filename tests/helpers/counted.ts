/**
 * Test support: setDoc as the app writes it. A new request, message or report goes together with
 * the signed-in user's daily usage count (firestore.rules, countedToday); other writes are plain.
 */
import { getAuth } from 'firebase/auth';
import { doc, increment, setDoc, Timestamp, writeBatch, type DocumentReference, type SetOptions } from 'firebase/firestore';
import { usageDayKey } from '../../src/services/dailyUsage';

const COUNTED: Record<string, string> = { requests: 'requests', messages: 'messages', reports: 'reports' };

export function countedSet(ref: DocumentReference, data: any, options?: SetOptions): Promise<void> {
  const uid = getAuth(ref.firestore.app).currentUser?.uid;
  const field = COUNTED[ref.parent.id];
  if (!uid || !field || options) return options ? setDoc(ref, data, options) : setDoc(ref, data);
  const batch = writeBatch(ref.firestore);
  batch.set(ref, data);
  batch.set(
    doc(ref.firestore, 'usage', `${uid}_${usageDayKey()}`),
    { uid, [field]: increment(1), expireAt: Timestamp.fromMillis(Date.now() + 86400000) },
    { merge: true }
  );
  return batch.commit();
}
