/**
 * The cloud is the truth for requests and offers (resilientRepository): a device copy only fills in
 * what this phone has not sent yet, a denied record is not shown from the cache, and a job still
 * running is never cut off by the history limits (firebaseRepository). Against the emulators.
 */
import { firebaseRepository } from '../src/services/firebaseRepository';
import { localRepository } from '../src/services/localRepository';
import { resilientRepository } from '../src/services/resilientRepository';
import { offlineQueueService } from '../src/services/offlineQueueService';
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

async function main() {
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const adminApp = requireFromFunctions('firebase-admin/app');
  if (!adminApp.getApps().length) adminApp.initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek' });
  const adminDb = requireFromFunctions('firebase-admin/firestore').getFirestore();
  const tail = String(Date.now()).slice(-7);
  firebaseRepository.isAvailable = () => true;

  const customer = await actAs('cache-customer');
  const base = { customerId: customer, city: 'Қызылорда', cityId: 'kyzylorda', category: 'x', categoryId: 'plumbing', service: 'Кран' };

  // 1. A cloud request, a stale device copy of it, and a device-only "ghost"
  const cloudId = `REQ-CLOUD-${tail}`;
  await adminDb.doc(`requests/${cloudId}`).set({ ...base, id: cloudId, status: 'CANCELLED', createdAt: new Date().toISOString() });
  await localRepository.cacheRequests([{ ...base, id: cloudId, status: 'IN_PROGRESS', customerName: 'Клиент', createdAt: new Date().toISOString() } as any]);
  const ghostId = `REQ-GHOST-${tail}`;
  await localRepository.cacheRequests([{ ...base, id: ghostId, status: 'OPEN', customerName: 'Клиент', createdAt: new Date().toISOString() } as any]);

  const one = await resilientRepository.getRequest(cloudId);
  assert(one?.status === 'CANCELLED', 'A device copy "further along" does not beat the cloud when it holds no unsent change', one?.status);
  const list = await resilientRepository.getRequests({ customerId: customer });
  assert(list.some((r) => r.id === cloudId) && !list.some((r) => r.id === ghostId), 'A request that exists only in the device cache is not shown', list.map((r) => r.id));
  assert((await resilientRepository.getRequest(ghostId)) === null, 'Opening the ghost request directly finds nothing');

  // 2. A request this phone queued offline is still shown until it is sent
  const origQueue = offlineQueueService.getQueue.bind(offlineQueueService);
  offlineQueueService.getQueue = () =>
    [{ id: 'q1', idempotencyKey: 'k', type: 'createRequest', payload: { id: ghostId }, clientTimestamp: '', authUid: customer, retryCount: 0, status: 'PENDING' }] as any;
  const withQueued = await resilientRepository.getRequests({ customerId: customer });
  assert(withQueued.some((r) => r.id === ghostId), 'A request created offline and not yet sent stays visible');
  offlineQueueService.getQueue = origQueue;

  // 3. Taken away: someone else's request cached on this phone is not shown when the cloud refuses
  const otherId = `REQ-OTHER-${tail}`;
  await adminDb.doc(`requests/${otherId}`).set({ ...base, customerId: 'someone_else', cityId: 'almaty', id: otherId, status: 'IN_PROGRESS', createdAt: new Date().toISOString() });
  await localRepository.cacheRequests([{ ...base, customerId: 'someone_else', id: otherId, status: 'IN_PROGRESS', customerName: 'Клиент', createdAt: '' } as any]);
  assert((await resilientRepository.getRequest(otherId)) === null, 'A request the cloud refuses is not shown from the cache');

  // 4. An old job still running is reachable beyond the 200-request history
  const oldActive = `REQ-OLDACTIVE-${tail}`;
  await adminDb.doc(`requests/${oldActive}`).set({ ...base, id: oldActive, status: 'IN_PROGRESS', selectedOfferId: `OFFER-${oldActive}-p`, createdAt: '2020-01-01T00:00:00.000Z' });
  const writer = adminDb.bulkWriter();
  for (let i = 0; i < 205; i++) {
    const id = `REQ-H${i}-${tail}`;
    writer.set(adminDb.doc(`requests/${id}`), { ...base, id, status: 'COMPLETED', createdAt: new Date(Date.now() - i * 1000).toISOString() });
  }
  await writer.close();
  const history = await firebaseRepository.getRequests({ customerId: customer });
  assert(history.some((r) => r.id === oldActive), 'The old job in progress is in the list although 205 newer requests exist', history.length);

  // 5. A master's old accepted offer (current job) is reachable beyond the 300-offer limit
  const master = await actAs('cache-master');
  const oldAccepted = `OFFER-OLD-${tail}`;
  await adminDb.doc(`offers/${oldAccepted}`).set({ id: oldAccepted, requestId: oldActive, providerUserId: master, providerId: master, status: 'ACCEPTED', price: '1', createdAt: '2020-01-01T00:00:00.000Z' });
  const ow = adminDb.bulkWriter();
  for (let i = 0; i < 305; i++) {
    const id = `OFFER-H${i}-${tail}`;
    ow.set(adminDb.doc(`offers/${id}`), { id, requestId: `REQ-H${i % 200}-${tail}`, providerUserId: master, providerId: master, status: 'REJECTED', price: '1', createdAt: new Date(Date.now() - i * 1000).toISOString() });
  }
  await ow.close();
  const offers = await firebaseRepository.getOffers({ providerUserId: master });
  assert(offers.some((o) => o.id === oldAccepted), "The master's old accepted job is in the list although 305 newer offers exist", offers.length);

  console.log(failed ? `\nCACHE AUTHORITY: ${failed} FAILED` : '\nCACHE AUTHORITY: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Cache authority test error:', err);
  process.exit(1);
});
