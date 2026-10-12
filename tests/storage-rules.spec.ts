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
import { ref, uploadBytes, getBytes } from 'firebase/storage';
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
    await setDoc(doc(db, 'conversations', 'conv_1'), { id: 'conv_1', customerId: 'alice', providerUserId: 'sam', providerId: 'sam' });
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'requests/REQ-A1/photo.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
    await uploadBytes(ref(ctx.storage(), 'requests/REQ-S1/photo.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
    await uploadBytes(ref(ctx.storage(), 'chat/conv_1/m1/a.jpg'), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
  });

  const bytes = new Uint8Array([1, 2, 3, 4]);
  const storageOf = (uid: string | null) =>
    (uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext()).storage();
  const put = (uid: string | null, p: string, contentType: string, data: Uint8Array = bytes): Promise<unknown> =>
    uploadBytes(ref(storageOf(uid), p), data, { contentType });

  console.log('--- Request uploads ---');
  await test('Owner uploads a JPEG photo to their existing request', () => assertSucceeds(put('alice', 'requests/REQ-A1/new.jpg', 'image/jpeg')));
  await test('Owner uploads a voice note with codec parameter', () => assertSucceeds(put('alice', 'requests/REQ-A1/v.webm', 'audio/webm;codecs=opus')));
  await test('Owner uploads an MP4 video', () => assertSucceeds(put('alice', 'requests/REQ-A1/v.mp4', 'video/mp4')));
  await test('Upload to a request that does not exist yet is refused', () => assertFails(put('alice', 'requests/REQ-NOPE/x.jpg', 'image/jpeg')));
  await test("Another user can't upload to alice's request", () => assertFails(put('mallory', 'requests/REQ-A1/x.jpg', 'image/jpeg')));
  await test('Signed-out upload is refused', () => assertFails(put(null, 'requests/REQ-A1/x.jpg', 'image/jpeg')));
  await test('HTML upload is refused', () => assertFails(put('alice', 'requests/REQ-A1/x.html', 'text/html')));
  await test('SVG upload is refused', () => assertFails(put('alice', 'requests/REQ-A1/x.svg', 'image/svg+xml')));
  await test('Empty file is refused', () => assertFails(put('alice', 'requests/REQ-A1/x.jpg', 'image/jpeg', new Uint8Array([]))));
  await test('Image over 10 MB is refused', () =>
    assertFails(put('alice', 'requests/REQ-A1/big.jpg', 'image/jpeg', new Uint8Array(10 * 1024 * 1024 + 1))));
  await test('Overwriting an existing file is refused', () => assertFails(put('alice', 'requests/REQ-A1/photo.jpg', 'image/jpeg')));

  console.log('\n--- Request file reads ---');
  const read = (uid: string | null, p: string): Promise<unknown> => getBytes(ref(storageOf(uid), p));
  await test('Owner reads request photo', () => assertSucceeds(read('alice', 'requests/REQ-A1/photo.jpg')));
  await test('Provider in the same city reads request photo', () => assertSucceeds(read('pat', 'requests/REQ-A1/photo.jpg')));
  await test("Provider in another city can't read request photo", () => assertFails(read('sam', 'requests/REQ-A1/photo.jpg')));
  await test('Selected provider from another city reads the photo of their job', () => assertSucceeds(read('sam', 'requests/REQ-S1/photo.jpg')));
  await test("User who isn't a provider can't read request photo", () => assertFails(read('mallory', 'requests/REQ-A1/photo.jpg')));
  await test("Signed-out user can't read request photo", () => assertFails(read(null, 'requests/REQ-A1/photo.jpg')));

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
