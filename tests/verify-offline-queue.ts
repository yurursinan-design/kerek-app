import { offlineQueueService } from '../src/services/offlineQueueService';
import { firebaseRepository } from '../src/services/firebaseRepository';
import { auth } from '../src/services/firebase';

async function runOfflineQueueVerificationTests() {
  console.log('=== STARTING PHASE 4: OFFLINE MUTATION QUEUE & SYNC TESTS ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? `: ${detail}` : ''}`);
      failed++;
    }
  }

  // Clear queue and local storage before tests
  offlineQueueService.clearQueue();

  // -------------------------------------------------------------
  // Test 1: Offline Enqueueing & Storage Persistence
  // -------------------------------------------------------------
  try {
    const mut = offlineQueueService.enqueueMutation(
      'createRequest',
      {
        id: 'REQ-TEST-OFFLINE-001',
        service: 'Ремонт стиральных машин',
        city: 'Қызылорда',
        category: 'Тұрмыстық техника жөндеу',
      },
      'test-auth-uid-123'
    );

    const queue = offlineQueueService.getQueue();
    const found = queue.find((m) => m.id === mut.id);

    assert(
      found !== undefined &&
        found.type === 'createRequest' &&
        found.authUid === 'test-auth-uid-123' &&
        found.status === 'PENDING' &&
        found.idempotencyKey === 'REQ-TEST-OFFLINE-001',
      'Test 1: Offline mutation enqueueing and persistence'
    );
  } catch (e: any) {
    assert(false, 'Test 1: Offline mutation enqueueing', e.message);
  }

  // -------------------------------------------------------------
  // Test 2: Ownership Validation (authUid Mismatch Protection)
  // -------------------------------------------------------------
  try {
    offlineQueueService.clearQueue();

    // Enqueue mutation belonging to user-A
    offlineQueueService.enqueueMutation(
      'updateRequestStatus',
      { requestId: 'REQ-999', status: 'COMPLETED' },
      'user-A-owner'
    );

    // Mock cloud available and online
    const origIsAvailable = firebaseRepository.isAvailable.bind(firebaseRepository);
    const origIsOnline = offlineQueueService.isOnline.bind(offlineQueueService);

    firebaseRepository.isAvailable = () => true;
    offlineQueueService.isOnline = () => true;

    // Simulate current logged-in user is user-B
    const origUser = auth?.currentUser;
    (auth as any).currentUser = { uid: 'user-B-other' };

    await offlineQueueService.processQueue();

    // The mutation should be SKIPPED because authUid mismatch (user-A vs user-B)
    const queueAfter = offlineQueueService.getQueue();
    assert(
      queueAfter.length === 1 && queueAfter[0].authUid === 'user-A-owner',
      'Test 2: Ownership validation prevents syncing mutations belonging to another authUid'
    );

    // Restore auth
    (auth as any).currentUser = origUser;
    firebaseRepository.isAvailable = origIsAvailable;
    offlineQueueService.isOnline = origIsOnline;
  } catch (e: any) {
    assert(false, 'Test 2: Ownership validation', e.message);
  }

  // -------------------------------------------------------------
  // Test 3: Stale Mutation Rejection (Work Status & Request Status)
  // -------------------------------------------------------------
  try {
    offlineQueueService.clearQueue();

    // Enqueue stale updateWorkStatus (target: PROVIDER_ON_THE_WAY)
    offlineQueueService.enqueueMutation(
      'updateWorkStatus',
      { appointmentId: 'appt-stale-1', workStatus: 'PROVIDER_ON_THE_WAY', providerUserId: 'prov-1' },
      'prov-1'
    );

    // Mock firebaseRepository.getAppointment returning WORK_COMPLETED (server progressed ahead)
    const origGetAppt = firebaseRepository.getAppointment.bind(firebaseRepository);
    firebaseRepository.getAppointment = async () =>
      ({
        id: 'appt-stale-1',
        requestId: 'REQ-1',
        workStatus: 'WORK_COMPLETED',
        status: 'COMPLETED',
      } as any);

    firebaseRepository.isAvailable = () => true;
    offlineQueueService.isOnline = () => true;

    (auth as any).currentUser = { uid: 'prov-1' };

    await offlineQueueService.processQueue();

    const queueAfter = offlineQueueService.getQueue();
    assert(
      queueAfter.length === 0,
      'Test 3: Stale mutation skipped and dropped cleanly when server state is already progressed'
    );

    firebaseRepository.getAppointment = origGetAppt;
  } catch (e: any) {
    assert(false, 'Test 3: Stale mutation rejection', e.message);
  }

  // -------------------------------------------------------------
  // Test 4: Transient Error Retry Backoff
  // -------------------------------------------------------------
  try {
    offlineQueueService.clearQueue();

    offlineQueueService.enqueueMutation(
      'updateRequest',
      { requestId: 'REQ-RETRY-1', updates: { budget: '20000₸' } },
      'test-retry-uid'
    );

    const origUpdateRequest = firebaseRepository.updateRequest.bind(firebaseRepository);
    firebaseRepository.updateRequest = async () => {
      throw new Error('Network timeout: Cloud Firestore unreachable');
    };

    firebaseRepository.isAvailable = () => true;
    offlineQueueService.isOnline = () => true;

    (auth as any).currentUser = { uid: 'test-retry-uid' };

    await offlineQueueService.processQueue();

    const queueAfter = offlineQueueService.getQueue();
    assert(
      queueAfter.length === 1 &&
        queueAfter[0].retryCount === 1 &&
        queueAfter[0].status === 'FAILED_RETRYABLE' &&
        typeof queueAfter[0].nextRetryAt === 'number',
      'Test 4: Transient network error increments retryCount, sets FAILED_RETRYABLE, and computes backoff'
    );

    firebaseRepository.updateRequest = origUpdateRequest;
  } catch (e: any) {
    assert(false, 'Test 4: Transient error retry backoff', e.message);
  }

  // -------------------------------------------------------------
  // Test 5: Fatal Error Quarantine
  // -------------------------------------------------------------
  try {
    offlineQueueService.clearQueue();

    // 1. Fatal item
    offlineQueueService.enqueueMutation(
      'createOffer',
      { requestId: 'REQ-FATAL', price: '10000₸' },
      'fatal-uid'
    );

    // 2. Success item
    offlineQueueService.enqueueMutation(
      'createOffer',
      { requestId: 'REQ-SUCCESS', price: '12000₸' },
      'fatal-uid'
    );

    const origCreateOffer = firebaseRepository.createOffer.bind(firebaseRepository);
    firebaseRepository.createOffer = async (offerData: any) => {
      if (offerData.requestId === 'REQ-FATAL') {
        throw new Error('Validation Error: Target request not found');
      }
      return { id: 'OFFER-OK', ...offerData } as any;
    };

    firebaseRepository.isAvailable = () => true;
    offlineQueueService.isOnline = () => true;

    (auth as any).currentUser = { uid: 'fatal-uid' };

    await offlineQueueService.processQueue();

    const queueAfter = offlineQueueService.getQueue();
    assert(
      queueAfter.length === 1 &&
        queueAfter[0].payload.requestId === 'REQ-FATAL' &&
        queueAfter[0].status === 'FAILED_FATAL',
      'Test 5: Fatal error quarantined as FAILED_FATAL without blocking valid queue processing'
    );

    firebaseRepository.createOffer = origCreateOffer;
  } catch (e: any) {
    assert(false, 'Test 5: Fatal error quarantine', e.message);
  }

  console.log(`\n=== VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runOfflineQueueVerificationTests().catch((e) => {
  console.error('Unhandled error in offline queue verification tests:', e);
  process.exit(1);
});
