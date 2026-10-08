/**
 * Verification Test Suite: Phase 4.2 Stale-State Protection
 * Tests:
 * 1. OPEN appointment -> WORK_STARTED -> WORK_COMPLETED -> PASS
 * 2. CANCELLED appointment -> stale WORK_COMPLETED replay -> EXPECTED: rejected/ignored
 * 3. OPEN request -> offline updateRequest replay -> EXPECTED: update succeeds
 * 4. PROVIDER_SELECTED request -> stale offline updateRequest -> EXPECTED: rejected/ignored
 * 5. OPEN request + PENDING offer -> offline updateOffer -> EXPECTED: update succeeds
 * 6. PROVIDER_SELECTED request + rejected/non-selected offer -> stale offline updateOffer -> EXPECTED: rejected/ignored
 * 7. Existing Phase 2 acceptOffer regression -> PASS
 * 8. Existing Phase 3 work-status atomic regression -> PASS
 * 9. Existing Phase 4 offline queue regression -> PASS
 */

import { localRepository } from '../src/services/localRepository';
import { resilientRepository } from '../src/services/resilientRepository';
import { offlineQueueService } from '../src/services/offlineQueueService';

async function runStaleStateProtectionTests() {
  console.log('====================================================');
  console.log('STARTING PHASE 4.2 STALE-STATE PROTECTION TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, details?: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${details ? `- ${details}` : ''}`);
      failed++;
    }
  }

  try {
    offlineQueueService.clearQueue();

    // -------------------------------------------------------------
    // TEST 1: OPEN appointment -> WORK_STARTED -> WORK_COMPLETED
    // -------------------------------------------------------------
    const req1Id = `REQ_STALE_1_${Date.now()}`;
    await localRepository.createRequest({
      id: req1Id,
      customerId: 'cust_stale_1',
      category: 'Ремонт бытовой техники',
      description: 'Test 1 Request',
      city: 'Алматы',
      status: 'OPEN',
    });
    const offer1 = await localRepository.createOffer({
      id: `OFFER_${req1Id}`,
      requestId: req1Id,
      providerId: 'prov_stale_1',
      providerUserId: 'prov_stale_1',
      price: '10 000 ₸',
      availability: 'Сегодня',
      status: 'PENDING',
    });
    await localRepository.acceptOffer(req1Id, offer1.id);

    const appt1 = await localRepository.createAppointment({
      requestId: req1Id,
      customerId: 'cust_stale_1',
      providerId: 'prov_stale_1',
      providerUserId: 'prov_stale_1',
      scheduledAt: new Date().toISOString(),
      durationMinutes: 60,
      proposedBy: 'customer',
      status: 'CONFIRMED',
      workStatus: 'NOT_STARTED',
    });

    (resilientRepository as any).firebaseRepo.isAvailable = () => false;

    await resilientRepository.updateWorkStatus(appt1.id, 'PROVIDER_ON_THE_WAY', 'prov_stale_1');
    await resilientRepository.updateWorkStatus(appt1.id, 'PROVIDER_ARRIVED', 'prov_stale_1');
    await resilientRepository.updateWorkStatus(appt1.id, 'WORK_STARTED', 'prov_stale_1');
    const appt1Completed = await resilientRepository.updateWorkStatus(appt1.id, 'WORK_COMPLETED', 'prov_stale_1');
    const req1State = await localRepository.getRequest(req1Id);

    assert(
      appt1Completed.workStatus === 'WORK_COMPLETED' &&
        appt1Completed.status === 'COMPLETED' &&
        req1State?.status === 'COMPLETED',
      'TEST 1: OPEN appointment -> WORK_STARTED -> WORK_COMPLETED succeeds'
    );

    // -------------------------------------------------------------
    // TEST 2: CANCELLED appointment -> stale WORK_COMPLETED replay
    // -------------------------------------------------------------
    const req2Id = `REQ_STALE_2_${Date.now()}`;
    await localRepository.createRequest({
      id: req2Id,
      customerId: 'cust_stale_2',
      category: 'Сантехника',
      city: 'Алматы',
      status: 'OPEN',
    });
    const offer2 = await localRepository.createOffer({
      id: `OFFER_${req2Id}`,
      requestId: req2Id,
      providerId: 'prov_stale_2',
      providerUserId: 'prov_stale_2',
      price: '12 000 ₸',
      availability: 'Сегодня',
      status: 'PENDING',
    });
    await localRepository.acceptOffer(req2Id, offer2.id);

    const appt2 = await localRepository.createAppointment({
      requestId: req2Id,
      customerId: 'cust_stale_2',
      providerId: 'prov_stale_2',
      providerUserId: 'prov_stale_2',
      scheduledAt: new Date().toISOString(),
      durationMinutes: 60,
      proposedBy: 'customer',
      status: 'CONFIRMED',
      workStatus: 'NOT_STARTED',
    });

    await localRepository.cancelAppointment(appt2.id, 'customer', 'Test cancellation');

    let test2Rejected = false;
    try {
      await resilientRepository.updateWorkStatus(appt2.id, 'WORK_COMPLETED', 'prov_stale_2');
    } catch (e: any) {
      test2Rejected = e?.message?.includes('CANCELLED');
    }
    const appt2Check = await localRepository.getAppointment(req2Id);

    assert(
      test2Rejected && appt2Check?.status === 'CANCELLED',
      'TEST 2: Stale WORK_COMPLETED on CANCELLED appointment is rejected and remains CANCELLED'
    );

    // -------------------------------------------------------------
    // TEST 3: OPEN request -> offline updateRequest replay succeeds
    // -------------------------------------------------------------
    const req3Id = `REQ_STALE_3_${Date.now()}`;
    await localRepository.createRequest({
      id: req3Id,
      customerId: 'cust_stale_3',
      category: 'Уборка',
      city: 'Алматы',
      description: 'Original Description',
      status: 'OPEN',
    });

    const updated3 = await localRepository.updateRequest(req3Id, {
      description: 'Updated Description Offline',
    });

    assert(
      updated3?.description === 'Updated Description Offline',
      'TEST 3: OPEN request offline updateRequest succeeds'
    );

    // -------------------------------------------------------------
    // TEST 4: PROVIDER_SELECTED request -> stale offline updateRequest rejected/ignored
    // -------------------------------------------------------------
    const req4Id = `REQ_STALE_4_${Date.now()}`;
    await localRepository.createRequest({
      id: req4Id,
      customerId: 'cust_stale_4',
      category: 'Электрика',
      city: 'Алматы',
      description: 'Original Electrician Req',
      status: 'OPEN',
    });
    await localRepository.updateRequestStatus(req4Id, 'PROVIDER_SELECTED', 'OFFER_4');

    let test4Rejected = false;
    try {
      await localRepository.updateRequest(req4Id, {
        description: 'Attempted Stale Description Edit',
      });
    } catch (e: any) {
      test4Rejected = e?.message?.includes('Validation Error');
    }

    const req4Check = await localRepository.getRequest(req4Id);

    assert(
      test4Rejected && req4Check?.description === 'Original Electrician Req',
      'TEST 4: Stale updateRequest on PROVIDER_SELECTED request is rejected'
    );

    // -------------------------------------------------------------
    // TEST 5: OPEN request + PENDING offer -> offline updateOffer succeeds
    // -------------------------------------------------------------
    const req5Id = `REQ_STALE_5_${Date.now()}`;
    await localRepository.createRequest({
      id: req5Id,
      customerId: 'cust_stale_5',
      category: 'Грузоперевозки',
      city: 'Алматы',
      status: 'OPEN',
    });
    const offer5 = await localRepository.createOffer({
      id: `OFFER_5_${Date.now()}`,
      requestId: req5Id,
      providerId: 'prov_stale_5',
      providerUserId: 'prov_stale_5',
      price: '20 000 ₸',
      availability: 'Сегодня',
      status: 'PENDING',
    });

    const offer5Updated = await localRepository.updateOffer(offer5.id, {
      price: '25 000 ₸',
    });

    assert(
      offer5Updated?.price === '25 000 ₸',
      'TEST 5: OPEN request + PENDING offer updateOffer succeeds'
    );

    // -------------------------------------------------------------
    // TEST 6: PROVIDER_SELECTED request + non-selected offer -> stale offline updateOffer rejected
    // -------------------------------------------------------------
    const req6Id = `REQ_STALE_6_${Date.now()}`;
    await localRepository.createRequest({
      id: req6Id,
      customerId: 'cust_stale_6',
      category: 'Красота',
      city: 'Алматы',
      status: 'OPEN',
    });
    const offer6 = await localRepository.createOffer({
      id: `OFFER_6_${Date.now()}`,
      requestId: req6Id,
      providerId: 'prov_stale_6',
      providerUserId: 'prov_stale_6',
      price: '12 000 ₸',
      availability: 'Сегодня',
      status: 'PENDING',
    });
    await localRepository.updateRequestStatus(req6Id, 'PROVIDER_SELECTED', 'OTHER_OFFER');

    let test6Rejected = false;
    try {
      await localRepository.updateOffer(offer6.id, { price: '15 000 ₸' });
    } catch (e: any) {
      test6Rejected = e?.message?.includes('Validation Error');
    }

    assert(
      test6Rejected,
      'TEST 6: Stale updateOffer on PROVIDER_SELECTED request is rejected'
    );

    // -------------------------------------------------------------
    // TEST 7: Phase 2 acceptOffer regression -> ONLINE ONLY check
    // -------------------------------------------------------------
    let acceptOfferOnlineCheck = false;
    try {
      await resilientRepository.acceptOffer('REQ_DUMMY', 'OFFER_DUMMY');
    } catch (e: any) {
      acceptOfferOnlineCheck = e?.message?.includes('Internet connection is required');
    }

    assert(
      acceptOfferOnlineCheck,
      'TEST 7: Phase 2 acceptOffer online-only constraint intact'
    );

    // -------------------------------------------------------------
    // TEST 8: Phase 3 work-status atomic regression
    // -------------------------------------------------------------
    const req8Id = `REQ_STALE_8_${Date.now()}`;
    await localRepository.createRequest({
      id: req8Id,
      customerId: 'cust_8',
      city: 'Алматы',
      category: 'Сантехника',
      status: 'OPEN',
    });
    await localRepository.createOffer({
      id: `OFFER_${req8Id}`,
      requestId: req8Id,
      providerId: 'prov_8',
      providerUserId: 'prov_8',
      price: '15 000 ₸',
      availability: 'Сегодня',
      status: 'PENDING',
    });
    await localRepository.acceptOffer(req8Id, `OFFER_${req8Id}`);
    const appt8 = await localRepository.createAppointment({
      requestId: req8Id,
      customerId: 'cust_8',
      providerId: 'prov_8',
      providerUserId: 'prov_8',
      scheduledAt: new Date().toISOString(),
      durationMinutes: 60,
      proposedBy: 'customer',
      status: 'CONFIRMED',
      workStatus: 'NOT_STARTED',
    });

    await resilientRepository.updateWorkStatus(appt8.id, 'PROVIDER_ON_THE_WAY', 'prov_8');
    const req8Check = await localRepository.getRequest(req8Id);

    assert(
      req8Check?.status === 'IN_PROGRESS',
      'TEST 8: Phase 3 work-status atomic regression intact'
    );

    // -------------------------------------------------------------
    // TEST 9: Phase 4 offline queue enqueue disallows acceptOffer
    // -------------------------------------------------------------
    let acceptQueueBlock = false;
    try {
      offlineQueueService.enqueueMutation('acceptOffer' as any, { requestId: 'r1', offerId: 'o1' });
    } catch (e: any) {
      acceptQueueBlock = e?.message?.includes('ACCEPT_OFFER_REQUIRES_ONLINE_EXECUTION');
    }

    assert(
      acceptQueueBlock,
      'TEST 9: Phase 4 offline queue enqueue disallows acceptOffer'
    );

  } catch (e: any) {
    console.error('[CRITICAL ERROR] Test suite failed:', e);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`STALE-STATE PROTECTION TESTS RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runStaleStateProtectionTests().catch(console.error);
