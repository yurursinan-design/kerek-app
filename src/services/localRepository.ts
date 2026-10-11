import {
  Appointment,
  AppNotification,
  ChatAttachment,
  ChatMessage,
  Conversation,
  getAppointmentId,
  getConversationId,
  isValidWorkStatusTransition,
  normalizeRequestStatus,
  Provider,
  ProviderOffer,
  RequestAttachment,
  RequestLocation,
  RequestStatus,
  Review,
  sanitizeFileName,
  ServiceRequest,
  User,
  validateChatAttachment,
  validateRequestAttachment,
  WorkStatus,
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
import { normalizeCategoryId, normalizeCityId, isCategoryMatch } from './taxonomy';

const STORAGE_KEY_USER_ID = 'kerek_current_user_id_v2';
const STORAGE_KEY_USERS = 'kerek_users_v2';
const STORAGE_KEY_PROVIDERS = 'kerek_providers_v2';
const STORAGE_KEY_CURRENT_PROVIDER = 'kerek_provider_profile_v1';
const STORAGE_KEY_REQUESTS = 'kerek_requests_v1';
const STORAGE_KEY_OFFERS = 'kerek_offers_v1';
const STORAGE_KEY_REVIEWS = 'kerek_reviews_v1';
const STORAGE_KEY_CONVERSATIONS = 'kerek_conversations_v1';
const STORAGE_KEY_MESSAGES_PREFIX = 'kerek_messages_v1_';
const STORAGE_KEY_NOTIFICATIONS = 'kerek_notifications_v1';
const STORAGE_KEY_APPOINTMENTS = 'kerek_appointments_v1';
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

// Export setCurrentUserId helper for explicit session tracking and testing
export function setCurrentUserId(uid: string | null): void {
  try {
    if (!uid) {
      safeStorage.removeItem(STORAGE_KEY_USER_ID);
    } else {
      safeStorage.setItem(STORAGE_KEY_USER_ID, uid);
    }
  } catch {}
}

// Get or initialize persistent local user ID (synchronizes strictly with Firebase Auth UID as canonical identity)
export function getCurrentUserId(): string {
  try {
    if (auth?.currentUser?.uid) {
      const canonicalUid = auth.currentUser.uid;
      try {
        safeStorage.setItem(STORAGE_KEY_USER_ID, canonicalUid);
      } catch {}
      return canonicalUid;
    }

    let uid = safeStorage.getItem(STORAGE_KEY_USER_ID);
    if (uid && uid.trim().length > 0) {
      return uid.trim();
    }

    uid = generateUUID();
    safeStorage.setItem(STORAGE_KEY_USER_ID, uid);
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
      safeStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
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
      const data = safeStorage.getItem(STORAGE_KEY_USERS);
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
      const cityId = normalizeCityId(providerData.cityId || city) || providerData.cityId || 'kyzylorda';
      const category = providerData.category?.trim() || '';
      const categoryId = normalizeCategoryId(providerData.categoryId || category);

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
        iinVerified: providerData.iinVerified ?? false,
        hasCertificate: providerData.hasCertificate ?? false,
        ...(providerData.tradeLicense ? { tradeLicense: providerData.tradeLicense } : {}),
        isDemo: false,
      };

      safeStorage.setItem(STORAGE_KEY_CURRENT_PROVIDER, JSON.stringify(newProvider));

      const list = await this.getCustomProviders();
      const idx = list.findIndex((p) => p.id === id);
      if (idx >= 0) {
        list[idx] = newProvider;
      } else {
        list.push(newProvider);
      }
      safeStorage.setItem(STORAGE_KEY_PROVIDERS, JSON.stringify(list));
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
        cityId: normalizeCityId(p.cityId || p.city) || p.cityId,
        categoryId: normalizeCategoryId(p.categoryId || p.category),
      }));

      if (!filter) return all;

      const targetCityId = filter.cityId
        ? normalizeCityId(filter.cityId) || filter.cityId
        : filter.city
        ? normalizeCityId(filter.city)
        : undefined;
      const targetCatId = filter.categoryId
        ? normalizeCategoryId(filter.categoryId)
        : filter.category
        ? normalizeCategoryId(filter.category)
        : undefined;

      return all.filter((p) => {
        if (targetCityId && (normalizeCityId(p.cityId || p.city) || p.cityId) !== targetCityId) {
          return false;
        }
        if (targetCatId && !isCategoryMatch(p.categoryId, targetCatId)) {
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
      const data = safeStorage.getItem(STORAGE_KEY_CURRENT_PROVIDER);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private async getCustomProviders(): Promise<Provider[]> {
    try {
      const data = safeStorage.getItem(STORAGE_KEY_PROVIDERS);
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
      const cityId = normalizeCityId(requestData.cityId || city) || requestData.cityId || 'kyzylorda';
      const category = requestData.category?.trim() || 'Тұрмыстық техника жөндеу';
      const categoryId = normalizeCategoryId(requestData.categoryId || category);
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
        ...(requestData.attachments && requestData.attachments.length > 0 ? { attachments: requestData.attachments } : {}),
        ...(requestData.location ? { location: requestData.location } : {}),
        ...(requestData.understanding ? { understanding: requestData.understanding } : {}),
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

  async uploadRequestAttachment(
    requestId: string,
    file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string },
    customerId?: string
  ): Promise<RequestAttachment> {
    const cleanId = (requestId || '').trim();
    if (!cleanId) {
      throw new Error('Validation Error: requestId is required');
    }

    // Authorization check: if request exists, caller must be owner
    const existingReq = await this.getRequest(cleanId);
    if (existingReq) {
      const currentUid = customerId || getCurrentUserId();
      if (existingReq.customerId !== currentUid) {
        throw new Error(`Unauthorized: Only the creator of request ${cleanId} can upload attachments`);
      }
    }

    const validation = validateRequestAttachment(file);
    if (!validation.isValid) {
      throw new Error(`Attachment validation failed: ${validation.errorKey}`);
    }

    const sanitizedName = sanitizeFileName(file.name);
    const attachmentId = `att_req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const storagePath = `requests/${cleanId}/${attachmentId}_${sanitizedName}`;

    let downloadUrl = '';
    if (file.data instanceof Blob) {
      try {
        downloadUrl = URL.createObjectURL(file.data);
      } catch {
        downloadUrl = `local-blob://${storagePath}`;
      }
    } else if (typeof file.data === 'string' && file.data.startsWith('data:')) {
      downloadUrl = file.data;
    } else {
      downloadUrl = `local-storage://${storagePath}`;
    }

    const attachment: RequestAttachment = {
      id: attachmentId,
      type: validation.type,
      storagePath,
      downloadUrl,
      fileName: sanitizedName,
      mimeType: file.type || (validation.type === 'image' ? 'image/jpeg' : validation.type === 'video' ? 'video/mp4' : 'audio/mp3'),
      sizeBytes: file.size,
      createdAt: new Date().toISOString(),
    };

    return attachment;
  }

  async getRequest(requestId: string): Promise<ServiceRequest | null> {
    try {
      const list = await this.getAllRequestsRaw();
      const req = list.find((r) => r.id === requestId);
      if (!req) return null;
      return {
        ...req,
        status: normalizeRequestStatus(req.status),
        cityId: normalizeCityId(req.cityId || req.city) || req.cityId,
        categoryId: normalizeCategoryId(req.categoryId || req.category),
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
        cityId: normalizeCityId(r.cityId || r.city) || r.cityId,
        categoryId: normalizeCategoryId(r.categoryId || r.category),
      }));

      if (!filter) return enriched;

      const targetCityId = filter.cityId
        ? normalizeCityId(filter.cityId) || filter.cityId
        : filter.city
        ? normalizeCityId(filter.city)
        : undefined;
      const targetCatId = filter.categoryId
        ? normalizeCategoryId(filter.categoryId)
        : filter.category
        ? normalizeCategoryId(filter.category)
        : undefined;

      return enriched.filter((r) => {
        // Customer Security Filter: Customer only sees their own requests
        if (filter.customerId && r.customerId !== filter.customerId) {
          return false;
        }
        // City Filter (canonical cityId check)
        if (targetCityId && (normalizeCityId(r.cityId || r.city) || r.cityId) !== targetCityId) {
          return false;
        }
        // Category Filter (canonical categoryId check bridges KZ and RU, 'other' matches all)
        if (targetCatId && r.categoryId !== 'other' && !isCategoryMatch(r.categoryId, targetCatId)) {
          return false;
        }
        return true;
      });
    } catch (e) {
      logTechnicalError('LocalRepository.getRequests', e);
      return [];
    }
  }

  subscribeToRequests(
    filter: RequestFilter,
    onData: (requests: ServiceRequest[]) => void,
    _onError?: (error: any) => void
  ): () => void {
    let active = true;
    this.getRequests(filter).then((res) => {
      if (active) onData(res);
    });
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_REQUESTS) {
        this.getRequests(filter).then((res) => {
          if (active) onData(res);
        });
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorage);
    }
    return () => {
      active = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorage);
      }
    };
  }

  async updateRequest(
    requestId: string,
    updates: Partial<ServiceRequest>
  ): Promise<ServiceRequest | null> {
    try {
      const list = await this.getAllRequestsRaw();
      const idx = list.findIndex((r) => r.id === requestId);
      if (idx === -1) return null;

      const existingReq = list[idx];
      const normStatus = normalizeRequestStatus(existingReq.status);
      if (normStatus === 'CANCELLED' && updates.status && updates.status !== 'CANCELLED') {
        throw new Error('Validation Error: Cannot change status of CANCELLED request');
      }
      if (
        normStatus === 'PROVIDER_SELECTED' ||
        normStatus === 'COMPLETED' ||
        normStatus === 'CANCELLED'
      ) {
        const nonStatusKeys = Object.keys(updates).filter(
          (k) => k !== 'status' && k !== 'updatedAt' && k !== 'selectedOfferId'
        );
        if (nonStatusKeys.length > 0) {
          throw new Error(
            `Validation Error: Cannot edit request details in status: ${existingReq.status}`
          );
        }
      }

      list[idx] = { ...list[idx], ...updates };
      safeStorage.setItem(STORAGE_KEY_REQUESTS, JSON.stringify(list));
      return {
        ...list[idx],
        status: normalizeRequestStatus(list[idx].status),
      };
    } catch (e: any) {
      if (e?.message?.startsWith('Validation Error:')) throw e;
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
        providerUserId:
          offerData.providerUserId ||
          (offerData.providerId ? offerData.providerId : undefined) ||
          getCurrentUserId(),
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
        iinVerified: offerData.iinVerified ?? false,
        hasCertificate: offerData.hasCertificate ?? false,
      };

      const allOffers = await this.getAllOffersRaw();
      const updated = [newOffer, ...allOffers];
      safeStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(updated));

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
        if (filter.providerId && filter.providerUserId) {
          const matchProv = o.providerId === filter.providerId || o.providerUserId === filter.providerId;
          const matchUser = o.providerUserId === filter.providerUserId || o.providerId === filter.providerUserId;
          if (!matchProv && !matchUser) {
            return false;
          }
        } else if (filter.providerUserId) {
          if (o.providerUserId !== filter.providerUserId && o.providerId !== filter.providerUserId) {
            return false;
          }
        } else if (filter.providerId) {
          if (o.providerId !== filter.providerId && o.providerUserId !== filter.providerId) {
            return false;
          }
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
      const isPaymentStatusOnlyUpdate =
        updates.paymentStatus !== undefined &&
        Object.keys(updates).every((k) => k === 'paymentStatus' || k === 'updatedAt');

      if (!isPaymentStatusOnlyUpdate) {
        if (targetOffer.status === 'ACCEPTED' || targetOffer.status === 'REJECTED') {
          throw new Error(`Validation Error: Cannot update offer in status ${targetOffer.status}`);
        }

        if (targetOffer.requestId) {
          const parentReq = await this.getRequest(targetOffer.requestId);
          if (parentReq) {
            const normStatus = normalizeRequestStatus(parentReq.status);
            if (
              normStatus === 'PROVIDER_SELECTED' ||
              normStatus === 'COMPLETED' ||
              normStatus === 'CANCELLED'
            ) {
              throw new Error(
                `Validation Error: Cannot update offer because request is in status ${parentReq.status}`
              );
            }
          }
        }
      }

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

      safeStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(all));
      return all[idx];
    } catch (e: any) {
      if (e?.message?.startsWith('Validation Error:')) throw e;
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
      safeStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(allOffers));

      // 2. Update request: status = 'PROVIDER_SELECTED', selectedOfferId = cleanOfferId
      const updatedReq = await this.updateRequest(cleanReqId, {
        status: 'PROVIDER_SELECTED',
        selectedOfferId: cleanOfferId,
      });

      // 3. Initialize conversation and appointment in local repository
      try {
        await this.getOrCreateConversation(cleanReqId);
      } catch (convErr) {
        console.warn('[LocalRepository] Note initializing conversation in acceptOffer:', convErr);
      }

      if (updatedOffer) {
        try {
          const apptId = getAppointmentId(cleanReqId);
          const existingAppt = await this.getAppointment(apptId);
          if (!existingAppt) {
            await this.createAppointment({
              requestId: cleanReqId,
              customerId: updatedReq?.customerId || getCurrentUserId(),
              providerId: updatedOffer.providerId,
              providerUserId: updatedOffer.providerUserId || updatedOffer.providerId,
              proposedBy: 'provider',
              scheduledAt: updatedOffer.availability || new Date().toISOString(),
              status: 'PROPOSED',
              workStatus: 'NOT_STARTED',
            });
          }
        } catch (apptErr) {
          console.warn('[LocalRepository] Note initializing appointment in acceptOffer:', apptErr);
        }
      }

      return { request: updatedReq, offer: updatedOffer };
    } catch (e) {
      logTechnicalError('LocalRepository.acceptOffer', e);
      return { request: null, offer: null };
    }
  }

  private async getAllOffersRaw(): Promise<ProviderOffer[]> {
    try {
      const data = safeStorage.getItem(STORAGE_KEY_OFFERS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // =================== Matching Engine ===================
  async matchProviders(request: ServiceRequest): Promise<Provider[]> {
    try {
      const reqCityId = normalizeCityId(request.cityId || request.city) || request.cityId;
      if (request.city && request.city.trim() !== '' && !reqCityId) {
        return [];
      }
      const reqCatId = normalizeCategoryId(request.categoryId || request.category);
      const candidates = await this.getProviders(reqCityId ? { cityId: reqCityId, categoryId: reqCatId } : undefined);
      return matchProviders(request, candidates);
    } catch (e) {
      logTechnicalError('LocalRepository.matchProviders', e);
      return [];
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
          iinVerified: provider.iinVerified ?? false,
          hasCertificate: provider.hasCertificate ?? false,
        };
      });

      const existingOffers = await this.getAllOffersRaw();
      const updatedOffers = [...generatedOffers, ...existingOffers];
      safeStorage.setItem(STORAGE_KEY_OFFERS, JSON.stringify(updatedOffers));

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
    const req = await this.getRequest(requestId);
    if (!req) {
      throw new Error('Validation Error: Отсутствует ID заявки');
    }
    const canonicalStatus = normalizeRequestStatus(req.status);
    if (canonicalStatus !== 'COMPLETED') {
      throw new Error('Validation Error: Оценивать можно только завершенные заказы');
    }

    // Verify session owner is strictly the customer who created the request (no anonymous/usr- bypass)
    const sessionUid = auth?.currentUser?.uid ? auth.currentUser.uid : getCurrentUserId();
    if (!sessionUid || sessionUid !== req.customerId) {
      throw new Error('Validation Error: Только заказчик может оставить отзыв');
    }
    if (reviewData.customerId && reviewData.customerId.trim() !== req.customerId) {
      throw new Error('Validation Error: Только заказчик может оставить отзыв');
    }
    const customerId = req.customerId;

    // Verify selectedOfferId is strictly present
    if (!req.selectedOfferId || typeof req.selectedOfferId !== 'string' || !req.selectedOfferId.trim()) {
      throw new Error('Validation Error: Предложение не было принято');
    }

    let acceptedOffer: ProviderOffer | null = null;
    const allOffers = await this.getAllOffersRaw();
    acceptedOffer = allOffers.find((o) => o.id === req.selectedOfferId && o.requestId === requestId && o.status === 'ACCEPTED') || null;

    if (!acceptedOffer || acceptedOffer.status !== 'ACCEPTED') {
      throw new Error('Validation Error: Предложение не было принято');
    }

    if (!acceptedOffer.providerId) {
      throw new Error('Validation Error: Нельзя оставить отзыв неподтвержденному исполнителю');
    }

    if (reviewData.providerId && reviewData.providerId.trim() !== acceptedOffer.providerId) {
      throw new Error('Validation Error: Нельзя оставить отзыв неподтвержденному исполнителю');
    }
    const providerId = acceptedOffer.providerId;

    if (
      customerId === providerId ||
      (acceptedOffer.providerUserId && customerId === acceptedOffer.providerUserId) ||
      sessionUid === providerId ||
      (acceptedOffer.providerUserId && sessionUid === acceptedOffer.providerUserId)
    ) {
      throw new Error('Validation Error: Исполнитель не может оценивать самого себя');
    }

    const reviewPayload: Partial<Review> = {
      ...reviewData,
      customerId,
      providerId,
    };

    const validation = validateReviewData(reviewPayload, req, acceptedOffer, 'ru', false);
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
    safeStorage.setItem(STORAGE_KEY_REVIEWS, JSON.stringify(updated));
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
      const data = safeStorage.getItem(STORAGE_KEY_REVIEWS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // =================== Conversations & In-App Chat ===================
  async getConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const convs = await this.getAllConversationsRaw();
      return convs.find((c) => c.id === conversationId) || null;
    } catch (e) {
      logTechnicalError('LocalRepository.getConversation', e);
      return null;
    }
  }

  async getOrCreateConversation(requestId: string): Promise<Conversation> {
    const cleanReqId = (requestId || '').trim();
    if (!cleanReqId) {
      throw new Error('Validation Error: requestId is required to get or create conversation');
    }
    const convId = getConversationId(cleanReqId);
    const existing = await this.getConversation(convId);
    if (existing) {
      return existing;
    }

    // Must fetch corresponding request
    const req = await this.getRequest(cleanReqId);
    if (!req) {
      throw new Error(`Request not found: ${cleanReqId}`);
    }

    const normStatus = normalizeRequestStatus(req.status);
    if (normStatus === 'OPEN') {
      throw new Error('Chat cannot be opened for OPEN requests. A provider offer must be accepted first.');
    }

    if (!req.selectedOfferId) {
      throw new Error('Chat cannot be opened: No provider offer has been selected for this request.');
    }

    // Fetch the accepted offer
    const offers = await this.getOffers({ requestId: cleanReqId });
    const selectedOffer = offers.find((o) => o.id === req.selectedOfferId);
    if (!selectedOffer) {
      throw new Error(`Selected offer not found for request ${cleanReqId}`);
    }

    const now = new Date().toISOString();
    const newConv: Conversation = {
      id: convId,
      requestId: cleanReqId,
      customerId: req.customerId,
      customerName: req.customerName || 'Клиент',
      providerId: selectedOffer.providerId,
      providerUserId: selectedOffer.providerUserId || selectedOffer.providerId,
      providerName: selectedOffer.providerName || 'Мастер',
      status: 'ACTIVE',
      lastMessageText: '',
      lastMessageSenderId: '',
      lastMessageAt: now,
      unreadCountCustomer: 0,
      unreadCountProvider: 0,
      createdAt: now,
      updatedAt: now,
    };

    const allConvs = await this.getAllConversationsRaw();
    const idx = allConvs.findIndex((c) => c.id === convId);
    if (idx >= 0) {
      allConvs[idx] = newConv;
    } else {
      allConvs.push(newConv);
    }
    safeStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(allConvs));
    return newConv;
  }

  async getMessages(conversationId: string, limitCount = 30): Promise<ChatMessage[]> {
    try {
      const all = await this.getMessagesRaw(conversationId);
      // Newest messages with limit, returned in chronological order
      const newest = all.slice(-limitCount);
      return newest;
    } catch (e) {
      logTechnicalError('LocalRepository.getMessages', e);
      return [];
    }
  }

  async sendMessage(conversationId: string, messageData: Partial<ChatMessage>): Promise<ChatMessage> {
    const text = (messageData.text || '').trim();
    if (!text) {
      throw new Error('Validation Error: Message text cannot be empty');
    }
    if (text.length > 2000) {
      throw new Error('Validation Error: Message text exceeds 2000 characters limit');
    }

    const conv = await this.getConversation(conversationId);
    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Verify parent request status
    const req = await this.getRequest(conv.requestId);
    if (req && normalizeRequestStatus(req.status) === 'CANCELLED') {
      throw new Error('Cannot send message: Request is cancelled');
    }

    // Participant identity resolution
    // Note: Do NOT equate Firebase Auth UID with old Local UUID
    const localUid = getCurrentUserId();
    const authUid = auth?.currentUser?.uid;
    const providedSenderId = (messageData.senderId || '').trim();
    const providedRole = messageData.senderRole;

    const isCustomer =
      (Boolean(providedSenderId) && providedSenderId === conv.customerId) ||
      (!providedSenderId && (
        localUid === conv.customerId ||
        (Boolean(authUid) && authUid === conv.customerId)
      ));

    const isProvider =
      (Boolean(providedSenderId) && (providedSenderId === conv.providerUserId || providedSenderId === conv.providerId)) ||
      (!providedSenderId && (
        localUid === conv.providerUserId ||
        localUid === conv.providerId ||
        (Boolean(authUid) && (authUid === conv.providerUserId || authUid === conv.providerId))
      ));

    if (!isCustomer && !isProvider) {
      throw new Error('Unauthorized: You are not a participant in this conversation');
    }

    const senderRole: 'customer' | 'provider' =
      providedRole === 'provider' ? 'provider' :
      providedRole === 'customer' ? 'customer' :
      (isCustomer ? 'customer' : 'provider');

    const resolvedSenderId = senderRole === 'customer'
      ? conv.customerId
      : (conv.providerUserId || conv.providerId);
    const now = new Date().toISOString();
    const resolvedType = messageData.type || (messageData.attachments && messageData.attachments.length > 0
      ? messageData.attachments[0].type
      : 'text');

    const newMsg: ChatMessage = {
      id: messageData.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      conversationId,
      requestId: conv.requestId,
      senderId: resolvedSenderId,
      senderRole,
      type: resolvedType,
      text,
      attachments: messageData.attachments,
      isRead: false,
      readAt: null,
      createdAt: now,
    };

    // Store message
    const allMsgs = await this.getMessagesRaw(conversationId);
    allMsgs.push(newMsg);
    safeStorage.setItem(STORAGE_KEY_MESSAGES_PREFIX + conversationId, JSON.stringify(allMsgs));

    // Update conversation
    const allConvs = await this.getAllConversationsRaw();
    const convIdx = allConvs.findIndex((c) => c.id === conversationId);
    if (convIdx >= 0) {
      const summaryText = text || (newMsg.attachments?.[0]?.type === 'image' ? '📷 Фото' : '📎 Файл');
      const updatedConv = {
        ...allConvs[convIdx],
        lastMessageText: summaryText,
        lastMessageSenderId: resolvedSenderId,
        lastMessageAt: now,
        updatedAt: now,
        unreadCountCustomer: isProvider ? (allConvs[convIdx].unreadCountCustomer || 0) + 1 : allConvs[convIdx].unreadCountCustomer,
        unreadCountProvider: isCustomer ? (allConvs[convIdx].unreadCountProvider || 0) + 1 : allConvs[convIdx].unreadCountProvider,
      };
      allConvs[convIdx] = updatedConv;
      safeStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(allConvs));
    }

    this.notifyChatListeners(conversationId);

    return newMsg;
  }

  async uploadChatAttachment(
    conversationId: string,
    file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string }
  ): Promise<ChatAttachment> {
    const cleanId = (conversationId || '').trim();
    const conv = await this.getConversation(cleanId);
    if (!conv) {
      throw new Error(`Conversation not found: ${cleanId}`);
    }

    const validation = validateChatAttachment(file);
    if (!validation.isValid) {
      throw new Error(`Attachment validation failed: ${validation.errorKey}`);
    }

    const sanitizedName = sanitizeFileName(file.name);
    const attachmentId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const storagePath = `chat/${cleanId}/pending/${attachmentId}_${sanitizedName}`;

    // For local fallback: create an object URL or data URL if available, or simulate offline storage URL
    let downloadUrl = '';
    if (file.data instanceof Blob) {
      try {
        downloadUrl = URL.createObjectURL(file.data);
      } catch {
        downloadUrl = `local-blob://${storagePath}`;
      }
    } else if (typeof file.data === 'string' && file.data.startsWith('data:')) {
      downloadUrl = file.data;
    } else {
      downloadUrl = `local-storage://${storagePath}`;
    }

    const attachment: ChatAttachment = {
      id: attachmentId,
      type: validation.type,
      storagePath,
      downloadUrl,
      fileName: sanitizedName,
      mimeType: file.type || (validation.type === 'image' ? 'image/jpeg' : 'application/octet-stream'),
      sizeBytes: file.size,
      createdAt: new Date().toISOString(),
    };

    return attachment;
  }

  async sendChatMessageWithAttachment(
    conversationId: string,
    messageData: {
      text?: string;
      senderId?: string;
      senderRole?: 'customer' | 'provider';
      file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string };
    }
  ): Promise<ChatMessage> {
    const attachment = await this.uploadChatAttachment(conversationId, messageData.file);
    return await this.sendMessage(conversationId, {
      text: (messageData.text || '').trim(),
      senderId: messageData.senderId,
      senderRole: messageData.senderRole,
      type: attachment.type,
      attachments: [attachment],
    });
  }

  private chatListeners = new Map<string, Set<(messages: ChatMessage[]) => void>>();
  private chatBroadcastChannel: BroadcastChannel | null = null;
  private notifListeners = new Map<string, Set<(notifications: AppNotification[]) => void>>();
  private notifBroadcastChannel: BroadcastChannel | null = null;
  private apptListeners = new Map<string, Set<(appointment: Appointment | null) => void>>();
  private apptBroadcastChannel: BroadcastChannel | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        if ('BroadcastChannel' in window) {
          this.chatBroadcastChannel = new BroadcastChannel('kerek_chat_sync');
          this.chatBroadcastChannel.onmessage = (event) => {
            if (event.data?.conversationId) {
              this.notifyChatListeners(event.data.conversationId, false);
            }
          };

          this.notifBroadcastChannel = new BroadcastChannel('kerek_notif_sync');
          this.notifBroadcastChannel.onmessage = (event) => {
            if (event.data?.userId) {
              this.notifyNotifListeners(event.data.userId, false);
            }
          };

          this.apptBroadcastChannel = new BroadcastChannel('kerek_appt_sync');
          this.apptBroadcastChannel.onmessage = (event) => {
            if (event.data?.requestId) {
              this.notifyApptListeners(event.data.requestId, false);
            }
          };
        }
      } catch {}

      window.addEventListener('storage', (event) => {
        if (event.key && event.key.startsWith(STORAGE_KEY_MESSAGES_PREFIX)) {
          const convId = event.key.replace(STORAGE_KEY_MESSAGES_PREFIX, '');
          this.notifyChatListeners(convId, false);
        } else if (event.key === STORAGE_KEY_NOTIFICATIONS) {
          // Notify all active user notification subscribers
          for (const userId of this.notifListeners.keys()) {
            this.notifyNotifListeners(userId, false);
          }
        } else if (event.key === STORAGE_KEY_APPOINTMENTS) {
          // Notify all active appointment subscribers
          for (const reqId of this.apptListeners.keys()) {
            this.notifyApptListeners(reqId, false);
          }
        }
      });
    }
  }

  private notifyNotifListeners(userId: string, broadcast = true) {
    if (broadcast && this.notifBroadcastChannel) {
      try {
        this.notifBroadcastChannel.postMessage({ userId });
      } catch {}
    }
    const listeners = this.notifListeners.get(userId);
    if (listeners && listeners.size > 0) {
      this.getNotifications(userId).then((list) => {
        listeners.forEach((fn) => {
          try {
            fn(list);
          } catch {}
        });
      });
    }
  }

  private notifyChatListeners(conversationId: string, broadcast = true) {
    if (broadcast && this.chatBroadcastChannel) {
      try {
        this.chatBroadcastChannel.postMessage({ conversationId });
      } catch {}
    }
    const listeners = this.chatListeners.get(conversationId);
    if (listeners && listeners.size > 0) {
      this.getMessages(conversationId).then((all) => {
        listeners.forEach((fn) => {
          try {
            fn(all);
          } catch {}
        });
      });
    }
  }

  async markMessagesAsRead(conversationId: string): Promise<void> {
    try {
      const currentUid = auth?.currentUser?.uid || getCurrentUserId();
      const allConvs = await this.getAllConversationsRaw();
      const convIdx = allConvs.findIndex((c) => c.id === conversationId);
      if (convIdx >= 0) {
        const c = allConvs[convIdx];
        if (currentUid === c.customerId) {
          c.unreadCountCustomer = 0;
        } else if (currentUid === c.providerUserId || currentUid === c.providerId) {
          c.unreadCountProvider = 0;
        }
        allConvs[convIdx] = c;
        safeStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(allConvs));
      }
    } catch (e) {
      logTechnicalError('LocalRepository.markMessagesAsRead', e);
    }
  }

  subscribeToMessages(
    conversationId: string,
    onUpdate: (messages: ChatMessage[]) => void,
    _onError?: (error: any) => void
  ): () => void {
    const cleanId = (conversationId || '').trim();
    if (!this.chatListeners.has(cleanId)) {
      this.chatListeners.set(cleanId, new Set());
    }
    this.chatListeners.get(cleanId)!.add(onUpdate);

    // Deliver initial messages asynchronously
    this.getMessages(cleanId).then((msgs) => {
      onUpdate(msgs);
    });

    return () => {
      const set = this.chatListeners.get(cleanId);
      if (set) {
        set.delete(onUpdate);
        if (set.size === 0) {
          this.chatListeners.delete(cleanId);
        }
      }
    };
  }

  // =================== In-App Notifications ===================

  async createNotification(notificationData: AppNotification): Promise<AppNotification> {
    try {
      if (!notificationData.id || !notificationData.recipientUserId || !notificationData.type) {
        throw new Error('Validation Error: notification id, recipientUserId and type are required');
      }

      const notif: AppNotification = {
        ...notificationData,
        isRead: false,
        readAt: null,
        createdAt: notificationData.createdAt || new Date().toISOString(),
      };

      const all = await this.getAllNotificationsRaw();
      const existingIdx = all.findIndex((n) => n.id === notif.id);
      if (existingIdx >= 0) {
        // Idempotency: update existing without duplicating
        all[existingIdx] = { ...all[existingIdx], ...notif };
      } else {
        all.unshift(notif);
      }

      safeStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(all));
      this.notifyNotifListeners(notif.recipientUserId);
      return notif;
    } catch (e) {
      logTechnicalError('LocalRepository.createNotification', e);
      throw e;
    }
  }

  async getNotifications(userId: string, limitCount = 50): Promise<AppNotification[]> {
    try {
      const cleanUid = (userId || '').trim();
      if (!cleanUid) return [];

      const all = await this.getAllNotificationsRaw();
      return all
        .filter((n) => n.recipientUserId === cleanUid)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limitCount);
    } catch (e) {
      logTechnicalError('LocalRepository.getNotifications', e);
      return [];
    }
  }

  async markNotificationAsRead(notificationId: string): Promise<void> {
    try {
      const cleanId = (notificationId || '').trim();
      if (!cleanId) return;

      const all = await this.getAllNotificationsRaw();
      const idx = all.findIndex((n) => n.id === cleanId);
      if (idx >= 0 && !all[idx].isRead) {
        all[idx].isRead = true;
        all[idx].readAt = new Date().toISOString();
        safeStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(all));
        this.notifyNotifListeners(all[idx].recipientUserId);
      }
    } catch (e) {
      logTechnicalError('LocalRepository.markNotificationAsRead', e);
    }
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    try {
      const cleanUid = (userId || '').trim();
      if (!cleanUid) return;

      const all = await this.getAllNotificationsRaw();
      let changed = false;
      const now = new Date().toISOString();

      all.forEach((n) => {
        if (n.recipientUserId === cleanUid && !n.isRead) {
          n.isRead = true;
          n.readAt = now;
          changed = true;
        }
      });

      if (changed) {
        safeStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(all));
        this.notifyNotifListeners(cleanUid);
      }
    } catch (e) {
      logTechnicalError('LocalRepository.markAllNotificationsAsRead', e);
    }
  }

  subscribeToNotifications(
    userId: string,
    onUpdate: (notifications: AppNotification[]) => void,
    _onError?: (error: any) => void
  ): () => void {
    const cleanUid = (userId || '').trim();
    if (!cleanUid) {
      return () => {};
    }

    if (!this.notifListeners.has(cleanUid)) {
      this.notifListeners.set(cleanUid, new Set());
    }
    this.notifListeners.get(cleanUid)!.add(onUpdate);

    // Deliver current notifications immediately
    this.getNotifications(cleanUid).then((list) => {
      onUpdate(list);
    });

    return () => {
      const set = this.notifListeners.get(cleanUid);
      if (set) {
        set.delete(onUpdate);
        if (set.size === 0) {
          this.notifListeners.delete(cleanUid);
        }
      }
    };
  }

  private async getAllNotificationsRaw(): Promise<AppNotification[]> {
    try {
      const data = safeStorage.getItem(STORAGE_KEY_NOTIFICATIONS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private async getAllConversationsRaw(): Promise<Conversation[]> {
    try {
      const data = safeStorage.getItem(STORAGE_KEY_CONVERSATIONS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private async getMessagesRaw(conversationId: string): Promise<ChatMessage[]> {
    try {
      const data = safeStorage.getItem(STORAGE_KEY_MESSAGES_PREFIX + conversationId);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // =================== Appointments ===================
  private notifyApptListeners(requestId: string, broadcast = true) {
    if (broadcast && this.apptBroadcastChannel) {
      try {
        this.apptBroadcastChannel.postMessage({ requestId });
      } catch {}
    }
    const listeners = this.apptListeners.get(requestId);
    if (listeners && listeners.size > 0) {
      this.getAppointment(requestId).then((appt) => {
        listeners.forEach((fn) => {
          try {
            fn(appt);
          } catch {}
        });
      });
    }
  }

  private async getAllAppointmentsRaw(): Promise<Appointment[]> {
    try {
      const data = safeStorage.getItem(STORAGE_KEY_APPOINTMENTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private async saveAppointmentsRaw(appts: Appointment[]): Promise<void> {
    safeStorage.setItem(STORAGE_KEY_APPOINTMENTS, JSON.stringify(appts));
  }

  async getAppointment(requestId: string): Promise<Appointment | null> {
    const cleanReqId = (requestId || '').trim();
    if (!cleanReqId) return null;
    const targetDocId = getAppointmentId(cleanReqId);
    const list = await this.getAllAppointmentsRaw();
    const found = list.find(
      (a) =>
        a.requestId === cleanReqId ||
        a.id === cleanReqId ||
        a.id === targetDocId ||
        a.id === `appointment_${cleanReqId}` ||
        a.id === `appt_${cleanReqId}`
    );
    return found || null;
  }

  async createAppointment(
    appointmentData: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Appointment> {
    if (!appointmentData.requestId) {
      throw new Error('requestId is required for appointment');
    }
    // 1. Verify request exists and is in accepted / selected state
    const req = await this.getRequest(appointmentData.requestId);
    if (!req) {
      throw new Error(`Request not found: ${appointmentData.requestId}`);
    }
    if (req.status === 'CANCELLED') {
      throw new Error('Cannot create appointment for CANCELLED request');
    }
    const allowedStatuses: RequestStatus[] = ['PROVIDER_SELECTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'];
    if (!allowedStatuses.includes(req.status)) {
      throw new Error(`Cannot create appointment for request in status: ${req.status}`);
    }

    // 2. If active appointment already exists for this request, update it idempotently
    const existing = await this.getAppointment(appointmentData.requestId);
    if (existing && existing.status !== 'CANCELLED' && existing.status !== 'COMPLETED') {
      return await this.updateAppointment(existing.id, appointmentData);
    }

    // 3. Validate fields
    if (!appointmentData.scheduledAt || typeof appointmentData.scheduledAt !== 'string') {
      throw new Error('scheduledAt must be a valid date/time string');
    }
    if (appointmentData.durationMinutes !== undefined) {
      if (typeof appointmentData.durationMinutes !== 'number' || appointmentData.durationMinutes <= 0 || appointmentData.durationMinutes > 1440) {
        throw new Error('durationMinutes must be a positive number up to 1440');
      }
    }
    if (appointmentData.note !== undefined && appointmentData.note.length > 1000) {
      throw new Error('note cannot exceed 1000 characters');
    }

    const apptId = getAppointmentId(appointmentData.requestId);
    const now = new Date().toISOString();
    const newAppt: Appointment = {
      ...appointmentData,
      id: apptId,
      status: appointmentData.status || 'PROPOSED',
      createdAt: now,
      updatedAt: now,
    };

    const all = await this.getAllAppointmentsRaw();
    const filtered = all.filter((a) => a.id !== apptId && a.requestId !== newAppt.requestId);
    filtered.push(newAppt);
    await this.saveAppointmentsRaw(filtered);

    this.notifyApptListeners(newAppt.requestId);
    return newAppt;
  }

  async updateAppointment(appointmentId: string, updates: Partial<Appointment>): Promise<Appointment> {
    const all = await this.getAllAppointmentsRaw();
    const idx = all.findIndex(
      (a) => a.id === appointmentId || a.requestId === appointmentId || a.id === `appointment_${appointmentId}`
    );
    if (idx === -1) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    const current = all[idx];

    // Cannot update cancelled or completed terminal states
    if (current.status === 'CANCELLED' || current.status === 'COMPLETED') {
      throw new Error(`Cannot update appointment in terminal status: ${current.status}`);
    }

    // Validate status transitions
    if (updates.status && updates.status !== current.status) {
      const from = current.status;
      const to = updates.status;
      let valid = false;
      if (from === 'PROPOSED' && ['CONFIRMED', 'RESCHEDULED', 'CANCELLED'].includes(to)) valid = true;
      if (from === 'CONFIRMED' && ['RESCHEDULED', 'CANCELLED', 'COMPLETED'].includes(to)) valid = true;
      if (from === 'RESCHEDULED' && ['CONFIRMED', 'RESCHEDULED', 'CANCELLED'].includes(to)) valid = true;
      if (!valid) {
        throw new Error(`Invalid appointment status transition from ${from} to ${to}`);
      }
    }

    if (updates.durationMinutes !== undefined) {
      if (typeof updates.durationMinutes !== 'number' || updates.durationMinutes <= 0 || updates.durationMinutes > 1440) {
        throw new Error('durationMinutes must be a positive number up to 1440');
      }
    }
    if (updates.note !== undefined && updates.note.length > 1000) {
      throw new Error('note cannot exceed 1000 characters');
    }

    const updatedAppt: Appointment = {
      ...current,
      ...updates,
      // Protect immutable identity keys
      id: current.id,
      requestId: current.requestId,
      customerId: current.customerId,
      providerId: current.providerId,
      providerUserId: current.providerUserId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    all[idx] = updatedAppt;
    await this.saveAppointmentsRaw(all);

    this.notifyApptListeners(updatedAppt.requestId);
    return updatedAppt;
  }

  async cancelAppointment(
    appointmentId: string,
    cancelledByRole: 'customer' | 'provider',
    reason?: string
  ): Promise<Appointment> {
    const existing = await this.getAppointment(appointmentId);
    if (!existing) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }
    const note = reason ? (existing.note ? `${existing.note} | ${reason}` : reason) : existing.note;
    return await this.updateAppointment(appointmentId, {
      status: 'CANCELLED',
      ...(note !== undefined ? { note } : {}),
    });
  }

  async confirmAppointment(
    appointmentId: string,
    confirmedByRole: 'customer' | 'provider'
  ): Promise<Appointment> {
    const existing = await this.getAppointment(appointmentId);
    if (!existing) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }
    if (existing.status !== 'PROPOSED' && existing.status !== 'RESCHEDULED') {
      throw new Error(`Cannot confirm appointment in status: ${existing.status}`);
    }
    return await this.updateAppointment(appointmentId, {
      status: 'CONFIRMED',
    });
  }

  async rescheduleAppointment(
    appointmentId: string,
    scheduledAt: string,
    proposedBy: 'customer' | 'provider',
    note?: string
  ): Promise<Appointment> {
    const existing = await this.getAppointment(appointmentId);
    if (!existing) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }
    if (existing.status !== 'PROPOSED' && existing.status !== 'CONFIRMED' && existing.status !== 'RESCHEDULED') {
      throw new Error(`Cannot reschedule appointment in status: ${existing.status}`);
    }
    return await this.updateAppointment(appointmentId, {
      status: 'RESCHEDULED',
      scheduledAt,
      proposedBy,
      ...(note !== undefined ? { note } : {}),
    });
  }

  async completeAppointment(appointmentId: string): Promise<Appointment> {
    const existing = await this.getAppointment(appointmentId);
    if (!existing) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }
    if (existing.status !== 'CONFIRMED' && existing.status !== 'COMPLETED') {
      throw new Error(`Cannot complete appointment that is not CONFIRMED (status: ${existing.status})`);
    }
    const updatedAppt = await this.updateAppointment(appointmentId, {
      status: 'COMPLETED',
      workStatus: 'WORK_COMPLETED',
      workStatusUpdatedAt: new Date().toISOString(),
    });

    try {
      const req = await this.getRequest(existing.requestId);
      if (req && req.status !== 'COMPLETED') {
        await this.updateRequestStatus(existing.requestId, 'COMPLETED');
      }
    } catch {}

    return updatedAppt;
  }

  async confirmCustomerCompletion(
    requestId: string,
    appointmentId?: string
  ): Promise<{ request: ServiceRequest; appointment?: Appointment }> {
    const existingReq = await this.getRequest(requestId);
    if (!existingReq) {
      throw new Error(`Request not found: ${requestId}`);
    }
    const cleanApptId = (appointmentId || '').trim();
    const apptId = cleanApptId || existingReq.id;
    const existingAppt = await this.getAppointment(apptId);
    let updatedAppt: Appointment | undefined = undefined;

    if (existingAppt) {
      const isMatching =
        existingAppt.customerId === existingReq.customerId && existingAppt.requestId === requestId;
      if (cleanApptId && !isMatching) {
        throw new Error('Unauthorized: Appointment does not belong to this request or customer');
      }
      if (isMatching) {
        if (existingAppt.status === 'CONFIRMED' || existingAppt.status === 'COMPLETED') {
          updatedAppt = await this.updateAppointment(existingAppt.id, {
            status: 'COMPLETED',
            workStatus: 'WORK_COMPLETED',
            workStatusUpdatedAt: new Date().toISOString(),
          });
        } else {
          updatedAppt = existingAppt;
        }
      }
    } else if (cleanApptId && cleanApptId !== existingReq.id) {
      throw new Error(`Appointment not found: ${cleanApptId}`);
    }

    const updatedReq = await this.updateRequestStatus(requestId, 'COMPLETED');
    return { request: updatedReq || existingReq, appointment: updatedAppt };
  }

  async updateWorkStatus(
    appointmentId: string,
    workStatus: WorkStatus,
    providerUserId: string
  ): Promise<Appointment> {
    const existing = await this.getAppointment(appointmentId);
    if (!existing) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }
    if (existing.status === 'CANCELLED') {
      throw new Error('Validation Error: Cannot update work status on a CANCELLED appointment');
    }

    // Authorization check: Only assigned provider can update work status
    const cleanProviderUid = (providerUserId || '').trim();
    const assignedProviderUserId = (existing.providerUserId || '').trim();
    const assignedProviderId = (existing.providerId || '').trim();
    if (
      cleanProviderUid !== assignedProviderUserId &&
      cleanProviderUid !== assignedProviderId
    ) {
      throw new Error(
        `Unauthorized: Only the assigned provider (${assignedProviderUserId || assignedProviderId}) can update work status, got ${cleanProviderUid}`
      );
    }

    // Transition validation
    if (!isValidWorkStatusTransition(existing.workStatus, workStatus)) {
      throw new Error(
        `Invalid work status transition from ${existing.workStatus || 'NOT_STARTED'} to ${workStatus}`
      );
    }

    const now = new Date().toISOString();
    const updates: Partial<Appointment> = {
      workStatus,
      workStatusUpdatedAt: now,
    };

    // If work status reaches WORK_COMPLETED, also mark appointment completed
    if (workStatus === 'WORK_COMPLETED' && (existing.status === 'CONFIRMED' || existing.status === 'PROPOSED' || existing.status === 'RESCHEDULED')) {
      updates.status = 'COMPLETED';
    }

    const updatedAppt = await this.updateAppointment(appointmentId, updates);

    try {
      const req = await this.getRequest(existing.requestId);
      if (req) {
        if (workStatus === 'WORK_COMPLETED' && req.status !== 'COMPLETED') {
          await this.updateRequestStatus(existing.requestId, 'COMPLETED');
        } else if (
          ['WORK_STARTED', 'PROVIDER_ARRIVED', 'PROVIDER_ON_THE_WAY'].includes(workStatus) &&
          ['PROVIDER_SELECTED', 'ACCEPTED'].includes(req.status)
        ) {
          await this.updateRequestStatus(existing.requestId, 'IN_PROGRESS');
        }
      }
    } catch {}

    return updatedAppt;
  }

  subscribeToAppointment(
    requestId: string,
    onUpdate: (appointment: Appointment | null) => void,
    _onError?: (error: any) => void
  ): () => void {
    const cleanReqId = (requestId || '').trim();
    if (!cleanReqId) {
      return () => {};
    }

    if (!this.apptListeners.has(cleanReqId)) {
      this.apptListeners.set(cleanReqId, new Set());
    }
    this.apptListeners.get(cleanReqId)!.add(onUpdate);

    // Deliver current state immediately
    this.getAppointment(cleanReqId).then((appt) => {
      onUpdate(appt);
    });

    return () => {
      const set = this.apptListeners.get(cleanReqId);
      if (set) {
        set.delete(onUpdate);
        if (set.size === 0) {
          this.apptListeners.delete(cleanReqId);
        }
      }
    };
  }
}

// Export singleton instance conforming to the Repository interface
export const localRepository: Repository = new LocalRepository();
