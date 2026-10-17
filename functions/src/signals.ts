/**
 * Which phone and which network each account logs in from, kept so the review check
 * (reviewModeration.ts) can notice two accounts of one person, for example a master reviewing their
 * own work from a second number.
 *
 * Only one-way hashes are stored, in accountSignals/{uid}: no app can read or write that collection
 * (default-deny rules), and it is deleted together with the account (cleanupAccountData).
 * - device:  the random id the app keeps on the phone (src/services/deviceId.ts)
 * - network: the IP address of the login; for IPv6 only its first half (one home or office network)
 */
import * as crypto from 'crypto';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { eraseAccountFiles } from './fileLinks';
import { appBucket } from './kzMirror';
import './limits';

/** Hashes kept per account: the newest ones */
const MAX_DEVICES = 10;
const MAX_NETWORKS = 20;
/** Accounts not seen for this long are dropped (TTL policy on expireAt, firestore.indexes.json) */
const KEEP_MS = 400 * 24 * 3600 * 1000;

export function signalHash(kind: 'device' | 'network', value: string): string {
  return crypto.createHash('sha256').update(`tapsyr:${kind}:${value}`).digest('hex').slice(0, 24);
}

/** The random device id the app sends: letters, digits and dashes, 16 to 64 characters. */
export function cleanDeviceId(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^[A-Za-z0-9-]{16,64}$/.test(s) ? s : null;
}

/** The network part of an IP address: the whole IPv4 address, or the first four groups of IPv6. */
export function networkOf(ip: string): string | null {
  const s = String(ip || '').trim().toLowerCase();
  if (!s) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) return v4[1];
  if (!s.includes(':')) return null;
  // Expand "::" so the first four groups can be read
  const [head, tail = ''] = s.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = s.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  if (groups.length < 4 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

/** Adds a value at the end of a list (moving it there if already present) and keeps the newest max. */
export function pushNewest(list: unknown, value: string, max: number): string[] {
  const current = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && x !== value) : [];
  return [...current, value].slice(-max);
}

/** Notes the device and network of a successful login. Never throws: a login must not fail on this. */
export async function recordLoginSignals(uid: string, deviceId: unknown, ip: string): Promise<void> {
  try {
    const device = cleanDeviceId(deviceId);
    const network = networkOf(ip);
    if (!uid || (!device && !network)) return;
    const db = getFirestore();
    const ref = db.collection('accountSignals').doc(uid);
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() || {};
      tx.set(
        ref,
        {
          devices: device ? pushNewest(data.devices, signalHash('device', device), MAX_DEVICES) : data.devices || [],
          networks: network ? pushNewest(data.networks, signalHash('network', network), MAX_NETWORKS) : data.networks || [],
          updatedAt: FieldValue.serverTimestamp(),
          expireAt: Timestamp.fromMillis(Date.now() + KEEP_MS),
        },
        { merge: true }
      );
    });
  } catch (err) {
    console.warn('[signals] could not note the login for', uid, err instanceof Error ? err.message : err);
  }
}

/** Reviews keep the job and the stars but drop the name of a deleted account (privacy policy, section 6) */
const NAMES_ON_REVIEWS = [
  ['reviews', 'customerId', 'customerName'],
  ['reviews', 'providerId', 'providerName'],
  ['reviewSubmissions', 'customerId', 'customerName'],
  ['reviewSubmissions', 'providerId', 'providerName'],
] as const;

/** Removes an account's signals and its name on reviews; the reviews themselves stay. */
export async function forgetAccount(uid: string): Promise<void> {
  const db = getFirestore();
  await db.collection('accountSignals').doc(uid).delete();
  for (const [collection, idField, nameField] of NAMES_ON_REVIEWS) {
    const snap = await db.collection(collection).where(idField, '==', uid).limit(500).get();
    const named = snap.docs.filter((d) => d.get(nameField) !== undefined);
    if (named.length === 0) continue;
    const batch = db.batch();
    named.forEach((d) => batch.update(d.ref, { [nameField]: FieldValue.delete() }));
    await batch.commit();
  }
}

/**
 * Deleting an account (the app removes users/{uid}) also forgets it in the review check and removes
 * its request and portfolio files on the server, so an interrupted deletion in the app leaves none.
 */
export const cleanupAccountData = onDocumentDeleted(
  { document: 'users/{uid}', region: 'asia-south1', maxInstances: 5, timeoutSeconds: 300 },
  async (event) => {
    await forgetAccount(event.params.uid);
    await eraseAccountFiles(appBucket.value(), event.params.uid);
  }
);
