import { cleanCatalogIds } from '../data/serviceCatalog';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  getAggregateFromServer,
  average,
  count,
  setDoc,
  updateDoc,
  writeBatch,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  increment,
  type Firestore,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import {
  getMetadata,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';
import {
  Appointment,
  AppNotification,
  ChatAttachment,
  ChatMessage,
  Conversation,
  getAppointmentId,
  getConversationId,
  offerExtras,
  isRequestExpired,
  isRequestFull,
  REQUEST_OPEN_MS,
  Provider,
  ProviderOffer,
  RequestAttachment,
  RequestLocation,
  RequestStatus,
  RatingSummary,
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
import { notificationService } from './notificationService';
import {
  validateOfferData,
  validateProviderData,
  validateRequestData,
  validateReviewData,
} from './validation';
import { getCurrentUserId } from './localRepository';
import { generateRequestId, providerOfferId } from './ids';
import { CANONICAL_CITIES, CANONICAL_CATEGORIES, normalizeCategoryId, normalizeCityId, isCategoryMatch } from './taxonomy';
import { cleanImageForUpload } from './imageClean';
import { isPortfolioSlot } from './portfolio';

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
      // Only plain objects are cleaned recursively; Firestore values (increment(), timestamps) pass through
      if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        clean[key] = sanitizeForFirestore(value);
      } else if (Array.isArray(value)) {
        clean[key] = value
          .filter((v) => v !== undefined)
          .map((v) => (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? sanitizeForFirestore(v) : v));
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

// Statuses a provider still needs to see. Completed and cancelled requests (the bulk of the data
// over time) are left out of provider queries so the provider screen doesn't download all history.
/** Requests providers of a city can see (firestore.rules isOpenStatus); jobs a provider was chosen for are read one by one. */
const PROVIDER_VISIBLE_STATUSES = ['OPEN', 'NEW', 'MATCHING', 'OFFERS_RECEIVED'];
/** Upper bound for one customer's request list (one read per document) */
const CUSTOMER_REQUESTS_LIMIT = 200;
/** Lists read newest first with a cap, so reads don't grow with the whole history */
const PROVIDER_FEED_LIMIT = 300;
const PROVIDER_OFFERS_LIMIT = 300;
const PROVIDER_REVIEWS_LIMIT = 100;
const NOTIFICATIONS_LIMIT = 50;

/**
 * Reads the newest documents first, with a cap (firestore.indexes.json has the indexes). Until an
 * index exists (failed-precondition, e.g. while indexes build right after a release) the plain
 * query is used, so the screen still works.
 */
async function getDocsNewestFirst(newest: Query, plain: Query): Promise<QuerySnapshot> {
  try {
    return await getDocs(newest);
  } catch (err: any) {
    if (err?.code === 'failed-precondition') return getDocs(plain);
    throw err;
  }
}

function onSnapshotNewestFirst(
  newest: Query,
  plain: Query,
  next: (snap: QuerySnapshot) => void,
  error: (err: any) => void
): () => void {
  let unsub = onSnapshot(newest, next, (err: any) => {
    if (err?.code === 'failed-precondition') unsub = onSnapshot(plain, next, error);
    else error(err);
  });
  return () => unsub();
}

/** Request fields written when the selected provider reports the job finished. */
function providerDoneUpdate(req: ServiceRequest, now: string): Partial<ServiceRequest> & { updatedAt: string } {
  return {
    providerDoneAt: now,
    updatedAt: now,
    ...(req.status === 'PROVIDER_SELECTED' || req.status === 'ACCEPTED' ? { status: 'IN_PROGRESS' as const } : {}),
  };
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
    // Catalogue services picked by the provider; the first group is the main category
    const catalog = cleanCatalogIds(providerData.serviceIds);
    const categoryId = catalog.categoryIds[0] || normalizeCategoryId(providerData.categoryId || category);

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
      ...(catalog.serviceIds.length ? { serviceIds: catalog.serviceIds, categoryIds: catalog.categoryIds } : {}),
      services: providerData.services?.trim() || '',
      priceRange: providerData.priceRange?.trim() || '',
      workingHours: providerData.workingHours?.trim() || '09:00 - 20:00',
      description: providerData.description?.trim() || '',
      ...(typeof providerData.experienceYears === 'number' && providerData.experienceYears >= 0
        ? { experienceYears: providerData.experienceYears }
        : {}),
      availability: providerData.availability || providerData.workingHours || '09:00 - 20:00',
      ...(providerData.tradeLicense ? { tradeLicense: providerData.tradeLicense } : {}),
      ...(typeof providerData.paused === 'boolean' ? { paused: providerData.paused } : {}),
      ...(Array.isArray(providerData.portfolio)
        ? { portfolio: providerData.portfolio.filter((x, i, all) => isPortfolioSlot(x) && all.indexOf(x) === i).slice(0, 8) }
        : {}),
      updatedAt: new Date().toISOString(),
    } as Provider;

    try {
      const provRef = doc(firestore, 'providers', id);
      const existingSnap = await getDoc(provRef);
      if (existingSnap.exists()) {
        // Editing: badges set by the operator and the original creation date stay as they are
        await setDoc(provRef, sanitizeForFirestore(newProvider), { merge: true });
        const prev = existingSnap.data() as Provider;
        return { ...prev, ...newProvider };
      }
      // Trust badges are not self-assignable; they stay off until the operator verifies the provider
      const created: Provider = {
        ...newProvider,
        verified: false,
        iinVerified: false,
        hasCertificate: false,
        createdAt: new Date().toISOString(),
      };
      await setDoc(provRef, sanitizeForFirestore(created));
      return created;
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
      return null;
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

    // Real data only: the made-up demo providers belong to the offline demo mode
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
      ...(requestData.serviceId ? { serviceId: requestData.serviceId } : {}),
      service,
      date: requestData.date?.trim() || 'Бүгін',
      budget: requestData.budget?.trim() || 'Келісімді',
      urgency: requestData.urgency || 'normal',
      status: firestoreStatus,
      createdAt: requestData.createdAt || new Date().toISOString(),
      expiresAtMs: Date.now() + REQUEST_OPEN_MS,
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
      // The same submission sent again with the same id (the answer was lost, or the customer
      // tapped "send" again after an error): the request already stored is the result, no copy
      const already = await getDoc(reqRef);
      if (already.exists()) {
        const stored = already.data() as ServiceRequest;
        if (stored.customerId !== customerId) throw new Error(`Validation Error: request id ${id} is taken`);
        return await this.withContacts(firestore, id, stored);
      }

      // Privacy: the name, phone number and exact location live in the restricted requestContacts
      // document (the customer and the chosen master); the request itself carries none of them
      let customerPhone: string | undefined = undefined;
      // The phone-verified number of the signed-in customer, so the chosen provider can call them
      const verifiedPhone = auth?.currentUser?.phoneNumber || '';
      if (verifiedPhone) {
        customerPhone = verifiedPhone;
      } else if (requestData.customerPhone && requestData.customerPhone.trim()) {
        customerPhone = requestData.customerPhone.trim();
      }
      const realName = newRequest.customerName !== 'Клиент' ? newRequest.customerName.slice(0, 100) : '';
      const { customerName: _shownName, ...sharedRequest } = newRequest;

      // Request and contacts in one write: either both are stored or neither (firestore.rules
      // checks the contacts against the request written in the same batch)
      const batch = writeBatch(firestore);
      batch.set(reqRef, sanitizeForFirestore(sharedRequest));
      if (customerPhone || newRequest.location || realName) {
        batch.set(
          doc(firestore, 'requestContacts', id),
          sanitizeForFirestore({
            requestId: id,
            customerId,
            ...(realName ? { customerName: realName } : {}),
            ...(customerPhone ? { customerPhone } : {}),
            ...(newRequest.location && preciseLocation ? { location: preciseLocation } : {}),
            createdAt: new Date().toISOString(),
          })
        );
      }
      await batch.commit();

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
    customerId?: string,
    slot?: number
  ): Promise<RequestAttachment> {
    await ensureFirebaseAuth();
    const cleanId = (requestId || '').trim();
    if (!cleanId) {
      throw new Error('Validation Error: requestId is required');
    }

    const authUid = auth?.currentUser?.uid;
    const effectiveCustId = customerId || authUid || getCurrentUserId();

    // Files are attached to a request that already exists and belongs to the caller (storage.rules
    // enforces the same), so the request is created first and the files are added afterwards.
    const existing = await this.getRequest(cleanId);
    if (!existing) {
      throw new Error(`Validation Error: request ${cleanId} must be created before attaching files`);
    }
    if (authUid && existing.customerId !== authUid) {
      throw new Error(`Unauthorized: Only the creator of request ${cleanId} can upload attachments`);
    }

    const validation = validateRequestAttachment(file);
    if (!validation.isValid) {
      throw new Error(`Validation Error: ${validation.errorKey}`);
    }

    const sanitizedName = sanitizeFileName(file.name);

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
    if (validation.type === 'image' && blobPayload instanceof Blob) {
      blobPayload = await cleanImageForUpload(blobPayload);
    }

    const metadata = {
      contentType: (blobPayload instanceof Blob && blobPayload.type) || file.type || (validation.type === 'image' ? 'image/jpeg' : validation.type === 'video' ? 'video/mp4' : 'audio/mpeg'),
      customMetadata: {
        requestId: cleanId,
        uploadedBy: authUid || effectiveCustId,
        fileName: sanitizedName,
        // With the name, recognises this file in its slot when the same submission is sent again
        originalSize: String(file.size),
      },
    };

    try {
      // A request holds at most 15 files, stored under fixed names att0 … att14 (storage.rules).
      // Start at the next free slot and move on if a slot is already taken.
      const firstSlot = Math.min(Math.max(slot ?? existing.attachments?.length ?? 0, 0), 14);
      let uploadResult: Awaited<ReturnType<typeof uploadBytes>> | null = null;
      let storagePath = '';
      let lastErr: unknown = null;
      let reused = false;
      for (let s = firstSlot; s <= 14 && !uploadResult && !reused; s++) {
        storagePath = `requests/${cleanId}/att${s}`;
        try {
          uploadResult = await uploadBytes(storageRef(storage, storagePath), blobPayload, metadata);
        } catch (e: any) {
          lastErr = e;
          if (e?.code !== 'storage/unauthorized') break;
          // The slot is taken. If it holds this very file from an earlier try of the same submission
          // (the upload went through but the app never heard back), use it instead of a second copy.
          const held = await getMetadata(storageRef(storage, storagePath)).catch(() => null);
          reused = Boolean(
            held?.customMetadata?.fileName === sanitizedName && held?.customMetadata?.originalSize === String(file.size)
          );
        }
      }
      if (!uploadResult && !reused) throw lastErr || new Error('No free attachment slot');
      const attachmentId = storagePath.split('/').pop() as string;

      const attachment: RequestAttachment = {
        id: attachmentId,
        type: validation.type,
        storagePath,
        // No stored file link: the viewing address is asked when the file is shown (storageUrls.ts)
        downloadUrl: '',
        fileName: sanitizedName,
        mimeType: file.type || (validation.type === 'image' ? 'image/jpeg' : validation.type === 'video' ? 'video/mp4' : 'audio/mpeg'),
        sizeBytes: file.size,
        createdAt: new Date().toISOString(),
      };

      return attachment;
    } catch (err: any) {
      console.error('[FirebaseRepository] uploadRequestAttachment failed:', err);
      throw new Error(`Failed to upload request attachment: ${err?.message || err}`);
    }
  }

  /** A request document as the app uses it, with the private contact added for those allowed to read it. */
  private async withContacts(firestore: Firestore, requestId: string, data: ServiceRequest): Promise<ServiceRequest> {
    const cleanSelectedOfferId =
      typeof data.selectedOfferId === 'string' && data.selectedOfferId.trim()
        ? data.selectedOfferId.trim()
        : undefined;

    let customerPhone = data.customerPhone;
    let customerName = data.customerName;
    let preciseLocation: RequestLocation | undefined;
    try {
      // Readable only by the customer and the selected provider; everyone else keeps the approximate point
      const contactRef = doc(firestore, 'requestContacts', requestId);
      const contactSnap = await getDoc(contactRef);
      if (contactSnap.exists()) {
        const contact = contactSnap.data();
        customerPhone = customerPhone || contact?.customerPhone;
        if (typeof contact?.customerName === 'string' && contact.customerName) customerName = contact.customerName;
        if (contact?.location && typeof contact.location.latitude === 'number') {
          preciseLocation = contact.location as RequestLocation;
        }
      }
    } catch {
      // Not authorized or no contact document: proceed with the shared data only
    }

    return {
      ...data,
      id: requestId,
      customerName: customerName || 'Клиент',
      ...(customerPhone ? { customerPhone } : {}),
      ...(preciseLocation ? { location: preciseLocation } : {}),
      status: normalizeRequestStatus(data.status),
      selectedOfferId: cleanSelectedOfferId,
      cityId: data.cityId || normalizeCityId(data.city),
      categoryId: data.categoryId || normalizeCategoryId(data.category),
    };
  }

  async getRequest(requestId: string): Promise<ServiceRequest | null> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    try {
      const reqRef = doc(firestore, 'requests', requestId);
      const snap = await getDoc(reqRef);
      if (!snap.exists()) return null;
      return await this.withContacts(firestore, requestId, snap.data() as ServiceRequest);
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
        const byCustomer = where('customerId', '==', effectiveCustomerId);
        snap = await getDocsNewestFirst(
          query(requestsColl, byCustomer, orderBy('createdAt', 'desc'), limit(CUSTOMER_REQUESTS_LIMIT)),
          query(requestsColl, byCustomer, limit(CUSTOMER_REQUESTS_LIMIT))
        );
      } else if (targetCityId && targetCatId) {
        // Provider view: query by cityId and categoryId conforming to firestore.rules
        try {
          const q = query(
            requestsColl,
            where('cityId', '==', targetCityId),
            where('categoryId', '==', targetCatId),
            where('status', 'in', PROVIDER_VISIBLE_STATUSES)
          );
          snap = await getDocs(q);

          // Support legacy 'appliance_repair' if searching for canonical 'appliances'
          if (targetCatId === 'appliances') {
            try {
              const qLegacy = query(
                requestsColl,
                where('cityId', '==', targetCityId),
                where('categoryId', '==', 'appliance_repair'),
                where('status', 'in', PROVIDER_VISIBLE_STATUSES)
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
              const qUser = query(requestsColl, where('customerId', '==', currentUid), limit(CUSTOMER_REQUESTS_LIMIT));
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

  /**
   * One request, live. Delivers null when it is gone or this user may no longer read it (another
   * provider was chosen, the request was closed): no data rather than a guessed state.
   */
  subscribeToRequest(
    requestId: string,
    onUpdate: (request: ServiceRequest | null) => void,
    onError?: (error: any) => void
  ): () => void {
    const cleanId = (requestId || '').trim();
    const firestore = db;
    if (!isFirebaseConfigured() || !firestore || !cleanId) return () => {};
    let seq = 0;
    let stopped = false;
    try {
      const unsub = onSnapshot(
        doc(firestore, 'requests', cleanId),
        (snap) => {
          const mine = ++seq;
          if (!snap.exists()) {
            onUpdate(null);
            return;
          }
          this.withContacts(firestore, cleanId, snap.data() as ServiceRequest).then((req) => {
            // A newer snapshot may have arrived while the contact was read
            if (!stopped && mine === seq) onUpdate(req);
          });
        },
        (err: any) => {
          seq++;
          if (err?.code === 'permission-denied') onUpdate(null);
          else console.warn('[FirebaseRepository] subscribeToRequest note:', err?.message || err);
          if (onError) onError(err);
        }
      );
      return () => {
        stopped = true;
        try {
          unsub();
        } catch {}
      };
    } catch (err) {
      if (onError) onError(err);
      return () => {};
    }
  }

  /** Offers, live: the customer's offers for one request, or the signed-in provider's own offers. */
  subscribeToOffers(
    filter: OfferFilter,
    onUpdate: (offers: ProviderOffer[]) => void,
    onError?: (error: any) => void
  ): () => void {
    if (!isFirebaseConfigured() || !db || !filter) return () => {};
    const offersColl = collection(db, 'offers');
    let newest: Query;
    let plain: Query;
    if (filter.requestId) {
      newest = plain = query(offersColl, where('requestId', '==', filter.requestId));
    } else {
      const providerUserId = auth?.currentUser?.uid || filter.providerUserId;
      if (!providerUserId) return () => {};
      const byProvider = where('providerUserId', '==', providerUserId);
      newest = query(offersColl, byProvider, orderBy('createdAt', 'desc'), limit(PROVIDER_OFFERS_LIMIT));
      plain = query(offersColl, byProvider);
    }
    try {
      const unsub = onSnapshotNewestFirst(
        newest,
        plain,
        (snap) => onUpdate(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProviderOffer))),
        (err: any) => {
          console.warn('[FirebaseRepository] subscribeToOffers note:', err?.message || err);
          if (onError) onError(err);
        }
      );
      return () => {
        try {
          unsub();
        } catch {}
      };
    } catch (err) {
      if (onError) onError(err);
      return () => {};
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

      let qPrimary: Query | undefined;
      let qPrimaryPlain: Query | undefined;
      if (filter?.customerId) {
        const effectiveCustomerId = auth?.currentUser?.uid || filter.customerId;
        const byCustomer = where('customerId', '==', effectiveCustomerId);
        qPrimary = query(requestsColl, byCustomer, orderBy('createdAt', 'desc'), limit(CUSTOMER_REQUESTS_LIMIT));
        qPrimaryPlain = query(requestsColl, byCustomer, limit(CUSTOMER_REQUESTS_LIMIT));
      }

      // Provider queries skip finished requests. If the project lacks an index the filtered query
      // needs, Firestore answers failed-precondition and the listener falls back to the unfiltered query.
      const isProviderQuery = !filter?.customerId;
      const listen = (
        base: ReturnType<typeof where>[],
        map: Map<string, ServiceRequest>,
        label: string,
        reportErrors: boolean
      ): (() => void) => {
        let unsub: () => void = () => {};
        const start = (withStatus: boolean) => {
          const constraints = withStatus ? [...base, where('status', 'in', PROVIDER_VISIBLE_STATUSES)] : base;
          const plain = query(requestsColl, ...constraints);
          unsub = onSnapshotNewestFirst(
            withStatus ? query(requestsColl, ...constraints, orderBy('createdAt', 'desc'), limit(PROVIDER_FEED_LIMIT)) : plain,
            plain,
            (snap) => {
              map.clear();
              snap.forEach((d) => {
                map.set(d.id, { ...(d.data() as ServiceRequest), id: d.id });
              });
              emitCombined();
            },
            (err: any) => {
              console.warn(`[FirebaseRepository] subscribeToRequests ${label} note:`, err?.message || err);
              if (reportErrors && onError) onError(err);
            }
          );
        };
        start(isProviderQuery);
        return () => unsub();
      };

      let unsubPrimary: () => void;
      if (qPrimary && qPrimaryPlain) {
        unsubPrimary = onSnapshotNewestFirst(
          qPrimary,
          qPrimaryPlain,
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
      } else if (targetCityId && targetCatId) {
        unsubPrimary = listen([where('cityId', '==', targetCityId), where('categoryId', '==', targetCatId)], primaryMap, 'primary', true);
      } else if (targetCityId) {
        unsubPrimary = listen([where('cityId', '==', targetCityId)], primaryMap, 'primary', true);
      } else if (targetCatId) {
        unsubPrimary = listen([where('categoryId', '==', targetCatId)], primaryMap, 'primary', true);
      } else {
        unsubPrimary = listen([], primaryMap, 'primary', true);
      }

      let unsubLegacy: (() => void) | null = null;
      if (targetCatId === 'appliances' && targetCityId) {
        try {
          unsubLegacy = listen([where('cityId', '==', targetCityId), where('categoryId', '==', 'appliance_repair')], legacyMap, 'legacy', false);
        } catch {}
      }

      let unsubOther: (() => void) | null = null;
      if (targetCityId && targetCatId && targetCatId !== 'other') {
        try {
          unsubOther = listen([where('cityId', '==', targetCityId), where('categoryId', '==', 'other')], otherMap, 'other', false);
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

  watchRequestActivity(requestId: string, onChange: () => void): () => void {
    if (!db || !requestId) return () => {};
    const firestore = db;
    // Several changes often arrive together (offer + request status): report them once
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 300);
    };
    const unsubs: Array<() => void> = [];
    let first = { offers: true, request: true };
    const quiet = (err: unknown) => console.warn('[FirebaseRepository] watchRequestActivity note:', (err as any)?.code || err);
    unsubs.push(
      onSnapshot(query(collection(firestore, 'offers'), where('requestId', '==', requestId)), () => {
        if (first.offers) first = { ...first, offers: false };
        else changed();
      }, quiet)
    );
    unsubs.push(
      onSnapshot(doc(firestore, 'requests', requestId), () => {
        if (first.request) first = { ...first, request: false };
        else changed();
      }, quiet)
    );
    return () => {
      if (timer) clearTimeout(timer);
      unsubs.forEach((u) => {
        try {
          u();
        } catch {}
      });
    };
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
            (k) => k !== 'status' && k !== 'updatedAt' && k !== 'selectedOfferId' && k !== 'providerDoneAt' && k !== 'finalPrice'
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

  /**
   * Cancels a request and, in the same transaction, the visit agreed for it (the security rules
   * refuse a cancellation that would leave an active appointment behind).
   */
  private async cancelRequestWithVisit(requestId: string): Promise<ServiceRequest | null> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const cleanReqId = (requestId || '').trim();
    try {
      await runTransaction(firestore, async (transaction) => {
        const reqRef = doc(firestore, 'requests', cleanReqId);
        const apptRef = doc(firestore, 'appointments', getAppointmentId(cleanReqId));
        const [reqSnap, apptSnap] = await Promise.all([transaction.get(reqRef), transaction.get(apptRef)]);
        if (!reqSnap.exists()) throw new Error(`Request not found: ${cleanReqId}`);
        const current = normalizeRequestStatus((reqSnap.data() as ServiceRequest).status);
        if (current === 'CANCELLED') return;
        if (current === 'COMPLETED') throw new Error('Validation Error: Cannot cancel a completed request');
        const now = new Date().toISOString();
        transaction.update(reqRef, { status: 'CANCELLED', updatedAt: now });
        const visit = apptSnap.exists() ? (apptSnap.data() as Appointment) : null;
        if (visit && visit.status !== 'CANCELLED' && visit.status !== 'COMPLETED') {
          transaction.update(apptRef, { status: 'CANCELLED', updatedAt: now });
        }
      });
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
    const updated =
      normalizeRequestStatus(status) === 'CANCELLED'
        ? await this.cancelRequestWithVisit(requestId)
        : await this.updateRequest(requestId, updates);
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
    // One offer per provider and request: the id is fixed, so a repeated tap can't create a second one
    const id = providerOfferId(offerData.requestId || '', providerUserId);

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
      price,
      priceType,
      availability: offerData.availability || 'В течение часа',
      message: offerData.message || '',
      ...offerExtras(offerData),
      status: 'PENDING',
      createdAt: offerData.createdAt || new Date().toISOString(),
      // Trust badges are not self-assignable; they stay off until real verification exists
      iinVerified: false,
      hasCertificate: false,
    };

    try {
      const offerRef = doc(firestore, 'offers', id);
      const reqRef = doc(firestore, 'requests', newOffer.requestId);
      // The offer and the request's offer count are written together (the rules check both), so a
      // request never takes more than MAX_OFFERS_PER_REQUEST offers, even when masters answer at once
      let existingOffer: ProviderOffer | null = null;
      let req: ServiceRequest | null = null;
      await runTransaction(firestore, async (transaction) => {
        const already = await transaction.get(offerRef);
        if (already.exists()) {
          existingOffer = { id, ...already.data() } as ProviderOffer;
          return;
        }
        const reqSnap = await transaction.get(reqRef);
        if (!reqSnap.exists()) throw new Error('Request not found');
        const reqData = reqSnap.data() as ServiceRequest;
        if (isRequestExpired(reqData)) throw new Error('Validation Error: request-expired');
        if (isRequestFull(reqData)) throw new Error('Validation Error: offer-limit-reached');
        const offerCount = (reqData.offerCount || 0) + 1;
        transaction.set(offerRef, sanitizeForFirestore(newOffer));
        transaction.update(reqRef, {
          status: 'OFFERS_RECEIVED',
          lastOfferId: id,
          offerCount,
          updatedAt: new Date().toISOString(),
        });
        req = { ...reqData, id: reqSnap.id, status: 'OFFERS_RECEIVED', lastOfferId: id, offerCount };
      });
      if (existingOffer) return existingOffer;
      if (req) notificationService.notifyNewOffer(req, newOffer).catch(() => {});
      return newOffer;
    } catch (err) {
      if (err instanceof Error && /request-expired|offer-limit-reached/.test(err.message)) throw err;
      handleFirestoreError(err, OperationType.WRITE, `offers/${id}`);
    }
  }

  async countOffers(requestId: string): Promise<number> {
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const snap = await getCountFromServer(query(collection(firestore, 'offers'), where('requestId', '==', requestId)));
    return snap.data().count;
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
        const byProvider = where('providerUserId', '==', targetProviderUserId);
        const snap = await getDocsNewestFirst(
          query(offersColl, byProvider, orderBy('createdAt', 'desc'), limit(PROVIDER_OFFERS_LIMIT)),
          query(offersColl, byProvider)
        );
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

        // Idempotency check: if this exact offer is already the chosen one, nothing is written and the
        // request comes back as it is stored now (it may have moved on to IN_PROGRESS or COMPLETED)
        if (reqData.selectedOfferId === cleanOfferId && offerData.status === 'ACCEPTED') {
          resultReq = { ...reqData, id: cleanReqId };
          resultOffer = { ...offerData, id: cleanOfferId };
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
      // The review goes to the check first (Gemini and suspicion signals, functions/src/reviewModeration.ts);
      // a clean one appears on the master's profile within moments, a doubtful one after the operator looks
      const submissionRef = doc(firestore, 'reviewSubmissions', id);
      const [published, submitted] = await Promise.all([getDoc(doc(firestore, 'reviews', id)), getDoc(submissionRef)]);
      if (published.exists() || submitted.exists()) {
        throw new Error('Duplicate Review Error: A review already exists for this completed request');
      }

      await setDoc(submissionRef, sanitizeForFirestore(newReview));
      return { ...newReview, moderation: 'pending' };
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
          `[FirebaseRepository] Note: Cloud Firestore review write on 'reviewSubmissions/${id}' restricted by security rules. Falling back gracefully to LocalRepository.`
        );
        throw new Error(`FirestorePermissionDenied: ${msg}`);
      }
      handleFirestoreError(err, OperationType.WRITE, `reviewSubmissions/${id}`);
    }
  }

  /**
   * A master's rating. The server keeps it in providerStats, counting each customer once (their newest
   * review), so a pile of reviews from a second account of the same person doesn't lift it. Masters
   * whose rating was never counted there yet (older data) are counted from the reviews directly.
   */
  async getRatingSummary(providerIds: string[]): Promise<RatingSummary> {
    const ids = Array.from(new Set(providerIds.map((id) => (id || '').trim()).filter(Boolean))).slice(0, 10);
    if (ids.length === 0) return { avg: 0, count: 0, reviews: 0 };
    await ensureFirebaseAuth();
    const firestore = this.ensureDb();
    const stats = await Promise.all(ids.map((id) => getDoc(doc(firestore, 'providerStats', id)).catch(() => null)));
    const counted = stats
      .map((s) => (s?.exists() ? s.data() : null))
      .filter((d): d is NonNullable<typeof d> => Boolean(d) && typeof d!.ratingCount === 'number');
    if (counted.length > 0) {
      let people = 0;
      let total = 0;
      let reviews = 0;
      for (const d of counted) {
        people += Number(d.ratingCount) || 0;
        total += Number(d.ratingTotal) || 0;
        reviews += Number(d.reviewCount) || 0;
      }
      return { count: people, avg: people ? total / people : 0, reviews };
    }
    const snap = await getAggregateFromServer(query(collection(firestore, 'reviews'), where('providerId', 'in', ids)), {
      total: count(),
      avgRating: average('rating'),
    });
    const { total, avgRating } = snap.data();
    return { count: total || 0, avg: total ? Number(avgRating) || 0 : 0, reviews: total || 0 };
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
          return reviews;
        }
        // Not published (yet): the customer's own submission, with where the check stands
        try {
          const sub = await getDoc(doc(firestore, 'reviewSubmissions', filter.requestId.trim()));
          if (sub.exists()) {
            const data = sub.data();
            const state = data.status === 'rejected' ? 'rejected' : data.status === 'published' ? 'published' : 'pending';
            reviews.push({ ...(data as Review), moderation: state });
          }
        } catch {
          // Someone else's submission: not readable, nothing to show
        }
        return reviews;
      }

      // Never the whole collection: reviews are read per provider, newest first and capped
      if (!filter?.providerId?.trim()) return reviews;
      const reviewsCol = collection(firestore, 'reviews');
      const byProvider = where('providerId', '==', filter.providerId.trim());
      const querySnapshot = await getDocsNewestFirst(
        query(reviewsCol, byProvider, orderBy('createdAt', 'desc'), limit(PROVIDER_REVIEWS_LIMIT)),
        query(reviewsCol, byProvider)
      );
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

    const summaryText = (text || (newMsg.attachments?.[0]?.type === 'image' ? '📷 Фото' : '📎 Файл')).slice(0, 300);

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
          // Counted on the server, so two quick messages can't overwrite each other's count
          ...(isCustomer ? { unreadCountProvider: increment(1) } : { unreadCountCustomer: increment(1) }),
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
    if (blobPayload instanceof Blob && blobPayload.type.startsWith('image/')) {
      blobPayload = await cleanImageForUpload(blobPayload);
    }

    const fileRef = storageRef(storage, storagePath);
    const metadata = {
      contentType: (blobPayload instanceof Blob && blobPayload.type) || file.type || (validation.type === 'image' ? 'image/jpeg' : 'application/octet-stream'),
      customMetadata: {
        conversationId: cleanId,
        uploadedBy: authUid,
        fileName: sanitizedName,
      },
    };

    try {
      await uploadBytes(fileRef, blobPayload, metadata);

      const attachment: ChatAttachment = {
        id: attachmentId,
        type: validation.type,
        storagePath,
        // No stored file link: the viewing address is asked when the file is shown (storageUrls.ts)
        downloadUrl: '',
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
      // Read mark: everything up to the newest message (its own time) has been seen
      const readUpTo = typeof conv.lastMessageAt === 'string' ? conv.lastMessageAt : '';
      if (currentUid === conv.customerId) {
        if (conv.unreadCountCustomer > 0) updates.unreadCountCustomer = 0;
        if (readUpTo && readUpTo !== conv.customerLastReadAt) updates.customerLastReadAt = readUpTo;
      } else if (currentUid === conv.providerUserId || currentUid === conv.providerId) {
        if (conv.unreadCountProvider > 0) updates.unreadCountProvider = 0;
        if (readUpTo && readUpTo !== conv.providerLastReadAt) updates.providerLastReadAt = readUpTo;
      }

      if (Object.keys(updates).length > 0) {
        const convRef = doc(firestore, 'conversations', cleanId);
        await updateDoc(convRef, updates);
      }
    } catch (err: any) {
      console.warn('[FirebaseRepository] markMessagesAsRead note:', err?.message || err);
    }
  }

  subscribeToConversation(
    conversationId: string,
    onUpdate: (conversation: Conversation | null) => void,
    onError?: (error: any) => void
  ): () => void {
    const cleanId = (conversationId || '').trim();
    if (!isFirebaseConfigured() || !db || !cleanId) return () => {};
    try {
      const unsub = onSnapshot(
        doc(db, 'conversations', cleanId),
        (snap) => onUpdate(snap.exists() ? (snap.data() as Conversation) : null),
        (err) => {
          console.warn('[FirebaseRepository] subscribeToConversation note:', err?.message || err);
          if (onError) onError(err);
        }
      );
      return () => {
        try {
          unsub();
        } catch {}
      };
    } catch (err) {
      if (onError) onError(err);
      return () => {};
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
      // The newest 50 messages (a listener on the oldest 50 stopped receiving new ones in long chats)
      const q = query(msgsCol, orderBy('createdAt', 'desc'), limit(50));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const msgs: ChatMessage[] = [];
          snapshot.forEach((d) => {
            msgs.push(d.data() as ChatMessage);
          });
          // Oldest first on screen
          msgs.reverse();
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
      const mine = where('recipientUserId', '==', cleanUid);
      const snapshot = await getDocsNewestFirst(
        query(notifsCol, mine, orderBy('createdAt', 'desc'), limit(Math.min(limitCount, NOTIFICATIONS_LIMIT))),
        query(notifsCol, mine)
      );

      const items: AppNotification[] = [];
      snapshot.forEach((d) => {
        items.push(d.data() as AppNotification);
      });

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

      const now = new Date().toISOString();
      const unread = snapshot.docs.filter((d) => !(d.data() as AppNotification).isRead);
      // A batch holds at most 500 writes
      for (let i = 0; i < unread.length; i += 400) {
        const batch = writeBatch(db);
        unread.slice(i, i + 400).forEach((d) => batch.update(d.ref, { isRead: true, readAt: now }));
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
      const mine = where('recipientUserId', '==', cleanUid);

      const unsubscribe = onSnapshotNewestFirst(
        query(notifsCol, mine, orderBy('createdAt', 'desc'), limit(NOTIFICATIONS_LIMIT)),
        query(notifsCol, mine),
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
      // Only the changed fields are written, so a change the other side made meanwhile is kept
      const { id: _i, requestId: _r, customerId: _c, providerId: _p, providerUserId: _u, createdAt: _cr, ...changes } = updates;
      await updateDoc(doc(db, 'appointments', docId), sanitizeForFirestore({ ...changes, updatedAt: updated.updatedAt }));
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
    _confirmedByRole: 'customer' | 'provider'
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
          // Only the customer closes the request; the provider reports the job finished
          const callerUid = auth?.currentUser?.uid;
          transaction.update(
            reqRef,
            callerUid && callerUid === reqData.customerId
              ? { status: 'COMPLETED', updatedAt: now }
              : providerDoneUpdate(reqData, now)
          );
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
          // Appointment can ONLY transition to COMPLETED from CONFIRMED (an appointment the provider
          // already completed is left as is). Unconfirmed appointments (PROPOSED, RESCHEDULED) cannot be
          // marked COMPLETED per security rules.
          if (existingAppt.status === 'CONFIRMED') {
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

      // An agreed visit is completed together with the work report (the request gets providerDoneAt
      // below, in the same transaction); a time that was never confirmed stays as it is
      if (workStatus === 'WORK_COMPLETED' && existingAppt.status === 'CONFIRMED') {
        apptUpdates.status = 'COMPLETED';
      }

      const reqRef = doc(firestore, 'requests', existingAppt.requestId);
      const reqSnap = await transaction.get(reqRef);

      transaction.update(apptRef, sanitizeForFirestore(apptUpdates));

      if (reqSnap.exists()) {
        const reqData = reqSnap.data() as ServiceRequest;
        if (workStatus === 'WORK_COMPLETED') {
          // The provider reports the job finished; the customer confirms it (COMPLETED)
          if (reqData.status !== 'COMPLETED' && reqData.status !== 'CANCELLED') {
            transaction.update(reqRef, providerDoneUpdate(reqData, now));
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
