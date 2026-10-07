import {
  formatOfferDisplayPrice,
  Language,
  ProviderOffer,
  ServiceRequest,
} from '../src/types';
import { validateOfferData } from '../src/services/validation';
import { LocalRepository } from '../src/services/localRepository';

// Setup Mock LocalStorage for node environment
const storageStore: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (key: string) => storageStore[key] || null,
  setItem: (key: string, value: string) => {
    storageStore[key] = value;
  },
  removeItem: (key: string) => {
    delete storageStore[key];
  },
  clear: () => {
    for (const k in storageStore) delete storageStore[k];
  },
};

async function runTests() {
  console.log('=== RUNNING TESTS FOR FLEXIBLE PRICING SYSTEM ===\n');
  let passedCount = 0;
  let failedCount = 0;

  function assert(desc: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${desc} ${details ? `-> ${details}` : ''}`);
      failedCount++;
    }
  }

  // Initialize repository
  const repo = new LocalRepository();

  // Create a base customer request
  const testRequest: ServiceRequest = await repo.createRequest({
    customerId: 'cust-100',
    customerName: 'Айдар',
    customerPhone: '+7 701 123 4567',
    city: 'Алматы',
    category: 'Сантехника',
    service: 'Смеситель орнату',
    requestText: 'Ас үйдегі краннан су ағып тұр, ауыстыру немесе жөндеу керек',
    urgency: 'normal',
    status: 'OPEN',
  });

  assert('Request created with OPEN status', testRequest.status === 'OPEN');

  // --- TEST 1: Fixed Price Offer ---
  console.log('\n--- 1. Testing Fixed Price Offer ---');
  // Validation checks
  const fixedValid = validateOfferData({
    requestId: testRequest.id,
    providerId: 'prov-fixed',
    price: '15 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня в 14:00',
  });
  assert('Fixed offer validation succeeds with valid price', fixedValid.valid);

  const fixedMissingPrice = validateOfferData({
    requestId: testRequest.id,
    providerId: 'prov-fixed',
    price: '',
    priceType: 'fixed',
    availability: 'Сегодня в 14:00',
  });
  assert('Fixed offer validation fails when price is empty', !fixedMissingPrice.valid && fixedMissingPrice.field === 'price');

  // Create offer via repository
  const fixedOffer = await repo.createOffer({
    requestId: testRequest.id,
    providerId: 'prov-fixed',
    providerName: 'Нұрлан Шебер',
    providerPhone: '+7 777 111 2233',
    price: '15 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня в 14:00',
    message: 'Барлық құралым бар',
  });
  assert('Fixed offer stored with price "15 000 ₸" and priceType "fixed"', fixedOffer.price === '15 000 ₸' && fixedOffer.priceType === 'fixed');

  // Display formatting checks
  const fixedDisplayRu = formatOfferDisplayPrice(fixedOffer, 'ru');
  const fixedDisplayKz = formatOfferDisplayPrice(fixedOffer, 'kz');
  assert('Fixed display in Russian is "15 000 ₸"', fixedDisplayRu === '15 000 ₸', `Got: ${fixedDisplayRu}`);
  assert('Fixed display in Kazakh is "15 000 ₸"', fixedDisplayKz === '15 000 ₸', `Got: ${fixedDisplayKz}`);


  // --- TEST 2: From Price Offer ---
  console.log('\n--- 2. Testing From Price Offer ---');
  const fromValid = validateOfferData({
    requestId: testRequest.id,
    providerId: 'prov-from',
    price: 'от 10 000 ₸',
    priceType: 'from',
    availability: 'В течение 1 часа',
  });
  assert('From offer validation succeeds with valid price', fromValid.valid);

  const fromMissingPrice = validateOfferData({
    requestId: testRequest.id,
    providerId: 'prov-from',
    price: '',
    priceType: 'from',
    availability: 'В течение 1 часа',
  });
  assert('From offer validation fails when price is empty', !fromMissingPrice.valid && fromMissingPrice.field === 'price');

  const fromOffer = await repo.createOffer({
    requestId: testRequest.id,
    providerId: 'prov-from',
    providerName: 'Серік Сантехник',
    providerPhone: '+7 777 222 3344',
    price: 'от 10 000 ₸',
    priceType: 'from',
    availability: 'В течение 1 часа',
    message: 'Күрделілігіне қарай баға нақтыланады',
  });
  assert('From offer stored with price "от 10 000 ₸" and priceType "from"', fromOffer.price === 'от 10 000 ₸' && fromOffer.priceType === 'from');

  const fromDisplayRu = formatOfferDisplayPrice(fromOffer, 'ru');
  const fromDisplayKz = formatOfferDisplayPrice(fromOffer, 'kz');
  assert('From display in Russian is "от 10 000 ₸"', fromDisplayRu === 'от 10 000 ₸', `Got: ${fromDisplayRu}`);
  assert('From display in Kazakh is "10 000 ₸ бастап"', fromDisplayKz === '10 000 ₸ бастап', `Got: ${fromDisplayKz}`);


  // --- TEST 3: Inspection Price Offer ---
  console.log('\n--- 3. Testing Inspection Price Offer ---');
  const inspectionValidNoPrice = validateOfferData({
    requestId: testRequest.id,
    providerId: 'prov-insp',
    price: '', // Price is NOT required for inspection
    priceType: 'inspection',
    availability: 'Завтра с утра',
  });
  assert('Inspection offer validation succeeds even when price is empty', inspectionValidNoPrice.valid);

  const inspectionOffer = await repo.createOffer({
    requestId: testRequest.id,
    providerId: 'prov-insp',
    providerName: 'Алексей Мастер',
    providerPhone: '+7 777 333 4455',
    priceType: 'inspection',
    availability: 'Завтра с утра',
    message: 'Сначала нужно осмотреть трубы на месте',
  });
  assert('Inspection offer automatically defaults price to "После осмотра"', inspectionOffer.price === 'После осмотра' && inspectionOffer.priceType === 'inspection');

  // Customer UI display checks
  const inspDisplayRu = formatOfferDisplayPrice(inspectionOffer, 'ru');
  const inspDisplayKz = formatOfferDisplayPrice(inspectionOffer, 'kz');
  assert('Inspection display in Russian is "После осмотра"', inspDisplayRu === 'После осмотра', `Got: ${inspDisplayRu}`);
  assert('Inspection display in Kazakh is "Қарап көрген соң"', inspDisplayKz === 'Қарап көрген соң', `Got: ${inspDisplayKz}`);


  // --- TEST 4: Invalid priceType rejection ---
  console.log('\n--- 4. Testing Invalid Price Type Validation ---');
  const invalidPriceType = validateOfferData({
    requestId: testRequest.id,
    providerId: 'prov-invalid',
    price: '5000 ₸',
    priceType: 'unknown_type' as any,
    availability: 'Сегодня',
  });
  assert('Validation rejects invalid priceType', !invalidPriceType.valid && invalidPriceType.field === 'priceType');


  // --- TEST 5: Legacy Offer Compatibility (no priceType) ---
  console.log('\n--- 5. Testing Legacy Offer Compatibility ---');
  // Legacy offer created without priceType
  const legacyOffer: ProviderOffer = {
    id: 'OFFER-LEGACY-001',
    requestId: testRequest.id,
    providerId: 'prov-legacy',
    providerName: 'Ескі Орындаушы',
    providerPhone: '+7 777 999 8877',
    providerWhatsapp: '+7 777 999 8877',
    price: '12 000 ₸',
    // priceType is undefined (legacy)
    availability: '2 сағат ішінде',
    message: '',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  const legacyValidation = validateOfferData(legacyOffer);
  assert('Legacy offer passes validation when price is provided', legacyValidation.valid);

  const legacyDisplayRu = formatOfferDisplayPrice(legacyOffer, 'ru');
  const legacyDisplayKz = formatOfferDisplayPrice(legacyOffer, 'kz');
  assert('Legacy fixed offer renders properly in Russian ("12 000 ₸")', legacyDisplayRu === '12 000 ₸', `Got: ${legacyDisplayRu}`);
  assert('Legacy fixed offer renders properly in Kazakh ("12 000 ₸")', legacyDisplayKz === '12 000 ₸', `Got: ${legacyDisplayKz}`);

  // Test legacy offer with "от 8 000 ₸" text but no priceType
  const legacyFromTextOffer: ProviderOffer = {
    ...legacyOffer,
    id: 'OFFER-LEGACY-002',
    price: 'от 8 000 ₸',
  };
  assert('Legacy "от 8 000 ₸" renders as "от 8 000 ₸" in Russian', formatOfferDisplayPrice(legacyFromTextOffer, 'ru') === 'от 8 000 ₸');
  assert('Legacy "от 8 000 ₸" renders as "8 000 ₸ бастап" in Kazakh', formatOfferDisplayPrice(legacyFromTextOffer, 'kz') === '8 000 ₸ бастап');

  // Test legacy offer with "После осмотра" text but no priceType
  const legacyInspTextOffer: ProviderOffer = {
    ...legacyOffer,
    id: 'OFFER-LEGACY-003',
    price: 'После осмотра',
  };
  assert('Legacy "После осмотра" renders as "После осмотра" in Russian', formatOfferDisplayPrice(legacyInspTextOffer, 'ru') === 'После осмотра');
  assert('Legacy "После осмотра" renders as "Қарап көрген соң" in Kazakh', formatOfferDisplayPrice(legacyInspTextOffer, 'kz') === 'Қарап көрген соң');


  // --- TEST 6: Accept Offer & Communication Lifecycle ---
  console.log('\n--- 6. Testing Accept Offer & Lifecycle Flow ---');
  // Accept the flexible 'from' offer
  await repo.acceptOffer(testRequest.id, fromOffer.id);

  const updatedReq = await repo.getRequest(testRequest.id);
  assert('Request status transitioned to PROVIDER_SELECTED upon offer acceptance', updatedReq?.status === 'PROVIDER_SELECTED');
  assert('Request selectedOfferId set to accepted offer ID', updatedReq?.selectedOfferId === fromOffer.id);

  const allOffers = await repo.getOffers({ requestId: testRequest.id });
  const acceptedOffer = allOffers.find((o) => o.id === fromOffer.id);
  const otherOffers = allOffers.filter((o) => o.id !== fromOffer.id);

  assert('Accepted offer status is ACCEPTED', acceptedOffer?.status === 'ACCEPTED');
  assert('Accepted offer preserves price and priceType', acceptedOffer?.price === 'от 10 000 ₸' && acceptedOffer?.priceType === 'from');
  assert('Other offers transitioned to REJECTED', otherOffers.every((o) => o.status === 'REJECTED'));

  // Test communication contact data accessibility
  assert('Accepted provider phone is available for calling', Boolean(acceptedOffer?.providerPhone && acceptedOffer.providerPhone.length > 5));
  assert('Accepted provider WhatsApp is available', Boolean(acceptedOffer?.providerWhatsapp || acceptedOffer?.providerPhone));

  // Test status transitions: PROVIDER_SELECTED -> IN_PROGRESS -> COMPLETED
  await repo.updateRequestStatus(testRequest.id, 'IN_PROGRESS');
  const inProgressReq = await repo.getRequest(testRequest.id);
  assert('Request status transitioned to IN_PROGRESS', inProgressReq?.status === 'IN_PROGRESS');

  await repo.updateRequestStatus(testRequest.id, 'COMPLETED');
  const completedReq = await repo.getRequest(testRequest.id);
  assert('Request status transitioned to COMPLETED', completedReq?.status === 'COMPLETED');

  console.log('\n=============================================');
  console.log(`TEST SUMMARY: ${passedCount} passed, ${failedCount} failed`);
  console.log('=============================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
