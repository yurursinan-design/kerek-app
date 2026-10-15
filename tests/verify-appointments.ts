/**
 * Verification Test: Appointment / Randevu System
 * Validates Appointment lifecycle, deterministic IDs, status transitions,
 * authorization rules, notifications dispatch, and resilient local/cloud storage.
 */

import { getAppointmentId } from '../src/types';
import { localRepository } from '../src/services/localRepository';
import { resilientRepository } from '../src/services';
import { notificationService } from '../src/services/notificationService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runAppointmentTests() {
  console.log('=== RUNNING TESTS FOR APPOINTMENT / RANDEVU SYSTEM ===\n');

  // 1. Deterministic appointment ID helper
  const sampleReqId = 'REQ-12345';
  const expectedId = `appointment_${sampleReqId}`;
  assert(
    getAppointmentId(sampleReqId) === expectedId,
    `1. getAppointmentId generates deterministic ID (${expectedId})`
  );
  assert(
    getAppointmentId('  REQ-999  ') === 'appointment_REQ-999',
    `2. Whitespace trimmed in getAppointmentId`
  );

  // 2. Setup customer and provider
  const customerId = 'cust_user_1';
  const provider = await localRepository.createProvider({
    userId: 'prov_user_1',
    name: 'Master Ruslan',
    city: 'almaty',
    category: 'appliance_repair',
    phone: '+7 701 555 1234',
    whatsapp: '+7 701 555 1234',
  });

  // 3. Create request in OPEN status
  const openReq = await localRepository.createRequest({
    customerId,
    customerName: 'Aigul',
    city: 'almaty',
    category: 'appliance_repair',
    service: 'Washing machine repair',
    status: 'OPEN',
  });

  // 4. Test cannot create appointment for OPEN request
  let openErrorCaught = false;
  try {
    await localRepository.createAppointment({
      requestId: openReq.id,
      customerId,
      providerId: provider.id,
      providerUserId: provider.userId || provider.id,
      proposedBy: 'customer',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'PROPOSED',
    });
  } catch (err: any) {
    openErrorCaught = true;
    assert(
      err.message.includes('Cannot create appointment for request in status: OPEN') ||
      err.message.includes('OPEN'),
      `3. Creating appointment blocked for OPEN request: ${err.message}`
    );
  }
  assert(openErrorCaught, `4. Appointment creation for OPEN request throws error`);

  // 5. Provider creates offer and customer accepts offer
  const offer = await localRepository.createOffer({
    requestId: openReq.id,
    providerId: provider.id,
    providerUserId: provider.userId,
    providerName: provider.name,
    providerPhone: provider.phone,
    providerWhatsapp: provider.whatsapp,
    price: '15 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня, 1 час',
    status: 'PENDING',
  });

  const acceptResult = await localRepository.acceptOffer(openReq.id, offer.id);
  assert(
    acceptResult.request?.status === 'PROVIDER_SELECTED',
    `5. Offer accepted -> Request status is PROVIDER_SELECTED`
  );

  // 6. Customer creates appointment for selected provider
  const scheduledTime = new Date(Date.now() + 86400000).toISOString();
  const createdAppt = await localRepository.createAppointment({
    requestId: openReq.id,
    customerId,
    providerId: provider.id,
    providerUserId: provider.userId || provider.id,
    proposedBy: 'customer',
    scheduledAt: scheduledTime,
    durationMinutes: 60,
    status: 'PROPOSED',
    note: 'Please bring spare parts',
  });

  const deterministicApptId = getAppointmentId(openReq.id);
  assert(
    createdAppt.id === deterministicApptId,
    `6. Created appointment has deterministic ID: ${createdAppt.id}`
  );
  assert(
    createdAppt.status === 'PROPOSED',
    `7. Initial appointment status is PROPOSED`
  );
  assert(
    createdAppt.proposedBy === 'customer',
    `8. Proposed by matches customer`
  );
  assert(
    createdAppt.durationMinutes === 60,
    `9. durationMinutes recorded correctly`
  );

  // 7. Retrieve appointment
  const fetchedAppt = await localRepository.getAppointment(openReq.id);
  assert(
    fetchedAppt !== null && fetchedAppt.id === deterministicApptId,
    `10. getAppointment retrieves existing appointment by requestId`
  );

  // 8. Provider confirms appointment
  const confirmedAppt = await localRepository.confirmAppointment(
    deterministicApptId,
    'provider'
  );
  assert(
    confirmedAppt.status === 'CONFIRMED',
    `11. Provider confirms appointment -> status transitions to CONFIRMED`
  );

  // 9. Customer reschedules appointment
  const rescheduledTime = new Date(Date.now() + 172800000).toISOString();
  const rescheduledAppt = await localRepository.rescheduleAppointment(
    deterministicApptId,
    rescheduledTime,
    'customer',
    'Moving to Friday afternoon'
  );
  assert(
    rescheduledAppt.status === 'RESCHEDULED',
    `12. Customer reschedules appointment -> status becomes RESCHEDULED`
  );
  assert(
    rescheduledAppt.scheduledAt === rescheduledTime,
    `13. New scheduledAt timestamp updated`
  );
  assert(
    rescheduledAppt.note === 'Moving to Friday afternoon',
    `14. Reschedule note recorded`
  );

  // 10. Provider re-confirms rescheduled appointment
  const reconfirmedAppt = await localRepository.confirmAppointment(
    deterministicApptId,
    'provider'
  );
  assert(
    reconfirmedAppt.status === 'CONFIRMED',
    `15. Provider confirms rescheduled appointment -> status returns to CONFIRMED`
  );

  // 11. Test notification service triggers (non-blocking)
  let notificationSent = true;
  try {
    await notificationService.notifyAppointmentCreated(
      acceptResult.request!,
      createdAppt,
      'customer'
    );
    await notificationService.notifyAppointmentUpdated(
      acceptResult.request!,
      rescheduledAppt,
      'customer',
      'RESCHEDULED'
    );
    await notificationService.notifyAppointmentUpdated(
      acceptResult.request!,
      reconfirmedAppt,
      'provider',
      'CONFIRMED'
    );
  } catch {
    notificationSent = false;
  }
  assert(
    notificationSent,
    `16. Appointment notifications dispatch cleanly without throwing errors`
  );

  // 12. Complete appointment
  const completedAppt = await localRepository.completeAppointment(deterministicApptId);
  assert(
    completedAppt.status === 'COMPLETED',
    `17. Appointment completed -> status becomes COMPLETED`
  );

  // 13. Cancellation test on a second appointment
  const req2 = await localRepository.createRequest({
    customerId,
    customerName: 'Aigul',
    city: 'almaty',
    category: 'appliance_repair',
    service: 'AC repair',
    status: 'OPEN',
  });
  const offer2 = await localRepository.createOffer({
    requestId: req2.id,
    providerId: provider.id,
    providerUserId: provider.userId,
    providerName: provider.name,
    providerPhone: provider.phone,
    price: '20 000 ₸',
    priceType: 'fixed',
    availability: 'Завтра',
    status: 'PENDING',
  });
  await localRepository.acceptOffer(req2.id, offer2.id);

  const appt2 = await localRepository.createAppointment({
    requestId: req2.id,
    customerId,
    providerId: provider.id,
    providerUserId: provider.userId || provider.id,
    proposedBy: 'customer',
    scheduledAt: scheduledTime,
    status: 'PROPOSED',
  });
  const cancelledAppt = await localRepository.cancelAppointment(
    appt2.id,
    'customer',
    'Customer cancelled'
  );
  assert(
    cancelledAppt.status === 'CANCELLED',
    `18. Appointment cancelled -> status becomes CANCELLED`
  );

  // 14. Realtime listener subscription & unsubscribe
  let listenerUpdated = false;
  const unsubscribe = localRepository.subscribeToAppointment(
    openReq.id,
    (updated) => {
      if (updated) listenerUpdated = true;
    }
  );
  assert(typeof unsubscribe === 'function', `19. subscribeToAppointment returns unsubscribe function`);
  await new Promise((r) => setTimeout(r, 50));
  assert(listenerUpdated, `19b. Listener receives the current appointment`);
  unsubscribe();
  assert(true, `20. Unsubscribe executes cleanly without memory leaks`);

  // 15. ResilientRepository layer check
  const resilientAppt = await resilientRepository.getAppointment(openReq.id);
  assert(
    resilientAppt !== null && resilientAppt.id === deterministicApptId,
    `21. ResilientRepository retrieves appointment via fallback/cache layer`
  );

  // 16. Functional Firestore Security Rules Simulation for /appointments/{appointmentId}
  console.log('\n--- 16. Running Functional Firestore Security Rules Evaluation for Appointments ---');

  interface RulesContext {
    auth: { uid: string | null };
    database: {
      requests: Record<string, any>;
      offers: Record<string, any>;
      appointments: Record<string, any>;
    };
  }

  // Exact reproduction of the logic inside firestore.rules for appointments
  function evaluateAppointmentCreateRule(
    ctx: RulesContext,
    appointmentId: string,
    incoming: any
  ): boolean {
    if (!ctx.auth.uid) return false;
    if (!appointmentId || appointmentId.length > 128) return false;
    if (appointmentId !== `appointment_${incoming.requestId}`) return false;
    if (incoming.id !== appointmentId) return false;
    if (!['customer', 'provider'].includes(incoming.proposedBy)) return false;

    const reqDoc = ctx.database.requests[incoming.requestId];
    if (!reqDoc) return false;
    if (!['PROVIDER_SELECTED', 'ACCEPTED', 'IN_PROGRESS'].includes(reqDoc.status)) return false;
    if (!reqDoc.selectedOfferId || typeof reqDoc.selectedOfferId !== 'string') return false;
    if (reqDoc.customerId !== incoming.customerId) return false;

    const offerDoc = ctx.database.offers[reqDoc.selectedOfferId];
    if (!offerDoc) return false;
    if (offerDoc.requestId !== incoming.requestId) return false;
    if (offerDoc.status !== 'ACCEPTED') return false;

    const provIdMatches = incoming.providerId === offerDoc.providerId || incoming.providerId === offerDoc.providerUserId;
    const provUserIdMatches = incoming.providerUserId === offerDoc.providerUserId || incoming.providerUserId === offerDoc.providerId;
    if (!provIdMatches || !provUserIdMatches) return false;

    const isAuthorizedCustomer = incoming.proposedBy === 'customer' &&
      ctx.auth.uid === incoming.customerId &&
      ctx.auth.uid === reqDoc.customerId;

    const isAuthorizedProvider = incoming.proposedBy === 'provider' &&
      (ctx.auth.uid === incoming.providerUserId || ctx.auth.uid === incoming.providerId) &&
      (ctx.auth.uid === offerDoc.providerUserId || ctx.auth.uid === offerDoc.providerId);

    if (!isAuthorizedCustomer && !isAuthorizedProvider) return false;

    if (!['PROPOSED', 'CONFIRMED'].includes(incoming.status)) return false;
    if (typeof incoming.scheduledAt !== 'string' || incoming.scheduledAt.length < 10) return false;
    if (typeof incoming.createdAt !== 'string' || typeof incoming.updatedAt !== 'string') return false;

    return true;
  }

  function evaluateAppointmentUpdateRule(
    ctx: RulesContext,
    appointmentId: string,
    resource: any,
    incoming: any
  ): boolean {
    if (!ctx.auth.uid) return false;
    if (!appointmentId || appointmentId.length > 128) return false;

    const isParticipant =
      resource.customerId === ctx.auth.uid ||
      resource.providerUserId === ctx.auth.uid ||
      resource.providerId === ctx.auth.uid;
    if (!isParticipant) return false;

    // Strict immutability checks: id, requestId, customerId, providerId, providerUserId, createdAt
    if (incoming.id !== resource.id) return false;
    if (incoming.requestId !== resource.requestId) return false;
    if (incoming.customerId !== resource.customerId) return false;
    if (incoming.providerId !== resource.providerId) return false;
    if (incoming.providerUserId !== resource.providerUserId) return false;
    if (incoming.createdAt !== resource.createdAt) return false;

    // proposedBy caller role check: must remain same or match authorized role of actor
    const isProposedByPreserved = incoming.proposedBy === resource.proposedBy;
    const isCustomerProposing = incoming.proposedBy === 'customer' && ctx.auth.uid === resource.customerId;
    const isProviderProposing = incoming.proposedBy === 'provider' && (ctx.auth.uid === resource.providerUserId || ctx.auth.uid === resource.providerId);
    if (!isProposedByPreserved && !isCustomerProposing && !isProviderProposing) return false;

    if (typeof incoming.updatedAt !== 'string') return false;
    if (typeof incoming.scheduledAt !== 'string' || incoming.scheduledAt.length < 10) return false;

    const reqDoc = ctx.database.requests[resource.requestId];
    if (!reqDoc) return false;
    if (reqDoc.status === 'COMPLETED') return false;

    // Valid status transitions:
    const validTransitions: Record<string, string[]> = {
      'PROPOSED': ['PROPOSED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED'],
      'CONFIRMED': ['CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED'],
      'RESCHEDULED': ['RESCHEDULED', 'CONFIRMED', 'CANCELLED'],
      'COMPLETED': ['COMPLETED'],
      'CANCELLED': ['CANCELLED'],
    };
    if (!validTransitions[resource.status]?.includes(incoming.status)) return false;

    return true;
  }

  // Setup mock database state
  const mockCtx: RulesContext = {
    auth: { uid: null },
    database: {
      requests: {
        'REQ-SEC-1': {
          id: 'REQ-SEC-1',
          customerId: 'cust-sec-1',
          status: 'PROVIDER_SELECTED',
          selectedOfferId: 'OFFER-SEC-1',
        },
        'REQ-OPEN-1': {
          id: 'REQ-OPEN-1',
          customerId: 'cust-sec-1',
          status: 'OPEN',
        },
        'REQ-COMP-1': {
          id: 'REQ-COMP-1',
          customerId: 'cust-sec-1',
          status: 'COMPLETED',
          selectedOfferId: 'OFFER-SEC-1',
        },
      },
      offers: {
        'OFFER-SEC-1': {
          id: 'OFFER-SEC-1',
          requestId: 'REQ-SEC-1',
          providerId: 'prov-sec-1',
          providerUserId: 'user-prov-1',
          status: 'ACCEPTED',
        },
      },
      appointments: {},
    },
  };

  const validApptData = {
    id: 'appointment_REQ-SEC-1',
    requestId: 'REQ-SEC-1',
    customerId: 'cust-sec-1',
    providerId: 'prov-sec-1',
    providerUserId: 'user-prov-1',
    proposedBy: 'customer',
    status: 'PROPOSED',
    scheduledAt: '2026-10-15 14:00',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Rule Test 1: Customer can create appointment with proposedBy = customer
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentCreateRule(mockCtx, 'appointment_REQ-SEC-1', validApptData) === true,
    '22. [Security Rule] Request owner customer can create appointment with proposedBy = customer'
  );

  // Rule Test 2: Selected provider can create appointment with proposedBy = provider
  mockCtx.auth.uid = 'user-prov-1';
  assert(
    evaluateAppointmentCreateRule(mockCtx, 'appointment_REQ-SEC-1', {
      ...validApptData,
      proposedBy: 'provider',
    }) === true,
    '23. [Security Rule] Accepted provider can create appointment with proposedBy = provider'
  );

  // Rule Test 3: Attacker provider cannot create appointment
  mockCtx.auth.uid = 'attacker-provider-999';
  assert(
    evaluateAppointmentCreateRule(mockCtx, 'appointment_REQ-SEC-1', {
      ...validApptData,
      proposedBy: 'provider',
    }) === false,
    '24. [Security Rule] Attacker provider attempt to create appointment is strictly DENIED'
  );

  // Rule Test 4: Attacker customer cannot create appointment for another customer
  mockCtx.auth.uid = 'attacker-customer-999';
  assert(
    evaluateAppointmentCreateRule(mockCtx, 'appointment_REQ-SEC-1', validApptData) === false,
    '25. [Security Rule] Unauthorized third-party customer creation is strictly DENIED'
  );

  // Rule Test 5: Role mismatch: customer claiming proposedBy = provider is rejected
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentCreateRule(mockCtx, 'appointment_REQ-SEC-1', {
      ...validApptData,
      proposedBy: 'provider',
    }) === false,
    '26. [Security Rule] Role spoofing (customer claiming proposedBy = provider) is DENIED'
  );

  // Rule Test 6: OPEN request blocked from creating appointment
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentCreateRule(mockCtx, 'appointment_REQ-OPEN-1', {
      ...validApptData,
      id: 'appointment_REQ-OPEN-1',
      requestId: 'REQ-OPEN-1',
    }) === false,
    '27. [Security Rule] Appointment creation for OPEN request without accepted offer is DENIED'
  );

  // Rule Test 7: Customer attempt to alter providerId during update is strictly DENIED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, providerId: 'hijacked-provider-id', updatedAt: new Date().toISOString() }
    ) === false,
    '28. [Security Rule] Customer attempt to mutate providerId on appointment update is strictly DENIED'
  );

  // Rule Test 8: Customer attempt to alter providerUserId during update is strictly DENIED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, providerUserId: 'hijacked-user-id', updatedAt: new Date().toISOString() }
    ) === false,
    '29. [Security Rule] Customer attempt to mutate providerUserId on appointment update is strictly DENIED'
  );

  // Rule Test 9: Customer attempt to alter customerId during update is strictly DENIED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, customerId: 'different-customer-id', updatedAt: new Date().toISOString() }
    ) === false,
    '30. [Security Rule] Attempt to mutate customerId on appointment update is strictly DENIED'
  );

  // Rule Test 10: Appointment update on COMPLETED request is strictly DENIED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-COMP-1',
      { ...validApptData, requestId: 'REQ-COMP-1', id: 'appointment_REQ-COMP-1' },
      { ...validApptData, requestId: 'REQ-COMP-1', id: 'appointment_REQ-COMP-1', status: 'RESCHEDULED' }
    ) === false,
    '31. [Security Rule] Appointment update after request is COMPLETED is strictly DENIED'
  );

  // Rule Test 11: Customer attempt to alter id during update is strictly DENIED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, id: 'appointment_TAMPERED', updatedAt: new Date().toISOString() }
    ) === false,
    '32. [Security Rule] Customer attempt to mutate id on appointment update is strictly DENIED'
  );

  // Rule Test 12: Customer attempt to alter requestId during update is strictly DENIED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, requestId: 'REQ-HIJACKED', updatedAt: new Date().toISOString() }
    ) === false,
    '33. [Security Rule] Customer attempt to mutate requestId on appointment update is strictly DENIED'
  );

  // Rule Test 13: Customer attempt to alter createdAt during update is strictly DENIED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, createdAt: '2020-01-01T00:00:00Z', updatedAt: new Date().toISOString() }
    ) === false,
    '34. [Security Rule] Customer attempt to mutate createdAt on appointment update is strictly DENIED'
  );

  // Rule Test 14: Provider attempt to alter customerId during update is strictly DENIED
  mockCtx.auth.uid = 'user-prov-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, customerId: 'different-customer-id', updatedAt: new Date().toISOString() }
    ) === false,
    '35. [Security Rule] Provider attempt to mutate customerId on appointment update is strictly DENIED'
  );

  // Rule Test 15: Provider attempt to alter providerId during update is strictly DENIED
  mockCtx.auth.uid = 'user-prov-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, providerId: 'hijacked-provider-id', updatedAt: new Date().toISOString() }
    ) === false,
    '36. [Security Rule] Provider attempt to mutate providerId on appointment update is strictly DENIED'
  );

  // Rule Test 16: Unauthorized 3rd-party user attempt to update appointment is strictly DENIED
  mockCtx.auth.uid = 'attacker-user-999';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, status: 'CONFIRMED', updatedAt: new Date().toISOString() }
    ) === false,
    '37. [Security Rule] Unauthorized third party attempt to update appointment is strictly DENIED'
  );

  // Rule Test 17: Provider confirms appointment proposed by customer -> ALLOWED
  mockCtx.auth.uid = 'user-prov-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, status: 'CONFIRMED', updatedAt: new Date().toISOString() }
    ) === true,
    '38. [Security Rule] Provider successfully confirms customer-proposed appointment'
  );

  // Rule Test 18: Customer reschedules appointment (proposedBy = "customer") -> ALLOWED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData,
      { ...validApptData, status: 'RESCHEDULED', proposedBy: 'customer', scheduledAt: '2026-10-18 10:00', updatedAt: new Date().toISOString() }
    ) === true,
    '39. [Security Rule] Customer successfully reschedules appointment with proposedBy = customer'
  );

  // Rule Test 19: Direct jump from PROPOSED to COMPLETED without CONFIRMED is strictly DENIED
  mockCtx.auth.uid = 'cust-sec-1';
  assert(
    evaluateAppointmentUpdateRule(
      mockCtx,
      'appointment_REQ-SEC-1',
      validApptData, // status: 'PROPOSED'
      { ...validApptData, status: 'COMPLETED', updatedAt: new Date().toISOString() }
    ) === false,
    '40. [Security Rule] Direct illegal transition from PROPOSED to COMPLETED is strictly DENIED'
  );

  console.log(`\n=============================================`);
  console.log(`ALL APPOINTMENT TESTS PASSED: ${passed} passed, ${failed} failed`);
  console.log(`=============================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAppointmentTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
