/**
 * Sending a request (firebaseRepository.createRequest and uploadRequestAttachment) against the
 * Firestore, Auth and Storage emulators: the request and its private contacts are stored together
 * or not at all, the shared request carries no customer name, sending the same submission again
 * returns the stored request instead of a copy, and a file already uploaded by an earlier try is
 * reused instead of being uploaded a second time.
 */
import { deleteObject, getMetadata, ref } from 'firebase/storage';
import { doc, getDoc } from 'firebase/firestore';
import { db, storage } from '../src/services/firebase';
import { firebaseRepository } from '../src/services/firebaseRepository';
import { generateRequestId } from '../src/services/ids';
import { DAILY_LIMITS, usageDayKey } from '../src/services/dailyUsage';
import { getFriendlyErrorMessage } from '../src/services/errorHandler';
import { actAs } from './helpers/actors';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
    failed++;
  }
}

const base = {
  city: 'Қызылорда',
  cityId: 'kyzylorda',
  category: 'Сантехника',
  categoryId: 'plumbing',
  service: 'Кран ағып тұр',
  requestText: 'Ас үйдегі кран ағып тұр',
  status: 'OPEN' as const,
};

async function main() {
  const customer = await actAs('submit-customer');
  // A missing contacts document is refused rather than reported missing; had it been stored, its
  // owner could read it, so a refusal also means "not there"
  const exists = (path: string) => getDoc(doc(db!, path)).then((snap) => snap.exists(), () => false);

  // 1. Request and contacts together; the name only in the contacts
  const id1 = generateRequestId();
  const created = await firebaseRepository.createRequest({
    ...base,
    id: id1,
    customerId: customer,
    customerName: 'Айгүл',
    location: { latitude: 44.8481, longitude: 65.4823, address: 'Абай даңғылы 12' },
  });
  const shared = (await getDoc(doc(db!, 'requests', id1))).data();
  const contacts = (await getDoc(doc(db!, 'requestContacts', id1))).data();
  assert(Boolean(shared) && !('customerName' in (shared || {})), 'The shared request carries no customer name', shared);
  assert(contacts?.customerName === 'Айгүл' && typeof contacts?.customerPhone === 'string', 'The name and phone are in the private contacts', contacts);
  assert(contacts?.location?.address === 'Абай даңғылы 12' && shared?.location?.approximate === true, 'Exact place private, approximate point shared');
  assert(created.customerName === 'Айгүл', 'The customer still sees their own name in the app');

  // 2. The same submission again: the stored request comes back, nothing new is written
  const again = await firebaseRepository.createRequest({ ...base, id: id1, customerId: customer, requestText: 'другой текст' });
  const afterAgain = (await getDoc(doc(db!, 'requests', id1))).data();
  assert(again.id === id1 && afterAgain?.requestText === base.requestText, 'Sending again with the same id returns the stored request unchanged', afterAgain?.requestText);

  // 3. Contacts refused: the request is not stored either (one batch)
  const id2 = generateRequestId();
  let refused = '';
  try {
    await firebaseRepository.createRequest({
      ...base,
      id: id2,
      customerId: customer,
      location: { latitude: 44.85, longitude: 65.48, address: 'x'.repeat(400) },
    });
  } catch (err: any) {
    refused = String(err?.message || err);
  }
  assert(Boolean(refused), 'A request whose contacts are refused fails as a whole', refused);
  assert(!(await exists(`requests/${id2}`)) && !(await exists(`requestContacts/${id2}`)), 'Neither the request nor the contacts were stored');

  // 4. Someone else's id cannot be taken over
  await actAs('submit-other');
  let taken = '';
  try {
    await firebaseRepository.createRequest({ ...base, id: id1 });
  } catch (err: any) {
    taken = String(err?.message || err);
  }
  await actAs('submit-customer');
  const owner = (await getDoc(doc(db!, 'requests', id1))).data();
  assert(Boolean(taken) && owner?.customerId === customer && owner?.requestText === base.requestText, "Another customer's request id is refused and the request stays theirs", taken.slice(0, 120));

  // 5. A file uploaded by an earlier try is reused, not uploaded again into the next slot
  const photo = { name: 'kran.jpg', size: 4, type: 'image/jpeg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) };
  const first = await firebaseRepository.uploadRequestAttachment(id1, photo, customer, 0);
  const second = await firebaseRepository.uploadRequestAttachment(id1, photo, customer, 0);
  const nextSlot = await getMetadata(ref(storage!, `requests/${id1}/att1`)).then(() => true, () => false);
  assert(first.storagePath === `requests/${id1}/att0` && second.storagePath === first.storagePath, 'The same file sent again uses its slot', [first.storagePath, second.storagePath]);
  assert(!nextSlot, 'No second copy in the next slot');
  const other = await firebaseRepository.uploadRequestAttachment(id1, { ...photo, name: 'rakovina.jpg' }, customer, 0);
  assert(other.storagePath === `requests/${id1}/att1`, 'A different file moves on to the next free slot', other.storagePath);
  await deleteObject(ref(storage!, `requests/${id1}/att0`)).catch(() => {});

  // 6. The day's request limit: the app explains it instead of a generic error
  {
    const { createRequire } = await import('node:module');
    const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
    const adminApp = requireFromFunctions('firebase-admin/app');
    if (!adminApp.getApps().length) adminApp.initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek' });
    const adminDb = requireFromFunctions('firebase-admin/firestore').getFirestore();
    await adminDb.doc(`usage/${customer}_${usageDayKey()}`).set({ uid: customer, requests: DAILY_LIMITS.requests }, { merge: true });
    let limitError: unknown = null;
    try {
      await firebaseRepository.createRequest({ ...base, id: generateRequestId(), customerId: customer });
    } catch (err) {
      limitError = err;
    }
    const shown = getFriendlyErrorMessage(limitError, 'ru');
    assert(/дневной лимит/.test(shown), 'The 11th request of the day is refused with the daily-limit message', shown);
  }

  console.log(failed ? `\nREQUEST SUBMISSION: ${failed} FAILED` : '\nREQUEST SUBMISSION: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Request submission test error:', err);
  process.exit(1);
});
