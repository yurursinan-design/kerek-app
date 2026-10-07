import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
} from 'firebase/firestore';
import {
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
import {
  db,
  auth,
  isFirebaseConfigured,
  ensureFirebaseAuth,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from './firebase';
import { matchProviders } from './matchingService';
import { INITIAL_DEMO_PROVIDERS } from './storage';
import {
  validateOfferData,
  validateProviderData,
  validateRequestData,
  validateReviewData,
} from './validation';
import { getCurrentUserId } from './localRepository';
import { CANONICAL_CITIES, CANONICAL_CATEGORIES, normalizeCategoryId, normalizeCityId } from './taxonomy';

/**
 * Sanitizes an object before sending to Cloud Firestore.
 * Removes all properties whose values are `undefined` (which Firestore rejects with an error).
 */
export function sanitizeForFirestore<T extends Record<string, any>>(obj: T): Record<string, any> {
  const clean: Record<string, any> = {};
  if (!obj || typeof obj !== 'object') return clean;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      // Strictly prevent empty string from being written to Firestore as selectedOfferId
      if (key === 'selectedOfferId' && typeof value === 'string' && !value.trim()) {
        continue;
      }
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        clean[key] = sanitizeForFirestore(value);
      } else {
        clean[key] = value;
      }
    }
  }
  return clean;
}

/**
 * Normalizes request status into the 5 standard statuses:
 * 1. OPEN (new request, seeking offers; maps 'OPEN', 'NEW', 'MATCHING', 'OFFERS_RECEIVED')
 * 2. PROVIDER_SELECTED (customer picked a provider; maps 'PROVIDER_SELECTED', 'ACCEPTED')
 * 3. IN_PROGRESS (job is ongoing)
 * 4. COMPLETED (job finished)
 * 5. CANCELLED (request cancelled; maps 'CANCELLED', 'REJECTED')
 */
export function normalizeRequestStatus(status?: string): RequestStatus {
  if (!status) return 'OPEN';
  const s = status.trim().toUpperCase();
  if (s === 'ACCEPTED' || s === 'PROVIDER_SELECTED') {
    return 'PROVIDER_SELECTED';
  }
  if (s === 'IN_PROGRESS') {
    return 'IN_PROGRESS';
  }
  if (s === 'COMPLETED') {
    return 'COMPLETED';
  }
  if (s === 'CANCELLED' || s === 'REJECTED') {
    return 'CANCELLED';
  }
  return 'OPEN';
}

export class FirebaseRepository implements Repository {
  private isServicePermitted: boolean = true;
  private hasInitializedHealthCheck: boolean = false;

  constructor() {
    if (isFirebaseConfigured() && db !== null) {
      this.initHealthCheck();
    }
  }

  private async initHealthCheck() {
    if (this.hasInitializedHealthCheck) return;
    this.hasInitializedHealthCheck = true;
    try {
      const ok = await testFirestoreConnection();
      this.isServicePermitted = ok;
      if (ok) {
        console.log('[KEREK Firebase] Firestore connection verified successfully.');
      } else {
        console.warn('[KEREK Firebase] Firestore connection probe failed. Operations will attempt cloud with automatic local fallback.');
      }
    } catch (e) {
      console.error('[KEREK Firebase] Firestore health check error:', e);
    }
  }

  /**
   * Checks if Firebase is initialized and configured
   */
  public isAvailable(): boolean {
    return isFirebaseConfigured() && db !== null;
  }

  public markPermissionDenied(): void {
    console.warn('[KEREK Firebase] Firestore permission note: Operation fell back to LocalRepository.');
  }

  private ensureDb() {
    if (!db) {
      throw new Error('Firebase Firestore is not initialized or configured.');
    }
    return db;
  }

  // =================== Users ===================
  async createUser(userData: Partial<User>): Promise<User> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const id = auth?.currentUser?.uid || userData.id || getCurrentUserId();
    const newUser: User = {
      id,
      role: userData.role || 'customer',
      name: userData.name || '',
      phone: userData.phone || '',
      createdAt: userData.createdAt || new Date().toISOString(),
    };

    try {
      const userRef = doc(firestore, 'users', id);
      await setDoc(userRef, sanitizeForFirestore(newUser), { merge: true });
      return newUser;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${id}`);
    }
  }

  async getUser(userId: string): Promise<User | null> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    try {
      const userRef = doc(firestore, 'users', userId);
      const snap = await getDoc(userRef);
      if (!snap.exists()) return null;
      return snap.data() as User;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
    }
  }

  // =================== Providers ===================
  async createProvider(providerData: Partial<Provider>): Promise<Provider> {
    await ensureFirebaseAuth();
    const validation = validateProviderData(providerData);
    if (!validation.valid) {
      throw new Error(`Validation Error: ${validation.message}`);
    }

    const firestore = this.ensureDb();
    const currentUid = auth?.currentUser?.uid;
    const userId = currentUid || providerData.userId || getCurrentUserId();
    // Document ID and Provider ID are strictly the authenticated user's UID (1 user = 1 provider profile)
    const id = userId;

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
      availability: providerData.availability || providerData.workingHours || '09:00 - 20:00',
      verified: providerData.verified ?? false,
      isDemo: false,
      createdAt: providerData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const provRef = doc(firestore, 'providers', id);
      await setDoc(provRef, sanitizeForFirestore(newProvider), { merge: true });
      return newProvider;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `providers/${id}`);
    }
  }

  async getProvider(providerId: string): Promise<Provider | null> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    try {
      const provRef = doc(firestore, 'providers', providerId);
      const snap = await getDoc(provRef);
      if (snap.exists()) {
        const rawProv = snap.data() as Provider;
        return {
          ...rawProv,
          cityId: rawProv.cityId || normalizeCityId(rawProv.city),
          categoryId: rawProv.categoryId || normalizeCategoryId(rawProv.category),
        };
      }
      // Check seeded demo providers fallback
      const demo = INITIAL_DEMO_PROVIDERS.find((p) => p.id === providerId);
      if (demo) {
        return {
          ...demo,
          cityId: demo.cityId || normalizeCityId(demo.city),
          categoryId: demo.categoryId || normalizeCategoryId(demo.category),
        };
      }
      return null;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `providers/${providerId}`);
    }
  }

  async getProviders(filter?: ProviderFilter): Promise<Provider[]> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const providers: Provider[] = [];

    const targetCityId = filter?.cityId || (filter?.city ? normalizeCityId(filter.city) : undefined);
    const targetCatId = filter?.categoryId || (filter?.category ? normalizeCategoryId(filter.category) : undefined);

    // Under strict Firestore Rules ("allow list: if false;"), blanket queries on
    // /providers are strictly prohibited to prevent provider directory scraping.
    // Instead, retrieve the current authenticated user's provider document directly via getDoc.
    const uid = auth?.currentUser?.uid || getCurrentUserId();
    if (uid) {
      try {
        const provRef = doc(firestore, 'providers', uid);
        const snap = await getDoc(provRef);
        if (snap.exists()) {
          const rawProv = snap.data() as Provider;
          const prov: Provider = {
            ...rawProv,
            cityId: rawProv.cityId || normalizeCityId(rawProv.city),
            categoryId: rawProv.categoryId || normalizeCategoryId(rawProv.category),
          };

          let matches = true;
          if (targetCityId && prov.cityId !== targetCityId) {
            matches = false;
          }
          if (targetCatId && prov.categoryId !== targetCatId) {
            matches = false;
          }
          if (matches) {
            providers.push(prov);
          }
        }
      } catch (err) {
        // If lookup fails or document does not exist, safely do not throw permission-denied
        console.warn('[KEREK Firebase] Direct provider profile lookup note:', err);
      }
    }

    // Merge with demo providers for rich experience, respecting canonical filter
    let demoList = INITIAL_DEMO_PROVIDERS.map((p) => ({
      ...p,
      cityId: p.cityId || normalizeCityId(p.city),
      categoryId: p.categoryId || normalizeCategoryId(p.category),
    }));

    if (targetCityId) {
      demoList = demoList.filter((p) => p.cityId === targetCityId);
    }
    if (targetCatId) {
      demoList = demoList.filter((p) => p.categoryId === targetCatId);
    }

    providers.push(...demoList);
    return providers;
  }

  // =================== Requests ===================
  async createRequest(requestData: Partial<ServiceRequest>): Promise<ServiceRequest> {
    await ensureFirebaseAuth();

    // 1. Validate incoming data
    const validation = validateRequestData(requestData);
    if (!validation.valid) {
      throw new Error(`Validation Error: ${validation.message}`);
    }

    const firestore = this.ensureDb();
    const customerId = auth?.currentUser?.uid || requestData.customerId || getCurrentUserId();
    const nowTimestamp = Date.now().toString().slice(-6);
    const id = requestData.id || `REQ-${nowTimestamp}`;

    const city = requestData.city?.trim() || 'Қызылорда';
    const cityId = requestData.cityId || normalizeCityId(city);
    const category = requestData.category?.trim() || 'Тұрмыстық техника жөндеу';
    const categoryId = requestData.categoryId || normalizeCategoryId(category);

    const firestoreStatus =
      requestData.status === 'OPEN' || !requestData.status
        ? 'MATCHING'
        : requestData.status;

    const reqText = (requestData.requestText || requestData.description || requestData.service || '').trim();
    const service = (requestData.service || reqText || category).trim();
    const newRequest: ServiceRequest = {
      id,
      customerId,
      customerName: requestData.customerName?.trim() || 'Клиент',
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
      status: firestoreStatus,
      createdAt: requestData.createdAt || new Date().toISOString(),
    };

    if (requestData.customerPhone && requestData.customerPhone.trim()) {
      newRequest.customerPhone = requestData.customerPhone.trim();
    }
    if (requestData.selectedOfferId && requestData.selectedOfferId.trim()) {
      newRequest.selectedOfferId = requestData.selectedOfferId.trim();
    }

    try {
      const reqRef = doc(firestore, 'requests', id);
      await setDoc(reqRef, sanitizeForFirestore(newRequest));

      // Generate demo offers to simulate immediate marketplace responsiveness
      await this.generateDemoOffersForRequest(newRequest);

      return {
        ...newRequest,
        status: normalizeRequestStatus(newRequest.status),
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `requests/${id}`);
    }
  }

  async getRequest(requestId: string): Promise<ServiceRequest | null> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    try {
      const reqRef = doc(firestore, 'requests', requestId);
      const snap = await getDoc(reqRef);
      if (!snap.exists()) return null;
      const data = snap.data() as ServiceRequest;
      const cleanSelectedOfferId =
        typeof data.selectedOfferId === 'string' && data.selectedOfferId.trim()
          ? data.selectedOfferId.trim()
          : undefined;
      return {
        ...data,
        status: normalizeRequestStatus(data.status),
        selectedOfferId: cleanSelectedOfferId,
        cityId: data.cityId || normalizeCityId(data.city),
        categoryId: data.categoryId || normalizeCategoryId(data.category),
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `requests/${requestId}`);
    }
  }

  async getRequests(filter?: RequestFilter): Promise<ServiceRequest[]> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();

    try {
      const requestsColl = collection(firestore, 'requests');
      let q = query(requestsColl);

      let snap;
      if (filter?.customerId) {
        // Customer view: align with authenticated customer ID if available
        const effectiveCustomerId = auth?.currentUser?.uid || filter.customerId;
        const q = query(requestsColl, where('customerId', '==', effectiveCustomerId));
        snap = await getDocs(q);
      } else if (filter?.cityId && filter?.categoryId) {
        // Provider view: query by cityId and categoryId conforming to firestore.rules
        try {
          const q = query(
            requestsColl,
            where('cityId', '==', filter.cityId),
            where('categoryId', '==', filter.categoryId)
          );
          snap = await getDocs(q);
        } catch (idErr: any) {
          // If Firestore security rules on project enforce city/category text match, fallback to text query on cloud
          const targetCity =
            filter.city || CANONICAL_CITIES.find((c) => c.id === filter.cityId)?.nameKz;
          const targetCategory =
            filter.category || CANONICAL_CATEGORIES.find((c) => c.id === filter.categoryId)?.nameKz;
          let fetched = false;
          if (targetCity && targetCategory) {
            try {
              const qText = query(
                requestsColl,
                where('city', '==', targetCity),
                where('category', '==', targetCategory)
              );
              snap = await getDocs(qText);
              fetched = true;
            } catch {
              fetched = false;
            }
          }
          if (!fetched) {
            // When broad provider queries are restricted by security rules,
            // query current user's customer requests on same session/auth UID so they can be viewed
            const currentUid = auth?.currentUser?.uid;
            if (currentUid) {
              const qUser = query(requestsColl, where('customerId', '==', currentUid));
              snap = await getDocs(qUser);
            } else {
              throw idErr;
            }
          }
        }
      } else if (filter?.city && filter?.category) {
        const q = query(
          requestsColl,
          where('city', '==', filter.city),
          where('category', '==', filter.category)
        );
        snap = await getDocs(q);
      } else if (filter?.cityId) {
        const q = query(requestsColl, where('cityId', '==', filter.cityId));
        snap = await getDocs(q);
      } else if (filter?.categoryId) {
        const q = query(requestsColl, where('categoryId', '==', filter.categoryId));
        snap = await getDocs(q);
      } else {
        const q = query(requestsColl);
        snap = await getDocs(q);
      }
      let requests: ServiceRequest[] = (snap ? snap.docs : []).map((d) => {
        const r = d.data() as ServiceRequest;
        const cleanSelectedOfferId =
          typeof r.selectedOfferId === 'string' && r.selectedOfferId.trim()
            ? r.selectedOfferId.trim()
            : undefined;
        return {
          ...r,
          status: normalizeRequestStatus(r.status),
          selectedOfferId: cleanSelectedOfferId,
          cityId: r.cityId || normalizeCityId(r.city),
          categoryId: r.categoryId || normalizeCategoryId(r.category),
        };
      });

      if (filter?.cityId) {
        requests = requests.filter((r) => r.cityId === filter.cityId);
      }
      if (filter?.categoryId) {
        requests = requests.filter((r) => r.categoryId === filter.categoryId);
      }

      // PRIVACY ENFORCEMENT:
      // If requests are fetched for providers (i.e. not by customerId),
      // redact the customerPhone before offer acceptance.
      if (!filter?.customerId) {
        requests = requests.map((r) => {
          if (
            r.status !== 'ACCEPTED' &&
            r.status !== 'PROVIDER_SELECTED' &&
            r.status !== 'IN_PROGRESS' &&
            r.status !== 'COMPLETED'
          ) {
            const { customerPhone: _, ...safeReq } = r;
            return safeReq as ServiceRequest;
          }
          return r;
        });
      }

      return requests;
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn(
          '[FirebaseRepository] Note: Cloud Firestore requests list query restricted by security rules. Falling back gracefully to LocalRepository.'
        );
        throw new Error(`FirestorePermissionDenied: ${msg}`);
      }
      handleFirestoreError(err, OperationType.LIST, 'requests');
    }
  }

  async updateRequest(
    requestId: string,
    updates: Partial<ServiceRequest>
  ): Promise<ServiceRequest | null> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanReqId = (requestId || '').trim();

    // Prevent writing empty string or undefined as selectedOfferId
    const safeUpdates: Partial<ServiceRequest> = { ...updates };
    if ('selectedOfferId' in safeUpdates) {
      if (typeof safeUpdates.selectedOfferId === 'string') {
        const trimmed = safeUpdates.selectedOfferId.trim();
        if (trimmed) {
          safeUpdates.selectedOfferId = trimmed;
        } else {
          // If empty string, do not overwrite with empty string
          delete safeUpdates.selectedOfferId;
        }
      } else if (!safeUpdates.selectedOfferId) {
        delete safeUpdates.selectedOfferId;
      }
    }

    // If status is being updated to PROVIDER_SELECTED or ACCEPTED but selectedOfferId is missing, attempt to find accepted offer
    if (
      (safeUpdates.status === 'PROVIDER_SELECTED' || safeUpdates.status === 'ACCEPTED') &&
      !safeUpdates.selectedOfferId
    ) {
      try {
        const offers = await this.getOffers({ requestId: cleanReqId });
        const accepted = offers.find((o) => o.status === 'ACCEPTED');
        if (accepted && accepted.id) {
          safeUpdates.selectedOfferId = accepted.id;
        }
      } catch (e) {
        console.warn('[FirebaseRepository] Note resolving selectedOfferId for accepted request:', e);
      }
    }

    try {
      const reqRef = doc(firestore, 'requests', cleanReqId);
      await updateDoc(reqRef, sanitizeForFirestore(safeUpdates));
      return await this.getRequest(cleanReqId);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `requests/${cleanReqId}`);
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

  // =================== Offers ===================
  async createOffer(offerData: Partial<ProviderOffer>): Promise<ProviderOffer> {
    await ensureFirebaseAuth();
    const validation = validateOfferData(offerData);
    if (!validation.valid) {
      throw new Error(`Validation Error: ${validation.message}`);
    }

    const firestore = this.ensureDb();
    const providerUserId = auth?.currentUser?.uid || getCurrentUserId();
    const id = offerData.id || `OFFER-${offerData.requestId || 'REQ'}-${Date.now().toString().slice(-4)}`;

    const priceType = offerData.priceType || 'fixed';
    let price = (offerData.price || '').trim();
    if (priceType === 'inspection') {
      price = price || 'После осмотра';
    } else if (!price) {
      price = 'Договорная';
    }

    const newOffer: ProviderOffer = {
      id,
      requestId: offerData.requestId || '',
      providerId: offerData.providerId || '',
      providerUserId,
      providerName: offerData.providerName || '',
      providerPhone: offerData.providerPhone || '',
      providerWhatsapp: offerData.providerWhatsapp || '',
      isDemo: offerData.isDemo || false,
      price,
      priceType,
      availability: offerData.availability || 'В течение часа',
      message: offerData.message || '',
      status: 'PENDING',
      createdAt: offerData.createdAt || new Date().toISOString(),
    };

    try {
      const offerRef = doc(firestore, 'offers', id);
      await setDoc(offerRef, sanitizeForFirestore(newOffer));

      // Upgrade request status to OFFERS_RECEIVED if it was NEW or MATCHING
      if (newOffer.requestId) {
        const req = await this.getRequest(newOffer.requestId);
        if (req && (req.status === 'MATCHING' || req.status === 'NEW')) {
          await this.updateRequest(req.id, { status: 'OFFERS_RECEIVED' });
        }
      }

      return newOffer;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `offers/${id}`);
    }
  }

  async getOffers(filter?: OfferFilter): Promise<ProviderOffer[]> {
    // 1. Guard against unfiltered or empty queries: NEVER fetch full collection from Firestore
    if (!filter || (!filter.requestId && !filter.providerId && !filter.providerUserId)) {
      return [];
    }

    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const currentUid = auth?.currentUser?.uid;

    try {
      const offersColl = collection(firestore, 'offers');

      if (filter.requestId) {
        // Customer query: strictly by requestId
        // Authorization is enforced by Firestore Rules: get(requests/requestId).data.customerId == request.auth.uid
        const q = query(offersColl, where('requestId', '==', filter.requestId));
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProviderOffer));
      }

      // Provider query: query directly by providerUserId (authenticated provider UID)
      // Matches Firestore rule: resource.data.providerUserId == request.auth.uid
      const targetProviderUserId = filter.providerUserId || currentUid;
      if (targetProviderUserId) {
        const q = query(offersColl, where('providerUserId', '==', targetProviderUserId));
        const snap = await getDocs(q);
        let offers = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProviderOffer));

        if (filter.providerId) {
          offers = offers.filter((o) => !o.providerId || o.providerId === filter.providerId);
        }

        return offers;
      }

      return [];
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn(
          '[FirebaseRepository] Note: Cloud Firestore offers list query restricted by security rules. Falling back gracefully to LocalRepository.'
        );
        throw new Error(`FirestorePermissionDenied: ${msg}`);
      }
      handleFirestoreError(err, OperationType.LIST, 'offers');
    }
  }

  /**
   * Atomically accepts an offer for a request:
   * 1. Accepted offer: status = "ACCEPTED"
   * 2. Request: status = "ACCEPTED", selectedOfferId = cleanOfferId
   * 3. Sibling offers for this request: status = "REJECTED"
   */
  async acceptOffer(
    requestId: string,
    offerId: string
  ): Promise<{ request: ServiceRequest | null; offer: ProviderOffer | null }> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanReqId = (requestId || '').trim();
    const cleanOfferId = (offerId || '').trim();

    if (!cleanReqId || !cleanOfferId) {
      throw new Error(`acceptOffer requires valid requestId and offerId. Received: '${requestId}', '${offerId}'`);
    }

    try {
      // 1. Fetch sibling offers for this request
      let siblingOffers: ProviderOffer[] = [];
      try {
        siblingOffers = await this.getOffers({ requestId: cleanReqId });
      } catch (siblingFetchErr) {
        console.warn('[FirebaseRepository] Note fetching sibling offers before accept:', siblingFetchErr);
      }

      // 2. Perform atomic batch update
      const batch = writeBatch(firestore);
      const offerRef = doc(firestore, 'offers', cleanOfferId);
      const reqRef = doc(firestore, 'requests', cleanReqId);

      batch.update(offerRef, { status: 'ACCEPTED' });
      batch.update(reqRef, {
        status: 'PROVIDER_SELECTED',
        selectedOfferId: cleanOfferId,
      });

      for (const sibling of siblingOffers) {
        if (sibling.id && sibling.id !== cleanOfferId) {
          batch.update(doc(firestore, 'offers', sibling.id), { status: 'REJECTED' });
        }
      }

      await batch.commit();

      const [updatedReq, updatedOfferSnap] = await Promise.all([
        this.getRequest(cleanReqId),
        getDoc(offerRef),
      ]);

      const updatedOffer = updatedOfferSnap.exists()
        ? ({ id: updatedOfferSnap.id, ...updatedOfferSnap.data() } as ProviderOffer)
        : null;

      return { request: updatedReq, offer: updatedOffer };
    } catch (batchErr) {
      console.warn('[FirebaseRepository] Batch accept failed, executing safe sequential writes:', batchErr);

      // Safe sequential fallback
      try {
        await updateDoc(doc(firestore, 'offers', cleanOfferId), { status: 'ACCEPTED' });
        await updateDoc(doc(firestore, 'requests', cleanReqId), {
          status: 'PROVIDER_SELECTED',
          selectedOfferId: cleanOfferId,
        });

        const siblingOffers = await this.getOffers({ requestId: cleanReqId });
        for (const sibling of siblingOffers) {
          if (sibling.id && sibling.id !== cleanOfferId) {
            try {
              await updateDoc(doc(firestore, 'offers', sibling.id), { status: 'REJECTED' });
            } catch (siblingErr) {
              console.warn('[FirebaseRepository] Note on rejecting sibling offer:', sibling.id, siblingErr);
            }
          }
        }

        const [updatedReq, updatedOfferSnap] = await Promise.all([
          this.getRequest(cleanReqId),
          getDoc(doc(firestore, 'offers', cleanOfferId)),
        ]);

        const updatedOffer = updatedOfferSnap.exists()
          ? ({ id: updatedOfferSnap.id, ...updatedOfferSnap.data() } as ProviderOffer)
          : null;

        return { request: updatedReq, offer: updatedOffer };
      } catch (seqErr) {
        handleFirestoreError(seqErr, OperationType.UPDATE, `requests/${cleanReqId}`);
      }
    }
  }

  async updateOffer(
    offerId: string,
    updates: Partial<ProviderOffer>
  ): Promise<ProviderOffer | null> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanOfferId = (offerId || '').trim();

    try {
      const offerRef = doc(firestore, 'offers', cleanOfferId);

      // If an offer is ACCEPTED, route to acceptOffer if requestId can be resolved
      if (updates.status === 'ACCEPTED') {
        let reqId = '';
        try {
          const snap = await getDoc(offerRef);
          if (snap.exists()) {
            const data = snap.data() as ProviderOffer;
            reqId = (data.requestId || '').trim();
          }
        } catch (e) {
          console.warn('[FirebaseRepository] Note reading offer for requestId in updateOffer:', e);
        }

        if (!reqId && cleanOfferId.startsWith('OFFER-REQ-')) {
          reqId = cleanOfferId.replace(/^OFFER-/, '').replace(/-\d+$/, '');
        }

        if (reqId) {
          const result = await this.acceptOffer(reqId, cleanOfferId);
          return result.offer;
        }
      }

      await updateDoc(offerRef, sanitizeForFirestore(updates));
      const snap = await getDoc(offerRef);
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as ProviderOffer;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `offers/${cleanOfferId}`);
    }
  }

  // =================== Matching ===================
  async matchProviders(request: ServiceRequest): Promise<Provider[]> {
    try {
      const all = await this.getProviders();
      return matchProviders(request, all);
    } catch {
      return INITIAL_DEMO_PROVIDERS.slice(0, 3);
    }
  }

  // Helper: Seed initial simulated demo offers in Firestore for realistic testing
  private async generateDemoOffersForRequest(request: ServiceRequest): Promise<void> {
    try {
      const matched = await this.matchProviders(request);
      const demoProviders = matched.filter((p) => p.isDemo).slice(0, 2);

      const templates = [
        {
          price: '15 000 ₸',
          availability: 'Сегодня, 40 минут',
          message: 'Құрал-саймандар өзімде бар. Келіп диагностика жасап, дереу жөндеп беремін.',
        },
        {
          price: '18 000 ₸',
          availability: 'Сегодня, 1 час',
          message: 'Түпнұсқа бөлшектер мен ресми кепілдік беремін.',
        },
      ];

      for (let i = 0; i < demoProviders.length; i++) {
        const prov = demoProviders[i];
        const tmpl = templates[i % templates.length];
        const offerId = `OFFER-${request.id}-${i + 1}`;
        await this.createOffer({
          id: offerId,
          requestId: request.id,
          providerId: prov.id,
          providerName: prov.name,
          providerPhone: prov.phone,
          providerWhatsapp: prov.whatsapp,
          isDemo: true,
          price: tmpl.price,
          availability: tmpl.availability,
          message: tmpl.message,
          status: 'PENDING',
        });
      }
    } catch (err) {
      console.warn('[FirebaseRepository] Note: could not generate demo offers:', err);
    }
  }

  // =================== Reviews ===================
  async createReview(reviewData: Partial<Review>): Promise<Review> {
    await ensureFirebaseAuth();
    const requestId = reviewData.requestId?.trim() || '';
    if (!requestId) {
      throw new Error('Validation Error: requestId is required');
    }

    const firestore = this.ensureDb();
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();

    // Check cross-document request state
    let req = await this.getRequest(requestId);
    if (req && normalizeRequestStatus(req.status) !== 'COMPLETED') {
      try {
        await this.updateRequestStatus(requestId, 'COMPLETED');
        req = await this.getRequest(requestId);
      } catch (e) {
        console.warn('[FirebaseRepository] Note ensuring COMPLETED status before review:', e);
      }
    }

    let acceptedOffer: ProviderOffer | null = null;
    if (req?.selectedOfferId) {
      const offSnap = await getDoc(doc(firestore, 'offers', req.selectedOfferId));
      if (offSnap.exists()) {
        acceptedOffer = offSnap.data() as ProviderOffer;
      }
    }
    if (!acceptedOffer) {
      try {
        const siblingOffers = await this.getOffers({ requestId });
        const accepted = siblingOffers.find((o) => o.status === 'ACCEPTED');
        if (accepted) {
          acceptedOffer = accepted;
        }
      } catch (e) {
        console.warn('[FirebaseRepository] Note resolving accepted offer for review:', e);
      }
    }

    const customerId = reviewData.customerId?.trim() || req?.customerId || currentUid;
    const providerId = reviewData.providerId?.trim() || acceptedOffer?.providerId || '';

    const reviewPayload: Partial<Review> = {
      ...reviewData,
      customerId,
      providerId,
    };

    const isAnonymousSession = Boolean(
      auth?.currentUser?.isAnonymous ||
      getCurrentUserId().startsWith('usr-') ||
      getCurrentUserId() === 'temp-local-user-id'
    );

    const validation = validateReviewData(reviewPayload, req, acceptedOffer, 'ru', isAnonymousSession);
    if (!validation.valid) {
      throw new Error(`Validation Error: ${validation.message}`);
    }

    // Document ID is strictly the requestId (/reviews/{requestId})
    const id = requestId;
    const newReview: Review = {
      id,
      requestId,
      customerId,
      customerName: reviewData.customerName?.trim() || req?.customerName || 'Клиент',
      providerId,
      providerName: reviewData.providerName?.trim() || acceptedOffer?.providerName || 'Мастер',
      rating: Math.floor(reviewData.rating!),
      comment: reviewData.comment?.trim() || '',
      createdAt: new Date().toISOString(),
    };

    try {
      const reviewRef = doc(firestore, 'reviews', id);
      // Check if doc already exists to ensure idempotency
      const existingSnap = await getDoc(reviewRef);
      if (existingSnap.exists()) {
        throw new Error('Duplicate Review Error: A review already exists for this completed request');
      }

      await setDoc(reviewRef, sanitizeForFirestore(newReview));
      return newReview;
    } catch (err: any) {
      if (err?.message?.includes('Duplicate Review Error')) {
        throw err;
      }
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn(
          `[FirebaseRepository] Note: Cloud Firestore review write on 'reviews/${id}' restricted by security rules. Falling back gracefully to LocalRepository.`
        );
        throw new Error(`FirestorePermissionDenied: ${msg}`);
      }
      handleFirestoreError(err, OperationType.WRITE, `reviews/${id}`);
    }
  }

  async getReviews(filter?: ReviewFilter): Promise<Review[]> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const reviews: Review[] = [];

    try {
      if (filter?.requestId) {
        // Direct single document lookup by requestId
        const reviewRef = doc(firestore, 'reviews', filter.requestId.trim());
        const snap = await getDoc(reviewRef);
        if (snap.exists()) {
          reviews.push(snap.data() as Review);
        }
        return reviews;
      }

      const reviewsCol = collection(firestore, 'reviews');
      let q = query(reviewsCol);

      if (filter?.providerId) {
        q = query(reviewsCol, where('providerId', '==', filter.providerId.trim()));
      }

      const querySnapshot = await getDocs(q);
      querySnapshot.forEach((d) => {
        reviews.push(d.data() as Review);
      });

      return reviews;
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn('[FirebaseRepository] Note: Cloud Firestore reviews permissions not active on project. Returning empty reviews gracefully.');
        return [];
      }
      handleFirestoreError(err, OperationType.LIST, 'reviews');
    }
  }

  // =================== Real-Time Preparation ===================
  // TODO: Future: Firestore realtime listeners for requests and offers.
  // Example future implementation:
  // subscribeToCustomerRequests(customerId: string, onUpdate: (requests: ServiceRequest[]) => void): () => void
  // subscribeToRequestOffers(requestId: string, onUpdate: (offers: ProviderOffer[]) => void): () => void
}

export const firebaseRepository = new FirebaseRepository();
