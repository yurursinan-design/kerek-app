/**
 * Verification Test Suite: Phase 5.1 Matching Correctness Hardening
 * Validates:
 * 1-4. Multilingual Kyzylorda canonicalization ("Kyzylorda", "Қызылордада", "Кызылорда", "Kızılorda") -> "kyzylorda"
 * 5-6. Unknown city ("Paris", "UnknownCity123") MUST NOT default to "kyzylorda" -> returns undefined
 * 7. Known Kyzylorda request + Almaty provider -> Almaty provider MUST NOT appear
 * 8. Known Kyzylorda request + Kyzylorda provider -> Kyzylorda provider appears if category matches
 * 9. No legitimate candidates -> returns [] (MUST NOT return providers.slice(0,3))
 * 10. isActive === false -> provider MUST NOT appear
 * 11. isActive === true -> provider may appear if matching criteria pass
 * 12. Legacy provider with missing isActive -> treated as eligible (backward-compatible)
 * 13. Provider missing valid cityId/categoryId -> MUST NOT appear
 */

import { normalizeCityId } from '../src/services/taxonomy';
import { matchProviders } from '../src/services/matchingService';
import { Provider, ServiceRequest } from '../src/types';

async function runMatchingCorrectnessTests() {
  console.log('====================================================');
  console.log('STARTING PHASE 5.1 MATCHING CORRECTNESS VERIFICATION');
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
    // -------------------------------------------------------------
    // TEST 1: "Kyzylorda plumber" -> cityId kyzylorda
    // -------------------------------------------------------------
    const test1CityId = normalizeCityId('Kyzylorda');
    assert(test1CityId === 'kyzylorda', 'TEST 1: "Kyzylorda" normalizes to "kyzylorda"');

    // -------------------------------------------------------------
    // TEST 2: "Қызылордада сантехник" -> cityId kyzylorda
    // -------------------------------------------------------------
    const test2CityId = normalizeCityId('Қызылордада');
    assert(test2CityId === 'kyzylorda', 'TEST 2: "Қызылордада" normalizes to "kyzylorda"');

    // -------------------------------------------------------------
    // TEST 3: "Кызылорда сантехник" -> cityId kyzylorda
    // -------------------------------------------------------------
    const test3CityId = normalizeCityId('Кызылорда');
    assert(test3CityId === 'kyzylorda', 'TEST 3: "Кызылорда" normalizes to "kyzylorda"');

    // -------------------------------------------------------------
    // TEST 4: "Kızılorda plumber" -> cityId kyzylorda
    // -------------------------------------------------------------
    const test4CityId = normalizeCityId('Kızılorda');
    assert(test4CityId === 'kyzylorda', 'TEST 4: "Kızılorda" normalizes to "kyzylorda"');

    // -------------------------------------------------------------
    // TEST 5: "Paris plumber" -> MUST NOT become kyzylorda
    // -------------------------------------------------------------
    const test5CityId = normalizeCityId('Paris');
    assert(test5CityId === undefined, 'TEST 5: "Paris" does NOT become "kyzylorda" (returns undefined)');

    // -------------------------------------------------------------
    // TEST 6: Unknown city -> MUST NOT silently become kyzylorda
    // -------------------------------------------------------------
    const test6CityId = normalizeCityId('UnknownCity123');
    assert(test6CityId === undefined, 'TEST 6: "UnknownCity123" returns undefined');

    // -------------------------------------------------------------
    // Setup test requests and providers for matching logic tests
    // -------------------------------------------------------------
    const kyzylordaReq: ServiceRequest = {
      id: 'REQ_KZ_01',
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

    const almatyProvider: Provider = {
      id: 'PROV_ALMATY_1',
      userId: 'user_almaty_1',
      name: 'Almaty Master',
      phone: '+77010000001',
      whatsapp: '+77010000001',
      city: 'Алматы',
      cityId: 'almaty',
      district: 'Центр',
      category: 'Бытовые услуги (Сантехник, Электрик)',
      categoryId: 'home_services',
      services: 'Сантехника, ремонт крана',
      priceRange: '5000 ₸',
      workingHours: '09:00 - 20:00',
      description: 'Master in Almaty',
      verified: true,
      isActive: true,
    };

    const kyzylordaProvider: Provider = {
      id: 'PROV_KZO_1',
      userId: 'user_kzo_1',
      name: 'Kyzylorda Plumber',
      phone: '+77010000002',
      whatsapp: '+77010000002',
      city: 'Қызылорда',
      cityId: 'kyzylorda',
      district: 'Центр',
      category: 'Бытовые услуги (Сантехник, Электрик)',
      categoryId: 'home_services',
      services: 'Сантехника, установка смесителя, кран',
      priceRange: '4000 ₸',
      workingHours: '09:00 - 21:00',
      description: 'Plumber in Kyzylorda',
      verified: true,
      isActive: true,
    };

    // -------------------------------------------------------------
    // TEST 7: Known Kyzylorda request + Almaty provider -> MUST NOT appear
    // -------------------------------------------------------------
    const test7Matches = matchProviders(kyzylordaReq, [almatyProvider]);
    assert(
      test7Matches.length === 0,
      'TEST 7: Almaty provider is excluded from Kyzylorda request'
    );

    // -------------------------------------------------------------
    // TEST 8: Known Kyzylorda request + Kyzylorda provider -> appears
    // -------------------------------------------------------------
    const test8Matches = matchProviders(kyzylordaReq, [kyzylordaProvider]);
    assert(
      test8Matches.length === 1 && test8Matches[0].id === 'PROV_KZO_1',
      'TEST 8: Kyzylorda provider appears for Kyzylorda request'
    );

    // -------------------------------------------------------------
    // TEST 9: No legitimate candidates -> result MUST be [] (not slice(0,3))
    // -------------------------------------------------------------
    const astanaHotelProvider: Provider = {
      id: 'PROV_ASTANA_1',
      userId: 'user_astana_1',
      name: 'Astana Hotel',
      phone: '+77010000003',
      whatsapp: '+77010000003',
      city: 'Астана',
      cityId: 'astana',
      district: 'Есиль',
      category: 'Грузоперевозки и переезд',
      categoryId: 'cargo_moving',
      services: 'Переезд',
      priceRange: '10000 ₸',
      workingHours: '24/7',
      description: 'Moving in Astana',
      verified: false,
      isActive: true,
    };
    const test9Matches = matchProviders(kyzylordaReq, [astanaHotelProvider, almatyProvider]);
    assert(
      test9Matches.length === 0,
      'TEST 9: Returns [] when no legitimate city candidates exist (no fallback slice)'
    );

    // -------------------------------------------------------------
    // TEST 10: isActive === false -> provider MUST NOT appear
    // -------------------------------------------------------------
    const inactiveKzoProvider: Provider = {
      ...kyzylordaProvider,
      id: 'PROV_INACTIVE',
      isActive: false,
    };
    const test10Matches = matchProviders(kyzylordaReq, [inactiveKzoProvider]);
    assert(
      test10Matches.length === 0,
      'TEST 10: Inactive provider (isActive === false) is excluded from matching'
    );

    // -------------------------------------------------------------
    // TEST 11: isActive === true -> provider appears
    // -------------------------------------------------------------
    const activeKzoProvider: Provider = {
      ...kyzylordaProvider,
      id: 'PROV_ACTIVE',
      isActive: true,
    };
    const test11Matches = matchProviders(kyzylordaReq, [activeKzoProvider]);
    assert(
      test11Matches.length === 1 && test11Matches[0].id === 'PROV_ACTIVE',
      'TEST 11: Active provider (isActive === true) is included in matching'
    );

    // -------------------------------------------------------------
    // TEST 12: Legacy provider with missing isActive -> treated as eligible
    // -------------------------------------------------------------
    const legacyKzoProvider: Provider = {
      ...kyzylordaProvider,
      id: 'PROV_LEGACY',
      isActive: undefined,
    };
    const test12Matches = matchProviders(kyzylordaReq, [legacyKzoProvider]);
    assert(
      test12Matches.length === 1 && test12Matches[0].id === 'PROV_LEGACY',
      'TEST 12: Legacy provider with missing isActive remains eligible (backward compatibility)'
    );

    // -------------------------------------------------------------
    // TEST 13: Provider missing valid cityId/categoryId -> MUST NOT match
    // -------------------------------------------------------------
    const incompleteProvider: Provider = {
      id: 'PROV_INCOMPLETE',
      name: 'No City Provider',
      phone: '+77010000004',
      whatsapp: '+77010000004',
      city: '',
      cityId: undefined,
      district: '',
      category: '',
      categoryId: undefined,
      services: '',
      priceRange: '',
      workingHours: '',
      description: '',
      verified: false,
      isActive: true,
    };
    const test13Matches = matchProviders(kyzylordaReq, [incompleteProvider]);
    assert(
      test13Matches.length === 0,
      'TEST 13: Provider missing valid cityId/categoryId is excluded'
    );

  } catch (e: any) {
    console.error('[CRITICAL ERROR] Test suite execution failed:', e);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`MATCHING CORRECTNESS VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runMatchingCorrectnessTests().catch(console.error);
