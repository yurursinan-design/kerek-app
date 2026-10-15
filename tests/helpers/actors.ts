/**
 * Test support: switch the signed-in test account between people (customer, provider, outsider).
 * Each label is a separate email account in the Auth emulator with a verified test phone number,
 * so the same person can sign back in later in the test.
 */
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { attachEmulatorTestPhone, auth } from '../../src/services/firebase';
import { setCurrentUserId } from '../../src/services/localRepository';

const RUN = Date.now().toString(36);
const PASSWORD = 'kerek-test-1';

export async function actAs(label: string): Promise<string> {
  if (!auth) throw new Error('Firebase auth is not configured for this test');
  const email = `${label}-${RUN}@kerek.test`;
  if (auth.currentUser?.email !== email) {
    try {
      await signOut(auth);
    } catch {}
    try {
      await signInWithEmailAndPassword(auth, email, PASSWORD);
    } catch {
      await createUserWithEmailAndPassword(auth, email, PASSWORD);
    }
  }
  await attachEmulatorTestPhone(auth);
  const uid = auth.currentUser!.uid;
  setCurrentUserId(uid);
  try {
    localStorage.setItem('kerek_current_user_id_v2', uid);
  } catch {}
  return uid;
}
