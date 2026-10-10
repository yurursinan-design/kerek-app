import {
  Appointment,
  AppNotification,
  ChatAttachment,
  ChatMessage,
  Conversation,
  normalizeRequestStatus,
  Provider,
  ProviderOffer,
  RequestAttachment,
  RequestLocation,
  RequestStatus,
  Review,
  ServiceRequest,
  User,
  WorkStatus,
} from '../types';
import {
  OfferFilter,
  ProviderFilter,
  Repository,
  RequestFilter,
  ReviewFilter,
} from './repository';
import { localRepository, getCurrentUserId } from './localRepository';
import { firebaseRepository, FirebaseRepository } from './firebaseRepository';
import { auth, isFirebaseConfigured } from './firebase';
import { logTechnicalError } from './errorHandler';
import { notificationService } from './notificationService';
import { offlineQueueService } from './offlineQueueService';

/**
 * Resilient Repository:
 * Implements the Firebase cloud-with-fallback architecture:
 *
 * Cloud Firestore (Firebase)
 *   ↓
 * if configured & available → use Firebase
 *   ↓
 * if unavailable or network failure → fallback seamlessly to LocalRepository!
 *
 * Important:
 * Does not silently lose data.
 * Does not overwrite local data automatically.
 */
export class ResilientRepository implements Repository {
  private localRepoInstance?: Repository;
  private firebaseRepoInstance?: FirebaseRepository;

  constructor(
    localRepo?: Repository,
    firebaseRepo?: FirebaseRepository
  ) {
    if (localRepo) this.localRepoInstance = localRepo;
    if (firebaseRepo) this.firebaseRepoInstance = firebaseRepo;
  }

  private get localRepo(): Repository {
    return this.localRepoInstance || localRepository;
  }

  private get firebaseRepo(): FirebaseRepository {
    return this.firebaseRepoInstance || firebaseRepository;
  }

  /**
   * Returns true if Firebase cloud backend is configured and ready.
   */
  public isCloudActive(): boolean {
    return this.firebaseRepo.isAvailable();
  }

  private async executeWithFallback<T>(
    operationName: string,
    cloudOp: () => Promise<T>,
    localOp: () => Promise<T>
  ): Promise<T> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        return await cloudOp();
      } catch (err: any) {
        // Validation and duplication errors are client/data logic errors, not infrastructure outages
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.includes('Duplicate')
        ) {
          throw err;
        }

        // Log graceful fallback informatively without triggering error monitoring
        console.warn(
          `[KEREK Firebase Fallback] Operation "${operationName}" on Cloud Firestore fell back to LocalRepository:`,
          err?.message || err
        );
        logTechnicalError(`ResilientRepository.${operationName} (Firebase fallback to Local)`, err?.message || err);
        return await localOp();
      }
    }

    // Cloud is not configured or unavailable -> execute local operation directly
    return await localOp();
  }

  // =================== Users ===================
  async createUser(userData: Partial<User>): Promise<User> {
    return this.executeWithFallback(
      'createUser',
      () => this.firebaseRepo.createUser(userData),
      () => this.localRepo.createUser(userData)
    );
  }

  async getUser(userId: string): Promise<User | null> {
    return this.executeWithFallback(
      'getUser',
      () => this.firebaseRepo.getUser(userId),
      () => this.localRepo.getUser(userId)
    );
  }

  // =================== Providers ===================
  async createProvider(providerData: Partial<Provider>): Promise<Provider> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        const cloudProv = await this.firebaseRepo.createProvider(providerData);
        try {
          await this.localRepo.createProvider({ ...cloudProv, ...providerData });
        } catch (localErr) {
          console.warn('[ResilientRepository] Local sync note for createProvider:', localErr);
        }
        return cloudProv;
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.includes('Duplicate')
        ) {
          throw err;
        }
        console.warn(
          `[KEREK Firebase Fallback] Operation "createProvider" on Cloud Firestore fell back to LocalRepository:`,
          err?.message || err
        );
        logTechnicalError(`ResilientRepository.createProvider (Firebase fallback to Local)`, err?.message || err);
        return await this.localRepo.createProvider(providerData);
      }
    }
    return await this.localRepo.createProvider(providerData);
  }

  async getProvider(providerId: string): Promise<Provider | null> {
    return this.executeWithFallback(
      'getProvider',
      () => this.firebaseRepo.getProvider(providerId),
      () => this.localRepo.getProvider(providerId)
    );
  }

  async getProviders(filter?: ProviderFilter): Promise<Provider[]> {
    return this.executeWithFallback(
      'getProviders',
      () => this.firebaseRepo.getProviders(filter),
      () => this.localRepo.getProviders(filter)
    );
  }

  // =================== Requests ===================
  async createRequest(requestData: Partial<ServiceRequest>): Promise<ServiceRequest> {
    if (isFirebaseConfigured()) {
      try {
        const cloudReq = await this.firebaseRepo.createRequest(requestData);
        try {
          await this.localRepo.createRequest({ ...cloudReq, ...requestData });
        } catch (localErr) {
          console.warn('[ResilientRepository] Local sync note for createRequest:', localErr);
        }
        return cloudReq;
      } catch (err: any) {
        logTechnicalError('ResilientRepository.createRequest (Cloud Error)', err?.message || err);
        throw err;
      }
    }

    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    const localReq = await this.localRepo.createRequest(requestData);
    offlineQueueService.enqueueMutation('createRequest', requestData, currentUid);
    return localReq;
  }

  async uploadRequestAttachment(
    requestId: string,
    file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string },
    customerId?: string
  ): Promise<RequestAttachment> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        return await this.firebaseRepo.uploadRequestAttachment(requestId, file, customerId);
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.includes('Attachment validation failed')
        ) {
          throw err;
        }
        console.warn(
          `[KEREK Firebase Fallback] Operation "uploadRequestAttachment" on Cloud fell back to LocalRepository:`,
          err?.message || err
        );
        logTechnicalError('ResilientRepository.uploadRequestAttachment (Firebase fallback to Local)', err?.message || err);
        return await this.localRepo.uploadRequestAttachment(requestId, file, customerId);
      }
    }
    return await this.localRepo.uploadRequestAttachment(requestId, file, customerId);
  }

  async getRequest(requestId: string): Promise<ServiceRequest | null> {
    let cloudReq: ServiceRequest | null = null;
    if (this.firebaseRepo.isAvailable()) {
      try {
        cloudReq = await this.firebaseRepo.getRequest(requestId);
      } catch {}
    }
    const localReq = await this.localRepo.getRequest(requestId);
    if (!cloudReq) return localReq;
    if (!localReq) return cloudReq;

    const statusOrder: Record<string, number> = {
      OPEN: 1,
      NEW: 1,
      MATCHING: 2,
      OFFERS_RECEIVED: 2,
      PROVIDER_SELECTED: 3,
      ACCEPTED: 3,
      IN_PROGRESS: 4,
      COMPLETED: 5,
      CANCELLED: 6,
    };
    const cRank = statusOrder[cloudReq.status] || 0;
    const lRank = statusOrder[localReq.status] || 0;
    if (lRank > cRank) return localReq;
    if (cRank > lRank) return cloudReq;

    return new Date(cloudReq.createdAt).getTime() >=
      new Date(localReq.createdAt).getTime()
      ? cloudReq
      : localReq;
  }

  async getRequests(filter?: RequestFilter): Promise<ServiceRequest[]> {
    if (this.firebaseRepo.isAvailable()) {
      let cloudReqs: ServiceRequest[] = [];
      try {
        cloudReqs = await this.firebaseRepo.getRequests(filter);
      } catch (err: any) {
        console.warn(
          `[KEREK Firebase Fallback] Operation "getRequests" on Cloud Firestore fell back to LocalRepository:`,
          err?.message || err
        );
        logTechnicalError(`ResilientRepository.getRequests (Firebase fallback to Local)`, err?.message || err);
      }

      let localReqs: ServiceRequest[] = [];
      try {
        localReqs = await this.localRepo.getRequests(filter);
      } catch (err: any) {
        console.warn('[ResilientRepository.getRequests] Local read note:', err?.message || err);
      }

      // Merge cloud and local requests so requests created in either store are available!
      const map = new Map<string, ServiceRequest>();
      (cloudReqs || []).forEach((r) => {
        map.set(r.id, r);
        try {
          this.localRepo.createRequest(r).catch(() => {});
        } catch {}
      });
      (localReqs || []).forEach((r) => {
        if (!map.has(r.id)) {
          map.set(r.id, r);
        }
      });
      return Array.from(map.values());
    }
    return await this.localRepo.getRequests(filter);
  }

  subscribeToRequests(
    filter: RequestFilter,
    onData: (requests: ServiceRequest[]) => void,
    onError?: (error: any) => void
  ): () => void {
    if (isFirebaseConfigured() && this.firebaseRepo.isAvailable()) {
      return this.firebaseRepo.subscribeToRequests(filter, onData, onError);
    }
    return this.localRepo.subscribeToRequests(filter, onData, onError);
  }

  async updateRequest(
    requestId: string,
    updates: Partial<ServiceRequest>
  ): Promise<ServiceRequest | null> {
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    let result: ServiceRequest | null = null;
    if (this.firebaseRepo.isAvailable()) {
      try {
        result = await this.firebaseRepo.updateRequest(requestId, updates);
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.startsWith('Unauthorized:')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] updateRequest cloud note, falling back to local:', err?.message || err);
      }
    }
    const localResult = await this.localRepo.updateRequest(requestId, updates);
    if (!result) {
      offlineQueueService.enqueueMutation('updateRequest', { requestId, updates }, currentUid);
    }
    return result || localResult;
  }

  async updateRequestStatus(
    requestId: string,
    status: RequestStatus,
    selectedOfferId?: string
  ): Promise<ServiceRequest | null> {
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    const canonicalStatus = normalizeRequestStatus(status);
    let result: ServiceRequest | null = null;
    if (this.firebaseRepo.isAvailable()) {
      try {
        result = await this.firebaseRepo.updateRequestStatus(requestId, canonicalStatus, selectedOfferId);
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.startsWith('Unauthorized:')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] updateRequestStatus cloud note, falling back to local:', err?.message || err);
      }
    }
    const localResult = await this.localRepo.updateRequestStatus(requestId, canonicalStatus, selectedOfferId);
    if (!result) {
      offlineQueueService.enqueueMutation(
        'updateRequestStatus',
        { requestId, status: canonicalStatus, selectedOfferId },
        currentUid
      );
      if (localResult) {
        if (canonicalStatus === 'COMPLETED') {
          notificationService.notifyWorkCompleted(localResult).catch(() => {});
        } else if (canonicalStatus === 'CANCELLED') {
          notificationService.notifyRequestCancelled(localResult).catch(() => {});
        }
      }
    }
    return result || localResult;
  }

  // =================== Offers ===================
  async createOffer(offerData: Partial<ProviderOffer>): Promise<ProviderOffer> {
    if (isFirebaseConfigured()) {
      try {
        const cloudOffer = await this.firebaseRepo.createOffer(offerData);
        try {
          await this.localRepo.createOffer({ ...cloudOffer, ...offerData });
        } catch (localErr) {
          console.warn('[ResilientRepository] Local sync note for createOffer:', localErr);
        }
        return cloudOffer;
      } catch (err: any) {
        logTechnicalError('ResilientRepository.createOffer (Cloud Error)', err?.message || err);
        throw err;
      }
    }

    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    const localOffer = await this.localRepo.createOffer(offerData);
    offlineQueueService.enqueueMutation('createOffer', offerData, currentUid);
    if (localOffer.requestId) {
      this.getRequest(localOffer.requestId).then((req) => {
        if (req) notificationService.notifyNewOffer(req, localOffer).catch(() => {});
      }).catch(() => {});
    }
    return localOffer;
  }

  async getOffers(filter?: OfferFilter): Promise<ProviderOffer[]> {
    if (this.firebaseRepo.isAvailable()) {
      let cloudOffers: ProviderOffer[] = [];
      try {
        cloudOffers = await this.firebaseRepo.getOffers(filter);
      } catch (err: any) {
        console.warn(
          `[KEREK Firebase Fallback] Operation "getOffers" on Cloud Firestore fell back to LocalRepository:`,
          err?.message || err
        );
        logTechnicalError(`ResilientRepository.getOffers (Firebase fallback to Local)`, err?.message || err);
      }

      let localOffers: ProviderOffer[] = [];
      try {
        localOffers = await this.localRepo.getOffers(filter);
      } catch (err: any) {
        console.warn('[ResilientRepository.getOffers] Local read note:', err?.message || err);
      }

      // Merge cloud and local offers so offers are never lost across offline / Spark / fallback sessions!
      const map = new Map<string, ProviderOffer>();
      (cloudOffers || []).forEach((o) => map.set(o.id, o));
      (localOffers || []).forEach((o) => {
        if (!map.has(o.id)) {
          map.set(o.id, o);
        }
      });
      return Array.from(map.values());
    }
    return await this.localRepo.getOffers(filter);
  }

  async updateOffer(
    offerId: string,
    updates: Partial<ProviderOffer>
  ): Promise<ProviderOffer | null> {
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    let result: ProviderOffer | null = null;
    if (this.firebaseRepo.isAvailable()) {
      try {
        result = await this.firebaseRepo.updateOffer(offerId, updates);
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.startsWith('Unauthorized:')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] updateOffer cloud note, falling back to local:', err?.message || err);
      }
    }
    const localResult = await this.localRepo.updateOffer(offerId, updates);
    if (!result) {
      offlineQueueService.enqueueMutation('updateOffer', { offerId, updates }, currentUid);
    }
    return result || localResult;
  }

  async acceptOffer(
    requestId: string,
    offerId: string
  ): Promise<{ request: ServiceRequest | null; offer: ProviderOffer | null }> {
    if (isFirebaseConfigured()) {
      try {
        const result = await this.firebaseRepo.acceptOffer(requestId, offerId);
        if (result && result.request) {
          try {
            await this.localRepo.updateRequest(result.request.id, result.request);
          } catch {}
        }
        if (result && result.offer) {
          try {
            await this.localRepo.updateOffer(result.offer.id, result.offer);
          } catch {}
        }
        return result;
      } catch (err: any) {
        logTechnicalError('ResilientRepository.acceptOffer (Cloud Error)', err?.message || err);
        throw err;
      }
    }

    return await this.localRepo.acceptOffer(requestId, offerId);
  }

  // =================== Reviews ===================
  async createReview(reviewData: Partial<Review>): Promise<Review> {
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    const isAnonymousSession = Boolean(
      !auth?.currentUser ||
      auth.currentUser.isAnonymous ||
      getCurrentUserId().startsWith('usr-') ||
      getCurrentUserId() === 'temp-local-user-id'
    );
    const isSelfReview = Boolean(
      reviewData.customerId &&
      reviewData.providerId &&
      (reviewData.customerId.trim() === reviewData.providerId.trim() ||
       (auth?.currentUser?.uid && reviewData.providerId.trim() === auth.currentUser.uid))
    );

    if (isAnonymousSession && isSelfReview) {
      return await this.localRepo.createReview(reviewData);
    }

    if (this.firebaseRepo.isAvailable()) {
      try {
        return await this.firebaseRepo.createReview(reviewData);
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.startsWith('Unauthorized:')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] createReview cloud note, falling back to local:', err?.message || err);
        const localReview = await this.localRepo.createReview(reviewData);
        offlineQueueService.enqueueMutation('createReview', reviewData, currentUid);
        return localReview;
      }
    }
    const localReview = await this.localRepo.createReview(reviewData);
    offlineQueueService.enqueueMutation('createReview', reviewData, currentUid);
    return localReview;
  }

  async getReviews(filter?: ReviewFilter): Promise<Review[]> {
    let cloudReviews: Review[] = [];
    if (this.firebaseRepo.isAvailable()) {
      try {
        cloudReviews = await this.firebaseRepo.getReviews(filter);
      } catch (err: any) {
        console.warn('[ResilientRepository] Note reading reviews from cloud, falling back to local:', err?.message || err);
      }
    }
    const localReviews = await this.localRepo.getReviews(filter);
    if (!cloudReviews || cloudReviews.length === 0) return localReviews;
    if (!localReviews || localReviews.length === 0) return cloudReviews;
    const map = new Map<string, Review>();
    for (const r of cloudReviews) map.set(r.id, r);
    for (const r of localReviews) {
      if (!map.has(r.id)) map.set(r.id, r);
    }
    return Array.from(map.values());
  }

  // =================== Matching ===================
  async matchProviders(request: ServiceRequest): Promise<Provider[]> {
    return this.executeWithFallback(
      'matchProviders',
      () => this.firebaseRepo.matchProviders(request),
      () => this.localRepo.matchProviders(request)
    );
  }

  // =================== Conversations & In-App Chat ===================
  async getConversation(conversationId: string): Promise<Conversation | null> {
    return this.executeWithFallback(
      'getConversation',
      () => this.firebaseRepo.getConversation(conversationId),
      () => this.localRepo.getConversation(conversationId)
    );
  }

  async getOrCreateConversation(requestId: string): Promise<Conversation> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        const cloudConv = await this.firebaseRepo.getOrCreateConversation(requestId);
        try {
          // Synchronize locally in background
          const localConv = await this.localRepo.getConversation(cloudConv.id);
          if (!localConv) {
            await this.localRepo.getOrCreateConversation(requestId);
          }
        } catch {}
        return cloudConv;
      } catch (err: any) {
        // Do not mask chat permission, validation, or server errors as fake local success
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.includes('OPEN requests') ||
          err?.message?.includes('No provider offer has been selected') ||
          err?.message?.includes('FirestorePermissionDenied') ||
          err?.message?.includes('Missing or insufficient permissions') ||
          err?.message?.includes('permission')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] Note creating conversation in cloud:', err?.message || err);
        throw err;
      }
    }
    return await this.localRepo.getOrCreateConversation(requestId);
  }

  async getMessages(conversationId: string, limitCount = 30): Promise<ChatMessage[]> {
    let cloudMsgs: ChatMessage[] = [];
    if (this.firebaseRepo.isAvailable()) {
      try {
        cloudMsgs = await this.firebaseRepo.getMessages(conversationId, limitCount);
      } catch (err: any) {
        console.warn('[ResilientRepository] Note reading messages from cloud:', err?.message || err);
      }
    }
    const localMsgs = await this.localRepo.getMessages(conversationId, limitCount);
    if (!cloudMsgs || cloudMsgs.length === 0) return localMsgs;
    if (!localMsgs || localMsgs.length === 0) return cloudMsgs;
    const map = new Map<string, ChatMessage>();
    for (const m of cloudMsgs) map.set(m.id, m);
    for (const m of localMsgs) {
      if (!map.has(m.id)) map.set(m.id, m);
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async sendMessage(conversationId: string, messageData: Partial<ChatMessage>): Promise<ChatMessage> {
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    if (this.firebaseRepo.isAvailable()) {
      try {
        const cloudMsg = await this.firebaseRepo.sendMessage(conversationId, messageData);
        try {
          await this.localRepo.sendMessage(conversationId, cloudMsg);
        } catch {}
        return cloudMsg;
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.startsWith('Unauthorized:')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] sendMessage cloud note, falling back locally:', err?.message || err);
        const localMsg = await this.localRepo.sendMessage(conversationId, messageData);
        offlineQueueService.enqueueMutation('sendMessage', { conversationId, messageData }, currentUid);
        this.getConversation(conversationId).then((conv) => {
          if (conv) notificationService.notifyNewMessage(conv, localMsg).catch(() => {});
        }).catch(() => {});
        return localMsg;
      }
    }
    const localMsg = await this.localRepo.sendMessage(conversationId, messageData);
    offlineQueueService.enqueueMutation('sendMessage', { conversationId, messageData }, currentUid);
    this.getConversation(conversationId).then((conv) => {
      if (conv) notificationService.notifyNewMessage(conv, localMsg).catch(() => {});
    }).catch(() => {});
    return localMsg;
  }

  async uploadChatAttachment(
    conversationId: string,
    file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string }
  ): Promise<ChatAttachment> {
    if (this.firebaseRepo.isAvailable()) {
      // Upload strictly to Cloud Storage
      return await this.firebaseRepo.uploadChatAttachment(conversationId, file);
    }
    // Standalone fallback
    return await this.localRepo.uploadChatAttachment(conversationId, file);
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
    if (this.firebaseRepo.isAvailable()) {
      const cloudMsg = await this.firebaseRepo.sendChatMessageWithAttachment(conversationId, messageData);
      try {
        await this.localRepo.sendMessage(conversationId, cloudMsg);
      } catch {}
      return cloudMsg;
    }
    const localMsg = await this.localRepo.sendChatMessageWithAttachment(conversationId, messageData);
    this.getConversation(conversationId).then((conv) => {
      if (conv) notificationService.notifyNewMessage(conv, localMsg).catch(() => {});
    }).catch(() => {});
    return localMsg;
  }

  async markMessagesAsRead(conversationId: string): Promise<void> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        await this.firebaseRepo.markMessagesAsRead(conversationId);
      } catch (err) {
        console.warn('[ResilientRepository] markMessagesAsRead cloud note:', err);
      }
    }
    try {
      await this.localRepo.markMessagesAsRead(conversationId);
    } catch {}
  }

  subscribeToMessages(
    conversationId: string,
    onUpdate: (messages: ChatMessage[]) => void,
    onError?: (error: any) => void
  ): () => void {
    const cleanId = (conversationId || '').trim();
    if (!cleanId) {
      return () => {};
    }

    let isDisposed = false;
    let cloudUnsubscribe: (() => void) | null = null;
    let localUnsubscribe: (() => void) | null = null;
    let fallbackPollInterval: any = null;

    // Helper to refresh and merge latest messages
    const refreshMessages = async () => {
      if (isDisposed) return;
      try {
        const msgs = await this.getMessages(cleanId);
        if (!isDisposed) {
          onUpdate(msgs);
        }
      } catch {}
    };

    // 1. Always attach local subscription for instant in-tab and cross-tab delivery
    localUnsubscribe = this.localRepo.subscribeToMessages(cleanId, (localMsgs) => {
      if (isDisposed) return;
      onUpdate(localMsgs);
    });

    // 2. If Firebase is available, attach Cloud Firestore realtime listener
    if (this.firebaseRepo.isAvailable()) {
      let isPollingActive = false;

      const startFallbackPolling = () => {
        if (isPollingActive || isDisposed) return;
        isPollingActive = true;
        // Poll every 2.5s to ensure messages sent from other devices/browsers arrive seamlessly
        fallbackPollInterval = setInterval(() => {
          refreshMessages();
        }, 2500);
      };

      try {
        cloudUnsubscribe = this.firebaseRepo.subscribeToMessages(
          cleanId,
          (cloudMsgs) => {
            if (isDisposed) return;
            // Cache received cloud messages into local store so local store is always fresh
            (cloudMsgs || []).forEach((m) => {
              this.localRepo.sendMessage(cleanId, m).catch(() => {});
            });
            onUpdate(cloudMsgs);
          },
          (err) => {
            // If realtime listener is restricted (e.g. security rules in console or network limits),
            // seamlessly engage fallback polling without crashing or breaking the user experience.
            console.warn(
              '[ResilientRepository] Realtime cloud listener note, engaging resilient synchronization:',
              err?.message || err
            );
            startFallbackPolling();
            refreshMessages();
            if (onError) {
              onError(err);
            }
          }
        );
      } catch (err) {
        console.warn('[ResilientRepository] Realtime listener setup note:', err);
        startFallbackPolling();
        if (onError) {
          onError(err);
        }
      }
    }

    return () => {
      isDisposed = true;
      if (fallbackPollInterval) {
        clearInterval(fallbackPollInterval);
        fallbackPollInterval = null;
      }
      if (cloudUnsubscribe) {
        try {
          cloudUnsubscribe();
        } catch {}
      }
      if (localUnsubscribe) {
        try {
          localUnsubscribe();
        } catch {}
      }
    };
  }

  // =================== In-App Notifications ===================

  async createNotification(notificationData: AppNotification): Promise<AppNotification> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        const cloudNotif = await this.firebaseRepo.createNotification(notificationData);
        // Also sync into local repository
        try {
          await this.localRepo.createNotification(cloudNotif);
        } catch {}
        return cloudNotif;
      } catch (err: any) {
        const isPermission =
          err?.code === 'permission-denied' ||
          String(err?.message || err).includes('permission') ||
          String(err?.message || err).includes('PERMISSION_DENIED');
        // Do not silently mask authorization / security rule rejections: log it, then fall back to local store
        if (isPermission) {
          logTechnicalError('ResilientRepository.createNotification (Unauthorized)', err);
        } else {
          console.warn('[ResilientRepository] createNotification cloud error, falling back locally:', err?.message || err);
        }
      }
    }
    return await this.localRepo.createNotification(notificationData);
  }

  async getNotifications(userId: string, limitCount = 50): Promise<AppNotification[]> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        const cloudNotifs = await this.firebaseRepo.getNotifications(userId, limitCount);
        // Cache into local store
        cloudNotifs.forEach((n) => {
          this.localRepo.createNotification(n).catch(() => {});
        });
        return cloudNotifs;
      } catch (err) {
        console.warn('[ResilientRepository] getNotifications cloud note:', err);
      }
    }
    return await this.localRepo.getNotifications(userId, limitCount);
  }

  async markNotificationAsRead(notificationId: string): Promise<void> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        await this.firebaseRepo.markNotificationAsRead(notificationId);
      } catch (err) {
        console.warn('[ResilientRepository] markNotificationAsRead cloud note:', err);
      }
    }
    try {
      await this.localRepo.markNotificationAsRead(notificationId);
    } catch {}
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    if (this.firebaseRepo.isAvailable()) {
      try {
        await this.firebaseRepo.markAllNotificationsAsRead(userId);
      } catch (err) {
        console.warn('[ResilientRepository] markAllNotificationsAsRead cloud note:', err);
      }
    }
    try {
      await this.localRepo.markAllNotificationsAsRead(userId);
    } catch {}
  }

  subscribeToNotifications(
    userId: string,
    onUpdate: (notifications: AppNotification[]) => void,
    onError?: (error: any) => void
  ): () => void {
    const cleanUid = (userId || '').trim();
    if (!cleanUid) {
      return () => {};
    }

    let isDisposed = false;
    let cloudUnsubscribe: (() => void) | null = null;
    let localUnsubscribe: (() => void) | null = null;

    // 1. Local subscription for instant in-tab updates
    localUnsubscribe = this.localRepo.subscribeToNotifications(cleanUid, (localNotifs) => {
      if (isDisposed) return;
      onUpdate(localNotifs);
    });

    // 2. Cloud Firestore realtime listener
    if (this.firebaseRepo.isAvailable()) {
      try {
        cloudUnsubscribe = this.firebaseRepo.subscribeToNotifications(
          cleanUid,
          (cloudNotifs) => {
            if (isDisposed) return;
            // Cache received items locally
            cloudNotifs.forEach((n) => {
              this.localRepo.createNotification(n).catch(() => {});
            });
            onUpdate(cloudNotifs);
          },
          (err) => {
            console.warn('[ResilientRepository] Realtime notification listener note:', err?.message || err);
            if (onError) onError(err);
          }
        );
      } catch (err) {
        console.warn('[ResilientRepository] Realtime notification listener setup note:', err);
        if (onError) onError(err);
      }
    }

    return () => {
      isDisposed = true;
      if (cloudUnsubscribe) {
        try {
          cloudUnsubscribe();
        } catch {}
      }
      if (localUnsubscribe) {
        try {
          localUnsubscribe();
        } catch {}
      }
    };
  }

  // =================== Appointments ===================
  async getAppointment(requestId: string): Promise<Appointment | null> {
    let cloudAppt: Appointment | null = null;
    if (this.firebaseRepo.isAvailable()) {
      try {
        cloudAppt = await this.firebaseRepo.getAppointment(requestId);
      } catch {}
    }
    const localAppt = await this.localRepo.getAppointment(requestId);
    return cloudAppt || localAppt;
  }

  async createAppointment(
    appointmentData: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Appointment> {
    const appt = await this.executeWithFallback(
      'createAppointment',
      () => this.firebaseRepo.createAppointment(appointmentData),
      () => this.localRepo.createAppointment(appointmentData)
    );

    // Also cache locally
    if (this.firebaseRepo.isAvailable()) {
      this.localRepo.createAppointment(appointmentData).catch(() => {});
    }

    // Trigger non-blocking notification
    this.getRequest(appt.requestId)
      .then((req) => {
        if (req) {
          notificationService.notifyAppointmentCreated(req, appt, appt.proposedBy).catch(() => {});
        }
      })
      .catch(() => {});

    return appt;
  }

  async updateAppointment(appointmentId: string, updates: Partial<Appointment>): Promise<Appointment> {
    const updated = await this.executeWithFallback(
      'updateAppointment',
      () => this.firebaseRepo.updateAppointment(appointmentId, updates),
      () => this.localRepo.updateAppointment(appointmentId, updates)
    );

    if (this.firebaseRepo.isAvailable()) {
      this.localRepo.updateAppointment(appointmentId, updates).catch(() => {});
    }

    return updated;
  }

  async cancelAppointment(
    appointmentId: string,
    cancelledByRole: 'customer' | 'provider',
    reason?: string
  ): Promise<Appointment> {
    const appt = await this.executeWithFallback(
      'cancelAppointment',
      () => this.firebaseRepo.cancelAppointment(appointmentId, cancelledByRole, reason),
      () => this.localRepo.cancelAppointment(appointmentId, cancelledByRole, reason)
    );

    if (this.firebaseRepo.isAvailable()) {
      this.localRepo.cancelAppointment(appointmentId, cancelledByRole, reason).catch(() => {});
    }

    // Trigger non-blocking notification
    this.getRequest(appt.requestId)
      .then((req) => {
        if (req) {
          notificationService
            .notifyAppointmentCancelled(req, appt, cancelledByRole, reason)
            .catch(() => {});
        }
      })
      .catch(() => {});

    return appt;
  }

  async confirmAppointment(
    appointmentId: string,
    confirmedByRole: 'customer' | 'provider'
  ): Promise<Appointment> {
    const appt = await this.executeWithFallback(
      'confirmAppointment',
      () => this.firebaseRepo.confirmAppointment(appointmentId, confirmedByRole),
      () => this.localRepo.confirmAppointment(appointmentId, confirmedByRole)
    );

    if (this.firebaseRepo.isAvailable()) {
      this.localRepo.confirmAppointment(appointmentId, confirmedByRole).catch(() => {});
    }

    // Trigger non-blocking notification
    this.getRequest(appt.requestId)
      .then((req) => {
        if (req) {
          notificationService
            .notifyAppointmentUpdated(req, appt, confirmedByRole, 'CONFIRMED')
            .catch(() => {});
        }
      })
      .catch(() => {});

    return appt;
  }

  async rescheduleAppointment(
    appointmentId: string,
    scheduledAt: string,
    proposedBy: 'customer' | 'provider',
    note?: string
  ): Promise<Appointment> {
    const appt = await this.executeWithFallback(
      'rescheduleAppointment',
      () => this.firebaseRepo.rescheduleAppointment(appointmentId, scheduledAt, proposedBy, note),
      () => this.localRepo.rescheduleAppointment(appointmentId, scheduledAt, proposedBy, note)
    );

    if (this.firebaseRepo.isAvailable()) {
      this.localRepo.rescheduleAppointment(appointmentId, scheduledAt, proposedBy, note).catch(() => {});
    }

    // Trigger non-blocking notification
    this.getRequest(appt.requestId)
      .then((req) => {
        if (req) {
          notificationService
            .notifyAppointmentUpdated(req, appt, proposedBy, 'RESCHEDULED')
            .catch(() => {});
        }
      })
      .catch(() => {});

    return appt;
  }

  async completeAppointment(appointmentId: string): Promise<Appointment> {
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    let appt: Appointment;
    if (this.firebaseRepo.isAvailable()) {
      try {
        appt = await this.firebaseRepo.completeAppointment(appointmentId);
        try {
          await this.localRepo.completeAppointment(appointmentId);
        } catch {}
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.startsWith('Unauthorized:')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] completeAppointment cloud note, falling back to local:', err?.message || err);
        appt = await this.localRepo.completeAppointment(appointmentId);
        offlineQueueService.enqueueMutation('completeAppointment', { appointmentId }, currentUid);
      }
    } else {
      appt = await this.localRepo.completeAppointment(appointmentId);
      offlineQueueService.enqueueMutation('completeAppointment', { appointmentId }, currentUid);
    }
    return appt;
  }

  async confirmCustomerCompletion(
    requestId: string,
    appointmentId?: string
  ): Promise<{ request: ServiceRequest; appointment?: Appointment }> {
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    if (this.firebaseRepo.isAvailable()) {
      try {
        const result = await this.firebaseRepo.confirmCustomerCompletion(requestId, appointmentId);
        try {
          if (result.appointment) {
            await this.localRepo.updateAppointment(result.appointment.id, result.appointment);
          }
          await this.localRepo.updateRequestStatus(requestId, 'COMPLETED');
        } catch {}
        return result;
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.startsWith('Unauthorized:')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] confirmCustomerCompletion cloud note, falling back to local:', err?.message || err);
        const localResult = await this.localRepo.confirmCustomerCompletion(requestId, appointmentId);
        if (appointmentId) {
          offlineQueueService.enqueueMutation('completeAppointment', { appointmentId }, currentUid);
        }
        return localResult;
      }
    }
    const localResult = await this.localRepo.confirmCustomerCompletion(requestId, appointmentId);
    if (appointmentId) {
      offlineQueueService.enqueueMutation('completeAppointment', { appointmentId }, currentUid);
    }
    return localResult;
  }

  async updateWorkStatus(
    appointmentId: string,
    workStatus: WorkStatus,
    providerUserId: string
  ): Promise<Appointment> {
    const currentUid = auth?.currentUser?.uid || getCurrentUserId();
    let appt: Appointment;
    if (this.firebaseRepo.isAvailable()) {
      try {
        appt = await this.firebaseRepo.updateWorkStatus(appointmentId, workStatus, providerUserId);
        try {
          await this.localRepo.updateWorkStatus(appointmentId, workStatus, providerUserId);
        } catch {}
      } catch (err: any) {
        if (
          err?.message?.startsWith('Validation Error:') ||
          err?.message?.startsWith('Unauthorized:') ||
          err?.message?.includes('Invalid work status transition')
        ) {
          throw err;
        }
        console.warn('[ResilientRepository] updateWorkStatus cloud note, falling back to local:', err?.message || err);
        appt = await this.localRepo.updateWorkStatus(appointmentId, workStatus, providerUserId);
        offlineQueueService.enqueueMutation('updateWorkStatus', { appointmentId, workStatus, providerUserId }, currentUid);
      }
    } else {
      appt = await this.localRepo.updateWorkStatus(appointmentId, workStatus, providerUserId);
      offlineQueueService.enqueueMutation('updateWorkStatus', { appointmentId, workStatus, providerUserId }, currentUid);
    }

    // Trigger non-blocking customer notification
    this.getRequest(appt.requestId)
      .then((req) => {
        if (req) {
          notificationService
            .notifyWorkStatusUpdated(req, appt, workStatus)
            .catch(() => {});
        }
      })
      .catch(() => {});

    return appt;
  }

  subscribeToAppointment(
    requestId: string,
    onUpdate: (appointment: Appointment | null) => void,
    onError?: (error: any) => void
  ): () => void {
    const cleanReqId = (requestId || '').trim();
    if (!cleanReqId) {
      return () => {};
    }

    let isDisposed = false;
    let cloudUnsubscribe: (() => void) | null = null;
    let localUnsubscribe: (() => void) | null = null;

    // 1. Local subscription for instant tab responsiveness
    localUnsubscribe = this.localRepo.subscribeToAppointment(cleanReqId, (localAppt) => {
      if (isDisposed) return;
      onUpdate(localAppt);
    });

    // 2. Cloud Firestore realtime listener
    if (this.firebaseRepo.isAvailable()) {
      try {
        cloudUnsubscribe = this.firebaseRepo.subscribeToAppointment(
          cleanReqId,
          (cloudAppt) => {
            if (isDisposed) return;
            onUpdate(cloudAppt);
          },
          (err) => {
            console.warn('[ResilientRepository] Realtime appointment listener note:', err?.message || err);
            if (onError) onError(err);
          }
        );
      } catch (err) {
        console.warn('[ResilientRepository] Realtime appointment listener init note:', err);
        if (onError) onError(err);
      }
    }

    return () => {
      isDisposed = true;
      if (cloudUnsubscribe) {
        try {
          cloudUnsubscribe();
        } catch {}
      }
      if (localUnsubscribe) {
        try {
          localUnsubscribe();
        } catch {}
      }
    };
  }
}

export const resilientRepository = new ResilientRepository();
