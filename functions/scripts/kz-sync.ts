/**
 * Full sync of the Kazakhstan copy of personal data (syncAll in src/kzMirror.ts), run by the
 * "Kazakistan kopyası" workflow every night and on demand.
 *
 *   KZ_STORAGE_KEY_ID=… KZ_STORAGE_SECRET=… GCLOUD_PROJECT=kerek-9d153 npx tsx scripts/kz-sync.ts
 *
 * Prints counts only (no data) and exits with 1 when something could not be synced or a
 * collection's copy count differs from Firestore, so the workflow run fails and GitHub e-mails it.
 */
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { syncAll, SyncTarget } from '../src/kzMirror';

const env = (name: string, fallback?: string) => {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

const Bucket = env('KZ_STORAGE_BUCKET', 'kerek-kz-data');
const client = new S3Client({
  region: env('KZ_STORAGE_REGION', 'kz1'),
  endpoint: env('KZ_STORAGE_ENDPOINT', 'https://storage.yandexcloud.kz'),
  credentials: { accessKeyId: env('KZ_STORAGE_KEY_ID'), secretAccessKey: env('KZ_STORAGE_SECRET') },
  forcePathStyle: true,
});

const target: SyncTarget = {
  async put(Key, Body, ContentType) {
    await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
  },
  async remove(Key) {
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
  },
  async list(Prefix) {
    const keys: string[] = [];
    let ContinuationToken: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
      for (const o of page.Contents || []) if (o.Key) keys.push(o.Key);
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return keys;
  },
};

async function main() {
  const report = await syncAll(target, env('APP_STORAGE_BUCKET', 'kerek-9d153.firebasestorage.app'));
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log(`${pad('Koleksiyon', 36)}${pad('Firestore', 11)}Kazakistan`);
  let mismatch = 0;
  for (const c of report.collections) {
    const ok = c.firestore === c.kazakhstan;
    if (!ok) mismatch++;
    console.log(`${pad(c.pattern, 36)}${pad(c.firestore, 11)}${c.kazakhstan}${ok ? '' : '  ← tutmuyor'}`);
  }
  const filesOk = report.files.storage === report.files.kazakhstan;
  if (!filesOk) mismatch++;
  const storage = report.files.storage < 0 ? 'okunamadı' : report.files.storage;
  console.log(`${pad('Dosyalar', 36)}${pad(storage, 11)}${report.files.kazakhstan}${filesOk ? '' : '  ← tutmuyor'}`);
  console.log(`\nYazılan kopya: ${report.copied}, silinen kopya: ${report.removed}, hata: ${report.failed.length}`);
  if (report.failed.length) console.log(`İlk hatalar: ${report.failed.slice(0, 5).join(', ')}`);
  process.exit(report.failed.length || mismatch ? 1 : 0);
}

main().catch((err) => {
  console.error('KZ sync failed:', err);
  process.exit(1);
});
