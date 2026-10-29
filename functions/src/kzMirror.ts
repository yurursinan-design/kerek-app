/**
 * Copy of all personal data in Kazakhstan (Law of the RK No. 94-V, art. 12 p. 2: personal data
 * are stored in a database located in the Republic of Kazakhstan).
 *
 * Every document of the collections that hold personal data, and every uploaded file, is kept up
 * to date in an object storage bucket in a Kazakhstan data centre (Yandex Cloud region kz1,
 * S3-compatible API): documents as JSON under firestore/<path>.json, files under storage/<path>.
 * Deleting a document or file deletes its copy.
 *
 * Each change re-reads the current state from Firestore / Cloud Storage before writing, and reads
 * it once more after writing: if it changed meanwhile (two events handled at the same time, the
 * slower one writing an older version or putting back a deleted copy), the copy is written again
 * from the current state. So the copy always ends at the latest version, and a deleted document or
 * file stays deleted. Failures are retried by the platform.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onObjectDeleted, onObjectFinalized } from 'firebase-functions/v2/storage';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import './limits';

const kzKeyId = defineSecret('KZ_STORAGE_KEY_ID');
const kzSecret = defineSecret('KZ_STORAGE_SECRET');
const kzBucket = defineString('KZ_STORAGE_BUCKET', { default: 'kerek-kz-data' });
const kzEndpoint = defineString('KZ_STORAGE_ENDPOINT', { default: 'https://storage.yandexcloud.kz' });
const kzRegion = defineString('KZ_STORAGE_REGION', { default: 'kz1' });
// The app's Cloud Storage bucket, named here because the default-bucket lookup fails for this project
export const appBucket = defineString('APP_STORAGE_BUCKET', { default: 'kerek-9d153.firebasestorage.app' });

/** Collections whose documents contain personal data (all of them except short-lived login codes) */
export const MIRRORED_PATHS = [
  'users/{id}',
  'providers/{id}',
  'requests/{id}',
  'requestContacts/{id}',
  'offers/{id}',
  'reviews/{id}',
  'conversations/{id}',
  'conversations/{cid}/messages/{id}',
  'appointments/{id}',
  'notifications/{id}',
  'reports/{id}',
  'pushTokens/{id}',
  'customerReviews/{id}',
  'bans/{id}',
  'reviewSubmissions/{id}',
  'accountSignals/{id}',
  'consents/{id}',
  'consents/{uid}/history/{id}',
  'adminLog/{id}',
  'masterSignups/{id}',
  'supportChats/{id}',
  'supportChats/{cid}/supportMessages/{id}',
];

export interface MirrorTarget {
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

let client: S3Client | null = null;
function s3Target(): MirrorTarget {
  if (!client) {
    client = new S3Client({
      region: kzRegion.value(),
      endpoint: kzEndpoint.value(),
      credentials: { accessKeyId: kzKeyId.value(), secretAccessKey: kzSecret.value() },
      forcePathStyle: true,
    });
  }
  const c = client;
  const Bucket = kzBucket.value();
  return {
    async put(Key, Body, ContentType) {
      await c.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
    },
    async remove(Key) {
      await c.send(new DeleteObjectCommand({ Bucket, Key }));
    },
  };
}

/** Firestore values as plain JSON (timestamps as ISO text, references as paths). */
export function toJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === 'object') {
    const v = value as any;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (typeof v.path === 'string' && typeof v.id === 'string' && v.firestore) return v.path;
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 2) {
      return { latitude: v.latitude, longitude: v.longitude };
    }
    if (Buffer.isBuffer(v)) return v.toString('base64');
    const out: Record<string, unknown> = {};
    for (const [k, inner] of Object.entries(v)) out[k] = toJson(inner);
    return out;
  }
  return value;
}

/** Rounds of write-then-check before giving up (the platform then retries the event) */
const MAX_ROUNDS = 5;

/**
 * Writes the copy from the current state, then checks the state again and repeats while it changed.
 * read() returns the current version (null when gone) and a write for it.
 */
async function converge(read: () => Promise<{ version: string | null; write: () => Promise<'put' | 'removed'> }>): Promise<'put' | 'removed'> {
  let written: string | null | undefined;
  let result: 'put' | 'removed' = 'removed';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const current = await read();
    if (round > 0 && current.version === written) return result;
    result = await current.write();
    written = current.version;
  }
  throw new Error('kzMirror: the source kept changing while it was copied');
}

/** Brings the copy of one document in line with its current state. */
export async function mirrorDocument(path: string, target: MirrorTarget = s3Target()): Promise<'put' | 'removed'> {
  const key = `firestore/${path}.json`;
  return converge(async () => {
    const snap = await getFirestore().doc(path).get();
    if (!snap.exists) {
      return { version: null, write: async () => (await target.remove(key), 'removed' as const) };
    }
    const t = snap.updateTime;
    const body = JSON.stringify({ path, updatedAt: t?.toDate().toISOString() || null, data: toJson(snap.data()) });
    return {
      version: t ? `${t.seconds}.${t.nanoseconds}` : 'unknown',
      write: async () => (await target.put(key, body, 'application/json'), 'put' as const),
    };
  });
}

/** Brings the copy of one uploaded file in line with Cloud Storage (copied, or removed when gone). */
export async function mirrorFile(bucket: string, name: string, target: MirrorTarget = s3Target()): Promise<'put' | 'removed'> {
  const key = `storage/${name}`;
  return converge(async () => {
    const file = getStorage().bucket(bucket).file(name);
    const [exists] = await file.exists();
    if (!exists) return { version: null, write: async () => (await target.remove(key), 'removed' as const) };
    const [meta] = await file.getMetadata();
    const generation = String(meta.generation || '');
    return {
      version: generation || 'unknown',
      write: async () => {
        // The bytes of exactly this version; if it was replaced meanwhile the next round copies the newer one
        const [contents] = await getStorage().bucket(bucket).file(name, generation ? { generation } : {}).download();
        await target.put(key, contents, String(meta.contentType || 'application/octet-stream'));
        return 'put' as const;
      },
    };
  });
}

// ---------------------------------------------------------------- full sync

/** A copy target that can also list what it holds (for the full sync) */
export interface SyncTarget extends MirrorTarget {
  list(prefix: string): Promise<string[]>;
}

export interface SyncReport {
  /** Per mirrored path pattern: documents in Firestore and copies in Kazakhstan after the sync */
  collections: { pattern: string; firestore: number; kazakhstan: number }[];
  files: { storage: number; kazakhstan: number };
  copied: number;
  removed: number;
  /** Paths that could not be synced (the error is logged, the sync goes on) */
  failed: string[];
}

const patternRegex = (pattern: string) => new RegExp(`^${pattern.replace(/\{[^}]+\}/g, '[^/]+')}$`);

/** The mirrored pattern a document path belongs to, or null */
export function patternOf(path: string): string | null {
  return MIRRORED_PATHS.find((p) => patternRegex(p).test(path)) || null;
}

/** Paths of the documents that exist now for one pattern (top-level collection or subcollection) */
async function existingPaths(pattern: string): Promise<string[]> {
  const parts = pattern.split('/');
  const db = getFirestore();
  const snap =
    parts.length === 2
      ? await db.collection(parts[0]).select().get()
      : await db.collectionGroup(parts[parts.length - 2]).select().get();
  const rx = patternRegex(pattern);
  return snap.docs.map((d) => d.ref.path).filter((p) => rx.test(p));
}

/** Runs the jobs with at most `limit` at a time */
async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await job(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Brings the whole Kazakhstan copy in line: every existing document and file is copied, and every
 * copy whose original is gone is removed. The triggers above only see changes, so this also covers
 * data from before they were deployed and events they missed (for example while billing was off).
 */
export async function syncAll(target: SyncTarget, bucket: string, concurrency = 8): Promise<SyncReport> {
  const report: SyncReport = { collections: [], files: { storage: 0, kazakhstan: 0 }, copied: 0, removed: 0, failed: [] };
  const run = async (name: string, sync: () => Promise<'put' | 'removed'>) => {
    try {
      if ((await sync()) === 'put') report.copied++;
      else report.removed++;
    } catch (err) {
      console.error(`kzMirror sync: ${name}:`, err);
      report.failed.push(name);
    }
  };

  // Documents: copy what exists, then remove copies of documents that are gone
  const existing = new Set<string>();
  for (const pattern of MIRRORED_PATHS) for (const p of await existingPaths(pattern)) existing.add(p);
  const keyToPath = (key: string) => key.replace(/^firestore\//, '').replace(/\.json$/, '');
  const stale = (await target.list('firestore/')).map(keyToPath).filter((p) => patternOf(p) && !existing.has(p));
  await pool([...existing, ...stale], concurrency, (p) => run(p, () => mirrorDocument(p, target)));

  // Files: the same for Cloud Storage. A listing that fails (e.g. no permission) is reported
  // and skipped so the document copy above still counts.
  let names: Set<string> | null = null;
  try {
    const [files] = await getStorage().bucket(bucket).getFiles();
    names = new Set(files.map((f) => f.name).filter((n) => !n.endsWith('/')));
  } catch (err) {
    console.error('kzMirror sync: listing files:', err instanceof Error ? err.message : err);
    report.failed.push('storage (listing)');
  }
  if (names) {
    const present = names;
    const staleFiles = (await target.list('storage/')).map((k) => k.replace(/^storage\//, '')).filter((n) => !present.has(n));
    await pool([...present, ...staleFiles], concurrency, (n) => run(`storage/${n}`, () => mirrorFile(bucket, n, target)));
  }

  // What each side holds afterwards
  const copies = (await target.list('firestore/')).map(keyToPath);
  for (const pattern of MIRRORED_PATHS) {
    report.collections.push({
      pattern,
      firestore: [...existing].filter((p) => patternOf(p) === pattern).length,
      kazakhstan: copies.filter((p) => patternOf(p) === pattern).length,
    });
  }
  report.files = { storage: names ? names.size : -1, kazakhstan: (await target.list('storage/')).length };
  return report;
}

// ---------------------------------------------------------------- triggers

const OPTS = {
  region: 'asia-south1',
  secrets: [kzKeyId, kzSecret],
  retry: true,
  maxInstances: 10,
  timeoutSeconds: 60,
};

function mirrorTrigger(document: string) {
  return onDocumentWritten({ ...OPTS, document }, async (event) => {
    const path = event.data?.after?.ref?.path || event.data?.before?.ref?.path;
    if (path) await mirrorDocument(path);
  });
}

export const kzMirrorUsers = mirrorTrigger('users/{id}');
export const kzMirrorProviders = mirrorTrigger('providers/{id}');
export const kzMirrorRequests = mirrorTrigger('requests/{id}');
export const kzMirrorRequestContacts = mirrorTrigger('requestContacts/{id}');
export const kzMirrorOffers = mirrorTrigger('offers/{id}');
export const kzMirrorReviews = mirrorTrigger('reviews/{id}');
export const kzMirrorConversations = mirrorTrigger('conversations/{id}');
export const kzMirrorMessages = mirrorTrigger('conversations/{cid}/messages/{id}');
export const kzMirrorAppointments = mirrorTrigger('appointments/{id}');
export const kzMirrorNotifications = mirrorTrigger('notifications/{id}');
export const kzMirrorReports = mirrorTrigger('reports/{id}');
export const kzMirrorPushTokens = mirrorTrigger('pushTokens/{id}');
export const kzMirrorCustomerReviews = mirrorTrigger('customerReviews/{id}');
export const kzMirrorBans = mirrorTrigger('bans/{id}');
export const kzMirrorReviewSubmissions = mirrorTrigger('reviewSubmissions/{id}');
export const kzMirrorAccountSignals = mirrorTrigger('accountSignals/{id}');
export const kzMirrorConsents = mirrorTrigger('consents/{id}');
export const kzMirrorConsentHistory = mirrorTrigger('consents/{uid}/history/{id}');
export const kzMirrorAdminLog = mirrorTrigger('adminLog/{id}');
export const kzMirrorMasterSignups = mirrorTrigger('masterSignups/{id}');
export const kzMirrorSupportChats = mirrorTrigger('supportChats/{id}');
export const kzMirrorSupportMessages = mirrorTrigger('supportChats/{cid}/supportMessages/{id}');

export const kzMirrorFileSaved = onObjectFinalized({ ...OPTS, bucket: appBucket, memory: '512MiB' }, async (event) => {
  await mirrorFile(event.data.bucket, event.data.name);
});

export const kzMirrorFileDeleted = onObjectDeleted({ ...OPTS, bucket: appBucket }, async (event) => {
  await mirrorFile(event.data.bucket, event.data.name);
});
