/**
 * Verification Test: Provider Work Status (Hizmet Durumu) System
 * Validates sequential work status progression, transition guards,
 * provider-only authorization, customer notifications, and terminal states.
 */

import {
  isValidWorkStatusTransition,
  getNextWorkStatus,
} from '../src/types';
import { localRepository } from '../src/services/localRepository';
import { notificationService } from '../src/services/notificationService';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ ${msg}`);
  }
}

async function runTests() {
  console.log('--- Starting Provider Work Status Verification ---');

  // 1. Pure Transition Logic Guard Tests
  console.log('\n[Test 1] Transition logic guards');
  assert(
    isValidWorkStatusTransition('NOT_STARTED', 'PROVIDER_ON_THE_WAY'),
    '1.1 NOT_STARTED -> PROVIDER_ON_THE_WAY is valid'
  );
  assert(
    isValidWorkStatusTransition('PROVIDER_ON_THE_WAY', 'PROVIDER_ARRIVED'),
    '1.2 PROVIDER_ON_THE_WAY -> PROVIDER_ARRIVED is valid'
  );
  assert(
    isValidWorkStatusTransition('PROVIDER_ARRIVED', 'WORK_STARTED'),
    '1.3 PROVIDER_ARRIVED -> WORK_STARTED is valid'
  );
  assert(
    isValidWorkStatusTransition('WORK_STARTED', 'WORK_COMPLETED'),
    '1.4 WORK_STARTED -> WORK_COMPLETED is valid'
  );

  // Skip transitions disallowed
  assert(
    !isValidWorkStatusTransition('NOT_STARTED', 'WORK_COMPLETED'),
    '1.5 NOT_STARTED -> WORK_COMPLETED is disallowed (cannot skip)'
  );
  assert(
    !isValidWorkStatusTransition('NOT_STARTED', 'WORK_STARTED'),
    '1.6 NOT_STARTED -> WORK_STARTED is disallowed (cannot skip)'
  );
  assert(
    !isValidWorkStatusTransition('PROVIDER_ON_THE_WAY', 'WORK_COMPLETED'),
    '1.7 PROVIDER_ON_THE_WAY -> WORK_COMPLETED is disallowed (cannot skip)'
  );

  // Backward transitions disallowed
  assert(
    !isValidWorkStatusTransition('WORK_STARTED', 'PROVIDER_ON_THE_WAY'),
    '1.8 WORK_STARTED -> PROVIDER_ON_THE_WAY is disallowed (no backward)'
  );
  assert(
    !isValidWorkStatusTransition('WORK_STARTED', 'PROVIDER_ARRIVED'),
    '1.9 WORK_STARTED -> PROVIDER_ARRIVED is disallowed (no backward)'
  );
  assert(
    !isValidWorkStatusTransition('WORK_COMPLETED', 'WORK_STARTED'),
    '1.10 WORK_COMPLETED -> WORK_STARTED is disallowed (terminal)'
  );

  // Cancellation rules
  assert(
    isValidWorkStatusTransition('NOT_STARTED', 'CANCELLED'),
    '1.11 NOT_STARTED -> CANCELLED is allowed'
  );
  assert(
    isValidWorkStatusTransition('PROVIDER_ON_THE_WAY', 'CANCELLED'),
    '1.12 PROVIDER_ON_THE_WAY -> CANCELLED is allowed'
  );
  assert(
    isValidWorkStatusTransition('PROVIDER_ARRIVED', 'CANCELLED'),
    '1.13 PROVIDER_ARRIVED -> CANCELLED is allowed'
  );
  assert(
    isValidWorkStatusTransition('WORK_STARTED', 'CANCELLED'),
    '1.14 WORK_STARTED -> CANCELLED is allowed'
  );
  assert(
    !isValidWorkStatusTransition('WORK_COMPLETED', 'CANCELLED'),
    '1.15 WORK_COMPLETED -> CANCELLED is strictly disallowed'
  );
  assert(
    !isValidWorkStatusTransition('CANCELLED', 'WORK_STARTED'),
    '1.16 CANCELLED -> WORK_STARTED is strictly disallowed'
  );

  // Helper getNextWorkStatus
  assert(
    getNextWorkStatus('NOT_STARTED') === 'PROVIDER_ON_THE_WAY',
    '1.17 Next of NOT_STARTED is PROVIDER_ON_THE_WAY'
  );
  assert(
    getNextWorkStatus('PROVIDER_ON_THE_WAY') === 'PROVIDER_ARRIVED',
    '1.18 Next of PROVIDER_ON_THE_WAY is PROVIDER_ARRIVED'
  );
  assert(
    getNextWorkStatus('PROVIDER_ARRIVED') === 'WORK_STARTED',
    '1.19 Next of PROVIDER_ARRIVED is WORK_STARTED'
  );
  assert(
    getNextWorkStatus('WORK_STARTED') === 'WORK_COMPLETED',
    '1.20 Next of WORK_STARTED is WORK_COMPLETED'
  );
  assert(
    getNextWorkStatus('WORK_COMPLETED') === null,
    '1.21 Next of WORK_COMPLETED is null'
  );

  // 2. Setup Test Request, Provider, Offer, and Appointment in LocalRepository
  console.log('\n[Test 2] Repository Setup & Authorization');
  const customerId = 'cust_workstatus_test_1';
  const providerUserId = 'prov_user_workstatus_1';

  const provider = await localRepository.createProvider({
    userId: providerUserId,
    name: 'Санжар Мастер',
    phone: '+7 701 555 1234',
    whatsapp: '+7 701 555 1234',
    city: 'Алматы',
    category: 'Сантехника',
    priceRange: '5 000 - 20 000 ₸',
    workingHours: '09:00 - 18:00',
    description: 'Мастер сантехник с опытом',
    verified: true,
  });

  const request = await localRepository.createRequest({
    customerId,
    customerName: 'Айгүл Клиент',
    customerPhone: '+7 777 123 4567',
    city: 'almaty',
    category: 'plumbing',
    service: 'Ремонт смесителя',
    description: 'Капает кран в ванной',
    urgency: 'normal',
    status: 'OPEN',
  });

  const offer = await localRepository.createOffer({
    requestId: request.id,
    providerId: provider.id,
    providerUserId: provider.userId || provider.id,
    providerName: provider.name,
    providerPhone: provider.phone,
    providerWhatsapp: provider.whatsapp,
    price: '10 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня, 1 час',
    status: 'PENDING',
  });

  await localRepository.acceptOffer(request.id, offer.id);

  const appt = await localRepository.createAppointment({
    requestId: request.id,
    customerId,
    providerId: provider.id,
    providerUserId: provider.userId || provider.id,
    proposedBy: 'customer',
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    status: 'CONFIRMED',
  });

  assert(appt.status === 'CONFIRMED', '2.1 Appointment created with CONFIRMED status');

  // 3. Test Unauthorized User Cannot Update Work Status
  console.log('\n[Test 3] Provider authorization guard');
  let authErrorCaught = false;
  try {
    // Attempt update by customer or an intruder
    await localRepository.updateWorkStatus(appt.id, 'PROVIDER_ON_THE_WAY', customerId);
  } catch (err: any) {
    authErrorCaught = true;
    assert(
      err.message.includes('Unauthorized') || err.message.includes('Only'),
      `3.1 Customer rejected from updating work status: ${err.message}`
    );
  }
  assert(authErrorCaught, '3.2 Non-provider access rejected');

  // 4. Test Sequential Work Status Progression
  console.log('\n[Test 4] Sequential progression by assigned provider');
  // 4.1 PROVIDER_ON_THE_WAY
  const step1 = await localRepository.updateWorkStatus(
    appt.id,
    'PROVIDER_ON_THE_WAY',
    providerUserId
  );
  assert(
    step1.workStatus === 'PROVIDER_ON_THE_WAY',
    '4.1 Status successfully updated to PROVIDER_ON_THE_WAY'
  );
  assert(!!step1.workStatusUpdatedAt, '4.1 workStatusUpdatedAt timestamp exists');

  // 4.2 Disallow skipping to WORK_COMPLETED from PROVIDER_ON_THE_WAY
  let skipErrorCaught = false;
  try {
    await localRepository.updateWorkStatus(appt.id, 'WORK_COMPLETED', providerUserId);
  } catch (err: any) {
    skipErrorCaught = true;
    assert(
      err.message.includes('Invalid work status transition'),
      `4.2 Skipping to WORK_COMPLETED rejected: ${err.message}`
    );
  }
  assert(skipErrorCaught, '4.2 Skipping intermediate steps throws validation error');

  // 4.3 PROVIDER_ARRIVED
  const step2 = await localRepository.updateWorkStatus(
    appt.id,
    'PROVIDER_ARRIVED',
    providerUserId
  );
  assert(
    step2.workStatus === 'PROVIDER_ARRIVED',
    '4.3 Status successfully updated to PROVIDER_ARRIVED'
  );

  // 4.4 WORK_STARTED
  const step3 = await localRepository.updateWorkStatus(
    appt.id,
    'WORK_STARTED',
    providerUserId
  );
  assert(
    step3.workStatus === 'WORK_STARTED',
    '4.4 Status successfully updated to WORK_STARTED'
  );

  // 4.5 Disallow going backwards to PROVIDER_ON_THE_WAY
  let backErrorCaught = false;
  try {
    await localRepository.updateWorkStatus(appt.id, 'PROVIDER_ON_THE_WAY', providerUserId);
  } catch (err: any) {
    backErrorCaught = true;
    assert(
      err.message.includes('Invalid work status transition'),
      `4.5 Backward transition rejected: ${err.message}`
    );
  }
  assert(backErrorCaught, '4.5 Backward transition blocked');

  // 4.6 WORK_COMPLETED
  const step4 = await localRepository.updateWorkStatus(
    appt.id,
    'WORK_COMPLETED',
    providerUserId
  );
  assert(
    step4.workStatus === 'WORK_COMPLETED',
    '4.6 Status successfully updated to WORK_COMPLETED'
  );
  assert(
    step4.status === 'COMPLETED',
    '4.6 Appointment status is also COMPLETED on WORK_COMPLETED'
  );

  // 4.7 Terminal check: cannot cancel or modify once WORK_COMPLETED
  let terminalErrorCaught = false;
  try {
    await localRepository.updateWorkStatus(appt.id, 'CANCELLED', providerUserId);
  } catch (err: any) {
    terminalErrorCaught = true;
    assert(
      err.message.includes('Invalid work status transition'),
      `4.7 Cancellation after WORK_COMPLETED rejected: ${err.message}`
    );
  }
  assert(terminalErrorCaught, '4.7 Completed state is strictly immutable/terminal');

  // 5. Test Customer Notification Dispatches
  console.log('\n[Test 5] Notification dispatches for customer');
  let notifCaught = false;
  try {
    await notificationService.notifyWorkStatusUpdated(
      request,
      step1,
      'PROVIDER_ON_THE_WAY'
    );
    await notificationService.notifyWorkStatusUpdated(
      request,
      step2,
      'PROVIDER_ARRIVED'
    );
    await notificationService.notifyWorkStatusUpdated(
      request,
      step3,
      'WORK_STARTED'
    );
    await notificationService.notifyWorkStatusUpdated(
      request,
      step4,
      'WORK_COMPLETED'
    );
    notifCaught = true;
  } catch (err: any) {
    console.error('Notification error:', err);
  }
  assert(notifCaught, '5.1 Customer notifications dispatched without errors');

  // Check notifications in localRepository
  const notifs = await localRepository.getNotifications(customerId);
  assert(
    notifs.length >= 4,
    `5.2 Customer received all status update notifications (count: ${notifs.length})`
  );
  const types = notifs.map((n) => n.type);
  assert(
    types.includes('CUSTOMER_PROVIDER_ON_THE_WAY'),
    '5.3 CUSTOMER_PROVIDER_ON_THE_WAY notification found'
  );
  assert(
    types.includes('CUSTOMER_PROVIDER_ARRIVED'),
    '5.4 CUSTOMER_PROVIDER_ARRIVED notification found'
  );
  assert(
    types.includes('CUSTOMER_WORK_STARTED'),
    '5.5 CUSTOMER_WORK_STARTED notification found'
  );
  assert(
    types.includes('CUSTOMER_WORK_COMPLETED'),
    '5.6 CUSTOMER_WORK_COMPLETED notification found'
  );

  // 6. Test Cancellation flow on a separate appointment
  console.log('\n[Test 6] Work status cancellation flow');
  const req2 = await localRepository.createRequest({
    customerId,
    customerName: 'Айгүл Клиент',
    customerPhone: '+7 777 123 4567',
    city: 'almaty',
    category: 'plumbing',
    service: 'Замена сифона',
    urgency: 'normal',
    status: 'OPEN',
  });
  const offer2 = await localRepository.createOffer({
    requestId: req2.id,
    providerId: provider.id,
    providerUserId: provider.userId || provider.id,
    providerName: provider.name,
    price: '8 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня',
    status: 'PENDING',
  });
  await localRepository.acceptOffer(req2.id, offer2.id);
  const appt2 = await localRepository.createAppointment({
    requestId: req2.id,
    customerId,
    providerId: provider.id,
    providerUserId: provider.userId || provider.id,
    proposedBy: 'customer',
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    status: 'CONFIRMED',
  });

  const cancelledAppt = await localRepository.updateWorkStatus(
    appt2.id,
    'CANCELLED',
    providerUserId
  );
  assert(
    cancelledAppt.workStatus === 'CANCELLED',
    '6.1 Appointment work status updated to CANCELLED'
  );

  let afterCancelError = false;
  try {
    await localRepository.updateWorkStatus(appt2.id, 'WORK_STARTED', providerUserId);
  } catch {
    afterCancelError = true;
  }
  assert(afterCancelError, '6.2 Further updates after CANCELLED are rejected');

  console.log('\n🎉 ALL WORK STATUS VERIFICATION TESTS PASSED SUCCESSFULLY! (100% PASS)\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
