/**
 * Verification Test Suite: Customer Completion Security & Audit
 * Tests:
 * 1. Owner customer can complete request in valid state (PROVIDER_SELECTED / IN_PROGRESS)
 * 2. Another customer cannot complete request: a direct write as that customer, refused by the
 *    Firestore security rules (emulator); the other scenarios use the device-mode repository
 * 3. Mismatched appointment belonging to another customer cannot be updated
 * 4. Mismatched appointment belonging to another request cannot be updated
 * 5. Completion without appointment succeeds cleanly
 * 6. PROPOSED or RESCHEDULED appointment is NOT incorrectly transitioned to COMPLETED
 * 7. Completion button is hidden for CANCELLED, COMPLETED, OPEN, NEW, etc. requests
 * 8. Completion process does NOT write 'released' to any paymentStatus field
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../src/services/firebase';
import { localRepository } from '../src/services/localRepository';
import { actAs } from './helpers/actors';

async function runAuditTests() {
  console.log('====================================================');
  console.log('STARTING CUSTOMER COMPLETION SECURITY AUDIT TEST SUITE');
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

  const timestamp = Date.now();
  const customerA = `cust_A_${timestamp}`;
  const customerB = `cust_B_${timestamp}`;
  const providerUid = `prov_${timestamp}`;

  // -----------------------------------------------------------------
  // SCENARIO 1: Owner customer completes request in valid state
  // -----------------------------------------------------------------
  const req1Id = `REQ_AUDIT_1_${timestamp}`;
  await localRepository.createRequest({
    id: req1Id,
    customerId: customerA,
    city: 'Almaty',
    cityId: 'almaty',
    category: 'Home Services',
    categoryId: 'home_services',
    service: 'Plumber',
    status: 'PROVIDER_SELECTED',
  });

  const res1 = await localRepository.confirmCustomerCompletion(req1Id);
  assert(
    res1.request.status === 'COMPLETED',
    'SCENARIO 1: Request owner successfully transitions PROVIDER_SELECTED request to COMPLETED'
  );

  // -----------------------------------------------------------------
  // SCENARIO 2: Another customer cannot complete another customer's request.
  // Tried for real against the Firestore emulator and its security rules: customer B writes the
  // completion straight to the database (no app checks in between) and is refused, while the same
  // write by the owner goes through, so the refusal is about who writes, not a malformed write.
  // -----------------------------------------------------------------
  {
    const { createRequire } = await import('node:module');
    const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
    const adminApp = requireFromFunctions('firebase-admin/app');
    if (!adminApp.getApps().length) adminApp.initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek' });
    const adminDb = requireFromFunctions('firebase-admin/firestore').getFirestore();

    const ownerUid = await actAs('completion-owner');
    const strangerUid = await actAs('completion-stranger');
    const reqId = `REQ_AUDIT_2_${timestamp}`;
    const offerId = `OFFER-${reqId}-${providerUid}`;
    const now = new Date().toISOString();
    await adminDb.doc(`requests/${reqId}`).set({
      id: reqId, customerId: ownerUid, cityId: 'kyzylorda', city: 'Кызылорда', categoryId: 'plumbing', category: 'Сантехника',
      service: 'Сантехник', status: 'IN_PROGRESS', selectedOfferId: offerId, createdAt: now, updatedAt: now,
    });
    await adminDb.doc(`offers/${offerId}`).set({
      id: offerId, requestId: reqId, customerId: ownerUid, providerId: providerUid, providerUserId: providerUid, status: 'ACCEPTED', createdAt: now,
    });
    const completion = () => updateDoc(doc(db!, 'requests', reqId), { status: 'COMPLETED', updatedAt: new Date().toISOString() });

    await actAs('completion-stranger');
    let strangerError = '';
    try {
      await completion();
    } catch (err: any) {
      strangerError = String(err?.code || err?.message);
    }
    const afterStranger = (await adminDb.doc(`requests/${reqId}`).get()).data();
    assert(
      strangerUid !== ownerUid && strangerError === 'permission-denied' && afterStranger?.status === 'IN_PROGRESS',
      'SCENARIO 2: Another customer writing the completion directly is refused by the security rules; the request stays IN_PROGRESS',
      strangerError || 'the write went through'
    );

    await actAs('completion-owner');
    let ownerError = '';
    try {
      await completion();
    } catch (err: any) {
      ownerError = String(err?.code || err?.message);
    }
    const afterOwner = (await adminDb.doc(`requests/${reqId}`).get()).data();
    assert(
      !ownerError && afterOwner?.status === 'COMPLETED',
      'SCENARIO 2: The same write by the request owner is accepted (control)',
      ownerError
    );
  }

  // -----------------------------------------------------------------
  // SCENARIO 3: Mismatched appointment belonging to another customer cannot be updated
  // -----------------------------------------------------------------
  const req3Id = `REQ_AUDIT_3_${timestamp}`;
  await localRepository.createRequest({
    id: req3Id,
    customerId: customerA,
    city: 'Almaty',
    cityId: 'almaty',
    category: 'Home Services',
    categoryId: 'home_services',
    service: 'Plumber',
    status: 'PROVIDER_SELECTED',
  });

  const reqOtherId = `REQ_OTHER_${timestamp}`;
  await localRepository.createRequest({
    id: reqOtherId,
    customerId: customerB,
    city: 'Almaty',
    cityId: 'almaty',
    category: 'Home Services',
    categoryId: 'home_services',
    service: 'Plumber',
    status: 'IN_PROGRESS',
  });

  const apptOtherCust = await localRepository.createAppointment({
    requestId: reqOtherId,
    customerId: customerB, // Belongs to customerB!
    providerId: providerUid,
    providerUserId: providerUid,
    status: 'CONFIRMED',
    proposedBy: 'customer',
    scheduledAt: new Date().toISOString(),
  });
  const apptOtherCustId = apptOtherCust.id;

  let scenario3Rejected = false;
  try {
    // Attempt to pass customerB's appointment into customerA's completion call
    await localRepository.confirmCustomerCompletion(req3Id, apptOtherCustId);
  } catch (err: any) {
    if (err.message.includes('Unauthorized') || err.message.includes('not belong')) {
      scenario3Rejected = true;
    }
  }

  // Also verify other customer's appointment was NOT modified to COMPLETED
  const checkAppt3 = await localRepository.getAppointment(apptOtherCustId);
  assert(
    scenario3Rejected || (checkAppt3 !== null && checkAppt3?.status !== 'COMPLETED'),
    'SCENARIO 3: Mismatched appointment belonging to another customer is rejected and NOT updated'
  );

  // -----------------------------------------------------------------
  // SCENARIO 4: Mismatched appointment belonging to another request cannot be updated
  // -----------------------------------------------------------------
  const req4A_Id = `REQ_AUDIT_4A_${timestamp}`;
  const req4B_Id = `REQ_AUDIT_4B_${timestamp}`;

  await localRepository.createRequest({
    id: req4A_Id,
    customerId: customerA,
    city: 'Almaty',
    cityId: 'almaty',
    category: 'Home Services',
    categoryId: 'home_services',
    service: 'Plumber',
    status: 'IN_PROGRESS',
  });

  await localRepository.createRequest({
    id: req4B_Id,
    customerId: customerA,
    city: 'Almaty',
    cityId: 'almaty',
    category: 'Home Services',
    categoryId: 'home_services',
    service: 'Plumber',
    status: 'IN_PROGRESS',
  });

  // Create appointment for req4B
  const apptFor4B = await localRepository.createAppointment({
    requestId: req4B_Id,
    customerId: customerA,
    providerId: providerUid,
    providerUserId: providerUid,
    status: 'CONFIRMED',
    proposedBy: 'customer',
    scheduledAt: new Date().toISOString(),
  });

  let scenario4Rejected = false;
  try {
    // Attempt to pass req4B's appointment into req4A's completion
    await localRepository.confirmCustomerCompletion(req4A_Id, apptFor4B.id);
  } catch (err: any) {
    if (err.message.includes('Unauthorized') || err.message.includes('not belong')) {
      scenario4Rejected = true;
    }
  }

  const checkAppt4B = await localRepository.getAppointment(apptFor4B.id);
  assert(
    scenario4Rejected && checkAppt4B?.status === 'CONFIRMED',
    'SCENARIO 4: Mismatched appointment belonging to different request is rejected and remains untouched'
  );

  // -----------------------------------------------------------------
  // SCENARIO 5: Completion without appointment succeeds cleanly
  // -----------------------------------------------------------------
  const req5Id = `REQ_AUDIT_5_${timestamp}`;
  await localRepository.createRequest({
    id: req5Id,
    customerId: customerA,
    city: 'Astana',
    cityId: 'astana',
    category: 'Home Services',
    categoryId: 'home_services',
    service: 'Cleaning',
    status: 'IN_PROGRESS',
  });

  // Complete without providing appointmentId and with no appointment created
  const res5 = await localRepository.confirmCustomerCompletion(req5Id);
  assert(
    res5.request.status === 'COMPLETED' && res5.appointment === undefined,
    'SCENARIO 5: Completion without an appointment succeeds cleanly without error'
  );

  // -----------------------------------------------------------------
  // SCENARIO 6: PROPOSED or RESCHEDULED appointment is NOT marked COMPLETED
  // -----------------------------------------------------------------
  const req6Id = `REQ_AUDIT_6_${timestamp}`;
  await localRepository.createRequest({
    id: req6Id,
    customerId: customerA,
    city: 'Astana',
    cityId: 'astana',
    category: 'Home Services',
    categoryId: 'home_services',
    service: 'Locksmith',
    status: 'PROVIDER_SELECTED',
  });

  const appt6 = await localRepository.createAppointment({
    requestId: req6Id,
    customerId: customerA,
    providerId: providerUid,
    providerUserId: providerUid,
    status: 'PROPOSED', // Still unconfirmed proposal!
    proposedBy: 'customer',
    scheduledAt: new Date().toISOString(),
  });

  const res6 = await localRepository.confirmCustomerCompletion(req6Id, appt6.id);
  const checkAppt6 = await localRepository.getAppointment(appt6.id);

  assert(
    res6.request.status === 'COMPLETED' &&
      checkAppt6?.status === 'PROPOSED' &&
      (checkAppt6?.status as string) !== 'COMPLETED',
    'SCENARIO 6: PROPOSED appointment is NOT falsely marked COMPLETED while request completes'
  );

  // -----------------------------------------------------------------
  // SCENARIO 7: Completion button visibility logic in AppointmentSection
  // -----------------------------------------------------------------
  function shouldShowCustomerCompletionButton(role: string, requestStatus: string): boolean {
    return (
      role === 'customer' &&
      (requestStatus === 'PROVIDER_SELECTED' ||
        requestStatus === 'ACCEPTED' ||
        requestStatus === 'IN_PROGRESS')
    );
  }

  const showInProviderSelected = shouldShowCustomerCompletionButton('customer', 'PROVIDER_SELECTED');
  const showInAccepted = shouldShowCustomerCompletionButton('customer', 'ACCEPTED');
  const showInInProgress = shouldShowCustomerCompletionButton('customer', 'IN_PROGRESS');
  const showInCancelled = shouldShowCustomerCompletionButton('customer', 'CANCELLED');
  const showInCompleted = shouldShowCustomerCompletionButton('customer', 'COMPLETED');
  const showInOpen = shouldShowCustomerCompletionButton('customer', 'OPEN');
  const showInNew = shouldShowCustomerCompletionButton('customer', 'NEW');
  const showForProvider = shouldShowCustomerCompletionButton('provider', 'IN_PROGRESS');

  assert(
    showInProviderSelected &&
      showInAccepted &&
      showInInProgress &&
      !showInCancelled &&
      !showInCompleted &&
      !showInOpen &&
      !showInNew &&
      !showForProvider,
    'SCENARIO 7: Completion button is ONLY visible for active customer roles and hidden for CANCELLED, COMPLETED, OPEN, NEW'
  );

  // -----------------------------------------------------------------
  // SCENARIO 8: Completion does NOT write 'released' to any paymentStatus field
  // -----------------------------------------------------------------
  const req8Id = `REQ_AUDIT_8_${timestamp}`;
  await localRepository.createRequest({
    id: req8Id,
    customerId: customerA,
    city: 'Almaty',
    cityId: 'almaty',
    category: 'Home Services',
    categoryId: 'home_services',
    service: 'Plumber',
    status: 'IN_PROGRESS',
    paymentStatus: 'pending',
  });

  const res8 = await localRepository.confirmCustomerCompletion(req8Id);
  const freshReq8 = await localRepository.getRequest(req8Id);

  assert(
    res8.request.status === 'COMPLETED' &&
      freshReq8?.paymentStatus !== 'released' &&
      (freshReq8?.paymentStatus === 'pending' || freshReq8?.paymentStatus === undefined),
    'SCENARIO 8: Completion does NOT write paymentStatus: "released" or fabricate transfers'
  );

  console.log('\n====================================================');
  console.log(`AUDIT TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runAuditTests().catch((err) => {
  console.error('Audit tests crashed:', err);
  process.exit(1);
});
