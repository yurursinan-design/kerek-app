// The operator's panel in the app: accounts whose phone numbers are listed in config/admins
// (Firestore, set by the owner in the Firebase console; the app itself can't read or write it)
// get the "admin" claim. The security rules then let that account read reports, set badges and
// hide or block accounts, but only while its number is still on the list: the server copies the
// list into config/adminPhones, which the rules check on every operator action, so removing a
// number takes the rights away at once (and the removed account's claim and sessions are revoked).
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { allowCall } from './limits';

/** Digits of a Kazakhstan number in international form (8 7xx … becomes 7 7xx …), or ''. */
export function phoneDigits(raw: unknown): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  return d.length >= 10 && d.length <= 15 ? d : '';
}

/** The numbers in config/admins.phones: a list, or one text with numbers separated by commas. */
export function adminPhones(value: unknown): string[] {
  const parts = Array.isArray(value) ? value.map(String) : String(value || '').split(/[,;\n]+/);
  return parts.map(phoneDigits).filter(Boolean);
}

/** Writes the operator numbers, as the sign-in tokens carry them (+7…), for the security rules. */
async function saveAdminPhones(phones: string[]): Promise<void> {
  await getFirestore()
    .collection('config')
    .doc('adminPhones')
    .set({ e164: Array.from(new Set(phones)).map((p) => `+${p}`), updatedAt: FieldValue.serverTimestamp() });
}

/** Whether a caller is an operator right now: the admin claim and a number still on the list. */
export async function isOperator(token: Record<string, unknown> | undefined): Promise<boolean> {
  const phone = phoneDigits(token?.phone_number);
  if (token?.admin !== true || !phone) return false;
  const config = (await getFirestore().collection('config').doc('admins').get()).data();
  return adminPhones(config?.phones).includes(phone);
}

/** The owner changed the operator list: the rules follow at once, removed numbers lose the claim and sessions. */
export const adminListChanged = onDocumentWritten({ document: 'config/admins', region: 'asia-south1', maxInstances: 1 }, async (event) => {
  const before = adminPhones(event.data?.before?.data()?.phones);
  const after = adminPhones(event.data?.after?.data()?.phones);
  await saveAdminPhones(after);
  const auth = getAuth();
  for (const phone of before.filter((p) => !after.includes(p))) {
    try {
      const user = await auth.getUserByPhoneNumber(`+${phone}`);
      const claims: Record<string, unknown> = { ...(user.customClaims || {}) };
      delete claims.admin;
      await auth.setCustomUserClaims(user.uid, claims);
      await auth.revokeRefreshTokens(user.uid);
    } catch {
      // no account with this number: nothing to revoke
    }
  }
});

export const claimAdmin = onCall<unknown, Promise<{ admin: boolean }>>(
  { region: 'asia-south1', maxInstances: 5, timeoutSeconds: 20 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign-in is required.');
    if (!(await allowCall(`admin_${uid}`, 20, Date.now(), 3600 * 1000))) {
      throw new HttpsError('resource-exhausted', 'Too many checks, try again later.');
    }
    const phone = phoneDigits(request.auth?.token?.phone_number);
    const config = (await getFirestore().collection('config').doc('admins').get()).data();
    const listed = adminPhones(config?.phones);
    const isAdmin = Boolean(phone) && listed.includes(phone);
    // Keeps the rules' copy of the list current (also after the first deploy of this check)
    await saveAdminPhones(listed);

    const auth = getAuth();
    const claims = (await auth.getUser(uid)).customClaims || {};
    if (isAdmin !== (claims.admin === true)) {
      const next: Record<string, unknown> = { ...claims };
      if (isAdmin) next.admin = true;
      else delete next.admin;
      await auth.setCustomUserClaims(uid, next);
    }
    return { admin: isAdmin };
  }
);
