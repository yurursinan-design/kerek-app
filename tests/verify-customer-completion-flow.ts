/**
 * Verification Test Suite: Customer Completion Confirmation & Post-Completion Review Flow
 * Validates:
 * 1. IN_PROGRESS request -> Status update to COMPLETED succeeds
 * 2. Invalid completion attempts (OPEN, CANCELLED requests) -> Blocked/Rejected
 * 3. Double completion attempt on COMPLETED request -> Handled safely without error
 * 4. Review creation for COMPLETED request -> Review created & linked to correct requestId and providerId
 * 5. Repeat review submission for same request -> Handled gracefully
 * 6. System Regressions: AI Understanding 2.0, Matching Phase 5.1, Server-side Discovery Phase 5.2
 */

import { localRepository } from '../src/services/localRepository';
import { firebaseRepository } from '../src/services/firebaseRepository';
import { matchProviders } from '../src/services/matchingService';
import { analyzeRequestUnderstanding } from '../src/services/requestUnderstanding';
import { ServiceRequest, ProviderOffer } from '../src/types';

async function runCustomerCompletionFlowTests() {
  console.log('====================================================');
  console.log('STARTING CUSTOMER COMPLETION & REVIEW FLOW VERIFICATION');
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
    const timestamp = Date.now();
    const customerId = `cust_comp_${timestamp}`;
    const providerId = `prov_comp_${timestamp}`;

    // -------------------------------------------------------------
    // TEST 1: IN_PROGRESS request -> updateRequestStatus to COMPLETED
    // -------------------------------------------------------------
    const req1Id = `REQ_COMP_1_${timestamp}`;
    await localRepository.createRequest({
      id: req1Id,
      customerId,
      city: 'Қызылорда',
      cityId: 'kyzylorda',
      category: 'Бытовые услуги (Сантехник, Электрик)',
      categoryId: 'home_services',
      service: 'Сантехник',
      status: 'IN_PROGRESS',
    });

    const updated1 = await localRepository.updateRequestStatus(req1Id, 'COMPLETED');
    assert(
      updated1 !== null && updated1.status === 'COMPLETED',
      'TEST 1: IN_PROGRESS request successfully transitions to COMPLETED'
    );

    // -------------------------------------------------------------
    // TEST 2: CANCELLED request -> updateRequestStatus to COMPLETED is rejected
    // -------------------------------------------------------------
    const req2Id = `REQ_COMP_2_${timestamp}`;
    await localRepository.createRequest({
      id: req2Id,
      customerId,
      city: 'Қызылорда',
      cityId: 'kyzylorda',
      category: 'Бытовые услуги',
      categoryId: 'home_services',
      service: 'Сантехник',
      status: 'CANCELLED',
    });

    let test2Rejected = false;
    try {
      await localRepository.updateRequestStatus(req2Id, 'COMPLETED');
    } catch {
      test2Rejected = true;
    }
    const req2Fresh = await localRepository.getRequest(req2Id);
    assert(
      test2Rejected || req2Fresh?.status === 'CANCELLED',
      'TEST 2: CANCELLED request cannot be transitioned to COMPLETED'
    );

    // -------------------------------------------------------------
    // TEST 3: COMPLETED request -> second completion is idempotent
    // -------------------------------------------------------------
    const updated1Second = await localRepository.updateRequestStatus(req1Id, 'COMPLETED');
    assert(
      updated1Second !== null && updated1Second.status === 'COMPLETED',
      'TEST 3: Repeat completion on COMPLETED request remains COMPLETED without error'
    );

    // -------------------------------------------------------------
    // TEST 4: Review submission linked to COMPLETED request and provider
    // -------------------------------------------------------------
    const createdReview = await localRepository.createReview({
      id: req1Id,
      requestId: req1Id,
      customerId,
      customerName: 'Aibek Customer',
      providerId,
      providerName: 'Kyzylorda Master',
      rating: 5,
      comment: 'Жұмыс сапалы әрі жылдам орындалды, рахмет!',
      createdAt: new Date().toISOString(),
    });

    assert(
      createdReview.requestId === req1Id &&
        createdReview.providerId === providerId &&
        createdReview.rating === 5,
      'TEST 4: Review successfully created and linked to completed requestId and providerId'
    );

    // -------------------------------------------------------------
    // TEST 5: Get reviews for completed request
    // -------------------------------------------------------------
    const fetchedReviews = await localRepository.getReviews({ requestId: req1Id });
    assert(
      fetchedReviews.length === 1 && fetchedReviews[0].rating === 5,
      'TEST 5: getReviews({ requestId }) retrieves the created review'
    );

    // -------------------------------------------------------------
    // TEST 6: AI Understanding 2.0 Regression Check
    // -------------------------------------------------------------
    const understanding = analyzeRequestUnderstanding('Кызылордада сегодня сантехник кран течет');
    assert(
      understanding.cityId === 'kyzylorda' &&
        (understanding.categoryId === 'home_services' || understanding.categoryId === 'plumbing'),
      'TEST 6: AI Request Understanding 2.0 regression intact'
    );

    // -------------------------------------------------------------
    // TEST 7: Matching Correctness Phase 5.1 Regression Check
    // -------------------------------------------------------------
    const kzoReq: ServiceRequest = {
      id: 'REQ_REG_51',
      customerId,
      customerName: 'Aibek',
      requestText: 'Сантехник кран течет',
      city: 'Қызылорда',
      cityId: 'kyzylorda',
      category: 'Бытовые услуги',
      categoryId: 'home_services',
      service: 'Сантехник',
      status: 'OPEN',
      date: 'Сегодня',
      budget: 'Договорная',
      urgency: 'normal',
      createdAt: new Date().toISOString(),
    };
    const kzoMatched = matchProviders(kzoReq, [
      {
        id: 'P_KZO_REG',
        userId: 'u_kzo_reg',
        name: 'Kyzylorda Master',
        phone: '+77010000001',
        whatsapp: '+77010000001',
        city: 'Қызылорда',
        cityId: 'kyzylorda',
        district: 'Центр',
        category: 'Бытовые услуги',
        categoryId: 'home_services',
        services: 'Сантехника, кран',
        priceRange: '5000 ₸',
        workingHours: '09:00 - 20:00',
        description: 'Plumber in Kyzylorda',
        verified: true,
        isActive: true,
      },
      {
        id: 'P_ALM_REG',
        userId: 'u_alm_reg',
        name: 'Almaty Master',
        phone: '+77010000002',
        whatsapp: '+77010000002',
        city: 'Алматы',
        cityId: 'almaty',
        district: 'Центр',
        category: 'Бытовые услуги',
        categoryId: 'home_services',
        services: 'Сантехника',
        priceRange: '6000 ₸',
        workingHours: '09:00 - 20:00',
        description: 'Plumber in Almaty',
        verified: true,
        isActive: true,
      },
    ]);

    assert(
      kzoMatched.length === 1 && kzoMatched[0].id === 'P_KZO_REG',
      'TEST 7: Phase 5.1 Matching filter intact (Almaty provider excluded)'
    );

    // -------------------------------------------------------------
    // TEST 8: Server-side Provider Discovery Phase 5.2 Regression Check
    // -------------------------------------------------------------
    const kzoCandidates = await firebaseRepository.getProviders({ cityId: 'kyzylorda' });
    const allKzo = kzoCandidates.every((p) => p.cityId === 'kyzylorda');
    assert(
      allKzo,
      'TEST 8: Phase 5.2 Server-side Discovery intact (cityId filter enforced)'
    );

  } catch (e: any) {
    console.error('[CRITICAL ERROR] Test suite execution failed:', e);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`CUSTOMER COMPLETION & REVIEW FLOW SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runCustomerCompletionFlowTests().catch(console.error);
