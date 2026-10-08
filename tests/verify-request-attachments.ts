import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  ServiceRequest,
  RequestAttachment,
  RequestLocation,
  validateRequestAttachment,
  sanitizeFileName,
  REQUEST_LIMITS,
  normalizeRequestStatus,
} from '../src/types';
import { localRepository } from '../src/services/localRepository';
import { resilientRepository } from '../src/services/resilientRepository';

console.log('=== STARTING REQUEST 2.0 ATTACHMENTS & LOCATION VERIFICATION ===');

// Setup mock localStorage for Node.js test environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

async function runTests() {
  localStorage.clear();

  const customerId = 'cust_req2_test_1';
  const providerUserId = 'prov_req2_test_1';

  // -------------------------------------------------------------
  console.log('\n[TEST 1] Validation: Image Limits & MIME Formats');
  // -------------------------------------------------------------
  const validJpeg = validateRequestAttachment({
    name: 'broken_fridge.jpg',
    size: 2 * 1024 * 1024, // 2MB
    type: 'image/jpeg',
  });
  assert.strictEqual(validJpeg.isValid, true);
  assert.strictEqual(validJpeg.type, 'image');

  const validPng = validateRequestAttachment({
    name: 'washer_leak.png',
    size: 5 * 1024 * 1024, // 5MB
    type: 'image/png',
  });
  assert.strictEqual(validPng.isValid, true);

  const validWebp = validateRequestAttachment({
    name: 'heater.webp',
    size: 1 * 1024 * 1024,
    type: 'image/webp',
  });
  assert.strictEqual(validWebp.isValid, true);

  const oversizedImg = validateRequestAttachment({
    name: 'huge.jpg',
    size: 11 * 1024 * 1024, // 11MB > 10MB limit
    type: 'image/jpeg',
  });
  assert.strictEqual(oversizedImg.isValid, false);
  assert.strictEqual(oversizedImg.errorKey, 'reqFileTooLarge');

  console.log('✓ Test 1 Passed: Image format and 10MB limit validated');

  // -------------------------------------------------------------
  console.log('\n[TEST 2] Validation: Video Limits & MIME Formats');
  // -------------------------------------------------------------
  const validMp4 = validateRequestAttachment({
    name: 'machine_noise.mp4',
    size: 35 * 1024 * 1024, // 35MB
    type: 'video/mp4',
  });
  assert.strictEqual(validMp4.isValid, true);
  assert.strictEqual(validMp4.type, 'video');

  const validWebmVideo = validateRequestAttachment({
    name: 'smoke_test.webm',
    size: 10 * 1024 * 1024,
    type: 'video/webm',
  });
  assert.strictEqual(validWebmVideo.isValid, true);

  const oversizedVideo = validateRequestAttachment({
    name: 'huge_recording.mp4',
    size: 55 * 1024 * 1024, // 55MB > 50MB limit
    type: 'video/mp4',
  });
  assert.strictEqual(oversizedVideo.isValid, false);
  assert.strictEqual(oversizedVideo.errorKey, 'reqFileTooLarge');

  console.log('✓ Test 2 Passed: Video format and 50MB limit validated');

  // -------------------------------------------------------------
  console.log('\n[TEST 3] Validation: Audio Limits & MIME Formats');
  // -------------------------------------------------------------
  const validMp3Audio = validateRequestAttachment({
    name: 'voice_explanation.mp3',
    size: 5 * 1024 * 1024,
    type: 'audio/mpeg',
  });
  assert.strictEqual(validMp3Audio.isValid, true);
  assert.strictEqual(validMp3Audio.type, 'audio');

  const validWebmAudio = validateRequestAttachment({
    name: 'mic_record.webm',
    size: 1 * 1024 * 1024,
    type: 'audio/webm',
  });
  assert.strictEqual(validWebmAudio.isValid, true);

  const oversizedAudio = validateRequestAttachment({
    name: 'long_voice.wav',
    size: 25 * 1024 * 1024, // 25MB > 20MB limit
    type: 'audio/wav',
  });
  assert.strictEqual(oversizedAudio.isValid, false);
  assert.strictEqual(oversizedAudio.errorKey, 'reqFileTooLarge');

  console.log('✓ Test 3 Passed: Audio format and 20MB limit validated');

  // -------------------------------------------------------------
  console.log('\n[TEST 4] Security: Rejection of Executable and Script Files');
  // -------------------------------------------------------------
  const dangerousExe = validateRequestAttachment({
    name: 'malware.exe',
    size: 1024,
    type: 'application/x-msdownload',
  });
  assert.strictEqual(dangerousExe.isValid, false);

  const dangerousSh = validateRequestAttachment({
    name: 'script.sh',
    size: 512,
    type: 'application/x-sh',
  });
  assert.strictEqual(dangerousSh.isValid, false);

  const dangerousBat = validateRequestAttachment({
    name: 'run.bat',
    size: 200,
    type: 'text/plain',
  });
  assert.strictEqual(dangerousBat.isValid, false);

  console.log('✓ Test 4 Passed: Executable and dangerous script files rejected');

  // -------------------------------------------------------------
  console.log('\n[TEST 5] Security: Filename Sanitization');
  // -------------------------------------------------------------
  const dirty1 = '../../../etc/passwd.jpg';
  const clean1 = sanitizeFileName(dirty1);
  assert(!clean1.includes('/'));
  assert(!clean1.includes('\\'));
  assert(!clean1.includes('..'));

  const dirty2 = 'my photo <script>alert(1)</script>.png';
  const clean2 = sanitizeFileName(dirty2);
  assert(!clean2.includes('<'));
  assert(!clean2.includes('>'));

  console.log('✓ Test 5 Passed: Filename sanitization prevents traversal and script injection');

  // -------------------------------------------------------------
  console.log('\n[TEST 6] Repository: Uploading Request Attachments');
  // -------------------------------------------------------------
  const requestId = 'REQ-000001';

  // Upload an image attachment
  const uploadedImage = await localRepository.uploadRequestAttachment(
    requestId,
    {
      name: 'broken_valve.jpg',
      size: 1024 * 500,
      type: 'image/jpeg',
      data: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    },
    customerId
  );

  assert.strictEqual(uploadedImage.type, 'image');
  assert(uploadedImage.storagePath.startsWith(`requests/${requestId}/`));
  assert.strictEqual(uploadedImage.fileName, 'broken_valve.jpg');

  // Upload a video attachment
  const uploadedVideo = await localRepository.uploadRequestAttachment(
    requestId,
    {
      name: 'leak_demonstration.mp4',
      size: 1024 * 1024 * 8,
      type: 'video/mp4',
      data: 'data:video/mp4;base64,AAAA',
    },
    customerId
  );

  assert.strictEqual(uploadedVideo.type, 'video');
  assert(uploadedVideo.storagePath.startsWith(`requests/${requestId}/`));

  // Upload an audio attachment
  const uploadedAudio = await localRepository.uploadRequestAttachment(
    requestId,
    {
      name: 'customer_voice_note.webm',
      size: 1024 * 150,
      type: 'audio/webm',
      data: 'data:audio/webm;base64,GkXf',
    },
    customerId
  );

  assert.strictEqual(uploadedAudio.type, 'audio');
  assert(uploadedAudio.storagePath.startsWith(`requests/${requestId}/`));

  console.log('✓ Test 6 Passed: Images, videos, and audios uploaded with isolated storage paths');

  // -------------------------------------------------------------
  console.log('\n[TEST 7] Request 2.0: Multi-media & Geolocation Request Creation');
  // -------------------------------------------------------------
  const location: RequestLocation = {
    latitude: 44.84883,
    longitude: 65.50916,
    accuracy: 12,
    address: 'Қызылорда, Абай даңғылы, 45',
  };

  const newRequest = await localRepository.createRequest({
    id: requestId,
    customerId,
    customerName: 'Данияр М.',
    city: 'Қызылорда',
    category: 'Сантехника',
    service: 'Құбыр жөндеу',
    requestText: 'Ас үйдегі шүмек ағып жатыр, видео мен аудиодан көруге болады.',
    status: 'OPEN',
    attachments: [uploadedImage, uploadedVideo, uploadedAudio],
    location,
  });

  assert.strictEqual(newRequest.id, requestId);
  assert.strictEqual(newRequest.attachments?.length, 3);
  assert.deepStrictEqual(newRequest.location, location);
  assert.strictEqual(newRequest.attachments[0].type, 'image');
  assert.strictEqual(newRequest.attachments[1].type, 'video');
  assert.strictEqual(newRequest.attachments[2].type, 'audio');

  console.log('✓ Test 7 Passed: Request 2.0 created with image, video, audio, and geolocation');

  // -------------------------------------------------------------
  console.log('\n[TEST 8] Backward Compatibility: Legacy text-only requests');
  // -------------------------------------------------------------
  const legacyRequest = await localRepository.createRequest({
    id: 'REQ-LEGACY-001',
    customerId: 'cust_legacy',
    customerName: 'Ерлан С.',
    city: 'Астана',
    category: 'Электрика',
    service: 'Люстра орнату',
    requestText: 'Тек мәтін, ешқандай медиа жоқ.',
    status: 'OPEN',
  });

  assert.strictEqual(legacyRequest.id, 'REQ-LEGACY-001');
  assert.strictEqual(legacyRequest.attachments, undefined);
  assert.strictEqual(legacyRequest.location, undefined);

  // Retrieve via getRequest
  const fetchedLegacy = await localRepository.getRequest('REQ-LEGACY-001');
  assert(fetchedLegacy !== null);
  assert.strictEqual(fetchedLegacy.attachments, undefined);
  assert.strictEqual(fetchedLegacy.location, undefined);
  assert.strictEqual(normalizeRequestStatus(fetchedLegacy.status), 'OPEN');

  console.log('✓ Test 8 Passed: Legacy text-only requests function seamlessly without regression');

  // -------------------------------------------------------------
  console.log('\n[TEST 9] Provider Access: Viewing Attachments and Location');
  // -------------------------------------------------------------
  // Provider registers in same city & category
  const provider = await localRepository.createProvider({
    userId: providerUserId,
    name: 'Қанат Ұста',
    city: 'Қызылорда',
    category: 'Сантехника',
    phone: '+7 705 111 2233',
  });

  // Provider gets requests for their category/city
  const providerMatchingRequests = await localRepository.getRequests({
    cityId: provider.cityId,
    categoryId: provider.categoryId,
  });

  const matchingReq = providerMatchingRequests.find((r) => r.id === requestId);
  assert(matchingReq !== undefined, 'Provider should see matching request');
  assert.strictEqual(matchingReq.attachments?.length, 3);
  assert.strictEqual(matchingReq.location?.latitude, 44.84883);
  assert.strictEqual(matchingReq.location?.longitude, 65.50916);
  // Phone privacy check
  assert.strictEqual(matchingReq.customerPhone, undefined);

  console.log('✓ Test 9 Passed: Provider can view attachments and location with privacy preserved');

  // -------------------------------------------------------------
  console.log('\n[TEST 10] ResilientRepository: Request 2.0 Fallback and Sync');
  // -------------------------------------------------------------
  const resilientReq = await resilientRepository.getRequest(requestId);
  assert(resilientReq !== null);
  assert.strictEqual(resilientReq.attachments?.length, 3);
  assert.strictEqual(resilientReq.location?.latitude, 44.84883);

  // Upload attachment via resilient repository
  const resilientAttachment = await resilientRepository.uploadRequestAttachment(
    'REQ-000002',
    {
      name: 'test_photo.jpg',
      size: 1024 * 100,
      type: 'image/jpeg',
      data: 'data:image/jpeg;base64,/9j/4AAQ',
    },
    customerId
  );
  assert.strictEqual(resilientAttachment.type, 'image');
  assert(resilientAttachment.storagePath.startsWith('requests/REQ-000002/'));

  console.log('✓ Test 10 Passed: ResilientRepository supports attachments with fallback');

  // -------------------------------------------------------------
  console.log('\n[TEST 11] Storage Security Rules Audit');
  // -------------------------------------------------------------
  const storageRulesPath = path.resolve('storage.rules');
  assert(fs.existsSync(storageRulesPath), 'storage.rules must exist');
  const storageRulesContent = fs.readFileSync(storageRulesPath, 'utf8');

  // Verify request storage match
  assert(storageRulesContent.includes('match /requests/{requestId}/{fileName}'));
  // Verify image size limit 10MB
  assert(storageRulesContent.includes('10 * 1024 * 1024'));
  // Verify video size limit 50MB
  assert(storageRulesContent.includes('50 * 1024 * 1024'));
  // Verify audio size limit 20MB
  assert(storageRulesContent.includes('20 * 1024 * 1024'));
  // Verify executable restrictions
  assert(storageRulesContent.includes('!request.resource.contentType.matches(\'.*executable.*\')'));
  // Verify deletion is prohibited in MVP
  assert(storageRulesContent.includes('allow delete: if false;'));

  console.log('✓ Test 11 Passed: Storage Security Rules correctly configured');

  // -------------------------------------------------------------
  console.log('\n[TEST 12] Firestore Security Rules Audit');
  // -------------------------------------------------------------
  const firestoreRulesPath = path.resolve('firestore.rules');
  assert(fs.existsSync(firestoreRulesPath), 'firestore.rules must exist');
  const firestoreRulesContent = fs.readFileSync(firestoreRulesPath, 'utf8');

  // Check request authorization and provider read
  assert(firestoreRulesContent.includes('match /requests/{requestId}'));
  assert(
    firestoreRulesContent.includes('resource.data.customerId == request.auth.uid') ||
    firestoreRulesContent.includes('canAccessRequest(')
  );

  console.log('✓ Test 12 Passed: Firestore Security Rules confirmed');

  console.log('\n======================================================');
  console.log('ALL REQUEST 2.0 ATTACHMENT & LOCATION TESTS PASSED! 🎉');
  console.log('======================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
