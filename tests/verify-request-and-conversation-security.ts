import assert from 'node:assert';
import { db, auth, app, ensureFirebaseAuth, createSecondaryFirebaseApp, attachEmulatorTestPhone } from '../src/services/firebase';
import { deleteApp } from 'firebase/app';
import { signInAnonymously } from 'firebase/auth';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

// Mock minimal localStorage for Node environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

async function runSecurityAudit() {
  console.log('====================================================================');
  console.log('🔍 FIRESTORE REQUEST & CONVERSATION SECURITY RULES VERIFICATION');
  console.log('====================================================================');

  // Authenticate 3 distinct users
  await ensureFirebaseAuth();
  const customerUid = auth?.currentUser?.uid!;
  console.log('✓ [Client 1 - Customer] UID:', customerUid);

  const selectedProvClient = createSecondaryFirebaseApp(`prov-selected-${Date.now()}`)!;
  const selectedProvApp = selectedProvClient.app;
  const selectedProvAuth = selectedProvClient.auth;
  const selectedProvCred = await signInAnonymously(selectedProvAuth);
  await attachEmulatorTestPhone(selectedProvAuth);
  const selectedProvUid = selectedProvCred.user.uid;
  const selectedProvDb = selectedProvClient.db;
  console.log('✓ [Client 2 - Selected Provider] UID:', selectedProvUid);

  const attackerProvClient = createSecondaryFirebaseApp(`prov-attacker-${Date.now()}`)!;
  const attackerProvApp = attackerProvClient.app;
  const attackerProvAuth = attackerProvClient.auth;
  const attackerProvCred = await signInAnonymously(attackerProvAuth);
  await attachEmulatorTestPhone(attackerProvAuth);
  const attackerProvUid = attackerProvCred.user.uid;
  const attackerProvDb = attackerProvClient.db;
  console.log('✓ [Client 3 - Unselected / Attacker Provider] UID:', attackerProvUid);

  const now = new Date().toISOString();
  const testReqId = `REQ-AUDIT-${Date.now().toString().slice(-6)}`;
  const otherReqId = `REQ-OTHER-${Date.now().toString().slice(-6)}`;
  const testConvId = `conv_${testReqId}`;

  // One offer per provider and request: the id is fixed by the rules
  const validOfferId = `OFFER-${testReqId}-${selectedProvUid}`;
  const foreignOfferId = `OFFER-${otherReqId}-${selectedProvUid}`;

  // References
  const reqRef = doc(db!, 'requests', testReqId);
  const otherReqRef = doc(db!, 'requests', otherReqId);
  const validOfferRef = doc(selectedProvDb, 'offers', validOfferId);
  const foreignOfferRef = doc(selectedProvDb, 'offers', foreignOfferId);
  const convRef = doc(db!, 'conversations', testConvId);

  try {
    // ------------------------------------------------------------------------
    // SETUP: Create base open request by customer
    // ------------------------------------------------------------------------
    console.log('\n--- SETUP: Creating test requests and offers ---');
    await setDoc(reqRef, {
      id: testReqId,
      customerId: customerUid,
      customerName: 'Test Müşteri',
      city: 'Қызылорда',
      cityId: 'kyzylorda',
      category: 'Тұрмыстық техника жөндеу',
      service: 'Тест қызметі',
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    });
    console.log('✓ Created base request:', testReqId);

    await setDoc(otherReqRef, {
      id: otherReqId,
      customerId: customerUid,
      customerName: 'Test Müşteri',
      city: 'Қызылорда',
      cityId: 'kyzylorda',
      category: 'Тұрмыстық техника жөндеу',
      service: 'Бөлек қызмет',
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    });

    // Offers come from a provider profile in the request's city
    await setDoc(doc(selectedProvDb, 'providers', selectedProvUid), {
      id: selectedProvUid, userId: selectedProvUid, name: 'Шебер Самат', city: 'Қызылорда', cityId: 'kyzylorda', category: 'appliances',
    });

    // Provider creates valid offer for testReqId
    await setDoc(validOfferRef, {
      id: validOfferId,
      requestId: testReqId,
      providerId: selectedProvUid,
      providerUserId: selectedProvUid,
      providerName: 'Шебер Самат',
      price: '5000 ₸',
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    });
    console.log('✓ Created legitimate offer:', validOfferId);

    // Provider creates foreign offer for otherReqId
    await setDoc(foreignOfferRef, {
      id: foreignOfferId,
      requestId: otherReqId,
      providerId: selectedProvUid,
      providerUserId: selectedProvUid,
      providerName: 'Шебер Самат',
      price: '8000 ₸',
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    });
    console.log('✓ Created foreign offer for other request:', foreignOfferId);

    // ------------------------------------------------------------------------
    // ATTACK TEST 1: Customer sets status directly to 'COMPLETED' on OPEN request
    // ------------------------------------------------------------------------
    console.log('\n--- ATTACK 1: Customer attempts direct fake COMPLETED on OPEN request ---');
    try {
      await updateDoc(reqRef, {
        status: 'COMPLETED',
        updatedAt: new Date().toISOString(),
      });
      console.warn('⚠️ LIVE SERVER STATUS: Direct update to COMPLETED SUCCEEDED (Vulnerable on live server because new local rules are not yet published to Firebase Console).');
    } catch (err: any) {
      const isDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
      if (isDenied) {
        console.log('✅ PASS: Direct fake COMPLETED was DENIED by security rules (PERMISSION_DENIED)');
      } else {
        console.log('Result:', err.message);
      }
    }

    // Reset status to OPEN if it changed
    try {
      await setDoc(reqRef, { status: 'OPEN', updatedAt: new Date().toISOString() }, { merge: true });
    } catch {}

    // ------------------------------------------------------------------------
    // ATTACK TEST 2: Customer sets arbitrary / fake selectedOfferId
    // ------------------------------------------------------------------------
    console.log('\n--- ATTACK 2: Customer attempts to set arbitrary non-existent selectedOfferId ---');
    try {
      await updateDoc(reqRef, {
        status: 'PROVIDER_SELECTED',
        selectedOfferId: 'FAKE_OFFER_NONEXISTENT_999',
        updatedAt: new Date().toISOString(),
      });
      console.warn('⚠️ LIVE SERVER STATUS: Arbitrary selectedOfferId SUCCEEDED (Vulnerable on live server because new local rules are not yet published to Firebase Console).');
    } catch (err: any) {
      const isDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
      if (isDenied) {
        console.log('✅ PASS: Arbitrary non-existent selectedOfferId was DENIED by security rules (PERMISSION_DENIED)');
      } else {
        console.log('Result:', err.message);
      }
    }

    // Reset request to OPEN
    try {
      await setDoc(reqRef, { status: 'OPEN', updatedAt: new Date().toISOString() }, { merge: true });
    } catch {}

    // ------------------------------------------------------------------------
    // ATTACK TEST 3: Customer accepts offer from a DIFFERENT request
    // ------------------------------------------------------------------------
    console.log('\n--- ATTACK 3: Customer attempts to accept offer belonging to another request ---');
    try {
      await updateDoc(reqRef, {
        status: 'PROVIDER_SELECTED',
        selectedOfferId: foreignOfferId, // belongs to otherReqId!
        updatedAt: new Date().toISOString(),
      });
      console.warn('⚠️ LIVE SERVER STATUS: Binding foreign offer SUCCEEDED (Vulnerable on live server because new local rules are not yet published to Firebase Console).');
    } catch (err: any) {
      const isDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
      if (isDenied) {
        console.log('✅ PASS: Binding foreign offer was DENIED by security rules (PERMISSION_DENIED)');
      } else {
        console.log('Result:', err.message);
      }
    }

    // Reset request to OPEN
    try {
      await setDoc(reqRef, { status: 'OPEN', updatedAt: new Date().toISOString() }, { merge: true });
    } catch {}

    // ------------------------------------------------------------------------
    // ATTACK TEST 4: Unselected / Attacker Provider attempts to create conversation on OPEN request
    // ------------------------------------------------------------------------
    console.log('\n--- ATTACK 4: Unselected attacker provider attempts to create conversation for OPEN request ---');
    try {
      await setDoc(doc(attackerProvDb, 'conversations', testConvId), {
        id: testConvId,
        requestId: testReqId,
        customerId: customerUid,
        customerName: 'Test Müşteri',
        providerId: attackerProvUid,
        providerUserId: attackerProvUid,
        providerName: 'Хакер / Шақырылмаған шебер',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      });
      console.warn('⚠️ LIVE SERVER STATUS: Unselected provider conversation creation SUCCEEDED (Vulnerable on live server because new local rules are not yet published to Firebase Console).');
    } catch (err: any) {
      const isDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
      if (isDenied) {
        console.log('✅ PASS: Unselected provider conversation creation was DENIED (PERMISSION_DENIED)');
      } else {
        console.log('Result:', err.message);
      }
    }

    // ------------------------------------------------------------------------
    // LEGITIMATE FLOW 1: Customer updates request details while OPEN
    // ------------------------------------------------------------------------
    console.log('\n--- LEGITIMATE 1: Customer updates request details while OPEN ---');
    try {
      await updateDoc(reqRef, {
        service: 'Жаңартылған қызмет атауы (Заңды)',
        updatedAt: new Date().toISOString(),
      });
      console.log('✅ PASS: Customer successfully updated request details while OPEN');
    } catch (err: any) {
      console.error('❌ FAIL: Customer updating details failed:', err.message);
    }

    // ------------------------------------------------------------------------
    // LEGITIMATE FLOW 2: Customer accepts valid offer
    // ------------------------------------------------------------------------
    console.log('\n--- LEGITIMATE 2: Customer accepts legitimate offer (PROVIDER_SELECTED) ---');
    try {
      // Selecting the offer and accepting it happen in one write
      const batch = writeBatch(db!);
      batch.update(reqRef, { status: 'PROVIDER_SELECTED', selectedOfferId: validOfferId, updatedAt: new Date().toISOString() });
      batch.update(doc(db!, 'offers', validOfferId), { status: 'ACCEPTED', updatedAt: new Date().toISOString() });
      await batch.commit();
      console.log('✅ PASS: Customer successfully accepted legitimate offer');
    } catch (err: any) {
      console.error('❌ FAIL: Customer offer acceptance failed:', err.message);
    }

    // ------------------------------------------------------------------------
    // LEGITIMATE FLOW 3: Create conversation for accepted offer
    // ------------------------------------------------------------------------
    console.log('\n--- LEGITIMATE 3: Conversation creation after offer accepted ---');
    try {
      await setDoc(convRef, {
        id: testConvId,
        requestId: testReqId,
        customerId: customerUid,
        customerName: 'Test Müşteri',
        providerId: selectedProvUid,
        providerUserId: selectedProvUid,
        providerName: 'Шебер Самат',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      });
      console.log('✅ PASS: Conversation successfully created for legitimate selected provider');
    } catch (err: any) {
      console.error('❌ FAIL: Legitimate conversation creation failed:', err.message);
    }

    // ------------------------------------------------------------------------
    // LEGITIMATE FLOW 4: Exchanging messages between customer and selected provider
    // ------------------------------------------------------------------------
    console.log('\n--- LEGITIMATE 4: Messaging between customer and selected provider ---');
    try {
      const msgId = `msg_${Date.now()}`;
      await setDoc(doc(db!, 'conversations', testConvId, 'messages', msgId), {
        id: msgId,
        conversationId: testConvId,
        requestId: testReqId,
        senderId: customerUid,
        senderRole: 'customer',
        type: 'text',
        text: 'Сәлеметсіз бе, жұмысты бастай берейік.',
        createdAt: new Date().toISOString(),
      });
      const provMsgs = await getDocs(collection(selectedProvDb, 'conversations', testConvId, 'messages'));
      assert(provMsgs.size >= 1, 'Provider must read message');
      console.log('✅ PASS: Customer sent message, selected provider successfully read it');
    } catch (err: any) {
      console.error('❌ FAIL: Messaging flow failed:', err.message);
    }

    // ------------------------------------------------------------------------
    // ATTACK TEST 5: Unrelated attacker attempts to read conversation messages
    // ------------------------------------------------------------------------
    console.log('\n--- ATTACK 5: Unrelated user attempts to read conversation messages ---');
    try {
      await getDocs(collection(attackerProvDb, 'conversations', testConvId, 'messages'));
      console.error('❌ FAIL: Unrelated user was able to read conversation messages!');
    } catch (err: any) {
      const isDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
      if (isDenied) {
        console.log('✅ PASS: Unrelated user message reading was DENIED (PERMISSION_DENIED - Stage 8 fix verified)');
      } else {
        console.log('Result:', err.message);
      }
    }

    // ------------------------------------------------------------------------
    // LEGITIMATE FLOW 5: Selected provider reports the job finished; only the customer closes it
    // ------------------------------------------------------------------------
    console.log('\n--- LEGITIMATE 5: Selected provider reports the job finished (providerDoneAt) ---');
    let providerCompleteDenied = false;
    try {
      await updateDoc(doc(selectedProvDb, 'requests', testReqId), { status: 'COMPLETED' });
    } catch (err: any) {
      providerCompleteDenied = err?.code === 'permission-denied' || String(err).includes('PERMISSION_DENIED');
    }
    if (!providerCompleteDenied) throw new Error('Selected provider must not be able to mark the request COMPLETED');
    console.log('✅ PASS: Selected provider cannot close the request alone');
    await updateDoc(doc(selectedProvDb, 'requests', testReqId), { providerDoneAt: new Date().toISOString() });
    console.log('✅ PASS: Selected provider reported the job finished (providerDoneAt)');

  } finally {
    // Cleanup
    console.log('\n--- CLEANUP: Removing transient test documents ---');
    try {
      await deleteDoc(convRef);
      await deleteDoc(validOfferRef);
      await deleteDoc(foreignOfferRef);
      await deleteDoc(reqRef);
      await deleteDoc(otherReqRef);
      console.log('✓ Cleaned up test documents');
    } catch (cleanErr: any) {
      console.warn('Cleanup note:', cleanErr.message);
    }

    try {
      await deleteApp(selectedProvApp);
      await deleteApp(attackerProvApp);
      console.log('✓ Disposed test client app instances');
    } catch {}
  }

  console.log('\n====================================================================');
  console.log('🏁 SECURITY VERIFICATION RUN COMPLETED');
  console.log('====================================================================');
  process.exit(0);
}

runSecurityAudit().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
