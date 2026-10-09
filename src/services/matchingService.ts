import { Provider, ServiceRequest } from '../types';
import { normalizeCategoryId, normalizeCityId, isCategoryMatch } from './taxonomy';

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

  const reqCityId = request.cityId || (request.city ? normalizeCityId(request.city) : undefined);
  
  // Unresolved city check: if city string was provided but normalizes to undefined, return []
  if (request.city && request.city.trim() !== '' && !reqCityId) {
    return [];
  }

  const reqCatId = request.categoryId
    ? normalizeCategoryId(request.categoryId)
    : (request.category ? normalizeCategoryId(request.category) : undefined);
  const normCity = normalizeText(request.city);
  const normCat = normalizeText(request.category);
  const normSrv = normalizeText(request.service);

  // 1. Strict Candidate Eligibility Filter
  const candidateProviders = providers.filter((p) => {
    // Basic profile completeness check
    if (!p || !p.id || !p.name || (!p.city && !p.cityId) || (!p.category && !p.categoryId)) {
      return false;
    }

    // Explicit active state check: isActive === false is excluded
    // isActive === true or undefined (legacy) remains eligible
    if (p.isActive === false) {
      return false;
    }

    // Strict City Filter: If request.cityId is known, provider MUST match request.cityId
    const pCityId = p.cityId ? (normalizeCityId(p.cityId) || p.cityId) : normalizeCityId(p.city);
    if (reqCityId) {
      if (!pCityId || pCityId !== reqCityId) {
        return false;
      }
    }

    return true;
  });

  if (candidateProviders.length === 0) return [];

  // 2. Score Candidate Providers
  const scored = candidateProviders.map((provider) => {
    let score = 0;
    const pCityId = provider.cityId ? (normalizeCityId(provider.cityId) || provider.cityId) : normalizeCityId(provider.city);
    const pCatId = provider.categoryId
      ? normalizeCategoryId(provider.categoryId)
      : (provider.category ? normalizeCategoryId(provider.category) : undefined);
    const pCity = normalizeText(provider.city);
    const pCat = normalizeText(provider.category);
    const pSrv = normalizeText(provider.services);
    const pHours = normalizeText(provider.workingHours);

    // 1. Same City (Highest priority)
    if (reqCityId && pCityId && reqCityId === pCityId) {
      score += 50;
    } else if (pCity === normCity || (normCity && (normCity.includes(pCity) || pCity.includes(normCity)))) {
      score += 50;
    }

    // 2. Same Category (Canonical categoryId check - bridges Kazakh and Russian)
    let catMatch = false;
    if (reqCatId && pCatId && (reqCatId === pCatId || isCategoryMatch(reqCatId, pCatId))) {
      score += 30;
      catMatch = true;
    } else if (pCat === normCat || (normCat && (normCat.includes(pCat) || pCat.includes(normCat)))) {
      score += 30;
      catMatch = true;
    } else if (normCat) {
      const catWords = normCat.split(/\s+/).filter((w) => w.length > 3);
      if (catWords.some((w) => pCat.includes(w))) {
        score += 15;
        catMatch = true;
      }
    }

    // 3. Matching Service
    let srvMatch = false;
    if (normSrv && (pSrv.includes(normSrv) || normSrv.includes(pSrv))) {
      score += 20;
      srvMatch = true;
    } else if (normSrv) {
      const srvWords = normSrv.split(/\s+/).filter((w) => w.length > 3);
      if (srvWords.some((w) => pSrv.includes(w))) {
        score += 10;
        srvMatch = true;
      }
    }

    // Category / Service Mismatch Guard:
    // If request specifies a category or service, but provider matches NEITHER category NOR service,
    // they are not a valid match.
    if ((reqCatId || normCat || normSrv) && !catMatch && !srvMatch) {
      return { provider, score: 0 };
    }

    // 4. Provider Availability (Urgency)
    if (
      request.urgency === 'high' &&
      (pHours.includes('24/7') || pHours.includes('шұғыл') || pHours.includes('круглосуточно'))
    ) {
      score += 10;
    } else if (pHours.length > 0) {
      score += 5;
    }

    // 5. Risk Category Priority: In electrical and heating/gas/boiler, certified providers get priority
    const isRiskCategory =
      reqCatId === 'electrician' ||
      reqCatId === 'heating_boiler' ||
      normCat.includes('электр') ||
      normCat.includes('жылыту') ||
      normCat.includes('отопл') ||
      normCat.includes('бойлер');
    if (isRiskCategory && (provider.hasCertificate || provider.tradeLicense)) {
      score += 15;
    }

    return { provider, score };
  });

  // Sort descending by relevance score
  scored.sort((a, b) => b.score - a.score);

  // Return strong matches (score >= 35)
  const strongMatches = scored.filter((s) => s.score >= 35).map((s) => s.provider);
  if (strongMatches.length > 0) return strongMatches;

  // Fallback: at least city + category match (score >= 30)
  const cityCatMatches = scored.filter((s) => s.score >= 30).map((s) => s.provider);
  if (cityCatMatches.length > 0) return cityCatMatches;

  // If zero candidates satisfy legitimate criteria, return []
  return [];
}
