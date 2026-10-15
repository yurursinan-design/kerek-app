import { parseTextWithGemini } from '../functions/src/geminiParser';
import {
  normalizeCategoryId,
  normalizeCityId,
  getCategoryDisplayName,
  getCityDisplayName,
} from '../src/services/taxonomy';
import { analyzeRequestLocally } from '../src/services/analyzer';
import { LocalRepository } from '../src/services/localRepository';
import { ExtractedNeed, ServiceRequest } from '../src/types';

// Mock localStorage for test environment
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

async function runE2ETests() {
  console.log('=== RUNNING END-TO-END VERIFICATION OF GEMINI AI REQUEST PARSER ===\n');

  const testQuery = 'Қызылордада Samsung кір жуғыш машинам су ағызбай тұр, шұғыл шебер керек';
  console.log(`Input query: "${testQuery}"\n`);

  // --- Step 1: Real Gemini AI Parser Execution ---
  console.log('--- 1. Real Gemini AI Parser Execution ---');
  const apiKey = process.env.GEMINI_API_KEY;
  assert('GEMINI_API_KEY is available in environment', Boolean(apiKey && apiKey.length > 5));

  let aiResult;
  try {
    aiResult = await parseTextWithGemini(testQuery, apiKey!);
    console.log('Gemini actual parsed output:', JSON.stringify(aiResult, null, 2));
  } catch (err: any) {
    console.error('Gemini invocation error:', err);
  }

  assert('AI Result is defined', Boolean(aiResult));
  assert(
    'cityId returned by Gemini is "kyzylorda"',
    aiResult?.cityId === 'kyzylorda',
    `Received: ${aiResult?.cityId}`
  );
  assert(
    'categoryId returned by Gemini is "appliances"',
    aiResult?.categoryId === 'appliances',
    `Received: ${aiResult?.categoryId}`
  );
  assert(
    'service describes Samsung washing machine repair',
    Boolean(aiResult?.service && aiResult.service.toLowerCase().includes('samsung') && (aiResult.service.includes('кір') || aiResult.service.includes('стирал') || aiResult.service.includes('машин'))),
    `Service: ${aiResult?.service}`
  );
  assert(
    'urgency returned by Gemini is "high"',
    aiResult?.urgency === 'high',
    `Received: ${aiResult?.urgency}`
  );
  assert(
    'confidence is >= 0.70',
    typeof aiResult?.confidence === 'number' && aiResult.confidence >= 0.70,
    `Confidence: ${aiResult?.confidence}`
  );

  // --- Step 2: Frontend Canonical Taxonomy Verification ---
  console.log('\n--- 2. Frontend Canonical Taxonomy Verification ---');
  const canonicalCityId = normalizeCityId(aiResult?.cityId || undefined);
  const canonicalCategoryId = normalizeCategoryId(aiResult?.categoryId || undefined);

  assert('Frontend canonical cityId is "kyzylorda"', canonicalCityId === 'kyzylorda');
  assert('Frontend canonical categoryId is "appliances"', canonicalCategoryId === 'appliances');

  const cityDisplayKz = getCityDisplayName(canonicalCityId, 'kz');
  const catDisplayKz = getCategoryDisplayName(canonicalCategoryId, 'kz');
  assert('Kazakh city display name is "Қызылорда"', cityDisplayKz === 'Қызылорда');
  assert('Kazakh category display name is "Тұрмыстық техника жөндеу"', catDisplayKz === 'Тұрмыстық техника жөндеу');

  // --- Step 3: Confirmation UI State Construction ---
  console.log('\n--- 3. Confirmation UI State Construction ---');
  const combinedNeed: ExtractedNeed = {
    city: cityDisplayKz,
    cityId: canonicalCityId,
    category: catDisplayKz,
    categoryId: canonicalCategoryId,
    service: aiResult?.service || 'Samsung кір жуғыш машинасын жөндеу',
    date: 'Бүгін',
    budget: 'Келісімді',
    urgency: aiResult?.urgency || 'high',
    originalQuery: testQuery,
    confidence: aiResult?.confidence,
    isAiParsed: true,
  };

  const isHighConfidence = Boolean(combinedNeed.isAiParsed && (combinedNeed.confidence ?? 0) >= 0.70);
  assert('isHighConfidence is true (triggers AI Confirmation Card UI)', isHighConfidence === true);

  // --- Step 4: Verification BEFORE Customer Confirmation ---
  console.log('\n--- 4. Verification BEFORE Customer Confirmation ---');
  const repo = new LocalRepository();
  const customerId = 'test-customer-e2e-1';

  const requestsBeforeConfirmation = await repo.getRequests({ customerId });
  assert(
    'Zero requests in repository BEFORE customer clicks "Иә, жалғастыру"',
    requestsBeforeConfirmation.length === 0,
    `Found: ${requestsBeforeConfirmation.length}`
  );

  // --- Step 5 & 6: Customer Confirms -> Invokes createRequest ---
  console.log('\n--- 5 & 6. Customer Confirms -> Repository createRequest ---');
  const createdRequest: ServiceRequest = await repo.createRequest({
    customerId,
    requestText: combinedNeed.originalQuery,
    description: combinedNeed.originalQuery,
    city: combinedNeed.city,
    cityId: combinedNeed.cityId,
    category: combinedNeed.category,
    categoryId: combinedNeed.categoryId,
    service: combinedNeed.service,
    date: combinedNeed.date,
    budget: combinedNeed.budget,
    urgency: combinedNeed.urgency,
    status: 'OPEN',
  });

  assert('Request created successfully', Boolean(createdRequest && createdRequest.id));
  assert('Request ID starts with REQ-', createdRequest.id.startsWith('REQ-'));

  const requestsAfterConfirmation = await repo.getRequests({ customerId });
  assert(
    'Exactly ONE request exists after confirmation (NO DUPLICATES)',
    requestsAfterConfirmation.length === 1,
    `Total requests: ${requestsAfterConfirmation.length}`
  );

  // --- Step 7: Request Field Integrity Verification ---
  console.log('\n--- 7. Request Field Integrity Verification ---');
  const req = requestsAfterConfirmation[0];
  assert('customerId matches authenticated user', req.customerId === customerId);
  assert('cityId is "kyzylorda"', req.cityId === 'kyzylorda');
  assert('categoryId is "appliances"', req.categoryId === 'appliances');
  assert('description preserves original user query', req.description === testQuery);
  assert('requestText preserves original user query', req.requestText === testQuery);
  assert('urgency is "high"', req.urgency === 'high');
  assert('status is "OPEN"', req.status === 'OPEN');

  // --- Step 8: Fallback verification when AI fails ---
  console.log('\n--- 8. Fallback Verification (analyzeRequestLocally) ---');
  const fallbackResult = analyzeRequestLocally(testQuery, 'kz');
  assert('Fallback identifies city "Қызылорда"', fallbackResult.city === 'Қызылорда');
  assert('Fallback normalizes cityId "kyzylorda"', normalizeCityId(fallbackResult.city) === 'kyzylorda');
  assert('Fallback normalizes categoryId "appliances"', normalizeCategoryId(fallbackResult.category) === 'appliances');
  assert('Fallback preserves original query', fallbackResult.originalQuery === testQuery);

  const failed = process.exitCode === 1;
  console.log(failed ? '\nSOME CHECKS FAILED (see [FAIL] lines above)\n' : '\nALL CHECKS PASSED\n');
  // Exit with the real result: a [FAIL] above must fail the run
  process.exit(failed ? 1 : 0);
}

runE2ETests().catch((err) => {
  console.error('E2E Test failed:', err);
  process.exit(1);
});
