import {
  analyzeRequestUnderstanding,
  understandingToExtractedNeed,
  validateAndSanitizeRequestUnderstanding,
  LocalRequestUnderstandingProvider,
  GeminiRequestUnderstandingProvider,
  defaultRequestUnderstandingProvider,
  RequestUnderstandingContext,
} from '../src/services/requestUnderstanding';
import {
  normalizeCategoryId,
  normalizeCityId,
  getCategoryDisplayName,
  getCityDisplayName,
} from '../src/services/taxonomy';
import { LocalRepository, setCurrentUserId } from '../src/services/localRepository';
import { matchProviders } from '../src/services/matchingService';
import {
  ExtractedNeed,
  PendingAttachment,
  RequestAttachment,
  RequestLocation,
  RequestUnderstanding,
  ServiceRequest,
} from '../src/types';

// Mock localStorage for node test runner
const storage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => {
    storage[k] = v;
  },
  removeItem: (k: string) => {
    delete storage[k];
  },
  clear: () => {
    for (const k in storage) delete storage[k];
  },
};

let passCount = 0;
let failCount = 0;

function assert(desc: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${desc}`);
    passCount++;
  } else {
    console.error(`  ✗ [FAIL] ${desc} ${details ? `-> ${details}` : ''}`);
    failCount++;
    process.exitCode = 1;
  }
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🤖 AI REQUEST UNDERSTANDING 2.0 & SYSTEM REGRESSION TEST SUITE');
  console.log('================================================================\n');

  const repo = new LocalRepository();

  // -------------------------------------------------------------
  // TEST 1: Kazakh washing machine request
  // -------------------------------------------------------------
  console.log('[TEST 1] Kazakh washing machine request');
  const kzQuery = 'Қызылордада бүгін кір жуғыш машина жөндейтін адам керек, Samsung су ағызбай тұр';
  const kzUnderstanding = analyzeRequestUnderstanding(kzQuery, { language: 'kz' });
  assert('City canonicalized to kyzylorda', kzUnderstanding.cityId === 'kyzylorda');
  assert('Category is appliance_repair or appliances', kzUnderstanding.categoryId === 'appliance_repair' || kzUnderstanding.categoryId === 'appliances');
  assert('Detected brand is Samsung', kzUnderstanding.detectedBrand === 'Samsung');
  assert('Detected problem is water not draining', Boolean(kzUnderstanding.detectedProblem && kzUnderstanding.detectedProblem.includes('ағызбай')));
  assert('Preferred date is Бүгін', kzUnderstanding.preferredDate === 'Бүгін');
  assert('Urgency is high or normal', kzUnderstanding.urgency === 'high');

  // -------------------------------------------------------------
  // TEST 2: Russian washing machine request
  // -------------------------------------------------------------
  console.log('\n[TEST 2] Russian washing machine request');
  const ruQuery = 'В Кызылорде сегодня нужен мастер по ремонту стиральной машины Samsung, не сливает воду';
  const ruUnderstanding = analyzeRequestUnderstanding(ruQuery, { language: 'ru' });
  assert('City canonicalized to kyzylorda', ruUnderstanding.cityId === 'kyzylorda');
  assert('Category is appliance_repair or appliances', ruUnderstanding.categoryId === 'appliance_repair' || ruUnderstanding.categoryId === 'appliances');
  assert('Detected brand is Samsung', ruUnderstanding.detectedBrand === 'Samsung');
  assert('Detected problem is water not draining (RU)', Boolean(ruUnderstanding.detectedProblem && ruUnderstanding.detectedProblem.includes('сливает')));
  assert('Preferred date is Сегодня', ruUnderstanding.preferredDate === 'Сегодня');
  assert('Urgency is high', ruUnderstanding.urgency === 'high');

  // -------------------------------------------------------------
  // TEST 3: English request
  // -------------------------------------------------------------
  console.log('\n[TEST 3] English request');
  const enQuery = 'Samsung washing machine water not draining in Kyzylorda, urgent today';
  const enUnderstanding = analyzeRequestUnderstanding(enQuery, { language: 'ru' });
  assert('City canonicalized to kyzylorda', enUnderstanding.cityId === 'kyzylorda');
  assert('Category is appliance_repair or appliances', enUnderstanding.categoryId === 'appliance_repair' || enUnderstanding.categoryId === 'appliances');
  assert('Detected brand is Samsung', enUnderstanding.detectedBrand === 'Samsung');
  assert('Urgency is high', enUnderstanding.urgency === 'high');
  assert('Preferred date is Today', enUnderstanding.preferredDate === 'Today');

  // -------------------------------------------------------------
  // TEST 4: City canonicalization
  // -------------------------------------------------------------
  console.log('\n[TEST 4] City canonicalization');
  const cityTests: { text: string; expected: string }[] = [
    { text: 'Қызылорда қаласы кір жуғыш жөндеу', expected: 'kyzylorda' },
    { text: 'в Кызылорде нужен мастер', expected: 'kyzylorda' },
    { text: 'г. Кызылорда сантехник', expected: 'kyzylorda' },
    { text: 'Kyzylorda electrician', expected: 'kyzylorda' },
    { text: 'в Астане сломалась машина', expected: 'astana' },
    { text: 'Астанада пәтер тазалау', expected: 'astana' },
    { text: 'в Алматы ремонт айфона', expected: 'almaty' },
    { text: 'Шымкентте жүк тасу', expected: 'shymkent' },
    { text: 'в Караганде забилась труба', expected: 'karaganda' },
  ];
  cityTests.forEach(({ text, expected }) => {
    const res = analyzeRequestUnderstanding(text);
    assert(`"${text}" -> ${expected}`, res.cityId === expected, `Got: ${res.cityId}`);
  });

  // -------------------------------------------------------------
  // TEST 5: Category canonicalization
  // -------------------------------------------------------------
  console.log('\n[TEST 5] Category canonicalization');
  const catTests: { text: string; expected: string; legacyAlias?: string }[] = [
    { text: 'Samsung кір жуғыш машина', expected: 'appliances', legacyAlias: 'appliance_repair' },
    { text: 'стиральная машина не работает', expected: 'appliances', legacyAlias: 'appliance_repair' },
    { text: 'washing machine repair', expected: 'appliances', legacyAlias: 'appliance_repair' },
    { text: 'çamaşır makinesi su akıtıyor', expected: 'appliances', legacyAlias: 'appliance_repair' },
    { text: 'сантехник нужен кран течет', expected: 'plumbing', legacyAlias: 'home_services' },
    { text: 'труба бітеліп қалды сантехника', expected: 'plumbing', legacyAlias: 'home_services' },
    { text: 'plumber to fix leaking pipe', expected: 'plumbing', legacyAlias: 'home_services' },
    { text: 'газель жүк тасу переезд', expected: 'cleaning_moving', legacyAlias: 'cargo_moving' },
    { text: 'көшіру қызметі грузчик', expected: 'cleaning_moving', legacyAlias: 'cargo_moving' },
    { text: 'iPhone 15 экран сынды дисплей', expected: 'appliances', legacyAlias: 'electronics' },
    { text: 'телефон жөндеу смартфон', expected: 'appliances', legacyAlias: 'electronics' },
    { text: 'пәтер тазалау клининг уборка', expected: 'cleaning_moving', legacyAlias: 'cleaning' },
    { text: 'эвакуатор машина бұзылды дөңгелек', expected: 'other', legacyAlias: 'auto' },
  ];
  catTests.forEach(({ text, expected, legacyAlias }) => {
    const res = analyzeRequestUnderstanding(text);
    assert(
      `"${text}" -> ${expected}`,
      res.categoryId === expected || (Boolean(legacyAlias) && res.categoryId === legacyAlias),
      `Got: ${res.categoryId}`
    );
  });

  // -------------------------------------------------------------
  // TEST 6: Brand detection
  // -------------------------------------------------------------
  console.log('\n[TEST 6] Brand detection');
  assert('Detects Samsung', analyzeRequestUnderstanding('Samsung кір жуғыш').detectedBrand === 'Samsung');
  assert('Detects Bosch', analyzeRequestUnderstanding('Bosch стиралка').detectedBrand === 'Bosch');
  assert('Detects LG', analyzeRequestUnderstanding('LG тоңазытқыш').detectedBrand === 'LG');
  assert('Detects Apple', analyzeRequestUnderstanding('Apple айфон 15').detectedBrand === 'Apple');
  assert('Detects Toyota', analyzeRequestUnderstanding('Toyota Camry жөндеу').detectedBrand === 'Toyota');
  assert('Detects Xiaomi', analyzeRequestUnderstanding('Xiaomi редми телефон').detectedBrand === 'Xiaomi');
  assert('Detects Gazelle', analyzeRequestUnderstanding('Газель керек жүк тасу').detectedBrand === 'Gazelle');
  assert('Does NOT hallucinate brand when absent', analyzeRequestUnderstanding('кір жуғыш машина жөндеу').detectedBrand === undefined);

  // -------------------------------------------------------------
  // TEST 7: Model detection
  // -------------------------------------------------------------
  console.log('\n[TEST 7] Model detection');
  const m1 = analyzeRequestUnderstanding('iPhone 15 экран сынды');
  assert('Detects iPhone 15', m1.detectedBrand === 'Apple' && m1.detectedModel === 'iPhone 15');
  const m2 = analyzeRequestUnderstanding('Toyota Camry 70 жөндеу');
  assert('Detects Camry 70', m2.detectedBrand === 'Toyota' && m2.detectedModel === 'Camry 70');
  const m3 = analyzeRequestUnderstanding('Samsung Galaxy S24 экран');
  assert('Detects Galaxy S24', m3.detectedBrand === 'Samsung' && m3.detectedModel === 'Galaxy S24');
  const m4 = analyzeRequestUnderstanding('Газель NEXT көшу');
  assert('Detects NEXT for Gazelle', m4.detectedBrand === 'Gazelle' && m4.detectedModel === 'NEXT');

  // -------------------------------------------------------------
  // TEST 8: Problem detection
  // -------------------------------------------------------------
  console.log('\n[TEST 8] Problem detection');
  const p1 = analyzeRequestUnderstanding('Samsung кір жуғыш су ағызбай тұр', { language: 'kz' });
  assert('Detects water not draining (KZ)', Boolean(p1.detectedProblem && p1.detectedProblem.includes('Су ағызбай')));
  const p2 = analyzeRequestUnderstanding('стиралка garip ses шумит', { language: 'ru' });
  assert('Detects noise problem (RU)', Boolean(p2.detectedProblem && p2.detectedProblem.includes('шум')));
  const p3 = analyzeRequestUnderstanding('iPhone 15 ekranı kırıldı экран сынған');
  assert('Detects broken screen', Boolean(p3.detectedProblem && p3.detectedProblem.includes('Экран')));
  const p4 = analyzeRequestUnderstanding('кран течет су ағып жатыр');
  assert('Detects water leak', Boolean(p4.detectedProblem && (p4.detectedProblem.includes('ағып') || p4.detectedProblem.includes('течет'))));

  // -------------------------------------------------------------
  // TEST 9: Urgency detection
  // -------------------------------------------------------------
  console.log('\n[TEST 9] Urgency detection');
  const uEmergency = analyzeRequestUnderstanding('Авария су басып жатыр құбыр жарылды');
  assert('Emergency detected for flooding/accident', uEmergency.urgency === 'emergency');
  const uHigh1 = analyzeRequestUnderstanding('Шұғыл кір жуғыш шебері керек');
  assert('High detected for шұғыл/срочно', uHigh1.urgency === 'high');
  const uHigh2 = analyzeRequestUnderstanding('Samsung кір жуғыш бүгін керек');
  assert('"бүгін керек" is high, NOT emergency', uHigh2.urgency === 'high');
  const uHigh3 = analyzeRequestUnderstanding('Samsung çamaşır makinesi bugün lazım');
  assert('"bugün lazım" is high, NOT emergency', uHigh3.urgency === 'high');
  const uLow = analyzeRequestUnderstanding('кір жуғыш жөндеу келесі аптада не к спеху');
  assert('Low detected for non-urgent keywords', uLow.urgency === 'low');
  const uNormal = analyzeRequestUnderstanding('кір жуғыш машинасын тазалау');
  assert('Default urgency is normal', uNormal.urgency === 'normal');

  // -------------------------------------------------------------
  // TEST 10: Relative date detection
  // -------------------------------------------------------------
  console.log('\n[TEST 10] Relative date detection');
  assert('Detects Бүгін (KZ)', analyzeRequestUnderstanding('бүгін керек', { language: 'kz' }).preferredDate === 'Бүгін');
  assert('Detects Сегодня (RU)', analyzeRequestUnderstanding('сегодня нужен мастер', { language: 'ru' }).preferredDate === 'Сегодня');
  assert('Detects Ертең (KZ)', analyzeRequestUnderstanding('ертең кешке', { language: 'kz' }).preferredDate === 'Ертең');
  assert('Detects Завтра (RU)', analyzeRequestUnderstanding('завтра утром', { language: 'ru' }).preferredDate === 'Завтра');
  assert('Detects Weekend (EN)', analyzeRequestUnderstanding('on the weekend', { language: 'ru' }).preferredDate === 'Weekend');

  // -------------------------------------------------------------
  // TEST 11: Time detection
  // -------------------------------------------------------------
  console.log('\n[TEST 11] Time detection');
  assert('Detects 18:00', analyzeRequestUnderstanding('сағат 18:00-де келсін').preferredTime === '18:00');
  assert('Detects 19:30', analyzeRequestUnderstanding('в 19:30 мастер пусть приедет').preferredTime === '19:30');
  assert('Detects akşam 7 as 19:00', analyzeRequestUnderstanding('akşam 7 gibi usta lazım').preferredTime === '19:00');
  assert('Detects кешкі 8 as 20:00', analyzeRequestUnderstanding('кешкі 8 келіңіз').preferredTime === '20:00');
  assert('No time hallucinated when none present', analyzeRequestUnderstanding('кір жуғыш жөндейтін адам').preferredTime === undefined);

  // -------------------------------------------------------------
  // TEST 12: Missing information
  // -------------------------------------------------------------
  console.log('\n[TEST 12] Missing information');
  const vague = analyzeRequestUnderstanding('телефон бұзылды', { language: 'kz' });
  assert('Vague phone query identifies missing brand/model', vague.missingInformation.length > 0);
  const detailed = analyzeRequestUnderstanding('iPhone 15 экран сынды', { language: 'kz' });
  assert('Specific iPhone 15 query has NO missing information', detailed.missingInformation.length === 0);

  // -------------------------------------------------------------
  // TEST 13: clarificationNeeded
  // -------------------------------------------------------------
  console.log('\n[TEST 13] clarificationNeeded');
  assert('clarificationNeeded is true for vague query', analyzeRequestUnderstanding('телефон бұзылды').clarificationNeeded === true);
  assert('clarificationNeeded is false for specific request', analyzeRequestUnderstanding('iPhone 15 экран сынды су ағызбай тұр').clarificationNeeded === false);

  // -------------------------------------------------------------
  // TEST 14: Attachment metadata
  // -------------------------------------------------------------
  console.log('\n[TEST 14] Attachment metadata awareness');
  const attachCtx: RequestUnderstandingContext = {
    language: 'kz',
    attachmentsPresent: { images: 3, videos: 1, audios: 1 },
    hasLocation: true,
  };
  const attachRes = analyzeRequestUnderstanding('кір жуғыш жөндеу', attachCtx);
  assert('Images count is 3', attachRes.attachmentsPresent.images === 3);
  assert('Videos count is 1', attachRes.attachmentsPresent.videos === 1);
  assert('Audios count is 1', attachRes.attachmentsPresent.audios === 1);
  assert('Does not hallucinate seeing image contents', !attachRes.description.includes('көрініп тұр'));

  // -------------------------------------------------------------
  // TEST 15: Location metadata
  // -------------------------------------------------------------
  console.log('\n[TEST 15] Location metadata');
  const withLoc = analyzeRequestUnderstanding('сантехник керек', {
    language: 'kz',
    hasLocation: true,
    location: { latitude: 44.8488, longitude: 65.4823, address: 'Байтурсынова 12' },
  });
  assert('hasLocation is true when location provided', withLoc.hasLocation === true);
  const withoutLoc = analyzeRequestUnderstanding('сантехник керек', { language: 'kz' });
  assert('hasLocation is false when location absent', withoutLoc.hasLocation === false);

  // -------------------------------------------------------------
  // TEST 16: Confidence validation
  // -------------------------------------------------------------
  console.log('\n[TEST 16] Confidence validation');
  const highConf = analyzeRequestUnderstanding('Қызылордада Samsung кір жуғыш машина су ағызбай тұр');
  assert('Detailed query gives confidence >= 0.85', highConf.confidence >= 0.85, `Got: ${highConf.confidence}`);
  const shortConf = analyzeRequestUnderstanding('жөндеу');
  assert('Short ambiguous query gives lower confidence', shortConf.confidence <= 0.65, `Got: ${shortConf.confidence}`);

  // -------------------------------------------------------------
  // TEST 17: Empty / short request safety
  // -------------------------------------------------------------
  console.log('\n[TEST 17] Empty / short request safety');
  const emptyRes = analyzeRequestUnderstanding('');
  assert('Empty query does not throw and has valid defaults', Boolean(emptyRes && emptyRes.cityId && emptyRes.categoryId));
  const oneWordRes = analyzeRequestUnderstanding('керек');
  assert('One word query handled safely', Boolean(oneWordRes && oneWordRes.cityId));

  // -------------------------------------------------------------
  // TEST 18: Existing request parser regression
  // -------------------------------------------------------------
  console.log('\n[TEST 18] Existing request parser regression');
  const need = understandingToExtractedNeed(kzUnderstanding, kzQuery, 'kz');
  assert('ExtractedNeed has city', Boolean(need.city));
  assert('ExtractedNeed has cityId kyzylorda', need.cityId === 'kyzylorda');
  assert('ExtractedNeed has categoryId appliance_repair or appliances', need.categoryId === 'appliance_repair' || need.categoryId === 'appliances');
  // The local rules engine must not claim to be Gemini; App sets isAiParsed only when the AI answered
  assert('Local ExtractedNeed is not labelled as AI-parsed', need.isAiParsed === false);
  assert('ExtractedNeed preserves original query', need.originalQuery === kzQuery);
  assert('ExtractedNeed contains understanding object', Boolean(need.understanding));

  // -------------------------------------------------------------
  // TEST 19: Request 2.0 regression
  // -------------------------------------------------------------
  console.log('\n[TEST 19] Request 2.0 regression');
  const dummyAttachment: RequestAttachment = {
    id: 'att-1',
    type: 'image',
    storagePath: 'requests/REQ-000001/att-1_photo.jpg',
    downloadUrl: 'https://storage.googleapis.com/test.jpg',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    createdAt: new Date().toISOString(),
  };
  const createdReq = await repo.createRequest({
    customerId: 'cust-101',
    requestText: kzQuery,
    description: kzQuery,
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    category: 'Тұрмыстық техника жөндеу',
    categoryId: 'appliance_repair',
    service: 'Samsung кір жуғыш машинасын жөндеу',
    date: 'Бүгін',
    budget: 'Келісімді',
    urgency: 'high',
    attachments: [dummyAttachment],
    location: { latitude: 44.8488, longitude: 65.4823, address: 'Байтурсынова 12' },
    understanding: kzUnderstanding,
  });
  assert('Request created successfully with REQ- id', createdReq.id.startsWith('REQ-'));
  assert('Request contains attachments', (createdReq.attachments?.length || 0) === 1);
  assert('Request contains location', Boolean(createdReq.location && createdReq.location.latitude));
  assert('Request contains understanding', Boolean(createdReq.understanding && createdReq.understanding.detectedBrand === 'Samsung'));

  // -------------------------------------------------------------
  // TEST 20: Matching regression
  // -------------------------------------------------------------
  console.log('\n[TEST 20] Matching regression');
  const matchedProviders = await matchProviders(createdReq, await repo.getProviders());
  assert('Matching engine returns array of providers', Array.isArray(matchedProviders));
  assert('At least one provider found in kyzylorda for appliance_repair', matchedProviders.length > 0);

  // -------------------------------------------------------------
  // TEST 21: Offer regression
  // -------------------------------------------------------------
  console.log('\n[TEST 21] Offer regression');
  const createdOffer = await repo.createOffer({
    requestId: createdReq.id,
    providerId: 'prov-001',
    price: '5000 ₸',
    priceType: 'fixed',
    availability: 'Бүгін',
    message: 'Бүгін келіп 1 сағатта жөндеп беремін',
  });
  assert('Offer created with OFF- id', createdOffer.id.startsWith('OFF'));
  const offersForReq = await repo.getOffers({ requestId: createdReq.id });
  assert('Offer retrieved for request', offersForReq.some((o) => o.id === createdOffer.id));
  const acceptResult = await repo.acceptOffer(createdReq.id, createdOffer.id);
  assert('Offer status transitions to ACCEPTED', acceptResult.offer?.status === 'ACCEPTED');

  // -------------------------------------------------------------
  // TEST 22: Chat regression
  // -------------------------------------------------------------
  console.log('\n[TEST 22] Chat regression');
  const conv = await repo.getOrCreateConversation(createdReq.id);
  assert('Conversation retrieved/created', conv.id.startsWith('conv_'));
  const chatMsg = await repo.sendMessage(conv.id, {
    text: 'Сәлеметсіз бе, қашан келе аласыз?',
    senderId: 'cust-101',
    senderRole: 'customer',
  });
  assert('Chat message sent successfully', chatMsg.id.startsWith('msg_'));
  const chatMessages = await repo.getMessages(conv.id);
  assert('Chat messages include sent message', chatMessages.some((m) => m.id === chatMsg.id));

  // -------------------------------------------------------------
  // TEST 23: Appointment regression
  // -------------------------------------------------------------
  console.log('\n[TEST 23] Appointment regression');
  const appointment = await repo.createAppointment({
    requestId: createdReq.id,
    customerId: 'cust-101',
    providerId: 'prov-001',
    providerUserId: 'prov-001',
    scheduledAt: '2026-10-10T18:00:00Z',
    status: 'PROPOSED',
    proposedBy: 'customer',
  });
  assert('Appointment created with appointment_ id', appointment.id.startsWith('appointment_'));
  const updatedApt = await repo.updateAppointment(appointment.id, { status: 'CONFIRMED' });
  assert('Appointment status updated to CONFIRMED', updatedApt.status === 'CONFIRMED');

  // -------------------------------------------------------------
  // TEST 24: Work Status regression
  // -------------------------------------------------------------
  console.log('\n[TEST 24] Work Status regression');
  const inProgressReq = await repo.updateRequest(createdReq.id, { status: 'IN_PROGRESS' });
  assert('Request status transitions to IN_PROGRESS', inProgressReq?.status === 'IN_PROGRESS');
  const completedReq = await repo.updateRequest(createdReq.id, { status: 'COMPLETED' });
  assert('Request status transitions to COMPLETED', completedReq?.status === 'COMPLETED');

  // -------------------------------------------------------------
  // TEST 25: Review regression
  // -------------------------------------------------------------
  console.log('\n[TEST 25] Review regression');
  setCurrentUserId('cust-101');
  const review = await repo.createReview({
    requestId: createdReq.id,
    customerId: 'cust-101',
    customerName: 'Ербол',
    providerId: 'prov-001',
    rating: 5,
    comment: 'Өте жақсы шебер, кір жуғыш машинаны тез жөндеді!',
  });
  assert('Review created with requestId', Boolean(review.id));
  const providerReviews = await repo.getReviews({ providerId: 'prov-001' });
  assert('Review retrieved for provider', providerReviews.some((r) => r.id === review.id));

  // -------------------------------------------------------------
  // TEST 26: Notification regression
  // -------------------------------------------------------------
  console.log('\n[TEST 26] Notification regression');
  const notif = await repo.createNotification({
    id: 'notif-101',
    recipientUserId: 'cust-101',
    recipientRole: 'customer',
    title: { kz: 'Ұсыныс қабылданды', ru: 'Предложение принято' },
    body: { kz: 'Шебер сіздің тапсырысыңызды орындауға дайын', ru: 'Мастер готов выполнить ваш заказ' },
    type: 'CUSTOMER_OFFER_ACCEPTED',
    targetScreen: 'request_detail',
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  assert('Notification created with notif- id', notif.id.startsWith('notif-'));
  const userNotifs = await repo.getNotifications('cust-101');
  assert('Notification retrieved for user', userNotifs.some((n) => n.id === notif.id));

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
