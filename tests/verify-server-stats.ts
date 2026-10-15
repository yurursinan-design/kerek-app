/**
 * Counted numbers (functions/src/stats.ts and src/services/publicStats.ts): answer time, price
 * parsing, the price-list key, and the typical price range shown to customers and masters.
 */
import { middleRange, responseTimeLabel } from '../src/services/publicStats';

let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
    failed++;
  }
}

async function main() {
  // Loaded by path so the app's type check doesn't need the functions' own packages installed
  const modulePath = '../functions/src/stats';
  const st = await import(modulePath);

  assert(st.responseMinutes('2026-10-15T10:00:00Z', '2026-10-15T10:25:00Z') === 25, 'Answer time in minutes');
  assert(st.responseMinutes('2026-10-15T10:00:00Z', '2026-10-30T10:00:00Z') === 7 * 24 * 60, 'Very late answers count as a week');
  assert(st.responseMinutes('2026-10-15T10:00:00Z', '2026-10-15T09:00:00Z') === null, 'An offer before the request is ignored');
  assert(st.responseMinutes(undefined, '2026-10-15T09:00:00Z') === null, 'Unknown request time is ignored');

  assert(st.priceAmount('12 000 ₸') === 12000, 'Fixed price is read');
  assert(st.priceAmount('от 5 000 ₸') === null, '"From" prices are not counted');
  assert(st.priceAmount('5 000 – 8 000 ₸') === null, 'Ranges are not counted');
  assert(st.priceAmount('После осмотра') === null, '"After inspection" is not a price');
  assert(st.priceAmount('100 ₸') === null && st.priceAmount('99999999999') === null, 'Nonsense amounts are skipped');

  assert(st.priceKey('kyzylorda', 'tap_repair') === 'kyzylorda_tap_repair', 'Price list key');
  assert(st.priceKey('kyzylorda', '../x') === null && st.priceKey('', 'plumbing') === null, 'Bad ids give no key');

  assert(middleRange([5000, 7000]) === null, 'No range until 3 jobs');
  const r = middleRange([4000, 6000, 8000, 10000, 30000]);
  assert(!!r && r.low === 6000 && r.high === 10000, 'Middle half of prices, one very high price ignored', r);
  const r2 = middleRange([7300, 7300, 7300]);
  assert(!!r2 && r2.low === 7500 && r2.high === 7500, 'Rounded to 500 ₸', r2);

  assert(responseTimeLabel(12, 'ru') === 'в течение 15 мин', 'Answer time label (minutes)');
  assert(responseTimeLabel(130, 'kz') === '3 сағат ішінде', 'Answer time label (hours, kz)');

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
