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
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  writeBatch,
  deleteField,
} from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { firebaseRepository } from '../src/services/firebaseRepository';
import { ensureFirebaseAuth, auth } from '../src/services/firebase';
import { setCurrentUserId } from '../src/services/localRepository';

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

  // Publishing (requests, offers, provider profiles) requires a phone-verified account, so test users
  // carry a phone_number claim unless a test deliberately uses anonymousUser().
  const phoneUser = (uid: string) => testEnv.authenticatedContext(uid, { phone_number: '+77000000000' });
  const anonymousUser = (uid: string) => testEnv.authenticatedContext(uid);

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
      const aliceDb = phoneUser('user_alice').firestore();
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
      const bobDb = phoneUser('user_bob').firestore();
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
      const masterDb = phoneUser('prov_master1').firestore();
      await assertSucceeds(
        setDoc(doc(masterDb, 'providers', 'prov_master1'), {
          id: 'prov_master1',
          userId: 'prov_master1',
          name: 'Master Ruslan',
          city: 'almaty',
          cityId: 'almaty',
          category: 'appliance_repair',
        })
      );
    });

    await test('Provider cannot create profile under another user ID or spoof userId', async () => {
      const attackerDb = phoneUser('user_attacker').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, 'requests', 'req_alice_01'), {
          id: 'req_alice_01',
          customerId: 'user_alice',
          city: 'almaty',
          cityId: 'almaty',
          category: 'appliances',
          service: 'Washing machine repair',
          status: 'OPEN',
        })
      );
    });

    await test('User cannot create request on behalf of another customer', async () => {
      const bobDb = phoneUser('user_bob').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
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
        cityId: 'almaty',
        category: 'appliance_repair',
      });
    });

    // Provider who has not submitted an offer cannot change request status to OFFERS_RECEIVED
    await test('Provider who has not submitted an offer cannot change status to OFFERS_RECEIVED', async () => {
      const master2Db = phoneUser('prov_master2').firestore();
      await assertFails(
        updateDoc(doc(master2Db, 'requests', 'req_alice_01'), {
          status: 'OFFERS_RECEIVED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    // Request Privacy & Field Security Tests
    await test('Marketplace query / read returns open listing without sensitive contact information', async () => {
      const master1Db = phoneUser('prov_master1').firestore();
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
      const bobDb = phoneUser('user_bob').firestore();
      const master2Db = phoneUser('prov_master2').firestore();
      await assertFails(getDoc(doc(bobDb, 'requestContacts', 'req_alice_01')));
      await assertFails(getDoc(doc(master2Db, 'requestContacts', 'req_alice_01')));
    });

    // =========================================================================
    // SECTION 5: Offers Creation & Security (/offers/{offerId})
    // =========================================================================
    console.log('\n--- SECTION 5: Offers Creation & Security (/offers/{offerId}) ---');

    await test('Creating offer for non-existent request is rejected', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
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
      const masterDb = phoneUser('prov_master1').firestore();
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
      const bobDb = phoneUser('user_bob').firestore();
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

    const validOffer = (id: string, uid: string, name: string, extra: Record<string, unknown> = {}) => ({
      id,
      requestId: 'req_alice_01',
      providerId: uid,
      providerUserId: uid,
      providerName: name,
      price: '12 000 ₸',
      availability: 'Today 15:00',
      message: 'Can fix today',
      createdAt: new Date().toISOString(),
      status: 'PENDING',
      ...extra,
    });

    await test('Provider can submit valid PENDING offer for open request', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
      await assertSucceeds(
        setDoc(doc(masterDb, 'offers', 'OFFER-req_alice_01-prov_master1'), validOffer('OFFER-req_alice_01-prov_master1', 'prov_master1', 'Master Ruslan'))
      );
    });

    await test('A provider has one offer per request: any other offer id is rejected', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
      await assertFails(setDoc(doc(masterDb, 'offers', 'offer_m1_second'), validOffer('offer_m1_second', 'prov_master1', 'Master Ruslan')));
    });

    await test('A user without a provider profile cannot send an offer', async () => {
      const bobDb = phoneUser('user_bob').firestore();
      await assertFails(setDoc(doc(bobDb, 'offers', 'OFFER-req_alice_01-user_bob'), validOffer('OFFER-req_alice_01-user_bob', 'user_bob', 'Bob')));
    });

    await test('A provider from another city cannot send an offer', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'providers', 'prov_astana'), {
          id: 'prov_astana', userId: 'prov_astana', name: 'Astana Master', city: 'astana', cityId: 'astana', category: 'appliance_repair',
        });
      });
      const astanaDb = phoneUser('prov_astana').firestore();
      await assertFails(setDoc(doc(astanaDb, 'offers', 'OFFER-req_alice_01-prov_astana'), validOffer('OFFER-req_alice_01-prov_astana', 'prov_astana', 'Astana Master')));
    });

    await test('Customer cannot send an offer on their own request', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'providers', 'user_alice'), {
          id: 'user_alice', userId: 'user_alice', name: 'Alice Pro', city: 'almaty', cityId: 'almaty', category: 'appliance_repair',
        });
      });
      const aliceDb = phoneUser('user_alice').firestore();
      await assertFails(setDoc(doc(aliceDb, 'offers', 'OFFER-req_alice_01-user_alice'), validOffer('OFFER-req_alice_01-user_alice', 'user_alice', 'Alice Pro')));
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore(), 'providers', 'user_alice'));
      });
    });

    await test('Offer cannot carry demo flags, ratings or a name other than the provider profile', async () => {
      const master2Db = phoneUser('prov_master2').firestore();
      const id = 'OFFER-req_alice_01-prov_master2';
      await assertFails(setDoc(doc(master2Db, 'offers', id), validOffer(id, 'prov_master2', 'Master Sergey', { isDemo: true })));
      await assertFails(setDoc(doc(master2Db, 'offers', id), validOffer(id, 'prov_master2', 'Master Sergey', { rating: 5, reviewsCount: 99 })));
      await assertFails(setDoc(doc(master2Db, 'offers', id), validOffer(id, 'prov_master2', 'KEREK Support')));
    });

    // Later scenarios use a fixed offer id for the first provider
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      await setDoc(doc(adminContext.firestore(), 'offers', 'offer_m1_01'), validOffer('offer_m1_01', 'prov_master1', 'Master Ruslan'));
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
      const master2Db = phoneUser('prov_master2').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
      const bobDb = phoneUser('user_bob').firestore();
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
      const masterDb = phoneUser('prov_master1').firestore();
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
      const masterDb = phoneUser('prov_master1').firestore();
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
      const masterDb = phoneUser('prov_master1').firestore();
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
      const bobDb = phoneUser('user_bob').firestore();
      await assertFails(
        updateDoc(doc(bobDb, 'offers', 'offer_m1_01'), {
          price: '500 ₸',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    // Unrelated user cannot accept or reject offer while still PENDING (fixes false-positive)
    await test('Unrelated user cannot accept or reject PENDING offer of another customer request', async () => {
      const bobDb = phoneUser('user_bob').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
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

    await test('Customer cannot mark an offer ACCEPTED without selecting it on the request', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      await assertFails(updateDoc(doc(aliceDb, 'offers', 'offer_m1_01'), { status: 'ACCEPTED', updatedAt: new Date().toISOString() }));
    });

    await test('Customer cannot select an offer on the request without accepting it in the same write', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      await assertFails(updateDoc(doc(aliceDb, 'requests', 'req_alice_01'), { status: 'PROVIDER_SELECTED', selectedOfferId: 'offer_m1_01', updatedAt: new Date().toISOString() }));
    });

    await test('Customer owning the request can accept offer (status -> ACCEPTED) without modifying paymentStatus', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      const batch = writeBatch(aliceDb);
      const now = new Date().toISOString();
      batch.update(doc(aliceDb, 'requests', 'req_alice_01'), { status: 'PROVIDER_SELECTED', selectedOfferId: 'offer_m1_01', updatedAt: now });
      batch.update(doc(aliceDb, 'offers', 'offer_m1_01'), { status: 'ACCEPTED', updatedAt: now });
      await assertSucceeds(batch.commit());
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
    // SECTION 5C: Concurrent Parallel Offer Acceptance Security & Data Integrity
    // =========================================================================
    console.log('\n--- SECTION 5C: Concurrent Parallel Offer Acceptance ---');

    await ensureFirebaseAuth();
    if (auth) {
      (auth as any).currentUser = { uid: 'user_alice' };
    }

    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'requests', 'req_concurrent_01'), {
        id: 'req_concurrent_01',
        customerId: 'user_alice',
        city: 'almaty',
        category: 'appliances',
        service: 'Repair',
        status: 'OPEN',
      });
      await setDoc(doc(adminDb, 'offers', 'offer_conc_A'), {
        id: 'offer_conc_A',
        requestId: 'req_concurrent_01',
        providerId: 'prov_master1',
        providerUserId: 'prov_master1',
        price: '10 000 ₸',
        status: 'PENDING',
      });
      await setDoc(doc(adminDb, 'offers', 'offer_conc_B'), {
        id: 'offer_conc_B',
        requestId: 'req_concurrent_01',
        providerId: 'prov_master2',
        providerUserId: 'prov_master2',
        price: '12 000 ₸',
        status: 'PENDING',
      });
    });

    await test('Parallel concurrent offer acceptance via firebaseRepository.acceptOffer results in exactly 1 ACCEPTED offer and consistent request state', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      // acceptOffer's client-side ownership check reads the app's current user id, not the
      // test context's auth, so align it with the context the transaction runs under.
      setCurrentUserId('user_alice');
      const pA = firebaseRepository.acceptOffer('req_concurrent_01', 'offer_conc_A', aliceDb as any);
      const pB = firebaseRepository.acceptOffer('req_concurrent_01', 'offer_conc_B', aliceDb as any);

      const results = await Promise.allSettled([pA, pB]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      if (fulfilled.length !== 1 || rejected.length !== 1) {
        throw new Error(`Expected exactly 1 fulfilled and 1 rejected transaction, got fulfilled=${fulfilled.length}, rejected=${rejected.length}`);
      }

      // Verify Firestore state consistency via admin bypass
      await testEnv.withSecurityRulesDisabled(async (adminContext) => {
        const adminDb = adminContext.firestore();
        const finalReq = (await getDoc(doc(adminDb, 'requests', 'req_concurrent_01'))).data();
        const finalOfferA = (await getDoc(doc(adminDb, 'offers', 'offer_conc_A'))).data();
        const finalOfferB = (await getDoc(doc(adminDb, 'offers', 'offer_conc_B'))).data();

        if (finalReq?.status !== 'PROVIDER_SELECTED') {
          throw new Error(`Expected request status PROVIDER_SELECTED, got ${finalReq?.status}`);
        }

        const winningOfferId = finalReq?.selectedOfferId;
        if (winningOfferId !== 'offer_conc_A' && winningOfferId !== 'offer_conc_B') {
          throw new Error(`Invalid selectedOfferId in request: ${winningOfferId}`);
        }

        if (winningOfferId === 'offer_conc_A') {
          if (finalOfferA?.status !== 'ACCEPTED' || finalOfferB?.status !== 'REJECTED') {
            throw new Error('Mismatch between request selectedOfferId and offer statuses for offer_conc_A');
          }
        } else {
          if (finalOfferB?.status !== 'ACCEPTED' || finalOfferA?.status !== 'REJECTED') {
            throw new Error('Mismatch between request selectedOfferId and offer statuses for offer_conc_B');
          }
        }
      });
    });

    // =========================================================================
    // SECTION 6: Private Contact Info (/requestContacts/{requestId})
    // =========================================================================
    console.log('\n--- SECTION 6: Private Contact Info (/requestContacts/{requestId}) ---');

    await test('Customer can create their private contact info', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      await assertSucceeds(
        setDoc(doc(aliceDb, 'requestContacts', 'req_alice_01'), {
          customerId: 'user_alice',
          phone: '+7 701 555 1234',
        })
      );
    });

    // 1. İsteğin sahibi müşteri iletişim bilgilerini okuyabilir
    await test('1. Customer owning the request can read their private contact info', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      await assertSucceeds(getDoc(doc(aliceDb, 'requestContacts', 'req_alice_01')));
    });

    // 2. Kabul edilmiş teklifin sağlayıcısı okuyabilir
    await test('2. Provider of an ACCEPTED offer can read customer contact info', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
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
      const master2Db = phoneUser('prov_master2').firestore();
      await assertFails(getDoc(doc(master2Db, 'requestContacts', 'req_pending_contact')));
    });

    // 4. "REJECTED" durumundaki teklifin sağlayıcısı okuyamaz
    await test('4. Provider with REJECTED offer cannot read customer contact info', async () => {
      const master2Db = phoneUser('prov_master2').firestore();
      await assertFails(getDoc(doc(master2Db, 'requestContacts', 'req_rejected_contact')));
    });

    // 5. Başka sağlayıcı ve ilgisiz kullanıcı okuyamaz
    await test('5. Other providers and unrelated users cannot read customer contact info', async () => {
      const master2Db = phoneUser('prov_master2').firestore();
      const bobDb = phoneUser('user_bob').firestore();
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(master2Db, 'requestContacts', 'req_alice_01')));
      await assertFails(getDoc(doc(bobDb, 'requestContacts', 'req_alice_01')));
      await assertFails(getDoc(doc(unauthDb, 'requestContacts', 'req_alice_01')));
    });

    // 6. Eksik veya geçersiz "selectedOfferId" durumunda erişim reddedilir
    await test('6. Access denied when selectedOfferId is missing, invalid, or belongs to another request', async () => {
      const master1Db = phoneUser('prov_master1').firestore();
      // Missing selectedOfferId
      await assertFails(getDoc(doc(master1Db, 'requestContacts', 'req_no_selection')));
      // Invalid (non-existent) selectedOfferId
      await assertFails(getDoc(doc(master1Db, 'requestContacts', 'req_invalid_selection')));
      // Mismatched offer (offer.requestId does not match request document id)
      await assertFails(getDoc(doc(master1Db, 'requestContacts', 'req_mismatched_offer')));
    });

    // 7. Kabul edilmiş geçerli teklif akışı çalışmaya devam eder
    await test('7. Valid accepted offer flow continues to work seamlessly', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      const master1Db = phoneUser('prov_master1').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
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
      const bobDb = phoneUser('user_bob').firestore();
      await assertFails(getDoc(doc(bobDb, 'conversations', convId)));
    });

    await test('Participant can send message in conversation', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
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
      const bobDb = phoneUser('user_bob').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
      await assertFails(
        updateDoc(doc(aliceDb, 'appointments', apptId), {
          maliciousInjectedField: 'attack_payload',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Unrelated user cannot update appointment', async () => {
      const bobDb = phoneUser('user_bob').firestore();
      await assertFails(
        updateDoc(doc(bobDb, 'appointments', apptId), {
          status: 'CANCELLED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Provider can confirm appointment (PROPOSED -> CONFIRMED)', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
      await assertSucceeds(
        updateDoc(doc(masterDb, 'appointments', apptId), {
          status: 'CONFIRMED',
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Provider can update workStatus linearly (PROVIDER_ON_THE_WAY)', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
      await assertSucceeds(
        updateDoc(doc(masterDb, 'appointments', apptId), {
          workStatus: 'PROVIDER_ON_THE_WAY',
          workStatusUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await test('Invalid appointment status regression is rejected', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
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
      const masterDb = phoneUser('prov_master1').firestore();
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
      const charlieDb = phoneUser('user_charlie').firestore();
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
      const aliceDb = phoneUser('user_alice').firestore();
      await assertFails(
        updateDoc(doc(aliceDb, 'reviews', 'req_alice_01'), {
          rating: 1,
        })
      );
      await assertFails(deleteDoc(doc(aliceDb, 'reviews', 'req_alice_01')));
    });

    // =========================================================================
    // SECTION 10: In-App Notification Security (/notifications/{notificationId})
    // =========================================================================
    console.log('\n--- SECTION 10: In-App Notification Security ---');

    // Fixtures: a request with a selected provider (prov_master1), a still-pending offer
    // (prov_master2), a rejected offer (prov_rej), a conversation with one message from each side,
    // and a cancelled request.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const now = new Date().toISOString();
      await setDoc(doc(db, 'requests', 'req_n'), {
        id: 'req_n', customerId: 'user_alice', city: 'almaty', cityId: 'almaty', category: 'appliances',
        service: 'Repair', status: 'PROVIDER_SELECTED', selectedOfferId: 'OFFER-req_n-prov_master1', createdAt: now,
      });
      const offer = (uid: string, status: string) => ({
        id: `OFFER-req_n-${uid}`, requestId: 'req_n', providerId: uid, providerUserId: uid, providerName: uid,
        price: '1000', status, createdAt: now,
      });
      await setDoc(doc(db, 'offers', 'OFFER-req_n-prov_master1'), offer('prov_master1', 'ACCEPTED'));
      await setDoc(doc(db, 'offers', 'OFFER-req_n-prov_master2'), offer('prov_master2', 'PENDING'));
      await setDoc(doc(db, 'offers', 'OFFER-req_n-prov_rej'), offer('prov_rej', 'REJECTED'));
      await setDoc(doc(db, 'conversations', 'conv_req_n'), {
        id: 'conv_req_n', requestId: 'req_n', customerId: 'user_alice', providerId: 'prov_master1',
        providerUserId: 'prov_master1', status: 'ACTIVE', createdAt: now, updatedAt: now,
      });
      await setDoc(doc(db, 'conversations', 'conv_req_n', 'messages', 'msg_p1'), {
        id: 'msg_p1', conversationId: 'conv_req_n', requestId: 'req_n', senderId: 'prov_master1', senderRole: 'provider', type: 'text', text: 'Hi', createdAt: now,
      });
      await setDoc(doc(db, 'conversations', 'conv_req_n', 'messages', 'msg_c1'), {
        id: 'msg_c1', conversationId: 'conv_req_n', requestId: 'req_n', senderId: 'user_alice', senderRole: 'customer', type: 'text', text: 'Hello', createdAt: now,
      });
      await setDoc(doc(db, 'requests', 'req_nc'), {
        id: 'req_nc', customerId: 'user_alice', city: 'almaty', cityId: 'almaty', category: 'appliances',
        service: 'Repair', status: 'CANCELLED', selectedOfferId: 'OFFER-req_nc-prov_master1', createdAt: now,
      });
      await setDoc(doc(db, 'offers', 'OFFER-req_nc-prov_master1'), {
        id: 'OFFER-req_nc-prov_master1', requestId: 'req_nc', providerId: 'prov_master1', providerUserId: 'prov_master1',
        providerName: 'Master Ruslan', price: '1000', status: 'ACCEPTED', createdAt: now,
      });
    });

    const notif = (id: string, extra: Record<string, unknown>) => ({
      id,
      title: { kz: 'Тақырып', ru: 'Заголовок' },
      body: { kz: 'Мәтін', ru: 'Текст' },
      requestId: 'req_n',
      targetScreen: 'request_detail',
      isRead: false,
      readAt: null,
      createdAt: new Date().toISOString(),
      ...extra,
    });
    const toCustomer = { recipientUserId: 'user_alice', recipientRole: 'customer' };
    const toMaster1 = { recipientUserId: 'prov_master1', recipientRole: 'provider' };
    const aliceN = () => phoneUser('user_alice').firestore();
    const m1N = () => phoneUser('prov_master1').firestore();
    const m2N = () => phoneUser('prov_master2').firestore();
    const rejN = () => phoneUser('prov_rej').firestore();
    const put = (db: any, id: string, extra: Record<string, unknown>) => setDoc(doc(db, 'notifications', id), notif(id, extra));

    await test('Customer can notify themselves that they accepted an offer', async () => {
      await assertSucceeds(put(aliceN(), 'notif_offer_accepted_cust_OFFER-req_n-prov_master1',
        { ...toCustomer, type: 'CUSTOMER_OFFER_ACCEPTED', offerId: 'OFFER-req_n-prov_master1' }));
    });

    await test('Another user cannot send the customer an "offer accepted" notice', async () => {
      await assertFails(put(phoneUser('user_bob').firestore(), 'notif_offer_accepted_cust_OFFER-req_n-prov_master1',
        { ...toCustomer, type: 'CUSTOMER_OFFER_ACCEPTED', offerId: 'OFFER-req_n-prov_master1' }));
    });

    await test('Customer can tell the selected provider their offer was accepted', async () => {
      await assertSucceeds(put(aliceN(), 'notif_offer_accepted_prov_OFFER-req_n-prov_master1',
        { ...toMaster1, type: 'PROVIDER_OFFER_ACCEPTED', offerId: 'OFFER-req_n-prov_master1' }));
    });

    await test('A notification id must match what it reports (no free ids, so no endless stream)', async () => {
      await assertFails(put(aliceN(), 'notif_random_spam_1',
        { ...toMaster1, type: 'PROVIDER_OFFER_ACCEPTED', offerId: 'OFFER-req_n-prov_master1' }));
      await assertFails(put(m1N(), 'notif_done_cust_req_n_2',
        { ...toCustomer, type: 'CUSTOMER_WORK_COMPLETED' }));
    });

    await test('Provider with a pending offer can tell the customer about it (once, by offer id)', async () => {
      await assertSucceeds(put(m2N(), 'notif_offer_OFFER-req_n-prov_master2',
        { ...toCustomer, type: 'CUSTOMER_NEW_OFFER', offerId: 'OFFER-req_n-prov_master2', targetScreen: 'offers_list' }));
    });

    await test('A rejected provider cannot keep sending the customer notifications', async () => {
      await assertFails(put(rejN(), 'notif_offer_OFFER-req_n-prov_rej',
        { ...toCustomer, type: 'CUSTOMER_NEW_OFFER', offerId: 'OFFER-req_n-prov_rej', targetScreen: 'offers_list' }));
      await assertFails(put(rejN(), 'notif_appt_create_appointment_req_n_1',
        { ...toCustomer, type: 'CUSTOMER_APPOINTMENT_CREATED', offerId: 'OFFER-req_n-prov_rej' }));
    });

    await test('A "new offer" notice is only for a pending offer', async () => {
      await assertFails(put(m1N(), 'notif_offer_OFFER-req_n-prov_master1',
        { ...toCustomer, type: 'CUSTOMER_NEW_OFFER', offerId: 'OFFER-req_n-prov_master1', targetScreen: 'offers_list' }));
    });

    await test('Message notification needs a real message written by the sender', async () => {
      await assertSucceeds(put(m1N(), 'notif_msg_msg_p1',
        { ...toCustomer, type: 'CUSTOMER_NEW_MESSAGE', conversationId: 'conv_req_n', targetScreen: 'chat' }));
      await assertSucceeds(put(aliceN(), 'notif_msg_msg_c1',
        { ...toMaster1, type: 'PROVIDER_NEW_MESSAGE', conversationId: 'conv_req_n', targetScreen: 'chat' }));
      // The customer cannot use the provider's message, and a missing message gives nothing
      await assertFails(put(aliceN(), 'notif_msg_msg_p1',
        { ...toMaster1, type: 'PROVIDER_NEW_MESSAGE', conversationId: 'conv_req_n', targetScreen: 'chat' }));
      await assertFails(put(m1N(), 'notif_msg_msg_missing',
        { ...toCustomer, type: 'CUSTOMER_NEW_MESSAGE', conversationId: 'conv_req_n', targetScreen: 'chat' }));
    });

    await test('Notification text is short and only in Kazakh and Russian; no extra fields', async () => {
      await assertFails(put(m1N(), 'notif_done_cust_req_n',
        { ...toCustomer, type: 'CUSTOMER_WORK_COMPLETED', body: { kz: 'x'.repeat(5000), ru: 'x' } }));
      await assertFails(put(m1N(), 'notif_done_cust_req_n',
        { ...toCustomer, type: 'CUSTOMER_WORK_COMPLETED', title: 'KEREK: аккаунт заблокирован' }));
      await assertFails(put(m1N(), 'notif_done_cust_req_n',
        { ...toCustomer, type: 'CUSTOMER_WORK_COMPLETED', link: 'https://evil.example' }));
      await assertFails(put(m1N(), 'notif_done_cust_req_n',
        { ...toCustomer, type: 'CUSTOMER_WORK_COMPLETED', title: null }));
    });

    await test('Selected provider reports the job done; customer tells the provider it is completed', async () => {
      await assertSucceeds(put(m1N(), 'notif_done_cust_req_n', { ...toCustomer, type: 'CUSTOMER_WORK_COMPLETED' }));
      await assertSucceeds(put(aliceN(), 'notif_completed_prov_req_n',
        { ...toMaster1, type: 'PROVIDER_WORK_COMPLETED', offerId: 'OFFER-req_n-prov_master1' }));
      await assertSucceeds(put(aliceN(), 'notif_review_req_n', { ...toCustomer, type: 'CUSTOMER_REVIEW_REQUIRED', targetScreen: 'review_modal' }));
    });

    await test('Appointment notices are bound to the request and allowed only while the job is active', async () => {
      await assertSucceeds(put(m1N(), 'notif_appt_create_appointment_req_n_1700000000000',
        { ...toCustomer, type: 'CUSTOMER_APPOINTMENT_CREATED' }));
      await assertSucceeds(put(m1N(), 'notif_workstatus_appointment_req_n_provider_on_the_way_1',
        { ...toCustomer, type: 'CUSTOMER_PROVIDER_ON_THE_WAY' }));
      await assertFails(put(m1N(), 'notif_appt_create_appointment_req_other_1',
        { ...toCustomer, type: 'CUSTOMER_APPOINTMENT_CREATED' }));
      await assertFails(put(m1N(), 'notif_appt_create_appointment_req_nc_1',
        { ...toCustomer, type: 'CUSTOMER_APPOINTMENT_CREATED', requestId: 'req_nc' }));
    });

    await test('Cancellation notice only for a cancelled request', async () => {
      await assertSucceeds(put(aliceN(), 'notif_cancelled_req_nc',
        { ...toMaster1, type: 'PROVIDER_REQUEST_CANCELLED', requestId: 'req_nc' }));
      await assertFails(put(aliceN(), 'notif_cancelled_req_n',
        { ...toMaster1, type: 'PROVIDER_REQUEST_CANCELLED' }));
    });

    await test('Unknown types, client NEW_REQUEST alerts and missing requests are denied', async () => {
      await assertFails(put(m1N(), 'notif_done_cust_req_n9', { ...toCustomer, type: 'INVALID_SUPER_ADMIN_SPAM' }));
      await assertFails(put(aliceN(), 'notif_new_request_req_n_prov_master1', { ...toMaster1, type: 'NEW_REQUEST' }));
      await assertFails(put(m1N(), 'notif_done_cust_req_fake', { ...toCustomer, type: 'CUSTOMER_WORK_COMPLETED', requestId: 'req_fake' }));
    });

    await test('The recipient can delete their notification; others cannot', async () => {
      await assertFails(deleteDoc(doc(m1N(), 'notifications', 'notif_done_cust_req_n')));
      await assertSucceeds(deleteDoc(doc(aliceN(), 'notifications', 'notif_done_cust_req_n')));
    });

    // =========================================================================
    // SECTION 11: Hardening — impersonation, self-assigned badges, payment state,
    // conversation access and field size limits
    // =========================================================================
    console.log('\n--- SECTION 11: Hardening (impersonation, badges, payment, sizes) ---');

    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'requests', 'req_h_open'), {
        id: 'req_h_open',
        customerId: 'user_alice',
        city: 'almaty',
        cityId: 'almaty',
        category: 'appliances',
        service: 'Repair',
        status: 'OPEN',
      });
      await setDoc(doc(adminDb, 'providers', 'prov_trusted'), {
        id: 'prov_trusted',
        userId: 'prov_trusted',
        name: 'Trusted Master',
        city: 'almaty',
        cityId: 'almaty',
        category: 'appliances',
      });
      await setDoc(doc(adminDb, 'providers', 'mallory'), {
        id: 'mallory',
        userId: 'mallory',
        name: 'Mallory',
        city: 'almaty',
        cityId: 'almaty',
        category: 'appliances',
      });
      await setDoc(doc(adminDb, 'offers', 'offer_h_mallory'), {
        id: 'offer_h_mallory',
        requestId: 'req_h_open',
        providerId: 'mallory',
        providerUserId: 'mallory',
        price: '10 000 ₸',
        status: 'PENDING',
      });
      await setDoc(doc(adminDb, 'conversations', 'conv_req_h_sel'), {
        id: 'conv_req_h_sel',
        requestId: 'req_h_sel',
        customerId: 'user_alice',
        providerId: 'mallory',
        providerUserId: 'mallory',
        status: 'ACTIVE',
      });
    });

    const malloryDb = () => phoneUser('mallory').firestore();
    const baseOffer = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      requestId: 'req_h_open',
      providerUserId: 'mallory',
      providerName: 'Mallory',
      price: '9 000 ₸',
      status: 'PENDING',
      ...extra,
    });

    await test('Provider cannot create an offer that impersonates another provider profile', async () => {
      await assertFails(
        setDoc(doc(malloryDb(), 'offers', 'offer_h_imp'), baseOffer('offer_h_imp', { providerId: 'prov_trusted', providerName: 'Trusted Master' }))
      );
    });

    await test('Provider can create an offer under their own provider profile', async () => {
      await assertSucceeds(
        setDoc(doc(malloryDb(), 'offers', 'OFFER-req_h_open-mallory'), baseOffer('OFFER-req_h_open-mallory', { providerId: 'mallory', iinVerified: false, hasCertificate: false }))
      );
    });

    await test('Provider cannot create an offer with a pre-set paymentStatus', async () => {
      await assertFails(
        setDoc(doc(malloryDb(), 'offers', 'offer_h_pay'), baseOffer('offer_h_pay', { providerId: 'mallory', paymentStatus: 'held_in_escrow' }))
      );
    });

    await test('Provider cannot create an offer carrying self-assigned trust badges', async () => {
      await assertFails(
        setDoc(doc(malloryDb(), 'offers', 'offer_h_badge'), baseOffer('offer_h_badge', { providerId: 'mallory', iinVerified: true }))
      );
      await assertFails(
        setDoc(doc(malloryDb(), 'offers', 'offer_h_badge2'), baseOffer('offer_h_badge2', { providerId: 'mallory', hasCertificate: true }))
      );
    });

    await test('Provider cannot turn on trust badges by editing a pending offer', async () => {
      await assertFails(updateDoc(doc(malloryDb(), 'offers', 'offer_h_mallory'), { iinVerified: true }));
    });

    await test('Provider can still edit price and message of their pending offer', async () => {
      await assertSucceeds(updateDoc(doc(malloryDb(), 'offers', 'offer_h_mallory'), { price: '8 500 ₸', message: 'Бүгін келемін' }));
    });

    await test('Offer message longer than 2000 characters is rejected', async () => {
      await assertFails(
        setDoc(doc(malloryDb(), 'offers', 'offer_h_long'), baseOffer('offer_h_long', { providerId: 'mallory', message: 'x'.repeat(2001) }))
      );
    });

    await test('Provider cannot create a profile with self-assigned verified / IIN / certificate badges', async () => {
      const eveDb = phoneUser('eve').firestore();
      const base = { id: 'eve', userId: 'eve', name: 'Eve', city: 'almaty', cityId: 'almaty', category: 'appliances' };
      await assertFails(setDoc(doc(eveDb, 'providers', 'eve'), { ...base, iinVerified: true }));
      await assertFails(setDoc(doc(eveDb, 'providers', 'eve'), { ...base, verified: true }));
      await assertFails(setDoc(doc(eveDb, 'providers', 'eve'), { ...base, hasCertificate: true }));
      await assertSucceeds(setDoc(doc(eveDb, 'providers', 'eve'), { ...base, verified: false, iinVerified: false, hasCertificate: false }));
    });

    await test('Provider cannot add trust badges to an existing profile', async () => {
      await assertFails(updateDoc(doc(malloryDb(), 'providers', 'mallory'), { iinVerified: true }));
      await assertSucceeds(updateDoc(doc(malloryDb(), 'providers', 'mallory'), { description: 'Тәжірибем 3 жыл' }));
    });

    await test('Provider description longer than 5000 characters is rejected', async () => {
      await assertFails(updateDoc(doc(malloryDb(), 'providers', 'mallory'), { description: 'x'.repeat(5001) }));
    });

    const aliceDb = () => phoneUser('user_alice').firestore();
    const baseRequest = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      customerId: 'user_alice',
      city: 'almaty',
      category: 'appliances',
      service: 'Repair',
      status: 'MATCHING',
      ...extra,
    });

    await test('Customer can create a normal request', async () => {
      await assertSucceeds(setDoc(doc(aliceDb(), 'requests', 'req_h_ok'), baseRequest('req_h_ok', { requestText: 'Тоңазытқыш суытпайды' })));
    });

    await test('Customer cannot create a request with pre-set payment or selection state', async () => {
      await assertFails(setDoc(doc(aliceDb(), 'requests', 'req_h_pay'), baseRequest('req_h_pay', { paymentStatus: 'held_in_escrow' })));
      await assertFails(setDoc(doc(aliceDb(), 'requests', 'req_h_esc'), baseRequest('req_h_esc', { escrowAmount: 15000 })));
      await assertFails(setDoc(doc(aliceDb(), 'requests', 'req_h_sel2'), baseRequest('req_h_sel2', { selectedOfferId: 'offer_h_mallory' })));
    });

    await test('Request text longer than 5000 characters is rejected', async () => {
      await assertFails(setDoc(doc(aliceDb(), 'requests', 'req_h_long'), baseRequest('req_h_long', { requestText: 'x'.repeat(5001) })));
    });

    await test('Chat participant cannot change the conversation providerId to add a third person', async () => {
      await assertFails(updateDoc(doc(malloryDb(), 'conversations', 'conv_req_h_sel'), { providerId: 'eve' }));
      await assertFails(updateDoc(doc(aliceDb(), 'conversations', 'conv_req_h_sel'), { providerId: 'eve' }));
    });

    await test('Chat participant can still update last message summary and unread counters', async () => {
      await assertSucceeds(
        updateDoc(doc(aliceDb(), 'conversations', 'conv_req_h_sel'), {
          lastMessageText: 'Сәлем!',
          lastMessageSenderId: 'user_alice',
          unreadCountProvider: 1,
        })
      );
    });

    // =========================================================================
    // SECTION 12: Request visibility — only the customer, providers in the same
    // city, and the selected provider can read a request
    // =========================================================================
    console.log('\n--- SECTION 12: Request visibility ---');

    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'requests', 'req_v_almaty'), {
        id: 'req_v_almaty',
        customerId: 'cust_v',
        customerName: 'Клиент',
        city: 'Алматы',
        cityId: 'almaty',
        category: 'appliances',
        categoryId: 'appliances',
        service: 'Тоңазытқыш жөндеу',
        status: 'MATCHING',
        location: { latitude: 43.24, longitude: 76.95 },
      });
      await setDoc(doc(adminDb, 'providers', 'prov_v_almaty'), {
        id: 'prov_v_almaty', userId: 'prov_v_almaty', name: 'Almaty Master', city: 'Алматы', cityId: 'almaty', category: 'appliances', categoryId: 'appliances',
      });
      await setDoc(doc(adminDb, 'providers', 'prov_v_astana'), {
        id: 'prov_v_astana', userId: 'prov_v_astana', name: 'Astana Master', city: 'Астана', cityId: 'astana', category: 'appliances', categoryId: 'appliances',
      });
      // A request in Almaty whose selected provider is based in Astana
      await setDoc(doc(adminDb, 'offers', 'offer_v_sel'), {
        id: 'offer_v_sel', requestId: 'req_v_sel', providerId: 'prov_v_astana', providerUserId: 'prov_v_astana', price: '1', status: 'ACCEPTED',
      });
      await setDoc(doc(adminDb, 'requests', 'req_v_sel'), {
        id: 'req_v_sel', customerId: 'cust_v', city: 'Алматы', cityId: 'almaty', category: 'appliances', categoryId: 'appliances',
        service: 'x', status: 'PROVIDER_SELECTED', selectedOfferId: 'offer_v_sel',
      });
    });

    const ctx = (uid: string) => phoneUser(uid).firestore();
    const OPEN = ['OPEN', 'NEW', 'MATCHING', 'OFFERS_RECEIVED'];
    const cityQuery = (db: any, cityId: string) =>
      getDocs(query(collection(db, 'requests'), where('cityId', '==', cityId), where('categoryId', '==', 'appliances'), where('status', 'in', OPEN)));

    await test('A signed-in stranger without a provider profile cannot list or read requests', async () => {
      await assertFails(getDocs(collection(ctx('stranger_v'), 'requests')));
      await assertFails(cityQuery(ctx('stranger_v'), 'almaty'));
      await assertFails(getDoc(doc(ctx('stranger_v'), 'requests', 'req_v_almaty')));
    });

    await test('Customer can list and read their own requests', async () => {
      await assertSucceeds(getDocs(query(collection(ctx('cust_v'), 'requests'), where('customerId', '==', 'cust_v'))));
      await assertSucceeds(getDoc(doc(ctx('cust_v'), 'requests', 'req_v_almaty')));
    });

    await test('Provider can list and read requests in their own city', async () => {
      await assertSucceeds(cityQuery(ctx('prov_v_almaty'), 'almaty'));
      await assertSucceeds(getDoc(doc(ctx('prov_v_almaty'), 'requests', 'req_v_almaty')));
    });

    await test('Provider cannot list or read requests in another city', async () => {
      await assertFails(cityQuery(ctx('prov_v_astana'), 'almaty'));
      await assertFails(getDoc(doc(ctx('prov_v_astana'), 'requests', 'req_v_almaty')));
    });

    await test('Provider cannot list the whole requests collection', async () => {
      await assertFails(getDocs(collection(ctx('prov_v_almaty'), 'requests')));
    });

    await test('Selected provider from another city can still read the request they work on', async () => {
      await assertSucceeds(getDoc(doc(ctx('prov_v_astana'), 'requests', 'req_v_sel')));
    });

    await test('Once a provider is chosen, other providers of the city lose access to the request', async () => {
      await assertFails(getDoc(doc(ctx('prov_v_almaty'), 'requests', 'req_v_sel')));
      await assertFails(getDocs(query(collection(ctx('prov_v_almaty'), 'requests'), where('cityId', '==', 'almaty'), where('categoryId', '==', 'appliances'))));
    });

    await test('A request without a recognised city is not visible to providers with no city', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await setDoc(doc(db, 'requests', 'req_v_nocity'), { id: 'req_v_nocity', customerId: 'cust_v', city: '?', cityId: '', category: 'x', service: 'x', status: 'MATCHING' });
        await setDoc(doc(db, 'providers', 'prov_v_nocity'), { id: 'prov_v_nocity', userId: 'prov_v_nocity', name: 'X', city: '', cityId: '', category: 'x' });
      });
      await assertFails(getDoc(doc(ctx('prov_v_nocity'), 'requests', 'req_v_nocity')));
    });

    await test('A blocked provider sees no requests', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'providers', 'prov_v_blocked'), { id: 'prov_v_blocked', userId: 'prov_v_blocked', name: 'B', city: 'Алматы', cityId: 'almaty', category: 'appliances', blocked: true });
      });
      await assertFails(getDoc(doc(ctx('prov_v_blocked'), 'requests', 'req_v_almaty')));
      await assertFails(cityQuery(ctx('prov_v_blocked'), 'almaty'));
    });

    await test('A provider cannot unblock or hide/unhide themselves', async () => {
      await assertFails(updateDoc(doc(ctx('prov_v_blocked'), 'providers', 'prov_v_blocked'), { blocked: false }));
      await assertFails(updateDoc(doc(ctx('prov_v_almaty'), 'providers', 'prov_v_almaty'), { hidden: true }));
    });

    await test('Provider profile phone numbers are not readable by anonymous visitors', async () => {
      await assertFails(getDoc(doc(anonymousUser('anon_v').firestore(), 'providers', 'prov_v_almaty')));
      await assertSucceeds(getDoc(doc(ctx('cust_v'), 'providers', 'prov_v_almaty')));
    });

    // =========================================================================
    // SECTION 13: Phone verification — anonymous accounts can browse but not publish
    // =========================================================================
    console.log('\n--- SECTION 13: Phone verification required to publish ---');

    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      await setDoc(doc(adminContext.firestore(), 'requests', 'req_p_open'), {
        id: 'req_p_open', customerId: 'cust_p', city: 'Алматы', cityId: 'almaty', category: 'appliances', categoryId: 'appliances', service: 'x', status: 'MATCHING',
      });
    });

    await test('Anonymous account cannot create a request', async () => {
      await assertFails(setDoc(doc(anonymousUser('anon_p').firestore(), 'requests', 'req_p_anon'), {
        id: 'req_p_anon', customerId: 'anon_p', city: 'Алматы', category: 'appliances', service: 'x', status: 'MATCHING',
      }));
    });

    await test('Phone-verified account can create a request', async () => {
      await assertSucceeds(setDoc(doc(phoneUser('cust_p2').firestore(), 'requests', 'req_p_phone'), {
        id: 'req_p_phone', customerId: 'cust_p2', city: 'Алматы', category: 'appliances', service: 'x', status: 'MATCHING',
      }));
    });

    await test('Anonymous account cannot create a provider profile', async () => {
      await assertFails(setDoc(doc(anonymousUser('anon_p').firestore(), 'providers', 'anon_p'), {
        id: 'anon_p', userId: 'anon_p', name: 'Anon', city: 'Алматы', category: 'appliances',
      }));
    });

    await test('Anonymous account cannot send an offer', async () => {
      await assertFails(setDoc(doc(anonymousUser('anon_p').firestore(), 'offers', 'offer_p_anon'), {
        id: 'offer_p_anon', requestId: 'req_p_open', providerUserId: 'anon_p', providerId: 'anon_p', price: '1 000 ₸', status: 'PENDING',
      }));
    });

    // =========================================================================
    // SECTION 14: Job completion — the provider reports the job finished, only the
    // customer closes it (COMPLETED)
    // =========================================================================
    console.log('\n--- SECTION 14: Job completion needs the customer ---');

    const seedJob = async (id: string, status: string) => {
      await testEnv.withSecurityRulesDisabled(async (adminContext) => {
        const db = adminContext.firestore();
        await setDoc(doc(db, 'offers', `offer_${id}`), {
          id: `offer_${id}`, requestId: id, providerId: 'prov_job', providerUserId: 'prov_job', status: 'ACCEPTED',
        });
        await setDoc(doc(db, 'requests', id), {
          id, customerId: 'cust_job', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x', status, selectedOfferId: `offer_${id}`,
        });
      });
    };

    await seedJob('req_job_1', 'IN_PROGRESS');
    await test('Selected provider cannot mark the request COMPLETED', async () => {
      await assertFails(updateDoc(doc(phoneUser('prov_job').firestore(), 'requests', 'req_job_1'), { status: 'COMPLETED' }));
    });
    await test('Selected provider can report the job finished (providerDoneAt)', async () => {
      await assertSucceeds(updateDoc(doc(phoneUser('prov_job').firestore(), 'requests', 'req_job_1'), { providerDoneAt: '2026-10-12T10:00:00Z' }));
    });
    await test('Another provider cannot report the job finished', async () => {
      await assertFails(updateDoc(doc(phoneUser('prov_other').firestore(), 'requests', 'req_job_1'), { providerDoneAt: '2026-10-12T10:00:00Z' }));
    });
    await test('Customer cannot set providerDoneAt', async () => {
      await assertFails(updateDoc(doc(phoneUser('cust_job').firestore(), 'requests', 'req_job_1'), { providerDoneAt: '2026-10-12T10:00:00Z' }));
    });
    await test('Customer confirms completion', async () => {
      await assertSucceeds(updateDoc(doc(phoneUser('cust_job').firestore(), 'requests', 'req_job_1'), { status: 'COMPLETED' }));
    });

    await seedJob('req_job_2', 'PROVIDER_SELECTED');
    await test('Selected provider can start the job (IN_PROGRESS)', async () => {
      await assertSucceeds(updateDoc(doc(phoneUser('prov_job').firestore(), 'requests', 'req_job_2'), { status: 'IN_PROGRESS' }));
    });
    await test('Customer can cancel a job in progress', async () => {
      await assertSucceeds(updateDoc(doc(phoneUser('cust_job').firestore(), 'requests', 'req_job_2'), { status: 'CANCELLED' }));
    });

    await seedJob('req_job_3', 'PROVIDER_SELECTED');
    await test('Customer can confirm completion straight from PROVIDER_SELECTED', async () => {
      await assertSucceeds(updateDoc(doc(phoneUser('cust_job').firestore(), 'requests', 'req_job_3'), { status: 'COMPLETED' }));
    });

    // =========================================================================
    // SECTION 15: Account deletion — users remove their own records only
    // =========================================================================
    console.log('\n--- SECTION 15: Account deletion ---');

    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const db = adminContext.firestore();
      await setDoc(doc(db, 'users', 'del_user'), { id: 'del_user', createdAt: '2026-10-12T00:00:00Z' });
      await setDoc(doc(db, 'providers', 'del_user'), { id: 'del_user', userId: 'del_user', name: 'X', city: 'Алматы', category: 'x' });
      await setDoc(doc(db, 'requests', 'req_del'), { id: 'req_del', customerId: 'del_user', city: 'Алматы', category: 'x', service: 'x', status: 'OPEN' });
      await setDoc(doc(db, 'requestContacts', 'req_del'), { customerId: 'del_user', customerPhone: '+77010000000' });
      await setDoc(doc(db, 'users', 'other_user'), { id: 'other_user', createdAt: '2026-10-12T00:00:00Z' });
    });

    await test("Another user cannot delete someone's user record", async () => {
      await assertFails(deleteDoc(doc(phoneUser('intruder').firestore(), 'users', 'del_user')));
    });
    await test("Another user cannot delete someone's provider profile", async () => {
      await assertFails(deleteDoc(doc(phoneUser('intruder').firestore(), 'providers', 'del_user')));
    });
    await test("Another user cannot delete someone's contact details", async () => {
      await assertFails(deleteDoc(doc(phoneUser('intruder').firestore(), 'requestContacts', 'req_del')));
    });
    await test('Owner deletes their contact details', async () => {
      await assertSucceeds(deleteDoc(doc(phoneUser('del_user').firestore(), 'requestContacts', 'req_del')));
    });
    await test('Owner deletes their provider profile', async () => {
      await assertSucceeds(deleteDoc(doc(phoneUser('del_user').firestore(), 'providers', 'del_user')));
    });
    await test('Owner deletes their user record', async () => {
      await assertSucceeds(deleteDoc(doc(phoneUser('del_user').firestore(), 'users', 'del_user')));
    });
    await test('Requests themselves still cannot be deleted', async () => {
      await assertFails(deleteDoc(doc(phoneUser('del_user').firestore(), 'requests', 'req_del')));
    });

    // =========================================================================
    // SECTION 16: Audit fixes — sizes, field lists, chat access, contacts after cancel
    // =========================================================================
    console.log('\n--- SECTION 16: Audit fixes ---');

    await testEnv.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      const now = new Date().toISOString();
      await setDoc(doc(db, 'requests', 'req_a'), {
        id: 'req_a', customerId: 'cust_a', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x',
        status: 'PROVIDER_SELECTED', selectedOfferId: 'OFFER-req_a-prov_a', createdAt: now,
      });
      await setDoc(doc(db, 'offers', 'OFFER-req_a-prov_a'), {
        id: 'OFFER-req_a-prov_a', requestId: 'req_a', providerId: 'prov_a', providerUserId: 'prov_a', providerName: 'A', price: '1', status: 'ACCEPTED',
      });
      await setDoc(doc(db, 'requestContacts', 'req_a'), { requestId: 'req_a', customerId: 'cust_a', customerPhone: '+77010000001' });
      await setDoc(doc(db, 'conversations', 'conv_req_a_existing'), {
        id: 'conv_req_a_existing', requestId: 'req_a', customerId: 'cust_a', providerId: 'prov_a', providerUserId: 'prov_a', status: 'ACTIVE',
      });
    });
    const custA = () => phoneUser('cust_a').firestore();
    const provA = () => phoneUser('prov_a').firestore();
    const convBase = {
      id: 'conv_req_a', requestId: 'req_a', customerId: 'cust_a', providerUserId: 'prov_a', status: 'ACTIVE',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };

    await test('Conversation cannot be created with a third person as providerId', async () => {
      await assertFails(setDoc(doc(custA(), 'conversations', 'conv_req_a'), { ...convBase, providerId: 'accomplice' }));
      await assertFails(setDoc(doc(provA(), 'conversations', 'conv_req_a'), { ...convBase, providerId: 'accomplice' }));
    });

    await test('Conversation is created with the selected provider', async () => {
      await assertSucceeds(setDoc(doc(custA(), 'conversations', 'conv_req_a'), { ...convBase, providerId: 'prov_a' }));
    });

    await test('Participants cannot change conversation status or add junk fields', async () => {
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { status: 'ARCHIVED' }));
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { junk: 'x'.repeat(1000) }));
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { lastMessageText: 'x'.repeat(301) }));
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { lastMessageSenderId: 'prov_a', lastMessageText: 'Клиент: согласен на 50 000' }));
    });

    await test('Messages accept only the known fields', async () => {
      await assertFails(setDoc(doc(custA(), 'conversations', 'conv_req_a', 'messages', 'm1'), {
        id: 'm1', conversationId: 'conv_req_a', requestId: 'req_a', senderId: 'cust_a', senderRole: 'customer', type: 'text', text: 'x', createdAt: new Date().toISOString(), extra: 'x',
      }));
      await assertSucceeds(setDoc(doc(custA(), 'conversations', 'conv_req_a', 'messages', 'm2'), {
        id: 'm2', conversationId: 'conv_req_a', requestId: 'req_a', senderId: 'cust_a', senderRole: 'customer', type: 'text', text: 'Сәлем', isRead: false, readAt: null, createdAt: new Date().toISOString(),
      }));
    });

    await test('Appointment is created as a proposal only (no self-confirmed or completed work)', async () => {
      const base = {
        id: 'appointment_req_a', requestId: 'req_a', customerId: 'cust_a', providerId: 'prov_a', providerUserId: 'prov_a',
        proposedBy: 'customer', scheduledAt: '2026-10-20 10:00', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await assertFails(setDoc(doc(custA(), 'appointments', 'appointment_req_a'), { ...base, status: 'CONFIRMED' }));
      await assertFails(setDoc(doc(custA(), 'appointments', 'appointment_req_a'), { ...base, status: 'PROPOSED', workStatus: 'WORK_COMPLETED' }));
      await assertSucceeds(setDoc(doc(custA(), 'appointments', 'appointment_req_a'), { ...base, status: 'PROPOSED' }));
    });

    await test('Selected provider reads the customer contacts while the job is active', async () => {
      await assertSucceeds(getDoc(doc(provA(), 'requestContacts', 'req_a')));
    });

    await test('After cancellation the provider can no longer read contacts or change the appointment', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await updateDoc(doc(c.firestore(), 'requests', 'req_a'), { status: 'CANCELLED' });
      });
      await assertFails(getDoc(doc(provA(), 'requestContacts', 'req_a')));
      await assertFails(updateDoc(doc(provA(), 'appointments', 'appointment_req_a'), { note: 'hi', updatedAt: new Date().toISOString() }));
    });

    await test('Request location must be numbers; understanding and fields are bounded', async () => {
      const base = { id: 'req_b', customerId: 'cust_a', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x', status: 'MATCHING' };
      await assertFails(setDoc(doc(custA(), 'requests', 'req_b'), { ...base, location: { latitude: 'x', longitude: 'x' } }));
      await assertFails(setDoc(doc(custA(), 'requests', 'req_b'), { ...base, understanding: { description: 'x'.repeat(5001) } }));
      await assertFails(setDoc(doc(custA(), 'requests', 'req_b'), { ...base, rating: 5 }));
      await assertSucceeds(setDoc(doc(custA(), 'requests', 'req_b'), { ...base, location: { latitude: 43.24, longitude: 76.95, approximate: true } }));
    });

    await test('Reviews accept only the known fields with bounded sizes', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await setDoc(doc(db, 'requests', 'req_r'), {
          id: 'req_r', customerId: 'cust_a', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x', status: 'COMPLETED', selectedOfferId: 'OFFER-req_r-prov_a',
        });
        await setDoc(doc(db, 'offers', 'OFFER-req_r-prov_a'), {
          id: 'OFFER-req_r-prov_a', requestId: 'req_r', providerId: 'prov_a', providerUserId: 'prov_a', providerName: 'A', price: '1', status: 'ACCEPTED',
        });
      });
      const review = { id: 'req_r', requestId: 'req_r', customerId: 'cust_a', providerId: 'prov_a', rating: 5, createdAt: new Date().toISOString() };
      await assertFails(setDoc(doc(custA(), 'reviews', 'req_r'), { ...review, comment: 'x'.repeat(1001) }));
      await assertFails(setDoc(doc(custA(), 'reviews', 'req_r'), { ...review, providerName: 'x'.repeat(101) }));
      await assertFails(setDoc(doc(custA(), 'reviews', 'req_r'), { ...review, verifiedPurchase: true }));
      await assertSucceeds(setDoc(doc(custA(), 'reviews', 'req_r'), { ...review, comment: 'Жақсы' }));
    });

    // ---------------- 17. Reports ----------------
    await test('Reports: a verified user files one report per target; only operators can read them', async () => {
      const db = phoneUser('rep_a').firestore();
      const id = 'REPORT-rep_a-provider-prov_x';
      const base = { id, reporterId: 'rep_a', targetType: 'provider', targetId: 'prov_x', reason: 'fraud', createdAt: new Date().toISOString() };
      // Anonymous accounts cannot report
      await assertFails(setDoc(doc(anonymousUser('rep_a').firestore(), 'reports', id), base));
      // Id must be bound to reporter and target, reporter must be the caller, reason from the list
      await assertFails(setDoc(doc(db, 'reports', 'REPORT-rep_a-provider-other'), base));
      await assertFails(setDoc(doc(db, 'reports', id), { ...base, reporterId: 'someone' }));
      await assertFails(setDoc(doc(db, 'reports', id), { ...base, reason: 'whatever' }));
      await assertFails(setDoc(doc(db, 'reports', id), { ...base, details: 'x'.repeat(1001) }));
      await assertFails(setDoc(doc(db, 'reports', id), { ...base, status: 'RESOLVED' }));
      // Checking for an existing report before writing is allowed
      await assertSucceeds(getDoc(doc(db, 'reports', id)));
      await assertSucceeds(setDoc(doc(db, 'reports', id), { ...base, details: 'Алдады' }));
      // Write-once
      await assertFails(setDoc(doc(db, 'reports', id), { ...base, reason: 'spam' }));
      await assertFails(deleteDoc(doc(db, 'reports', id)));
      // Others cannot read it or list reports; an operator can
      await assertFails(getDoc(doc(phoneUser('prov_x').firestore(), 'reports', id)));
      await assertFails(getDocs(collection(phoneUser('rep_a').firestore(), 'reports')));
      const admin = testEnv.authenticatedContext('op_1', { admin: true, phone_number: '+77000000001' }).firestore();
      await assertSucceeds(getDocs(collection(admin, 'reports')));
    });

    // ---------------- 18. Account deletion clean-up ----------------
    await test('Account deletion: customer strips personal data from own request in any status; others cannot', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await setDoc(doc(db, 'requests', 'req_del'), {
          id: 'req_del', customerId: 'cust_d', customerName: 'Айгүл', requestText: 'Кран ағады', description: 'd', city: 'Алматы', cityId: 'almaty',
          category: 'x', service: 'x', status: 'COMPLETED', selectedOfferId: 'OFFER-req_del-prov_d', attachments: [], location: { latitude: 43, longitude: 76 },
        });
        await setDoc(doc(db, 'offers', 'OFFER-req_del-prov_d'), {
          id: 'OFFER-req_del-prov_d', requestId: 'req_del', providerId: 'prov_d', providerUserId: 'prov_d', providerName: 'D', price: '1',
          providerPhone: '+77011112233', providerWhatsapp: '+77011112233', status: 'ACCEPTED',
        });
      });
      const strip = { customerName: deleteField(), requestText: deleteField(), description: deleteField(), attachments: deleteField(), location: deleteField(), updatedAt: new Date().toISOString() };
      await assertFails(updateDoc(doc(phoneUser('prov_d').firestore(), 'requests', 'req_del'), strip));
      // Not a way to rewrite the request: values may only be removed, and status stays
      await assertFails(updateDoc(doc(phoneUser('cust_d').firestore(), 'requests', 'req_del'), { requestText: 'new text' }));
      await assertFails(updateDoc(doc(phoneUser('cust_d').firestore(), 'requests', 'req_del'), { ...strip, status: 'OPEN' }));
      await assertSucceeds(updateDoc(doc(phoneUser('cust_d').firestore(), 'requests', 'req_del'), strip));

      // Provider removes phone numbers from their own accepted offer, nothing else
      await assertFails(updateDoc(doc(phoneUser('cust_d').firestore(), 'offers', 'OFFER-req_del-prov_d'), { providerPhone: deleteField() }));
      await assertFails(updateDoc(doc(phoneUser('prov_d').firestore(), 'offers', 'OFFER-req_del-prov_d'), { providerPhone: '+77000000000' }));
      await assertFails(updateDoc(doc(phoneUser('prov_d').firestore(), 'offers', 'OFFER-req_del-prov_d'), { providerPhone: deleteField(), price: '999' }));
      await assertSucceeds(updateDoc(doc(phoneUser('prov_d').firestore(), 'offers', 'OFFER-req_del-prov_d'), { providerPhone: deleteField(), providerWhatsapp: deleteField() }));
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
