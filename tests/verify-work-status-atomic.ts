/**
 * Verification Test Suite: Phase 3 (Atomic Work Status & Request Completion)
 * Validates atomic transaction updates for appointment work status and ServiceRequest completion,
 * authorization validation for assigned providers, and status transition enforcement.
 */

import { localRepository, setCurrentUserId } from '../src/services/localRepository';
import { resilientRepository } from '../src/services/resilientRepository';

async function runPhase3Verification() {
  console.log('====================================================');
  console.log('STARTING PHASE 3 ATOMIC WORK STATUS VERIFICATION');
  console.log('====================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
      failedTests++;
    }
  }

  try {
    // Setup test request
    const reqId = `REQ_TEST_P3_${Date.now()}`;
    await localRepository.createRequest({
      id: reqId,
      customerId: 'cust_user_phase3',
      customerName: 'Aibek Customer',
      customerPhone: '+77011234567',
      category: 'Ремонт бытовой техники',
      service: 'Ремонт стиральных машин',
      description: 'Atomic test request',
      city: 'Алматы',
      status: 'OPEN',
    });

    await localRepository.createOffer({
      id: `OFFER_${reqId}`,
      requestId: reqId,
      providerId: 'prov_user_phase3',
      providerUserId: 'prov_user_phase3',
      providerName: 'Master Berik',
      price: '15 000 ₸',
      availability: 'Сегодня, 30 минут',
      status: 'PENDING',
    });

    await localRepository.acceptOffer(reqId, `OFFER_${reqId}`);

    // Create initial appointment
    const appt = await localRepository.createAppointment({
      requestId: reqId,
      customerId: 'cust_user_phase3',
      providerId: 'prov_user_phase3',
      providerUserId: 'prov_user_phase3',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      durationMinutes: 60,
      proposedBy: 'customer',
      status: 'CONFIRMED',
      workStatus: 'NOT_STARTED',
    });

    // Force local test execution context
    (resilientRepository as any).firebaseRepo.isAvailable = () => false;

    // TEST 1: Provider updates workStatus to PROVIDER_ON_THE_WAY -> Request becomes IN_PROGRESS
    const apptStarted = await resilientRepository.updateWorkStatus(
      appt.id,
      'PROVIDER_ON_THE_WAY',
      'prov_user_phase3'
    );
    const reqStarted = await resilientRepository.getRequest(reqId);

    assert(
      apptStarted.workStatus === 'PROVIDER_ON_THE_WAY' && reqStarted?.status === 'IN_PROGRESS',
      'Test 1: Transition to PROVIDER_ON_THE_WAY updates appointment workStatus and request status to IN_PROGRESS',
      `appt workStatus: ${apptStarted.workStatus}, req status: ${reqStarted?.status}`
    );

    // TEST 2: Provider attempts unauthorized workStatus update -> Throws Error
    let unauthErrorCaught = false;
    try {
      await resilientRepository.updateWorkStatus(
        appt.id,
        'PROVIDER_ARRIVED',
        'prov_unauthorized_hacker'
      );
    } catch (e: any) {
      unauthErrorCaught = e?.message?.includes('Unauthorized');
    }
    assert(
      unauthErrorCaught,
      'Test 2: Unauthorized provider attempt to update work status is rejected'
    );

    // TEST 3: Invalid work status transition attempt -> Throws Error
    let invalidTransitionCaught = false;
    try {
      await resilientRepository.updateWorkStatus(
        appt.id,
        'NOT_STARTED', // Invalid backward transition
        'prov_user_phase3'
      );
    } catch (e: any) {
      invalidTransitionCaught = e?.message?.includes('Invalid work status transition');
    }
    assert(
      invalidTransitionCaught,
      'Test 3: Invalid backward work status transition is rejected'
    );

    // Step through linear progression: PROVIDER_ARRIVED -> WORK_STARTED -> WORK_COMPLETED
    await resilientRepository.updateWorkStatus(appt.id, 'PROVIDER_ARRIVED', 'prov_user_phase3');
    await resilientRepository.updateWorkStatus(appt.id, 'WORK_STARTED', 'prov_user_phase3');

    // TEST 4: Work completion (WORK_COMPLETED) -> Appointment & Request atomically set to COMPLETED
    const apptCompleted = await resilientRepository.updateWorkStatus(
      appt.id,
      'WORK_COMPLETED',
      'prov_user_phase3'
    );
    const reqCompleted = await resilientRepository.getRequest(reqId);

    // The provider reports the job finished; only the customer closes the request
    assert(
      apptCompleted.workStatus === 'WORK_COMPLETED' &&
        apptCompleted.status === 'COMPLETED' &&
        reqCompleted?.status === 'IN_PROGRESS' &&
        Boolean(reqCompleted?.providerDoneAt),
      'Test 4: WORK_COMPLETED completes the appointment and marks the request finished by the provider (awaiting customer)',
      `appt status: ${apptCompleted.status}, req status: ${reqCompleted?.status}, providerDoneAt: ${reqCompleted?.providerDoneAt}`
    );

    // TEST 5: completeAppointment() on confirmed appointment sets all statuses to COMPLETED
    const reqId2 = `REQ_TEST_P3_2_${Date.now()}`;
    await localRepository.createRequest({
      id: reqId2,
      customerId: 'cust_user_phase3',
      customerName: 'Aibek Customer',
      customerPhone: '+77011234567',
      category: 'Сантехника',
      service: 'Установка смесителя',
      description: 'Atomic complete test',
      city: 'Алматы',
      status: 'OPEN',
    });

    await localRepository.createOffer({
      id: `OFFER_${reqId2}`,
      requestId: reqId2,
      providerId: 'prov_user_phase3',
      providerUserId: 'prov_user_phase3',
      providerName: 'Master Berik',
      price: '18 000 ₸',
      availability: 'Завтра, 10:00',
      status: 'PENDING',
    });

    await localRepository.acceptOffer(reqId2, `OFFER_${reqId2}`);

    const appt2 = await localRepository.createAppointment({
      requestId: reqId2,
      customerId: 'cust_user_phase3',
      providerId: 'prov_user_phase3',
      providerUserId: 'prov_user_phase3',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      durationMinutes: 45,
      proposedBy: 'provider',
      status: 'CONFIRMED',
      workStatus: 'NOT_STARTED',
    });

    const appt2Completed = await resilientRepository.completeAppointment(appt2.id);
    const req2Completed = await resilientRepository.getRequest(reqId2);

    assert(
      appt2Completed.status === 'COMPLETED' &&
        appt2Completed.workStatus === 'WORK_COMPLETED' &&
        req2Completed?.status !== 'COMPLETED' &&
        Boolean(req2Completed?.providerDoneAt),
      'Test 5: completeAppointment() by the provider completes the appointment; the request waits for the customer',
      `appt2 status: ${appt2Completed.status}, req2 status: ${req2Completed?.status}, providerDoneAt: ${req2Completed?.providerDoneAt}`
    );

    // TEST 6: the customer confirms and the request becomes COMPLETED
    setCurrentUserId('cust_user_phase3');
    const confirmed = await localRepository.confirmCustomerCompletion(reqId2, appt2.id);
    assert(
      confirmed.request.status === 'COMPLETED',
      'Test 6: Customer confirmation closes the request (COMPLETED)',
      `req2 status: ${confirmed.request.status}`
    );

  } catch (err: any) {
    console.error('[CRITICAL] Phase 3 verification error:', err);
    failedTests++;
  }

  console.log('\n====================================================');
  console.log(`PHASE 3 VERIFICATION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase3Verification().catch(console.error);
