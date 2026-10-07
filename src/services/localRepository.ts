import {
  normalizeRequestStatus,
  Provider,
  ProviderOffer,
  RequestStatus,
  Review,
  ServiceRequest,
  User,
} from '../types';
import {
  OfferFilter,
  ProviderFilter,
  Repository,
  RequestFilter,
  ReviewFilter,
} from './repository';
import { INITIAL_DEMO_PROVIDERS } from './storage';
import { matchProviders } from './matchingService';
import {
  validateOfferData,
  validateProviderData,
  validateRequestData,
  validateReviewData,
} from './validation';
import { logTechnicalError } from './errorHandler';
import { auth } from './firebase';
import { normalizeCategoryId, normalizeCityId } from './taxonomy';

const STORAGE_KEY_USER_ID = 'kerek_current_user_id_v2';
const STORAGE_KEY_USERS = 'kerek_users_v2';
const STORAGE_KEY_PROVIDERS = 'kerek_providers_v2';
const STORAGE_KEY_CURRENT_PROVIDER = 'kerek_provider_profile_v1';
const STORAGE_KEY_REQUESTS = 'kerek_requests_v1';
const STORAGE_KEY_OFFERS = 'kerek_offers_v1';
const STORAGE_KEY_REVIEWS = 'kerek_reviews_v1';
const STORAGE_KEY_COUNTER = 'kerek_req_counter_v1';

const memoryStore = new Map<string, string>();
const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(key);
        if (val !== null) return val;
      }
    } catch {}
    return memoryStore.get(key) || null;
  },
  setItem: (key: string, val: string): void => {
    memoryStore.set(key, val);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, val);
      }
    } catch {}
  },
  removeItem: (key: string): void => {
    memoryStore.delete(key);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {}
  },
};

// Generate UUID safely with fallback
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback
    }
  }
  return 'usr-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

// Get or initialize persistent local user ID (synchronizes with Firebase Auth UID when available)
export function getCurrentUserId(): string {
  try {
    if (auth?.currentUser?.uid) {
      try {
        safeStorage.setItem(STORAGE_KEY_USER_ID, auth.currentUser.uid);
      } catch {}
      return auth.currentUser.uid;
    }

    let uid = safeStorage.getItem(STORAGE_KEY_USER_ID);
    if (!uid) {
      uid = generateUUID();
      safeStorage.setItem(STORAGE_KEY_USER_ID, uid);
    }
    return uid;
  } catch {
    return 'temp-local-user-id';
  }
}

// Helper: Normalize string for search filtering
function normalizeText(str: string): string {
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

export class LocalRepository implements Repository {
  // =================== Users ===================
  async createUser(userData: Partial<User>): Promise<User> {
    try {
      const id = userData.id || getCurrentUserId();
      const newUser: User = {
        id,
        role: userData.role || 'customer',
        name: userData.name || '',
        phone: userData.phone || '',
        createdAt: new Date().toISOString(),
      };

      const users = await this.getAllUsers();
      const existingIdx = users.findIndex((u) => u.id === id);
      if (existingIdx >= 0) {
        users[existingIdx] = { ...users[existingIdx], ...newUser };
      } else {
        users.push(newUser);
      }
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
      return newUser;
    } catch (e) {
      logTechnicalError('LocalRepository.createUser', e);
      throw e;
    }
  }

  async getUser(userId: string): Promise<User | null> {
    try {
      const users = await this.getAllUsers();
      return users.find((u) => u.id === userId) || null;
    } catch (e) {
      logTechnicalError('LocalRepository.getUser', e);
      return null;
    }
  }

  private async getAllUsers(): Promise<User[]> {
    try {
      const data = localStorage.getItem(STORAGE_KEY_USERS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // =================== Providers ===================
  async createProvider(providerData: Partial<Provider>): Promise<Provider> {
    // 1. Data Validation
    const validation = validateProviderData(providerData);
    if (!validation.valid) {
      throw new Error(`Validation Error: ${validation.message}`);
    }

    try {
      const userId = providerData.userId || getCurrentUserId();
      const id = providerData.id || userId;

      const city = providerData.city?.trim() || 'Қызылорда';
      const cityId = providerData.cityId || normalizeCityId(city);
      const category = providerData.category?.trim() || '';
      const categoryId = providerData.categoryId || normalizeCategoryId(category);

      const newProvider: Provider = {
        id,
        userId,
        name: providerData.name?.trim() || '',
        phone: providerData.phone?.trim() || '',
        whatsapp: (providerData.whatsapp || providerData.phone)?.trim() || '',
        city,
        cityId,
        district: providerData.district?.trim() || '',
        category,
        categoryId,
        services: providerData.services?.trim() || '',
        priceRange: providerData.priceRange?.trim() || '',
        workingHours: providerData.workingHours?.trim() || '09:00 - 20:00',
        description: providerData.description?.trim() || '',
        ...(providerData.experienceYears !== undefined && providerData.experienceYears > 0
          ? { experienceYears: providerData.experienceYears }
          : {}),
        verified: providerData.verified ?? false,
        isDemo: false,
      };

      localStorage.setItem(STORAGE_KEY_CURRENT_PROVIDER, JSON.stringify(newProvider));

      const list = await this.getCustomProviders();
      const idx = list.findIndex((p) => p.id === id);
      if (idx >= 0) {
        list[idx] = newProvider;
      } else {
        list.push(newProvider);
      }
      localStorage.setItem(STORAGE_KEY_PROVIDERS, JSON.stringify(list));
      return newProvider;
    } catch (e) {
      logTechnicalError('LocalRepository.createProvider', e);
      throw e;
    }
  }

  async getProvider(providerId: string): Promise<Provider | null> {
    try {
      const all = await this.getProviders();
      return all.find((p) => p.id === providerId) || null;
    } catch (e) {
      logTechnicalError('LocalRepository.getProvider', e);
      return null;
    }
  }

  async getProviders(filter?: ProviderFilter): Promise<Provider[]> {
    try {
      const custom = await this.getCustomProviders();
      const currentProfile = this.getCurrentProviderProfile();
      let combined = [...custom];
      if (currentProfile && !combined.some((p) => p.id === currentProfile.id)) {
        combined.unshift(currentProfile);
      }

      // Merge with seeded DEMO providers
      const all = [...combined, ...INITIAL_DEMO_PROVIDERS].map((p) => ({
        ...p,
        cityId: p.cityId || normalizeCityId(p.city),
        categoryId: p.categoryId || normalizeCategoryId(p.category),
      }));

      if (!filter) return all;

      const targetCityId = filter.cityId || (filter.city ? normalizeCityId(filter.city) : undefined);
      const targetCatId = filter.categoryId || (filter.category ? normalizeCategoryId(filter.category) : undefined);

      return all.filter((p) => {
        if (targetCityId && p.cityId !== targetCityId) {
          return false;
        }
        if (targetCatId && p.categoryId !== targetCatId) {
          return false;
        }
        return true;
      });
    } catch (e) {
      logTechnicalError('LocalRepository.getProviders', e);
      return INITIAL_DEMO_PROVIDERS;
    }
  }

  private getCurrentProviderProfile(): Provider | null {
    try {
      const data = localStorage.getItem(STORAGE_KEY_CURRENT_PROVIDER);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private async getCustomProviders(): Promise<Provider[]> {
    try {
      const data = localStorage.getItem(STORAGE_KEY_PROVIDERS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // =================== Requests ===================
  async createRequest(requestData: Partial<ServiceRequest>): Promise<ServiceRequest> {
    // 1. Validation
    const validation = validateRequestData(requestData);
    if (!validation.valid) {
      throw new Error(`Validation Error: ${validation.message}`);
    }

    try {
      // 2. Safe Unique Request ID Generation
      // Instead of relying solely on array length or counter, calculate the max existing numeric ID + 1
      const existing = await this.getAllRequestsRaw();
      let maxIdNum = 0;
      for (const req of existing) {
        const match = req.id.match(/^REQ-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxIdNum) maxIdNum = num;
        }
      }

      let storedCounter = 0;
      try {
        const c = safeStorage.getItem(STORAGE_KEY_COUNTER);
        if (c) storedCounter = parseInt(c, 10);
      } catch {
        storedCounter = 0;
      }

      const nextNum = Math.max(maxIdNum, storedCounter) + 1;
      safeStorage.setItem(STORAGE_KEY_COUNTER, nextNum.toString());

      const id = requestData.id || `REQ-${nextNum.toString().padStart(6, '0')}`;
      const customerId = requestData.customerId || getCurrentUserId();

      const city = requestData.city?.trim() || 'Қызылорда';
      const cityId = requestData.cityId || normalizeCityId(city);
      const category = requestData.category?.trim() || 'Тұрмыстық техника жөндеу';
      const categoryId = requestData.categoryId || normalizeCategoryId(category);
      const reqText = (requestData.requestText || requestData.description || requestData.service || '').trim();
      const service = (requestData.service || reqText || category).trim();

      const newRequest: ServiceRequest = {
        id,
        customerId,
        customerName: requestData.customerName?.trim() || 'Клиент',
        customerPhone: requestData.customerPhone?.trim(),
        requestText: reqText || service,
        description: requestData.description?.trim() || reqText || service,
        city,
        cityId,
        category,
        categoryId,
        service,
        date: requestData.date?.trim() || 'Бүгін',
        budget: requestData.budget?.trim() || 'Келісімді',
        urgency: requestData.urgency || 'normal',
        status: requestData.status || 'OPEN',
        createdAt: new Date().toISOString(),
      };

      const filteredExisting = existing.filter((r) => r.id !== id);
      const updated = [newRequest, ...filteredExisting];
      safeStorage.setItem(STORAGE_KEY_REQUESTS, JSON.stringify(updated));

      // Generate simulated matching offers from demo providers
      await this.generateDemoOffersForRequest(newRequest);

      return newRequest;
    } catch (e) {
      logTechnicalError('LocalRepository.createRequest', e);
      throw e;
    }
  }

  async getRequest(requestId: string): Promise<ServiceRequest | null> {
    try {
      const list = await this.getAllRequestsRaw();
      const req = list.find((r) => r.id === requestId);
      if (!req) return null;
      return {
        ...req,
        status: normalizeRequestStatus(req.status),
        cityId: req.cityId || normalizeCityId(req.city),
        categoryId: req.categoryId || normalizeCategoryId(req.category),
      };
    } catch (e) {
      logTechnicalError('LocalRepository.getRequest', e);
      return null;
    }
  }

  async getRequests(filter?: RequestFilter): Promise<ServiceRequest[]> {
    try {
      const all = await this.getAllRequestsRaw();
      const enriched = all.map((r) => ({
        ...r,
        status: normalizeRequestStatus(r.status),
        cityId: r.cityId || normalizeCityId(r.city),
        categoryId: r.categoryId || normalizeCategoryId(r.category),
      }));

      if (!filter) return enriched;

      const targetCityId = filter.cityId || (filter.city ? normalizeCityId(filter.city) : undefined);
      const targetCatId = filter.categoryId || (filter.category ? normalizeCategoryId(filter.category) : undefined);

      return enriched.filter((r) => {
        // Customer Security Filter: Customer only sees their own requests
        if (filter.customerId && r.customerId !== filter.customerId) {
          return false;
        }
        // City Filter (canonical cityId check)
        if (targetCityId && r.cityId !== targetCityId) {
          return false;
        }
        // Category Filter (canonical categoryId check bridges KZ and RU)
        if (targetCatId && r.categoryId !== targetCatId) {
          return false;
        }
        return true;
      });
    } catch (e) {
      logTechnicalError('LocalRepository.getRequests', e);
      return [];
    }
  }

  async updateRequest(
    requestId: string,
    updates: Partial<ServiceRequest>
  ): Promise<ServiceRequest | null> {
    try {
      const list = await this.getAllRequestsRaw();
      const idx = list.findIndex((r) => r.id === requestId);
      if (idx === -1) return null;

      list[idx] = { ...list[idx], ...updates };
      safeStorage.setItem(STORAGE_KEY_REQUESTS, JSON.stringify(list));
      return {
        ...list[idx],
        status: normalizeRequestStatus(list[idx].status),
      };
    } catch (e) {
      logTechnicalError('LocalRepository.updateRequest', e);
      return null;
    }
  }

  async updateRequestStatus(
    requestId: string,
    status: RequestStatus,
    selectedOfferId?: string
  ): Promise<ServiceRequest | null> {
    const updates: Partial<ServiceRequest> = { status };
    if (selectedOfferId && selectedOfferId.trim()) {
      updates.selectedOfferId = selectedOfferId.trim();
    }
    return this.updateRequest(requestId, updates);
  }

  private async getAllRequestsRaw(): Promise<ServiceRequest[]> {
    try {
      const data = safeStorage.getItem(STORAGE_KEY_REQUESTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // =================== Offers ===================
  async createOffer(offerData: Partial<ProviderOffer>): Promise<ProviderOffer> {
    // 1. Validation
    const validation = validateOfferData(offerData);
    if (!validation.valid) {
      throw new Error(`Validation Error: ${validation.message}`);
    }

    try {
      const priceType = offerData.priceType || 'fixed';
      let price = (offerData.price || '').trim();
      if (priceType === 'inspection') {
        price = price || 'После осмотра';
      } else if (!price) {
        price = 'Договорная';
      }

      const newOffer: ProviderOffer = {
        id: offerData.id || `OFFER-${offerData.requestId || 'REQ'}-${Date.now().toString().slice(-4)}`,
        requestId: offerData.requestId || '',
        providerId: offerData.providerId || '',
        providerName: offerData.providerName || '',
        providerPhone: offerData.providerPhone || '',
        providerWhatsapp: offerData.providerWhatsapp || '',
        isDemo: offerData.isDemo || false,
        price,
        priceType,
        availability: offerData.availability || 'В течение часа',
        message: offerData.message || '',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      const allOffers = await this.getAllOffersRaw();
      const updated = [newOffer, ...allOffers];
      localStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(updated));

      // Upgrade request status to OFFERS_RECEIVED if it was NEW or MATCHING
      if (newOffer.requestId) {
        const req = await this.getRequest(newOffer.requestId);
        if (req && (req.status === 'MATCHING' || req.status === 'NEW')) {
          await this.updateRequest(req.id, { status: 'OFFERS_RECEIVED' });
        }
      }

      return newOffer;
    } catch (e) {
      logTechnicalError('LocalRepository.createOffer', e);
      throw e;
    }
  }

  async getOffers(filter?: OfferFilter): Promise<ProviderOffer[]> {
    if (!filter || (!filter.requestId && !filter.providerId && !filter.providerUserId)) {
      return [];
    }

    try {
      const all = await this.getAllOffersRaw();
      return all.filter((o) => {
        if (filter.requestId && o.requestId !== filter.requestId) {
          return false;
        }
        if (filter.providerUserId && o.providerUserId !== filter.providerUserId) {
          return false;
        }
        if (filter.providerId && o.providerId !== filter.providerId) {
          return false;
        }
        return true;
      });
    } catch (e) {
      logTechnicalError('LocalRepository.getOffers', e);
      return [];
    }
  }

  async updateOffer(
    offerId: string,
    updates: Partial<ProviderOffer>
  ): Promise<ProviderOffer | null> {
    try {
      const all = await this.getAllOffersRaw();
      const idx = all.findIndex((o) => o.id === offerId);
      if (idx === -1) return null;

      const targetOffer = all[idx];
      all[idx] = { ...targetOffer, ...updates };

      // If an offer is ACCEPTED:
      // 1. Update the request status to PROVIDER_SELECTED with selectedOfferId
      // 2. Reject all other offers for this request!
      if (updates.status === 'ACCEPTED' && targetOffer.requestId) {
        for (let i = 0; i < all.length; i++) {
          if (all[i].requestId === targetOffer.requestId && all[i].id !== offerId) {
            all[i].status = 'REJECTED';
          }
        }
        await this.updateRequest(targetOffer.requestId, {
          status: 'PROVIDER_SELECTED',
          selectedOfferId: offerId,
        });
      }

      localStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(all));
      return all[idx];
    } catch (e) {
      logTechnicalError('LocalRepository.updateOffer', e);
      return null;
    }
  }

  /**
   * Atomically accepts an offer in LocalRepository:
   * 1. Accepted offer: status = "ACCEPTED"
   * 2. Request: status = "PROVIDER_SELECTED", selectedOfferId = cleanOfferId
   * 3. Sibling offers for this request: status = "REJECTED"
   */
  async acceptOffer(
    requestId: string,
    offerId: string
  ): Promise<{ request: ServiceRequest | null; offer: ProviderOffer | null }> {
    try {
      const cleanReqId = (requestId || '').trim();
      const cleanOfferId = (offerId || '').trim();

      // 1. Update all offers for this request
      const allOffers = await this.getAllOffersRaw();
      let updatedOffer: ProviderOffer | null = null;

      for (let i = 0; i < allOffers.length; i++) {
        if (allOffers[i].id === cleanOfferId) {
          allOffers[i] = { ...allOffers[i], status: 'ACCEPTED' };
          updatedOffer = allOffers[i];
        } else if (allOffers[i].requestId === cleanReqId) {
          allOffers[i] = { ...allOffers[i], status: 'REJECTED' };
        }
      }
      localStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(allOffers));

      // 2. Update request: status = 'PROVIDER_SELECTED', selectedOfferId = cleanOfferId
      const updatedReq = await this.updateRequest(cleanReqId, {
        status: 'PROVIDER_SELECTED',
        selectedOfferId: cleanOfferId,
      });

      return { request: updatedReq, offer: updatedOffer };
    } catch (e) {
      logTechnicalError('LocalRepository.acceptOffer', e);
      return { request: null, offer: null };
    }
  }

  private async getAllOffersRaw(): Promise<ProviderOffer[]> {
    try {
      const data = localStorage.getItem(STORAGE_KEY_OFFERS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // =================== Matching Engine ===================
  async matchProviders(request: ServiceRequest): Promise<Provider[]> {
    try {
      const all = await this.getProviders();
      return matchProviders(request, all);
    } catch (e) {
      logTechnicalError('LocalRepository.matchProviders', e);
      return INITIAL_DEMO_PROVIDERS.slice(0, 3);
    }
  }

  // Generate simulated realistic demo offers for customer requests
  private async generateDemoOffersForRequest(request: ServiceRequest): Promise<void> {
    try {
      const matched = await this.matchProviders(request);
      const demoProviders = matched.filter((p) => p.isDemo).slice(0, 3);

      const offerTemplates = [
        {
          price: '15 000 ₸',
          availability: 'Сегодня, 40 минут',
          message: 'Құрал-саймандар өзімде бар. Келіп диагностика жасап, дереу жөндеп беремін.',
        },
        {
          price: '18 000 ₸',
          availability: 'Сегодня, 1 час',
          message: 'Түпнұсқа бөлшектер мен 6 ай ресми кепілдік беремін.',
        },
        {
          price: 'Договорная',
          availability: 'Сегодня, 30 минут',
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

      const existingOffers = await this.getAllOffersRaw();
      const updatedOffers = [...generatedOffers, ...existingOffers];
      localStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(updatedOffers));

      if (generatedOffers.length > 0) {
        await this.updateRequest(request.id, { status: 'OFFERS_RECEIVED' });
      }
    } catch (e) {
      logTechnicalError('LocalRepository.generateDemoOffersForRequest', e);
    }
  }

  // =================== Reviews ===================
  async createReview(reviewData: Partial<Review>): Promise<Review> {
    const requestId = reviewData.requestId?.trim() || '';
    if (!requestId) {
      throw new Error('Validation Error: requestId is required');
    }

    // Check if request exists and is COMPLETED
    let req = await this.getRequest(requestId);
    if (req && normalizeRequestStatus(req.status) !== 'COMPLETED') {
      await this.updateRequestStatus(requestId, 'COMPLETED');
      req = await this.getRequest(requestId);
    }
    let acceptedOffer: ProviderOffer | null = null;
    if (req?.selectedOfferId) {
      const allOffers = await this.getAllOffersRaw();
      acceptedOffer = allOffers.find((o) => o.id === req.selectedOfferId) || null;
    }
    if (!acceptedOffer) {
      const allOffers = await this.getAllOffersRaw();
      acceptedOffer = allOffers.find((o) => o.requestId === requestId && o.status === 'ACCEPTED') || null;
    }

    const customerId = reviewData.customerId?.trim() || req?.customerId || getCurrentUserId();
    const providerId = reviewData.providerId?.trim() || acceptedOffer?.providerId || '';

    const reviewPayload: Partial<Review> = {
      ...reviewData,
      customerId,
      providerId,
    };

    const isAnonymousSession = Boolean(
      !auth?.currentUser ||
      auth.currentUser.isAnonymous ||
      getCurrentUserId().startsWith('usr-') ||
      getCurrentUserId() === 'temp-local-user-id'
    );

    const validation = validateReviewData(reviewPayload, req, acceptedOffer, 'ru', isAnonymousSession);
    if (!validation.valid) {
      throw new Error(`Validation Error: ${validation.message}`);
    }

    // Check if review already exists for this requestId (Idempotency: 1 review per request)
    const allReviews = await this.getAllReviewsRaw();
    const existing = allReviews.find((r) => r.requestId === requestId || r.id === requestId);
    if (existing) {
      throw new Error('Duplicate Review Error: A review already exists for this completed request');
    }

    const newReview: Review = {
      id: requestId, // Direct requestId is the document ID to prevent duplicate reviews
      requestId,
      customerId,
      customerName: reviewData.customerName?.trim() || req?.customerName || 'Клиент',
      providerId,
      providerName: reviewData.providerName?.trim() || acceptedOffer?.providerName || 'Мастер',
      rating: Math.floor(reviewData.rating!),
      comment: reviewData.comment?.trim() || '',
      createdAt: new Date().toISOString(),
    };

    const updated = [newReview, ...allReviews];
    localStorage.setItem(STORAGE_KEY_REVIEWS, JSON.stringify(updated));
    return newReview;
  }

  async getReviews(filter?: ReviewFilter): Promise<Review[]> {
    try {
      const all = await this.getAllReviewsRaw();
      if (!filter) return all;

      return all.filter((r) => {
        if (
          filter.requestId &&
          (r.requestId || '').trim() !== filter.requestId.trim() &&
          (r.id || '').trim() !== filter.requestId.trim()
        ) {
          return false;
        }
        if (filter.providerId && (r.providerId || '').trim() !== filter.providerId.trim()) {
          return false;
        }
        return true;
      });
    } catch (e) {
      logTechnicalError('LocalRepository.getReviews', e);
      return [];
    }
  }

  private async getAllReviewsRaw(): Promise<Review[]> {
    try {
      const data = localStorage.getItem(STORAGE_KEY_REVIEWS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }
}

// Export singleton instance conforming to the Repository interface
export const localRepository: Repository = new LocalRepository();
