import React from 'react';
import { renderToString } from 'react-dom/server';
import { ProviderOnboarding } from '../src/components/ProviderOnboarding';
import { ProviderProfileModal } from '../src/components/ProviderProfileModal';
import { Provider, ServiceRequest } from '../src/types';
import { LocalRepository, setCurrentUserId } from '../src/services/localRepository';
import { validateProviderData } from '../src/services/validation';
import { normalizeCategoryId, normalizeCityId } from '../src/services/taxonomy';

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

function assert(description: string, condition: boolean) {
  if (!condition) {
    console.error(`[FAIL] ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
  console.log(`[PASS] ${description}`);
}

async function runTests() {
  console.log('=== RUNNING TESTS FOR PROVIDER ONBOARDING FLOW ===\n');

  // Clear mock storage
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }

  // --- 1. Step Progression & Rendering ---
  console.log('--- 1. Step Progression & Rendering ---');
  const onboardingHtml = renderToString(
    React.createElement(ProviderOnboarding, {
      language: 'ru',
      initialProvider: null,
      onSave: async () => {},
    })
  );

  assert('Onboarding renders Step 1 indicator (Шаг 1)', onboardingHtml.includes('Шаг 1'));
  assert('Onboarding renders Step 1 title "Основная информация"', onboardingHtml.includes('Основная информация'));
  assert('Onboarding renders Name input label', onboardingHtml.includes('Имя или название компании'));
  assert('Onboarding renders Phone input label', onboardingHtml.includes('Телефон'));
  assert('Onboarding renders WhatsApp input label', onboardingHtml.includes('WhatsApp'));
  assert('Onboarding renders Next step button "Далее"', onboardingHtml.includes('Далее'));

  // Test Kazakh localization
  const onboardingHtmlKz = renderToString(
    React.createElement(ProviderOnboarding, {
      language: 'kz',
      initialProvider: null,
      onSave: async () => {},
    })
  );
  assert('KZ Onboarding renders Step 1 indicator (Қадам 1)', onboardingHtmlKz.includes('Қадам 1'));
  assert('KZ Onboarding renders "Негізгі ақпарат"', onboardingHtmlKz.includes('Негізгі ақпарат'));
  assert('KZ Onboarding renders "Келесі қадам"', onboardingHtmlKz.includes('Келесі қадам'));

  // --- 2. Validation Constraints ---
  console.log('\n--- 2. Validation Constraints ---');
  const invalidNameResult = validateProviderData({ name: 'A', phone: '+77771234567', city: 'Қызылорда', category: 'Сантехника' });
  assert('Provider with name < 2 chars is rejected', !invalidNameResult.valid);

  const invalidPhoneResult = validateProviderData({ name: 'Мастер Азамат', phone: '12', city: 'Қызылорда', category: 'Сантехника' });
  assert('Provider with phone < 6 chars is rejected', !invalidPhoneResult.valid);

  const invalidCityResult = validateProviderData({ name: 'Мастер Азамат', phone: '+77771234567', city: '', category: 'Сантехника' });
  assert('Provider without city is rejected', !invalidCityResult.valid);

  const invalidCatResult = validateProviderData({ name: 'Мастер Азамат', phone: '+77771234567', city: 'Қызылорда', category: '' });
  assert('Provider without category is rejected', !invalidCatResult.valid);

  const validProviderData = {
    name: 'Мастер Азамат',
    phone: '+77771234567',
    city: 'Қызылорда',
    category: 'Тұрмыстық техника жөндеу',
  };
  const validResult = validateProviderData(validProviderData);
  assert('Valid provider data passes validation', validResult.valid);

  // --- 3. Canonical Taxonomy Normalization ---
  console.log('\n--- 3. Canonical Taxonomy Normalization ---');
  const cId = normalizeCityId('Кызылорда');
  assert('City Кызылорда normalizes to kyzylorda', cId === 'kyzylorda');
  const catId = normalizeCategoryId('Ремонт бытовой техники');
  assert('Category normalizes to appliances', catId === 'appliances' || catId === 'appliance_repair');

  // --- 4. Profile Creation & Security: verified = false on new registrations ---
  console.log('\n--- 4. Profile Creation & Security: verified = false for new providers ---');
  const repo = new LocalRepository();
  const testUserId = 'test-new-provider-uid-123';

  const createdProvider = await repo.createProvider({
    id: testUserId,
    userId: testUserId,
    name: 'Мастер Азамат',
    phone: '+77771234567',
    whatsapp: '+77771234567',
    city: 'Кызылорда',
    cityId: cId,
    district: 'Центр',
    category: 'Ремонт бытовой техники',
    categoryId: catId,
    services: 'Ремонт стиральных машин',
    priceRange: 'от 5 000 ₸',
    workingHours: '09:00 - 20:00',
    experienceYears: 6,
    description: 'Опытный мастер с выездом на дом.',
    verified: false, // Critical: new provider cannot be self-verified!
    isDemo: false,
  });

  assert('Provider created successfully with Auth UID', createdProvider.id === testUserId);
  assert('Provider userId matches Auth UID', createdProvider.userId === testUserId);
  assert('New provider has verified=false (no self-verification)', createdProvider.verified === false);
  assert('Provider isDemo is false', createdProvider.isDemo === false);
  assert('Provider experienceYears is stored correctly (6)', createdProvider.experienceYears === 6);

  // --- 5. Step 4 Preview & ProviderProfileModal Privacy Check ---
  console.log('\n--- 5. Step 4 Preview & ProviderProfileModal Privacy Check ---');
  const previewModalHtml = renderToString(
    React.createElement(ProviderProfileModal, {
      provider: createdProvider,
      isOpen: true,
      onClose: () => {},
      language: 'ru',
    })
  );

  assert('Preview modal renders provider name "Мастер Азамат"', previewModalHtml.includes('Мастер Азамат'));
  assert('Preview modal renders experience "6 лет опыта"', previewModalHtml.includes('6 лет опыта'));
  assert('Preview modal renders category "Ремонт бытовой техники"', previewModalHtml.includes('Ремонт бытовой техники'));
  assert('Preview modal renders services "Ремонт стиральных машин"', previewModalHtml.includes('Ремонт стиральных машин'));
  assert('Unverified provider does NOT render verified badge', !previewModalHtml.includes('Проверенный специалист'));

  // Privacy checks: phone and WhatsApp MUST NOT be in modal
  assert('Provider phone is kept private (not in customer modal)', !previewModalHtml.includes('+77771234567'));
  assert('Provider WhatsApp is kept private (not in customer modal)', !previewModalHtml.toLowerCase().includes('whatsapp'));

  // Anti-slop checks: no fake ratings or stars
  assert('No fake 5.0 rating rendered for new unrated provider', !previewModalHtml.includes('5.0'));
  assert('No fake star rendered for new unrated provider', !previewModalHtml.includes('★'));

  // --- 6. Provider Retrieval for Returning User ---
  console.log('\n--- 6. Provider Retrieval for Returning User ---');
  const retrievedProvider = await repo.getProvider(testUserId);
  assert('Retrieved provider exists by Auth UID', retrievedProvider !== null);
  assert('Retrieved provider name matches', retrievedProvider?.name === 'Мастер Азамат');
  assert('Retrieved provider is NOT demo', retrievedProvider?.isDemo === false);

  // --- 7. Preservation of Request/Offer/Accept/Complete Lifecycle ---
  console.log('\n--- 7. Preservation of Lifecycle Flow ---');
  const req: ServiceRequest = await repo.createRequest({
    customerId: 'customer-test-999',
    customerName: 'Данияр',
    requestText: 'Стиральная машина не сливает воду',
    city: 'Кызылорда',
    cityId: 'kyzylorda',
    category: 'Ремонт бытовой техники',
    categoryId: 'appliance_repair',
    service: 'Ремонт стиральной машины',
    urgency: 'high',
    status: 'OPEN',
  });
  assert('Request created with OPEN status', req.status === 'OPEN');

  const offer = await repo.createOffer({
    requestId: req.id,
    providerId: createdProvider.id,
    providerName: createdProvider.name,
    providerPhone: createdProvider.phone,
    providerWhatsapp: createdProvider.whatsapp,
    price: '12 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня, через 1 час',
    message: 'Приеду с инструментами',
    status: 'PENDING',
  });
  assert('Offer created with PENDING status', offer.status === 'PENDING');

  const acceptResult = await repo.acceptOffer(req.id, offer.id);
  assert('Request status transitions to PROVIDER_SELECTED upon offer acceptance', acceptResult.request?.status === 'PROVIDER_SELECTED');
  assert('Accepted offer has status ACCEPTED', acceptResult.offer?.status === 'ACCEPTED');

  const inProgressReq = await repo.updateRequestStatus(req.id, 'IN_PROGRESS');
  assert('Request transitions to IN_PROGRESS', inProgressReq?.status === 'IN_PROGRESS');

  const completedReq = await repo.updateRequestStatus(req.id, 'COMPLETED');
  assert('Request transitions to COMPLETED', completedReq?.status === 'COMPLETED');

  // Customer creates review for completed request
  setCurrentUserId('customer-test-999');
  localStorage.setItem('kerek_current_user_id_v2', 'customer-test-999');
  localStorage.setItem('kerek_user_id', 'customer-test-999');
  const review = await repo.createReview({
    id: req.id,
    requestId: req.id,
    customerId: 'customer-test-999',
    customerName: 'Данияр',
    providerId: createdProvider.id,
    providerName: createdProvider.name,
    rating: 5,
    comment: 'Отличная работа, все починил быстро!',
  });
  assert('Review created for completed job', review.rating === 5);

  const providerReviews = await repo.getReviews({ providerId: createdProvider.id });
  assert('Provider has exactly 1 review now', providerReviews.length === 1);
  assert('Review rating is 5', providerReviews[0].rating === 5);

  console.log('\n======================================================');
  console.log('ALL PROVIDER ONBOARDING & LIFECYCLE TESTS PASSED!');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('[TEST SUITE CRASHED]:', err);
  process.exit(1);
});
