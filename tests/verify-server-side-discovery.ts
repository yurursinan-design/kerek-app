/**
 * Verification Test Suite: Phase 5.2 Server-Side Provider Discovery
 * Validates:
 * 1. Request cityId = kyzylorda -> Candidate discovery returns Kyzylorda providers only (Almaty/Astana excluded)
 * 2. Kyzylorda request + inactive provider -> Inactive provider excluded from candidates
 * 3. Kyzylorda request + legacy provider (isActive undefined) -> Remains eligible
 * 4. Unknown/unresolved city -> Returns [] without Kyzylorda fallback or global scan
 * 5. Kyzylorda + valid category -> Category/service matching preserved
 * 6. Category/service mismatch -> Existing matchProviders() behavior preserved
 * 7. Scoring regression -> Same provider ordering preserved when given same candidate set
 * 8. Offline LocalRepository candidate discovery -> Filtered candidates returned functionally
 * 9. Online FirebaseRepository candidate discovery -> Candidate discovery uses city filtering
 */

import { localRepository } from '../src/services/localRepository';
import { firebaseRepository } from '../src/services/firebaseRepository';
import { matchProviders } from '../src/services/matchingService';
import { Provider, ServiceRequest } from '../src/types';

async function runServerSideDiscoveryTests() {
  console.log('====================================================');
  console.log('STARTING PHASE 5.2 SERVER-SIDE DISCOVERY VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
      failed++;
    }
  }

  try {
    const kzoReq: ServiceRequest = {
      id: 'REQ_DISCOVERY_1',
      customerId: 'cust_1',
      customerName: 'Aibek',
      requestText: 'Сантехник кран течет',
      city: 'Қызылорда',
      cityId: 'kyzylorda',
      category: 'Бытовые услуги (Сантехник, Электрик)',
      categoryId: 'home_services',
      service: 'Сантехник',
      date: 'Сегодня',
      budget: 'Договорная',
      urgency: 'normal',
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };

    const kzoProvider: Provider = {
      id: 'P_KZO_1',
      userId: 'u_kzo_1',
      name: 'Kyzylorda Plumber',
      phone: '+77010000001',
      whatsapp: '+77010000001',
      city: 'Қызылорда',
      cityId: 'kyzylorda',
      district: 'Центр',
      category: 'Бытовые услуги (Сантехник, Электрик)',
      categoryId: 'home_services',
      services: 'Сантехника, кран',
      priceRange: '5000 ₸',
      workingHours: '09:00 - 20:00',
      description: 'Plumber in Kyzylorda',
      verified: true,
      isActive: true,
    };

    const almatyProvider: Provider = {
      id: 'P_ALMATY_1',
      userId: 'u_almaty_1',
      name: 'Almaty Plumber',
      phone: '+77010000002',
      whatsapp: '+77010000002',
      city: 'Алматы',
      cityId: 'almaty',
      district: 'Центр',
      category: 'Бытовые услуги (Сантехник, Электрик)',
      categoryId: 'home_services',
      services: 'Сантехника',
      priceRange: '6000 ₸',
      workingHours: '09:00 - 20:00',
      description: 'Plumber in Almaty',
      verified: true,
      isActive: true,
    };

    const astanaProvider: Provider = {
      id: 'P_ASTANA_1',
      userId: 'u_astana_1',
      name: 'Astana Electrician',
      phone: '+77010000003',
      whatsapp: '+77010000003',
      city: 'Астана',
      cityId: 'astana',
      district: 'Есиль',
      category: 'Бытовые услуги (Сантехник, Электрик)',
      categoryId: 'home_services',
      services: 'Электрик',
      priceRange: '7000 ₸',
      workingHours: '09:00 - 20:00',
      description: 'Electrician in Astana',
      verified: true,
      isActive: true,
    };

    // -------------------------------------------------------------
    // TEST 1: Request cityId = kyzylorda -> Candidates retrieved belong to Kyzylorda only
    // -------------------------------------------------------------
    const pool = [kzoProvider, almatyProvider, astanaProvider];
    const test1Matched = matchProviders(kzoReq, pool);
    assert(
      test1Matched.length === 1 && test1Matched[0].cityId === 'kyzylorda',
      'TEST 1: Candidate discovery filters by cityId (Almaty and Astana excluded)'
    );

    // -------------------------------------------------------------
    // TEST 2: Kyzylorda request + inactive Kyzylorda provider -> inactive provider excluded
    // -------------------------------------------------------------
    const inactiveKzoProvider: Provider = {
      ...kzoProvider,
      id: 'P_KZO_INACTIVE',
      isActive: false,
    };
    const test2Matched = matchProviders(kzoReq, [inactiveKzoProvider]);
    assert(
      test2Matched.length === 0,
      'TEST 2: Inactive provider (isActive === false) excluded from candidates'
    );

    // -------------------------------------------------------------
    // TEST 3: Kyzylorda request + legacy provider with isActive undefined -> remains eligible
    // -------------------------------------------------------------
    const legacyKzoProvider: Provider = {
      ...kzoProvider,
      id: 'P_KZO_LEGACY',
      isActive: undefined,
    };
    const test3Matched = matchProviders(kzoReq, [legacyKzoProvider]);
    assert(
      test3Matched.length === 1 && test3Matched[0].id === 'P_KZO_LEGACY',
      'TEST 3: Legacy provider with missing isActive remains eligible'
    );

    // -------------------------------------------------------------
    // TEST 4: Unknown/unresolved city -> Returns [] without global scan or Kyzylorda fallback
    // -------------------------------------------------------------
    const unknownCityReq: ServiceRequest = {
      ...kzoReq,
      city: 'Paris',
      cityId: undefined,
    };
    const test4Local = await localRepository.matchProviders(unknownCityReq);
    const test4Firebase = await firebaseRepository.matchProviders(unknownCityReq);
    assert(
      test4Local.length === 0 && test4Firebase.length === 0,
      'TEST 4: Unresolved city returns [] without global scan or Kyzylorda fallback'
    );

    // -------------------------------------------------------------
    // TEST 5: Kyzylorda + valid category -> Category/service matching preserved
    // -------------------------------------------------------------
    const test5Matched = matchProviders(kzoReq, [kzoProvider]);
    assert(
      test5Matched.length === 1 && test5Matched[0].id === 'P_KZO_1',
      'TEST 5: Kyzylorda request with valid category matches correctly'
    );

    // -------------------------------------------------------------
    // TEST 6: Category/service mismatch -> Existing matchProviders() behavior preserved
    // -------------------------------------------------------------
    const cargoReq: ServiceRequest = {
      ...kzoReq,
      category: 'Грузоперевозки и переезд',
      categoryId: 'cargo_moving',
      service: 'Грузоперевозки',
    };
    const test6Matched = matchProviders(cargoReq, [kzoProvider]);
    assert(
      test6Matched.length === 0,
      'TEST 6: Category/service mismatch returns [] (not slice fallback)'
    );

    // -------------------------------------------------------------
    // TEST 7: Scoring regression -> Same provider ordering preserved when given same candidate set
    // -------------------------------------------------------------
    const kzoProvider2: Provider = {
      ...kzoProvider,
      id: 'P_KZO_2',
      name: 'Kyzylorda Master 2',
      services: 'Кран, сантехника, смеситель, канализация',
      workingHours: '24/7 шұғыл',
    };
    const test7Scored = matchProviders({ ...kzoReq, urgency: 'high' }, [kzoProvider, kzoProvider2]);
    assert(
      test7Scored.length === 2 && test7Scored[0].id === 'P_KZO_2',
      'TEST 7: Higher relevance/availability provider scored first'
    );

    // -------------------------------------------------------------
    // TEST 8: Offline LocalRepository -> Candidate discovery functional
    // -------------------------------------------------------------
    const test8Local = await localRepository.getProviders({ cityId: 'kyzylorda' });
    const test8AllKzo = test8Local.every((p) => p.cityId === 'kyzylorda');
    assert(
      test8AllKzo,
      'TEST 8: LocalRepository getProviders({ cityId: "kyzylorda" }) returns Kyzylorda providers only'
    );

    // -------------------------------------------------------------
    // TEST 9: Online FirebaseRepository -> Candidate discovery uses city filter
    // -------------------------------------------------------------
    const test9Firebase = await firebaseRepository.getProviders({ cityId: 'almaty' });
    const test9AllAlmaty = test9Firebase.every((p) => p.cityId === 'almaty');
    assert(
      test9AllAlmaty,
      'TEST 9: FirebaseRepository getProviders({ cityId: "almaty" }) returns Almaty providers only'
    );

  } catch (e: any) {
    console.error('[CRITICAL ERROR] Test suite execution failed:', e);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`SERVER-SIDE DISCOVERY VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runServerSideDiscoveryTests().catch(console.error);
