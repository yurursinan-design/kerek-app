import { auth } from './firebase';
import { firebaseRepository } from './firebaseRepository';
import { getCurrentUserId, generateUUID } from './localRepository';
import { WorkStatus, ProviderOffer } from '../types';

export type MutationType =
  | 'createRequest'
  | 'updateRequest'
  | 'updateRequestStatus'
  | 'createOffer'
  | 'updateOffer'
  | 'sendMessage'
  | 'updateWorkStatus'
  | 'completeAppointment'
  | 'createReview'
  | 'createAppointment'
  | 'updateAppointment'
  | 'cancelAppointment'
  | 'confirmAppointment'
  | 'rescheduleAppointment';

export type MutationStatus = 'PENDING' | 'SYNCING' | 'FAILED_RETRYABLE' | 'FAILED_FATAL' | 'FAILED_PERMANENT';

export interface QueuedMutation {
  id: string;
  idempotencyKey: string;
  type: MutationType;
  payload: any;
  clientTimestamp: string;
  authUid: string;
  retryCount: number;
  status: MutationStatus;
  lastError?: string;
  nextRetryAt?: number;
}

const STORAGE_KEY_QUEUE = 'kerek_mutation_queue_v1';
const MAX_RETRIES = 5;

const WORK_STATUS_RANK: Record<string, number> = {
  NOT_STARTED: 0,
  PROVIDER_ON_THE_WAY: 1,
  PROVIDER_ARRIVED: 2,
  WORK_STARTED: 3,
  WORK_COMPLETED: 4,
};

const REQUEST_STATUS_RANK: Record<string, number> = {
  OPEN: 1,
  NEW: 1,
  MATCHING: 1,
  OFFERS_RECEIVED: 1,
  PROVIDER_SELECTED: 2,
  ACCEPTED: 2,
  IN_PROGRESS: 3,
  COMPLETED: 4,
  CANCELLED: 4,
};

export function isFatalError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const code = (err.code || '').toLowerCase();
  return (
    msg.includes('permission') ||
    msg.includes('unauthorized') ||
    msg.includes('validation error:') ||
    msg.includes('not found') ||
    msg.includes('already been accepted') ||
    msg.includes('no longer pending') ||
    msg.includes('cannot edit') ||
    msg.includes('cannot update') ||
    msg.includes('cannot complete') ||
    msg.includes('cancelled') ||
    code === 'permission-denied' ||
    code === 'invalid-argument' ||
    code === 'not-found'
  );
}

let memoryQueueStore: QueuedMutation[] = [];

export class OfflineQueueService {
  private isProcessing = false;
  private listeners: Set<(queue: QueuedMutation[]) => void> = new Set();
  private autoSyncInterval: any = null;

  constructor() {
    // A change that was being sent when the page closed is still waiting: send it again
    try {
      const queue = this.getQueue();
      if (queue.some((m) => m.status === 'SYNCING')) {
        this.saveQueue(queue.map((m) => (m.status === 'SYNCING' ? { ...m, status: 'PENDING' as MutationStatus } : m)));
      }
    } catch {}
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[OfflineQueue] Network re-established (online event). Processing queue...');
        this.processQueue().catch((e) => console.warn('[OfflineQueue] Reconnect sync note:', e));
      });

      // Periodic check every 15 seconds if online
      this.autoSyncInterval = setInterval(() => {
        if (this.isOnline()) {
          const pending = this.getQueue().filter(
            (m) =>
              m.status === 'PENDING' ||
              (m.status === 'FAILED_RETRYABLE' && (!m.nextRetryAt || m.nextRetryAt <= Date.now()))
          );
          if (pending.length > 0) {
            this.processQueue().catch(() => {});
          }
        }
      }, 15000);
    }
  }

  public isOnline(): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  public getQueue(): QueuedMutation[] {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY_QUEUE);
        if (!raw) return [];
        return JSON.parse(raw);
      }
      return memoryQueueStore;
    } catch {
      return memoryQueueStore;
    }
  }

  private saveQueue(queue: QueuedMutation[]): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(queue));
      } else {
        memoryQueueStore = queue;
      }
    } catch (e) {
      memoryQueueStore = queue;
    }
    this.notifyListeners();
  }

  public clearQueue(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY_QUEUE);
      }
    } catch {}
    memoryQueueStore = [];
    this.notifyListeners();
  }

  /** "Retry" on the warning: failed changes go back to waiting and are sent again. */
  public async retryFailed(): Promise<void> {
    const queue = this.getQueue().map((m) =>
      m.status === 'FAILED_FATAL' ? { ...m, status: 'PENDING' as MutationStatus, nextRetryAt: undefined } : m
    );
    this.saveQueue(queue);
    await this.processQueue();
  }

  /** "Close" on the warning: changes that can't be sent are dropped. */
  public dismissFailed(): void {
    this.saveQueue(this.getQueue().filter((m) => m.status !== 'FAILED_FATAL' && m.status !== 'FAILED_PERMANENT'));
  }

  public removeMutation(id: string): void {
    const queue = this.getQueue().filter((m) => m.id !== id);
    this.saveQueue(queue);
  }

  public subscribeToQueueChange(listener: (queue: QueuedMutation[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getQueue());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const queue = this.getQueue();
    this.listeners.forEach((listener) => {
      try {
        listener(queue);
      } catch (e) {
        console.warn('[OfflineQueue] Listener error:', e);
      }
    });
  }

  public enqueueMutation(
    type: MutationType,
    payload: any,
    customAuthUid?: string
  ): QueuedMutation {
    if ((type as string) === 'acceptOffer') {
      throw new Error('ACCEPT_OFFER_REQUIRES_ONLINE_EXECUTION');
    }

    const authUid = customAuthUid || auth?.currentUser?.uid || getCurrentUserId();
    const id = `mut_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const idempotencyKey =
      payload?.idempotencyKey ||
      payload?.id ||
      payload?.requestId ||
      payload?.offerId ||
      generateUUID();

    const mutation: QueuedMutation = {
      id,
      idempotencyKey,
      type,
      payload,
      clientTimestamp: new Date().toISOString(),
      authUid,
      retryCount: 0,
      status: 'PENDING',
    };

    const queue = this.getQueue();
    queue.push(mutation);
    this.saveQueue(queue);

    console.log(`[OfflineQueue] Enqueued mutation ${mutation.id} (${type}) for authUid ${authUid}`);

    if (this.isOnline() && firebaseRepository?.isAvailable?.()) {
      this.processQueue().catch((e) =>
        console.warn('[OfflineQueue] Immediate enqueue process note:', e)
      );
    }

    return mutation;
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    if (!this.isOnline() || !firebaseRepository?.isAvailable?.()) return;

    this.isProcessing = true;

    try {
      const queue = this.getQueue();
      const now = Date.now();

      const eligible = queue.filter(
        (m) =>
          (m.status === 'PENDING' || m.status === 'FAILED_RETRYABLE') &&
          (!m.nextRetryAt || m.nextRetryAt <= now)
      );

      if (eligible.length === 0) {
        this.isProcessing = false;
        return;
      }

      const currentUid = auth?.currentUser?.uid || getCurrentUserId();

      for (const item of eligible) {
        // Ownership validation check
        if (item.authUid && currentUid && item.authUid !== currentUid) {
          console.warn(
            `[OfflineQueue] Skipping mutation ${item.id} (${item.type}) - authUid mismatch (current: ${currentUid}, queued: ${item.authUid})`
          );
          continue;
        }

        // Mark status as SYNCING
        let updatedQueue = this.getQueue();
        const itemIdx = updatedQueue.findIndex((m) => m.id === item.id);
        if (itemIdx === -1) continue;

        updatedQueue[itemIdx].status = 'SYNCING';
        this.saveQueue(updatedQueue);

        try {
          let skippedAsStale = false;

          // Replay operation with idempotency and stale mutation protections
          switch (item.type) {
            case 'createRequest': {
              await firebaseRepository.createRequest(item.payload);
              break;
            }
            case 'updateRequest': {
              const existing = await firebaseRepository.getRequest(item.payload.requestId);
              if (existing) {
                const normStatus = (existing.status || '').toUpperCase();
                if (
                  normStatus === 'PROVIDER_SELECTED' ||
                  normStatus === 'ACCEPTED' ||
                  normStatus === 'COMPLETED' ||
                  normStatus === 'CANCELLED'
                ) {
                  console.log(
                    `[OfflineQueue] Stale updateRequest skipped: request is in status ${existing.status}`
                  );
                  skippedAsStale = true;
                  break;
                }
              }
              await firebaseRepository.updateRequest(item.payload.requestId, item.payload.updates);
              break;
            }
            case 'updateRequestStatus': {
              const existing = await firebaseRepository.getRequest(item.payload.requestId);
              if (existing) {
                const currentRank = REQUEST_STATUS_RANK[existing.status] || 0;
                const targetRank = REQUEST_STATUS_RANK[item.payload.status] || 0;
                if (currentRank >= targetRank) {
                  console.log(
                    `[OfflineQueue] Stale updateRequestStatus skipped: server at ${existing.status}, target ${item.payload.status}`
                  );
                  skippedAsStale = true;
                  break;
                }
              }
              await firebaseRepository.updateRequestStatus(
                item.payload.requestId,
                item.payload.status,
                item.payload.selectedOfferId
              );
              break;
            }
            case 'createOffer': {
              await firebaseRepository.createOffer(item.payload);
              break;
            }
            case 'updateOffer': {
              const offerId = item.payload.offerId;
              const reqIdHint = item.payload.updates?.requestId;
              let existingOffer: ProviderOffer | null = null;
              if (reqIdHint) {
                const offers = await firebaseRepository.getOffers({ requestId: reqIdHint });
                existingOffer = offers.find((o) => o.id === offerId) || null;
              } else {
                const offers = await firebaseRepository.getOffers();
                existingOffer = offers.find((o) => o.id === offerId) || null;
              }
              if (existingOffer) {
                if (existingOffer.status === 'ACCEPTED' || existingOffer.status === 'REJECTED') {
                  console.log(
                    `[OfflineQueue] Stale updateOffer skipped: offer is in status ${existingOffer.status}`
                  );
                  skippedAsStale = true;
                  break;
                }
                const reqId = existingOffer.requestId;
                if (reqId) {
                  const parentReq = await firebaseRepository.getRequest(reqId);
                  if (parentReq) {
                    const normStatus = (parentReq.status || '').toUpperCase();
                    if (
                      normStatus === 'PROVIDER_SELECTED' ||
                      normStatus === 'ACCEPTED' ||
                      normStatus === 'COMPLETED' ||
                      normStatus === 'CANCELLED'
                    ) {
                      console.log(
                        `[OfflineQueue] Stale updateOffer skipped: request is in status ${parentReq.status}`
                      );
                      skippedAsStale = true;
                      break;
                    }
                  }
                }
              }
              await firebaseRepository.updateOffer(item.payload.offerId, item.payload.updates);
              break;
            }
            case 'acceptOffer' as any: {
              console.warn(`[OfflineQueue] Legacy acceptOffer mutation ${item.id} rejected: ACCEPT_OFFER_REQUIRES_ONLINE_EXECUTION`);
              updatedQueue = this.getQueue();
              const idx = updatedQueue.findIndex((m) => m.id === item.id);
              if (idx !== -1) {
                updatedQueue[idx].status = 'FAILED_PERMANENT';
                updatedQueue[idx].lastError = 'ACCEPT_OFFER_REQUIRES_ONLINE_EXECUTION';
                this.saveQueue(updatedQueue);
              }
              continue;
            }
            case 'sendMessage': {
              await firebaseRepository.sendMessage(
                item.payload.conversationId,
                item.payload.messageData
              );
              break;
            }
            case 'updateWorkStatus': {
              const apptId = item.payload.appointmentId || item.payload.requestId;
              const existingAppt = await firebaseRepository.getAppointment(apptId);
              if (existingAppt) {
                if (existingAppt.status === 'CANCELLED') {
                  console.log(`[OfflineQueue] Stale updateWorkStatus skipped: appointment is CANCELLED`);
                  skippedAsStale = true;
                  break;
                }
                const currentRank = WORK_STATUS_RANK[existingAppt.workStatus || 'NOT_STARTED'] || 0;
                const targetRank = WORK_STATUS_RANK[item.payload.workStatus || 'NOT_STARTED'] || 0;
                if (currentRank >= targetRank) {
                  console.log(
                    `[OfflineQueue] Stale updateWorkStatus skipped: server at ${existingAppt.workStatus}, target ${item.payload.workStatus}`
                  );
                  skippedAsStale = true;
                  break;
                }
              }
              await firebaseRepository.updateWorkStatus(
                item.payload.appointmentId,
                item.payload.workStatus,
                item.payload.providerUserId
              );
              break;
            }
            case 'completeAppointment': {
              const appt = await firebaseRepository.getAppointment(item.payload.appointmentId);
              if (
                appt &&
                (appt.status === 'COMPLETED' ||
                  appt.status === 'CANCELLED' ||
                  appt.workStatus === 'WORK_COMPLETED')
              ) {
                console.log(
                  `[OfflineQueue] Stale completeAppointment skipped: appt status is ${appt.status}`
                );
                skippedAsStale = true;
                break;
              }
              await firebaseRepository.completeAppointment(item.payload.appointmentId);
              break;
            }
            case 'createReview': {
              await firebaseRepository.createReview(item.payload);
              break;
            }
            case 'createAppointment': {
              await firebaseRepository.createAppointment(item.payload);
              break;
            }
            case 'updateAppointment': {
              await firebaseRepository.updateAppointment(
                item.payload.appointmentId,
                item.payload.updates
              );
              break;
            }
            case 'cancelAppointment': {
              await firebaseRepository.cancelAppointment(
                item.payload.appointmentId,
                item.payload.cancelledByRole,
                item.payload.reason
              );
              break;
            }
            case 'confirmAppointment': {
              await firebaseRepository.confirmAppointment(
                item.payload.appointmentId,
                item.payload.confirmedByRole
              );
              break;
            }
            case 'rescheduleAppointment': {
              await firebaseRepository.rescheduleAppointment(
                item.payload.appointmentId,
                item.payload.scheduledAt,
                item.payload.proposedBy,
                item.payload.note
              );
              break;
            }
            default: {
              console.warn(`[OfflineQueue] Unknown mutation type: ${(item as any).type}`);
            }
          }

          // Replay or stale skip succeeded -> remove from queue
          updatedQueue = this.getQueue().filter((m) => m.id !== item.id);
          this.saveQueue(updatedQueue);
          console.log(
            `[OfflineQueue] Successfully synced mutation ${item.id} (${item.type})${
              skippedAsStale ? ' [stale skipped]' : ''
            }`
          );
        } catch (err: any) {
          const fatal = isFatalError(err);
          const errMsg = err?.message || String(err);

          updatedQueue = this.getQueue();
          const targetIdx = updatedQueue.findIndex((m) => m.id === item.id);
          if (targetIdx !== -1) {
            if (fatal) {
              console.warn(
                `[OfflineQueue] Fatal error for mutation ${item.id} (${item.type}): ${errMsg}`
              );
              updatedQueue[targetIdx].status = 'FAILED_FATAL';
              updatedQueue[targetIdx].lastError = errMsg;
            } else {
              const currentRetry = (updatedQueue[targetIdx].retryCount || 0) + 1;
              updatedQueue[targetIdx].retryCount = currentRetry;
              if (currentRetry >= MAX_RETRIES) {
                console.warn(
                  `[OfflineQueue] Max retries (${MAX_RETRIES}) reached for mutation ${item.id} (${item.type}): ${errMsg}`
                );
                updatedQueue[targetIdx].status = 'FAILED_FATAL';
                updatedQueue[targetIdx].lastError = `Max retries reached: ${errMsg}`;
              } else {
                const backoffMs = Math.pow(2, currentRetry) * 1000;
                updatedQueue[targetIdx].status = 'FAILED_RETRYABLE';
                updatedQueue[targetIdx].lastError = errMsg;
                updatedQueue[targetIdx].nextRetryAt = Date.now() + backoffMs;
                console.warn(
                  `[OfflineQueue] Transient error for mutation ${item.id} (${item.type}) [attempt ${currentRetry}/${MAX_RETRIES}], retrying in ${backoffMs}ms: ${errMsg}`
                );
              }
            }
            this.saveQueue(updatedQueue);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

export const offlineQueueService = new OfflineQueueService();
