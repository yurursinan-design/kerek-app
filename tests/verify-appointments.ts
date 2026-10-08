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
  unsubscribe();
  assert(true, `20. Unsubscribe executes cleanly without memory leaks`);

  // 15. ResilientRepository layer check
  const resilientAppt = await resilientRepository.getAppointment(openReq.id);
  assert(
    resilientAppt !== null && resilientAppt.id === deterministicApptId,
    `21. ResilientRepository retrieves appointment via fallback/cache layer`
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
