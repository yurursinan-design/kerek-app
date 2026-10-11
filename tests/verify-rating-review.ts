import {
  Language,
  Provider,
  ProviderOffer,
  Review,
  ServiceRequest,
} from '../src/types';
import { validateReviewData } from '../src/services/validation';
import { LocalRepository, setCurrentUserId } from '../src/services/localRepository';
import { translations } from '../src/i18n/translations';

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
  console.log('=== RUNNING TESTS FOR RATING & REVIEW SYSTEM ===\n');
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

  // Seed sample provider
  const provider = await repo.createProvider({
    id: 'prov-review-1',
    userId: 'user-prov-1',
    name: 'Санжар Мастеров',
    phone: '+7 701 555 4433',
    whatsapp: '+7 701 555 4433',
    city: 'Алматы',
    district: 'Алмалинский район',
    category: 'Сантехника',
    services: 'Замена труб, ремонт кранов',
    priceRange: '10 000 ₸',
    workingHours: '09:00 - 18:00',
    description: 'Опытный сантехник',
    verified: true,
  });

  console.log('--- 1. Verification of Review validation logic ---');
  // Mock request in COMPLETED state
  const completedReq: ServiceRequest = {
    id: 'REQ-101',
    customerId: 'cust-101',
    customerName: 'Айбек',
    customerPhone: '+7 777 000 1122',
    city: 'Алматы',
    category: 'Сантехника',
    service: 'Ремонт крана',
    requestText: 'Течет кран на кухне',
    description: 'Течет кран на кухне',
    budget: '15 000 ₸',
    date: 'Бүгін',
    urgency: 'normal',
    status: 'COMPLETED',
    selectedOfferId: 'OFFER-101',
    createdAt: new Date().toISOString(),
  };

  const acceptedOffer: ProviderOffer = {
    id: 'OFFER-101',
    requestId: 'REQ-101',
    providerId: 'prov-review-1',
    providerName: 'Санжар Мастеров',
    providerPhone: '+7 701 555 4433',
    providerWhatsapp: '+7 701 555 4433',
    price: '12 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня',
    message: 'Сделаю быстро',
    status: 'ACCEPTED',
    createdAt: new Date().toISOString(),
  };

  // Valid review check
  const validCheck = validateReviewData(
    {
      requestId: 'REQ-101',
      customerId: 'cust-101',
      providerId: 'prov-review-1',
      rating: 5,
      comment: 'Отличная работа!',
    },
    completedReq,
    acceptedOffer
  );
  assert('Valid review passes validation', validCheck.valid === true);

  // Rating range: 0 is invalid
  const zeroRatingCheck = validateReviewData(
    {
      requestId: 'REQ-101',
      customerId: 'cust-101',
      providerId: 'prov-review-1',
      rating: 0,
    },
    completedReq,
    acceptedOffer
  );
  assert('Rating 0 is rejected', zeroRatingCheck.valid === false);

  // Rating range: 6 is invalid
  const highRatingCheck = validateReviewData(
    {
      requestId: 'REQ-101',
      customerId: 'cust-101',
      providerId: 'prov-review-1',
      rating: 6,
    },
    completedReq,
    acceptedOffer
  );
  assert('Rating 6 is rejected', highRatingCheck.valid === false);

  // Rating non-integer
  const floatRatingCheck = validateReviewData(
    {
      requestId: 'REQ-101',
      customerId: 'cust-101',
      providerId: 'prov-review-1',
      rating: 4.5,
    },
    completedReq,
    acceptedOffer
  );
  assert('Floating point rating is rejected', floatRatingCheck.valid === false);

  // Rejected if request is NOT COMPLETED (e.g. IN_PROGRESS or OPEN)
  const openReq: ServiceRequest = { ...completedReq, status: 'IN_PROGRESS' };
  const incompleteCheck = validateReviewData(
    {
      requestId: 'REQ-101',
      customerId: 'cust-101',
      providerId: 'prov-review-1',
      rating: 5,
    },
    openReq,
    acceptedOffer
  );
  assert('Review rejected if request status is not COMPLETED', incompleteCheck.valid === false);

  // Rejected if user is not the customer owner
  const wrongCustomerCheck = validateReviewData(
    {
      requestId: 'REQ-101',
      customerId: 'hacker-999',
      providerId: 'prov-review-1',
      rating: 5,
    },
    completedReq,
    acceptedOffer
  );
  assert('Review rejected if submitted by non-owner customer', wrongCustomerCheck.valid === false);

  // Rejected if provider tries to review themselves
  const selfReviewCheck = validateReviewData(
    {
      requestId: 'REQ-101',
      customerId: 'prov-review-1',
      providerId: 'prov-review-1',
      rating: 5,
    },
    completedReq,
    acceptedOffer
  );
  assert('Provider self-review is strictly rejected', selfReviewCheck.valid === false);

  // Rejected if target provider is not the accepted offer provider
  const mismatchedProviderCheck = validateReviewData(
    {
      requestId: 'REQ-101',
      customerId: 'cust-101',
      providerId: 'other-provider-999',
      rating: 5,
    },
    completedReq,
    acceptedOffer
  );
  assert('Review rejected if provider does not match accepted offer', mismatchedProviderCheck.valid === false);

  console.log('\n--- 2. Repository createReview and getReviews operations ---');
  // Seed actual request and offer in repo
  const seededReq = await repo.createRequest({
    customerId: 'cust-real-1',
    customerName: 'Ернар',
    customerPhone: '+7 705 111 2233',
    city: 'Алматы',
    category: 'Сантехника',
    service: 'Установка фильтра',
    requestText: 'Установка фильтра для воды на кухне',
    budget: '10 000 ₸',
    urgency: 'normal',
  });

  const seededOffer = await repo.createOffer({
    id: 'OFFER-REAL-1',
    requestId: seededReq.id,
    providerId: provider.id,
    providerName: provider.name,
    providerPhone: provider.phone,
    providerWhatsapp: provider.whatsapp,
    price: '10 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня',
    message: 'Готов сделать',
  });

  // End-to-end lifecycle: customer accepts offer -> request becomes PROVIDER_SELECTED, offer becomes ACCEPTED
  await repo.acceptOffer(seededReq.id, seededOffer.id);

  // Transition request to COMPLETED
  await repo.updateRequestStatus(seededReq.id, 'COMPLETED');

  // Set current user session to the request customer
  setCurrentUserId(seededReq.customerId);

  // Create valid review
  const reviewResult = await repo.createReview({
    id: seededReq.id,
    requestId: seededReq.id,
    customerId: seededReq.customerId,
    customerName: seededReq.customerName,
    providerId: provider.id,
    providerName: provider.name,
    rating: 5,
    comment: 'Сделал всё аккуратно и быстро! Рекомендую.',
  });

  assert('Review created successfully', !!reviewResult);
  assert('Review id matches requestId (/reviews/{requestId})', reviewResult.id === seededReq.id);
  assert('Review rating stored as integer 5', reviewResult.rating === 5);
  assert('Review comment correctly preserved', reviewResult.comment === 'Сделал всё аккуратно и быстро! Рекомендую.');

  // Idempotency test: duplicate review creation must throw
  let duplicateThrew = false;
  try {
    await repo.createReview({
      id: seededReq.id,
      requestId: seededReq.id,
      customerId: seededReq.customerId,
      customerName: seededReq.customerName,
      providerId: provider.id,
      providerName: provider.name,
      rating: 4,
      comment: 'Второй отзыв',
    });
  } catch (err: any) {
    duplicateThrew = true;
  }
  assert('Duplicate review for same requestId is rejected', duplicateThrew);

  // Security test 2.1: createReview on IN_PROGRESS request must NOT automatically complete the request
  const uncompletedReq = await repo.createRequest({
    customerId: 'cust-real-uncompleted',
    customerName: 'Бауыржан',
    customerPhone: '+7 705 333 4455',
    city: 'Алматы',
    category: 'Сантехника',
    service: 'Замена сифона',
    requestText: 'Замена сифона на кухне',
    budget: '5 000 ₸',
    urgency: 'normal',
  });
  const uncompletedOffer = await repo.createOffer({
    id: 'OFFER-UNCOMPLETED-1',
    requestId: uncompletedReq.id,
    providerId: provider.id,
    providerName: provider.name,
    providerPhone: provider.phone,
    providerWhatsapp: provider.whatsapp,
    price: '5 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня',
    message: 'Готов',
  });
  await repo.acceptOffer(uncompletedReq.id, uncompletedOffer.id);
  await repo.updateRequestStatus(uncompletedReq.id, 'IN_PROGRESS');

  // Customer session for uncompleted request
  setCurrentUserId(uncompletedReq.customerId);

  let incompleteCreateFailed = false;
  try {
    await repo.createReview({
      id: uncompletedReq.id,
      requestId: uncompletedReq.id,
      customerId: uncompletedReq.customerId,
      customerName: uncompletedReq.customerName,
      providerId: provider.id,
      providerName: provider.name,
      rating: 5,
      comment: 'Попытка оценить незавершенный заказ',
    });
  } catch (err: any) {
    incompleteCreateFailed = err.message.includes('Оценивать можно только завершенные заказы');
  }
  assert('createReview strictly rejects IN_PROGRESS request without marking it COMPLETED', incompleteCreateFailed);

  // Verify that uncompletedReq status was NOT mutated to COMPLETED
  const checkFreshUncompleted = await repo.getRequest(uncompletedReq.id);
  assert(
    'Request status remains strictly IN_PROGRESS and was not auto-completed by createReview',
    checkFreshUncompleted?.status === 'IN_PROGRESS'
  );

  // Security test 2.2: createReview by non-owner customer is strictly rejected
  await repo.updateRequestStatus(uncompletedReq.id, 'COMPLETED');
  setCurrentUserId('attacker-fake-customer');
  let nonOwnerFailed = false;
  try {
    await repo.createReview({
      id: uncompletedReq.id,
      requestId: uncompletedReq.id,
      customerId: 'attacker-fake-customer',
      customerName: 'Хакер',
      providerId: provider.id,
      providerName: provider.name,
      rating: 1,
      comment: 'Поддельный отзыв чужого клиента',
    });
  } catch (err: any) {
    nonOwnerFailed = err.message.includes('Только заказчик может оставить отзыв');
  }
  assert('createReview strictly rejects non-owner customer', nonOwnerFailed);

  // Security test 2.3: createReview for mismatched provider is strictly rejected
  setCurrentUserId(uncompletedReq.customerId);
  let mismatchedProvFailed = false;
  try {
    await repo.createReview({
      id: uncompletedReq.id,
      requestId: uncompletedReq.id,
      customerId: uncompletedReq.customerId,
      customerName: uncompletedReq.customerName,
      providerId: 'unapproved-random-provider',
      providerName: 'Другой мастер',
      rating: 5,
      comment: 'Отзыв не тому исполнителю',
    });
  } catch (err: any) {
    mismatchedProvFailed = err.message.includes('Нельзя оставить отзыв неподтвержденному исполнителю');
  }
  assert('createReview strictly rejects provider not matching accepted offer', mismatchedProvFailed);

  // Security test 2.4: Provider self-review is strictly rejected
  setCurrentUserId(provider.id);
  let selfReviewFailed = false;
  try {
    await repo.createReview({
      id: uncompletedReq.id,
      requestId: uncompletedReq.id,
      customerId: provider.id,
      providerId: provider.id,
      rating: 5,
      comment: 'Самооценка',
    });
  } catch (err: any) {
    selfReviewFailed = err.message.includes('Исполнитель не может оценивать самого себя') || err.message.includes('Только заказчик может оставить отзыв');
  }
  assert('createReview strictly rejects self-review', selfReviewFailed);

  console.log('\n--- 3. Querying reviews via getReviews ---');
  // Query by requestId
  const reqReviews = await repo.getReviews({ requestId: seededReq.id });
  assert('getReviews by requestId returns exactly 1 review', reqReviews.length === 1);
  assert('getReviews returned the correct review item', reqReviews[0].id === seededReq.id);

  // Query by providerId
  const provReviews = await repo.getReviews({ providerId: provider.id });
  assert('getReviews by providerId returns the provider review', provReviews.length === 1);
  assert('Returned review has correct providerId', provReviews[0].providerId === provider.id);

  // Query for different provider returns empty
  const emptyReviews = await repo.getReviews({ providerId: 'prov-nobody' });
  assert('getReviews for provider without reviews returns empty array', emptyReviews.length === 0);

  console.log('\n--- 4. Dynamic Rating & Review Count Calculation ---');
  // Seed a second request & review for same provider
  const seededReq2 = await repo.createRequest({
    customerId: 'cust-real-2',
    customerName: 'Данияр',
    customerPhone: '+7 705 999 8877',
    city: 'Алматы',
    category: 'Сантехника',
    service: 'Ремонт бачка',
    requestText: 'Ремонт сливного бачка унитаза',
    budget: '8 000 ₸',
    urgency: 'normal',
  });

  const seededOffer2 = await repo.createOffer({
    id: 'OFFER-REAL-2',
    requestId: seededReq2.id,
    providerId: provider.id,
    providerName: provider.name,
    providerPhone: provider.phone,
    providerWhatsapp: provider.whatsapp,
    price: '8 000 ₸',
    priceType: 'fixed',
    availability: 'Сегодня',
    message: 'Починю быстро',
  });

  await repo.acceptOffer(seededReq2.id, seededOffer2.id);
  await repo.updateRequestStatus(seededReq2.id, 'COMPLETED');
  setCurrentUserId(seededReq2.customerId);

  await repo.createReview({
    id: seededReq2.id,
    requestId: seededReq2.id,
    customerId: seededReq2.customerId,
    customerName: seededReq2.customerName,
    providerId: provider.id,
    providerName: provider.name,
    rating: 4,
    comment: 'Хороший мастер',
  });

  const allProvReviews = await repo.getReviews({ providerId: provider.id });
  assert('Provider now has 2 reviews', allProvReviews.length === 2);

  const avgRating = (allProvReviews.reduce((sum, r) => sum + r.rating, 0) / allProvReviews.length).toFixed(1);
  assert('Dynamic average rating is (5+4)/2 = 4.5', avgRating === '4.5');

  console.log('\n--- 5. Translations & i18n ---');
  for (const lang of ['kz', 'ru'] as Language[]) {
    const t = translations[lang];
    assert(`${lang}: rateProviderBtn translation exists`, !!t.rateProviderBtn && t.rateProviderBtn.length > 0);
    assert(`${lang}: rateProviderModalTitle exists`, !!t.rateProviderModalTitle && t.rateProviderModalTitle.length > 0);
    assert(`${lang}: submitRatingBtn exists`, !!t.submitRatingBtn && t.submitRatingBtn.length > 0);
    assert(`${lang}: yourReviewTitle exists`, !!t.yourReviewTitle && t.yourReviewTitle.length > 0);
    assert(`${lang}: selectRatingPrompt exists`, !!t.selectRatingPrompt && t.selectRatingPrompt.length > 0);
  }

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
  console.error('Fatal test error:', err);
  process.exit(1);
});
