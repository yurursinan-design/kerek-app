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
  increment,
  Timestamp,
  type DocumentReference,
  type SetOptions,
} from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { firebaseRepository } from '../src/services/firebaseRepository';
import { ensureFirebaseAuth, auth } from '../src/services/firebase';
import { setCurrentUserId } from '../src/services/localRepository';
import { scheduleValueAt } from '../src/services/dateFormat';
import { usageDayKey } from '../src/services/dailyUsage';

/** A valid visit time some hours from now, as the app stores it ("2026-10-18T10:00+05:00") */
const visitIn = (hours: number) => scheduleValueAt(Date.now() + hours * 3600 * 1000);

const PROJECT_ID = 'kerek-emulator-security-test';
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

let testEnv: RulesTestEnvironment;

/** Who each signed-in test Firestore belongs to (filled in by the authenticatedContext wrapper) */
const uidOf = new WeakMap<object, string>();
const COUNTED: Record<string, string> = { requests: 'requests', messages: 'messages', reports: 'reports' };

/**
 * setDoc as the app writes it: a new request, message or report by a signed-in user goes together
 * with today's usage count (firestore.rules, countedToday). Other writes, and writes with the rules
 * switched off, are plain setDoc.
 */
function countedSet(ref: DocumentReference, data: any, options?: SetOptions): Promise<void> {
  const uid = uidOf.get(ref.firestore);
  const field = COUNTED[ref.parent.id];
  if (!uid || !field || options) return options ? setDoc(ref, data, options) : setDoc(ref, data);
  const b = writeBatch(ref.firestore);
  b.set(ref, data);
  b.set(doc(ref.firestore, 'usage', `${uid}_${usageDayKey()}`), { uid, [field]: increment(1), expireAt: Timestamp.fromMillis(Date.now() + 86400000) }, { merge: true });
  return b.commit();
}

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

  // Every signed-in context remembers its user, so countedSet can count writes like the app does
  const plainContext = testEnv.authenticatedContext.bind(testEnv);
  (testEnv as any).authenticatedContext = (uid: string, claims?: any) => {
    const ctx = plainContext(uid, claims);
    const plainFirestore = ctx.firestore.bind(ctx);
    (ctx as any).firestore = (...args: any[]) => {
      const f = (plainFirestore as any)(...args);
      uidOf.set(f, uid);
      // doc() works on the modular Firestore inside the compat one the test library returns
      if (f?._delegate) uidOf.set(f._delegate, uid);
      return f;
    };
    return ctx;
  };

  // Publishing (requests, offers, provider profiles) requires a phone-verified account, so test users
  // carry a phone_number claim unless a test deliberately uses anonymousUser().
  const phoneUser = (uid: string) => testEnv.authenticatedContext(uid, { phone_number: '+77000000000' });
  const anonymousUser = (uid: string) => testEnv.authenticatedContext(uid);

  // An offer is written together with the request's offer count, as the app does (the rules require both)
  const sendOffer = async (db: any, offerId: string, data: Record<string, unknown>) => {
    const requestId = String(data.requestId || '');
    if (!requestId) return countedSet(doc(db, 'offers', offerId), data);
    let count = 0;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'requests', requestId));
      count = (snap.exists() && (snap.data().offerCount as number)) || 0;
    });
    const batch = writeBatch(db);
    batch.set(doc(db, 'offers', offerId), data);
    batch.update(doc(db, 'requests', requestId), {
      status: 'OFFERS_RECEIVED', lastOfferId: offerId, offerCount: count + 1, updatedAt: new Date().toISOString(),
    });
    return batch.commit();
  };

  // Operators: the admin claim counts only while the phone is on the current operator list, which the
  // server keeps in config/adminPhones (functions/src/admin.ts)
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await countedSet(doc(ctx.firestore(), 'config', 'adminPhones'), { e164: ['+77000000001', '+77000000007', '+77000000008', '+77000000009'] });
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
        countedSet(doc(unauthDb, 'requests', 'req_unauth'), {
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
      await assertFails(countedSet(doc(unauthDb, 'admin_secrets', 'secret_1'), { secret: '123' }));
    });

    // =========================================================================
    // SECTION 2: User Profiles (/users/{userId})
    // =========================================================================
    console.log('\n--- SECTION 2: User Profiles (/users/{userId}) ---');

    await test('Authenticated user can create and read their own profile', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      await assertSucceeds(
        countedSet(doc(aliceDb, 'users', 'user_alice'), {
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
        countedSet(doc(bobDb, 'users', 'user_alice'), {
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
        countedSet(doc(masterDb, 'providers', 'prov_master1'), {
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
        countedSet(doc(attackerDb, 'providers', 'prov_master2'), {
          id: 'prov_master2',
          userId: 'user_attacker',
          name: 'Fake Master',
          city: 'almaty',
          category: 'appliance_repair',
        })
      );
      await assertFails(
        countedSet(doc(attackerDb, 'providers', 'user_attacker'), {
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
        countedSet(doc(aliceDb, 'requests', 'req_alice_01'), {
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
        countedSet(doc(bobDb, 'requests', 'req_bob_spoof'), {
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
      await countedSet(doc(adminDb, 'providers', 'prov_master2'), {
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
        sendOffer(masterDb, 'offer_m1_ghost', {
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
      await countedSet(doc(adminDb, 'requests', 'req_closed_01'), {
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
        sendOffer(masterDb, 'offer_m1_closed', {
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
        sendOffer(bobDb, 'offer_fake_01', {
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
        sendOffer(masterDb, 'OFFER-req_alice_01-prov_master1', validOffer('OFFER-req_alice_01-prov_master1', 'prov_master1', 'Master Ruslan'))
      );
    });

    await test('An offer can carry payment methods and the 14-day free-fix pledge', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const adminDb = ctx.firestore();
        await countedSet(doc(adminDb, 'requests', 'req_extras'), {
          id: 'req_extras', customerId: 'user_alice', city: 'almaty', cityId: 'almaty',
          category: 'appliances', service: 'Fridge repair', status: 'OPEN',
        });
        for (const uid of ['prov_extras', 'prov_extras2']) {
          await countedSet(doc(adminDb, 'providers', uid), {
            id: uid, userId: uid, name: 'Master ' + uid, city: 'almaty', cityId: 'almaty', category: 'appliance_repair',
          });
        }
      });
      const offer = (uid: string, extra: Record<string, unknown>) => ({
        ...validOffer('OFFER-req_extras-' + uid, uid, 'Master ' + uid, extra),
        requestId: 'req_extras',
      });
      const db = phoneUser('prov_extras').firestore();
      await assertSucceeds(
        sendOffer(db, 'OFFER-req_extras-prov_extras', offer('prov_extras', { paymentMethods: ['cash', 'kaspi'], fixPledge: true }))
      );
    });

    await test('Offer extras are checked: only cash/kaspi, at least one, and the pledge is a plain yes/no', async () => {
      const db = phoneUser('prov_extras2').firestore();
      const offer = (extra: Record<string, unknown>) => ({
        ...validOffer('OFFER-req_extras-prov_extras2', 'prov_extras2', 'Master prov_extras2', extra),
        requestId: 'req_extras',
      });
      await assertFails(sendOffer(db, 'OFFER-req_extras-prov_extras2', offer({ paymentMethods: ['crypto'] })));
      await assertFails(sendOffer(db, 'OFFER-req_extras-prov_extras2', offer({ paymentMethods: [] })));
      await assertFails(sendOffer(db, 'OFFER-req_extras-prov_extras2', offer({ paymentMethods: ['cash', 'kaspi', 'cash'] })));
      await assertFails(sendOffer(db, 'OFFER-req_extras-prov_extras2', offer({ fixPledge: 'yes' })));
    });

    await test('A provider can change payment methods on their own PENDING offer, only to known ones', async () => {
      const db = phoneUser('prov_extras').firestore();
      const ref = doc(db, 'offers', 'OFFER-req_extras-prov_extras');
      await assertSucceeds(updateDoc(ref, { paymentMethods: ['cash'], fixPledge: false, updatedAt: new Date().toISOString() }));
      await assertFails(updateDoc(ref, { paymentMethods: ['card'], updatedAt: new Date().toISOString() }));
    });

    await test('A provider has one offer per request: any other offer id is rejected', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
      await assertFails(sendOffer(masterDb, 'offer_m1_second', validOffer('offer_m1_second', 'prov_master1', 'Master Ruslan')));
    });

    await test('A user without a provider profile cannot send an offer', async () => {
      const bobDb = phoneUser('user_bob').firestore();
      await assertFails(sendOffer(bobDb, 'OFFER-req_alice_01-user_bob', validOffer('OFFER-req_alice_01-user_bob', 'user_bob', 'Bob')));
    });

    await test('A provider from another city cannot send an offer', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await countedSet(doc(ctx.firestore(), 'providers', 'prov_astana'), {
          id: 'prov_astana', userId: 'prov_astana', name: 'Astana Master', city: 'astana', cityId: 'astana', category: 'appliance_repair',
        });
      });
      const astanaDb = phoneUser('prov_astana').firestore();
      await assertFails(sendOffer(astanaDb, 'OFFER-req_alice_01-prov_astana', validOffer('OFFER-req_alice_01-prov_astana', 'prov_astana', 'Astana Master')));
    });

    await test('Customer cannot send an offer on their own request', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await countedSet(doc(ctx.firestore(), 'providers', 'user_alice'), {
          id: 'user_alice', userId: 'user_alice', name: 'Alice Pro', city: 'almaty', cityId: 'almaty', category: 'appliance_repair',
        });
      });
      const aliceDb = phoneUser('user_alice').firestore();
      await assertFails(sendOffer(aliceDb, 'OFFER-req_alice_01-user_alice', validOffer('OFFER-req_alice_01-user_alice', 'user_alice', 'Alice Pro')));
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore(), 'providers', 'user_alice'));
      });
    });

    await test('Offer cannot carry demo flags, ratings or a name other than the provider profile', async () => {
      const master2Db = phoneUser('prov_master2').firestore();
      const id = 'OFFER-req_alice_01-prov_master2';
      await assertFails(sendOffer(master2Db, id, validOffer(id, 'prov_master2', 'Master Sergey', { isDemo: true })));
      await assertFails(sendOffer(master2Db, id, validOffer(id, 'prov_master2', 'Master Sergey', { rating: 5, reviewsCount: 99 })));
      await assertFails(sendOffer(master2Db, id, validOffer(id, 'prov_master2', 'KEREK Support')));
    });

    // Later scenarios use a fixed offer id for the first provider
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      await countedSet(doc(adminContext.firestore(), 'offers', 'offer_m1_01'), validOffer('offer_m1_01', 'prov_master1', 'Master Ruslan'));
    });

    // Seed a second offer by prov_master2 for cross-offer exploit testing
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await countedSet(doc(adminDb, 'offers', 'offer_m2_01'), {
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

    await test('A provider cannot move the request or its offer count without sending a new offer', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
      await assertFails(
        updateDoc(doc(masterDb, 'requests', 'req_alice_01'), {
          status: 'OFFERS_RECEIVED',
          lastOfferId: 'offer_m1_01',
          updatedAt: new Date().toISOString(),
        })
      );
      // Their offer already exists, so the count can't be bumped again with it
      await assertFails(
        updateDoc(doc(masterDb, 'requests', 'req_alice_01'), {
          status: 'OFFERS_RECEIVED',
          lastOfferId: 'OFFER-req_alice_01-prov_master1',
          offerCount: 2,
          updatedAt: new Date().toISOString(),
        })
      );
    });

    // ---- Offer limit (5 per request), request expiry, inspection fee
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      const base = { customerId: 'user_alice', city: 'almaty', cityId: 'almaty', category: 'appliances', service: 'Repair', status: 'OPEN' };
      await countedSet(doc(adminDb, 'requests', 'req_full'), { id: 'req_full', ...base, status: 'OFFERS_RECEIVED', offerCount: 5 });
      await countedSet(doc(adminDb, 'requests', 'req_four'), { id: 'req_four', ...base, status: 'OFFERS_RECEIVED', offerCount: 4 });
      await countedSet(doc(adminDb, 'requests', 'req_expired'), { id: 'req_expired', ...base, expiresAtMs: Date.now() - 60000 });
      await countedSet(doc(adminDb, 'requests', 'req_fresh'), { id: 'req_fresh', ...base, expiresAtMs: Date.now() + 86400000 });
      await countedSet(doc(adminDb, 'providers', 'prov_lim'), {
        id: 'prov_lim', userId: 'prov_lim', name: 'Master Lim', city: 'almaty', cityId: 'almaty', category: 'appliance_repair',
      });
    });
    const limOffer = (requestId: string, extra: Record<string, unknown> = {}) => ({
      ...validOffer(`OFFER-${requestId}-prov_lim`, 'prov_lim', 'Master Lim', extra),
      requestId,
    });

    await test('An offer must be counted on the request: a plain offer write is rejected', async () => {
      const db = phoneUser('prov_lim').firestore();
      await assertFails(countedSet(doc(db, 'offers', 'OFFER-req_four-prov_lim'), limOffer('req_four')));
    });

    await test('The counter goes up by exactly one with the offer', async () => {
      const db = phoneUser('prov_lim').firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, 'offers', 'OFFER-req_four-prov_lim'), limOffer('req_four'));
      batch.update(doc(db, 'requests', 'req_four'), {
        status: 'OFFERS_RECEIVED', lastOfferId: 'OFFER-req_four-prov_lim', offerCount: 6, updatedAt: new Date().toISOString(),
      });
      await assertFails(batch.commit());
    });

    await test('The fifth offer is accepted; a request with 5 offers takes no more', async () => {
      const db = phoneUser('prov_lim').firestore();
      await assertSucceeds(sendOffer(db, 'OFFER-req_four-prov_lim', limOffer('req_four')));
      await assertFails(sendOffer(db, 'OFFER-req_full-prov_lim', limOffer('req_full')));
    });

    await test('An expired request takes no offers; an open one does', async () => {
      const db = phoneUser('prov_lim').firestore();
      await assertFails(sendOffer(db, 'OFFER-req_expired-prov_lim', limOffer('req_expired')));
      await assertSucceeds(sendOffer(db, 'OFFER-req_fresh-prov_lim', limOffer('req_fresh', { priceType: 'inspection', inspectionFee: '2 000 ₸' })));
    });

    await test('Sending an offer cannot plant junk in the customer request (updatedAt stays a short text)', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await countedSet(doc(ctx.firestore(), 'requests', 'req_junk'), {
          id: 'req_junk', customerId: 'user_alice', city: 'almaty', cityId: 'almaty', category: 'appliances', service: 'Repair', status: 'OPEN',
        });
      });
      const db = phoneUser('prov_lim').firestore();
      const withUpdatedAt = (updatedAt: unknown) => {
        const batch = writeBatch(db);
        batch.set(doc(db, 'offers', 'OFFER-req_junk-prov_lim'), limOffer('req_junk'));
        batch.update(doc(db, 'requests', 'req_junk'), {
          status: 'OFFERS_RECEIVED', lastOfferId: 'OFFER-req_junk-prov_lim', offerCount: 1, updatedAt,
        });
        return batch.commit();
      };
      await assertFails(withUpdatedAt({ planted: 'x'.repeat(200) }));
      await assertFails(withUpdatedAt('x'.repeat(5000)));
      await assertSucceeds(withUpdatedAt(new Date().toISOString()));
    });

    await test('Inspection fee is short text, editable while the offer is pending', async () => {
      const db = phoneUser('prov_lim').firestore();
      const ref = doc(db, 'offers', 'OFFER-req_fresh-prov_lim');
      await assertSucceeds(updateDoc(ref, { inspectionFee: 'Бесплатно', updatedAt: new Date().toISOString() }));
      await assertFails(updateDoc(ref, { inspectionFee: 'x'.repeat(51), updatedAt: new Date().toISOString() }));
    });

    await test('Customer sets the request end within 4 days, extends it later, and never sets the offer count', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      const req = (id: string, extra: Record<string, unknown>) => ({
        id, customerId: 'user_alice', city: 'almaty', cityId: 'almaty', category: 'appliances', service: 'Repair', status: 'OPEN', ...extra,
      });
      await assertSucceeds(countedSet(doc(aliceDb, 'requests', 'req_exp_ok'), req('req_exp_ok', { expiresAtMs: Date.now() + 3 * 86400000 })));
      await assertFails(countedSet(doc(aliceDb, 'requests', 'req_exp_long'), req('req_exp_long', { expiresAtMs: Date.now() + 10 * 86400000 })));
      await assertFails(countedSet(doc(aliceDb, 'requests', 'req_exp_past'), req('req_exp_past', { expiresAtMs: Date.now() - 1000 })));
      await assertFails(countedSet(doc(aliceDb, 'requests', 'req_exp_str'), req('req_exp_str', { expiresAtMs: 'tomorrow' })));
      await assertFails(countedSet(doc(aliceDb, 'requests', 'req_cnt'), req('req_cnt', { offerCount: 0 })));
      const ref = doc(aliceDb, 'requests', 'req_expired');
      await assertSucceeds(updateDoc(ref, { expiresAtMs: Date.now() + 3 * 86400000, updatedAt: new Date().toISOString() }));
      await assertFails(updateDoc(ref, { expiresAtMs: Date.now() + 10 * 86400000, updatedAt: new Date().toISOString() }));
      await assertFails(updateDoc(ref, { offerCount: 0, updatedAt: new Date().toISOString() }));
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

    await test('Provider cannot change the name on an offer after sending it (no impersonation)', async () => {
      const masterDb = phoneUser('prov_master1').firestore();
      await assertFails(
        updateDoc(doc(masterDb, 'offers', 'offer_m1_01'), {
          providerName: 'Tapsyr қолдау қызметі',
          updatedAt: new Date().toISOString(),
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
      await countedSet(doc(adminDb, 'requests', 'req_concurrent_01'), {
        id: 'req_concurrent_01',
        customerId: 'user_alice',
        city: 'almaty',
        category: 'appliances',
        service: 'Repair',
        status: 'OPEN',
      });
      await countedSet(doc(adminDb, 'offers', 'offer_conc_A'), {
        id: 'offer_conc_A',
        requestId: 'req_concurrent_01',
        providerId: 'prov_master1',
        providerUserId: 'prov_master1',
        price: '10 000 ₸',
        status: 'PENDING',
      });
      await countedSet(doc(adminDb, 'offers', 'offer_conc_B'), {
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
        countedSet(doc(aliceDb, 'requestContacts', 'req_alice_01'), {
          requestId: 'req_alice_01',
          customerId: 'user_alice',
          customerPhone: '+7 701 555 1234',
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
      await countedSet(doc(adminDb, 'requests', 'req_pending_contact'), {
        id: 'req_pending_contact',
        customerId: 'user_alice',
        status: 'OFFERS_RECEIVED',
        selectedOfferId: 'offer_pending_contact',
      });
      await countedSet(doc(adminDb, 'offers', 'offer_pending_contact'), {
        id: 'offer_pending_contact',
        requestId: 'req_pending_contact',
        providerUserId: 'prov_master2',
        price: 7000,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
      await countedSet(doc(adminDb, 'requestContacts', 'req_pending_contact'), {
        customerId: 'user_alice',
        phone: '+7 701 555 2222',
      });

      // Scenario 4: Request with a REJECTED offer
      await countedSet(doc(adminDb, 'requests', 'req_rejected_contact'), {
        id: 'req_rejected_contact',
        customerId: 'user_alice',
        status: 'OPEN',
        selectedOfferId: 'offer_rejected_contact',
      });
      await countedSet(doc(adminDb, 'offers', 'offer_rejected_contact'), {
        id: 'offer_rejected_contact',
        requestId: 'req_rejected_contact',
        providerUserId: 'prov_master2',
        price: 8000,
        status: 'REJECTED',
        createdAt: new Date().toISOString(),
      });
      await countedSet(doc(adminDb, 'requestContacts', 'req_rejected_contact'), {
        customerId: 'user_alice',
        phone: '+7 701 555 3333',
      });

      // Scenario 6: Request with missing selectedOfferId
      await countedSet(doc(adminDb, 'requests', 'req_no_selection'), {
        id: 'req_no_selection',
        customerId: 'user_alice',
        status: 'OPEN',
      });
      await countedSet(doc(adminDb, 'requestContacts', 'req_no_selection'), {
        customerId: 'user_alice',
        phone: '+7 701 555 4444',
      });

      // Scenario 6: Request with invalid selectedOfferId (non-existent offer)
      await countedSet(doc(adminDb, 'requests', 'req_invalid_selection'), {
        id: 'req_invalid_selection',
        customerId: 'user_alice',
        status: 'PROVIDER_SELECTED',
        selectedOfferId: 'offer_nonexistent_xyz',
      });
      await countedSet(doc(adminDb, 'requestContacts', 'req_invalid_selection'), {
        customerId: 'user_alice',
        phone: '+7 701 555 5555',
      });

      // Scenario 6: Request where selectedOfferId belongs to a DIFFERENT request
      await countedSet(doc(adminDb, 'requests', 'req_mismatched_offer'), {
        id: 'req_mismatched_offer',
        customerId: 'user_alice',
        status: 'PROVIDER_SELECTED',
        selectedOfferId: 'offer_m1_01', // offer_m1_01 has requestId == 'req_alice_01'
      });
      await countedSet(doc(adminDb, 'requestContacts', 'req_mismatched_offer'), {
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
      if (provSnap.data()?.customerPhone !== '+7 701 555 1234') {
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
        countedSet(doc(aliceDb, 'conversations', convId), {
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
        countedSet(doc(aliceDb, `conversations/${convId}/messages`, 'msg_001'), {
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
        countedSet(doc(bobDb, `conversations/${convId}/messages`, 'msg_attacker'), {
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
        countedSet(doc(aliceDb, 'appointments', apptId), {
          id: apptId,
          requestId: 'req_alice_01',
          customerId: 'user_alice',
          providerId: 'prov_master1',
          providerUserId: 'prov_master1',
          proposedBy: 'customer',
          scheduledAt: visitIn(24),
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
        countedSet(doc(aliceDb, 'reviewSubmissions', 'req_alice_01'), {
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

    await test('Reviews are read by phone-verified accounts only, not anonymous visitors', async () => {
      await assertFails(getDocs(query(collection(anonymousUser('anon_review_reader').firestore(), 'reviews'), where('providerId', '==', 'prov_master1'))));
      await assertSucceeds(getDocs(query(collection(phoneUser('phone_review_reader').firestore(), 'reviews'), where('providerId', '==', 'prov_master1'))));
    });

    await test('Customer cannot publish a review directly: it goes through the review check', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      await assertFails(
        countedSet(doc(aliceDb, 'reviews', 'req_alice_01'), {
          id: 'req_alice_01', requestId: 'req_alice_01', customerId: 'user_alice', providerId: 'prov_master1',
          rating: 5, comment: 'Great job!', createdAt: new Date().toISOString(),
        })
      );
    });

    await test('Customer can submit review for COMPLETED request with accepted provider', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      await assertSucceeds(
        countedSet(doc(aliceDb, 'reviewSubmissions', 'req_alice_01'), {
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

    await test('The customer sees their own submission; other users and anonymous visitors cannot; only operators list them', async () => {
      await assertSucceeds(getDoc(doc(phoneUser('user_alice').firestore(), 'reviewSubmissions', 'req_alice_01')));
      await assertFails(getDoc(doc(phoneUser('prov_master1').firestore(), 'reviewSubmissions', 'req_alice_01')));
      await assertFails(getDoc(doc(anonymousUser('anon_sub_reader').firestore(), 'reviewSubmissions', 'req_alice_01')));
      await assertFails(getDocs(collection(phoneUser('user_alice').firestore(), 'reviewSubmissions')));
      const operator = testEnv.authenticatedContext('op_reviews', { phone_number: '+77000000008', admin: true }).firestore();
      await assertSucceeds(getDocs(collection(operator, 'reviewSubmissions')));
      await assertSucceeds(getDoc(doc(operator, 'reviewSubmissions', 'req_alice_01')));
    });

    await test('A submission cannot be changed or withdrawn by the customer (the check decides)', async () => {
      const aliceDb = phoneUser('user_alice').firestore();
      await assertFails(updateDoc(doc(aliceDb, 'reviewSubmissions', 'req_alice_01'), { rating: 1 }));
      await assertFails(updateDoc(doc(aliceDb, 'reviewSubmissions', 'req_alice_01'), { status: 'published' }));
      await assertFails(deleteDoc(doc(aliceDb, 'reviewSubmissions', 'req_alice_01')));
    });

    // The review check publishes the review (the server writes with full access)
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      await countedSet(doc(adminContext.firestore(), 'reviews', 'req_alice_01'), {
        id: 'req_alice_01', requestId: 'req_alice_01', customerId: 'user_alice', customerName: 'Alice',
        providerId: 'prov_master1', providerName: 'Master Ruslan', rating: 5, comment: 'Great job!', createdAt: new Date().toISOString(),
      });
    });

    // Isolated Genuine Self-Review Test on Fresh Unreviewed Request (Fixes false-positive)
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      // Create a fresh completed request without an existing review document
      await countedSet(doc(adminDb, 'requests', 'req_self_audit_01'), {
        id: 'req_self_audit_01',
        customerId: 'user_charlie',
        city: 'almaty',
        category: 'appliances',
        service: 'Repair',
        status: 'COMPLETED',
        selectedOfferId: 'offer_charlie_m1',
      });
      await countedSet(doc(adminDb, 'offers', 'offer_charlie_m1'), {
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
        countedSet(doc(masterDb, 'reviewSubmissions', 'req_self_audit_01'), {
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
        countedSet(doc(charlieDb, 'reviewSubmissions', 'req_self_audit_01'), {
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

    await test('A published review cannot be submitted again', async () => {
      await testEnv.withSecurityRulesDisabled(async (adminContext) => {
        const db = adminContext.firestore();
        await countedSet(doc(db, 'requests', 'req_published_01'), {
          id: 'req_published_01', customerId: 'user_dana', city: 'almaty', category: 'appliances', service: 'Repair',
          status: 'COMPLETED', selectedOfferId: 'offer_dana_m1',
        });
        await countedSet(doc(db, 'offers', 'offer_dana_m1'), {
          id: 'offer_dana_m1', requestId: 'req_published_01', providerId: 'prov_master1', providerUserId: 'prov_master1', price: '9 000 ₸', status: 'ACCEPTED',
        });
        await countedSet(doc(db, 'reviews', 'req_published_01'), {
          id: 'req_published_01', requestId: 'req_published_01', customerId: 'user_dana', providerId: 'prov_master1', rating: 4, createdAt: new Date().toISOString(),
        });
      });
      await assertFails(
        countedSet(doc(phoneUser('user_dana').firestore(), 'reviewSubmissions', 'req_published_01'), {
          id: 'req_published_01', requestId: 'req_published_01', customerId: 'user_dana', providerId: 'prov_master1',
          rating: 5, createdAt: new Date().toISOString(),
        })
      );
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
      await countedSet(doc(db, 'requests', 'req_n'), {
        id: 'req_n', customerId: 'user_alice', city: 'almaty', cityId: 'almaty', category: 'appliances',
        service: 'Repair', status: 'PROVIDER_SELECTED', selectedOfferId: 'OFFER-req_n-prov_master1', createdAt: now,
      });
      const offer = (uid: string, status: string) => ({
        id: `OFFER-req_n-${uid}`, requestId: 'req_n', providerId: uid, providerUserId: uid, providerName: uid,
        price: '1000', status, createdAt: now,
      });
      await countedSet(doc(db, 'offers', 'OFFER-req_n-prov_master1'), offer('prov_master1', 'ACCEPTED'));
      await countedSet(doc(db, 'offers', 'OFFER-req_n-prov_master2'), offer('prov_master2', 'PENDING'));
      await countedSet(doc(db, 'offers', 'OFFER-req_n-prov_rej'), offer('prov_rej', 'REJECTED'));
      await countedSet(doc(db, 'conversations', 'conv_req_n'), {
        id: 'conv_req_n', requestId: 'req_n', customerId: 'user_alice', providerId: 'prov_master1',
        providerUserId: 'prov_master1', status: 'ACTIVE', createdAt: now, updatedAt: now,
      });
      await countedSet(doc(db, 'conversations', 'conv_req_n', 'messages', 'msg_p1'), {
        id: 'msg_p1', conversationId: 'conv_req_n', requestId: 'req_n', senderId: 'prov_master1', senderRole: 'provider', type: 'text', text: 'Hi', createdAt: now,
      });
      await countedSet(doc(db, 'conversations', 'conv_req_n', 'messages', 'msg_c1'), {
        id: 'msg_c1', conversationId: 'conv_req_n', requestId: 'req_n', senderId: 'user_alice', senderRole: 'customer', type: 'text', text: 'Hello', createdAt: now,
      });
      await countedSet(doc(db, 'requests', 'req_nc'), {
        id: 'req_nc', customerId: 'user_alice', city: 'almaty', cityId: 'almaty', category: 'appliances',
        service: 'Repair', status: 'CANCELLED', selectedOfferId: 'OFFER-req_nc-prov_master1', createdAt: now,
      });
      await countedSet(doc(db, 'offers', 'OFFER-req_nc-prov_master1'), {
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
    const put = (db: any, id: string, extra: Record<string, unknown>) => countedSet(doc(db, 'notifications', id), notif(id, extra));

    await test('Nobody in the app can create a notification (the server makes them from real events)', async () => {
      await assertFails(put(aliceN(), 'notif_offer_accepted_cust_OFFER-req_n-prov_master1',
        { ...toCustomer, type: 'CUSTOMER_OFFER_ACCEPTED', offerId: 'OFFER-req_n-prov_master1' }));
      await assertFails(put(aliceN(), 'notif_offer_accepted_prov_OFFER-req_n-prov_master1',
        { ...toMaster1, type: 'PROVIDER_OFFER_ACCEPTED', offerId: 'OFFER-req_n-prov_master1' }));
      await assertFails(put(m2N(), 'notif_offer_OFFER-req_n-prov_master2',
        { ...toCustomer, type: 'CUSTOMER_NEW_OFFER', offerId: 'OFFER-req_n-prov_master2', targetScreen: 'offers_list' }));
      await assertFails(put(m1N(), 'notif_msg_msg_p1',
        { ...toCustomer, type: 'CUSTOMER_NEW_MESSAGE', conversationId: 'conv_req_n', targetScreen: 'chat' }));
      await assertFails(put(m1N(), 'notif_workstatus_appointment_req_n_provider_on_the_way_1',
        { ...toCustomer, type: 'CUSTOMER_PROVIDER_ON_THE_WAY' }));
      await assertFails(put(rejN(), 'notif_appt_create_appointment_req_n_1',
        { ...toCustomer, type: 'CUSTOMER_APPOINTMENT_CREATED', offerId: 'OFFER-req_n-prov_rej' }));
    });

    await test('The recipient marks their notification read; others cannot touch it', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'notifications', 'notif_done_cust_req_n'), notif('notif_done_cust_req_n', { ...toCustomer, type: 'CUSTOMER_WORK_COMPLETED' }));
      });
      await assertFails(updateDoc(doc(m1N(), 'notifications', 'notif_done_cust_req_n'), { isRead: true }));
      await assertFails(updateDoc(doc(aliceN(), 'notifications', 'notif_done_cust_req_n'), { title: { kz: 'x', ru: 'x' } }));
      await assertSucceeds(updateDoc(doc(aliceN(), 'notifications', 'notif_done_cust_req_n'), { isRead: true, readAt: new Date().toISOString() }));
    });

    await test('A phone is registered for push messages only under its own user; tokens are not readable', async () => {
      const token = 'fcm_token_' + 'a'.repeat(40);
      const reg = { platform: 'android', lang: 'kz', updatedAt: new Date().toISOString() };
      await assertFails(countedSet(doc(aliceN(), 'pushTokens', token), { ...reg, uid: 'prov_master1' }));
      await assertSucceeds(countedSet(doc(aliceN(), 'pushTokens', token), { ...reg, uid: 'user_alice' }));
      await assertFails(getDoc(doc(aliceN(), 'pushTokens', token)));
      await assertFails(countedSet(doc(aliceN(), 'pushTokens', token), { ...reg, uid: 'user_alice', extra: 'x' }));
      // The same phone signed in by someone else is taken over; only the owner removes it
      await assertSucceeds(countedSet(doc(m1N(), 'pushTokens', token), { ...reg, uid: 'prov_master1' }));
      await assertFails(deleteDoc(doc(aliceN(), 'pushTokens', token)));
      await assertSucceeds(deleteDoc(doc(m1N(), 'pushTokens', token)));
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
      await countedSet(doc(adminDb, 'requests', 'req_h_open'), {
        id: 'req_h_open',
        customerId: 'user_alice',
        city: 'almaty',
        cityId: 'almaty',
        category: 'appliances',
        service: 'Repair',
        status: 'OPEN',
      });
      await countedSet(doc(adminDb, 'providers', 'prov_trusted'), {
        id: 'prov_trusted',
        userId: 'prov_trusted',
        name: 'Trusted Master',
        city: 'almaty',
        cityId: 'almaty',
        category: 'appliances',
      });
      await countedSet(doc(adminDb, 'providers', 'mallory'), {
        id: 'mallory',
        userId: 'mallory',
        name: 'Mallory',
        city: 'almaty',
        cityId: 'almaty',
        category: 'appliances',
      });
      await countedSet(doc(adminDb, 'offers', 'offer_h_mallory'), {
        id: 'offer_h_mallory',
        requestId: 'req_h_open',
        providerId: 'mallory',
        providerUserId: 'mallory',
        price: '10 000 ₸',
        status: 'PENDING',
      });
      await countedSet(doc(adminDb, 'conversations', 'conv_req_h_sel'), {
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
        sendOffer(malloryDb(), 'offer_h_imp', baseOffer('offer_h_imp', { providerId: 'prov_trusted', providerName: 'Trusted Master' }))
      );
    });

    await test('Provider can create an offer under their own provider profile', async () => {
      await assertSucceeds(
        sendOffer(malloryDb(), 'OFFER-req_h_open-mallory', baseOffer('OFFER-req_h_open-mallory', { providerId: 'mallory', iinVerified: false, hasCertificate: false }))
      );
    });

    await test('Provider cannot create an offer with a pre-set paymentStatus', async () => {
      await assertFails(
        sendOffer(malloryDb(), 'offer_h_pay', baseOffer('offer_h_pay', { providerId: 'mallory', paymentStatus: 'held_in_escrow' }))
      );
    });

    await test('Provider cannot create an offer carrying self-assigned trust badges', async () => {
      await assertFails(
        sendOffer(malloryDb(), 'offer_h_badge', baseOffer('offer_h_badge', { providerId: 'mallory', iinVerified: true }))
      );
      await assertFails(
        sendOffer(malloryDb(), 'offer_h_badge2', baseOffer('offer_h_badge2', { providerId: 'mallory', hasCertificate: true }))
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
        sendOffer(malloryDb(), 'offer_h_long', baseOffer('offer_h_long', { providerId: 'mallory', message: 'x'.repeat(2001) }))
      );
    });

    await test('Provider cannot create a profile with self-assigned verified / IIN / certificate badges', async () => {
      const eveDb = phoneUser('eve').firestore();
      const base = { id: 'eve', userId: 'eve', name: 'Eve', city: 'almaty', cityId: 'almaty', category: 'appliances' };
      await assertFails(countedSet(doc(eveDb, 'providers', 'eve'), { ...base, iinVerified: true }));
      await assertFails(countedSet(doc(eveDb, 'providers', 'eve'), { ...base, verified: true }));
      await assertFails(countedSet(doc(eveDb, 'providers', 'eve'), { ...base, hasCertificate: true }));
      await assertSucceeds(countedSet(doc(eveDb, 'providers', 'eve'), { ...base, verified: false, iinVerified: false, hasCertificate: false }));
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
      await assertSucceeds(countedSet(doc(aliceDb(), 'requests', 'req_h_ok'), baseRequest('req_h_ok', { requestText: 'Тоңазытқыш суытпайды' })));
    });

    await test('Customer cannot create a request with pre-set payment or selection state', async () => {
      await assertFails(countedSet(doc(aliceDb(), 'requests', 'req_h_pay'), baseRequest('req_h_pay', { paymentStatus: 'held_in_escrow' })));
      await assertFails(countedSet(doc(aliceDb(), 'requests', 'req_h_esc'), baseRequest('req_h_esc', { escrowAmount: 15000 })));
      await assertFails(countedSet(doc(aliceDb(), 'requests', 'req_h_sel2'), baseRequest('req_h_sel2', { selectedOfferId: 'offer_h_mallory' })));
    });

    await test('Request text longer than 5000 characters is rejected', async () => {
      await assertFails(countedSet(doc(aliceDb(), 'requests', 'req_h_long'), baseRequest('req_h_long', { requestText: 'x'.repeat(5001) })));
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
      await countedSet(doc(adminDb, 'requests', 'req_v_almaty'), {
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
      await countedSet(doc(adminDb, 'providers', 'prov_v_almaty'), {
        id: 'prov_v_almaty', userId: 'prov_v_almaty', name: 'Almaty Master', city: 'Алматы', cityId: 'almaty', category: 'appliances', categoryId: 'appliances',
      });
      await countedSet(doc(adminDb, 'providers', 'prov_v_astana'), {
        id: 'prov_v_astana', userId: 'prov_v_astana', name: 'Astana Master', city: 'Астана', cityId: 'astana', category: 'appliances', categoryId: 'appliances',
      });
      // A request in Almaty whose selected provider is based in Astana
      await countedSet(doc(adminDb, 'offers', 'offer_v_sel'), {
        id: 'offer_v_sel', requestId: 'req_v_sel', providerId: 'prov_v_astana', providerUserId: 'prov_v_astana', price: '1', status: 'ACCEPTED',
      });
      await countedSet(doc(adminDb, 'requests', 'req_v_sel'), {
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
        await countedSet(doc(db, 'requests', 'req_v_nocity'), { id: 'req_v_nocity', customerId: 'cust_v', city: '?', cityId: '', category: 'x', service: 'x', status: 'MATCHING' });
        await countedSet(doc(db, 'providers', 'prov_v_nocity'), { id: 'prov_v_nocity', userId: 'prov_v_nocity', name: 'X', city: '', cityId: '', category: 'x' });
      });
      await assertFails(getDoc(doc(ctx('prov_v_nocity'), 'requests', 'req_v_nocity')));
    });

    await test('A blocked provider sees no requests', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'providers', 'prov_v_blocked'), { id: 'prov_v_blocked', userId: 'prov_v_blocked', name: 'B', city: 'Алматы', cityId: 'almaty', category: 'appliances', blocked: true });
      });
      await assertFails(getDoc(doc(ctx('prov_v_blocked'), 'requests', 'req_v_almaty')));
      await assertFails(cityQuery(ctx('prov_v_blocked'), 'almaty'));
    });

    await test('A provider cannot unblock or hide/unhide themselves', async () => {
      await assertFails(updateDoc(doc(ctx('prov_v_blocked'), 'providers', 'prov_v_blocked'), { blocked: false }));
      await assertFails(updateDoc(doc(ctx('prov_v_almaty'), 'providers', 'prov_v_almaty'), { hidden: true }));
    });

    await test('Counted numbers (master stats, typical prices) are read-only for the app', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'providerStats', 'prov_v_almaty'), { completedJobs: 3, offersSent: 5 });
        await countedSet(doc(c.firestore(), 'priceStats', 'almaty_tap_repair'), { prices: [5000, 7000, 9000], count: 3 });
      });
      await assertSucceeds(getDoc(doc(ctx('user_alice'), 'providerStats', 'prov_v_almaty')));
      await assertFails(getDoc(doc(anonymousUser('anon_s').firestore(), 'providerStats', 'prov_v_almaty')));
      await assertFails(updateDoc(doc(ctx('prov_v_almaty'), 'providerStats', 'prov_v_almaty'), { completedJobs: 99 }));
      await assertFails(getDocs(collection(ctx('user_alice'), 'providerStats')));
      await assertSucceeds(getDoc(doc(anonymousUser('anon_s').firestore(), 'priceStats', 'almaty_tap_repair')));
      await assertFails(countedSet(doc(ctx('user_alice'), 'priceStats', 'almaty_tap_repair'), { prices: [1], count: 1 }));
    });

    await test('A provider pauses new orders and lists work photos in the fixed slots only', async () => {
      const ref = doc(ctx('prov_v_almaty'), 'providers', 'prov_v_almaty');
      await assertSucceeds(updateDoc(ref, { paused: true }));
      await assertSucceeds(updateDoc(ref, { paused: false, portfolio: ['p0', 'p3'] }));
      await assertFails(updateDoc(ref, { paused: 'yes' }));
      await assertFails(updateDoc(ref, { portfolio: ['https://example.com/x.jpg'] }));
      await assertFails(updateDoc(ref, { portfolio: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p7'] }));
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
      await countedSet(doc(adminContext.firestore(), 'requests', 'req_p_open'), {
        id: 'req_p_open', customerId: 'cust_p', city: 'Алматы', cityId: 'almaty', category: 'appliances', categoryId: 'appliances', service: 'x', status: 'MATCHING',
      });
    });

    await test('Anonymous account cannot create a request', async () => {
      await assertFails(countedSet(doc(anonymousUser('anon_p').firestore(), 'requests', 'req_p_anon'), {
        id: 'req_p_anon', customerId: 'anon_p', city: 'Алматы', category: 'appliances', service: 'x', status: 'MATCHING',
      }));
    });

    await test('Phone-verified account can create a request', async () => {
      await assertSucceeds(countedSet(doc(phoneUser('cust_p2').firestore(), 'requests', 'req_p_phone'), {
        id: 'req_p_phone', customerId: 'cust_p2', city: 'Алматы', category: 'appliances', service: 'x', status: 'MATCHING',
      }));
    });

    await test('Anonymous account cannot create a provider profile', async () => {
      await assertFails(countedSet(doc(anonymousUser('anon_p').firestore(), 'providers', 'anon_p'), {
        id: 'anon_p', userId: 'anon_p', name: 'Anon', city: 'Алматы', category: 'appliances',
      }));
    });

    await test('Anonymous account cannot send an offer', async () => {
      await assertFails(sendOffer(anonymousUser('anon_p').firestore(), 'offer_p_anon', {
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
        await countedSet(doc(db, 'offers', `offer_${id}`), {
          id: `offer_${id}`, requestId: id, providerId: 'prov_job', providerUserId: 'prov_job', status: 'ACCEPTED',
        });
        await countedSet(doc(db, 'requests', id), {
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
    await test('Selected provider reports the final price with the finished job; the customer cannot set it', async () => {
      const provRef = doc(phoneUser('prov_job').firestore(), 'requests', 'req_job_1');
      await assertSucceeds(updateDoc(provRef, { providerDoneAt: '2026-10-12T11:00:00Z', finalPrice: '12 000 ₸' }));
      await assertFails(updateDoc(provRef, { finalPrice: 'x'.repeat(51) }));
      await assertFails(updateDoc(doc(phoneUser('cust_job').firestore(), 'requests', 'req_job_1'), { finalPrice: '1 ₸' }));
    });
    await test('Selected provider cannot plant junk in the customer request (updatedAt stays a short text)', async () => {
      const provRef = doc(phoneUser('prov_job').firestore(), 'requests', 'req_job_1');
      await assertFails(updateDoc(provRef, { updatedAt: { planted: 'x'.repeat(200) } }));
      await assertFails(updateDoc(provRef, { updatedAt: 'x'.repeat(5000) }));
      await assertSucceeds(updateDoc(provRef, { updatedAt: new Date().toISOString() }));
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
      await countedSet(doc(db, 'users', 'del_user'), { id: 'del_user', createdAt: '2026-10-12T00:00:00Z' });
      await countedSet(doc(db, 'providers', 'del_user'), { id: 'del_user', userId: 'del_user', name: 'X', city: 'Алматы', category: 'x' });
      await countedSet(doc(db, 'requests', 'req_del'), { id: 'req_del', customerId: 'del_user', city: 'Алматы', category: 'x', service: 'x', status: 'OPEN' });
      await countedSet(doc(db, 'requestContacts', 'req_del'), { customerId: 'del_user', customerPhone: '+77010000000' });
      await countedSet(doc(db, 'users', 'other_user'), { id: 'other_user', createdAt: '2026-10-12T00:00:00Z' });
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
      await countedSet(doc(db, 'requests', 'req_a'), {
        id: 'req_a', customerId: 'cust_a', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x',
        status: 'PROVIDER_SELECTED', selectedOfferId: 'OFFER-req_a-prov_a', createdAt: now,
      });
      await countedSet(doc(db, 'offers', 'OFFER-req_a-prov_a'), {
        id: 'OFFER-req_a-prov_a', requestId: 'req_a', providerId: 'prov_a', providerUserId: 'prov_a', providerName: 'A', price: '1', status: 'ACCEPTED',
      });
      await countedSet(doc(db, 'requestContacts', 'req_a'), { requestId: 'req_a', customerId: 'cust_a', customerPhone: '+77010000001' });
      await countedSet(doc(db, 'conversations', 'conv_req_a_existing'), {
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
      await assertFails(countedSet(doc(custA(), 'conversations', 'conv_req_a'), { ...convBase, providerId: 'accomplice' }));
      await assertFails(countedSet(doc(provA(), 'conversations', 'conv_req_a'), { ...convBase, providerId: 'accomplice' }));
    });

    await test('Conversation is created with the selected provider', async () => {
      await assertSucceeds(countedSet(doc(custA(), 'conversations', 'conv_req_a'), { ...convBase, providerId: 'prov_a' }));
    });

    await test('Participants cannot change conversation status or add junk fields', async () => {
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { status: 'ARCHIVED' }));
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { junk: 'x'.repeat(1000) }));
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { lastMessageText: 'x'.repeat(301) }));
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { lastMessageSenderId: 'prov_a', lastMessageText: 'Клиент: согласен на 50 000' }));
    });

    await test('A participant cannot plant junk times in the shared conversation', async () => {
      await assertFails(updateDoc(doc(provA(), 'conversations', 'conv_req_a'), { lastMessageAt: { planted: 'x'.repeat(200) } }));
      await assertFails(updateDoc(doc(provA(), 'conversations', 'conv_req_a'), { updatedAt: 'x'.repeat(5000) }));
      await assertSucceeds(updateDoc(doc(provA(), 'conversations', 'conv_req_a'), { lastMessageAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    });

    await test('Each participant sets only their own read mark', async () => {
      const t = new Date().toISOString();
      await assertSucceeds(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { customerLastReadAt: t, unreadCountCustomer: 0 }));
      await assertSucceeds(updateDoc(doc(provA(), 'conversations', 'conv_req_a'), { providerLastReadAt: t, unreadCountProvider: 0 }));
      const later = new Date(Date.now() + 60000).toISOString();
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { providerLastReadAt: later }));
      await assertFails(updateDoc(doc(provA(), 'conversations', 'conv_req_a'), { customerLastReadAt: later }));
      await assertFails(updateDoc(doc(custA(), 'conversations', 'conv_req_a'), { customerLastReadAt: 'x'.repeat(41) }));
      await assertFails(updateDoc(doc(phoneUser('outsider_x').firestore(), 'conversations', 'conv_req_a'), { customerLastReadAt: later }));
    });

    await test('Messages accept only the known fields', async () => {
      await assertFails(countedSet(doc(custA(), 'conversations', 'conv_req_a', 'messages', 'm1'), {
        id: 'm1', conversationId: 'conv_req_a', requestId: 'req_a', senderId: 'cust_a', senderRole: 'customer', type: 'text', text: 'x', createdAt: new Date().toISOString(), extra: 'x',
      }));
      await assertSucceeds(countedSet(doc(custA(), 'conversations', 'conv_req_a', 'messages', 'm2'), {
        id: 'm2', conversationId: 'conv_req_a', requestId: 'req_a', senderId: 'cust_a', senderRole: 'customer', type: 'text', text: 'Сәлем', isRead: false, readAt: null, createdAt: new Date().toISOString(),
      }));
    });

    await test('Chat attachments must have the expected shape (a malformed one could break the chat screen)', async () => {
      const msg = (id: string, attachments: unknown[]) => ({
        id, conversationId: 'conv_req_a', requestId: 'req_a', senderId: 'cust_a', senderRole: 'customer', type: 'file', text: '',
        attachments, isRead: false, readAt: null, createdAt: new Date().toISOString(),
      });
      const good = {
        id: 'att1', type: 'file', storagePath: 'chat/conv_req_a/m_ok/doc.pdf', downloadUrl: '', fileName: 'doc.pdf',
        mimeType: 'application/pdf', sizeBytes: 1200, createdAt: new Date().toISOString(),
      };
      const ref = (id: string) => doc(custA(), 'conversations', 'conv_req_a', 'messages', id);
      await assertSucceeds(countedSet(ref('m_ok'), msg('m_ok', [good])));
      await assertFails(countedSet(ref('m_bad1'), msg('m_bad1', [{ id: 'bad', type: 'file', fileName: { unexpected: true }, sizeBytes: 1 }])));
      await assertFails(countedSet(ref('m_bad2'), msg('m_bad2', [{ ...good, fileName: { unexpected: true } }])));
      await assertFails(countedSet(ref('m_bad3'), msg('m_bad3', ['just text'])));
      await assertFails(countedSet(ref('m_bad4'), msg('m_bad4', [{ ...good, storagePath: 'chat/conv_other/x/doc.pdf' }])));
      await assertFails(countedSet(ref('m_bad5'), msg('m_bad5', [{ ...good, downloadUrl: 'https://evil.example/x' }])));
      await assertFails(countedSet(ref('m_bad6'), msg('m_bad6', [{ ...good, extra: 'x' }])));
      await assertFails(countedSet(ref('m_bad7'), msg('m_bad7', [good, { ...good, id: 'att2', sizeBytes: 'big' }])));
      await assertFails(countedSet(ref('m_bad8'), msg('m_bad8', [good, good, good, good])));
    });

    await test('Appointment is created as a proposal only (no self-confirmed or completed work)', async () => {
      const base = {
        id: 'appointment_req_a', requestId: 'req_a', customerId: 'cust_a', providerId: 'prov_a', providerUserId: 'prov_a',
        proposedBy: 'customer', scheduledAt: visitIn(72), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await assertFails(countedSet(doc(custA(), 'appointments', 'appointment_req_a'), { ...base, status: 'CONFIRMED' }));
      await assertFails(countedSet(doc(custA(), 'appointments', 'appointment_req_a'), { ...base, status: 'PROPOSED', workStatus: 'WORK_COMPLETED' }));
      await assertSucceeds(countedSet(doc(custA(), 'appointments', 'appointment_req_a'), { ...base, status: 'PROPOSED' }));
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
      await assertFails(countedSet(doc(custA(), 'requests', 'req_b'), { ...base, location: { latitude: 'x', longitude: 'x' } }));
      await assertFails(countedSet(doc(custA(), 'requests', 'req_b'), { ...base, understanding: { description: 'x'.repeat(5001) } }));
      await assertFails(countedSet(doc(custA(), 'requests', 'req_b'), { ...base, rating: 5 }));
      await assertSucceeds(countedSet(doc(custA(), 'requests', 'req_b'), { ...base, location: { latitude: 43.24, longitude: 76.95, approximate: true } }));
    });

    await test('Reviews accept only the known fields with bounded sizes', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await countedSet(doc(db, 'requests', 'req_r'), {
          id: 'req_r', customerId: 'cust_a', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x', status: 'COMPLETED', selectedOfferId: 'OFFER-req_r-prov_a',
        });
        await countedSet(doc(db, 'offers', 'OFFER-req_r-prov_a'), {
          id: 'OFFER-req_r-prov_a', requestId: 'req_r', providerId: 'prov_a', providerUserId: 'prov_a', providerName: 'A', price: '1', status: 'ACCEPTED',
        });
      });
      const review = { id: 'req_r', requestId: 'req_r', customerId: 'cust_a', providerId: 'prov_a', rating: 5, createdAt: new Date().toISOString() };
      await assertFails(countedSet(doc(custA(), 'reviewSubmissions', 'req_r'), { ...review, comment: 'x'.repeat(1001) }));
      await assertFails(countedSet(doc(custA(), 'reviewSubmissions', 'req_r'), { ...review, providerName: 'x'.repeat(101) }));
      await assertFails(countedSet(doc(custA(), 'reviewSubmissions', 'req_r'), { ...review, verifiedPurchase: true }));
      await assertFails(countedSet(doc(custA(), 'reviewSubmissions', 'req_r'), { ...review, comment: 'Жақсы', status: 'published' }));
      await assertSucceeds(countedSet(doc(custA(), 'reviewSubmissions', 'req_r'), { ...review, comment: 'Жақсы' }));
    });

    await test('A blocked account cannot submit a review until the block is lifted', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await countedSet(doc(db, 'requests', 'req_rb'), {
          id: 'req_rb', customerId: 'cust_rb', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x', status: 'COMPLETED', selectedOfferId: 'OFFER-req_rb-prov_a',
        });
        await countedSet(doc(db, 'offers', 'OFFER-req_rb-prov_a'), {
          id: 'OFFER-req_rb-prov_a', requestId: 'req_rb', providerId: 'prov_a', providerUserId: 'prov_a', providerName: 'A', price: '1', status: 'ACCEPTED',
        });
        await countedSet(doc(db, 'bans', 'cust_rb'), { uid: 'cust_rb', reason: 'fraud', createdAt: new Date().toISOString() });
      });
      const sub = { id: 'req_rb', requestId: 'req_rb', customerId: 'cust_rb', providerId: 'prov_a', rating: 5, createdAt: new Date().toISOString() };
      const ref = doc(phoneUser('cust_rb').firestore(), 'reviewSubmissions', 'req_rb');
      await assertFails(countedSet(ref, sub));
      await testEnv.withSecurityRulesDisabled(async (c) => deleteDoc(doc(c.firestore(), 'bans', 'cust_rb')));
      await assertSucceeds(countedSet(ref, sub));
    });

    await test('Account suspicion signals are server-only: no app can read or write them', async () => {
      await assertFails(getDoc(doc(custA(), 'accountSignals', 'cust_a')));
      await assertFails(countedSet(doc(custA(), 'accountSignals', 'cust_a'), { devices: ['x'] }));
      const operator = testEnv.authenticatedContext('op_signals', { phone_number: '+77000000007', admin: true }).firestore();
      await assertFails(getDoc(doc(operator, 'accountSignals', 'cust_a')));
    });

    // ---------------- 17. Reports ----------------
    await test('Reports: a verified user files one report per target; only operators can read them', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'providers', 'prov_x'), { id: 'prov_x', userId: 'prov_x', name: 'X', cityId: 'almaty' });
      });
      const db = phoneUser('rep_a').firestore();
      const id = 'REPORT-rep_a-provider-prov_x';
      const base = { id, reporterId: 'rep_a', targetType: 'provider', targetId: 'prov_x', reason: 'fraud', createdAt: new Date().toISOString() };
      // Anonymous accounts cannot report
      await assertFails(countedSet(doc(anonymousUser('rep_a').firestore(), 'reports', id), base));
      // Id must be bound to reporter and target, reporter must be the caller, reason from the list
      await assertFails(countedSet(doc(db, 'reports', 'REPORT-rep_a-provider-other'), base));
      await assertFails(countedSet(doc(db, 'reports', id), { ...base, reporterId: 'someone' }));
      await assertFails(countedSet(doc(db, 'reports', id), { ...base, reason: 'whatever' }));
      await assertFails(countedSet(doc(db, 'reports', id), { ...base, details: 'x'.repeat(1001) }));
      await assertFails(countedSet(doc(db, 'reports', id), { ...base, status: 'RESOLVED' }));
      // Checking for an existing report before writing is allowed
      await assertSucceeds(getDoc(doc(db, 'reports', id)));
      await assertSucceeds(countedSet(doc(db, 'reports', id), { ...base, details: 'Алдады' }));
      // Write-once
      await assertFails(countedSet(doc(db, 'reports', id), { ...base, reason: 'spam' }));
      await assertFails(deleteDoc(doc(db, 'reports', id)));
      // Others cannot read it or list reports; an operator can
      await assertFails(getDoc(doc(phoneUser('prov_x').firestore(), 'reports', id)));
      await assertFails(getDocs(collection(phoneUser('rep_a').firestore(), 'reports')));
      const admin = testEnv.authenticatedContext('op_1', { admin: true, phone_number: '+77000000001' }).firestore();
      await assertSucceeds(getDocs(collection(admin, 'reports')));
    });

    await test('An operator removed from the list loses admin rights at once, even with an old claim', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'providers', 'prov_rev'), { id: 'prov_rev', userId: 'prov_rev', name: 'Мастер', city: 'Кызылорда' });
      });
      const removed = testEnv.authenticatedContext('op_removed', { admin: true, phone_number: '+77000000555' }).firestore();
      await assertFails(updateDoc(doc(removed, 'providers', 'prov_rev'), { verified: true, updatedAt: new Date().toISOString() }));
      await assertFails(getDocs(collection(removed, 'reports')));
      const noPhone = testEnv.authenticatedContext('op_nophone', { admin: true }).firestore();
      await assertFails(getDocs(collection(noPhone, 'reports')));
      const current = testEnv.authenticatedContext('op_1', { admin: true, phone_number: '+77000000001' }).firestore();
      await assertSucceeds(updateDoc(doc(current, 'providers', 'prov_rev'), { verified: true, updatedAt: new Date().toISOString() }));
      // A listed phone without the claim is not an operator either
      const unclaimed = testEnv.authenticatedContext('op_unclaimed', { phone_number: '+77000000001' }).firestore();
      await assertFails(getDocs(collection(unclaimed, 'reports')));
    });

    // ---------------- 18. Account deletion clean-up ----------------
    await test('Account deletion: customer strips personal data from own request in any status; others cannot', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await countedSet(doc(db, 'requests', 'req_del'), {
          id: 'req_del', customerId: 'cust_d', customerName: 'Айгүл', requestText: 'Кран ағады', description: 'd', city: 'Алматы', cityId: 'almaty',
          category: 'x', service: 'x', status: 'COMPLETED', selectedOfferId: 'OFFER-req_del-prov_d', attachments: [], location: { latitude: 43, longitude: 76 },
        });
        await countedSet(doc(db, 'offers', 'OFFER-req_del-prov_d'), {
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

    // ---------------- 19. Appointment confirmation ----------------
    await test('Appointments: the side that proposed a time cannot confirm it; the other side can', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await countedSet(doc(db, 'requests', 'req_ap'), {
          id: 'req_ap', customerId: 'cust_ap', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x', status: 'PROVIDER_SELECTED', selectedOfferId: 'OFFER-req_ap-prov_ap',
        });
        await countedSet(doc(db, 'offers', 'OFFER-req_ap-prov_ap'), {
          id: 'OFFER-req_ap-prov_ap', requestId: 'req_ap', providerId: 'prov_ap', providerUserId: 'prov_ap', providerName: 'P', price: '1', status: 'ACCEPTED',
        });
        await countedSet(doc(db, 'appointments', 'appointment_req_ap'), {
          id: 'appointment_req_ap', requestId: 'req_ap', customerId: 'cust_ap', providerId: 'prov_ap', providerUserId: 'prov_ap',
          proposedBy: 'customer', scheduledAt: '2026-10-20T10:00:00.000Z', status: 'PROPOSED', workStatus: 'NOT_STARTED',
          createdAt: '2026-10-13T10:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z',
        });
      });
      const confirm = { status: 'CONFIRMED', updatedAt: new Date().toISOString() };
      await assertFails(updateDoc(doc(phoneUser('cust_ap').firestore(), 'appointments', 'appointment_req_ap'), confirm));
      await assertSucceeds(updateDoc(doc(phoneUser('prov_ap').firestore(), 'appointments', 'appointment_req_ap'), confirm));
    });

    // ---------------- 20. Second audit ----------------
    await test('Audit 2: banned user cannot recreate a provider profile', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'bans', 'prov_banned'), { reason: 'fraud' });
      });
      const profile = { id: 'prov_banned', userId: 'prov_banned', name: 'B', phone: '+77011112233', city: 'Алматы', cityId: 'almaty', category: 'x', categoryId: 'plumbing' };
      await assertFails(countedSet(doc(phoneUser('prov_banned').firestore(), 'providers', 'prov_banned'), profile));
      await assertFails(getDoc(doc(phoneUser('prov_banned').firestore(), 'bans', 'prov_banned')));
    });

    await test('Audit 2: request title must be text', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'requests', 'req_svc'), {
          id: 'req_svc', customerId: 'cust_svc', city: 'Алматы', cityId: 'almaty', category: 'Сантехника', service: 'Кран', status: 'OPEN',
        });
      });
      await assertFails(updateDoc(doc(phoneUser('cust_svc').firestore(), 'requests', 'req_svc'), { service: { x: 1 } }));
      await assertSucceeds(updateDoc(doc(phoneUser('cust_svc').firestore(), 'requests', 'req_svc'), { service: 'Кран ағады' }));
    });

    await test('Audit 2: account deletion may replace the title with the category, nothing else', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'requests', 'req_del2'), {
          id: 'req_del2', customerId: 'cust_d2', customerName: 'А', city: 'Алматы', cityId: 'almaty', category: 'Сантехника', service: 'Айгүлдің краны', status: 'CANCELLED',
        });
      });
      const db = phoneUser('cust_d2').firestore();
      await assertFails(updateDoc(doc(db, 'requests', 'req_del2'), { customerName: deleteField(), service: 'Басқа мәтін' }));
      await assertSucceeds(updateDoc(doc(db, 'requests', 'req_del2'), { customerName: deleteField(), service: 'Сантехника' }));
    });

    await test('Audit 2: a confirmed time changes only through a new proposal; a cancelled appointment can be proposed again', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await countedSet(doc(db, 'requests', 'req_ap2'), {
          id: 'req_ap2', customerId: 'cust_ap2', city: 'Алматы', cityId: 'almaty', category: 'x', service: 'x', status: 'PROVIDER_SELECTED', selectedOfferId: 'OFFER-req_ap2-prov_ap2',
        });
        await countedSet(doc(db, 'offers', 'OFFER-req_ap2-prov_ap2'), {
          id: 'OFFER-req_ap2-prov_ap2', requestId: 'req_ap2', providerId: 'prov_ap2', providerUserId: 'prov_ap2', providerName: 'P', price: '1', status: 'ACCEPTED',
        });
        const base = { id: 'appointment_req_ap2', requestId: 'req_ap2', customerId: 'cust_ap2', providerId: 'prov_ap2', providerUserId: 'prov_ap2',
          proposedBy: 'customer', scheduledAt: '2026-10-20T10:00:00.000Z', workStatus: 'NOT_STARTED', createdAt: '2026-10-13T10:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z' };
        await countedSet(doc(db, 'appointments', 'appointment_req_ap2'), { ...base, status: 'CONFIRMED' });
        await countedSet(doc(db, 'appointments', 'appointment_req_ap3'), { ...base, id: 'appointment_req_ap3', status: 'CANCELLED' });
      });
      const cust = phoneUser('cust_ap2').firestore();
      const later = visitIn(96);
      const now = new Date().toISOString();
      await assertFails(updateDoc(doc(cust, 'appointments', 'appointment_req_ap2'), { scheduledAt: later, updatedAt: now }));
      await assertSucceeds(updateDoc(doc(cust, 'appointments', 'appointment_req_ap2'), { scheduledAt: later, status: 'RESCHEDULED', updatedAt: now }));
      await assertSucceeds(updateDoc(doc(cust, 'appointments', 'appointment_req_ap3'), { status: 'PROPOSED', scheduledAt: later, updatedAt: now }));
    });

    // =========================================================================
    // SECTION 20: Operator panel, blocked accounts, review answers, customer ratings
    // =========================================================================
    console.log('\n--- SECTION 20: Operator panel and two-sided reviews ---');

    const adminDb = () => testEnv.authenticatedContext('op_admin', { phone_number: '+77000000009', admin: true }).firestore();
    const nowIso = new Date().toISOString();
    await testEnv.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await countedSet(doc(db, 'providers', 'prov_op'), { id: 'prov_op', userId: 'prov_op', name: 'Op Master', city: 'almaty', cityId: 'almaty', category: 'appliances' });
      await countedSet(doc(db, 'providers', 'prov_cr2'), { id: 'prov_cr2', userId: 'prov_cr2', name: 'Other Master', city: 'almaty', cityId: 'almaty', category: 'appliances' });
      await countedSet(doc(db, 'reports', 'REPORT-cust_r-provider-prov_op'), {
        id: 'REPORT-cust_r-provider-prov_op', reporterId: 'cust_r', targetType: 'provider', targetId: 'prov_op', reason: 'rude', createdAt: nowIso,
      });
      // A finished job of prov_op for cust_cr, with the customer's review of the master
      await countedSet(doc(db, 'requests', 'req_cr'), {
        id: 'req_cr', customerId: 'cust_cr', city: 'almaty', cityId: 'almaty', category: 'x', service: 'x', status: 'COMPLETED', selectedOfferId: 'OFFER-req_cr-prov_op',
      });
      await countedSet(doc(db, 'requests', 'req_cr_open'), {
        id: 'req_cr_open', customerId: 'cust_cr', city: 'almaty', cityId: 'almaty', category: 'x', service: 'x', status: 'IN_PROGRESS', selectedOfferId: 'OFFER-req_cr_open-prov_op',
      });
      await countedSet(doc(db, 'offers', 'OFFER-req_cr-prov_op'), { id: 'OFFER-req_cr-prov_op', requestId: 'req_cr', providerId: 'prov_op', providerUserId: 'prov_op', status: 'ACCEPTED' });
      await countedSet(doc(db, 'offers', 'OFFER-req_cr_open-prov_op'), { id: 'OFFER-req_cr_open-prov_op', requestId: 'req_cr_open', providerId: 'prov_op', providerUserId: 'prov_op', status: 'ACCEPTED' });
      await countedSet(doc(db, 'reviews', 'req_cr'), {
        id: 'req_cr', requestId: 'req_cr', customerId: 'cust_cr', customerName: 'Cust', providerId: 'prov_op', providerName: 'Op Master', rating: 4, createdAt: nowIso,
      });
    });

    await test('Operator lists and resolves reports; others cannot', async () => {
      await assertSucceeds(getDocs(collection(adminDb(), 'reports')));
      await assertFails(getDocs(collection(phoneUser('cust_r').firestore(), 'reports')));
      const ref = (db: any) => doc(db, 'reports', 'REPORT-cust_r-provider-prov_op');
      await assertFails(updateDoc(ref(phoneUser('cust_r').firestore()), { status: 'resolved', resolvedAt: nowIso }));
      await assertFails(updateDoc(ref(adminDb()), { reason: 'spam' }));
      await assertSucceeds(updateDoc(ref(adminDb()), { status: 'resolved', resolution: 'Предупреждён', resolvedAt: nowIso }));
    });

    await test('Operator sets badges, hides and blocks a master, but cannot edit the profile itself', async () => {
      const ref = doc(adminDb(), 'providers', 'prov_op');
      await assertSucceeds(updateDoc(ref, { verified: true, iinVerified: true, updatedAt: nowIso }));
      await assertSucceeds(updateDoc(ref, { hidden: true, blocked: false }));
      await assertFails(updateDoc(ref, { name: 'Renamed' }));
      await assertFails(updateDoc(ref, { verified: 'yes' }));
      await assertSucceeds(updateDoc(ref, { hidden: false }));
      await assertSucceeds(getDocs(collection(adminDb(), 'providers')));
      await assertFails(getDocs(collection(phoneUser('cust_r').firestore(), 'providers')));
    });

    await test('Operator reads requests and master stats for the health numbers', async () => {
      await assertSucceeds(getDocs(collection(adminDb(), 'requests')));
      await assertSucceeds(getDocs(collection(adminDb(), 'providerStats')));
      await assertSucceeds(getDoc(doc(adminDb(), 'offers', 'OFFER-req_cr-prov_op')));
    });

    await test('A blocked account cannot publish requests or offers until the operator lifts the block', async () => {
      const banRef = doc(adminDb(), 'bans', 'cust_ban');
      await assertFails(countedSet(doc(phoneUser('cust_r').firestore(), 'bans', 'cust_ban'), { uid: 'cust_ban', createdAt: nowIso }));
      await assertSucceeds(countedSet(banRef, { uid: 'cust_ban', reason: 'fraud', createdAt: nowIso }));
      const req = { id: 'req_ban', customerId: 'cust_ban', city: 'almaty', cityId: 'almaty', category: 'x', service: 'x', status: 'OPEN' };
      await assertFails(countedSet(doc(phoneUser('cust_ban').firestore(), 'requests', 'req_ban'), req));
      await assertSucceeds(deleteDoc(banRef));
      await assertSucceeds(countedSet(doc(phoneUser('cust_ban').firestore(), 'requests', 'req_ban'), req));
    });

    await test('The reviewed master answers a review; nobody else, and the rating stays', async () => {
      const ref = (uid: string) => doc(phoneUser(uid).firestore(), 'reviews', 'req_cr');
      await assertFails(updateDoc(ref('prov_cr2'), { providerReply: 'Not mine', providerReplyAt: nowIso }));
      await assertFails(updateDoc(ref('prov_op'), { providerReply: 'Спасибо!', providerReplyAt: nowIso, rating: 5 }));
      await assertFails(updateDoc(ref('prov_op'), { providerReply: 'x'.repeat(1001), providerReplyAt: nowIso }));
      await assertSucceeds(updateDoc(ref('prov_op'), { providerReply: 'Спасибо за отзыв!', providerReplyAt: nowIso }));
      await assertFails(deleteDoc(ref('cust_cr')));
    });

    await test('The selected master rates the customer once, after the job is completed', async () => {
      const rating = (requestId: string, extra: Record<string, unknown> = {}) => ({
        id: requestId, requestId, customerId: 'cust_cr', providerId: 'prov_op', rating: 5, comment: 'Вежливый заказчик', createdAt: nowIso, ...extra,
      });
      await assertFails(countedSet(doc(phoneUser('prov_op').firestore(), 'customerReviews', 'req_cr_open'), rating('req_cr_open')));
      await assertFails(countedSet(doc(phoneUser('prov_cr2').firestore(), 'customerReviews', 'req_cr'), rating('req_cr', { providerId: 'prov_cr2' })));
      await assertFails(countedSet(doc(phoneUser('prov_op').firestore(), 'customerReviews', 'req_cr'), rating('req_cr', { rating: 6 })));
      await assertFails(countedSet(doc(phoneUser('prov_op').firestore(), 'customerReviews', 'req_cr'), rating('req_cr', { customerId: 'someone_else' })));
      await assertSucceeds(countedSet(doc(phoneUser('prov_op').firestore(), 'customerReviews', 'req_cr'), rating('req_cr')));
      await assertFails(updateDoc(doc(phoneUser('prov_op').firestore(), 'customerReviews', 'req_cr'), { rating: 1 }));
    });

    await test('Masters and the customer see customer ratings; a stranger without a profile does not', async () => {
      const byCustomer = (uid: string) => getDocs(query(collection(phoneUser(uid).firestore(), 'customerReviews'), where('customerId', '==', 'cust_cr')));
      await assertSucceeds(byCustomer('prov_cr2'));
      await assertSucceeds(byCustomer('cust_cr'));
      await assertFails(byCustomer('cust_r'));
      await assertSucceeds(deleteDoc(doc(adminDb(), 'customerReviews', 'req_cr')));
    });

    // =========================================================================
    // SECTION 21: External audit — suspension, private names, visit/work coupling, visit times
    // =========================================================================
    console.log('\n--- SECTION 21: External audit (S04, S05, B03, B05) ---');

    // A job with a chosen master, an agreed visit and a blocked-account record ready to switch on
    const seedAuditJob = async (id: string, appt: Record<string, unknown> | null, reqExtra: Record<string, unknown> = {}) => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        const offerId = `OFFER-${id}-prov_${id}`;
        await countedSet(doc(db, 'requests', id), {
          id, customerId: `cust_${id}`, city: 'Қызылорда', cityId: 'kyzylorda', category: 'x', service: 'x',
          status: 'IN_PROGRESS', selectedOfferId: offerId, createdAt: '2026-10-16T10:00:00.000Z', ...reqExtra,
        });
        await countedSet(doc(db, 'offers', offerId), {
          id: offerId, requestId: id, providerId: `prov_${id}`, providerUserId: `prov_${id}`, providerName: 'P', price: '1', status: 'ACCEPTED',
        });
        await countedSet(doc(db, 'conversations', `conv_${id}`), {
          id: `conv_${id}`, requestId: id, customerId: `cust_${id}`, providerUserId: `prov_${id}`, providerId: `prov_${id}`, status: 'ACTIVE',
        });
        if (appt) {
          await countedSet(doc(db, 'appointments', `appointment_${id}`), {
            id: `appointment_${id}`, requestId: id, customerId: `cust_${id}`, providerId: `prov_${id}`, providerUserId: `prov_${id}`,
            proposedBy: 'customer', scheduledAt: visitIn(24), createdAt: '2026-10-16T10:00:00.000Z', updatedAt: '2026-10-16T10:00:00.000Z',
            ...appt,
          });
        }
      });
    };
    const ban = (uid: string) =>
      testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'bans', uid), { uid, reason: 'test', createdAt: new Date().toISOString() });
      });

    await test('S04: a blocked master cannot edit a pending offer; before the block they could', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'offers', 'OFFER-req_bo-prov_bo'), {
          id: 'OFFER-req_bo-prov_bo', requestId: 'req_bo', providerId: 'prov_bo', providerUserId: 'prov_bo', providerName: 'P', price: '1000', status: 'PENDING',
        });
      });
      const edit = (price: string) => updateDoc(doc(phoneUser('prov_bo').firestore(), 'offers', 'OFFER-req_bo-prov_bo'), { price, updatedAt: new Date().toISOString() });
      await assertSucceeds(edit('900'));
      await ban('prov_bo');
      await assertFails(edit('800'));
      await assertFails(updateDoc(doc(phoneUser('prov_bo').firestore(), 'offers', 'OFFER-req_bo-prov_bo'), { updatedAt: new Date().toISOString() }));
    });

    await test('S04: a blocked participant sends no messages or previews, but can still mark the chat read', async () => {
      await seedAuditJob('req_bm', null);
      const msg = (id: string) => ({
        id, conversationId: 'conv_req_bm', requestId: 'req_bm', senderId: 'prov_req_bm', senderRole: 'provider', type: 'text', text: 'Сәлем', createdAt: new Date().toISOString(),
      });
      const pdb = () => phoneUser('prov_req_bm').firestore();
      await assertSucceeds(countedSet(doc(pdb(), 'conversations', 'conv_req_bm', 'messages', 'm1'), msg('m1')));
      await ban('prov_req_bm');
      await assertFails(countedSet(doc(pdb(), 'conversations', 'conv_req_bm', 'messages', 'm2'), msg('m2')));
      await assertFails(updateDoc(doc(pdb(), 'conversations', 'conv_req_bm'), { lastMessageText: 'call me', lastMessageSenderId: 'prov_req_bm', updatedAt: new Date().toISOString() }));
      await assertSucceeds(updateDoc(doc(pdb(), 'conversations', 'conv_req_bm'), { providerLastReadAt: new Date().toISOString() }));
    });

    await test('S04: a blocked master cannot change their profile', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        await countedSet(doc(c.firestore(), 'providers', 'prov_bp'), { id: 'prov_bp', userId: 'prov_bp', name: 'B', city: 'Қызылорда', cityId: 'kyzylorda', category: 'x' });
      });
      const rename = (name: string) => updateDoc(doc(phoneUser('prov_bp').firestore(), 'providers', 'prov_bp'), { name });
      await assertSucceeds(rename('B2'));
      await ban('prov_bp');
      await assertFails(rename('Tapsyr support'));
    });

    await test('S04: a hidden or blocked profile is readable only by its master and the operator', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await countedSet(doc(db, 'providers', 'prov_hid'), { id: 'prov_hid', userId: 'prov_hid', name: 'H', phone: '+77010000001', cityId: 'kyzylorda', hidden: true });
        await countedSet(doc(db, 'providers', 'prov_blk'), { id: 'prov_blk', userId: 'prov_blk', name: 'K', phone: '+77010000002', cityId: 'kyzylorda', blocked: true });
        await countedSet(doc(db, 'providers', 'prov_vis'), { id: 'prov_vis', userId: 'prov_vis', name: 'V', phone: '+77010000003', cityId: 'kyzylorda' });
      });
      const other = phoneUser('cust_reader').firestore();
      await assertFails(getDoc(doc(other, 'providers', 'prov_hid')));
      await assertFails(getDoc(doc(other, 'providers', 'prov_blk')));
      await assertSucceeds(getDoc(doc(other, 'providers', 'prov_vis')));
      await assertSucceeds(getDoc(doc(phoneUser('prov_hid').firestore(), 'providers', 'prov_hid')));
      await assertSucceeds(getDoc(doc(adminDb(), 'providers', 'prov_blk')));
    });

    await test('S05: a request cannot carry the customer\'s name; the private contacts can', async () => {
      const base = {
        id: 'req_nm', customerId: 'cust_nm', city: 'Қызылорда', cityId: 'kyzylorda', category: 'Сантехника', service: 'Кран', status: 'OPEN',
        createdAt: new Date().toISOString(),
      };
      const db = phoneUser('cust_nm').firestore();
      await assertFails(countedSet(doc(db, 'requests', 'req_nm'), { ...base, customerName: 'Айгүл Серікова' }));
      await assertSucceeds(countedSet(doc(db, 'requests', 'req_nm'), base));
      await assertFails(updateDoc(doc(db, 'requests', 'req_nm'), { customerName: 'Айгүл', updatedAt: new Date().toISOString() }));
      await assertFails(countedSet(doc(db, 'requestContacts', 'req_nm'), { requestId: 'req_nm', customerId: 'cust_nm', customerName: 'Айгүл', secret: 'x' }));
      await assertSucceeds(countedSet(doc(db, 'requestContacts', 'req_nm'), { requestId: 'req_nm', customerId: 'cust_nm', customerName: 'Айгүл', customerPhone: '+77011234567' }));
    });

    await test('B03: the master cannot mark a visit COMPLETED without the work and the request (audit probe)', async () => {
      await seedAuditJob('req_cp', { status: 'CONFIRMED', workStatus: 'NOT_STARTED' });
      const pdb = phoneUser('prov_req_cp').firestore();
      const now = new Date().toISOString();
      await assertFails(updateDoc(doc(pdb, 'appointments', 'appointment_req_cp'), { status: 'COMPLETED', updatedAt: now }));
      await assertFails(updateDoc(doc(pdb, 'appointments', 'appointment_req_cp'), { status: 'COMPLETED', workStatus: 'WORK_COMPLETED', updatedAt: now }));
    });

    await test('B03: the master completes the visit only with the work report on the request in the same write', async () => {
      await seedAuditJob('req_wd', { status: 'CONFIRMED', workStatus: 'WORK_STARTED' });
      const pdb = phoneUser('prov_req_wd').firestore();
      const now = new Date().toISOString();
      await assertFails(updateDoc(doc(pdb, 'appointments', 'appointment_req_wd'), { status: 'COMPLETED', workStatus: 'WORK_COMPLETED', workStatusUpdatedAt: now, updatedAt: now }));
      const b = writeBatch(pdb);
      b.update(doc(pdb, 'appointments', 'appointment_req_wd'), { status: 'COMPLETED', workStatus: 'WORK_COMPLETED', workStatusUpdatedAt: now, updatedAt: now });
      b.update(doc(pdb, 'requests', 'req_wd'), { providerDoneAt: now, updatedAt: now });
      await assertSucceeds(b.commit());
    });

    await test('B03: the customer completes the visit together with the request', async () => {
      await seedAuditJob('req_cc', { status: 'CONFIRMED', workStatus: 'WORK_STARTED' });
      const cdb = phoneUser('cust_req_cc').firestore();
      const now = new Date().toISOString();
      await assertFails(updateDoc(doc(cdb, 'appointments', 'appointment_req_cc'), { status: 'COMPLETED', workStatus: 'WORK_COMPLETED', workStatusUpdatedAt: now, updatedAt: now }));
      const b = writeBatch(cdb);
      b.update(doc(cdb, 'appointments', 'appointment_req_cc'), { status: 'COMPLETED', workStatus: 'WORK_COMPLETED', workStatusUpdatedAt: now, updatedAt: now });
      b.update(doc(cdb, 'requests', 'req_cc'), { status: 'COMPLETED', updatedAt: now });
      await assertSucceeds(b.commit());
    });

    await test('B03: cancelling a request cancels its agreed visit in the same write', async () => {
      await seedAuditJob('req_cx', { status: 'CONFIRMED', workStatus: 'NOT_STARTED' });
      const cdb = phoneUser('cust_req_cx').firestore();
      const now = new Date().toISOString();
      await assertFails(updateDoc(doc(cdb, 'requests', 'req_cx'), { status: 'CANCELLED', updatedAt: now }));
      const b = writeBatch(cdb);
      b.update(doc(cdb, 'requests', 'req_cx'), { status: 'CANCELLED', updatedAt: now });
      b.update(doc(cdb, 'appointments', 'appointment_req_cx'), { status: 'CANCELLED', updatedAt: now });
      await assertSucceeds(b.commit());
      // Without a visit, cancelling alone is fine
      await seedAuditJob('req_cx2', null);
      await assertSucceeds(updateDoc(doc(phoneUser('cust_req_cx2').firestore(), 'requests', 'req_cx2'), { status: 'CANCELLED', updatedAt: now }));
    });

    await test('B05: a visit time is Kyzylorda time with +05:00, a real date, in the future and within a year', async () => {
      await seedAuditJob('req_tm', null, { status: 'PROVIDER_SELECTED' });
      const cdb = phoneUser('cust_req_tm').firestore();
      const appt = (scheduledAt: string) => ({
        id: 'appointment_req_tm', requestId: 'req_tm', customerId: 'cust_req_tm', providerId: 'prov_req_tm', providerUserId: 'prov_req_tm',
        proposedBy: 'customer', scheduledAt, status: 'PROPOSED', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      const ref = doc(cdb, 'appointments', 'appointment_req_tm');
      const nextYear = new Date().getUTCFullYear() + 1;
      await assertFails(countedSet(ref, appt(visitIn(24).replace('T', ' ').replace('+05:00', ''))));
      await assertFails(countedSet(ref, appt(visitIn(24).replace('+05:00', 'Z'))));
      await assertFails(countedSet(ref, appt('ертең кешке')));
      await assertFails(countedSet(ref, appt(visitIn(-5))));
      await assertFails(countedSet(ref, appt(visitIn(24 * 400))));
      await assertFails(countedSet(ref, appt(`${nextYear}-02-30T10:00+05:00`)));
      await assertFails(countedSet(ref, appt(`${nextYear}-03-10T24:00+05:00`)));
      await assertSucceeds(countedSet(ref, appt(visitIn(24))));
      // Moving it: the new time is checked too
      await assertFails(updateDoc(ref, { scheduledAt: visitIn(-48), status: 'RESCHEDULED', updatedAt: new Date().toISOString() }));
      await assertSucceeds(updateDoc(ref, { scheduledAt: visitIn(48), status: 'RESCHEDULED', updatedAt: new Date().toISOString() }));
    });

    // =========================================================================
    // SECTION 22: Daily limits (S06): requests, messages, reports and chat files are counted
    // =========================================================================
    console.log('\n--- SECTION 22: Daily limits (S06) ---');
    const usageId = (uid: string) => `${uid}_${usageDayKey()}`;
    const seedUsage = (uid: string, counts: Record<string, number>) =>
      testEnv.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'usage', usageId(uid)), { uid, ...counts, expireAt: Timestamp.fromMillis(Date.now() + 86400000) });
      });
    const reqDoc = (id: string, uid: string) => ({
      id, customerId: uid, city: 'Қызылорда', cityId: 'kyzylorda', category: 'Сантехника', service: 'Кран', status: 'OPEN', createdAt: new Date().toISOString(),
    });

    await test('S06: a request written without being counted is refused (direct SDK write, audit probe)', async () => {
      const db = phoneUser('cust_q1').firestore();
      await assertFails(setDoc(doc(db, 'requests', 'req_q1'), reqDoc('req_q1', 'cust_q1')));
      await assertSucceeds(countedSet(doc(db, 'requests', 'req_q1'), reqDoc('req_q1', 'cust_q1')));
    });

    await test('S06: the 11th request of the day is refused', async () => {
      await seedUsage('cust_q2', { requests: 9 });
      const db = phoneUser('cust_q2').firestore();
      await assertSucceeds(countedSet(doc(db, 'requests', 'req_q2a'), reqDoc('req_q2a', 'cust_q2')));
      await assertFails(countedSet(doc(db, 'requests', 'req_q2b'), reqDoc('req_q2b', 'cust_q2')));
    });

    await test('S06: messages are counted; the 301st of the day is refused', async () => {
      await testEnv.withSecurityRulesDisabled(async (c) => {
        const d = c.firestore();
        await setDoc(doc(d, 'requests', 'req_qm'), { id: 'req_qm', customerId: 'cust_qm', cityId: 'kyzylorda', status: 'IN_PROGRESS', selectedOfferId: 'OFFER-req_qm-prov_qm' });
        await setDoc(doc(d, 'conversations', 'conv_req_qm'), { id: 'conv_req_qm', requestId: 'req_qm', customerId: 'cust_qm', providerUserId: 'prov_qm', providerId: 'prov_qm', status: 'ACTIVE' });
      });
      const db = phoneUser('cust_qm').firestore();
      const msg = (id: string) => ({ id, conversationId: 'conv_req_qm', requestId: 'req_qm', senderId: 'cust_qm', senderRole: 'customer', type: 'text', text: 'Сәлем', createdAt: new Date().toISOString() });
      await assertFails(setDoc(doc(db, 'conversations', 'conv_req_qm', 'messages', 'q0'), msg('q0')));
      await assertSucceeds(countedSet(doc(db, 'conversations', 'conv_req_qm', 'messages', 'q1'), msg('q1')));
      await seedUsage('cust_qm', { messages: 300 });
      await assertFails(countedSet(doc(db, 'conversations', 'conv_req_qm', 'messages', 'q2'), msg('q2')));
    });

    await test('S06: reports are counted, need an existing target, and a chat only by its participants', async () => {
      const db = phoneUser('rep_q').firestore();
      const rep = (type: string, target: string) => ({
        id: `REPORT-rep_q-${type}-${target}`, reporterId: 'rep_q', targetType: type, targetId: target, reason: 'spam', createdAt: new Date().toISOString(),
      });
      await assertFails(countedSet(doc(db, 'reports', 'REPORT-rep_q-provider-nobody'), rep('provider', 'nobody')));
      await assertFails(countedSet(doc(db, 'reports', 'REPORT-rep_q-conversation-conv_req_qm'), rep('conversation', 'conv_req_qm')));
      await assertFails(setDoc(doc(db, 'reports', 'REPORT-rep_q-provider-prov_x'), rep('provider', 'prov_x')));
      await assertSucceeds(countedSet(doc(db, 'reports', 'REPORT-rep_q-provider-prov_x'), rep('provider', 'prov_x')));
      const cdb = phoneUser('cust_qm').firestore();
      await assertSucceeds(countedSet(doc(cdb, 'reports', 'REPORT-cust_qm-conversation-conv_req_qm'), {
        ...rep('conversation', 'conv_req_qm'), id: 'REPORT-cust_qm-conversation-conv_req_qm', reporterId: 'cust_qm',
      }));
    });

    await test('S06: counters only go up by one, only for yourself and only for today', async () => {
      const db = phoneUser('cust_qc').firestore();
      const exp = Timestamp.fromMillis(Date.now() + 86400000);
      await assertFails(setDoc(doc(db, 'usage', usageId('cust_qc')), { uid: 'cust_qc', requests: 5, expireAt: exp }));
      await assertFails(setDoc(doc(db, 'usage', usageId('someone')), { uid: 'someone', requests: 1, expireAt: exp }));
      await assertFails(setDoc(doc(db, 'usage', 'cust_qc_20200101'), { uid: 'cust_qc', requests: 1, expireAt: exp }));
      await assertSucceeds(setDoc(doc(db, 'usage', usageId('cust_qc')), { uid: 'cust_qc', requests: increment(1), expireAt: exp }, { merge: true }));
      await assertFails(updateDoc(doc(db, 'usage', usageId('cust_qc')), { requests: 0 }));
    });

    await test('S06: a chat file ticket is counted; the 31st of the day is refused', async () => {
      const db = phoneUser('cust_qf').firestore();
      const ticket = { uid: 'cust_qf', conversationId: 'conv_req_qm', fileName: 'a.jpg', createdAt: new Date().toISOString(), expireAt: Timestamp.fromMillis(Date.now() + 86400000) };
      const counted = (id: string) => {
        const b = writeBatch(db);
        b.set(doc(db, 'chatUploads', id), ticket);
        b.set(doc(db, 'usage', usageId('cust_qf')), { uid: 'cust_qf', files: increment(1), expireAt: ticket.expireAt }, { merge: true });
        return b.commit();
      };
      await assertFails(setDoc(doc(db, 'chatUploads', 'up0'), ticket));
      await assertSucceeds(counted('up1'));
      await seedUsage('cust_qf', { files: 30 });
      await assertFails(counted('up2'));
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
