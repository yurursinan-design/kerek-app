/**
 * Request files are opened through links that carry a download token. A link keeps working for
 * whoever holds it, even after the security rules would no longer let that person open the file
 * (a master of the city once the customer has chosen someone else, everyone after a cancellation).
 * So whenever the audience of a request changes, its files get new tokens: old links stop working,
 * and people who may still see the files get fresh links from Cloud Storage (rules checked again).
 */
import * as crypto from 'crypto';
import { DocumentData, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { appBucket } from './kzMirror';
import './limits';

/** Statuses in which every master of the city can see the request and its files (storage.rules) */
const OPEN = ['OPEN', 'NEW', 'MATCHING', 'OFFERS_RECEIVED'];

/** Whether the people who may open a request's files changed between two versions of it. */
export function audienceChanged(before: DocumentData | undefined, after: DocumentData | undefined): boolean {
  const wasOpen = OPEN.includes(String(before?.status || ''));
  const isOpen = OPEN.includes(String(after?.status || ''));
  return (
    (wasOpen && !isOpen) ||
    String(before?.selectedOfferId || '') !== String(after?.selectedOfferId || '') ||
    String(before?.cityId || '') !== String(after?.cityId || '') ||
    (after?.status === 'CANCELLED' && before?.status !== 'CANCELLED')
  );
}

const tokensOf = (meta: { metadata?: Record<string, unknown> | null }) =>
  String(meta.metadata?.firebaseStorageDownloadTokens || '')
    .split(',')
    .filter(Boolean);

type StoredFile = ReturnType<ReturnType<ReturnType<typeof getStorage>['bucket']>['file']>;

/** One file gets a new download token and loses its old ones. */
async function renewFileLink(file: StoredFile): Promise<void> {
  const [meta] = await file.getMetadata();
  const old = tokensOf(meta);
  const fresh = crypto.randomUUID();
  await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: fresh } });
  const [after] = await file.getMetadata();
  if (!old.some((t) => tokensOf(after).includes(t))) return;
  // The new token was added next to the old ones (the emulator does this): the file is written
  // again with only the new token, so the old links stop working either way
  const [bytes] = await file.download();
  const custom: Record<string, unknown> = { ...(meta.metadata || {}) };
  delete custom.firebaseStorageDownloadTokens;
  await file.delete();
  await file.save(bytes, {
    contentType: meta.contentType,
    metadata: { metadata: { ...custom, firebaseStorageDownloadTokens: fresh } },
  });
}

/** Gives every file under a folder a new download token; returns how many files were changed. */
export async function renewFileLinks(bucketName: string, prefix: string): Promise<number> {
  const [files] = await getStorage().bucket(bucketName).getFiles({ prefix });
  for (const file of files) await renewFileLink(file);
  return files.length;
}

/**
 * Deleting an account removes the photos, videos and voice notes of the account's requests and its
 * portfolio photos, whatever the request documents say about them (an upload whose record was never
 * saved is found too). Returns how many files were deleted.
 */
export async function eraseAccountFiles(bucketName: string, uid: string): Promise<number> {
  if (!uid) return 0;
  const bucket = getStorage().bucket(bucketName);
  const requests = await getFirestore().collection('requests').where('customerId', '==', uid).limit(500).get();
  const prefixes = [...requests.docs.map((d) => `requests/${d.id}/`), `providers/${uid}/portfolio/`];
  let deleted = 0;
  for (const prefix of prefixes) {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
      deleted++;
    }
  }
  return deleted;
}

export const renewRequestFileLinks = onDocumentUpdated(
  { document: 'requests/{requestId}', region: 'asia-south1', maxInstances: 5 },
  async (event) => {
    if (!audienceChanged(event.data?.before?.data(), event.data?.after?.data())) return;
    await renewFileLinks(appBucket.value(), `requests/${event.params.requestId}/`);
  }
);
