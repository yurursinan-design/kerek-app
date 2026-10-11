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
      await assertFails(
        updateDoc(doc(aliceDb, 'requests', 'req_alice_01'), {
          id: 'req_hacked_id',
        })
      );
    });

    // Seed a second provider for competitive / negative scenario tests
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'providers', 'prov_master2'), {
        id: 'prov_master2',
        userId: 'prov_master2',
        name: 'Master Sergey',
        city: 'almaty',
        category: 'appliance_repair',
      });
    });

    // Provider who has not submitted an offer cannot change request status to OFFERS_RECEIVED
    await test('Provider who has not submitted an offer cannot change status to OFFERS_RECEIVED', async () => {
      const master2Db = testEnv.authenticatedContext('prov_master2').firestore();
      await assertFails(
        updateDoc(doc(master2Db, 'requests', 'req_alice_01'), {
          status: 'OFFERS_RECEIVED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    // Request Privacy & Field Security Tests
    await test('Marketplace query / read returns open listing without sensitive contact information', async () => {
      const master1Db = testEnv.authenticatedContext('prov_master1').firestore();
      const reqSnap = await getDoc(doc(master1Db, 'requests', 'req_alice_01'));
      // Provider can read the public request document to make an offer
      await assertSucceeds(getDoc(doc(master1Db, 'requests', 'req_alice_01')));
      const data = reqSnap.data();
      // Ensure private contact info (customer phone) is NEVER in requests collection
      if (data && 'customerPhone' in data && data.customerPhone) {
        throw new Error('Privacy breach: customerPhone found in public request document');
      }
    });

    await test('Unrelated user or unselected provider cannot access private customer contact in requestContacts', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      const master2Db = testEnv.authenticatedContext('prov_master2').firestore();
      await assertFails(getDoc(doc(bobDb, 'requestContacts', 'req_alice_01')));
      await assertFails(getDoc(doc(master2Db, 'requestContacts', 'req_alice_01')));
    });

    // =========================================================================
    // SECTION 5: Offers Creation & Security (/offers/{offerId})
    // =========================================================================
    console.log('\n--- SECTION 5: Offers Creation & Security (/offers/{offerId}) ---');

    await test('Creating offer for non-existent request is rejected', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertFails(
        setDoc(doc(masterDb, 'offers', 'offer_m1_ghost'), {
          id: 'offer_m1_ghost',
          requestId: 'req_non_existent',
          providerId: 'prov_master1',
          providerUserId: 'prov_master1',
          price: '15 000 ₸',
          status: 'PENDING',
        })
      );
    });

    // Seed a CANCELLED request to verify closed request check
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'requests', 'req_closed_01'), {
        id: 'req_closed_01',
        customerId: 'user_alice',
        city: 'almaty',
        category: 'appliances',
        service: 'Repair',
        status: 'CANCELLED',
      });
    });

    await test('Creating offer for closed/cancelled request is rejected', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertFails(
        setDoc(doc(masterDb, 'offers', 'offer_m1_closed'), {
          id: 'offer_m1_closed',
          requestId: 'req_closed_01',
          providerId: 'prov_master1',
          providerUserId: 'prov_master1',
          price: '15 000 ₸',
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

    await test('Provider can submit valid PENDING offer for open request', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(
        setDoc(doc(masterDb, 'offers', 'offer_m1_01'), {
          id: 'offer_m1_01',
          requestId: 'req_alice_01',
          providerId: 'prov_master1',
          providerUserId: 'prov_master1',
          providerName: 'Master Ruslan',
          price: '12 000 ₸',
          availability: 'Today 15:00',
          message: 'Can fix today',
          createdAt: new Date().toISOString(),
          status: 'PENDING',
        })
      );
    });

    // Seed a second offer by prov_master2 for cross-offer exploit testing
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'offers', 'offer_m2_01'), {
        id: 'offer_m2_01',
        requestId: 'req_alice_01',
        providerId: 'prov_master2',
        providerUserId: 'prov_master2',
        providerName: 'Master Sergey',
        price: '14 000 ₸',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
    });

    // Now test Request OFFERS_RECEIVED transition under strict offer verification:
    await test('Attacker cannot use another provider offer to update request status', async () => {
      const master2Db = testEnv.authenticatedContext('prov_master2').firestore();
      // prov_master2 attempts to claim offer_m1_01 belonging to prov_master1
      await assertFails(
        updateDoc(doc(master2Db, 'requests', 'req_alice_01'), {
          status: 'OFFERS_RECEIVED',
          lastOfferId: 'offer_m1_01',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Customer and other unauthorized users cannot use provider privilege to set OFFERS_RECEIVED', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      // Customer cannot use provider branch to transition OPEN -> OFFERS_RECEIVED
      await assertFails(
        updateDoc(doc(aliceDb, 'requests', 'req_alice_01'), {
          status: 'OFFERS_RECEIVED',
          lastOfferId: 'offer_m1_01',
          updatedAt: new Date().toISOString(),
        })
      );
      // Unrelated user cannot use provider branch
      await assertFails(
        updateDoc(doc(bobDb, 'requests', 'req_alice_01'), {
          status: 'OFFERS_RECEIVED',
          lastOfferId: 'offer_m1_01',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Legitimate provider who submitted offer can update request to OFFERS_RECEIVED', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(
        updateDoc(doc(masterDb, 'requests', 'req_alice_01'), {
          status: 'OFFERS_RECEIVED',
          lastOfferId: 'offer_m1_01',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    // =========================================================================
    // SECTION 5B: Offer Updates & Customer Selection
    // =========================================================================
    console.log('\n--- SECTION 5B: Offer Updates & Customer Selection ---');

    await test('Provider can update allowed fields of their own PENDING offer', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(
        updateDoc(doc(masterDb, 'offers', 'offer_m1_01'), {
          price: '11 500 ₸',
          message: 'Updated price with discount',
          availability: 'Today 16:00',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Provider cannot alter immutable identity fields on offer update', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertFails(
        updateDoc(doc(masterDb, 'offers', 'offer_m1_01'), {
          providerUserId: 'user_bob',
        })
      );
      await assertFails(
        updateDoc(doc(masterDb, 'offers', 'offer_m1_01'), {
          requestId: 'req_closed_01',
        })
      );
      await assertFails(
        updateDoc(doc(masterDb, 'offers', 'offer_m1_01'), {
          status: 'ACCEPTED', // Provider cannot self-accept!
        })
      );
    });

    await test('Unrelated user cannot update or tamper with offer', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(
        updateDoc(doc(bobDb, 'offers', 'offer_m1_01'), {
          price: '500 ₸',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    // Unrelated user cannot accept or reject offer while still PENDING (fixes false-positive)
    await test('Unrelated user cannot accept or reject PENDING offer of another customer request', async () => {
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      await assertFails(
        updateDoc(doc(bobDb, 'offers', 'offer_m1_01'), {
          status: 'REJECTED',
          updatedAt: new Date().toISOString(),
        })
      );
      await assertFails(
        updateDoc(doc(bobDb, 'offers', 'offer_m1_01'), {
          status: 'ACCEPTED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Customer cannot tamper with paymentStatus (cannot set held_in_escrow, released, or refunded)', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      // Test setting held_in_escrow directly by customer
      await assertFails(
        updateDoc(doc(aliceDb, 'offers', 'offer_m1_01'), {
          paymentStatus: 'held_in_escrow',
          updatedAt: new Date().toISOString(),
        })
      );
      // Test setting released directly by customer
      await assertFails(
        updateDoc(doc(aliceDb, 'offers', 'offer_m1_01'), {
          paymentStatus: 'released',
          updatedAt: new Date().toISOString(),
        })
      );
      // Test setting refunded directly by customer
      await assertFails(
        updateDoc(doc(aliceDb, 'offers', 'offer_m1_01'), {
          paymentStatus: 'refunded',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Customer owning the request can accept offer (status -> ACCEPTED) without modifying paymentStatus', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(
        updateDoc(doc(aliceDb, 'offers', 'offer_m1_01'), {
          status: 'ACCEPTED',
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

    // 1. İsteğin sahibi müşteri iletişim bilgilerini okuyabilir
    await test('1. Customer owning the request can read their private contact info', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertSucceeds(getDoc(doc(aliceDb, 'requestContacts', 'req_alice_01')));
    });

    // 2. Kabul edilmiş teklifin sağlayıcısı okuyabilir
    await test('2. Provider of an ACCEPTED offer can read customer contact info', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(getDoc(doc(masterDb, 'requestContacts', 'req_alice_01')));
    });

    // Setup isolated test fixtures for pending, rejected, missing, and invalid offer scenarios
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();

      // Scenario 3: Request with a PENDING offer
      await setDoc(doc(adminDb, 'requests', 'req_pending_contact'), {
        id: 'req_pending_contact',
        customerId: 'user_alice',
        status: 'OFFERS_RECEIVED',
        selectedOfferId: 'offer_pending_contact',
      });
      await setDoc(doc(adminDb, 'offers', 'offer_pending_contact'), {
        id: 'offer_pending_contact',
        requestId: 'req_pending_contact',
        providerUserId: 'prov_master2',
        price: 7000,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(adminDb, 'requestContacts', 'req_pending_contact'), {
        customerId: 'user_alice',
        phone: '+7 701 555 2222',
      });

      // Scenario 4: Request with a REJECTED offer
      await setDoc(doc(adminDb, 'requests', 'req_rejected_contact'), {
        id: 'req_rejected_contact',
        customerId: 'user_alice',
        status: 'OPEN',
        selectedOfferId: 'offer_rejected_contact',
      });
      await setDoc(doc(adminDb, 'offers', 'offer_rejected_contact'), {
        id: 'offer_rejected_contact',
        requestId: 'req_rejected_contact',
        providerUserId: 'prov_master2',
        price: 8000,
        status: 'REJECTED',
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(adminDb, 'requestContacts', 'req_rejected_contact'), {
        customerId: 'user_alice',
        phone: '+7 701 555 3333',
      });

      // Scenario 6: Request with missing selectedOfferId
      await setDoc(doc(adminDb, 'requests', 'req_no_selection'), {
        id: 'req_no_selection',
        customerId: 'user_alice',
        status: 'OPEN',
      });
      await setDoc(doc(adminDb, 'requestContacts', 'req_no_selection'), {
        customerId: 'user_alice',
        phone: '+7 701 555 4444',
      });

      // Scenario 6: Request with invalid selectedOfferId (non-existent offer)
      await setDoc(doc(adminDb, 'requests', 'req_invalid_selection'), {
        id: 'req_invalid_selection',
        customerId: 'user_alice',
        status: 'PROVIDER_SELECTED',
        selectedOfferId: 'offer_nonexistent_xyz',
      });
      await setDoc(doc(adminDb, 'requestContacts', 'req_invalid_selection'), {
        customerId: 'user_alice',
        phone: '+7 701 555 5555',
      });

      // Scenario 6: Request where selectedOfferId belongs to a DIFFERENT request
      await setDoc(doc(adminDb, 'requests', 'req_mismatched_offer'), {
        id: 'req_mismatched_offer',
        customerId: 'user_alice',
        status: 'PROVIDER_SELECTED',
        selectedOfferId: 'offer_m1_01', // offer_m1_01 has requestId == 'req_alice_01'
      });
      await setDoc(doc(adminDb, 'requestContacts', 'req_mismatched_offer'), {
        customerId: 'user_alice',
        phone: '+7 701 555 6666',
      });
    });

    // 3. "PENDING" durumundaki teklifin sağlayıcısı okuyamaz
    await test('3. Provider with PENDING offer cannot read customer contact info', async () => {
      const master2Db = testEnv.authenticatedContext('prov_master2').firestore();
      await assertFails(getDoc(doc(master2Db, 'requestContacts', 'req_pending_contact')));
    });

    // 4. "REJECTED" durumundaki teklifin sağlayıcısı okuyamaz
    await test('4. Provider with REJECTED offer cannot read customer contact info', async () => {
      const master2Db = testEnv.authenticatedContext('prov_master2').firestore();
      await assertFails(getDoc(doc(master2Db, 'requestContacts', 'req_rejected_contact')));
    });

    // 5. Başka sağlayıcı ve ilgisiz kullanıcı okuyamaz
    await test('5. Other providers and unrelated users cannot read customer contact info', async () => {
      const master2Db = testEnv.authenticatedContext('prov_master2').firestore();
      const bobDb = testEnv.authenticatedContext('user_bob').firestore();
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(master2Db, 'requestContacts', 'req_alice_01')));
      await assertFails(getDoc(doc(bobDb, 'requestContacts', 'req_alice_01')));
      await assertFails(getDoc(doc(unauthDb, 'requestContacts', 'req_alice_01')));
    });

    // 6. Eksik veya geçersiz "selectedOfferId" durumunda erişim reddedilir
    await test('6. Access denied when selectedOfferId is missing, invalid, or belongs to another request', async () => {
      const master1Db = testEnv.authenticatedContext('prov_master1').firestore();
      // Missing selectedOfferId
      await assertFails(getDoc(doc(master1Db, 'requestContacts', 'req_no_selection')));
      // Invalid (non-existent) selectedOfferId
      await assertFails(getDoc(doc(master1Db, 'requestContacts', 'req_invalid_selection')));
      // Mismatched offer (offer.requestId does not match request document id)
      await assertFails(getDoc(doc(master1Db, 'requestContacts', 'req_mismatched_offer')));
    });

    // 7. Kabul edilmiş geçerli teklif akışı çalışmaya devam eder
    await test('7. Valid accepted offer flow continues to work seamlessly', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      const master1Db = testEnv.authenticatedContext('prov_master1').firestore();
      // Customer reads their contact
      await assertSucceeds(getDoc(doc(aliceDb, 'requestContacts', 'req_alice_01')));
      // Accepted provider reads customer contact
      const provSnap = await getDoc(doc(master1Db, 'requestContacts', 'req_alice_01'));
      await assertSucceeds(getDoc(doc(master1Db, 'requestContacts', 'req_alice_01')));
      if (provSnap.data()?.phone !== '+7 701 555 1234') {
        throw new Error('Expected accepted provider to read verified customer contact details');
      }
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
    // SECTION 8: Appointments & Field Whitelist Protection (/appointments/{id})
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

    await test('Mutating appointment id, requestId, providerUserId, or createdAt is rejected', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertFails(
        updateDoc(doc(aliceDb, 'appointments', apptId), {
          id: 'appointment_hacked',
        })
      );
      await assertFails(
        updateDoc(doc(aliceDb, 'appointments', apptId), {
          requestId: 'req_other',
        })
      );
      await assertFails(
        updateDoc(doc(aliceDb, 'appointments', apptId), {
          providerUserId: 'user_bob',
        })
      );
      await assertFails(
        updateDoc(doc(aliceDb, 'appointments', apptId), {
          createdAt: new Date().toISOString(),
        })
      );
    });

    await test('Injecting unauthorized or unexpected fields into appointment update is rejected', async () => {
      const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
      await assertFails(
        updateDoc(doc(aliceDb, 'appointments', apptId), {
          maliciousInjectedField: 'attack_payload',
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

    await test('Provider can confirm appointment (PROPOSED -> CONFIRMED)', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(
        updateDoc(doc(masterDb, 'appointments', apptId), {
          status: 'CONFIRMED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Provider can update workStatus linearly (PROVIDER_ON_THE_WAY)', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      await assertSucceeds(
        updateDoc(doc(masterDb, 'appointments', apptId), {
          workStatus: 'PROVIDER_ON_THE_WAY',
          workStatusUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Invalid appointment status regression is rejected', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      // Cannot regress CONFIRMED back to PROPOSED
      await assertFails(
        updateDoc(doc(masterDb, 'appointments', apptId), {
          status: 'PROPOSED',
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

    // Isolated Genuine Self-Review Test on Fresh Unreviewed Request (Fixes false-positive)
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      // Create a fresh completed request without an existing review document
      await setDoc(doc(adminDb, 'requests', 'req_self_audit_01'), {
        id: 'req_self_audit_01',
        customerId: 'user_charlie',
        city: 'almaty',
        category: 'appliances',
        service: 'Repair',
        status: 'COMPLETED',
        selectedOfferId: 'offer_charlie_m1',
      });
      await setDoc(doc(adminDb, 'offers', 'offer_charlie_m1'), {
        id: 'offer_charlie_m1',
        requestId: 'req_self_audit_01',
        providerId: 'prov_master1',
        providerUserId: 'prov_master1',
        price: '20 000 ₸',
        status: 'ACCEPTED',
      });
    });

    await test('Provider cannot submit review for themselves on a fresh completed request (Self-Review)', async () => {
      const masterDb = testEnv.authenticatedContext('prov_master1').firestore();
      // prov_master1 tries to create reviews/req_self_audit_01 for their own service
      await assertFails(
        setDoc(doc(masterDb, 'reviews', 'req_self_audit_01'), {
          id: 'req_self_audit_01',
          requestId: 'req_self_audit_01',
          customerId: 'prov_master1',
          providerId: 'prov_master1',
          rating: 5,
          comment: 'I am the best master',
          createdAt: new Date().toISOString(),
        })
      );
    });

    await test('Legitimate customer can review provider on the fresh completed request', async () => {
      const charlieDb = testEnv.authenticatedContext('user_charlie').firestore();
      await assertSucceeds(
        setDoc(doc(charlieDb, 'reviews', 'req_self_audit_01'), {
          id: 'req_self_audit_01',
          requestId: 'req_self_audit_01',
          customerId: 'user_charlie',
          providerId: 'prov_master1',
          rating: 5,
          comment: 'Charlie confirms great work!',
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
