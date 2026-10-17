import * as crypto from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { allowCall, clientIp, DAY_MS } from './limits';
import { recordLoginSignals } from './signals';
import { sendTelegramCode, telegramGatewayToken, telegramReady } from './telegramGateway';

/**
 * Phone login with a one-time code sent to WhatsApp (WhatsApp Business Platform, Cloud API), using
 * an approved authentication template with a copy-code button, or to Telegram (telegramGateway.ts).
 * WhatsApp is used when it is set up, Telegram otherwise or when the app asks for it.
 *
 * 1. requestLoginCode: the app (signed in anonymously) asks for a code; a 6-digit code goes to the
 *    number's WhatsApp and only its hash is stored in loginCodes/{phone hash} (no client access:
 *    default-deny rules).
 * 2. verifyLoginCode: the code is checked (5 tries, 10 minutes). The number is then put on the
 *    caller's own account, so requests made before logging in stay theirs, or, when another account
 *    already has this number (the same person on another device), that account is used. Either way
 *    the app gets a custom token and signs in fresh, which also counts as a recent sign-in (needed
 *    for account deletion). ID tokens then carry phone_number, which the security rules require.
 *
 * Google Play's app reviewers have no Kazakhstan WhatsApp, so one review number gets a fixed code
 * (PLAY_REVIEW_LOGIN) instead of a message; see reviewCodeFor.
 */

/** Permanent access token of the Meta system user that owns the WhatsApp Business account */
const whatsappToken = defineSecret('WHATSAPP_TOKEN');
/**
 * Sign-in for Google Play's app reviewers: "<number>:<6 digits>", e.g. "+77000000000:123456",
 * given to Google in Play Console (App access). Made by scripts/cloudshell-login-setup.sh.
 */
const playReviewLogin = defineSecret('PLAY_REVIEW_LOGIN');
/** Settings from functions/.env (not secret) */
const whatsappPhoneNumberId = defineString('WHATSAPP_PHONE_NUMBER_ID', { default: '' });
const whatsappTemplate = defineString('WHATSAPP_TEMPLATE', { default: 'tapsyr_login_code' });
const graphVersion = defineString('WHATSAPP_GRAPH_VERSION', { default: 'v23.0' });

const REGION = 'asia-south1';
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
/**
 * All codes sent by the app in one day; protects the WhatsApp balance from abuse. Sized for the
 * Kyzylorda pilot (real logins are a few dozen a day); raise it when the app grows.
 */
const GLOBAL_DAILY_CODES = 200;
/** Template language per app language; Russian is the fallback when a Kazakh version is missing */
const TEMPLATE_LANG: Record<string, string> = { kz: 'kk', ru: 'ru' };
/** Graph API error codes: template missing in this language, and sending too fast */
const TEMPLATE_MISSING = 132001;
const RATE_LIMITED = new Set([4, 80007, 130429, 131048, 131056]);

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

/**
 * The fixed code when this is the review number, else null. No message is sent for that number;
 * limits, tries and expiry work as for any other number. An empty or other value turns it off.
 */
function reviewCodeFor(phone: string): string | null {
  const m = /^\s*(\+?\d{11})\s*:\s*(\d{6})\s*$/.exec(playReviewLogin.value() || '');
  return m && normalizeKzPhone(m[1]) === phone ? m[2] : null;
}

type GraphError = { code?: number; message?: string; error_subcode?: number };

export type LoginChannel = 'whatsapp' | 'telegram';

/** The channels that are set up, in order of preference */
export function loginChannels(): LoginChannel[] {
  const out: LoginChannel[] = [];
  if (whatsappPhoneNumberId.value()) out.push('whatsapp');
  if (telegramReady()) out.push('telegram');
  return out;
}

async function postTemplate(phone: string, code: string, language: string): Promise<GraphError | null> {
  const url = `https://graph.facebook.com/${graphVersion.value()}/${whatsappPhoneNumberId.value()}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${whatsappToken.value()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: whatsappTemplate.value(),
        language: { code: language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          // The copy-code button carries the same code
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => null)) as { messages?: unknown[]; error?: GraphError } | null;
  if (res.ok && data?.messages?.length) return null;
  return data?.error || { code: res.status, message: 'No message id in the reply' };
}

async function sendWhatsAppCode(phone: string, code: string, appLang: unknown): Promise<void> {
  if (!whatsappPhoneNumberId.value()) {
    console.error('[requestLoginCode] WHATSAPP_PHONE_NUMBER_ID is not set');
    throw new HttpsError('failed-precondition', 'WhatsApp login is not set up yet.');
  }
  const first = TEMPLATE_LANG[String(appLang)] || 'ru';
  let err = await postTemplate(phone, code, first);
  if (err?.code === TEMPLATE_MISSING && first !== 'ru') err = await postTemplate(phone, code, 'ru');
  if (!err) return;
  // Meta's reason stays in the server log (token, template, payment, blocked number, …)
  console.error('[requestLoginCode] WhatsApp refused the code:', err.code, err.error_subcode, err.message);
  if (err.code !== undefined && RATE_LIMITED.has(err.code)) {
    throw new HttpsError('resource-exhausted', 'Too many codes requested. Please wait and try again.');
  }
  throw new HttpsError('unavailable', 'The code could not be sent. Please try again later.');
}

export const requestLoginCode = onCall<
  { phone?: string; lang?: string; channel?: string },
  Promise<{ ok: true; retryAfter: number; channel: LoginChannel; channels: LoginChannel[] }>
>(
  { region: REGION, secrets: [whatsappToken, telegramGatewayToken, playReviewLogin], maxInstances: 5, timeoutSeconds: 20 },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign-in is required.');
    const phone = normalizeKzPhone(request.data?.phone);
    if (!phone) throw new HttpsError('invalid-argument', 'A Kazakhstan mobile number is required.');

    const now = Date.now();
    const tooMany = () => new HttpsError('resource-exhausted', 'Too many codes requested. Please wait and try again.');
    const phoneKey = codeDocId(phone);
    // One code a minute and a few an hour per number, per account and per network address,
    // plus one ceiling for the whole app
    if (!(await allowCall(`otp_phone_min_${phoneKey}`, 1, now, 60 * 1000))) throw tooMany();
    if (!(await allowCall(`otp_phone_day_${phoneKey}`, 8, now, DAY_MS))) throw tooMany();
    if (!(await allowCall(`otp_uid_${request.auth.uid}`, 5, now, 3600 * 1000))) throw tooMany();
    const ip = clientIp(request.rawRequest);
    if (ip && !(await allowCall(`otp_ip_${sha256(ip).slice(0, 32)}`, 10, now, 3600 * 1000))) throw tooMany();
    if (!(await allowCall('otp_global_day', GLOBAL_DAILY_CODES, now, DAY_MS))) throw tooMany();

    const reviewCode = reviewCodeFor(phone);
    // The channel the app asked for when it is set up, else the preferred one
    const channels = loginChannels();
    const wanted = request.data?.channel;
    const channel = channels.find((c) => c === wanted) || channels[0];
    if (!channel && !reviewCode) {
      console.error('[requestLoginCode] Neither WhatsApp nor Telegram is set up');
      throw new HttpsError('failed-precondition', 'Phone login is not set up yet.');
    }
    const code = reviewCode || String(crypto.randomInt(0, 1000000)).padStart(6, '0');
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

    if (!reviewCode) {
      if (channel === 'telegram') await sendTelegramCode(phone, code);
      else await sendWhatsAppCode(phone, code, request.data?.lang);
    }
    return { ok: true, retryAfter: 60, channel: channel || 'whatsapp', channels };
  }
);

/**
 * The consent given in the login form (privacy policy and terms of this version), kept on the server:
 * consents/{uid} holds the latest, consents/{uid}/history one entry per login. Server time, never
 * written by the app (firestore.rules).
 */
export async function recordConsent(uid: string, version: string, ip: string, now = Date.now()): Promise<void> {
  const db = getFirestore();
  const entry = {
    version,
    acceptedAt: FieldValue.serverTimestamp(),
    method: 'phone_login',
    // Only a short fingerprint of the network address, enough to tell logins apart
    ...(ip ? { ipHash: sha256(`consent:${ip}`).slice(0, 16) } : {}),
  };
  const batch = db.batch();
  batch.set(db.collection('consents').doc(uid), { uid, ...entry }, { merge: true });
  batch.set(db.collection('consents').doc(uid).collection('history').doc(String(now)), entry);
  await batch.commit();
}

export const verifyLoginCode = onCall<{ phone?: string; code?: string; deviceId?: string; consentVersion?: string }, Promise<{ token: string }>>(
  { region: REGION, maxInstances: 5, timeoutSeconds: 20 },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Sign-in is required.');
    // A few checks an hour per account and per network address (every code allows five tries; the
    // limits on sending codes keep the number of codes small), so the endpoint can't be flooded
    const now = Date.now();
    const tooMany = () => new HttpsError('resource-exhausted', 'Too many tries. Please wait and try again.');
    if (!(await allowCall(`otpv_uid_${callerUid}`, 15, now, 3600 * 1000))) throw tooMany();
    const ip = clientIp(request.rawRequest);
    if (ip && !(await allowCall(`otpv_ip_${sha256(ip).slice(0, 32)}`, 40, now, 3600 * 1000))) throw tooMany();
    const phone = normalizeKzPhone(request.data?.phone);
    const code = String(request.data?.code || '').replace(/\D/g, '');
    if (!phone || code.length !== 6) throw new HttpsError('invalid-argument', 'Invalid code.');
    // The login form can only be sent with the consent box ticked; the version it showed comes along
    const consentVersion = String(request.data?.consentVersion || '').trim();
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?$/.test(consentVersion)) {
      throw new HttpsError('failed-precondition', 'Consent to the privacy policy is required.');
    }

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
    await recordConsent(uid, consentVersion, ip);
    const token = await auth.createCustomToken(uid);
    // Which phone and network the account uses, for the review check (signals.ts); never fails the login
    await recordLoginSignals(uid, request.data?.deviceId, ip);
    return { token };
  }
);
