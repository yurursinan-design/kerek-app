import { Provider, ServiceRequest } from '../types';
import { normalizeCategoryId, normalizeCityId } from './taxonomy';

// Helper: Normalize text for matching (Cyrillic + Kazakh letters)
export function normalizeText(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/қ/g, 'к')
    .replace(/ө/g, 'о')
    .replace(/ұ/g, 'у')
    .replace(/ү/g, 'у')
    .replace(/і/g, 'и')
    .replace(/ғ/g, 'г')
    .replace(/ә/g, 'а')
    .trim();
}

/**
 * Matching Priorities:
 * 1. Same city (canonical cityId, weight 50)
 * 2. Same category (canonical categoryId, weight 30)
 * 3. Matching service (weight 20)
 * 4. Provider availability / working hours (weight 10)
 *
 * Anti-Slop / Quality Rule:
 * - Language-agnostic matching across KZ and RU.
 * - Pure relevance ordering.
 */
export function matchProviders(request: ServiceRequest, providers: Provider[]): Provider[] {
  if (!providers || providers.length === 0) return [];

  const reqCityId = request.cityId || normalizeCityId(request.city);
  const reqCatId = request.categoryId || normalizeCategoryId(request.category);
  const normCity = normalizeText(request.city);
  const normCat = normalizeText(request.category);
  const normSrv = normalizeText(request.service);

  const scored = providers.map((provider) => {
    let score = 0;
    const pCityId = provider.cityId || normalizeCityId(provider.city);
    const pCatId = provider.categoryId || normalizeCategoryId(provider.category);
    const pCity = normalizeText(provider.city);
    const pCat = normalizeText(provider.category);
    const pSrv = normalizeText(provider.services);
    const pHours = normalizeText(provider.workingHours);

    // 1. Same City (Highest priority) - canonical check with text fallback
    if (reqCityId && pCityId && reqCityId === pCityId) {
      score += 50;
    } else if (pCity === normCity || normCity.includes(pCity) || pCity.includes(normCity)) {
      score += 50;
    }

    // 2. Same Category (Canonical categoryId check - bridges Kazakh and Russian)
    if (reqCatId && pCatId && reqCatId === pCatId) {
      score += 30;
    } else if (pCat === normCat || normCat.includes(pCat) || pCat.includes(normCat)) {
      score += 30;
    } else {
      const catWords = normCat.split(/\s+/).filter((w) => w.length > 3);
      if (catWords.some((w) => pCat.includes(w))) {
        score += 15;
      }
    }

    // 3. Matching Service
    if (pSrv.includes(normSrv) || normSrv.includes(pSrv)) {
      score += 20;
    } else {
      const srvWords = normSrv.split(/\s+/).filter((w) => w.length > 3);
      if (srvWords.some((w) => pSrv.includes(w))) {
        score += 10;
      }
    }

    // 4. Provider Availability (e.g. 24/7 or covers urgent needs)
    if (
      request.urgency === 'high' &&
      (pHours.includes('24/7') || pHours.includes('шұғыл') || pHours.includes('круглосуточно'))
    ) {
      score += 10;
    } else if (pHours.length > 0) {
      score += 5;
    }

    return { provider, score };
  });

  // Sort descending by relevance score
  scored.sort((a, b) => b.score - a.score);

  // Return strong matches (score >= 35)
  const strongMatches = scored.filter((s) => s.score >= 35).map((s) => s.provider);
  if (strongMatches.length > 0) return strongMatches;

  // Fallback: at least same city (score >= 20)
  const cityMatches = scored.filter((s) => s.score >= 20).map((s) => s.provider);
  if (cityMatches.length > 0) return cityMatches;

  // Final fallback: top 3
  return providers.slice(0, 3);
}
