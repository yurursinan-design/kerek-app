// Numbers the server counts from real events (see functions/src/stats.ts): a master's finished
// jobs and answer speed, and typical prices per service. Without a cloud connection there are none.
import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';

export interface ProviderStats {
  completedJobs: number;
  /** Average minutes from a request to this master's offer, when known */
  avgResponseMinutes: number | null;
}

export async function getProviderStats(uid?: string): Promise<ProviderStats | null> {
  if (!uid || !isFirebaseConfigured() || !db) return null;
  try {
    const snap = await getDoc(doc(db, 'providerStats', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    const count = typeof d.responseCount === 'number' ? d.responseCount : 0;
    const total = typeof d.responseMinutesTotal === 'number' ? d.responseMinutesTotal : 0;
    return {
      completedJobs: typeof d.completedJobs === 'number' ? d.completedJobs : 0,
      avgResponseMinutes: count >= 3 ? Math.round(total / count) : null,
    };
  } catch {
    return null;
  }
}

/** "Usually answers within …" in the viewer's language */
export function responseTimeLabel(minutes: number, language: 'kz' | 'ru'): string {
  if (minutes < 60) {
    const m = Math.max(5, Math.ceil(minutes / 5) * 5);
    return language === 'kz' ? `${m} минут ішінде` : `в течение ${m} мин`;
  }
  const h = Math.ceil(minutes / 60);
  if (h < 24) return language === 'kz' ? `${h} сағат ішінде` : `в течение ${h} ч`;
  const days = Math.ceil(h / 24);
  return language === 'kz' ? `${days} күн ішінде` : `в течение ${days} дн.`;
}

export interface PriceRange {
  low: number;
  high: number;
  count: number;
}

const MIN_JOBS_FOR_RANGE = 3;

/** The middle half of recent prices (rounded to 500 ₸), once enough jobs are finished. */
export function middleRange(prices: number[]): { low: number; high: number } | null {
  const sorted = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length < MIN_JOBS_FOR_RANGE) return null;
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const round = (n: number) => Math.max(500, Math.round(n / 500) * 500);
  const low = round(at(0.25));
  const high = Math.max(low, round(at(0.75)));
  return { low, high };
}

export async function getPriceRange(cityId?: string, serviceOrCategoryId?: string): Promise<PriceRange | null> {
  if (!cityId || !serviceOrCategoryId || !isFirebaseConfigured() || !db) return null;
  if (!/^[a-z0-9_]{1,64}$/.test(cityId) || !/^[a-z0-9_]{1,64}$/.test(serviceOrCategoryId)) return null;
  try {
    const snap = await getDoc(doc(db, 'priceStats', `${cityId}_${serviceOrCategoryId}`));
    if (!snap.exists()) return null;
    const prices = Array.isArray(snap.data().prices) ? (snap.data().prices as unknown[]).filter((p): p is number => typeof p === 'number') : [];
    const range = middleRange(prices);
    return range ? { ...range, count: prices.length } : null;
  } catch {
    return null;
  }
}

export function formatTenge(n: number): string {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
}

function ruCount(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

/** "4 отзыва" / "4 пікір" */
export function reviewsCountLabel(reviews: number, lang: 'kz' | 'ru'): string {
  const r = Math.max(0, Math.floor(reviews));
  return lang === 'kz' ? `${r} пікір` : `${r} ${ruCount(r, 'отзыв', 'отзыва', 'отзывов')}`;
}

/**
 * The line under a master's rating: all published reviews and how many different customers wrote
 * them ("15 отзывов от 12 клиентов"). The stars count each customer once, so this shows why.
 */
export function reviewsFromCustomersLabel(reviews: number, customers: number, lang: 'kz' | 'ru'): string {
  const r = Math.max(0, Math.floor(reviews));
  const c = Math.max(0, Math.floor(customers));
  if (lang === 'kz') return `${c} клиенттен ${r} пікір`;
  return `${r} ${ruCount(r, 'отзыв', 'отзыва', 'отзывов')} от ${c} ${ruCount(c, 'клиента', 'клиентов', 'клиентов')}`;
}
