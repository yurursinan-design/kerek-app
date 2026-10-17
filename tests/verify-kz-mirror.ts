/**
 * Copy of personal data in Kazakhstan (functions/src/kzMirror.ts), against the Firestore and
 * Storage emulators with the Kazakhstan bucket replaced by an in-memory one: a saved document
 * and a file are copied, a changed document overwrites its copy with the current state (also
 * when an old event comes late), and deleting removes the copy.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';

let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
    failed++;
  }
}

async function main() {
  const modulePath = '../functions/src/kzMirror';
  const m = await import(modulePath);
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getFirestore, Timestamp } = requireFromFunctions('firebase-admin/firestore');
  const { getStorage } = requireFromFunctions('firebase-admin/storage');
  const db = getFirestore();

  const kz = new Map<string, { body: string; type: string }>();
  const target = {
    put: async (key: string, body: Buffer | string, type: string) => {
      kz.set(key, { body: Buffer.isBuffer(body) ? body.toString('utf8') : body, type });
    },
    remove: async (key: string) => {
      kz.delete(key);
    },
  };

  const tail = String(Date.now()).slice(-7);
  const path = `requestContacts/req_kz_${tail}`;

  // 1. A saved document is copied as JSON with its current data
  await db.doc(path).set({ customerId: 'u1', customerPhone: '+77011234567', createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 13)) });
  assert((await m.mirrorDocument(path, target)) === 'put', 'Document copy is written');
  const copy = JSON.parse(kz.get(`firestore/${path}.json`)?.body || '{}');
  assert(copy.data?.customerPhone === '+77011234567' && copy.data?.createdAt === '2026-10-13T00:00:00.000Z', 'The copy holds the data, timestamps as text', copy);

  // 2. A change overwrites the copy; replaying an old event still writes the current state
  await db.doc(path).update({ customerPhone: '+77019998877' });
  await m.mirrorDocument(path, target);
  await m.mirrorDocument(path, target);
  assert(JSON.parse(kz.get(`firestore/${path}.json`)!.body).data.customerPhone === '+77019998877', 'The copy follows the latest state');

  // 3. Deleting the document removes the copy
  await db.doc(path).delete();
  assert((await m.mirrorDocument(path, target)) === 'removed' && !kz.has(`firestore/${path}.json`), 'Deleted document: copy removed');

  // 4. Uploaded files are copied and removed with the original
  const bucketName = `${process.env.GCLOUD_PROJECT}.appspot.com`;
  const fileName = `requests/req_kz_${tail}/att0`;
  try {
    await getStorage().bucket(bucketName).file(fileName).save(Buffer.from('photo-bytes'), { contentType: 'image/jpeg' });
    assert((await m.mirrorFile(bucketName, fileName, target)) === 'put', 'File copy is written');
    assert(kz.get(`storage/${fileName}`)?.body === 'photo-bytes' && kz.get(`storage/${fileName}`)?.type === 'image/jpeg', 'The file copy has the same content and type');
    await getStorage().bucket(bucketName).file(fileName).delete();
    assert((await m.mirrorFile(bucketName, fileName, target)) === 'removed' && !kz.has(`storage/${fileName}`), 'Deleted file: copy removed');
  } catch (err: any) {
    assert(false, 'Storage emulator reachable for the file copy check', String(err?.message || err));
  }

  // 4b. Two changes handled at the same time: the slower one must not leave an older version or
  //     bring back a deleted copy
  const gated = () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let holdFirst = true;
    const t = {
      put: async (key: string, body: Buffer | string, type: string) => {
        if (holdFirst) {
          holdFirst = false;
          await gate;
        }
        await target.put(key, body, type);
      },
      remove: (key: string) => target.remove(key),
    };
    return { t, release: () => release() };
  };
  const racePath = `requestContacts/req_race_${tail}`;
  const raceKey = `firestore/${racePath}.json`;
  await db.doc(racePath).set({ customerId: 'u1', version: 1 });
  const slow = gated();
  const slowRun = m.mirrorDocument(racePath, slow.t);
  await new Promise((r) => setTimeout(r, 300));
  await db.doc(racePath).update({ version: 2 });
  await m.mirrorDocument(racePath, target);
  slow.release();
  await slowRun;
  assert(JSON.parse(kz.get(raceKey)?.body || '{}').data?.version === 2, 'A slow older write is corrected: the copy ends at the newest version');

  const delPath = `requestContacts/req_racedel_${tail}`;
  await db.doc(delPath).set({ customerId: 'u1', version: 1 });
  const slow2 = gated();
  const slowRun2 = m.mirrorDocument(delPath, slow2.t);
  await new Promise((r) => setTimeout(r, 300));
  await db.doc(delPath).delete();
  await m.mirrorDocument(delPath, target);
  slow2.release();
  await slowRun2;
  assert(!kz.has(`firestore/${delPath}.json`), 'A slow write after a deletion does not bring the deleted copy back');

  // 5. Every collection with personal data is copied
  for (const c of ['users', 'providers', 'requests', 'requestContacts', 'offers', 'reviews', 'conversations', 'appointments', 'notifications', 'reports', 'pushTokens', 'customerReviews', 'bans', 'reviewSubmissions', 'accountSignals', 'consents', 'adminLog']) {
    assert(m.MIRRORED_PATHS.some((p: string) => p.startsWith(`${c}/`)), `Collection ${c} is copied`);
  }
  assert(m.MIRRORED_PATHS.includes('conversations/{cid}/messages/{id}'), 'Chat messages are copied');

  console.log(failed ? `\nKZ COPY: ${failed} FAILED` : '\nKZ COPY: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('KZ copy test error:', err);
  process.exit(1);
});
