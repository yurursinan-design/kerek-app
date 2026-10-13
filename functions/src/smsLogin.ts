import * as crypto from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { allowCall, clientIp, DAY_MS } from './limits';

/**
 * SMS login with a Kazakhstan SMS gateway (Mobizon) instead of Firebase's own SMS, which does not
 * deliver to +7 numbers for this project.
 *
 * 1. requestLoginCode: the app (signed in anonymously) asks for a code; a 6-digit code is texted
 *    and only its hash is stored in loginCodes/{phone hash} (no client access: default-deny rules).
 * 2. verifyLoginCode: the code is checked (5 tries, 5 minutes). The number is then put on the
 *    caller's own account, so requests made before logging in stay theirs, or, when another account
 *    already has this number (the same person on another device), that account is used. Either way
 *    the app gets a custom token and signs in fresh, which also counts as a recent sign-in (needed
 *    for account deletion). ID tokens then carry phone_number, which the security rules require.
 */

const mobizonApiKey = defineSecret('MOBIZON_API_KEY');

const REGION = 'asia-south1';
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_TRIES = 5;
/** All SMS sent by the app in one day; protects the Mobizon balance from abuse */
const GLOBAL_DAILY_SMS = 1000;
const MOBIZON_URL = 'https://api.mobizon.kz/service/message/sendsmsmessage?output=json&api=v1';

/** Kazakhstan mobile numbers only (+7 7xx / +7 6xx), the same check as the app. */
export function normalizeKzPhone(raw: unknown): string | null {
  const digits = String(typeof raw === 'string' ? raw : '').replace(/\D/g, '');
  return /^7[67]\d{9}$/.test(digits) ? `+${digits}` : null;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function codeDocId(phone: string): string {
  return sha256(`login:${phone}`).slice(0, 40);
}

function codeHash(phone: string, code: string, salt: string): string {
  return sha256(`${salt}:${phone}:${code}`);
}

async function sendSms(apiKey: string, phone: string, text: string): Promise<void> {
  const body = new URLSearchParams({ apiKey, recipient: phone.replace(/^\+/, ''), text });
  const res = await fetch(MOBIZON_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
  if (!res.ok || !data || data.code !== 0) {
    // The gateway's reason stays in the server log (balance, blocked number, …)
    console.error('[requestLoginCode] Mobizon refused the SMS:', res.status, data?.code, data?.message);
    throw new HttpsError('unavailable', 'The SMS could not be sent. Please try again later.');
  }
}

export const requestLoginCode = onCall<{ phone?: string; lang?: string }, Promise<{ ok: true; retryAfter: number }>>(
  { region: REGION, secrets: [mobizonApiKey], maxInstances: 5, timeoutSeconds: 20 },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign-in is required.');
    const phone = normalizeKzPhone(request.data?.phone);
    if (!phone) throw new HttpsError('invalid-argument', 'A Kazakhstan mobile number is required.');

    const now = Date.now();
    const tooMany = () => new HttpsError('resource-exhausted', 'Too many codes requested. Please wait and try again.');
    const phoneKey = codeDocId(phone);
    // One code a minute and a few an hour per number, per account and per network address,
    // plus one ceiling for the whole app
    if (!(await allowCall(`sms_phone_min_${phoneKey}`, 1, now, 60 * 1000))) throw tooMany();
    if (!(await allowCall(`sms_phone_day_${phoneKey}`, 8, now, DAY_MS))) throw tooMany();
    if (!(await allowCall(`sms_uid_${request.auth.uid}`, 5, now, 3600 * 1000))) throw tooMany();
    const ip = clientIp(request.rawRequest);
    if (ip && !(await allowCall(`sms_ip_${sha256(ip).slice(0, 32)}`, 10, now, 3600 * 1000))) throw tooMany();
    if (!(await allowCall('sms_global_day', GLOBAL_DAILY_SMS, now, DAY_MS))) throw tooMany();

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('hex');
    await getFirestore()
      .collection('loginCodes')
      .doc(phoneKey)
      .set({
        hash: codeHash(phone, code, salt),
        salt,
        tries: 0,
        createdAt: now,
        expiresAt: now + CODE_TTL_MS,
        // Lets a Firestore TTL policy on loginCodes remove old entries
        expireAt: Timestamp.fromMillis(now + DAY_MS),
      });

    const text =
      request.data?.lang === 'kz'
        ? `KEREK кіру коды: ${code}. Ешкімге айтпаңыз.`
        : `Код входа KEREK: ${code}. Никому не сообщайте.`;
    await sendSms(mobizonApiKey.value(), phone, text);
    return { ok: true, retryAfter: 60 };
  }
);

export const verifyLoginCode = onCall<{ phone?: string; code?: string }, Promise<{ token: string }>>(
  { region: REGION, maxInstances: 5, timeoutSeconds: 20 },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Sign-in is required.');
    const phone = normalizeKzPhone(request.data?.phone);
    const code = String(request.data?.code || '').replace(/\D/g, '');
    if (!phone || code.length !== 6) throw new HttpsError('invalid-argument', 'Invalid code.');

    const db = getFirestore();
    const ref = db.collection('loginCodes').doc(codeDocId(phone));
    // Check and count the try in one transaction, so parallel guesses can't exceed the limit
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data();
      if (!snap.exists || !d) return 'missing' as const;
      if (Date.now() > Number(d.expiresAt) || Number(d.tries) >= MAX_TRIES) {
        tx.delete(ref);
        return 'expired' as const;
      }
      const expected = Buffer.from(String(d.hash), 'hex');
      const actual = Buffer.from(codeHash(phone, code, String(d.salt)), 'hex');
      const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
      if (!ok) {
        tx.update(ref, { tries: Number(d.tries) + 1 });
        return 'wrong' as const;
      }
      tx.delete(ref);
      return 'ok' as const;
    });
    if (result === 'wrong') throw new HttpsError('invalid-argument', 'Invalid code.');
    if (result !== 'ok') throw new HttpsError('deadline-exceeded', 'The code has expired. Request a new one.');

    const auth = getAuth();
    let uid = callerUid;
    const existing = await auth.getUserByPhoneNumber(phone).catch(() => null);
    if (existing) {
      // The number already belongs to an account: sign in to that one
      uid = existing.uid;
    } else {
      try {
        await auth.updateUser(callerUid, { phoneNumber: phone });
      } catch (err: any) {
        // Someone linked the number a moment ago
        if (err?.code !== 'auth/phone-number-already-exists') throw err;
        uid = (await auth.getUserByPhoneNumber(phone)).uid;
      }
    }
    const token = await auth.createCustomToken(uid);
    return { token };
  }
);
