/**
 * Copy of all personal data in Kazakhstan (Law of the RK No. 94-V, art. 12 p. 2: personal data
 * are stored in a database located in the Republic of Kazakhstan).
 *
 * Every document of the collections that hold personal data, and every uploaded file, is kept up
 * to date in an object storage bucket in a Kazakhstan data centre (Yandex Cloud region kz1,
 * S3-compatible API): documents as JSON under firestore/<path>.json, files under storage/<path>.
 * Deleting a document or file deletes its copy.
 *
 * Each change re-reads the current state from Firestore / Cloud Storage before writing, so a
 * retried or late event can't put back an older version; failures are retried by the platform.
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
const appBucket = defineString('APP_STORAGE_BUCKET', { default: 'kerek-9d153.firebasestorage.app' });

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

/** Brings the copy of one document in line with its current state. */
export async function mirrorDocument(path: string, target: MirrorTarget = s3Target()): Promise<'put' | 'removed'> {
  const snap = await getFirestore().doc(path).get();
  const key = `firestore/${path}.json`;
  if (!snap.exists) {
    await target.remove(key);
    return 'removed';
  }
  const body = JSON.stringify({ path, updatedAt: snap.updateTime?.toDate().toISOString() || null, data: toJson(snap.data()) });
  await target.put(key, body, 'application/json');
  return 'put';
}

/** Brings the copy of one uploaded file in line with Cloud Storage (copied, or removed when gone). */
export async function mirrorFile(bucket: string, name: string, target: MirrorTarget = s3Target()): Promise<'put' | 'removed'> {
  const file = getStorage().bucket(bucket).file(name);
  const [exists] = await file.exists();
  const key = `storage/${name}`;
  if (!exists) {
    await target.remove(key);
    return 'removed';
  }
  const [[meta], [contents]] = await Promise.all([file.getMetadata(), file.download()]);
  await target.put(key, contents, String(meta.contentType || 'application/octet-stream'));
  return 'put';
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

export const kzMirrorFileSaved = onObjectFinalized({ ...OPTS, bucket: appBucket, memory: '512MiB' }, async (event) => {
  await mirrorFile(event.data.bucket, event.data.name);
});

export const kzMirrorFileDeleted = onObjectDeleted({ ...OPTS, bucket: appBucket }, async (event) => {
  await mirrorFile(event.data.bucket, event.data.name);
});
