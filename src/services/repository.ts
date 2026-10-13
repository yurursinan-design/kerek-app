import {
  Appointment,
  AppNotification,
  ChatAttachment,
  ChatMessage,
  Conversation,
  Provider,
  ProviderOffer,
  RequestAttachment,
  RequestStatus,
  Review,
  ServiceRequest,
  User,
  WorkStatus,
} from '../types';

export interface RequestFilter {
  customerId?: string;
  city?: string;
  cityId?: string;
  category?: string;
  categoryId?: string;
}

export interface ProviderFilter {
  city?: string;
  cityId?: string;
  category?: string;
  categoryId?: string;
}

export interface OfferFilter {
  requestId?: string;
  providerId?: string;
  providerUserId?: string;
}

export interface ReviewFilter {
  providerId?: string;
  requestId?: string;
}

export interface Repository {
  // Users
  createUser(userData: Partial<User>): Promise<User>;
  getUser(userId: string): Promise<User | null>;

  // Providers
  createProvider(providerData: Partial<Provider>): Promise<Provider>;
  getProvider(providerId: string): Promise<Provider | null>;
  getProviders(filter?: ProviderFilter): Promise<Provider[]>;

  // Requests
  createRequest(requestData: Partial<ServiceRequest>): Promise<ServiceRequest>;
  getRequest(requestId: string): Promise<ServiceRequest | null>;
  getRequests(filter?: RequestFilter): Promise<ServiceRequest[]>;
  subscribeToRequests(
    filter: RequestFilter,
    onData: (requests: ServiceRequest[]) => void,
    onError?: (error: any) => void
  ): () => void;
  /** Calls onChange whenever the request or one of its offers changes (live updates on its screen). */
  watchRequestActivity(requestId: string, onChange: () => void): () => void;
  updateRequest(requestId: string, updates: Partial<ServiceRequest>): Promise<ServiceRequest | null>;
  updateRequestStatus(
    requestId: string,
    status: RequestStatus,
    selectedOfferId?: string
  ): Promise<ServiceRequest | null>;
  uploadRequestAttachment(
    requestId: string,
    file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string },
    customerId?: string,
    slot?: number
  ): Promise<RequestAttachment>;

  // Offers
  createOffer(offerData: Partial<ProviderOffer>): Promise<ProviderOffer>;
  getOffers(filter?: OfferFilter): Promise<ProviderOffer[]>;
  /** Number of offers on a request, without downloading them */
  countOffers(requestId: string): Promise<number>;
  updateOffer(offerId: string, updates: Partial<ProviderOffer>): Promise<ProviderOffer | null>;
  acceptOffer(requestId: string, offerId: string): Promise<{ request: ServiceRequest | null; offer: ProviderOffer | null }>;

  // Reviews
  createReview(reviewData: Partial<Review>): Promise<Review>;
  getReviews(filter?: ReviewFilter): Promise<Review[]>;

  // Matching
  matchProviders(request: ServiceRequest): Promise<Provider[]>;

  // Conversations & In-App Chat
  getConversation(conversationId: string): Promise<Conversation | null>;
  getOrCreateConversation(requestId: string): Promise<Conversation>;
  getMessages(conversationId: string, limitCount?: number): Promise<ChatMessage[]>;
  sendMessage(conversationId: string, messageData: Partial<ChatMessage>): Promise<ChatMessage>;
  uploadChatAttachment(
    conversationId: string,
    file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string }
  ): Promise<ChatAttachment>;
  sendChatMessageWithAttachment(
    conversationId: string,
    messageData: {
      text?: string;
      senderId?: string;
      senderRole?: 'customer' | 'provider';
      file: { name: string; size: number; type: string; data?: Blob | ArrayBuffer | Uint8Array | string };
    }
  ): Promise<ChatMessage>;
  markMessagesAsRead(conversationId: string): Promise<void>;
  subscribeToMessages(
    conversationId: string,
    onUpdate: (messages: ChatMessage[]) => void,
    onError?: (error: any) => void
  ): () => void;

  // In-App Notifications
  createNotification(notificationData: AppNotification): Promise<AppNotification>;
  getNotifications(userId: string, limitCount?: number): Promise<AppNotification[]>;
  markNotificationAsRead(notificationId: string): Promise<void>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  subscribeToNotifications(
    userId: string,
    onUpdate: (notifications: AppNotification[]) => void,
    onError?: (error: any) => void
  ): () => void;

  // Appointments
  getAppointment(requestId: string): Promise<Appointment | null>;
  createAppointment(appointmentData: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Appointment>;
  updateAppointment(appointmentId: string, updates: Partial<Appointment>): Promise<Appointment>;
  cancelAppointment(appointmentId: string, cancelledByRole: 'customer' | 'provider', reason?: string): Promise<Appointment>;
  confirmAppointment(appointmentId: string, confirmedByRole: 'customer' | 'provider'): Promise<Appointment>;
  rescheduleAppointment(appointmentId: string, scheduledAt: string, proposedBy: 'customer' | 'provider', note?: string): Promise<Appointment>;
  completeAppointment(appointmentId: string): Promise<Appointment>;
  confirmCustomerCompletion(
    requestId: string,
    appointmentId?: string
  ): Promise<{ request: ServiceRequest; appointment?: Appointment }>;
  updateWorkStatus(
    appointmentId: string,
    workStatus: WorkStatus,
    providerUserId: string
  ): Promise<Appointment>;
  subscribeToAppointment(
    requestId: string,
    onUpdate: (appointment: Appointment | null) => void,
    onError?: (error: any) => void
  ): () => void;
}
