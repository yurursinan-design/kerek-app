// Masters pre-register on the website before the app is in the stores (form on the home page,
// scripts/landingPage.ts). The page posts the form here; the entry is kept in masterSignups/{phone}
// for the operator's panel (the security rules let only the operator read it), copied to Kazakhstan
// like all personal data (kzMirror.ts), and deleted after a year by the Firestore TTL on expireAt.
// Sending the form again with the same number updates the entry.
import * as crypto from 'crypto';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { allowCall, clientIp, DAY_MS } from './limits';
import { checkMasterSignup } from './masterSignupFields';

/** Pages allowed to send the form: the website, the project's first site and its PR previews */
export const SIGNUP_ORIGINS: (string | RegExp)[] = [
  'https://tapsyrapp.com',
  'https://www.tapsyrapp.com',
  'https://tapsyr.web.app',
  'https://tapsyr.firebaseapp.com',
  'https://kerek-9d153.web.app',
  'https://kerek-9d153.firebaseapp.com',
  /^https:\/\/(tapsyr|kerek-9d153)--[a-z0-9-]+\.web\.app$/,
];

/** Kept this long, then deleted (privacy policy, section 6) */
const KEEP_MS = 365 * DAY_MS;

interface SignupRequest {
  method: string;
  body?: unknown;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}
interface SignupResponse {
  status(code: number): SignupResponse;
  json(body: unknown): void;
}

/** The form's handling, without the cross-site rules around it (tests call it directly). */
export async function handleMasterSignup(req: SignupRequest, res: SignupResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method' });
    return;
  }
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  // A field people don't see: filled in only by bots
  if (typeof body.website === 'string' && body.website.trim()) {
    res.json({ ok: true });
    return;
  }
  const now = Date.now();
  const ip = clientIp(req);
  const ipKey = crypto.createHash('sha256').update(ip || 'none').digest('hex').slice(0, 32);
  if (!(await allowCall(`signup_ip_${ipKey}`, 5, now, 3600 * 1000)) || !(await allowCall('signup_day', 300, now, DAY_MS))) {
    res.status(429).json({ ok: false, error: 'limit' });
    return;
  }
  const checked = checkMasterSignup(body);
  if (!checked.ok) {
    res.status(400).json({ ok: false, error: 'invalid', field: checked.field });
    return;
  }
  const s = checked.value;
  const id = s.phone.slice(1);
  if (!(await allowCall(`signup_phone_${id}`, 3, now, DAY_MS))) {
    res.status(429).json({ ok: false, error: 'limit' });
    return;
  }
  const db = getFirestore();
  const ref = db.collection('masterSignups').doc(id);
  try {
    await db.runTransaction(async (tx) => {
      const old = await tx.get(ref);
      tx.set(
        ref,
        {
          ...s,
          source: 'website',
          consentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          expireAt: Timestamp.fromMillis(now + KEEP_MS),
          ...(old.exists ? {} : { createdAt: FieldValue.serverTimestamp(), status: 'new' }),
        },
        { merge: true }
      );
    });
  } catch (err) {
    console.error('[masterSignup] not saved:', err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: 'server' });
    return;
  }
  res.json({ ok: true });
}

export const masterSignup = onRequest(
  { region: 'asia-south1', cors: SIGNUP_ORIGINS, maxInstances: 3, timeoutSeconds: 15, memory: '256MiB' },
  handleMasterSignup
);
