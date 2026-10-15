/**
 * Storage Security Rules test suite.
 *
 * Runs the real storage.rules in the Storage emulator, with the Firestore emulator providing
 * the request / conversation / provider documents the rules look up.
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ID = 'demo-kerek';

let testEnv: RulesTestEnvironment;

async function run() {
  console.log('=== STORAGE RULES EMULATOR TESTS ===\n');
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}`);
      console.error(`   Error: ${err?.message || err}`);
      failed++;
    }
  }

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: fs.readFileSync(path.resolve(process.cwd(), 'storage.rules'), 'utf8'),
    },
    firestore: {
      host: '127.0.0.1',
      port: 8088,
      rules: fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });

  await testEnv.clearFirestore();
  await testEnv.clearStorage();

  // Seed: Almaty request owned by alice, a selected offer from the Astana provider "sam",
  // a provider in Almaty ("pat"), and a conversation between alice and sam.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'requests', 'REQ-A1'), { id: 'REQ-A1', customerId: 'alice', cityId: 'almaty', status: 'OPEN' });
    await setDoc(doc(db, 'requests', 'REQ-S1'), {
      id: 'REQ-S1', customerId: 'alice', cityId: 'almaty', status: 'PROVIDER_SELECTED', selectedOfferId: 'OFFER-S1',
    });
    await setDoc(doc(db, 'offers', 'OFFER-S1'), { id: 'OFFER-S1', requestId: 'REQ-S1', providerId: 'sam', providerUserId: 'sam' });
    await setDoc(doc(db, 'providers', 'pat'), { id: 'pat', cityId: 'almaty' });
    await setDoc(doc(db, 'providers', 'sam'), { id: 'sam', cityId: 'astana' });
    await setDoc(doc(db, 'conversations', 'conv_1'), { id: 'conv_1', requestId: 'REQ-S1', customerId: 'alice', providerUserId: 'sam', providerId: 'sam' });
    await setDoc(doc(db, 'requests', 'REQ-C1'), { id: 'REQ-C1', customerId: 'alice', cityId: 'almaty', status: 'CANCELLED', selectedOfferId: 'OFFER-C1' });
    await setDoc(doc(db, 'conversations', 'conv_c'), { id: 'conv_c', requestId: 'REQ-C1', customerId: 'alice', providerUserId: 'sam', providerId: 'sam' });
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'requests/REQ-A1/photo.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
    await uploadBytes(ref(ctx.storage(), 'requests/REQ-A1/att0'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
    await uploadBytes(ref(ctx.storage(), 'requests/REQ-S1/photo.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
    await uploadBytes(ref(ctx.storage(), 'chat/conv_1/m1/a.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
  });

  const bytes = new Uint8Array([1, 2, 3, 4]);
  const storageOf = (uid: string | null) =>
    (uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext()).storage();
  const put = (uid: string | null, p: string, contentType: string, data: Uint8Array = bytes): Promise<unknown> =>
    uploadBytes(ref(storageOf(uid), p), data, { contentType });

  console.log('--- Request uploads ---');
  await test('Owner uploads a JPEG photo to their existing request', () => assertSucceeds(put('alice', 'requests/REQ-A1/att1', 'image/jpeg')));
  await test('Owner uploads a voice note with codec parameter', () => assertSucceeds(put('alice', 'requests/REQ-A1/att2', 'audio/webm;codecs=opus')));
  await test('Owner uploads an MP4 video', () => assertSucceeds(put('alice', 'requests/REQ-A1/att3', 'video/mp4')));
  await test('Upload to a request that does not exist yet is refused', () => assertFails(put('alice', 'requests/REQ-NOPE/att1', 'image/jpeg')));
  await test("Another user can't upload to alice's request", () => assertFails(put('mallory', 'requests/REQ-A1/att5', 'image/jpeg')));
  await test('Signed-out upload is refused', () => assertFails(put(null, 'requests/REQ-A1/att5', 'image/jpeg')));
  await test('HTML upload is refused', () => assertFails(put('alice', 'requests/REQ-A1/att6', 'text/html')));
  await test('SVG upload is refused', () => assertFails(put('alice', 'requests/REQ-A1/att7', 'image/svg+xml')));
  await test('Empty file is refused', () => assertFails(put('alice', 'requests/REQ-A1/att8', 'image/jpeg', new Uint8Array([]))));
  await test('Image over 10 MB is refused', () =>
    assertFails(put('alice', 'requests/REQ-A1/att9', 'image/jpeg', new Uint8Array(10 * 1024 * 1024 + 1))));
  await test('Overwriting an existing file is refused', () => assertFails(put('alice', 'requests/REQ-A1/att0', 'image/jpeg')));
  await test('File names outside the 15 fixed slots are refused', async () => {
    await assertFails(put('alice', 'requests/REQ-A1/new.jpg', 'image/jpeg'));
    await assertFails(put('alice', 'requests/REQ-A1/att15', 'image/jpeg'));
  });
  await test('Upload to a cancelled request is refused', () => assertFails(put('alice', 'requests/REQ-C1/att0', 'image/jpeg')));

  console.log('\n--- Request file reads ---');
  const read = (uid: string | null, p: string): Promise<unknown> => getBytes(ref(storageOf(uid), p));
  await test('Owner reads request photo', () => assertSucceeds(read('alice', 'requests/REQ-A1/photo.jpg')));
  await test('Provider in the same city reads request photo', () => assertSucceeds(read('pat', 'requests/REQ-A1/photo.jpg')));
  await test("Provider in another city can't read request photo", () => assertFails(read('sam', 'requests/REQ-A1/photo.jpg')));
  await test('Selected provider from another city reads the photo of their job', () => assertSucceeds(read('sam', 'requests/REQ-S1/photo.jpg')));
  await test("User who isn't a provider can't read request photo", () => assertFails(read('mallory', 'requests/REQ-A1/photo.jpg')));
  await test("Signed-out user can't read request photo", () => assertFails(read(null, 'requests/REQ-A1/photo.jpg')));

  console.log('\n--- Request file deletion (account deletion) ---');
  await test("Another user can't delete alice's request file", () => assertFails(deleteObject(ref(storageOf('pat'), 'requests/REQ-S1/photo.jpg'))));
  await test('Owner deletes their own request file, in any request status', () => assertSucceeds(deleteObject(ref(storageOf('alice'), 'requests/REQ-S1/photo.jpg'))));

  console.log('\n--- Chat files ---');
  await test('Customer uploads an image to the chat', () => assertSucceeds(put('alice', 'chat/conv_1/m2/a.png', 'image/png')));
  await test('Provider uploads a PDF to the chat', () => assertSucceeds(put('sam', 'chat/conv_1/m3/estimate.pdf', 'application/pdf')));
  await test('JavaScript file in chat is refused', () => assertFails(put('alice', 'chat/conv_1/m4/x.js', 'application/javascript')));
  await test('ZIP archive in chat is refused', () => assertFails(put('alice', 'chat/conv_1/m4/x.zip', 'application/zip')));
  await test('HTML page in chat is refused', () => assertFails(put('alice', 'chat/conv_1/m4/x.html', 'text/html')));
  await test("Outsider can't upload to the chat", () => assertFails(put('mallory', 'chat/conv_1/m5/a.jpg', 'image/jpeg')));
  await test("Outsider can't read chat files", () => assertFails(read('mallory', 'chat/conv_1/m1/a.jpg')));
  await test('Participant reads chat file', () => assertSucceeds(read('sam', 'chat/conv_1/m1/a.jpg')));
  await test('Upload to a conversation that does not exist is refused', () => assertFails(put('alice', 'chat/conv_nope/m1/a.jpg', 'image/jpeg')));
  await test('Chat upload after the request is cancelled is refused', () => assertFails(put('alice', 'chat/conv_c/m1/a.jpg', 'image/jpeg')));

  console.log('\n--- Master work photos ---');
  const phoneStorage = (uid: string) => testEnv.authenticatedContext(uid, { phone_number: '+77000000000' }).storage();
  const putPhoto = (uid: string, p: string, contentType = 'image/jpeg', data: Uint8Array = bytes) =>
    uploadBytes(ref(phoneStorage(uid), p), data, { contentType });
  await test('A master uploads and replaces a work photo in their own slots', async () => {
    await assertSucceeds(putPhoto('pat', 'providers/pat/portfolio/p0'));
    await assertSucceeds(putPhoto('pat', 'providers/pat/portfolio/p0', 'image/png'));
  });
  await test('Work photos: other slots, other masters, non-images and big files are refused', async () => {
    await assertFails(putPhoto('pat', 'providers/pat/portfolio/p8'));
    await assertFails(putPhoto('pat', 'providers/pat/portfolio/cover.jpg'));
    await assertFails(putPhoto('sam', 'providers/pat/portfolio/p1'));
    await assertFails(putPhoto('pat', 'providers/pat/portfolio/p1', 'text/html'));
    await assertFails(putPhoto('pat', 'providers/pat/portfolio/p1', 'image/jpeg', new Uint8Array(5 * 1024 * 1024 + 1)));
    await assertFails(put('pat', 'providers/pat/portfolio/p1', 'image/jpeg'));
  });
  await test('Phone-verified users see work photos; anonymous visitors do not', async () => {
    await assertSucceeds(getBytes(ref(phoneStorage('alice'), 'providers/pat/portfolio/p0')));
    await assertFails(read('alice', 'providers/pat/portfolio/p0'));
  });
  await test('Only the master deletes their work photo', async () => {
    await assertFails(deleteObject(ref(phoneStorage('sam'), 'providers/pat/portfolio/p0')));
    await assertSucceeds(deleteObject(ref(phoneStorage('pat'), 'providers/pat/portfolio/p0')));
  });

  console.log('\n--- Other paths ---');
  await test('Upload outside the known folders is refused', () => assertFails(put('alice', 'public/x.jpg', 'image/jpeg')));

  await testEnv.cleanup();
  console.log(`\nSTORAGE RULES SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
