import { analyzeRequestUnderstanding, understandingToExtractedNeed } from '../src/services/requestUnderstanding';
import {
  normalizeCategoryId,
  normalizeCityId,
  getCategoryDisplayName,
  getCityDisplayName,
} from '../src/services/taxonomy';
import { LocalRepository } from '../src/services/localRepository';
import { ExtractedNeed, ServiceRequest } from '../src/types';

// Mock localStorage
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

function assert(desc: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`[PASS] ${desc}`);
  } else {
    console.error(`[FAIL] ${desc} ${details ? `-> ${details}` : ''}`);
    process.exitCode = 1;
  }
}

async function runSparkPlanTests() {
  console.log('=== RUNNING VERIFICATION FOR FIREBASE SPARK PLAN COMPATIBILITY ===\n');

  const query = 'Қызылордада Samsung кір жуғыш машинам су ағызбай тұр, шұғыл шебер керек';
  console.log(`Test query: "${query}"\n`);

  // --- Step 1: Local parsing on Spark Plan (No Cloud Functions deployed) ---
  console.log('--- 1. Local Parser Execution (Spark Plan Fallback) ---');
  // The engine the app actually runs when no Cloud Function answers (App.handleSearch)
  const understanding = analyzeRequestUnderstanding(query, { language: 'kz' } as any);
  const parsedKz: any = understandingToExtractedNeed(understanding, query, 'kz');
  console.log('Local parsed result (KZ):', JSON.stringify(parsedKz, null, 2));

  assert('cityId is "kyzylorda"', parsedKz.cityId === 'kyzylorda');
  assert('city is "Қызылорда"', parsedKz.city === 'Қызылорда');
  assert('categoryId is "appliances"', parsedKz.categoryId === 'appliances');
  assert('category is "Техника жөндеу"', parsedKz.category === 'Техника жөндеу');
  assert(
    'service identifies Samsung washing machine repair',
    parsedKz.service.toLowerCase().includes('samsung') &&
      (parsedKz.service.includes('кір') || parsedKz.service.includes('машина')),
    `Service: ${parsedKz.service}`
  );
  assert('urgency is "high"', parsedKz.urgency === 'high');
  assert('confidence >= 0.70', (parsedKz.confidence ?? 0) >= 0.70, `Confidence: ${parsedKz.confidence}`);
  assert('originalQuery is preserved verbatim', parsedKz.originalQuery === query);

  // --- Step 2: Canonical taxonomy synchronization ---
  console.log('\n--- 2. Canonical Taxonomy Verification ---');
  assert('normalizeCityId matches canonical', normalizeCityId(parsedKz.city) === 'kyzylorda');
  assert('normalizeCategoryId matches canonical', normalizeCategoryId(parsedKz.category) === 'appliances');
  assert('legacy appliance_repair alias normalizes to canonical', normalizeCategoryId('appliance_repair') === 'appliances');
  assert('getCityDisplayName KZ matches', getCityDisplayName('kyzylorda', 'kz') === 'Қызылорда');
  assert('getCategoryDisplayName KZ matches', getCategoryDisplayName('appliance_repair', 'kz') === 'Техника жөндеу');

  // --- Step 3: Confirmation UI State Evaluation ---
  console.log('\n--- 3. Confirmation UI Evaluation ---');
  const isHighConfidence = Boolean((parsedKz.confidence ?? 0.95) >= 0.70);
  assert('isHighConfidence is true (triggers direct Confirmation Card)', isHighConfidence === true);
  assert('aiError is null (no error banners shown to user on Spark plan)', parsedKz.aiError == null);

  // --- Step 4: Verification BEFORE user confirmation ---
  console.log('\n--- 4. Pre-Confirmation Storage Check ---');
  const repo = new LocalRepository();
  const customerId = 'spark-test-user-42';

  const preRequests = await repo.getRequests({ customerId });
  assert('Zero requests exist before user confirmation', preRequests.length === 0);

  // --- Step 5: User Confirms -> Existing repository.createRequest ---
  console.log('\n--- 5. User Confirms -> createRequest Execution ---');
  const createdReq: ServiceRequest = await repo.createRequest({
    customerId,
    requestText: parsedKz.originalQuery,
    description: parsedKz.originalQuery,
    city: parsedKz.city,
    cityId: parsedKz.cityId,
    category: parsedKz.category,
    categoryId: parsedKz.categoryId,
    service: parsedKz.service,
    date: parsedKz.date,
    budget: parsedKz.budget,
    urgency: parsedKz.urgency,
    status: 'OPEN',
  });

  assert('Request was created successfully', Boolean(createdReq && createdReq.id));
  assert('Request status is "OPEN"', createdReq.status === 'OPEN');
  assert('Request customerId matches user', createdReq.customerId === customerId);
  assert('Request cityId is "kyzylorda"', createdReq.cityId === 'kyzylorda');
  assert('Request categoryId is "appliances"', createdReq.categoryId === 'appliances');
  assert('Request description retains query', createdReq.description === query);
  assert('Request urgency is "high"', createdReq.urgency === 'high');

  // --- Step 6: Exactly 1 request (No duplicates) ---
  console.log('\n--- 6. Duplicate Prevention Check ---');
  const postRequests = await repo.getRequests({ customerId });
  assert('Exactly ONE request exists (no duplicates)', postRequests.length === 1);
  assert('Existing request id matches created id', postRequests[0].id === createdReq.id);

  const failed = process.exitCode === 1;
  console.log(failed ? '\nSOME CHECKS FAILED (see [FAIL] lines above)\n' : '\nALL CHECKS PASSED\n');
  // Exit with the real result: a [FAIL] above must fail the run
  process.exit(failed ? 1 : 0);
}

runSparkPlanTests().catch((err) => {
  console.error('Spark plan test error:', err);
  process.exit(1);
});
