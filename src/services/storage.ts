import {
  ExtractedNeed,
  normalizeRequestStatus,
  Provider,
  ProviderOffer,
  RequestStatus,
  ServiceRequest,
} from '../types';
import { normalizeCategoryId, normalizeCityId } from './taxonomy';

const STORAGE_KEY_REQUESTS = 'kerek_requests_v1';
const STORAGE_KEY_OFFERS = 'kerek_offers_v1';
const STORAGE_KEY_PROVIDER = 'kerek_provider_profile_v1';
const STORAGE_KEY_COUNTER = 'kerek_req_counter_v1';

// Seeded realistic DEMO providers in Kyzylorda & Kazakhstan cities
export const INITIAL_DEMO_PROVIDERS: Provider[] = [
  // Kyzylorda - Washing machine & appliances
  {
    id: 'demo-p-kzo-1',
    name: '«Сыр Шебері» Кір жуғыш жөндеу (ДЕМО)',
    phone: '+7 724 220 11 22',
    whatsapp: '+77242201122',
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    district: 'Астана даңғылы',
    category: 'Тұрмыстық техника жөндеу',
    categoryId: 'appliances',
    services: 'Кір жуғыш машина жөндеу, мотор және барабан ауыстыру',
    priceRange: '12 000 – 18 000 ₸',
    workingHours: '09:00 - 20:00',
    description: 'Кызылордада 7 жылдан астам тәжірибесі бар мамандар. Түпнұсқа қосалқы бөлшектер.',
    verified: true,
    iinVerified: true,
    hasCertificate: true,
    tradeLicense: 'KZ-TECH-2024-88',
    isDemo: true,
  },
  {
    id: 'demo-p-kzo-2',
    name: '«Арай-Сервис Кызылорда» (ДЕМО)',
    phone: '+7 705 330 44 55',
    whatsapp: '+77053304455',
    city: 'Кызылорда',
    cityId: 'kyzylorda',
    district: 'мкр. Ақмешіт',
    category: 'Ремонт бытовой техники',
    categoryId: 'appliances',
    services: 'Ремонт стиральных машин, замена насосов, электроника',
    priceRange: '10 000 – 22 000 ₸',
    workingHours: '08:30 - 21:00',
    description: 'Выезд по всему городу Кызылорда и пригородам в день обращения.',
    verified: true,
    iinVerified: true,
    isDemo: true,
  },
  {
    id: 'demo-p-kzo-3',
    name: 'Шебер Азамат — жедел жөндеу (ДЕМО)',
    phone: '+7 707 900 88 77',
    whatsapp: '+77079008877',
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    district: 'мкр. Мерей',
    category: 'Тұрмыстық техника жөндеу',
    categoryId: 'appliances',
    services: 'Кір жуғыш машина мен тоңазытқыш жөндеу',
    priceRange: 'Келісімді',
    workingHours: '24/7 шұғыл шақыру',
    description: 'Жедел шақыру, сапалы қызмет және кепілдік беріледі.',
    verified: true,
    isDemo: true,
  },

  // Kyzylorda - Plumbing / Сантехник
  {
    id: 'demo-p-kzo-4',
    name: '«Қызылорда Су-Құбыр» сервисі (ДЕМО)',
    phone: '+7 775 888 12 34',
    whatsapp: '+77758881234',
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    district: 'Орталық',
    category: 'Тұрмыстық қызметтер',
    categoryId: 'home_services',
    services: 'Сантехник қызметі, құбыр ауыстыру, кран жөндеу',
    priceRange: '5 000 – 15 000 ₸',
    workingHours: '08:00 - 22:00',
    description: 'Тұрмыстық сантехниканы толық қалпына келтіру.',
    verified: true,
    isDemo: true,
  },
  {
    id: 'demo-p-kzo-5',
    name: 'Ерлан Сантехник (ДЕМО)',
    phone: '+7 701 444 77 66',
    whatsapp: '+77014447766',
    city: 'Кызылорда',
    cityId: 'kyzylorda',
    district: 'ул. Желтоксан',
    category: 'Бытовые услуги',
    categoryId: 'home_services',
    services: 'Услуги сантехника, устранение засоров',
    priceRange: 'от 5 000 ₸',
    workingHours: '09:00 - 21:00',
    description: 'Частный сантехник с выездом за 30-40 минут.',
    verified: true,
    isDemo: true,
  },

  // Kyzylorda - Cargo & Moving / Газель
  {
    id: 'demo-p-kzo-6',
    name: '«Сырдарья-Транс Газель» (ДЕМО)',
    phone: '+7 708 111 99 22',
    whatsapp: '+77081119922',
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    district: 'Жібек жолы',
    category: 'Жүк тасымалдау',
    categoryId: 'cargo_moving',
    services: 'Көшуге арналған көлік, Газель 4.2м, жүкшілер',
    priceRange: '6 000 ₸/сағат',
    workingHours: '08:00 - 23:00',
    description: 'Қызылорда қаласы мен аудандарға қауіпсіз тасымалдау.',
    verified: true,
    isDemo: true,
  },

  // Almaty & Astana Demo Providers
  {
    id: 'demo-p-ala-1',
    name: '«Алматы МастерТех» (ДЕМО)',
    phone: '+7 777 001 02 03',
    whatsapp: '+77770010203',
    city: 'Алматы',
    cityId: 'almaty',
    district: 'Бостандық ауданы',
    category: 'Тұрмыстық техника жөндеу',
    categoryId: 'appliances',
    services: 'Кір жуғыш машина жөндеу, үйге бару',
    priceRange: '8 000 – 20 000 ₸',
    workingHours: '09:00 - 21:00',
    description: 'Алматы қаласы бойынша кәсіби шеберлер.',
    verified: true,
    isDemo: true,
  },
  {
    id: 'demo-p-ast-1',
    name: '«Астана ПроРемонт» (ДЕМО)',
    phone: '+7 701 999 88 77',
    whatsapp: '+77019998877',
    city: 'Астана',
    cityId: 'astana',
    district: 'Есіл ауданы',
    category: 'Ремонт бытовой техники',
    categoryId: 'appliances',
    services: 'Ремонт стиральных машин и бытовой техники',
    priceRange: '10 000 – 25 000 ₸',
    workingHours: '08:00 - 22:00',
    description: 'Быстрый выезд по левому и правому берегу Астаны.',
    verified: true,
    isDemo: true,
  },
];

// Normalize text for matching
function normalize(str: string): string {
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

export const StorageService = {
  // --- Requests ---
  getRequests(): ServiceRequest[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY_REQUESTS);
      const parsed: ServiceRequest[] = data ? JSON.parse(data) : [];
      return parsed.map((r) => ({
        ...r,
        status: normalizeRequestStatus(r.status),
      }));
    } catch {
      return [];
    }
  },

  getRequestById(id: string): ServiceRequest | undefined {
    const list = this.getRequests();
    return list.find((r) => r.id === id);
  },

  createRequest(need: ExtractedNeed, customerName?: string): ServiceRequest {
    let counter = 1;
    try {
      const c = localStorage.getItem(STORAGE_KEY_COUNTER);
      if (c) counter = parseInt(c, 10) + 1;
    } catch {
      counter = 1;
    }
    localStorage.setItem(STORAGE_KEY_COUNTER, counter.toString());

    const id = `REQ-${counter.toString().padStart(6, '0')}`;
    const newRequest: ServiceRequest = {
      id,
      customerId: 'local-legacy-customer',
      customerName: customerName?.trim() || 'Клиент',
      requestText: need.originalQuery,
      city: need.city,
      cityId: need.cityId || normalizeCityId(need.city),
      category: need.category,
      categoryId: need.categoryId || normalizeCategoryId(need.category),
      service: need.service,
      date: need.date,
      budget: need.budget,
      urgency: need.urgency,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };

    const existing = this.getRequests();
    const updated = [newRequest, ...existing];
    localStorage.setItem(STORAGE_KEY_REQUESTS, JSON.stringify(updated));

    // Generate matching offers automatically for this request
    this.generateMatchingOffersForRequest(newRequest);

    return newRequest;
  },

  updateRequestStatus(
    id: string,
    status: RequestStatus,
    selectedOfferId?: string
  ): ServiceRequest | undefined {
    const list = this.getRequests();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;

    list[idx].status = status;
    if (selectedOfferId && selectedOfferId.trim()) {
      list[idx].selectedOfferId = selectedOfferId.trim();
    }
    localStorage.setItem(STORAGE_KEY_REQUESTS, JSON.stringify(list));
    return list[idx];
  },

  // --- Offers ---
  getOffers(requestId?: string): ProviderOffer[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY_OFFERS);
      const all: ProviderOffer[] = data ? JSON.parse(data) : [];
      if (requestId) {
        return all.filter((o) => o.requestId === requestId);
      }
      return all;
    } catch {
      return [];
    }
  },

  addOffer(offer: ProviderOffer): void {
    const all = this.getOffers();
    const updated = [offer, ...all];
    localStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(updated));

    // If request was MATCHING or NEW, upgrade to OFFERS_RECEIVED
    const req = this.getRequestById(offer.requestId);
    if (req && (req.status === 'MATCHING' || req.status === 'NEW')) {
      this.updateRequestStatus(req.id, 'OFFERS_RECEIVED');
    }
  },

  acceptOffer(requestId: string, offerId: string): void {
    const offers = this.getOffers();
    const updatedOffers = offers.map((o) => {
      if (o.requestId === requestId) {
        if (o.id === offerId) {
          return { ...o, status: 'ACCEPTED' as const };
        } else {
          return { ...o, status: 'REJECTED' as const };
        }
      }
      return o;
    });
    localStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(updatedOffers));
    this.updateRequestStatus(requestId, 'PROVIDER_SELECTED', offerId);
  },

  // --- Providers ---
  getProviderProfile(): Provider | null {
    try {
      const data = localStorage.getItem(STORAGE_KEY_PROVIDER);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  saveProviderProfile(provider: Provider): void {
    localStorage.setItem(STORAGE_KEY_PROVIDER, JSON.stringify(provider));
  },

  getAllProviders(): Provider[] {
    const custom = this.getProviderProfile();
    if (custom) {
      return [custom, ...INITIAL_DEMO_PROVIDERS];
    }
    return INITIAL_DEMO_PROVIDERS;
  },

  // --- Matching Engine ---
  // Prioritizes: 1. Same city (canonical), 2. Same category (canonical), 3. Matching service
  findMatchingProviders(city: string, category: string, service: string): Provider[] {
    const all = this.getAllProviders();
    const reqCityId = normalizeCityId(city);
    const reqCatId = normalizeCategoryId(category);
    const normCity = normalize(city);
    const normCat = normalize(category);
    const normSrv = normalize(service);

    const scored = all.map((provider) => {
      let score = 0;
      const pCityId = provider.cityId || normalizeCityId(provider.city);
      const pCatId = provider.categoryId || normalizeCategoryId(provider.category);
      const pCity = normalize(provider.city);
      const pCat = normalize(provider.category);
      const pSrv = normalize(provider.services);

      // 1. City Match (highest priority) - canonical check with text fallback
      if (reqCityId && pCityId && reqCityId === pCityId) {
        score += 50;
      } else if (pCity === normCity || normCity.includes(pCity) || pCity.includes(normCity)) {
        score += 50;
      }

      // 2. Category Match (canonical check bridges Kazakh and Russian)
      if (reqCatId && pCatId && reqCatId === pCatId) {
        score += 30;
      } else if (pCat === normCat || normCat.includes(pCat) || pCat.includes(normCat)) {
        score += 30;
      } else {
        // Partial category match
        const catWords = normCat.split(/\s+/);
        if (catWords.some((w) => w.length > 3 && pCat.includes(w))) {
          score += 15;
        }
      }

      // 3. Service Match
      if (pSrv.includes(normSrv) || normSrv.includes(pSrv)) {
        score += 20;
      } else {
        const srvWords = normSrv.split(/\s+/);
        if (srvWords.some((w) => w.length > 3 && pSrv.includes(w))) {
          score += 10;
        }
      }

      return { provider, score };
    });

    // Sort descending by match score
    scored.sort((a, b) => b.score - a.score);

    // Return providers with match score or top fallback
    const matched = scored.filter((s) => s.score >= 30).map((s) => s.provider);
    if (matched.length > 0) return matched;

    // Fallback: return any providers matching city or top 3
    const cityMatched = scored.filter((s) => s.score >= 20).map((s) => s.provider);
    if (cityMatched.length > 0) return cityMatched;

    return all.slice(0, 3);
  },

  // Generate simulated realistic demo offers from matching providers
  generateMatchingOffersForRequest(request: ServiceRequest): void {
    const matchedProviders = this.findMatchingProviders(
      request.city,
      request.category,
      request.service
    );

    // Take top matching demo providers (up to 3)
    const demoProviders = matchedProviders.filter((p) => p.isDemo).slice(0, 3);

    const offerTemplates = [
      {
        price: '15 000 ₸',
        availability: 'Бүгін, 40 минут / Сегодня, 40 минут',
        message: 'Құрал-саймандар өзімде бар. Келіп диагностика жасап, дереу жөндеп беремін.',
      },
      {
        price: '18 000 ₸',
        availability: 'Бүгін, 1 сағат / Сегодня, 1 час',
        message: 'Түпнұсқа бөлшектер мен 6 ай ресми кепілдік беремін.',
      },
      {
        price: 'Договорная / Келісімді',
        availability: 'Бүгін, 30 минут / Сегодня, 30 минут',
        message: 'Қазір боспын, жақын жердемін. Бағасын нақты қарап, келісеміз.',
      },
    ];

    const generatedOffers: ProviderOffer[] = demoProviders.map((provider, idx) => {
      const tmpl = offerTemplates[idx % offerTemplates.length];
      return {
        id: `OFFER-${request.id}-${idx + 1}`,
        requestId: request.id,
        providerId: provider.id,
        providerName: provider.name,
        providerPhone: provider.phone,
        providerWhatsapp: provider.whatsapp,
        isDemo: true,
        price: tmpl.price,
        availability: tmpl.availability,
        message: tmpl.message,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
    });

    // Save generated demo offers
    const existingOffers = this.getOffers();
    const updatedOffers = [...generatedOffers, ...existingOffers];
    localStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(updatedOffers));

    if (generatedOffers.length > 0) {
      this.updateRequestStatus(request.id, 'OFFERS_RECEIVED');
    }
  },
};

/**
 * Completely purges all 'kerek_' entries from localStorage.
 */
export function clearAllKerekLocalStorage(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const removed: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('kerek_') || key.startsWith('kerek'))) {
        removed.push(key);
      }
    }
    removed.forEach((k) => localStorage.removeItem(k));
    console.log(`[KEREK] LocalStorage temizlendi (${removed.length} anahtar):`, removed);
  } catch (e) {
    console.warn('[KEREK] LocalStorage temizlenirken hata:', e);
  }
  return removed;
}

/** Settings that are not personal and survive logout: screen language and customer/provider mode. */
const KEEP_ON_LOGOUT = ['kerek_language_v1', 'kerek_app_mode_v1'];

/**
 * Removes this device's copy of the user's data (requests, offers, chats, contacts, location,
 * queued changes) on logout or account deletion, so the next person on the phone can't read it.
 */
export function clearPersonalLocalData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('kerek') && !KEEP_ON_LOGOUT.includes(key)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage unavailable: nothing stored on this device
  }
  try {
    sessionStorage.clear();
  } catch {}
}

