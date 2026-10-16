// The operator's panel in the app: accounts whose phone numbers are listed in config/admins
// (Firestore, set by the owner in the Firebase console; the app itself can't read or write it)
// get the "admin" claim. The security rules then let that account read reports, set badges and
// hide or block accounts. Anyone removed from the list loses the claim on their next check.
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
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
    const isAdmin = Boolean(phone) && adminPhones(config?.phones).includes(phone);

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
