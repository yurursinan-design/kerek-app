/**
 * Verification Test Suite: Phase 4.1 AcceptOffer Critical Fix
 * Validates online-only acceptOffer constraints, offline refusal,
 * queue processor safety for legacy items, and Phase 2 atomic regression.
 */

import { localRepository } from '../src/services/localRepository';
import { resilientRepository } from '../src/services/resilientRepository';
import { firebaseRepository } from '../src/services/firebaseRepository';
import { offlineQueueService } from '../src/services/offlineQueueService';
import { auth, db, ensureFirebaseAuth, createSecondaryFirebaseApp, attachEmulatorTestPhone } from '../src/services/firebase';
import { signInAnonymously } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { sendOfferCounted } from './helpers/offers';
import { getConversationId, getAppointmentId } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runAcceptOfferFixTests() {
  console.log('=== RUNNING PHASE 4.1 ACCEPT_OFFER FIX VERIFICATION TESTS ===\n');

  // Backup original functions
  const origIsAvailable = firebaseRepository.isAvailable.bind(firebaseRepository);
  const origCloudAcceptOffer = firebaseRepository.acceptOffer.bind(firebaseRepository);
  const origIsOnline = offlineQueueService.isOnline.bind(offlineQueueService);

  // Clear queue
  offlineQueueService.clearQueue();

  // Setup sample local request & sibling offers for offline tests
  const offlineReqId = 'REQ-41-OFFLINE-001';
  await localRepository.createRequest({
    id: offlineReqId,
    customerId: 'cust-41-user',
    customerName: 'Aigerim',
    city: 'Almaty',
    category: 'appliance_repair',
    service: 'Washing machine repair',
    status: 'OPEN',
  });

  const offer1 = await localRepository.createOffer({
    id: `OFFER-41-1`,
    requestId: offlineReqId,
    providerId: 'prov-1',
    providerUserId: 'prov-1',
    providerName: 'Master Arman',
    price: '12 000 ₸',
    availability: 'Today',
    status: 'PENDING',
  });

  const offer2 = await localRepository.createOffer({
    id: `OFFER-41-2`,
    requestId: offlineReqId,
    providerId: 'prov-2',
    providerUserId: 'prov-2',
    providerName: 'Master Berik',
    price: '15 000 ₸',
    availability: 'Today',
    status: 'PENDING',
  });

  // Mock Offline mode
  firebaseRepository.isAvailable = () => false;

  // -------------------------------------------------------------
  // TEST 1: Offline acceptOffer does NOT enqueue
  // -------------------------------------------------------------
  try {
    offlineQueueService.clearQueue();
    let caughtError = false;
    try {
      await resilientRepository.acceptOffer(offlineReqId, offer1.id);
    } catch {
      caughtError = true;
    }
    const queue = offlineQueueService.getQueue();
    assert(
      caughtError && queue.length === 0,
      'TEST 1: Offline acceptOffer does NOT enqueue mutation'
    );
  } catch (e: any) {
    assert(false, `TEST 1: ${e.message}`);
  }

  // -------------------------------------------------------------
  // TEST 2: Offline acceptOffer does NOT locally change offer to ACCEPTED
  // -------------------------------------------------------------
  try {
    const freshOffers = await localRepository.getOffers({ requestId: offlineReqId });
    const targetOffer = freshOffers.find((o) => o.id === offer1.id);
    assert(
      targetOffer?.status === 'PENDING',
      'TEST 2: Offline acceptOffer does NOT locally change offer status to ACCEPTED'
    );
  } catch (e: any) {
    assert(false, `TEST 2: ${e.message}`);
  }

  // -------------------------------------------------------------
  // TEST 3: Offline acceptOffer does NOT reject sibling offers
  // -------------------------------------------------------------
  try {
    const freshOffers = await localRepository.getOffers({ requestId: offlineReqId });
    const siblingOffer = freshOffers.find((o) => o.id === offer2.id);
    assert(
      siblingOffer?.status === 'PENDING',
      'TEST 3: Offline acceptOffer does NOT reject sibling offers'
    );
  } catch (e: any) {
    assert(false, `TEST 3: ${e.message}`);
  }

  // -------------------------------------------------------------
  // TEST 4: Offline acceptOffer does NOT create an accepted appointment/conversation
  // -------------------------------------------------------------
  try {
    const createdAppt = await localRepository.getAppointment(offlineReqId);
    const createdConv = await localRepository.getConversation(getConversationId(offlineReqId));
    assert(
      !createdAppt && !createdConv,
      'TEST 4: Offline acceptOffer does NOT create an accepted appointment/conversation'
    );
  } catch (e: any) {
    assert(false, `TEST 4: ${e.message}`);
  }

  const realCurrentUser = auth?.currentUser ?? null;

  // -------------------------------------------------------------
  // TEST 5: Queue processor encountering a legacy queued acceptOffer marks it FAILED_PERMANENT and does not execute it
  // -------------------------------------------------------------
  try {
    offlineQueueService.clearQueue();

    // Manually push legacy queued item into queue
    const legacyItem: any = {
      id: 'legacy-mut-accept-offer-01',
      idempotencyKey: 'legacy-key-01',
      type: 'acceptOffer',
      payload: { requestId: offlineReqId, offerId: offer1.id },
      clientTimestamp: new Date().toISOString(),
      authUid: 'legacy-uid',
      retryCount: 0,
      status: 'PENDING',
    };
    (offlineQueueService as any).saveQueue([legacyItem]);

    // Restore online mocks
    firebaseRepository.isAvailable = () => true;
    offlineQueueService.isOnline = () => true;
    (auth as any).currentUser = { uid: 'legacy-uid' };

    let acceptOfferExecuted = false;
    firebaseRepository.acceptOffer = async () => {
      acceptOfferExecuted = true;
      return { request: null, offer: null };
    };

    await offlineQueueService.processQueue();

    const queueAfter = offlineQueueService.getQueue();
    const processedLegacy = queueAfter.find((m) => m.id === 'legacy-mut-accept-offer-01');

    assert(
      !acceptOfferExecuted &&
        processedLegacy !== undefined &&
        (processedLegacy.status === 'FAILED_PERMANENT' || processedLegacy.status === 'FAILED_FATAL') &&
        processedLegacy.lastError?.includes('ACCEPT_OFFER_REQUIRES_ONLINE_EXECUTION') === true,
      'TEST 5: Queue processor encountering legacy acceptOffer marks it FAILED_PERMANENT without executing it'
    );

    firebaseRepository.acceptOffer = origCloudAcceptOffer;
  } catch (e: any) {
    assert(false, `TEST 5: ${e.message}`);
  } finally {
    // TEST 5 replaced auth.currentUser with a plain object; put the real user back, or later
    // Firestore calls wait forever for a token that object cannot produce
    if (auth) (auth as any).currentUser = realCurrentUser;
  }

  // -------------------------------------------------------------
  // TEST 6: Online acceptOffer still executes the Phase 2 atomic transaction
  // -------------------------------------------------------------
  try {
    firebaseRepository.isAvailable = () => true;
    let cloudExecuted = false;
    firebaseRepository.acceptOffer = async (reqId: string, offId: string) => {
      cloudExecuted = true;
      return {
        request: { id: reqId, status: 'PROVIDER_SELECTED', selectedOfferId: offId } as any,
        offer: { id: offId, status: 'ACCEPTED' } as any,
      };
    };

    const res = await resilientRepository.acceptOffer(offlineReqId, offer1.id);

    assert(
      cloudExecuted && res.request?.status === 'PROVIDER_SELECTED' && res.offer?.status === 'ACCEPTED',
      'TEST 6: Online acceptOffer executes Phase 2 transaction via FirebaseRepository'
    );

    firebaseRepository.acceptOffer = origCloudAcceptOffer;
  } catch (e: any) {
    assert(false, `TEST 6: ${e.message}`);
  }

  // -------------------------------------------------------------
  // TEST 7: Phase 2 atomic acceptance regression remains intact
  // -------------------------------------------------------------
  try {
    const regReqId = 'REQ-41-REGRESSION-001';
    const regReq = await localRepository.createRequest({
      id: regReqId,
      customerId: 'cust-reg',
      customerName: 'Aigerim',
      city: 'Almaty',
      category: 'appliance_repair',
      service: 'Washing machine repair',
      status: 'OPEN',
    });

    const regOfferA = await localRepository.createOffer({
      id: `OFFER-REG-A`,
      requestId: regReq.id,
      providerId: 'prov-A',
      providerUserId: 'prov-A',
      providerName: 'Master Arman',
      price: '12 000 ₸',
      availability: 'Today',
      status: 'PENDING',
    });

    const regOfferB = await localRepository.createOffer({
      id: `OFFER-REG-B`,
      requestId: regReq.id,
      providerId: 'prov-B',
      providerUserId: 'prov-B',
      providerName: 'Master Berik',
      price: '15 000 ₸',
      availability: 'Today',
      status: 'PENDING',
    });

    // Execute acceptance
    const acceptRes = await localRepository.acceptOffer(regReq.id, regOfferA.id);

    const recheckedOffers = await localRepository.getOffers({ requestId: regReq.id });
    const losingOffer = recheckedOffers.find((o) => o.id === regOfferB.id);
    const acceptedOffers = recheckedOffers.filter((o) => o.status === 'ACCEPTED');

    // Idempotency check
    const doubleAccept = await localRepository.acceptOffer(regReq.id, regOfferA.id);

    assert(
      acceptRes.request?.status === 'PROVIDER_SELECTED' &&
        acceptRes.request?.selectedOfferId === regOfferA.id &&
        acceptRes.offer?.status === 'ACCEPTED' &&
        losingOffer?.status === 'REJECTED' &&
        acceptedOffers.length === 1 &&
        doubleAccept.offer?.status === 'ACCEPTED' &&
        getConversationId(regReqId) === `conv_${regReqId}` &&
        getAppointmentId(regReqId) === `appointment_${regReqId}`,
      'TEST 7: Phase 2 atomic acceptance regression remains fully intact'
    );
  } catch (e: any) {
    assert(false, `TEST 7: ${e.message}`);
  }

  // -------------------------------------------------------------
  // TEST 8: Real firebaseRepository.acceptOffer() parallel concurrent transaction execution
  // -------------------------------------------------------------
  try {
    firebaseRepository.isAvailable = () => true;
    if (typeof process !== 'undefined' && process.env?.FIRESTORE_EMULATOR_HOST && db) {
      const emuReqId = `REQ-EMU-CONCURRENT-${Date.now()}`;

      const currentUid = (await ensureFirebaseAuth()) || 'cust-emu-uid';

      await setDoc(doc(db, 'requests', emuReqId), {
        id: emuReqId,
        customerId: currentUid,
        customerName: 'Aigerim',
        city: 'Almaty',
        cityId: 'almaty',
        category: 'appliances',
        service: 'Repair',
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      });

      // Each offer is written by its own provider account, as the security rules require
      const makeProvider = async (name: string) => {
        const client = createSecondaryFirebaseApp(`${name}-${Date.now()}`)!;
        await signInAnonymously(client.auth);
        await attachEmulatorTestPhone(client.auth);
        const uid = client.auth.currentUser!.uid;
        // Offers come from a provider profile in the request's city
        await setDoc(doc(client.db, 'providers', uid), { id: uid, userId: uid, name, city: 'Almaty', cityId: 'almaty', category: 'appliances' });
        return { db: client.db, uid, name };
      };
      const provA = await makeProvider('Master Arman');
      const provB = await makeProvider('Master Berik');
      const offerAId = `OFFER-${emuReqId}-${provA.uid}`;
      const offerBId = `OFFER-${emuReqId}-${provB.uid}`;

      await sendOfferCounted(provA.db, offerAId, {
        id: offerAId,
        requestId: emuReqId,
        providerId: provA.uid,
        providerUserId: provA.uid,
        providerName: 'Master Arman',
        price: '10 000 ₸',
        availability: 'Today',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });

      await sendOfferCounted(provB.db, offerBId, {
        id: offerBId,
        requestId: emuReqId,
        providerId: provB.uid,
        providerUserId: provB.uid,
        providerName: 'Master Berik',
        price: '12 000 ₸',
        availability: 'Today',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });

      const pA = firebaseRepository.acceptOffer(emuReqId, offerAId);
      const pB = firebaseRepository.acceptOffer(emuReqId, offerBId);

      const results = await Promise.allSettled([pA, pB]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      const finalReqSnap = await getDoc(doc(db, 'requests', emuReqId));
      const finalOfferASnap = await getDoc(doc(db, 'offers', offerAId));
      const finalOfferBSnap = await getDoc(doc(db, 'offers', offerBId));

      const finalReq = finalReqSnap.data();
      const finalOfferA = finalOfferASnap.data();
      const finalOfferB = finalOfferBSnap.data();

      const winningOfferId = finalReq?.selectedOfferId;
      const isConsistent =
        fulfilled.length === 1 &&
        rejected.length === 1 &&
        finalReq?.status === 'PROVIDER_SELECTED' &&
        (winningOfferId === offerAId || winningOfferId === offerBId) &&
        (winningOfferId === offerAId
          ? finalOfferA?.status === 'ACCEPTED' && finalOfferB?.status === 'REJECTED'
          : finalOfferB?.status === 'ACCEPTED' && finalOfferA?.status === 'REJECTED');

      assert(
        isConsistent,
        'TEST 8: Real firebaseRepository.acceptOffer() parallel concurrent transaction execution'
      );

      // TEST 9: Accepting the chosen offer again later returns the request as it is stored now
      const winner = winningOfferId === offerAId ? provA : provB;
      await updateDoc(doc(winner.db, 'requests', emuReqId), { status: 'IN_PROGRESS', updatedAt: new Date().toISOString() });
      const replayInProgress = await firebaseRepository.acceptOffer(emuReqId, winningOfferId);
      await updateDoc(doc(db, 'requests', emuReqId), { status: 'COMPLETED', updatedAt: new Date().toISOString() });
      const replayCompleted = await firebaseRepository.acceptOffer(emuReqId, winningOfferId);
      assert(
        replayInProgress.request?.status === 'IN_PROGRESS' &&
          replayCompleted.request?.status === 'COMPLETED' &&
          replayCompleted.offer?.status === 'ACCEPTED' &&
          (await getDoc(doc(db, 'requests', emuReqId))).data()?.status === 'COMPLETED',
        `TEST 9: Accepting the chosen offer again returns the stored status (got ${replayInProgress.request?.status}, ${replayCompleted.request?.status}) and writes nothing`
      );
    } else {
      assert(true, 'TEST 8: Real cloud Firestore concurrent test skipped in standalone unit mode (runs in npm run test:rules under Firestore Emulator)');
    }
  } catch (e: any) {
    assert(false, `TEST 8: ${e.message}`);
  }

  // Restore orig functions
  firebaseRepository.isAvailable = origIsAvailable;
  offlineQueueService.isOnline = origIsOnline;

  console.log(`\n=== TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runAcceptOfferFixTests().catch((e) => {
  console.error('Fatal error running accept offer fix tests:', e);
  process.exit(1);
});
