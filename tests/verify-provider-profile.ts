import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  formatOfferDisplayPrice,
  ProviderOffer,
  ServiceRequest,
} from '../src/types';
import { validateOfferData } from '../src/services/validation';
import { LocalRepository } from '../src/services/localRepository';
import { ProviderProfileModal } from '../src/components/ProviderProfileModal';

// Setup Mock LocalStorage
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
  console.log('=== RUNNING TESTS FOR PROVIDER PROFILE & COMPATIBILITY ===\n');
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

  const repo = new LocalRepository();

  // Test A & B: Provider creation with and without experienceYears
  console.log('--- 1. Provider model & legacy compatibility ---');
  const providerWithExp = await repo.createProvider({
    id: 'prov-exp-001',
    userId: 'user-001',
    name: 'Мастер Азамат',
    phone: '+7 777 123 4567',
    whatsapp: '+7 777 123 4567',
    city: 'Алматы',
    district: 'Бостандыкский район',
    category: 'Сантехника',
    services: 'Установка смесителей, монтаж труб',
    priceRange: 'от 5 000 ₸',
    workingHours: '09:00 - 20:00',
    description: 'Опытный сантехник со своим профессиональным инструментом.',
    experienceYears: 7,
    verified: true,
  });

  assert('Provider with experienceYears (7) created successfully', providerWithExp.experienceYears === 7);

  const legacyProvider = await repo.createProvider({
    id: 'prov-legacy-002',
    userId: 'user-002',
    name: 'Шебер Бауыржан',
    phone: '+7 701 987 6543',
    whatsapp: '+7 701 987 6543',
    city: 'Қызылорда',
    district: 'Орталық',
    category: 'Электрик қызметі',
    services: 'Люстра орнату, розетка ауыстыру',
    priceRange: '4 000 – 10 000 ₸',
    workingHours: '08:00 - 21:00',
    description: 'Электр жұмыстарына кепілдік беремін.',
    // experienceYears is omitted (legacy)
    verified: false,
  });

  assert('Legacy provider without experienceYears works normally', legacyProvider.experienceYears === undefined);

  // Test C: Provider not found safety
  console.log('\n--- 2. Non-existent provider retrieval ---');
  const nonExistent = await repo.getProvider('prov-non-existent-999');
  assert('Non-existent provider returns null safely without throwing', nonExistent === null);

  // Test D, E, F: Modal HTML rendering checks (Security & Display)
  console.log('\n--- 3. ProviderProfileModal Rendering & Security Verification ---');
  
  // Render with experience in Russian
  const modalHtmlRu = renderToString(
    React.createElement(ProviderProfileModal, {
      provider: providerWithExp,
      isOpen: true,
      onClose: () => {},
      language: 'ru',
    })
  );

  assert('Modal renders provider name "Мастер Азамат"', modalHtmlRu.includes('Мастер Азамат'));
  assert('Modal renders experience in Russian "7 лет опыта"', modalHtmlRu.includes('7 лет опыта'));
  assert('Modal renders category and services', modalHtmlRu.includes('Сантехника') && modalHtmlRu.includes('Установка смесителей'));
  assert('Modal renders verified badge for verified=true', modalHtmlRu.includes('Проверенный специалист'));

  // Critical Security Assertion: phone and whatsapp MUST NEVER appear in modal HTML
  assert(
    'Phone number is NOT rendered in ProviderProfileModal',
    !modalHtmlRu.includes('+7 777 123 4567') && !modalHtmlRu.includes('123 4567')
  );
  assert(
    'WhatsApp label/number is NOT rendered in ProviderProfileModal',
    !modalHtmlRu.toLowerCase().includes('whatsapp')
  );

  // Critical Anti-Slop Assertion: no fake rating or stars (shows verified empty state)
  assert(
    'No fake ratings or reviews rendered in ProviderProfileModal',
    !modalHtmlRu.includes('★') &&
    !modalHtmlRu.includes('5.0') &&
    (modalHtmlRu.includes('Нет оценок') || modalHtmlRu.includes('Пока нет отзывов'))
  );

  // Render in Kazakh
  const modalHtmlKz = renderToString(
    React.createElement(ProviderProfileModal, {
      provider: providerWithExp,
      isOpen: true,
      onClose: () => {},
      language: 'kz',
    })
  );
  assert('Modal renders experience in Kazakh "7 жыл тәжірибе"', modalHtmlKz.includes('7 жыл тәжірибе'));
  assert('Modal renders verified badge in Kazakh', modalHtmlKz.includes('Тексерілген маман'));

  // Render legacy provider (no experience, verified=false)
  const legacyModalHtml = renderToString(
    React.createElement(ProviderProfileModal, {
      provider: legacyProvider,
      isOpen: true,
      onClose: () => {},
      language: 'kz',
    })
  );
  assert('Legacy provider modal renders without experience block', !legacyModalHtml.includes('жыл тәжірибе'));
  assert('Unverified provider modal does not render verified badge', !legacyModalHtml.includes('Тексерілген маман'));
  assert('Legacy phone is NOT rendered', !legacyModalHtml.includes('+7 701 987 6543'));

  // Test G: Flexible pricing system preservation
  console.log('\n--- 4. Flexible pricing preservation ---');
  const fixedValid = validateOfferData({
    requestId: 'REQ-01',
    providerId: providerWithExp.id,
    price: '15 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня',
  });
  assert('Fixed offer validation succeeds', fixedValid.valid);

  const fromValid = validateOfferData({
    requestId: 'REQ-01',
    providerId: providerWithExp.id,
    price: 'от 10 000 ₸',
    priceType: 'from',
    availability: 'Сегодня',
  });
  assert('From offer validation succeeds', fromValid.valid);

  const inspValid = validateOfferData({
    requestId: 'REQ-01',
    providerId: providerWithExp.id,
    price: '', // optional for inspection
    priceType: 'inspection',
    availability: 'Сегодня',
  });
  assert('Inspection offer validation succeeds without price', inspValid.valid);

  assert('Fixed format KZ is "15 000 ₸"', formatOfferDisplayPrice({ price: '15 000 ₸', priceType: 'fixed' }, 'kz') === '15 000 ₸');
  assert('From format KZ is "10 000 ₸ бастап"', formatOfferDisplayPrice({ price: 'от 10 000 ₸', priceType: 'from' }, 'kz') === '10 000 ₸ бастап');
  assert('Inspection format KZ is "Қарап көрген соң"', formatOfferDisplayPrice({ priceType: 'inspection', price: 'После осмотра' }, 'kz') === 'Қарап көрген соң');
  assert('Inspection format RU is "После осмотра"', formatOfferDisplayPrice({ priceType: 'inspection', price: 'После осмотра' }, 'ru') === 'После осмотра');

  // Test H & I: Offer acceptance and Request Status Lifecycle
  console.log('\n--- 5. Lifecycle and acceptance preservation ---');
  const req: ServiceRequest = await repo.createRequest({
    customerId: 'cust-200',
    customerName: 'Данияр',
    customerPhone: '+7 700 111 2233',
    city: 'Алматы',
    category: 'Сантехника',
    service: 'Смеситель орнату',
    requestText: 'Кран жөндеу керек',
    urgency: 'normal',
    status: 'OPEN',
  });

  const offer: ProviderOffer = await repo.createOffer({
    requestId: req.id,
    providerId: providerWithExp.id,
    providerName: providerWithExp.name,
    providerPhone: providerWithExp.phone,
    providerWhatsapp: providerWithExp.whatsapp,
    price: 'После осмотра',
    priceType: 'inspection',
    availability: 'Сегодня в 15:00',
    status: 'PENDING',
  });

  await repo.acceptOffer(req.id, offer.id);
  const updatedReq = await repo.getRequest(req.id);
  assert('Offer acceptance transitions request to PROVIDER_SELECTED', updatedReq?.status === 'PROVIDER_SELECTED');
  assert('Accepted offer ID is set on request', updatedReq?.selectedOfferId === offer.id);

  await repo.updateRequestStatus(req.id, 'IN_PROGRESS');
  const inProgressReq = await repo.getRequest(req.id);
  assert('Request transitions to IN_PROGRESS', inProgressReq?.status === 'IN_PROGRESS');

  await repo.updateRequestStatus(req.id, 'COMPLETED');
  const completedReq = await repo.getRequest(req.id);
  assert('Request transitions to COMPLETED', completedReq?.status === 'COMPLETED');

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${passedCount} passed, ${failedCount} failed`);
  console.log('======================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
