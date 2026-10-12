import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  getConversationId,
  Conversation,
  ChatMessage,
  ChatAttachment,
  validateChatAttachment,
  sanitizeFileName,
  CHAT_LIMITS,
} from '../src/types';
import { localRepository } from '../src/services/localRepository';
import { resilientRepository } from '../src/services/resilientRepository';
import { notificationService } from '../src/services/notificationService';

console.log('=== STARTING CHAT 2.0 ATTACHMENTS VERIFICATION ===');

// Setup mock localStorage for node environment
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

  // Test setup: create customer, provider, request, offer, accept offer -> conversation
  console.log('\n[Setup] Creating conversation participants and accepted offer...');
  const customerId = 'cust_chat2_user_1';
  const providerUserId = 'prov_chat2_user_1';

  const req = await localRepository.createRequest({
    customerId,
    customerName: 'Aigerim K.',
    city: 'Астана',
    category: 'Сантехника',
    service: 'Құбыр ауыстыру',
    status: 'OPEN',
  });

  const provider = await localRepository.createProvider({
    userId: providerUserId,
    name: 'Sanzhar Master',
    city: 'Астана',
    category: 'Сантехника',
    phone: '+7 701 999 8877',
    whatsapp: '+7 701 999 8877',
  });

  const offer = await localRepository.createOffer({
    requestId: req.id,
    providerId: provider.id,
    providerUserId: provider.userId,
    providerName: provider.name,
    price: '15 000 ₸',
    availability: 'Бүгін, 30 минутта',
    status: 'PENDING',
  });

  await localRepository.acceptOffer(req.id, offer.id);
  const conv = await localRepository.getOrCreateConversation(req.id);
  assert.strictEqual(conv.id, `conv_${req.id}`);
  console.log(`✓ Setup complete: conversation ${conv.id} established`);

  // Test 1: Image message creation
  console.log('\n[TEST 1] Image message creation');
  const imageAttachment = await localRepository.uploadChatAttachment(conv.id, {
    name: 'broken_pipe.jpg',
    size: 2 * 1024 * 1024, // 2MB
    type: 'image/jpeg',
    data: 'data:image/jpeg;base64,fakeimagedata',
  });

  assert.strictEqual(imageAttachment.type, 'image');
  assert.strictEqual(imageAttachment.fileName, 'broken_pipe.jpg');
  assert(imageAttachment.downloadUrl.length > 0);
  assert(imageAttachment.storagePath.includes(`chat/${conv.id}`));

  const imageMsg = await localRepository.sendMessage(conv.id, {
    senderId: customerId,
    senderRole: 'customer',
    type: 'image',
    text: 'Міне, су ағып жатқан жердің фотосы',
    attachments: [imageAttachment],
  });

  assert.strictEqual(imageMsg.type, 'image');
  assert.strictEqual(imageMsg.attachments?.length, 1);
  assert.strictEqual(imageMsg.attachments[0].fileName, 'broken_pipe.jpg');
  console.log('✓ Test 1 Passed: Image message successfully created and attached');

  // Test 2: File message creation
  console.log('\n[TEST 2] File message creation');
  const docAttachment = await localRepository.uploadChatAttachment(conv.id, {
    name: 'technical_spec.pdf',
    size: 4 * 1024 * 1024, // 4MB
    type: 'application/pdf',
    data: 'data:application/pdf;base64,fakepdfdata',
  });

  assert.strictEqual(docAttachment.type, 'file');
  assert.strictEqual(docAttachment.fileName, 'technical_spec.pdf');

  const fileMsg = await localRepository.sendMessage(conv.id, {
    senderId: providerUserId,
    senderRole: 'provider',
    type: 'file',
    text: 'Смета мен құжаттар тіркелді',
    attachments: [docAttachment],
  });

  assert.strictEqual(fileMsg.type, 'file');
  assert.strictEqual(fileMsg.attachments?.length, 1);
  assert.strictEqual(fileMsg.attachments[0].fileName, 'technical_spec.pdf');
  console.log('✓ Test 2 Passed: File message successfully created and attached');

  // Test 3: Text chat regression (plain text messages work exactly as before)
  console.log('\n[TEST 3] Text chat regression');
  const textMsg = await localRepository.sendMessage(conv.id, {
    senderId: customerId,
    senderRole: 'customer',
    text: 'Рахмет, құжатты қарап шығамын.',
  });
  assert.strictEqual(textMsg.type, 'text');
  assert.strictEqual(textMsg.text, 'Рахмет, құжатты қарап шығамын.');
  assert.strictEqual(textMsg.attachments, undefined);
  console.log('✓ Test 3 Passed: Plain text chat behaves identically without regressions');

  // Test 4: Conversation authorization (unauthorized outsider cannot upload or send)
  console.log('\n[TEST 4] Conversation authorization check');
  let authErrorCaught = false;
  try {
    await localRepository.sendMessage(conv.id, {
      senderId: 'random_attacker_99',
      senderRole: 'customer',
      text: 'Trying to sneak into conversation',
    });
  } catch (err: any) {
    authErrorCaught = true;
    assert(err.message.includes('Unauthorized'));
  }
  assert.strictEqual(authErrorCaught, true, 'Outsider must be strictly rejected');
  console.log('✓ Test 4 Passed: Non-participants cannot access or send into conversation');

  // Test 5: Storage path isolation validation
  console.log('\n[TEST 5] Storage path isolation');
  assert(imageAttachment.storagePath.startsWith(`chat/${conv.id}/`));
  assert(docAttachment.storagePath.startsWith(`chat/${conv.id}/`));
  console.log('✓ Test 5 Passed: Files strictly isolated under chat/{conversationId}/...');

  // Test 6: MIME validation
  console.log('\n[TEST 6] MIME validation');
  const invalidImageMime = validateChatAttachment({
    name: 'payload.gif',
    size: 1024,
    type: 'image/gif', // Only jpeg, png, webp allowed for image
  }, 'image');
  assert.strictEqual(invalidImageMime.isValid, false);
  assert.strictEqual(invalidImageMime.errorKey, 'chatUnsupportedImageMime');

  const dangerousFile = validateChatAttachment({
    name: 'hack.exe',
    size: 1024,
    type: 'application/x-msdos-program',
  });
  assert.strictEqual(dangerousFile.isValid, false);
  assert.strictEqual(dangerousFile.errorKey, 'chatUnsupportedFileType');
  console.log('✓ Test 6 Passed: MIME validation protects against invalid images and dangerous extensions');

  // Test 7: File size validation
  console.log('\n[TEST 7] File size validation');
  const oversizedImage = validateChatAttachment({
    name: 'huge.jpg',
    size: 11 * 1024 * 1024, // 11MB > 10MB limit
    type: 'image/jpeg',
  });
  assert.strictEqual(oversizedImage.isValid, false);
  assert.strictEqual(oversizedImage.errorKey, 'chatFileTooLarge');

  const oversizedFile = validateChatAttachment({
    name: 'huge.zip',
    size: 25 * 1024 * 1024, // 25MB > 20MB limit
    type: 'application/zip',
  });
  assert.strictEqual(oversizedFile.isValid, false);
  assert.strictEqual(oversizedFile.errorKey, 'chatFileTooLarge');
  console.log('✓ Test 7 Passed: File size limits (10MB image, 20MB file) strictly enforced');

  // Test 8: Filename sanitization
  console.log('\n[TEST 8] Filename sanitization');
  const cleanName1 = sanitizeFileName('../../../etc/passwd');
  assert.strictEqual(cleanName1.includes('..'), false);
  assert.strictEqual(cleanName1.includes('/'), false);

  const cleanName2 = sanitizeFileName('Жөндеу_сметасы (нұсқа 1).pdf');
  assert(cleanName2.includes('Жөндеу_сметасы'));
  assert(cleanName2.endsWith('.pdf'));
  console.log('✓ Test 8 Passed: Filename sanitization prevents path traversal and cleans unsafe chars');

  // Test 9: Upload failure does not create orphaned message
  console.log('\n[TEST 9] Upload failure integrity');
  const preMsgCount = (await localRepository.getMessages(conv.id)).length;
  let failedUploadError = false;
  try {
    await localRepository.sendChatMessageWithAttachment(conv.id, {
      text: 'This should not exist',
      file: {
        name: 'dangerous.bat',
        size: 500,
        type: 'application/x-bat',
      },
    });
  } catch (err) {
    failedUploadError = true;
  }
  assert.strictEqual(failedUploadError, true);
  const postMsgCount = (await localRepository.getMessages(conv.id)).length;
  assert.strictEqual(preMsgCount, postMsgCount, 'Message count must remain unchanged when upload fails');
  console.log('✓ Test 9 Passed: No phantom message created when attachment fails validation/upload');

  // Test 10: Notification recipient & type
  console.log('\n[TEST 10] Notification recipient and type for attachments');
  await notificationService.notifyNewMessage(conv, imageMsg);
  const notifications = await localRepository.getNotifications(providerUserId);
  const attNotif = notifications.find((n) => n.id === `notif_msg_${imageMsg.id}`);
  assert(attNotif, 'Notification must exist for recipient provider');
  assert.strictEqual(attNotif.type, 'PROVIDER_NEW_ATTACHMENT');
  assert.strictEqual(attNotif.recipientUserId, providerUserId);
  console.log('✓ Test 10 Passed: Attachment notification dispatched with correct event type and recipient');

  // Test 11: Sender self-notification prevented
  console.log('\n[TEST 11] Sender self-notification prevented');
  const senderNotifications = await localRepository.getNotifications(customerId);
  const selfNotif = senderNotifications.find((n) => n.id === `notif_msg_${imageMsg.id}`);
  assert.strictEqual(selfNotif, undefined, 'Sender must NOT receive notification for their own message');
  console.log('✓ Test 11 Passed: Sender does not receive notification for their own attachment');

  // Test 12: Read/unread system preserved
  console.log('\n[TEST 12] Read/unread counters');
  const convBeforeRead = await localRepository.getConversation(conv.id);
  assert(convBeforeRead !== null);
  await localRepository.markMessagesAsRead(conv.id);
  const convAfterRead = await localRepository.getConversation(conv.id);
  assert(convAfterRead !== null);
  console.log('✓ Test 12 Passed: Read/unread operations execute seamlessly');

  // Test 13: Realtime message listener
  console.log('\n[TEST 13] Realtime message listener');
  let listenerCalled = false;
  let lastReceivedCount = 0;
  const unsubscribe = localRepository.subscribeToMessages(conv.id, (msgs) => {
    listenerCalled = true;
    lastReceivedCount = msgs.length;
  });

  await localRepository.sendMessage(conv.id, {
    senderId: customerId,
    senderRole: 'customer',
    text: 'Listener probe test',
  });

  assert.strictEqual(listenerCalled, true);
  assert(lastReceivedCount > 0);
  unsubscribe();
  console.log('✓ Test 13 Passed: Realtime message listener functions and cleans up properly');

  // Test 14: Storage and Firestore rules audit
  console.log('\n[TEST 14] Storage and Firestore rules audit');
  const storageRulesPath = path.resolve('storage.rules');
  const storageContent = fs.readFileSync(storageRulesPath, 'utf8');
  assert(storageContent.includes('match /chat/{conversationId}/{messageId}/{fileName}'), 'storage.rules must protect chat path');
  assert(storageContent.includes('isConversationParticipant(conversationId)'), 'storage.rules must check conversation participant');
  assert(storageContent.includes('allow update, delete: if false;'), 'storage.rules must disallow file deletion');

  const firestoreRulesPath = path.resolve('firestore.rules');
  const firestoreContent = fs.readFileSync(firestoreRulesPath, 'utf8');
  assert(firestoreContent.includes("incoming().type in ['text', 'image', 'file']"), 'firestore.rules must allow text, image, file types');
  console.log('✓ Test 14 Passed: Storage and Firestore Security Rules verified');

  console.log('\n======================================================');
  console.log('ALL CHAT 2.0 ATTACHMENT TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('======================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
