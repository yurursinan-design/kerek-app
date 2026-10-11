/**
 * Firestore Security Rules Unit Test Suite
 * 
 * Uses @firebase/rules-unit-testing against Firestore Emulator.
 * Validates real firestore.rules without mock bypasses or simulated helpers.
 * Completely isolated from live production Firebase.
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ID = 'kerek-emulator-security-test';
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

let testEnv: RulesTestEnvironment;

async function runTestSuite() {
  console.log('===============================================================');
  console.log('🛡️  FIRESTORE RULES EMULATOR SECURITY VERIFICATION TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
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

  // 1. Initialize Emulator Environment
  console.log('1. Loading real firestore.rules into test environment...');
  const rules = fs.readFileSync(RULES_PATH, 'utf8');
  
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
  const [host, portStr] = emulatorHost.split(':');
  const port = parseInt(portStr || '8088', 10);

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host,
      port,
    },
  });

  console.log('2. Test environment ready. Running isolated security scenarios...\n');

  try {
    // =========================================================================
    // SECTION 1: Unauthenticated Access & Default Deny
    // =========================================================================
    console.log('--- SECTION 1: Unauthenticated Access & Default Deny ---');

    await test('Unauthenticated user cannot read private user profile', async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(unauthDb, 'users', 'user_alice')));
    });

    await test('Unauthenticated user cannot create request', async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(unauthDb, 'requests', 'req_unauth'), {
          id: 'req_unauth',
          customerId: 'unauth_user',
          city: 'Almaty',
          category: 'appliances',
          service: 'Repair',
          status: 'OPEN',
        })
      );
    });

    await test('Unauthenticated user cannot write to arbitrary collection (Default Deny)', async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(unauthDb, 'admin_secrets', 'secret_1'), { secret: '123' }));
    });

    // =========================================================================
    // SECTION 2: User Profiles (/users/{userId})
    // =========================================================================
    console.log('\n--- SECTION 2: User Profiles (/users/{userId}) ---');

    await test('Authenticated user can create and read their own profile', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, 'users', 'user_alice'), {
          id: 'user_alice',
          name: 'Alice',
          createdAt: new Date().toISOString(),
        })
      );
      await assertSucceeds(getDoc(doc(aliceDb, 'users', 'user_alice')));
    });

    await test('User cannot read or write another user private profile', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      // Read Alice's profile
      await assertFails(getDoc(doc(bobDb, 'users', 'user_alice')));
      // Write / spoof Alice's profile
      await assertFails(
        setDoc(doc(bobDb, 'users', 'user_alice'), {
          id: 'user_alice',
          name: 'Attacker Bob',
          createdAt: new Date().toISOString(),
        })
      );
    });

    // =========================================================================
    // SECTION 3: Provider Profiles (/providers/{providerId})
    // =========================================================================
    console.log('\n--- SECTION 3: Provider Profiles (/providers/{providerId}) ---');

    await test('Provider can create their own profile with matching UID', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(
        setDoc(doc(masterDb, 'providers', 'prov_master1'), {
          id: 'prov_master1',
          userId: 'prov_master1',
          name: 'Master Ruslan',
          city: 'almaty',
          category: 'appliance_repair',
        })
      );
    });

    await test('Provider cannot create profile under another user ID or spoof userId', async () => {
      const attackerDb = testEnv.authenticatedContext('user_attacker').firestore();
      await assertFails(
        setDoc(doc(attackerDb, 'providers', 'prov_master2'), {
          id: 'prov_master2',
          userId: 'user_attacker',
          name: 'Fake Master',
          city: 'almaty',
          category: 'appliance_repair',
        })
      );
      await assertFails(
        setDoc(doc(attackerDb, 'providers', 'user_attacker'), {
          id: 'user_attacker',
          userId: 'prov_master1', // Spoofing master1's userId
          name: 'Fake Master',
          city: 'almaty',
          category: 'appliance_repair',
        })
      );
    });

    // =========================================================================
    // SECTION 4: Customer Requests (/requests/{requestId})
    // =========================================================================
    console.log('\n--- SECTION 4: Requests (/requests/{requestId}) ---');

    await test('Customer can create OPEN request with matching customerId', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, 'requests', 'req_alice_01'), {
          id: 'req_alice_01',
          customerId: 'user_alice',
          city: 'almaty',
          category: 'appliances',
          service: 'Washing machine repair',
          status: 'OPEN',
        })
      );
    });

    await test('User cannot create request on behalf of another customer', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(
        setDoc(doc(bobDb, 'requests', 'req_bob_spoof'), {
          id: 'req_bob_spoof',
          customerId: 'user_alice', // Spoofing Alice as customer
          city: 'almaty',
          category: 'appliances',
          service: 'Repair',
          status: 'OPEN',
        })
      );
    });

    await test('Customer cannot alter request id or customerId on update', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertFails(
        updateDoc(doc(aliceDb, 'requests', 'req_alice_01'), {
          customerId: 'user_bob',
        })
      );
    });

    // =========================================================================
    // SECTION 5: Offers & Selection (/offers/{offerId})
    // =========================================================================
    console.log('\n--- SECTION 5: Offers & Selection (/offers/{offerId}) ---');

    await test('Provider can submit PENDING offer with matching providerUserId', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(
        setDoc(doc(masterDb, 'offers', 'offer_m1_01'), {
          id: 'offer_m1_01',
          requestId: 'req_alice_01',
          providerId: 'prov_master1',
          providerUserId: 'prov_master1',
          providerName: 'Master Ruslan',
          price: '12 000 ₸',
          status: 'PENDING',
        })
      );
    });

    await test('Attacker cannot create offer with someone else providerUserId', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(
        setDoc(doc(bobDb, 'offers', 'offer_fake_01'), {
          id: 'offer_fake_01',
          requestId: 'req_alice_01',
          providerId: 'prov_master1',
          providerUserId: 'prov_master1', // Spoofing master1
          price: '10 000 ₸',
          status: 'PENDING',
        })
      );
    });

    await test('Customer owning the request can accept offer (status -> ACCEPTED)', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        updateDoc(doc(aliceDb, 'offers', 'offer_m1_01'), {
          status: 'ACCEPTED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Unrelated user cannot accept or reject offer', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(
        updateDoc(doc(bobDb, 'offers', 'offer_m1_01'), {
          status: 'REJECTED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    // Seed state: update request to PROVIDER_SELECTED via admin/bypass for subsequent tests
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await updateDoc(doc(adminDb, 'requests', 'req_alice_01'), {
        status: 'PROVIDER_SELECTED',
        selectedOfferId: 'offer_m1_01',
      });
    });

    // =========================================================================
    // SECTION 6: Private Contact Info (/requestContacts/{requestId})
    // =========================================================================
    console.log('\n--- SECTION 6: Private Contact Info (/requestContacts/{requestId}) ---');

    await test('Customer can create their private contact info', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, 'requestContacts', 'req_alice_01'), {
          customerId: 'user_alice',
          phone: '+7 701 555 1234',
        })
      );
    });

    await test('Selected provider can read customer contact info after offer acceptance', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(getDoc(doc(masterDb, 'requestContacts', 'req_alice_01')));
    });

    await test('Unselected third-party user cannot read customer phone number', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(getDoc(doc(bobDb, 'requestContacts', 'req_alice_01')));
    });

    // =========================================================================
    // SECTION 7: In-App Conversations & Messages (/conversations/{id})
    // =========================================================================
    console.log('\n--- SECTION 7: In-App Conversations & Messages ---');

    const convId = 'conv_req_alice_01';

    await test('Customer can create conversation with selected provider', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, 'conversations', convId), {
          id: convId,
          requestId: 'req_alice_01',
          customerId: 'user_alice',
          providerUserId: 'prov_master1',
          status: 'ACTIVE',
        })
      );
    });

    await test('Unrelated third party cannot read conversation', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(getDoc(doc(bobDb, 'conversations', convId)));
    });

    await test('Participant can send message in conversation', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, `conversations/${convId}/messages`, 'msg_001'), {
          id: 'msg_001',
          conversationId: convId,
          requestId: 'req_alice_01',
          senderId: 'user_alice',
          senderRole: 'customer',
          type: 'text',
          text: 'Hello master!',
          createdAt: new Date().toISOString(),
        })
      );
    });

    await test('Unrelated user cannot send message into conversation', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(
        setDoc(doc(bobDb, `conversations/${convId}/messages`, 'msg_attacker'), {
          id: 'msg_attacker',
          conversationId: convId,
          requestId: 'req_alice_01',
          senderId: 'user_bob',
          senderRole: 'customer',
          type: 'text',
          text: 'Spam from outsider',
          createdAt: new Date().toISOString(),
        })
      );
    });

    // =========================================================================
    // SECTION 8: Appointments & Identity Protection (/appointments/{id})
    // =========================================================================
    console.log('\n--- SECTION 8: Appointments & Identity Protection ---');

    const apptId = 'appointment_req_alice_01';
    const createdAtIso = new Date().toISOString();

    await test('Customer can create appointment with proposedBy = customer', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, 'appointments', apptId), {
          id: apptId,
          requestId: 'req_alice_01',
          customerId: 'user_alice',
          providerId: 'prov_master1',
          providerUserId: 'prov_master1',
          proposedBy: 'customer',
          scheduledAt: '2026-10-15 14:00',
          durationMinutes: 60,
          status: 'PROPOSED',
          createdAt: createdAtIso,
          updatedAt: createdAtIso,
        })
      );
    });

    await test('Customer cannot mutate providerId or customerId on appointment update', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertFails(
        updateDoc(doc(aliceDb, 'appointments', apptId), {
          providerId: 'hacked_provider',
        })
      );
      await assertFails(
        updateDoc(doc(aliceDb, 'appointments', apptId), {
          customerId: 'user_bob',
        })
      );
    });

    await test('Provider can confirm appointment (proposedBy preserved)', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(
        updateDoc(doc(masterDb, 'appointments', apptId), {
          status: 'CONFIRMED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Unrelated user cannot update appointment', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(
        updateDoc(doc(bobDb, 'appointments', apptId), {
          status: 'CANCELLED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    // =========================================================================
    // SECTION 9: Reviews & Rating Verification (/reviews/{reviewId})
    // =========================================================================
    console.log('\n--- SECTION 9: Reviews & Rating Verification ---');

    // Attempt review before request is COMPLETED -> must FAIL
    await test('Customer cannot submit review while request is not COMPLETED', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertFails(
        setDoc(doc(aliceDb, 'reviews', 'req_alice_01'), {
          id: 'req_alice_01',
          requestId: 'req_alice_01',
          customerId: 'user_alice',
          providerId: 'prov_master1',
          rating: 5,
          comment: 'Great job',
          createdAt: new Date().toISOString(),
        })
      );
    });

    // Set request to COMPLETED via admin
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await updateDoc(doc(adminDb, 'requests', 'req_alice_01'), {
        status: 'COMPLETED',
      });
    });

    await test('Customer can submit review for COMPLETED request with accepted provider', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, 'reviews', 'req_alice_01'), {
          id: 'req_alice_01',
          requestId: 'req_alice_01',
          customerId: 'user_alice',
          providerId: 'prov_master1',
          rating: 5,
          comment: 'Great job!',
          createdAt: new Date().toISOString(),
        })
      );
    });

    await test('Provider cannot submit review for themselves (Self-Review)', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertFails(
        setDoc(doc(masterDb, 'reviews', 'req_alice_01'), {
          id: 'req_alice_01',
          requestId: 'req_alice_01',
          customerId: 'prov_master1',
          providerId: 'prov_master1',
          rating: 5,
          comment: 'Self review',
          createdAt: new Date().toISOString(),
        })
      );
    });

    await test('Reviews are strictly immutable (update and delete forbidden)', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertFails(
        updateDoc(doc(aliceDb, 'reviews', 'req_alice_01'), {
          rating: 1,
        })
      );
      await assertFails(deleteDoc(doc(aliceDb, 'reviews', 'req_alice_01')));
    });

  } finally {
    // Isolated Emulator Cleanup
    console.log('\n--- CLEANUP: Clearing Emulator Data ---');
    await testEnv.clearFirestore();
    await testEnv.cleanup();
    console.log('✓ Isolated Emulator environment cleaned up successfully');
  }

  console.log('\n===============================================================');
  console.log(`EMULATOR TEST RUN COMPLETED: ${passed} passed, ${failed} failed`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error running Firestore emulator test suite:', err);
  process.exit(1);
});
