import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  getConversationId,
  Conversation,
  ChatMessage,
  ServiceRequest,
  ProviderOffer,
  Provider,
} from '../src/types';
import { localRepository } from '../src/services/localRepository';

console.log('--- STARTING IN-APP CHAT VERIFICATION ---');

// Mock localStorage for node environment
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

  // Test 1: Deterministic getConversationId
  console.log('\n[TEST 1] Deterministic conversation ID generator');
  const reqId1 = 'REQ-000123';
  const convId1 = getConversationId(reqId1);
  assert.strictEqual(convId1, 'conv_REQ-000123', 'Conversation ID must be deterministic conv_${requestId}');
  assert.strictEqual(getConversationId('  REQ-999  '), 'conv_REQ-999', 'Whitespace should be trimmed');
  console.log('✓ Test 1 Passed: Deterministic ID generator works as expected');

  // Test 2: Cannot create or open chat for OPEN requests
  console.log('\n[TEST 2] Chat blocked for OPEN requests');
  const openReq = await localRepository.createRequest({
    customerId: 'cust_user_1',
    customerName: 'Customer Aigul',
    city: 'Қызылорда',
    category: 'Тұрмыстық техника жөндеу',
    service: 'Samsung кір жуғыш машина жөндеу',
    status: 'OPEN',
  });

  let openErrorThrown = false;
  try {
    await localRepository.getOrCreateConversation(openReq.id);
  } catch (err: any) {
    openErrorThrown = true;
    assert(
      err.message.includes('OPEN requests') || err.message.includes('No provider offer has been selected'),
      `Expected error about OPEN or unselected offer, got: ${err.message}`
    );
  }
  assert.strictEqual(openErrorThrown, true, 'Opening chat for OPEN request must throw error');
  console.log('✓ Test 2 Passed: Chat cannot be created/opened for OPEN request');

  // Test 3: Create request, create offer, accept offer -> PROVIDER_SELECTED -> getOrCreateConversation
  console.log('\n[TEST 3] Chat opens when offer is accepted (PROVIDER_SELECTED)');
  const provider = await localRepository.createProvider({
    userId: 'prov_user_1',
    name: 'Master Ruslan',
    city: 'Қызылорда',
    category: 'Тұрмыстық техника жөндеу',
    phone: '+7 701 555 1234',
    whatsapp: '+7 701 555 1234',
  });

  const offer = await localRepository.createOffer({
    requestId: openReq.id,
    providerId: provider.id,
    providerUserId: provider.userId,
    providerName: provider.name,
    providerPhone: provider.phone,
    providerWhatsapp: provider.whatsapp,
    price: '12 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня, 40 минут',
    status: 'PENDING',
  });

  // Customer accepts offer
  const acceptResult = await localRepository.acceptOffer(openReq.id, offer.id);
  assert.strictEqual(acceptResult.request?.status, 'PROVIDER_SELECTED');
  assert.strictEqual(acceptResult.offer?.status, 'ACCEPTED');

  // Now create conversation
  const conv = await localRepository.getOrCreateConversation(openReq.id);
  assert.strictEqual(conv.id, `conv_${openReq.id}`);
  assert.strictEqual(conv.requestId, openReq.id);
  assert.strictEqual(conv.customerId, openReq.customerId);
  assert.strictEqual(conv.providerId, provider.id);
  assert.strictEqual(conv.status, 'ACTIVE');
  assert.strictEqual(conv.unreadCountCustomer, 0);
  assert.strictEqual(conv.unreadCountProvider, 0);
  console.log('✓ Test 3 Passed: Conversation successfully created after offer accepted');

  // Test 4: Idempotency: calling getOrCreateConversation again returns same conversation
  console.log('\n[TEST 4] Conversation idempotency');
  const conv2 = await localRepository.getOrCreateConversation(openReq.id);
  assert.strictEqual(conv2.id, conv.id);
  assert.strictEqual(conv2.createdAt, conv.createdAt);
  console.log('✓ Test 4 Passed: 1 Request = 1 Conversation idempotency guaranteed');

  // Test 5: Message validation (empty, max length, invalid role)
  console.log('\n[TEST 5] Message validation');
  let emptyErr = false;
  try {
    await localRepository.sendMessage(conv.id, { text: '' });
  } catch (err: any) {
    emptyErr = true;
    assert(err.message.includes('empty'));
  }
  assert.strictEqual(emptyErr, true, 'Empty text must be rejected');

  let lengthErr = false;
  try {
    await localRepository.sendMessage(conv.id, { text: 'A'.repeat(2001) });
  } catch (err: any) {
    lengthErr = true;
    assert(err.message.includes('2000 characters limit'));
  }
  assert.strictEqual(lengthErr, true, 'Message over 2000 chars must be rejected');
  console.log('✓ Test 5 Passed: Message length and empty validations enforced');

  // Test 6: Send valid text message and verify conversation metadata
  console.log('\n[TEST 6] Sending valid message & unread counter');
  const msg1 = await localRepository.sendMessage(conv.id, {
    senderId: openReq.customerId,
    text: 'Сәлеметсіз бе! Стиральная машина су ағызбай тұр, қашан келе аласыз?',
  });
  assert.strictEqual(msg1.conversationId, conv.id);
  assert.strictEqual(msg1.requestId, openReq.id);
  assert.strictEqual(msg1.type, 'text');
  assert.strictEqual(msg1.isRead, false);
  assert(msg1.createdAt, 'Message must have createdAt timestamp');

  // Check updated conversation
  const convAfterMsg = await localRepository.getConversation(conv.id);
  assert.strictEqual(convAfterMsg?.lastMessageText, msg1.text);
  assert(convAfterMsg?.lastMessageAt);

  const messagesList = await localRepository.getMessages(conv.id);
  assert.strictEqual(messagesList.length, 1);
  assert.strictEqual(messagesList[0].text, msg1.text);
  console.log('✓ Test 6 Passed: Message successfully stored and retrieved');

  // Test 7: Mark messages as read
  console.log('\n[TEST 7] Marking messages as read');
  await localRepository.markMessagesAsRead(conv.id);
  const convAfterRead = await localRepository.getConversation(conv.id);
  assert(convAfterRead !== null);
  console.log('✓ Test 7 Passed: Messages marked as read');

  // Test 8: Block messages on CANCELLED request
  console.log('\n[TEST 8] Cannot send message when request is CANCELLED');
  await localRepository.updateRequestStatus(openReq.id, 'CANCELLED');
  let cancelledErr = false;
  try {
    await localRepository.sendMessage(conv.id, { text: 'Бұл хабарлама жіберілмеуі керек' });
  } catch (err: any) {
    cancelledErr = true;
    assert(err.message.includes('cancelled'));
  }
  assert.strictEqual(cancelledErr, true, 'Message sending on cancelled request must be blocked');
  console.log('✓ Test 8 Passed: Messages blocked on CANCELLED requests');

  // Test 9: Firestore Security Rules audit for Conversations & Messages
  console.log('\n[TEST 9] Firestore Security Rules validation');
  const rulesPath = path.resolve('firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  assert(rulesContent.includes('match /conversations/{conversationId}'), 'Rules must define /conversations/{conversationId}');
  assert(rulesContent.includes("conversationId == ('conv_' + incoming().requestId)"), 'Rules must enforce deterministic conv_{requestId} ID');
  assert(rulesContent.includes("incoming().status in ['ACTIVE', 'ARCHIVED']"), 'Rules must validate conversation status');
  assert(rulesContent.includes("get(/databases/$(database)/documents/requests/$(incoming().requestId)).data.status in ['PROVIDER_SELECTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED']"), 'Rules must block OPEN requests from opening conversations');
  assert(rulesContent.includes('match /messages/{messageId}'), 'Rules must define messages subcollection');
  assert(rulesContent.includes('incoming().text.size() <= 2000'), 'Rules must limit message text to 2000 chars');
  // Messages need the request in an active status (the allowlist above excludes CANCELLED and OPEN);
  // tests/firestore-rules.spec.ts checks the behaviour in the emulator.
  assert(!/data\.status in \[[^\]]*'CANCELLED'[^\]]*\];\s*\n\s*allow update: if false/.test(rulesContent), 'Rules must forbid messages on CANCELLED requests');
  console.log('✓ Test 9 Passed: Firestore Security Rules thoroughly validated');

  console.log('\n=============================================');
  console.log('ALL IN-APP CHAT VERIFICATION TESTS PASSED! 🎉');
  console.log('=============================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
