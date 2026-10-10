import assert from 'node:assert';
import { localRepository } from '../src/services/localRepository';
import { resilientRepository } from '../src/services/resilientRepository';
import { ensureFirebaseAuth, auth } from '../src/services/firebase';
import { Provider, ProviderOffer, ServiceRequest } from '../src/types';

// Mock localStorage for node environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

async function runTest() {
  console.log('=== VERIFYING REQ-675871 IN PROVIDER MODE ===');
  localStorage.clear();
  await ensureFirebaseAuth();
  const uid = auth?.currentUser?.uid || 'anon-test-uid';
  const testReqId = 'REQ-675871-' + Date.now();

  // 1. Customer creates request
  const req = await resilientRepository.createRequest({
    id: testReqId,
    customerId: uid,
    customerName: 'Customer Test',
    city: 'Қызылорда',
    category: 'Тұрмыстық техника жөндеу',
    service: 'Samsung кір жуғыш машина жөндеу',
    status: 'OPEN',
  });
  assert.strictEqual(req.id, testReqId);
  console.log('✓ Step 1: Request created successfully');

  // 2. Provider registers
  const prov = await resilientRepository.createProvider({
    name: 'Шебер Руслан',
    city: 'Қызылорда',
    category: 'Тұрмыстық техника жөндеу',
    phone: '+7 701 999 8877',
    whatsapp: '+7 701 999 8877',
  });
  assert(prov.id);
  console.log('✓ Step 2: Provider created successfully with id:', prov.id);

  // 3. Provider submits offer
  const offer = await resilientRepository.createOffer({
    requestId: testReqId,
    providerId: prov.id,
    providerUserId: prov.userId,
    providerName: prov.name,
    providerPhone: prov.phone,
    providerWhatsapp: prov.whatsapp,
    price: '15 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня, 1 час',
    status: 'PENDING',
  });
  assert.strictEqual(offer.requestId, testReqId);
  console.log('✓ Step 3: Offer submitted to', testReqId);

  // 4. Test getOffers with providerId
  const myOffers = await resilientRepository.getOffers({
    providerId: prov.id,
    providerUserId: prov.userId || prov.id,
  });
  console.log('myOffers found:', myOffers.map(o => ({ id: o.id, req: o.requestId, prov: o.providerId, user: o.providerUserId })));
  assert(myOffers.some(o => o.requestId === testReqId), 'Should find offer for request');
  console.log('✓ Step 4: repository.getOffers correctly finds offer for request');

  // 5. Simulate ProviderModeScreen loading
  const offersMap: Record<string, ProviderOffer> = {};
  myOffers.forEach((o) => {
    offersMap[o.requestId] = o;
  });
  assert(offersMap[testReqId], 'offersMap must contain request');

  // Simulate matching requests that didn't include testReqId (e.g. status changed or query issue)
  const matchingRequests: ServiceRequest[] = [];
  const offeredReqIds = Object.keys(offersMap);
  const existingReqIds = new Set(matchingRequests.map((r) => r.id));
  const missingReqPromises = offeredReqIds
    .filter((id) => !existingReqIds.has(id))
    .map((id) => resilientRepository.getRequest(id));

  const missingReqs = (await Promise.all(missingReqPromises)).filter(
    (r): r is ServiceRequest => r !== null
  );

  const combinedRequests = [...matchingRequests, ...missingReqs];
  assert.strictEqual(combinedRequests.length, 1);
  assert.strictEqual(combinedRequests[0].id, testReqId);
  console.log('✓ Step 5: Provider requests list includes request via missingReqs resolution');

  // 6. Test visibleRequests filter logic
  const pCityId = 'kyzylorda';
  const pCatId = 'appliance_repair';
  const dismissedReqIds: string[] = [];

  const visibleRequests = combinedRequests.filter((r) => {
    if (dismissedReqIds.includes(r.id) || r.status === 'CANCELLED') return false;
    if (offersMap[r.id]) {
      return true; // Keep visible because provider already sent offer
    }
    return false;
  });

  assert.strictEqual(visibleRequests.length, 1, 'request must be visible in visibleRequests');
  assert.strictEqual(visibleRequests[0].id, testReqId);
  console.log('✓ Step 6: visibleRequests retains request');

  // 7. Customer accepts offer -> status becomes PROVIDER_SELECTED
  await resilientRepository.acceptOffer(testReqId, offer.id);
  const updatedReq = await resilientRepository.getRequest(testReqId);
  assert.strictEqual(updatedReq?.status, 'PROVIDER_SELECTED');

  // Verify it still stays visible in ProviderModeScreen
  const visibleAfterAccept = [updatedReq!].filter((r) => {
    if (dismissedReqIds.includes(r.id) || r.status === 'CANCELLED') return false;
    if (offersMap[r.id]) {
      return true;
    }
    return false;
  });
  assert.strictEqual(visibleAfterAccept.length, 1, 'request must remain visible after being accepted');
  console.log('✓ Step 7: request remains visible after offer is accepted (PROVIDER_SELECTED)');

  console.log('\n=============================================');
  console.log('ALL REQ-675871 PROVIDER TESTS PASSED! 🎉');
  console.log('=============================================');
  process.exit(0);
}

runTest().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
