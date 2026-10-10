/**
 * Bu dosya gelecekte özel bir cloud backend entegrasyonu için referans olarak saklanmaktadır. Şu anda aktif olarak kullanılmamaktadır. Gerçek Firebase entegrasyonu src/services/firebaseRepository.ts içindedir.
 *
 * Cloud Repository Placeholder
 *
 * IMPORTANT ARCHITECTURAL NOTE:
 * This is a clean placeholder prepared for the future Firebase / Supabase / Cloud backend integration.
 * DO NOT CONNECT PAID OR REAL SERVICES YET.
 *
 * When the project is ready for remote cloud persistence:
 * 1. Implement this class using the Firebase SDK or Supabase client.
 * 2. Connect Firestore/Postgres collections for `users`, `providers`, `requests`, and `offers`.
 * 3. `ResilientRepository` will then automatically route requests to this cloud implementation,
 *    and fall back to `LocalRepository` if the user is offline or if cloud is unreachable!
 */

import {
  Appointment,
  AppNotification,
  ChatAttachment,
  ChatMessage,
  Conversation,
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

export class CloudRepository implements Repository {
  private readonly isConfigured: boolean = false;

  constructor() {
    // Cloud backend (Firebase / Supabase) is deliberately unconfigured in this MVP stage
    this.isConfigured = false;
  }

  public isAvailable(): boolean {
    return this.isConfigured;
  }

  async createUser(_userData: Partial<User>): Promise<User> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getUser(_userId: string): Promise<User | null> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async createProvider(_providerData: Partial<Provider>): Promise<Provider> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getProvider(_providerId: string): Promise<Provider | null> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getProviders(_filter?: ProviderFilter): Promise<Provider[]> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async createRequest(_requestData: Partial<ServiceRequest>): Promise<ServiceRequest> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getRequest(_requestId: string): Promise<ServiceRequest | null> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getRequests(_filter?: RequestFilter): Promise<ServiceRequest[]> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  subscribeToRequests(
    _filter: RequestFilter,
    _onData: (requests: ServiceRequest[]) => void,
    _onError?: (error: any) => void
  ): () => void {
    return () => {};
  }

  async updateRequest(
    _requestId: string,
    _updates: Partial<ServiceRequest>
  ): Promise<ServiceRequest | null> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async updateRequestStatus(
    _requestId: string,
    _status: RequestStatus,
    _selectedOfferId?: string
  ): Promise<ServiceRequest | null> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async uploadRequestAttachment(
    _requestId: string,
    _file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string },
    _customerId?: string
  ): Promise<RequestAttachment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async createOffer(_offerData: Partial<ProviderOffer>): Promise<ProviderOffer> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getOffers(_filter?: OfferFilter): Promise<ProviderOffer[]> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async updateOffer(
    _offerId: string,
    _updates: Partial<ProviderOffer>
  ): Promise<ProviderOffer | null> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async acceptOffer(
    _requestId: string,
    _offerId: string
  ): Promise<{ request: ServiceRequest | null; offer: ProviderOffer | null }> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async createReview(_reviewData: Partial<Review>): Promise<Review> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getReviews(_filter?: ReviewFilter): Promise<Review[]> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async matchProviders(_request: ServiceRequest): Promise<Provider[]> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getConversation(_conversationId: string): Promise<Conversation | null> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getOrCreateConversation(_requestId: string): Promise<Conversation> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getMessages(_conversationId: string, _limitCount?: number): Promise<ChatMessage[]> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async sendMessage(
    _conversationId: string,
    _messageData: Partial<ChatMessage>
  ): Promise<ChatMessage> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async uploadChatAttachment(
    _conversationId: string,
    _file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string }
  ): Promise<ChatAttachment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async sendChatMessageWithAttachment(
    _conversationId: string,
    _messageData: {
      text?: string;
      senderId?: string;
      senderRole?: 'customer' | 'provider';
      file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string };
    }
  ): Promise<ChatMessage> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async markMessagesAsRead(_conversationId: string): Promise<void> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  subscribeToMessages(
    _conversationId: string,
    _onUpdate: (messages: ChatMessage[]) => void
  ): () => void {
    return () => {};
  }

  // In-App Notifications
  async createNotification(_notificationData: AppNotification): Promise<AppNotification> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async getNotifications(_userId: string, _limitCount?: number): Promise<AppNotification[]> {
    return [];
  }

  async markNotificationAsRead(_notificationId: string): Promise<void> {}

  async markAllNotificationsAsRead(_userId: string): Promise<void> {}

  subscribeToNotifications(
    _userId: string,
    _onUpdate: (notifications: AppNotification[]) => void,
    _onError?: (error: any) => void
  ): () => void {
    return () => {};
  }

  // Appointments
  async getAppointment(_requestId: string): Promise<Appointment | null> {
    return null;
  }

  async createAppointment(
    _appointmentData: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Appointment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async updateAppointment(
    _appointmentId: string,
    _updates: Partial<Appointment>
  ): Promise<Appointment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async cancelAppointment(
    _appointmentId: string,
    _cancelledByRole: 'customer' | 'provider',
    _reason?: string
  ): Promise<Appointment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async confirmAppointment(
    _appointmentId: string,
    _confirmedByRole: 'customer' | 'provider'
  ): Promise<Appointment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async rescheduleAppointment(
    _appointmentId: string,
    _scheduledAt: string,
    _proposedBy: 'customer' | 'provider',
    _note?: string
  ): Promise<Appointment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async completeAppointment(
    _appointmentId: string
  ): Promise<Appointment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async confirmCustomerCompletion(
    _requestId: string,
    _appointmentId?: string
  ): Promise<{ request: ServiceRequest; appointment?: Appointment }> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  async updateWorkStatus(
    _appointmentId: string,
    _workStatus: WorkStatus,
    _providerUserId: string
  ): Promise<Appointment> {
    throw new Error('CloudRepository is not configured yet. Fallback to LocalRepository.');
  }

  subscribeToAppointment(
    _requestId: string,
    _onUpdate: (appointment: Appointment | null) => void,
    _onError?: (error: any) => void
  ): () => void {
    return () => {};
  }
}

export const cloudRepository = new CloudRepository();
