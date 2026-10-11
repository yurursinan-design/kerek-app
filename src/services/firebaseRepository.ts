import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import {
  Appointment,
  AppNotification,
  ChatAttachment,
  ChatMessage,
  Conversation,
  getAppointmentId,
  getConversationId,
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
  isValidWorkStatusTransition,
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
  storage,
  isFirebaseConfigured,
  ensureFirebaseAuth,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from './firebase';
import { matchProviders } from './matchingService';
import { INITIAL_DEMO_PROVIDERS } from './storage';
import { notificationService } from './notificationService';
import {
  validateOfferData,
  validateProviderData,
  validateRequestData,
  validateReviewData,
} from './validation';
import { getCurrentUserId } from './localRepository';
import { generateOfferId, generateRequestId } from './ids';
import { CANONICAL_CITIES, CANONICAL_CATEGORIES, normalizeCategoryId, normalizeCityId, isCategoryMatch } from './taxonomy';

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
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        return null;
      }
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
      availability: providerData.availability || providerData.workingHours || '09:00 - 20:00',
      // Trust badges are not self-assignable; they stay off until real verification exists
      verified: false,
      iinVerified: false,
      hasCertificate: false,
      ...(providerData.tradeLicense ? { tradeLicense: providerData.tradeLicense } : {}),
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
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        const demo = INITIAL_DEMO_PROVIDERS.find((p) => p.id === providerId);
        if (demo) {
          return {
            ...demo,
            cityId: demo.cityId || normalizeCityId(demo.city),
            categoryId: demo.categoryId || normalizeCategoryId(demo.category),
          };
        }
        return null;
      }
      handleFirestoreError(err, OperationType.GET, `providers/${providerId}`);
    }
  }

  async getProviders(filter?: ProviderFilter): Promise<Provider[]> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const providers: Provider[] = [];

    const targetCityId = filter?.cityId
      ? normalizeCityId(filter.cityId) || filter.cityId
      : filter?.city
      ? normalizeCityId(filter.city)
      : undefined;
    const targetCatId = filter?.categoryId
      ? normalizeCategoryId(filter.categoryId)
      : filter?.category
      ? normalizeCategoryId(filter.category)
      : undefined;

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
            cityId: normalizeCityId(rawProv.cityId || rawProv.city) || rawProv.cityId,
            categoryId: normalizeCategoryId(rawProv.categoryId || rawProv.category),
          };

          let matches = true;
          if (targetCityId && (normalizeCityId(prov.cityId || prov.city) || prov.cityId) !== targetCityId) {
            matches = false;
          }
          if (targetCatId && !isCategoryMatch(prov.categoryId, targetCatId)) {
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
      cityId: normalizeCityId(p.cityId || p.city) || p.cityId,
      categoryId: normalizeCategoryId(p.categoryId || p.category),
    }));

    if (targetCityId) {
      demoList = demoList.filter((p) => (normalizeCityId(p.cityId || p.city) || p.cityId) === targetCityId);
    }
    if (targetCatId) {
      demoList = demoList.filter((p) => isCategoryMatch(p.categoryId, targetCatId));
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
    const id = requestData.id || generateRequestId();

    const rawCity = requestData.city?.trim() || '';
    const city = rawCity.slice(0, 50);
    const cityId = normalizeCityId(requestData.cityId || city) || '';
    const rawCategory = requestData.category?.trim() || '';
    const category = rawCategory.slice(0, 100);
    const categoryId = normalizeCategoryId(requestData.categoryId || category);

    const firestoreStatus =
      requestData.status === 'OPEN' || !requestData.status
        ? 'MATCHING'
        : requestData.status;

    const reqText = (requestData.requestText || requestData.description || requestData.service || '').trim();
    let rawService = (requestData.service || reqText || category).trim();
    if (rawService.length > 150) {
      rawService = rawService.slice(0, 147) + '...';
    }
    const service = rawService.slice(0, 150);
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

    // selectedOfferId is never set at creation: it is only written by acceptOffer
    if (requestData.attachments && requestData.attachments.length > 0) {
      newRequest.attachments = requestData.attachments;
    }
    // The shared request only carries an approximate point (~1 km); the exact location goes to
    // the private requestContacts document that only the customer and the selected provider can read.
    const preciseLocation = requestData.location;
    if (preciseLocation && typeof preciseLocation.latitude === 'number' && typeof preciseLocation.longitude === 'number') {
      newRequest.location = {
        latitude: Math.round(preciseLocation.latitude * 100) / 100,
        longitude: Math.round(preciseLocation.longitude * 100) / 100,
        approximate: true,
      };
    }
    if (requestData.understanding) {
      newRequest.understanding = requestData.understanding;
    }

    try {
      const reqRef = doc(firestore, 'requests', id);
      await setDoc(reqRef, sanitizeForFirestore(newRequest));

      // Privacy: phone number and exact location live in the restricted requestContacts document
      let customerPhone: string | undefined = undefined;
      if (requestData.customerPhone && requestData.customerPhone.trim()) {
        customerPhone = requestData.customerPhone.trim();
      }
      if (customerPhone || newRequest.location) {
        const contactRef = doc(firestore, 'requestContacts', id);
        await setDoc(
          contactRef,
          sanitizeForFirestore({
            requestId: id,
            customerId: customerId || auth?.currentUser?.uid || id,
            ...(customerPhone ? { customerPhone } : {}),
            ...(newRequest.location && preciseLocation ? { location: preciseLocation } : {}),
            createdAt: new Date().toISOString(),
          }),
          { merge: true }
        );
      }

      return {
        ...newRequest,
        ...(customerPhone ? { customerPhone } : {}),
        ...(newRequest.location && preciseLocation ? { location: preciseLocation } : {}),
        status: normalizeRequestStatus(newRequest.status),
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `requests/${id}`);
    }
  }

  async uploadRequestAttachment(
    requestId: string,
    file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string },
    customerId?: string
  ): Promise<RequestAttachment> {
    await ensureFirebaseAuth();
    const cleanId = (requestId || '').trim();
    if (!cleanId) {
      throw new Error('Validation Error: requestId is required');
    }

    const authUid = auth?.currentUser?.uid;
    const effectiveCustId = customerId || authUid || getCurrentUserId();

    // If request already exists, verify current caller is the owner
    try {
      const existing = await this.getRequest(cleanId);
      if (existing && authUid && existing.customerId !== authUid) {
        throw new Error(`Unauthorized: Only the creator of request ${cleanId} can upload attachments`);
      }
    } catch (e: any) {
      if (e?.message?.startsWith('Unauthorized:')) {
        throw e;
      }
      // If request doc does not exist yet, proceed with upload
    }

    const validation = validateRequestAttachment(file);
    if (!validation.isValid) {
      throw new Error(`Validation Error: ${validation.errorKey}`);
    }

    const sanitizedName = sanitizeFileName(file.name);
    const attachmentId = `att_req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const storagePath = `requests/${cleanId}/${attachmentId}_${sanitizedName}`;

    if (!storage) {
      throw new Error('Firebase Storage is not configured or unavailable');
    }

    // Determine binary payload
    let blobPayload: Blob | Uint8Array | ArrayBuffer;
    if (file.data instanceof Blob) {
      blobPayload = file.data;
    } else if (file.data instanceof Uint8Array || file.data instanceof ArrayBuffer) {
      blobPayload = file.data;
    } else if (typeof file.data === 'string' && file.data.startsWith('data:')) {
      const parts = file.data.split(',');
      const byteString = atob(parts[1] || '');
      const mime = parts[0].split(':')[1]?.split(';')[0] || file.type;
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      blobPayload = new Blob([ab], { type: mime });
    } else {
      throw new Error('Attachment payload data is missing or invalid');
    }

    const fileRef = storageRef(storage, storagePath);
    const metadata = {
      contentType: file.type || (validation.type === 'image' ? 'image/jpeg' : validation.type === 'video' ? 'video/mp4' : 'audio/mp3'),
      customMetadata: {
        requestId: cleanId,
        uploadedBy: authUid || effectiveCustId,
        fileName: sanitizedName,
      },
    };

    try {
      const uploadResult = await uploadBytes(fileRef, blobPayload, metadata);
      const downloadUrl = await getDownloadURL(uploadResult.ref);

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
    } catch (err: any) {
      console.error('[FirebaseRepository] uploadRequestAttachment failed:', err);
      throw new Error(`Failed to upload request attachment: ${err?.message || err}`);
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

      let customerPhone = data.customerPhone;
      let preciseLocation: RequestLocation | undefined;
      try {
        // Readable only by the customer and the selected provider; everyone else keeps the approximate point
        const contactRef = doc(firestore, 'requestContacts', requestId);
        const contactSnap = await getDoc(contactRef);
        if (contactSnap.exists()) {
          const contact = contactSnap.data();
          customerPhone = customerPhone || contact?.customerPhone;
          if (contact?.location && typeof contact.location.latitude === 'number') {
            preciseLocation = contact.location as RequestLocation;
          }
        }
      } catch {
        // Not authorized or no contact document: proceed with the shared data only
      }

      return {
        ...data,
        ...(customerPhone ? { customerPhone } : {}),
        ...(preciseLocation ? { location: preciseLocation } : {}),
        status: normalizeRequestStatus(data.status),
        selectedOfferId: cleanSelectedOfferId,
        cityId: data.cityId || normalizeCityId(data.city),
        categoryId: data.categoryId || normalizeCategoryId(data.category),
      };
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn(
          `[FirebaseRepository] Note: getRequest('${requestId}') was restricted by security rules. Gracefully returning null to allow LocalRepository fallback.`
        );
        return null;
      }
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
      const targetCityId = filter?.cityId
        ? normalizeCityId(filter.cityId) || filter.cityId
        : filter?.city
        ? normalizeCityId(filter.city)
        : undefined;
      const targetCatId = filter?.categoryId
        ? normalizeCategoryId(filter.categoryId)
        : filter?.category
        ? normalizeCategoryId(filter.category)
        : undefined;

      if (filter?.customerId) {
        // Customer view: align with authenticated customer ID if available
        const effectiveCustomerId = auth?.currentUser?.uid || filter.customerId;
        const q = query(requestsColl, where('customerId', '==', effectiveCustomerId));
        snap = await getDocs(q);
      } else if (targetCityId && targetCatId) {
        // Provider view: query by cityId and categoryId conforming to firestore.rules
        try {
          const q = query(
            requestsColl,
            where('cityId', '==', targetCityId),
            where('categoryId', '==', targetCatId)
          );
          snap = await getDocs(q);

          // Support legacy 'appliance_repair' if searching for canonical 'appliances'
          if (targetCatId === 'appliances') {
            try {
              const qLegacy = query(
                requestsColl,
                where('cityId', '==', targetCityId),
                where('categoryId', '==', 'appliance_repair')
              );
              const snapLegacy = await getDocs(qLegacy);
              const existingIds = new Set(snap.docs.map((d) => d.id));
              const extraDocs = snapLegacy.docs.filter((d) => !existingIds.has(d.id));
              snap = { docs: [...snap.docs, ...extraDocs] } as any;
            } catch {
              // Ignore legacy query error
            }
          }
        } catch (idErr: any) {
          // If Firestore security rules on project enforce city/category text match, fallback to text query on cloud
          const targetCity =
            filter?.city || CANONICAL_CITIES.find((c) => c.id === targetCityId)?.nameKz;
          const targetCategory =
            filter?.category || CANONICAL_CATEGORIES.find((c) => c.id === targetCatId)?.nameKz;
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
      } else if (targetCityId) {
        const q = query(requestsColl, where('cityId', '==', targetCityId));
        snap = await getDocs(q);
      } else if (targetCatId) {
        const q = query(requestsColl, where('categoryId', '==', targetCatId));
        snap = await getDocs(q);
        if (targetCatId === 'appliances') {
          try {
            const qLegacy = query(requestsColl, where('categoryId', '==', 'appliance_repair'));
            const snapLegacy = await getDocs(qLegacy);
            const existingIds = new Set(snap.docs.map((d) => d.id));
            const extraDocs = snapLegacy.docs.filter((d) => !existingIds.has(d.id));
            snap = { docs: [...snap.docs, ...extraDocs] } as any;
          } catch {}
        }
      } else {
        const q = query(requestsColl);
        snap = await getDocs(q);
      }
      let requests: ServiceRequest[] = (snap ? snap.docs : []).map((d: any) => {
        const r = d.data() as ServiceRequest;
        const cleanSelectedOfferId =
          typeof r.selectedOfferId === 'string' && r.selectedOfferId.trim()
            ? r.selectedOfferId.trim()
            : undefined;
        return {
          ...r,
          status: normalizeRequestStatus(r.status),
          selectedOfferId: cleanSelectedOfferId,
          cityId: normalizeCityId(r.cityId || r.city) || r.cityId,
          categoryId: normalizeCategoryId(r.categoryId || r.category),
        };
      });

      if (targetCityId) {
        requests = requests.filter(
          (r) => (normalizeCityId(r.cityId || r.city) || r.cityId) === targetCityId
        );
      }
      if (targetCatId) {
        requests = requests.filter(
          (r) => r.categoryId === 'other' || isCategoryMatch(r.categoryId, targetCatId)
        );
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

  subscribeToRequests(
    filter: RequestFilter,
    onData: (requests: ServiceRequest[]) => void,
    onError?: (error: any) => void
  ): () => void {
    if (!db) {
      return () => {};
    }

    try {
      const requestsColl = collection(db, 'requests');
      const targetCityId = filter?.cityId
        ? normalizeCityId(filter.cityId) || filter.cityId
        : filter?.city
        ? normalizeCityId(filter.city)
        : undefined;
      const targetCatId = filter?.categoryId
        ? normalizeCategoryId(filter.categoryId)
        : filter?.category
        ? normalizeCategoryId(filter.category)
        : undefined;

      const formatAndFilter = (allDocs: Map<string, ServiceRequest>) => {
        let items: ServiceRequest[] = Array.from(allDocs.values()).map((r) => {
          const cleanSelectedOfferId =
            typeof r.selectedOfferId === 'string' && r.selectedOfferId.trim()
              ? r.selectedOfferId.trim()
              : undefined;
          return {
            ...r,
            status: normalizeRequestStatus(r.status),
            selectedOfferId: cleanSelectedOfferId,
            cityId: normalizeCityId(r.cityId || r.city) || r.cityId,
            categoryId: normalizeCategoryId(r.categoryId || r.category),
          };
        });

        if (targetCityId) {
          items = items.filter(
            (r) => (normalizeCityId(r.cityId || r.city) || r.cityId) === targetCityId
          );
        }
        if (targetCatId) {
          items = items.filter(
            (r) => r.categoryId === 'other' || isCategoryMatch(r.categoryId, targetCatId)
          );
        }

        // Privacy redaction if not customer query
        if (!filter?.customerId) {
          items = items.map((r) => {
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

        items.sort(
          (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
        return items;
      };

      const primaryMap = new Map<string, ServiceRequest>();
      const legacyMap = new Map<string, ServiceRequest>();
      const otherMap = new Map<string, ServiceRequest>();

      const emitCombined = () => {
        const combined = new Map<string, ServiceRequest>();
        primaryMap.forEach((v, k) => combined.set(k, v));
        legacyMap.forEach((v, k) => {
          if (!combined.has(k)) combined.set(k, v);
        });
        otherMap.forEach((v, k) => {
          if (!combined.has(k)) combined.set(k, v);
        });
        onData(formatAndFilter(combined));
      };

      let qPrimary;
      if (filter?.customerId) {
        const effectiveCustomerId = auth?.currentUser?.uid || filter.customerId;
        qPrimary = query(requestsColl, where('customerId', '==', effectiveCustomerId));
      } else if (targetCityId && targetCatId) {
        qPrimary = query(
          requestsColl,
          where('cityId', '==', targetCityId),
          where('categoryId', '==', targetCatId)
        );
      } else if (targetCityId) {
        qPrimary = query(requestsColl, where('cityId', '==', targetCityId));
      } else if (targetCatId) {
        qPrimary = query(requestsColl, where('categoryId', '==', targetCatId));
      } else {
        qPrimary = query(requestsColl);
      }

      const unsubPrimary = onSnapshot(
        qPrimary,
        (snap) => {
          primaryMap.clear();
          snap.forEach((d) => {
            primaryMap.set(d.id, { ...(d.data() as ServiceRequest), id: d.id });
          });
          emitCombined();
        },
        (err) => {
          console.warn('[FirebaseRepository] subscribeToRequests error:', err?.message || err);
          if (onError) onError(err);
        }
      );

      let unsubLegacy: (() => void) | null = null;
      if (targetCatId === 'appliances' && targetCityId) {
        try {
          const qLegacy = query(
            requestsColl,
            where('cityId', '==', targetCityId),
            where('categoryId', '==', 'appliance_repair')
          );
          unsubLegacy = onSnapshot(
            qLegacy,
            (snap) => {
              legacyMap.clear();
              snap.forEach((d) => {
                legacyMap.set(d.id, { ...(d.data() as ServiceRequest), id: d.id });
              });
              emitCombined();
            },
            (err) => {
              console.warn('[FirebaseRepository] subscribeToRequests legacy note:', err?.message || err);
            }
          );
        } catch {}
      }

      let unsubOther: (() => void) | null = null;
      if (targetCityId && targetCatId && targetCatId !== 'other') {
        try {
          const qOther = query(
            requestsColl,
            where('cityId', '==', targetCityId),
            where('categoryId', '==', 'other')
          );
          unsubOther = onSnapshot(
            qOther,
            (snap) => {
              otherMap.clear();
              snap.forEach((d) => {
                otherMap.set(d.id, { ...(d.data() as ServiceRequest), id: d.id });
              });
              emitCombined();
            },
            (err) => {
              console.warn('[FirebaseRepository] subscribeToRequests other note:', err?.message || err);
            }
          );
        } catch {}
      }

      return () => {
        try {
          unsubPrimary();
        } catch {}
        if (unsubLegacy) {
          try {
            unsubLegacy();
          } catch {}
        }
        if (unsubOther) {
          try {
            unsubOther();
          } catch {}
        }
      };
    } catch (err) {
      if (onError) onError(err);
      return () => {};
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
      const reqSnap = await getDoc(reqRef);
      if (reqSnap.exists()) {
        const existingData = reqSnap.data() as ServiceRequest;
        const normStatus = normalizeRequestStatus(existingData.status);
        if (normStatus === 'CANCELLED' && safeUpdates.status && safeUpdates.status !== 'CANCELLED') {
          throw new Error('Validation Error: Cannot change status of CANCELLED request');
        }
        if (
          normStatus === 'PROVIDER_SELECTED' ||
          normStatus === 'COMPLETED' ||
          normStatus === 'CANCELLED'
        ) {
          const nonStatusKeys = Object.keys(safeUpdates).filter(
            (k) => k !== 'status' && k !== 'updatedAt' && k !== 'selectedOfferId'
          );
          if (nonStatusKeys.length > 0) {
            throw new Error(
              `Validation Error: Cannot edit request details in status: ${existingData.status}`
            );
          }
        }
      }

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
    const updated = await this.updateRequest(requestId, updates);
    if (updated) {
      const norm = normalizeRequestStatus(status);
      if (norm === 'COMPLETED') {
        const firestore = this.ensureDb();
        let provUserId: string | undefined;
        if (updated.selectedOfferId) {
          getDoc(doc(firestore, 'offers', updated.selectedOfferId))
            .then((snap) => {
              if (snap.exists()) {
                provUserId = snap.data()?.providerUserId || snap.data()?.providerId;
              }
              notificationService.notifyWorkCompleted(updated, provUserId).catch(() => {});
            })
            .catch(() => {
              notificationService.notifyWorkCompleted(updated).catch(() => {});
            });
        } else {
          notificationService.notifyWorkCompleted(updated).catch(() => {});
        }
      } else if (norm === 'CANCELLED') {
        const firestore = this.ensureDb();
        if (updated.selectedOfferId) {
          getDoc(doc(firestore, 'offers', updated.selectedOfferId))
            .then((snap) => {
              if (snap.exists()) {
                const provUserId = snap.data()?.providerUserId || snap.data()?.providerId;
                notificationService.notifyRequestCancelled(updated, provUserId).catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    }
    return updated;
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
    const id = offerData.id || generateOfferId(offerData.requestId || 'REQ');

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
      // A provider's profile document id is their auth uid, and the rules only accept offers
      // under the caller's own profile, so the offer always points at the caller.
      providerId: providerUserId,
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
      // Trust badges are not self-assignable; they stay off until real verification exists
      iinVerified: false,
      hasCertificate: false,
    };

    try {
      const offerRef = doc(firestore, 'offers', id);
      await setDoc(offerRef, sanitizeForFirestore(newOffer));

      // Upgrade request status to OFFERS_RECEIVED if it was NEW or MATCHING
      if (newOffer.requestId) {
        try {
          const req = await this.getRequest(newOffer.requestId);
          if (req) {
            if (req.status === 'MATCHING' || req.status === 'NEW' || req.status === 'OPEN') {
              await this.updateRequest(req.id, { status: 'OFFERS_RECEIVED', lastOfferId: newOffer.id });
            }
            // Trigger customer notification
            notificationService.notifyNewOffer(req, newOffer).catch(() => {});
          }
        } catch (upgradeErr) {
          console.warn('[FirebaseRepository] Note upgrading request status on offer creation:', upgradeErr);
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
          offers = offers.filter(
            (o) =>
              !o.providerId ||
              o.providerId === filter.providerId ||
              o.providerUserId === filter.providerId
          );
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
   * Atomically accepts an offer for a request inside a single Firestore Transaction:
   * 1. Validates preconditions (request ownership, offer PENDING status, non-accepted status)
   * 2. Request: status = "PROVIDER_SELECTED", selectedOfferId = cleanOfferId
   * 3. Target offer: status = "ACCEPTED"
   * 4. Sibling offers for this request: status = "REJECTED"
   * 5. Conversation: deterministic conv_{requestId} created/updated
   * 6. Appointment: deterministic appointment_{requestId} created/updated
   */
  async acceptOffer(
    requestId: string,
    offerId: string,
    customDb?: Firestore
  ): Promise<{ request: ServiceRequest | null; offer: ProviderOffer | null }> {
    await ensureFirebaseAuth();
    const firestore = customDb || this.ensureDb();
    const cleanReqId = (requestId || '').trim();
    const cleanOfferId = (offerId || '').trim();

    if (!cleanReqId || !cleanOfferId) {
      throw new Error(`acceptOffer requires valid requestId and offerId. Received: '${requestId}', '${offerId}'`);
    }

    const currentUid = auth?.currentUser?.uid || getCurrentUserId();

    // 1. Pre-fetch sibling offer document references for cleanReqId
    let siblingItems: { id: string; ref: any }[] = [];
    try {
      const offersColl = collection(firestore, 'offers');
      const q = query(offersColl, where('requestId', '==', cleanReqId));
      const snap = await getDocs(q);
      siblingItems = snap.docs.map((d) => ({ id: d.id, ref: d.ref }));
    } catch (siblingFetchErr) {
      console.warn('[FirebaseRepository] Note fetching sibling offer refs before accept:', siblingFetchErr);
    }

    const reqRef = doc(firestore, 'requests', cleanReqId);
    const targetOfferRef = doc(firestore, 'offers', cleanOfferId);
    const convId = getConversationId(cleanReqId);
    const convRef = doc(firestore, 'conversations', convId);

    try {
      let resultReq: any = null;
      let resultOffer: any = null;

      await runTransaction(firestore, async (transaction) => {
        // READ PHASE
        const reqSnap = await transaction.get(reqRef);
        if (!reqSnap.exists()) {
          throw new Error(`Request not found: ${cleanReqId}`);
        }
        const reqData = reqSnap.data() as ServiceRequest;

        const offerSnap = await transaction.get(targetOfferRef);
        if (!offerSnap.exists()) {
          throw new Error(`Offer not found: ${cleanOfferId}`);
        }
        const offerData = offerSnap.data() as ProviderOffer;

        const siblingSnaps = await Promise.all(
          siblingItems.map(async (item) => {
            const snap = await transaction.get(item.ref);
            return { id: item.id, ref: item.ref, snap };
          })
        );

        // TRANSACTION VALIDATIONS
        // Check customer ownership
        if (reqData.customerId && currentUid && reqData.customerId !== currentUid) {
          throw new Error(`Unauthorized: Only the customer who created request ${cleanReqId} can accept offers`);
        }

        // Check request-offer relationship
        if (offerData.requestId !== cleanReqId) {
          throw new Error(`Validation Error: Offer ${cleanOfferId} does not belong to request ${cleanReqId}`);
        }

        // Idempotency check: If already accepted for this exact offer, complete idempotently
        if (reqData.selectedOfferId === cleanOfferId && offerData.status === 'ACCEPTED') {
          resultReq = { ...reqData, id: cleanReqId, selectedOfferId: cleanOfferId, status: 'PROVIDER_SELECTED' };
          resultOffer = { ...offerData, id: cleanOfferId, status: 'ACCEPTED' };
          return;
        }

        // Check if request is already accepted with a DIFFERENT offer or cancelled/completed
        const normStatus = normalizeRequestStatus(reqData.status);
        if (
          reqData.selectedOfferId ||
          normStatus === 'PROVIDER_SELECTED' ||
          normStatus === 'ACCEPTED' ||
          normStatus === 'IN_PROGRESS' ||
          normStatus === 'COMPLETED' ||
          normStatus === 'CANCELLED'
        ) {
          throw new Error('Validation Error: Request has already been accepted.');
        }

        // Check target offer status
        if (offerData.status !== 'PENDING') {
          throw new Error('Validation Error: Offer is no longer pending.');
        }

        // Check offer provider info
        if (!offerData.providerId && !offerData.providerUserId) {
          throw new Error('Validation Error: Target offer missing provider information.');
        }

        const now = new Date().toISOString();

        // WRITE PHASE
        // 1. Request: status = 'PROVIDER_SELECTED', selectedOfferId = cleanOfferId
        transaction.update(reqRef, sanitizeForFirestore({
          status: 'PROVIDER_SELECTED',
          selectedOfferId: cleanOfferId,
          updatedAt: now,
        }));

        // 2. Target Offer: status = 'ACCEPTED'
        transaction.update(targetOfferRef, sanitizeForFirestore({
          status: 'ACCEPTED',
          updatedAt: now,
        }));

        // 3. Sibling Offers: status = 'REJECTED'
        for (const sibling of siblingSnaps) {
          if (sibling.id !== cleanOfferId && sibling.snap.exists()) {
            const sibData = sibling.snap.data() as ProviderOffer;
            if (sibData.status === 'PENDING') {
              transaction.update(sibling.ref, sanitizeForFirestore({
                status: 'REJECTED',
                updatedAt: now,
              }));
            }
          }
        }

        resultReq = {
          ...reqData,
          id: cleanReqId,
          status: 'PROVIDER_SELECTED',
          selectedOfferId: cleanOfferId,
        };
        resultOffer = {
          ...offerData,
          id: cleanOfferId,
          status: 'ACCEPTED',
        };
      });

      // Post-transaction: initialize the conversation now that the request is committed as PROVIDER_SELECTED.
      // No appointment is created here: a time is proposed later by either side from the appointment
      // section, and an auto-created placeholder (scheduled "now", proposed on the provider's behalf by
      // the customer) was rejected by the security rules on every acceptance.
      if (resultReq && resultOffer) {
        try {
          const effectiveProviderId = resultOffer.providerId;
          const effectiveProviderUserId = resultOffer.providerUserId || resultOffer.providerId;
          const effectiveProviderName = resultOffer.providerName || 'Мастер';
          const now = new Date().toISOString();

          await setDoc(
            convRef,
            sanitizeForFirestore({
              id: convId,
              requestId: cleanReqId,
              customerId: resultReq.customerId,
              customerName: resultReq.customerName || 'Клиент',
              providerId: effectiveProviderId,
              providerUserId: effectiveProviderUserId,
              providerName: effectiveProviderName,
              status: 'ACTIVE',
              lastMessageText: '',
              lastMessageSenderId: '',
              lastMessageAt: now,
              unreadCountCustomer: 0,
              unreadCountProvider: 0,
              createdAt: now,
              updatedAt: now,
            }),
            { merge: true }
          );
        } catch (postInitErr) {
          console.warn('[FirebaseRepository] Note initializing conversation:', postInitErr);
        }
      }

      // Post-transaction Notification (outside transaction)
      if (resultReq && resultOffer) {
        notificationService.notifyOfferAccepted(resultReq, resultOffer).catch((err) => {
          console.warn('[FirebaseRepository] Non-blocking notification error after acceptOffer:', err);
        });
      }

      return { request: resultReq, offer: resultOffer };
    } catch (err: any) {
      if (
        err?.message?.startsWith('Validation Error:') ||
        err?.message?.startsWith('Unauthorized:') ||
        err?.message?.includes('Request has already been accepted') ||
        err?.message?.includes('no longer pending') ||
        err?.message?.includes('not found')
      ) {
        throw err;
      }
      console.error('[FirebaseRepository] RAW acceptOffer ERROR details:', err);
      handleFirestoreError(err, OperationType.UPDATE, `requests/${cleanReqId}/acceptOffer`);
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
      const offerSnap = await getDoc(offerRef);
      if (offerSnap.exists()) {
        const existingOffer = offerSnap.data() as ProviderOffer;
        const isPaymentStatusOnlyUpdate =
          updates.paymentStatus !== undefined &&
          Object.keys(updates).every((k) => k === 'paymentStatus' || k === 'updatedAt');

        if (!isPaymentStatusOnlyUpdate) {
          if (existingOffer.status === 'ACCEPTED' || existingOffer.status === 'REJECTED') {
            throw new Error(`Validation Error: Cannot update offer in status ${existingOffer.status}`);
          }
          if (existingOffer.requestId) {
            const reqSnap = await getDoc(doc(firestore, 'requests', existingOffer.requestId));
            if (reqSnap.exists()) {
              const parentReq = reqSnap.data() as ServiceRequest;
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
      }

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
      const reqCityId = normalizeCityId(request.cityId || request.city) || request.cityId;
      if (request.city && request.city.trim() !== '' && !reqCityId) {
        return [];
      }
      const reqCatId = normalizeCategoryId(request.categoryId || request.category);
      const candidates = await this.getProviders(reqCityId ? { cityId: reqCityId, categoryId: reqCatId } : undefined);
      return matchProviders(request, candidates);
    } catch {
      return [];
    }
  }

  // Helper: Seed initial simulated demo offers in Firestore for realistic testing
  // =================== Reviews ===================
  async createReview(reviewData: Partial<Review>): Promise<Review> {
    await ensureFirebaseAuth();
    const requestId = reviewData.requestId?.trim() || '';
    if (!requestId) {
      throw new Error('Validation Error: requestId is required');
    }

    const firestore = this.ensureDb();
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();

    // Check cross-document request state: job must be completed via real completion flow
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
    const offSnap = await getDoc(doc(firestore, 'offers', req.selectedOfferId.trim()));
    if (offSnap.exists()) {
      acceptedOffer = offSnap.data() as ProviderOffer;
    }
    if (!acceptedOffer) {
      try {
        const siblingOffers = await this.getOffers({ requestId });
        const accepted = siblingOffers.find((o) => o.id === req.selectedOfferId && o.requestId === requestId && o.status === 'ACCEPTED');
        if (accepted) {
          acceptedOffer = accepted;
        }
      } catch (e) {
        console.warn('[FirebaseRepository] Note resolving accepted offer for review:', e);
      }
    }

    if (!acceptedOffer || acceptedOffer.status !== 'ACCEPTED' || acceptedOffer.requestId !== requestId) {
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

  // =================== Conversations & In-App Chat ===================
  async getConversation(conversationId: string): Promise<Conversation | null> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanId = (conversationId || '').trim();
    if (!cleanId) return null;

    try {
      const convRef = doc(firestore, 'conversations', cleanId);
      const snap = await getDoc(convRef);
      if (!snap.exists()) return null;
      return snap.data() as Conversation;
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn('[FirebaseRepository] Note: Conversation get restricted by security rules.');
        return null;
      }
      handleFirestoreError(err, OperationType.GET, `conversations/${cleanId}`);
    }
  }

  async getOrCreateConversation(requestId: string): Promise<Conversation> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanReqId = (requestId || '').trim();
    if (!cleanReqId) {
      throw new Error('Validation Error: requestId is required to get or create conversation');
    }

    const convId = getConversationId(cleanReqId);
    const existing = await this.getConversation(convId);
    if (existing) {
      return existing;
    }

    // Verify parent request and ensure it is not OPEN
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

    // Fetch accepted offer
    const offerRef = doc(firestore, 'offers', req.selectedOfferId);
    const offerSnap = await getDoc(offerRef);
    if (!offerSnap.exists()) {
      throw new Error(`Selected offer not found: ${req.selectedOfferId}`);
    }
    const selectedOffer = offerSnap.data() as ProviderOffer;

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

    try {
      const convRef = doc(firestore, 'conversations', convId);
      await setDoc(convRef, sanitizeForFirestore(newConv), { merge: true });
      return newConv;
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn(
          `[FirebaseRepository] Note: Cloud Firestore conversation write on 'conversations/${convId}' restricted by security rules. Falling back gracefully to LocalRepository.`
        );
        throw new Error(`FirestorePermissionDenied: ${msg}`);
      }
      handleFirestoreError(err, OperationType.WRITE, `conversations/${convId}`);
    }
  }

  async getMessages(conversationId: string, limitCount = 30): Promise<ChatMessage[]> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanId = (conversationId || '').trim();
    if (!cleanId) return [];

    try {
      const msgsCol = collection(firestore, 'conversations', cleanId, 'messages');
      const q = query(msgsCol, orderBy('createdAt', 'desc'), limit(limitCount));
      const snap = await getDocs(q);

      const msgs: ChatMessage[] = [];
      snap.forEach((d) => {
        msgs.push(d.data() as ChatMessage);
      });

      // Sort newest fetched messages in chronological order for chat timeline
      msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return msgs;
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn('[FirebaseRepository] Note: Messages list query restricted by security rules.');
        return [];
      }
      handleFirestoreError(err, OperationType.LIST, `conversations/${cleanId}/messages`);
    }
  }

  async sendMessage(conversationId: string, messageData: Partial<ChatMessage>): Promise<ChatMessage> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanId = (conversationId || '').trim();
    const text = (messageData.text || '').trim();
    const hasAttachments = Boolean(messageData.attachments && messageData.attachments.length > 0);

    // Either text or attachment must be present
    if (!text && !hasAttachments) {
      throw new Error('Validation Error: Message text cannot be empty without an attachment');
    }
    if (text.length > 2000) {
      throw new Error('Validation Error: Message text exceeds 2000 characters limit');
    }

    const conv = await this.getConversation(cleanId);
    if (!conv) {
      throw new Error(`Conversation not found: ${cleanId}`);
    }

    // Verify parent request status
    const req = await this.getRequest(conv.requestId);
    if (req && normalizeRequestStatus(req.status) === 'CANCELLED') {
      throw new Error('Cannot send message: Request is cancelled');
    }

    const authUid = auth?.currentUser?.uid;
    if (!authUid) {
      throw new Error('Unauthorized: You must be authenticated to send messages');
    }

    // Authenticated participant verification:
    // Do NOT blindly trust client-supplied senderId. Verify auth.uid against conversation participants.
    const isCustomer = authUid === conv.customerId;
    const isProvider = authUid === conv.providerUserId || authUid === conv.providerId;

    if (!isCustomer && !isProvider) {
      throw new Error('Unauthorized: You are not a participant in this conversation');
    }

    const senderRole: 'customer' | 'provider' =
      messageData.senderRole === 'provider' && isProvider
        ? 'provider'
        : messageData.senderRole === 'customer' && isCustomer
        ? 'customer'
        : isCustomer
        ? 'customer'
        : 'provider';
    const now = new Date().toISOString();
    const messageId = messageData.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const resolvedType = messageData.type || (hasAttachments ? messageData.attachments![0].type : 'text');

    const newMsg: ChatMessage = {
      id: messageId,
      conversationId: cleanId,
      requestId: conv.requestId,
      senderId: authUid, // Enforce real authenticated participant UID
      senderRole,
      type: resolvedType,
      text,
      ...(hasAttachments ? { attachments: messageData.attachments } : {}),
      isRead: false,
      readAt: null,
      createdAt: now,
    };

    const summaryText = text || (newMsg.attachments?.[0]?.type === 'image' ? '📷 Фото' : '📎 Файл');

    try {
      const batch = writeBatch(firestore);
      const msgRef = doc(firestore, 'conversations', cleanId, 'messages', messageId);
      const convRef = doc(firestore, 'conversations', cleanId);

      batch.set(msgRef, sanitizeForFirestore(newMsg));
      batch.update(
        convRef,
        sanitizeForFirestore({
          lastMessageText: summaryText,
          lastMessageSenderId: authUid,
          lastMessageAt: now,
          updatedAt: now,
          ...(isCustomer
            ? { unreadCountProvider: (conv.unreadCountProvider || 0) + 1 }
            : { unreadCountCustomer: (conv.unreadCountCustomer || 0) + 1 }),
        })
      );

      await batch.commit();

      // Non-blocking notification to peer (chat delivery never blocked by notification errors)
      notificationService.notifyNewMessage(conv, newMsg).catch(() => {});

      return newMsg;
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || String(err);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        console.warn(
          `[FirebaseRepository] Note: Cloud Firestore message write on 'conversations/${cleanId}/messages/${messageId}' restricted by security rules. Falling back gracefully to LocalRepository.`
        );
        throw new Error(`FirestorePermissionDenied: ${msg}`);
      }
      handleFirestoreError(err, OperationType.WRITE, `conversations/${cleanId}/messages/${messageId}`);
    }
  }

  async uploadChatAttachment(
    conversationId: string,
    file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string }
  ): Promise<ChatAttachment> {
    await ensureFirebaseAuth();
    const cleanId = (conversationId || '').trim();
    if (!cleanId) {
      throw new Error('Validation Error: conversationId is required');
    }

    const conv = await this.getConversation(cleanId);
    if (!conv) {
      throw new Error(`Conversation not found: ${cleanId}`);
    }

    const authUid = auth?.currentUser?.uid;
    if (!authUid) {
      throw new Error('Unauthorized: You must be authenticated to upload files');
    }
    const isCustomer = authUid === conv.customerId;
    const isProvider = authUid === conv.providerUserId || authUid === conv.providerId;
    if (!isCustomer && !isProvider) {
      throw new Error('Unauthorized: You are not a participant in this conversation');
    }

    const validation = validateChatAttachment(file);
    if (!validation.isValid) {
      throw new Error(`Validation Error: ${validation.errorKey}`);
    }

    const sanitizedName = sanitizeFileName(file.name);
    const attachmentId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const messageId = `msg_pending_${Date.now()}`;
    const storagePath = `chat/${cleanId}/${messageId}/${attachmentId}_${sanitizedName}`;

    if (!storage) {
      throw new Error('Firebase Storage is not configured or unavailable');
    }

    // Determine binary payload
    let blobPayload: Blob | Uint8Array | ArrayBuffer;
    if (file.data instanceof Blob) {
      blobPayload = file.data;
    } else if (file.data instanceof Uint8Array || file.data instanceof ArrayBuffer) {
      blobPayload = file.data;
    } else if (typeof file.data === 'string' && file.data.startsWith('data:')) {
      // Data URL to Blob
      const parts = file.data.split(',');
      const byteString = atob(parts[1] || '');
      const mime = parts[0].split(':')[1]?.split(';')[0] || file.type;
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      blobPayload = new Blob([ab], { type: mime });
    } else {
      throw new Error('Attachment payload data is missing or invalid');
    }

    const fileRef = storageRef(storage, storagePath);
    const metadata = {
      contentType: file.type || (validation.type === 'image' ? 'image/jpeg' : 'application/octet-stream'),
      customMetadata: {
        conversationId: cleanId,
        uploadedBy: authUid,
        fileName: sanitizedName,
      },
    };

    try {
      const uploadResult = await uploadBytes(fileRef, blobPayload, metadata);
      const downloadUrl = await getDownloadURL(uploadResult.ref);

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
    } catch (err: any) {
      console.error('[FirebaseRepository] uploadChatAttachment failed:', err);
      throw new Error(`Failed to upload attachment: ${err?.message || err}`);
    }
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
    // 1. Upload to storage first (fails fast without creating orphaned Firestore document)
    const attachment = await this.uploadChatAttachment(conversationId, messageData.file);

    // 2. Now record Firestore document referencing the uploaded attachment
    return await this.sendMessage(conversationId, {
      text: (messageData.text || '').trim(),
      senderId: messageData.senderId,
      senderRole: messageData.senderRole,
      type: attachment.type,
      attachments: [attachment],
    });
  }

  async markMessagesAsRead(conversationId: string): Promise<void> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanId = (conversationId || '').trim();
    if (!cleanId) return;

    try {
      const conv = await this.getConversation(cleanId);
      if (!conv) return;

      const currentUid = auth?.currentUser?.uid || getCurrentUserId();
      const updates: Record<string, any> = {};
      if (currentUid === conv.customerId && conv.unreadCountCustomer > 0) {
        updates.unreadCountCustomer = 0;
      } else if (
        (currentUid === conv.providerUserId || currentUid === conv.providerId) &&
        conv.unreadCountProvider > 0
      ) {
        updates.unreadCountProvider = 0;
      }

      if (Object.keys(updates).length > 0) {
        const convRef = doc(firestore, 'conversations', cleanId);
        await updateDoc(convRef, updates);
      }
    } catch (err: any) {
      console.warn('[FirebaseRepository] markMessagesAsRead note:', err?.message || err);
    }
  }

  subscribeToMessages(
    conversationId: string,
    onUpdate: (messages: ChatMessage[]) => void,
    onError?: (error: any) => void
  ): () => void {
    if (!isFirebaseConfigured() || !db) {
      return () => {};
    }
    const cleanId = (conversationId || '').trim();
    if (!cleanId) {
      return () => {};
    }

    try {
      const msgsCol = collection(db, 'conversations', cleanId, 'messages');
      const q = query(msgsCol, orderBy('createdAt', 'asc'), limit(50));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const msgs: ChatMessage[] = [];
          snapshot.forEach((d) => {
            msgs.push(d.data() as ChatMessage);
          });
          onUpdate(msgs);
        },
        (err) => {
          const isPermission =
            err?.code === 'permission-denied' ||
            String(err?.message || err).includes('permission') ||
            String(err?.message || err).includes('PERMISSION_DENIED');
          if (isPermission) {
            console.warn('[FirebaseRepository] Note: Cloud Firestore realtime listener restricted by rules, falling back gracefully:', err?.message || err);
          } else {
            console.warn('[FirebaseRepository] subscribeToMessages realtime snapshot error note:', err?.message || err);
          }
          if (onError) {
            onError(err);
          }
        }
      );

      return () => {
        try {
          unsubscribe();
        } catch {}
      };
    } catch (err) {
      console.warn('[FirebaseRepository] subscribeToMessages initialization error note:', err);
      if (onError) {
        onError(err);
      }
      return () => {};
    }
  }

  // =================== In-App Notifications ===================

  async createNotification(notificationData: AppNotification): Promise<AppNotification> {
    if (!db) throw new Error('Firestore is not initialized');
    await ensureFirebaseAuth();

    const cleanId = (notificationData.id || '').trim();
    if (!cleanId) {
      throw new Error('Validation Error: notification id is required');
    }
    const cleanRecipient = (notificationData.recipientUserId || '').trim();
    if (!cleanRecipient) {
      throw new Error('Validation Error: notification recipientUserId is required');
    }

    const payload: AppNotification = {
      id: cleanId,
      recipientUserId: cleanRecipient,
      recipientRole: notificationData.recipientRole,
      type: notificationData.type,
      title: notificationData.title,
      body: notificationData.body,
      targetScreen: notificationData.targetScreen,
      isRead: false,
      readAt: null,
      createdAt: notificationData.createdAt || new Date().toISOString(),
    };

    if (notificationData.requestId) payload.requestId = notificationData.requestId;
    if (notificationData.offerId) payload.offerId = notificationData.offerId;
    if (notificationData.conversationId) payload.conversationId = notificationData.conversationId;
    if (notificationData.providerId) payload.providerId = notificationData.providerId;

    try {
      const notifRef = doc(db, 'notifications', cleanId);
      await setDoc(notifRef, payload, { merge: true });
      return payload;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `notifications/${cleanId}`);
      throw error;
    }
  }

  async getNotifications(userId: string, limitCount = 50): Promise<AppNotification[]> {
    if (!db) return [];
    const authUid = await ensureFirebaseAuth();
    const cleanUid = (authUid || auth?.currentUser?.uid || userId || '').trim();
    if (!cleanUid) return [];

    try {
      const notifsCol = collection(db, 'notifications');
      const q = query(notifsCol, where('recipientUserId', '==', cleanUid));
      const snapshot = await getDocs(q);

      const items: AppNotification[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as AppNotification);
      });

      // Sort in memory to guarantee ordering without requiring a composite index on Spark
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return items.slice(0, limitCount);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'notifications');
      return [];
    }
  }

  async markNotificationAsRead(notificationId: string): Promise<void> {
    if (!db) return;
    await ensureFirebaseAuth();

    const cleanId = (notificationId || '').trim();
    if (!cleanId) return;

    try {
      const notifRef = doc(db, 'notifications', cleanId);
      await updateDoc(notifRef, {
        isRead: true,
        readAt: new Date().toISOString(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `notifications/${cleanId}`);
    }
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    if (!db) return;
    const authUid = await ensureFirebaseAuth();
    const cleanUid = (authUid || auth?.currentUser?.uid || userId || '').trim();
    if (!cleanUid) return;

    try {
      const notifsCol = collection(db, 'notifications');
      const q = query(notifsCol, where('recipientUserId', '==', cleanUid));
      const snapshot = await getDocs(q);

      const batch = writeBatch(db);
      let count = 0;
      const now = new Date().toISOString();

      snapshot.forEach((d) => {
        const data = d.data() as AppNotification;
        if (!data.isRead) {
          batch.update(d.ref, { isRead: true, readAt: now });
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'notifications/markAllAsRead');
    }
  }

  subscribeToNotifications(
    userId: string,
    onUpdate: (notifications: AppNotification[]) => void,
    onError?: (error: any) => void
  ): () => void {
    if (!db) {
      return () => {};
    }

    const cleanUid = (auth?.currentUser?.uid || userId || '').trim();
    if (!cleanUid) {
      return () => {};
    }

    try {
      const notifsCol = collection(db, 'notifications');
      const q = query(notifsCol, where('recipientUserId', '==', cleanUid));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const items: AppNotification[] = [];
          snapshot.forEach((d) => {
            items.push(d.data() as AppNotification);
          });
          // Sort descending in memory
          items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          onUpdate(items);
        },
        (err) => {
          console.warn('[FirebaseRepository] subscribeToNotifications snapshot note:', err?.message || err);
          if (onError) {
            onError(err);
          }
        }
      );

      return () => {
        try {
          unsubscribe();
        } catch {}
      };
    } catch (err) {
      console.warn('[FirebaseRepository] subscribeToNotifications init note:', err);
      if (onError) {
        onError(err);
      }
      return () => {};
    }
  }

  // =================== Appointments ===================
  async getAppointment(requestId: string): Promise<Appointment | null> {
    if (!db) return null;
    await ensureFirebaseAuth();
    const cleanId = (requestId || '').trim();
    if (!cleanId) return null;
    const docId = cleanId.startsWith('appointment_') ? cleanId : getAppointmentId(cleanId);
    try {
      const snap = await getDoc(doc(db, 'appointments', docId));
      if (!snap.exists()) return null;
      return snap.data() as Appointment;
    } catch (error: any) {
      const code = error?.code || '';
      const msg = error?.message || String(error);
      if (
        code === 'permission-denied' ||
        msg.includes('permission') ||
        msg.includes('Missing or insufficient permissions')
      ) {
        return null;
      }
      handleFirestoreError(error, OperationType.GET, `appointments/${docId}`);
      return null;
    }
  }

  async createAppointment(
    appointmentData: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Appointment> {
    if (!db) throw new Error('Firestore not initialized');
    await ensureFirebaseAuth();
    const docId = getAppointmentId(appointmentData.requestId);
    const now = new Date().toISOString();
    const newAppt: Appointment = {
      ...appointmentData,
      id: docId,
      status: appointmentData.status || 'PROPOSED',
      createdAt: now,
      updatedAt: now,
    };
    try {
      const cleanData = sanitizeForFirestore(newAppt);
      await setDoc(doc(db, 'appointments', docId), cleanData);
      return newAppt;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `appointments/${docId}`);
      throw error;
    }
  }

  async updateAppointment(appointmentId: string, updates: Partial<Appointment>): Promise<Appointment> {
    if (!db) throw new Error('Firestore not initialized');
    await ensureFirebaseAuth();
    const docId = appointmentId.startsWith('appointment_') ? appointmentId : getAppointmentId(appointmentId);
    try {
      const existingSnap = await getDoc(doc(db, 'appointments', docId));
      if (!existingSnap.exists()) {
        throw new Error(`Appointment ${docId} does not exist`);
      }
      const existing = existingSnap.data() as Appointment;
      const updated: Appointment = {
        ...existing,
        ...updates,
        id: existing.id,
        requestId: existing.requestId,
        customerId: existing.customerId,
        providerId: existing.providerId,
        providerUserId: existing.providerUserId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      const cleanData = sanitizeForFirestore(updated);
      await setDoc(doc(db, 'appointments', docId), cleanData, { merge: true });
      return updated;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `appointments/${docId}`);
      throw error;
    }
  }

  async cancelAppointment(
    appointmentId: string,
    cancelledByRole: 'customer' | 'provider',
    reason?: string
  ): Promise<Appointment> {
    const existing = await this.getAppointment(appointmentId);
    const note = reason ? (existing?.note ? `${existing.note} | ${reason}` : reason) : existing?.note;
    return await this.updateAppointment(appointmentId, {
      status: 'CANCELLED',
      ...(note !== undefined ? { note } : {}),
    });
  }

  async confirmAppointment(
    appointmentId: string,
    confirmedByRole: 'customer' | 'provider'
  ): Promise<Appointment> {
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
    return await this.updateAppointment(appointmentId, {
      status: 'RESCHEDULED',
      scheduledAt,
      proposedBy,
      ...(note !== undefined ? { note } : {}),
    });
  }

  async completeAppointment(appointmentId: string): Promise<Appointment> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanApptId = (appointmentId || '').trim();
    if (!cleanApptId) {
      throw new Error('Validation Error: appointmentId is required');
    }
    const docId = cleanApptId.startsWith('appointment_') ? cleanApptId : getAppointmentId(cleanApptId);

    return await runTransaction(firestore, async (transaction) => {
      const apptRef = doc(firestore, 'appointments', docId);
      const apptSnap = await transaction.get(apptRef);
      if (!apptSnap.exists()) {
        throw new Error(`Appointment not found: ${docId}`);
      }

      const existingAppt = apptSnap.data() as Appointment;
      if (existingAppt.status !== 'CONFIRMED' && existingAppt.status !== 'COMPLETED') {
        throw new Error(`Cannot complete appointment that is in status: ${existingAppt.status}`);
      }

      const now = new Date().toISOString();
      const apptUpdates: Partial<Appointment> = {
        status: 'COMPLETED',
        workStatus: 'WORK_COMPLETED',
        workStatusUpdatedAt: now,
        updatedAt: now,
      };

      const reqRef = doc(firestore, 'requests', existingAppt.requestId);
      const reqSnap = await transaction.get(reqRef);

      transaction.update(apptRef, sanitizeForFirestore(apptUpdates));

      if (reqSnap.exists()) {
        const reqData = reqSnap.data() as ServiceRequest;
        if (reqData.status !== 'COMPLETED') {
          transaction.update(reqRef, {
            status: 'COMPLETED',
            updatedAt: now,
          });
        }
      }

      return {
        ...existingAppt,
        ...apptUpdates,
      } as Appointment;
    });
  }

  async confirmCustomerCompletion(
    requestId: string,
    appointmentId?: string
  ): Promise<{ request: ServiceRequest; appointment?: Appointment }> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanReqId = (requestId || '').trim();
    if (!cleanReqId) {
      throw new Error('Validation Error: requestId is required');
    }
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    if (!currentUid) {
      throw new Error('Unauthorized: Authentication required');
    }

    return await runTransaction(firestore, async (transaction) => {
      const reqRef = doc(firestore, 'requests', cleanReqId);
      const reqSnap = await transaction.get(reqRef);
      if (!reqSnap.exists()) {
        throw new Error(`Request not found: ${cleanReqId}`);
      }
      const existingReq = reqSnap.data() as ServiceRequest;

      // Verify customer authorization
      if (existingReq.customerId !== currentUid) {
        throw new Error('Unauthorized: Only the customer who created the request can confirm completion');
      }

      // Read appointment if specified or deterministic appointment ID
      const cleanApptId = (appointmentId || '').trim();
      const apptDocId = cleanApptId
        ? (cleanApptId.startsWith('appointment_') ? cleanApptId : getAppointmentId(cleanApptId))
        : getAppointmentId(cleanReqId);

      const apptRef = doc(firestore, 'appointments', apptDocId);
      const apptSnap = await transaction.get(apptRef);

      let updatedAppt: Appointment | undefined = undefined;

      if (apptSnap.exists()) {
        const existingAppt = apptSnap.data() as Appointment;

        // Strict verification: Appointment must belong to BOTH this customer AND this request
        const isMatchingOwnerAndRequest =
          existingAppt.customerId === currentUid && existingAppt.requestId === cleanReqId;

        if (cleanApptId && !isMatchingOwnerAndRequest) {
          throw new Error('Unauthorized: Appointment does not belong to this request or customer');
        }

        if (isMatchingOwnerAndRequest) {
          // Appointment can ONLY transition to COMPLETED if it was in CONFIRMED or COMPLETED status.
          // Unconfirmed appointments (PROPOSED, RESCHEDULED) cannot be marked COMPLETED per security rules.
          if (existingAppt.status === 'CONFIRMED' || existingAppt.status === 'COMPLETED') {
            const now = new Date().toISOString();
            const apptUpdates: Partial<Appointment> = {
              status: 'COMPLETED',
              workStatus: 'WORK_COMPLETED',
              workStatusUpdatedAt: now,
              updatedAt: now,
            };
            transaction.update(apptRef, sanitizeForFirestore(apptUpdates));
            updatedAppt = {
              ...existingAppt,
              ...apptUpdates,
            };
          } else {
            // Unconfirmed proposal/reschedule remains unconfirmed - not falsely marked COMPLETED
            updatedAppt = existingAppt;
          }
        }
      } else if (cleanApptId && cleanApptId !== getAppointmentId(cleanReqId)) {
        throw new Error(`Appointment not found: ${cleanApptId}`);
      }

      const now = new Date().toISOString();
      if (existingReq.status !== 'COMPLETED') {
        transaction.update(reqRef, {
          status: 'COMPLETED',
          updatedAt: now,
        });
      }

      return {
        request: {
          ...existingReq,
          status: 'COMPLETED',
          updatedAt: now,
        },
        appointment: updatedAppt,
      };
    });
  }

  async updateWorkStatus(
    appointmentId: string,
    workStatus: WorkStatus,
    providerUserId: string
  ): Promise<Appointment> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanApptId = (appointmentId || '').trim();
    if (!cleanApptId) {
      throw new Error('Validation Error: appointmentId is required');
    }
    const docId = cleanApptId.startsWith('appointment_') ? cleanApptId : getAppointmentId(cleanApptId);
    const authUid = auth?.currentUser?.uid || getCurrentUserId();

    return await runTransaction(firestore, async (transaction) => {
      const apptRef = doc(firestore, 'appointments', docId);
      const apptSnap = await transaction.get(apptRef);
      if (!apptSnap.exists()) {
        throw new Error(`Appointment not found: ${docId}`);
      }

      const existingAppt = apptSnap.data() as Appointment;

      if (existingAppt.status === 'CANCELLED') {
        throw new Error('Validation Error: Cannot update work status on a CANCELLED appointment');
      }

      // Authorization check: Only assigned provider can update work status
      const cleanProviderUid = (providerUserId || '').trim();
      const assignedProviderUserId = (existingAppt.providerUserId || '').trim();
      const assignedProviderId = (existingAppt.providerId || '').trim();

      const isAssignedProvider =
        (cleanProviderUid && (cleanProviderUid === assignedProviderUserId || cleanProviderUid === assignedProviderId)) ||
        (authUid && (authUid === assignedProviderUserId || authUid === assignedProviderId));

      if (!isAssignedProvider) {
        throw new Error(`Unauthorized: Only assigned provider can update work status`);
      }

      // Transition validation
      if (!isValidWorkStatusTransition(existingAppt.workStatus, workStatus)) {
        throw new Error(
          `Invalid work status transition from ${existingAppt.workStatus || 'NOT_STARTED'} to ${workStatus}`
        );
      }

      const now = new Date().toISOString();
      const apptUpdates: Partial<Appointment> = {
        workStatus,
        workStatusUpdatedAt: now,
        updatedAt: now,
      };

      if (workStatus === 'WORK_COMPLETED' && (existingAppt.status === 'CONFIRMED' || existingAppt.status === 'PROPOSED' || existingAppt.status === 'RESCHEDULED')) {
        apptUpdates.status = 'COMPLETED';
      }

      const reqRef = doc(firestore, 'requests', existingAppt.requestId);
      const reqSnap = await transaction.get(reqRef);

      transaction.update(apptRef, sanitizeForFirestore(apptUpdates));

      if (reqSnap.exists()) {
        const reqData = reqSnap.data() as ServiceRequest;
        if (workStatus === 'WORK_COMPLETED') {
          if (reqData.status !== 'COMPLETED') {
            transaction.update(reqRef, {
              status: 'COMPLETED',
              updatedAt: now,
            });
          }
        } else if (workStatus === 'WORK_STARTED' || workStatus === 'PROVIDER_ARRIVED' || workStatus === 'PROVIDER_ON_THE_WAY') {
          if (reqData.status === 'PROVIDER_SELECTED' || reqData.status === 'ACCEPTED') {
            transaction.update(reqRef, {
              status: 'IN_PROGRESS',
              updatedAt: now,
            });
          }
        }
      }

      return {
        ...existingAppt,
        ...apptUpdates,
      } as Appointment;
    });
  }

  subscribeToAppointment(
    requestId: string,
    onUpdate: (appointment: Appointment | null) => void,
    onError?: (error: any) => void
  ): () => void {
    if (!db) {
      return () => {};
    }
    const cleanId = (requestId || '').trim();
    if (!cleanId) {
      return () => {};
    }
    const docId = cleanId.startsWith('appointment_') ? cleanId : getAppointmentId(cleanId);
    try {
      const unsub = onSnapshot(
        doc(db, 'appointments', docId),
        (snap) => {
          if (snap.exists()) {
            onUpdate(snap.data() as Appointment);
          } else {
            onUpdate(null);
          }
        },
        (err) => {
          console.warn('[FirebaseRepository] subscribeToAppointment snapshot error:', err?.message || err);
          if (onError) onError(err);
        }
      );
      return () => {
        try {
          unsub();
        } catch {}
      };
    } catch (err) {
      console.warn('[FirebaseRepository] subscribeToAppointment init error:', err);
      if (onError) onError(err);
      return () => {};
    }
  }
}

export const firebaseRepository = new FirebaseRepository();
