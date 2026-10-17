import assert from 'node:assert';
import { countedSet } from './helpers/counted';
import { db, auth, ensureFirebaseAuth, createSecondaryFirebaseApp, attachEmulatorTestPhone } from '../src/services/firebase';
import { deleteApp } from 'firebase/app';
import { signInAnonymously } from 'firebase/auth';
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { sendOfferCounted } from './helpers/offers';

// Mock minimal localStorage required by Firebase Auth Node.js environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

async function runMessagingSecurityTests() {
  console.log('================================================================');
  console.log('🔒 LIVE FIRESTORE MESSAGING SECURITY RULES VERIFICATION SUITE');
  console.log('================================================================');

  // 1. Authenticate Primary User (Customer)
  await ensureFirebaseAuth();
  const customerUid = auth?.currentUser?.uid;
  assert(customerUid, 'Customer Firebase Auth session must be active');
  console.log('✓ [Client 1 - Customer] Authenticated. UID:', customerUid);

  // 2. Authenticate Secondary User (Provider)
  const provClient = createSecondaryFirebaseApp(`provider-app-${Date.now()}`)!;
  const providerApp = provClient.app;
  const providerAuth = provClient.auth;
  const providerCred = await signInAnonymously(providerAuth);
  await attachEmulatorTestPhone(providerAuth);
  const providerUid = providerCred.user.uid;
  const providerDb = provClient.db;
  console.log('✓ [Client 2 - Provider] Authenticated. UID:', providerUid);

  // 3. Authenticate Tertiary User (Unrelated 3rd Party)
  const unrelClient = createSecondaryFirebaseApp(`unrelated-app-${Date.now()}`)!;
  const unrelatedApp = unrelClient.app;
  const unrelatedAuth = unrelClient.auth;
  const unrelatedCred = await signInAnonymously(unrelatedAuth);
  await attachEmulatorTestPhone(unrelatedAuth);
  const unrelatedUid = unrelatedCred.user.uid;
  const unrelatedDb = unrelClient.db;
  console.log('✓ [Client 3 - Unrelated User] Authenticated. UID:', unrelatedUid);

  assert(customerUid !== providerUid && providerUid !== unrelatedUid, 'Test UIDs must be distinct');

  const testReqId = `REQ-SEC-${Date.now().toString().slice(-6)}`;
  const testConvId = `conv_${testReqId}`;
  const unexistConvId = `conv_NONEXISTENT_${Date.now()}`;
  const now = new Date().toISOString();

  let testPassedCount = 0;
  let testFailedCount = 0;

  function reportResult(name: string, passed: boolean, detail: string) {
    if (passed) {
      testPassedCount++;
      console.log(`✅ PASS: [${name}] - ${detail}`);
    } else {
      testFailedCount++;
      console.error(`❌ FAIL: [${name}] - ${detail}`);
    }
  }

  // -------------------------------------------------------------------------
  // TEST SCENARIO 1: Non-existent conversation messages cannot be listed
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 1: Non-existent Conversation Message Listing ---');
  try {
    const snap = await getDocs(collection(db!, 'conversations', unexistConvId, 'messages'));
    reportResult('SCENARIO 1 (List Non-existent)', false, `Unexpectedly returned ${snap.size} docs without error`);
  } catch (err: any) {
    const isPermissionDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
    reportResult('SCENARIO 1 (List Non-existent)', isPermissionDenied, isPermissionDenied ? 'Correctly denied with PERMISSION_DENIED' : `Failed with: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // TEST SCENARIO 2: Non-existent conversation single message cannot be read (get)
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 2: Non-existent Conversation Single Message Read ---');
  try {
    const snap = await getDoc(doc(db!, 'conversations', unexistConvId, 'messages', 'any_msg'));
    reportResult('SCENARIO 2 (Get Non-existent)', false, `Unexpectedly succeeded (doc exists: ${snap.exists()})`);
  } catch (err: any) {
    const isPermissionDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
    reportResult('SCENARIO 2 (Get Non-existent)', isPermissionDenied, isPermissionDenied ? 'Correctly denied with PERMISSION_DENIED' : `Failed with: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // SETUP: Create isolated transient request and conversation
  // -------------------------------------------------------------------------
  console.log('\n--- SETUP: Creating isolated transient request and conversation ---');
  const reqRef = doc(db!, 'requests', testReqId);
  const convRef = doc(db!, 'conversations', testConvId);
  const testMsgId = `msg_${Date.now()}`;
  const msgRef = doc(db!, 'conversations', testConvId, 'messages', testMsgId);

  // Customer creates request
  await countedSet(reqRef, {
    id: testReqId,
    customerId: customerUid,
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    category: 'Тұрмыстық техника жөндеу',
    service: 'Тест қауіпсіздік тексеру',
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
  });

  // The provider sends an offer and the customer selects it: the rules only allow a conversation for a
  // request that has a selected provider with an accepted offer.
  const testOfferId = `OFFER-${testReqId}-${providerUid}`;
  await setDoc(doc(providerDb, 'providers', providerUid), {
    id: providerUid, userId: providerUid, name: 'Test Шебер', city: 'Қызылорда', cityId: 'kyzylorda', category: 'appliances',
  });
  await sendOfferCounted(providerDb, testOfferId, {
    id: testOfferId,
    requestId: testReqId,
    providerId: providerUid,
    providerUserId: providerUid,
    providerName: 'Test Шебер',
    price: '10 000 ₸',
    status: 'PENDING',
  });
  // Selecting the offer and accepting it happen in one write
  const acceptBatch = writeBatch(db!);
  acceptBatch.set(reqRef, { status: 'PROVIDER_SELECTED', selectedOfferId: testOfferId, updatedAt: new Date().toISOString() }, { merge: true });
  acceptBatch.set(doc(db!, 'offers', testOfferId), { status: 'ACCEPTED', updatedAt: new Date().toISOString() }, { merge: true });
  await acceptBatch.commit();

  // Customer creates the deterministic conversation linking customer and the selected provider
  await setDoc(convRef, {
    id: testConvId,
    requestId: testReqId,
    customerId: customerUid,
    customerName: 'Test Müşteri',
    providerId: providerUid,
    providerUserId: providerUid,
    providerName: 'Test Шебер',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  console.log('✓ Transient conversation ready:', testConvId);

  // -------------------------------------------------------------------------
  // TEST SCENARIO 3: Authorized Customer sends message
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 3: Authorized Customer Sends Message ---');
  try {
    await countedSet(msgRef, {
      id: testMsgId,
      conversationId: testConvId,
      requestId: testReqId,
      senderId: customerUid,
      senderRole: 'customer',
      type: 'text',
      text: 'Сәлеметсіз бе! Бұл қауіпсіздік тестілік хабарламасы.',
      createdAt: now,
    });
    reportResult('SCENARIO 3 (Customer Send)', true, 'Customer successfully created message document');
  } catch (err: any) {
    reportResult('SCENARIO 3 (Customer Send)', false, `Customer send failed: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // TEST SCENARIO 4: Authorized Customer reads own conversation messages
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 4: Authorized Customer Reads Own Messages ---');
  try {
    const listSnap = await getDocs(collection(db!, 'conversations', testConvId, 'messages'));
    const singleSnap = await getDoc(msgRef);
    const success = listSnap.size >= 1 && singleSnap.exists() && singleSnap.data()?.text.includes('қауіпсіздік');
    reportResult('SCENARIO 4 (Customer Read)', success, `Customer listed ${listSnap.size} doc(s) and retrieved message content`);
  } catch (err: any) {
    reportResult('SCENARIO 4 (Customer Read)', false, `Customer read failed: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // TEST SCENARIO 5: Authorized Provider reads conversation messages
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 5: Authorized Provider Reads Conversation Messages ---');
  try {
    // Provider reads using their own distinct Firestore client session (providerDb)
    const provListSnap = await getDocs(collection(providerDb, 'conversations', testConvId, 'messages'));
    const provSingleSnap = await getDoc(doc(providerDb, 'conversations', testConvId, 'messages', testMsgId));
    const success = provListSnap.size >= 1 && provSingleSnap.exists();
    reportResult('SCENARIO 5 (Provider Read)', success, `Authorized provider listed ${provListSnap.size} doc(s) and read single doc successfully`);
  } catch (err: any) {
    reportResult('SCENARIO 5 (Provider Read)', false, `Authorized provider read failed: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // TEST SCENARIO 6: Unauthorized / Unrelated User attempts to list messages
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 6: Unauthorized User Attempts to List Messages ---');
  try {
    // Unrelated user tries to list messages using their distinct session (unrelatedDb)
    const unauthSnap = await getDocs(collection(unrelatedDb, 'conversations', testConvId, 'messages'));
    reportResult('SCENARIO 6 (Unauthorized List)', false, `VULNERABILITY: Unrelated user was able to list ${unauthSnap.size} messages!`);
  } catch (err: any) {
    const isPermissionDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
    reportResult('SCENARIO 6 (Unauthorized List)', isPermissionDenied, isPermissionDenied ? 'Correctly DENIED with PERMISSION_DENIED' : `Failed with: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // TEST SCENARIO 7: Unauthorized / Unrelated User attempts to read single message
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 7: Unauthorized User Attempts to Read Single Message (get) ---');
  try {
    // Unrelated user tries to get single message
    const unauthDocSnap = await getDoc(doc(unrelatedDb, 'conversations', testConvId, 'messages', testMsgId));
    reportResult('SCENARIO 7 (Unauthorized Get)', false, `VULNERABILITY: Unrelated user was able to get document (exists: ${unauthDocSnap.exists()})!`);
  } catch (err: any) {
    const isPermissionDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
    reportResult('SCENARIO 7 (Unauthorized Get)', isPermissionDenied, isPermissionDenied ? 'Correctly DENIED with PERMISSION_DENIED' : `Failed with: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // TEST SCENARIO 8: Unauthorized / Unrelated User attempts to send message
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 8: Unauthorized User Attempts to Send Message ---');
  try {
    const unauthMsgId = `unauth_msg_${Date.now()}`;
    await countedSet(doc(unrelatedDb, 'conversations', testConvId, 'messages', unauthMsgId), {
      id: unauthMsgId,
      conversationId: testConvId,
      requestId: testReqId,
      senderId: unrelatedUid,
      senderRole: 'provider',
      type: 'text',
      text: 'Malicious / intruder message',
      createdAt: new Date().toISOString(),
    });
    reportResult('SCENARIO 8 (Unauthorized Send)', false, 'VULNERABILITY: Unrelated user was able to write message into foreign conversation!');
  } catch (err: any) {
    const isPermissionDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
    reportResult('SCENARIO 8 (Unauthorized Send)', isPermissionDenied, isPermissionDenied ? 'Correctly DENIED with PERMISSION_DENIED' : `Failed with: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // CLEANUP: Clean up transient test documents and app instances
  // -------------------------------------------------------------------------
  console.log('\n--- CLEANUP: Removing transient test artifacts ---');
  try {
    await deleteDoc(msgRef);
    await deleteDoc(convRef);
    await deleteDoc(reqRef);
    console.log('✓ Cleaned up test documents from Firestore');
  } catch (cleanErr: any) {
    console.warn('Note on cleanup:', cleanErr.message);
  }

  try {
    await deleteApp(providerApp);
    await deleteApp(unrelatedApp);
    console.log('✓ Disposed test app instances');
  } catch (dispErr: any) {
    console.warn('Note on app disposal:', dispErr.message);
  }

  console.log('\n================================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${testPassedCount} PASSED, ${testFailedCount} FAILED`);
  console.log('================================================================');

  if (testFailedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runMessagingSecurityTests().catch((err) => {
  console.error('❌ UNHANDLED TEST RUNNER ERROR:', err);
  process.exit(1);
});
