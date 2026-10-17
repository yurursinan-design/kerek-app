/**
 * Request file links stop working when the request's audience changes, and a deleted account's files
 * are removed on the server (functions/src/fileLinks.ts), against the Firestore and Storage emulators.
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
  const flPath = '../functions/src/fileLinks';
  const fl = await import(flPath);
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getStorage } = requireFromFunctions('firebase-admin/storage');
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');

  // --- Who may see the files changed?
  const open = { status: 'OFFERS_RECEIVED', cityId: 'kyzylorda' };
  assert(!fl.audienceChanged({ status: 'OPEN', cityId: 'kyzylorda' }, open), 'A new offer on an open request changes nothing');
  assert(fl.audienceChanged(open, { ...open, status: 'PROVIDER_SELECTED', selectedOfferId: 'o1' }), 'Choosing a master closes the files to the other masters');
  assert(fl.audienceChanged(open, { ...open, status: 'CANCELLED' }), 'A cancelled request closes its files');
  assert(fl.audienceChanged({ status: 'PROVIDER_SELECTED', selectedOfferId: 'o1' }, { status: 'PROVIDER_SELECTED', selectedOfferId: 'o2' }), 'Another master chosen');
  assert(!fl.audienceChanged({ status: 'IN_PROGRESS', selectedOfferId: 'o1' }, { status: 'COMPLETED', selectedOfferId: 'o1' }), 'Finishing the job keeps the same people');

  // --- An old link stops working once the files get new links
  const bucketName = `${process.env.GCLOUD_PROJECT}.appspot.com`;
  const tail = String(Date.now()).slice(-7);
  const name = `requests/req_links_${tail}/att0`;
  const oldToken = `old-${tail}`;
  const url = (token: string) =>
    `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(name)}?alt=media&token=${token}`;
  try {
    await getStorage().bucket(bucketName).file(name).save(Buffer.from('photo-bytes'), {
      contentType: 'image/jpeg',
      metadata: { metadata: { firebaseStorageDownloadTokens: oldToken } },
    });
    const before = await fetch(url(oldToken));
    assert(before.status === 200 && (await before.text()) === 'photo-bytes', 'The link opens the file while the request is open', before.status);
    const wrong = await fetch(url('not-the-token'));
    assert(wrong.status !== 200, 'A made-up token does not open the file', wrong.status);

    const changed = await fl.renewFileLinks(bucketName, `requests/req_links_${tail}/`);
    assert(changed === 1, 'The request file gets a new link', changed);
    const after = await fetch(url(oldToken));
    assert(after.status !== 200, 'The old link no longer opens the file', after.status);
    const [meta] = await getStorage().bucket(bucketName).file(name).getMetadata();
    const fresh = String(meta.metadata?.firebaseStorageDownloadTokens || '');
    const again = await fetch(url(fresh));
    assert(Boolean(fresh) && fresh !== oldToken && again.status === 200, 'The new link opens it', again.status);
  } catch (err: any) {
    assert(false, 'Storage emulator reachable for the link check', String(err?.message || err));
  }

  // --- Deleting an account removes its files, also an upload whose record was never saved
  try {
    const bucket = getStorage().bucket(bucketName);
    const db = getFirestore();
    const who = `erase_${tail}`;
    await db.collection('requests').doc(`req_er_${tail}`).set({ customerId: who, status: 'CANCELLED', attachments: [] });
    await db.collection('requests').doc(`req_keep_${tail}`).set({ customerId: `other_${tail}`, status: 'OPEN' });
    for (const n of [`requests/req_er_${tail}/att0`, `requests/req_er_${tail}/att3`, `providers/${who}/portfolio/p0`, `requests/req_keep_${tail}/att0`]) {
      await bucket.file(n).save(Buffer.from('x'), { contentType: 'image/jpeg' });
    }
    const removed = await fl.eraseAccountFiles(bucketName, who);
    const exists = async (n: string) => (await bucket.file(n).exists())[0];
    assert(removed === 3, 'The account\'s request and portfolio files are deleted', removed);
    assert(!(await exists(`requests/req_er_${tail}/att3`)) && !(await exists(`providers/${who}/portfolio/p0`)), 'Files not listed on the request are deleted too');
    assert(await exists(`requests/req_keep_${tail}/att0`), "Another customer's files stay");
  } catch (err: any) {
    assert(false, 'Storage emulator reachable for the erasure check', String(err?.message || err));
  }

  console.log(failed ? `\nFILE LINKS: ${failed} FAILED` : '\nFILE LINKS: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
