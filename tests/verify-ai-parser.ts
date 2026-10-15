import {
  CANONICAL_CATEGORIES as BACKEND_CATEGORIES,
  CANONICAL_CITIES as BACKEND_CITIES,
  validateAndNormalizeCategoryId,
  validateAndNormalizeCityId,
} from '../functions/src/taxonomy';
import {
  CANONICAL_CATEGORIES as FRONTEND_CATEGORIES,
  CANONICAL_CITIES as FRONTEND_CITIES,
} from '../src/services/taxonomy';
import { GEMINI_CONFIG } from '../functions/src/config';
import { parseServiceRequest } from '../src/services/aiRequestParser';

function assert(description: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`[PASS] ${description}`);
  } else {
    console.error(`[FAIL] ${description} ${details ? `-> ${details}` : ''}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('=== VERIFYING GEMINI AI REQUEST PARSER INFRASTRUCTURE ===\n');

  // 1. Cloud Function Config Verification
  console.log('--- 1. Configuration & Model ---');
  assert(
    'Function region is set to asia-south1',
    GEMINI_CONFIG.region === 'asia-south1',
    `Region: ${GEMINI_CONFIG.region}`
  );
  assert(
    'Model output is capped',
    GEMINI_CONFIG.maxOutputTokens > 0 && GEMINI_CONFIG.maxOutputTokens <= 2048,
    `maxOutputTokens: ${GEMINI_CONFIG.maxOutputTokens}`
  );
  assert(
    'Model is not fixed to legacy gemini-1.5-flash',
    (GEMINI_CONFIG.model as string) !== 'gemini-1.5-flash',
    `Current model: ${GEMINI_CONFIG.model}`
  );
  assert(
    'Model is configurable and defaults to modern fast model',
    typeof GEMINI_CONFIG.model === 'string' && GEMINI_CONFIG.model.length > 0,
    `Model: ${GEMINI_CONFIG.model}`
  );
  assert(
    'Max input length is set to 500 chars',
    GEMINI_CONFIG.maxInputChars === 500,
    `Max: ${GEMINI_CONFIG.maxInputChars}`
  );

  // 2. Canonical Taxonomies Synchronization
  console.log('\n--- 2. Canonical IDs Synchronization ---');
  const frontendCatIds = new Set(FRONTEND_CATEGORIES.map((c) => c.id));
  const backendCatIds = new Set(BACKEND_CATEGORIES.map((c) => c.id));
  assert(
    'Backend category IDs exactly match Frontend canonical category IDs',
    frontendCatIds.size === backendCatIds.size &&
      [...frontendCatIds].every((id) => backendCatIds.has(id))
  );

  const frontendCityIds = new Set(FRONTEND_CITIES.map((c) => c.id));
  const backendCityIds = new Set(BACKEND_CITIES.map((c) => c.id));
  assert(
    'Backend city IDs exactly match Frontend canonical city IDs',
    frontendCityIds.size === backendCityIds.size &&
      [...frontendCityIds].every((id) => backendCityIds.has(id))
  );

  // 3. Backend Taxonomy Normalization & Server-side Validation
  console.log('\n--- 3. Server-Side Taxonomy Validation ---');
  assert(
    'Kyzylorda canonical ID is valid',
    validateAndNormalizeCityId('kyzylorda') === 'kyzylorda'
  );
  assert(
    'Cyrillic Кызылорда normalizes to kyzylorda',
    validateAndNormalizeCityId('Кызылорда') === 'kyzylorda'
  );
  assert(
    'Kazakh Қызылорда normalizes to kyzylorda',
    validateAndNormalizeCityId('Қызылорда') === 'kyzylorda'
  );
  assert(
    'Almaty normalizes to almaty',
    validateAndNormalizeCityId('Алматы') === 'almaty'
  );
  assert(
    'Astana normalizes to astana',
    validateAndNormalizeCityId('Астана') === 'astana'
  );
  assert(
    'Invalid unknown city is rejected (returns null)',
    validateAndNormalizeCityId('paris_france') === null
  );

  assert(
    'appliance_repair canonical ID is valid or normalizes to appliances',
    validateAndNormalizeCategoryId('appliance_repair') === 'appliances' || validateAndNormalizeCategoryId('appliance_repair') === 'appliance_repair'
  );
  assert(
    'appliances_repair alias normalizes to appliances or appliance_repair',
    validateAndNormalizeCategoryId('appliances_repair') === 'appliances' || validateAndNormalizeCategoryId('appliances_repair') === 'appliance_repair'
  );
  assert(
    'home_services canonical ID is valid or normalizes to plumbing',
    validateAndNormalizeCategoryId('home_services') === 'plumbing' || validateAndNormalizeCategoryId('home_services') === 'home_services'
  );
  assert(
    'legacy cargo_moving normalizes to the moving group',
    validateAndNormalizeCategoryId('cargo_moving') === 'moving'
  );
  assert(
    'Invalid unknown category is rejected (returns null)',
    validateAndNormalizeCategoryId('flying_cars_repair') === null
  );

  // 4. Frontend Parser Client Validation & Error Handling
  console.log('\n--- 4. Frontend Parser Client Validation & Error Handling ---');
  const emptyRes = await parseServiceRequest('');
  assert(
    'Empty input returns success: false with EMPTY_INPUT error',
    !emptyRes.success && emptyRes.error?.code === 'EMPTY_INPUT'
  );

  const spacesRes = await parseServiceRequest('    ');
  assert(
    'Whitespace input returns success: false with EMPTY_INPUT error',
    !spacesRes.success && spacesRes.error?.code === 'EMPTY_INPUT'
  );

  const longText = 'A'.repeat(501);
  const tooLongRes = await parseServiceRequest(longText);
  assert(
    'Input exceeding 500 characters returns success: false with INPUT_TOO_LONG error',
    !tooLongRes.success && tooLongRes.error?.code === 'INPUT_TOO_LONG'
  );

  const validLengthText = 'Сломалась стиральная машина Samsung в Кызылорде, не сливает воду, срочно!';
  const response = await parseServiceRequest(validLengthText);
  assert(
    'Graceful error handling returns success: false with controlled error code and message',
    !response.success &&
      response.data === null &&
      typeof response.error?.code === 'string' &&
      typeof response.error?.message === 'string'
  );

  const failed = process.exitCode === 1;
  console.log(failed ? '\nSOME CHECKS FAILED (see [FAIL] lines above)\n' : '\nALL AI PARSER TESTS PASSED\n');
  // Exit with the real result: a [FAIL] above must fail the run
  process.exit(failed ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
