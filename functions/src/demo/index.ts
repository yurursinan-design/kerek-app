import * as crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { allowCall, clientIp, DAY_MS } from '../limits';
import { buildBusiness, BUSINESS_TYPES } from './builder';
import { seedBookings, seedOrders } from './calendar';
import { customerTurn, ownerAction, type CustomerInput, type MediaInput, type OwnerAction } from './engine';
import { cloneTemplate } from './templates';
import type { Session } from './types';

/**
 * The WhatsApp assistant demo page (/demo/) calls these. Each visitor (signed in anonymously) gets
 * their own demoSessions/{id}; clients have no direct access (default-deny rules), only these
 * functions, which are limited per visitor, per network address and per day overall.
 */

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const REGION = 'asia-south1';
const SESSION_TTL_MS = 3 * DAY_MS;
const LOCK_MS = 75_000;
const COLLECTION = 'demoSessions';

const AI_OPTS = { region: REGION, secrets: [geminiApiKey], maxInstances: 5, timeoutSeconds: 70, memory: '512MiB' as const };

function caller(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return uid;
}

function ipKey(request: CallableRequest): string {
  const ip = clientIp(request.rawRequest);
  return ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32) : 'noip';
}

async function limit(checks: [string, number, number][]): Promise<void> {
  const now = Date.now();
  for (const [key, max, windowMs] of checks) {
    if (!(await allowCall(key, max, now, windowMs))) throw new HttpsError('resource-exhausted', 'Too many requests, try again later.');
  }
}

function media(raw: unknown, kinds: string[], maxChars: number): MediaInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const mime = String(r.mime ?? '');
  const data = String(r.data ?? '');
  if (!kinds.includes(mime) || !data || data.length > maxChars || !/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200))) {
    throw new HttpsError('invalid-argument', 'Bad file.');
  }
  return { mime, data };
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** What the page gets back: the whole demo, minus internal fields */
function view(id: string, s: Session) {
  return {
    id,
    business: s.business,
    bookings: s.bookings,
    orders: s.orders,
    messages: s.messages,
    alerts: s.alerts,
    consent: s.consent,
    chatLang: s.chatLang,
    botPaused: s.botPaused,
    expiresAt: s.expiresAt,
  };
}

/** Takes the session for one change at a time (two taps at once would overwrite each other). */
async function withSession<T>(id: unknown, uid: string, work: (s: Session) => Promise<T>): Promise<{ session: Session; result: T }> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)) throw new HttpsError('invalid-argument', 'Bad demo id.');
  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(id);
  const now = Date.now();
  const session = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.data() as Session | undefined;
    if (!s || s.ownerUid !== uid || s.expiresAt < now) throw new HttpsError('not-found', 'Demo not found.');
    if (s.busyUntil > now) throw new HttpsError('aborted', 'Busy, try again in a moment.');
    tx.update(ref, { busyUntil: now + LOCK_MS });
    return s;
  });
  try {
    const result = await work(session);
    session.busyUntil = 0;
    await ref.set(session);
    return { session, result };
  } catch (err) {
    await ref.update({ busyUntil: 0 }).catch(() => undefined);
    throw err;
  }
}

/** Expired demos are removed a few at a time when new ones start (no scheduled job needed). */
async function cleanupExpired(): Promise<void> {
  const db = getFirestore();
  const old = await db.collection(COLLECTION).where('expiresAt', '<', Date.now()).limit(20).get();
  await Promise.all(old.docs.map((d) => d.ref.delete()));
}

export const demoStart = onCall(AI_OPTS, async (request) => {
  const uid = caller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const ip = ipKey(request);
  await limit([
    [`demo_start_${uid}`, 20, DAY_MS],
    [`demo_start_ip_${ip}`, 60, DAY_MS],
    ['demo_start_day', 2000, DAY_MS],
  ]);
  let business = typeof data.template === 'string' ? cloneTemplate(data.template) : null;
  if (!business && data.build && typeof data.build === 'object') {
    const build = data.build as Record<string, unknown>;
    const name = String(build.name ?? '').trim();
    const text = String(build.text ?? '').trim();
    const photo = media(build.photo, IMAGE_TYPES, 4_000_000);
    if (name.length < 2 || name.length > 40) throw new HttpsError('invalid-argument', 'Name: 2–40 characters.');
    if (!photo && text.length < 10) throw new HttpsError('invalid-argument', 'Add a photo or the price list text.');
    if (!BUSINESS_TYPES[String(build.type ?? '')]) throw new HttpsError('invalid-argument', 'Bad type.');
    await limit([
      [`demo_build_${uid}`, 8, DAY_MS],
      [`demo_build_ip_${ip}`, 25, DAY_MS],
    ]);
    try {
      business = await buildBusiness(new GoogleGenAI({ apiKey: geminiApiKey.value() }), {
        name,
        type: String(build.type),
        text,
        photo,
        staff: String(build.staff ?? ''),
        address: String(build.address ?? ''),
      });
    } catch (err) {
      console.warn('[demo] build failed:', err instanceof Error ? err.message : err);
      throw new HttpsError('failed-precondition', 'Could not read the price list.');
    }
  }
  if (!business) throw new HttpsError('invalid-argument', 'Choose a demo.');

  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc();
  const now = Date.now();
  const session: Session = {
    ownerUid: uid,
    business,
    bookings: seedBookings(business, now, ref.id),
    orders: seedOrders(business, now, ref.id),
    messages: [],
    alerts: [],
    consent: 'none',
    chatLang: data.lang === 'kz' ? 'kz' : 'ru',
    botPaused: false,
    seq: 0,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    busyUntil: 0,
  };
  await ref.set(session);
  await cleanupExpired().catch((err) => console.warn('[demo] cleanup failed:', err instanceof Error ? err.message : err));
  return view(ref.id, session);
});

export const demoSend = onCall(AI_OPTS, async (request) => {
  const uid = caller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  await limit([
    [`demo_msg_${uid}`, 15, 60_000],
    [`demo_msg_day_${uid}`, 250, DAY_MS],
    [`demo_msg_ip_${ipKey(request)}`, 800, DAY_MS],
    ['demo_msg_day', 6000, DAY_MS],
  ]);
  const input: CustomerInput = {};
  if (typeof data.text === 'string') input.text = data.text.slice(0, 1000);
  if (typeof data.button === 'string') input.button = data.button.slice(0, 60);
  if (data.voice) {
    const v = media(data.voice, ['audio/wav'], 2_600_000)!;
    const seconds = Number((data.voice as Record<string, unknown>).seconds);
    input.voice = { ...v, seconds: Number.isFinite(seconds) ? Math.min(60, Math.max(1, seconds)) : 1 };
  }
  if (data.photo) input.photo = media(data.photo, IMAGE_TYPES, 2_000_000);
  const { session } = await withSession(data.id, uid, async (s) => {
    try {
      await customerTurn(s, input, new GoogleGenAI({ apiKey: geminiApiKey.value() }), Date.now());
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('invalid-argument', err instanceof Error ? err.message : 'Bad message.');
    }
  });
  return view(String(data.id), session);
});

export const demoOwner = onCall({ region: REGION, maxInstances: 5, timeoutSeconds: 20 }, async (request) => {
  const uid = caller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  await limit([[`demo_owner_${uid}`, 60, 60_000]]);
  if (data.action === 'get') {
    const id = String(data.id ?? '');
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw new HttpsError('invalid-argument', 'Bad demo id.');
    const snap = await getFirestore().collection(COLLECTION).doc(id).get();
    const s = snap.data() as Session | undefined;
    if (!s || s.ownerUid !== uid || s.expiresAt < Date.now()) throw new HttpsError('not-found', 'Demo not found.');
    return view(id, s);
  }
  const { session } = await withSession(data.id, uid, async (s) => {
    try {
      ownerAction(s, { action: String(data.action), id: String(data.ref ?? ''), text: String(data.text ?? '') } as OwnerAction, Date.now());
    } catch (err) {
      throw new HttpsError('invalid-argument', err instanceof Error ? err.message : 'Bad action.');
    }
  });
  return view(String(data.id), session);
});
