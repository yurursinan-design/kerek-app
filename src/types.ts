export type Language = 'kz' | 'ru';

export type Urgency = 'high' | 'normal' | 'low';

export type RequestStatus =
  // Primary status system
  | 'OPEN'
  | 'PROVIDER_SELECTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  // Backward compatibility legacy statuses
  | 'NEW'
  | 'MATCHING'
  | 'OFFERS_RECEIVED'
  | 'ACCEPTED'
  | 'REJECTED';

/**
 * Normalizes any legacy or variant status to one of the 5 canonical request statuses:
 * 1. OPEN — new request, awaiting provider offers (maps 'OPEN', 'NEW', 'MATCHING', 'OFFERS_RECEIVED')
 * 2. PROVIDER_SELECTED — customer selected a provider (maps 'PROVIDER_SELECTED', 'ACCEPTED')
 * 3. IN_PROGRESS — job is ongoing
 * 4. COMPLETED — job is completed
 * 5. CANCELLED — request is cancelled (maps 'CANCELLED', 'REJECTED')
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

export interface User {
  id: string; // UUID
  role?: 'customer' | 'provider' | 'both';
  name?: string;
  phone?: string;
  createdAt: string;
}

export interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  mediaType: 'image' | 'video' | 'audio';
  previewUrl: string;
  file?: Blob | File;
  base64Data?: string;
  durationSeconds?: number;
}

export type UnderstandingUrgency = 'low' | 'normal' | 'high' | 'emergency';

export interface RequestUnderstanding {
  city?: string;
  cityId?: string;

  category?: string;
  categoryId?: string;

  service?: string;

  description: string;

  urgency?: UnderstandingUrgency;

  preferredDate?: string;
  preferredTime?: string;

  detectedBrand?: string;
  detectedModel?: string;

  detectedProblem?: string;

  userIntent?: string;

  attachmentsPresent: {
    images: number;
    videos: number;
    audios: number;
  };

  hasLocation: boolean;

  missingInformation: string[];

  clarificationNeeded: boolean;

  suggestedQuestions?: string[];

  confidence: number;
}

export interface ExtractedNeed {
  city: string;
  cityId?: string;
  category: string;
  categoryId?: string;
  service: string;
  date: string;
  budget: string;
  urgency: Urgency;
  originalQuery: string;
  confidence?: number;
  isAiParsed?: boolean;
  aiError?: string | null;
  attachments?: RequestAttachment[];
  pendingAttachments?: PendingAttachment[];
  location?: RequestLocation;
  understanding?: RequestUnderstanding;
}

export interface RequestAttachment {
  id: string;
  type: 'image' | 'video' | 'audio';
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface RequestLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
}

export interface ServiceRequest {
  id: string; // e.g. REQ-000001
  customerId: string; // User ID of creator
  customerName: string;
  customerPhone?: string; // Kept private, not exposed to providers
  requestText: string;
  description?: string; // Compatible alias for requestText in Firestore
  city: string;
  cityId?: string;
  category: string;
  categoryId?: string;
  service: string;
  date: string;
  budget: string;
  urgency: Urgency;
  status: RequestStatus;
  createdAt: string;
  selectedOfferId?: string;
  attachments?: RequestAttachment[];
  location?: RequestLocation;
  understanding?: RequestUnderstanding;
}

export type OfferPriceType = 'fixed' | 'from' | 'inspection';

export interface ProviderOffer {
  id: string;
  requestId: string;
  providerId: string;
  providerUserId?: string;
  providerName: string;
  providerPhone: string;
  providerWhatsapp: string;
  isDemo?: boolean;
  price: string;
  priceType?: OfferPriceType;
  availability: string;
  message: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: string;
}

export interface Review {
  id: string; // directly requestId
  requestId: string;
  customerId: string;
  customerName: string;
  providerId: string;
  providerName: string;
  rating: number; // 1 to 5 integer
  comment?: string;
  createdAt: string;
}

/**
 * Formats offer price for customer-facing display according to language ('kz' | 'ru') and priceType:
 * - fixed: '15 000 ₸' (both KZ and RU)
 * - from: '10 000 ₸ бастап' (KZ), 'от 10 000 ₸' (RU)
 * - inspection: 'Қарап көрген соң' (KZ), 'После осмотра' (RU)
 * - legacy records without priceType: automatically detects inspection / from phrases or renders price as fixed.
 */
export function formatOfferDisplayPrice(
  offer?: Partial<ProviderOffer> | { price?: string; priceType?: OfferPriceType },
  language: Language = 'ru'
): string {
  if (!offer || !offer.price) return '';
  const priceType = offer.priceType;
  const rawPrice = offer.price.trim();

  // 1. Inspection after on-site check
  if (
    priceType === 'inspection' ||
    rawPrice === 'После осмотра' ||
    rawPrice === 'Қарап көрген соң' ||
    rawPrice.toLowerCase().includes('осмотр') ||
    rawPrice.toLowerCase().includes('көрген соң')
  ) {
    return language === 'kz' ? 'Қарап көрген соң' : 'После осмотра';
  }

  // Helper to extract numeric amount and format with standard spaces e.g. "10 000 ₸"
  const extractFormattedAmount = (str: string): string => {
    const digitsOnly = str.replace(/[^\d]/g, '');
    if (digitsOnly.length > 0) {
      const spaced = digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      return `${spaced} ₸`;
    }
    return str;
  };

  // 2. Starting from price
  if (
    priceType === 'from' ||
    rawPrice.toLowerCase().startsWith('от ') ||
    rawPrice.toLowerCase().endsWith('бастап')
  ) {
    const amount = extractFormattedAmount(rawPrice);
    if (language === 'kz') {
      return `${amount} бастап`;
    } else {
      return `от ${amount}`;
    }
  }

  // 3. Fixed price or legacy standard
  if (priceType === 'fixed') {
    return extractFormattedAmount(rawPrice);
  }

  // 4. Fallback for legacy records without priceType
  return rawPrice;
}

export interface Provider {
  id: string;
  userId?: string;
  name: string;
  phone: string;
  whatsapp: string;
  city: string;
  cityId?: string;
  district: string;
  category: string;
  categoryId?: string;
  services: string;
  priceRange: string;
  workingHours: string;
  description: string;
  experienceYears?: number;
  availability?: string;
  verified: boolean;
  isActive?: boolean;
  isDemo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DemoProvider {
  id: string;
  name: string;
  cityId?: string;
  category: string;
  categoryId?: string;
  service: string;
  approxPrice: string;
  distance: string;
  responseTime: string;
  city: string;
  rating: number;
  reviewsCount: number;
  phone: string;
  whatsapp: string;
  verified: boolean;
  addressSnippet: string;
  district?: string;
}

// =================== In-App Chat Models ===================

export interface Conversation {
  id: string; // Deterministic: "conv_${requestId}"
  requestId: string;

  customerId: string;
  customerName: string;

  providerId: string;
  providerUserId: string;
  providerName: string;

  status: 'ACTIVE' | 'ARCHIVED';

  lastMessageText: string;
  lastMessageSenderId: string;
  lastMessageAt: string;

  unreadCountCustomer: number;
  unreadCountProvider: number;

  createdAt: string;
  updatedAt: string;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'file'
  | 'system';

export interface ChatAttachment {
  id: string;
  type: 'image' | 'file';
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  requestId: string;

  senderId: string;
  senderRole: 'customer' | 'provider' | 'system';

  type: MessageType;
  text: string;

  attachments?: ChatAttachment[];

  isRead: boolean;
  readAt?: string | null;

  createdAt: string;
}

/**
 * Chat attachment validation constants and security limits
 */
export const CHAT_LIMITS = {
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024,  // 20 MB
  ALLOWED_IMAGE_MIMES: ['image/jpeg', 'image/png', 'image/webp'] as const,
  DISALLOWED_FILE_EXTENSIONS: [
    'exe', 'bat', 'cmd', 'sh', 'php', 'py', 'pl', 'jar', 'vbs', 'msi', 'com', 'scr', 'bin', 'ps1', 'apk'
  ] as const,
};

/**
 * Request 2.0 media limits and allowed MIME types
 */
export const REQUEST_LIMITS = {
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_VIDEO_SIZE_BYTES: 50 * 1024 * 1024, // 50 MB
  MAX_AUDIO_SIZE_BYTES: 20 * 1024 * 1024, // 20 MB
  ALLOWED_IMAGE_MIMES: ['image/jpeg', 'image/png', 'image/webp'] as const,
  ALLOWED_VIDEO_MIMES: ['video/mp4', 'video/webm', 'video/quicktime'] as const,
  ALLOWED_AUDIO_MIMES: [
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'audio/x-m4a',
    'audio/aac',
  ] as const,
  DISALLOWED_FILE_EXTENSIONS: [
    'exe', 'bat', 'cmd', 'sh', 'php', 'py', 'pl', 'jar', 'vbs', 'msi', 'com', 'scr', 'bin', 'ps1', 'apk', 'html', 'js'
  ] as const,
};

/**
 * Validates a request media attachment before upload
 */
export function validateRequestAttachment(
  file: { name: string; size: number; type: string },
  forcedType?: 'image' | 'video' | 'audio'
): { isValid: boolean; errorKey?: string; type: 'image' | 'video' | 'audio' } {
  const mime = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  // Guard against executable or dangerous extensions
  if ((REQUEST_LIMITS.DISALLOWED_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    return { isValid: false, errorKey: 'reqUnsupportedFileType', type: forcedType || 'image' };
  }

  const isImage = (REQUEST_LIMITS.ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime);
  const isVideo = (REQUEST_LIMITS.ALLOWED_VIDEO_MIMES as readonly string[]).includes(mime);
  const isAudio = (REQUEST_LIMITS.ALLOWED_AUDIO_MIMES as readonly string[]).includes(mime);

  let type: 'image' | 'video' | 'audio';
  if (forcedType) {
    type = forcedType;
  } else if (isImage) {
    type = 'image';
  } else if (isVideo) {
    type = 'video';
  } else if (isAudio) {
    type = 'audio';
  } else {
    return { isValid: false, errorKey: 'reqUnsupportedFileType', type: 'image' };
  }

  if (type === 'image') {
    if (!isImage) {
      return { isValid: false, errorKey: 'reqUnsupportedImageMime', type };
    }
    if (file.size > REQUEST_LIMITS.MAX_IMAGE_SIZE_BYTES) {
      return { isValid: false, errorKey: 'reqFileTooLarge', type };
    }
  } else if (type === 'video') {
    if (!isVideo) {
      return { isValid: false, errorKey: 'reqUnsupportedVideoMime', type };
    }
    if (file.size > REQUEST_LIMITS.MAX_VIDEO_SIZE_BYTES) {
      return { isValid: false, errorKey: 'reqFileTooLarge', type };
    }
  } else if (type === 'audio') {
    if (!isAudio) {
      return { isValid: false, errorKey: 'reqUnsupportedAudioMime', type };
    }
    if (file.size > REQUEST_LIMITS.MAX_AUDIO_SIZE_BYTES) {
      return { isValid: false, errorKey: 'reqFileTooLarge', type };
    }
  }

  return { isValid: true, type };
}

/**
 * Sanitizes a file name for safe storage and display
 */
export function sanitizeFileName(rawName: string): string {
  if (!rawName) return 'file';
  // Remove dangerous control characters and path traversal tokens
  const clean = rawName
    .replace(/[/\\]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/[^a-zA-Z0-9._\-а-яА-ЯёЁәіңғүұқөһӘІҢҒҮҰҚӨҺ ]/g, '_')
    .trim();
  return clean.slice(0, 100) || 'file';
}

/**
 * Validates a file/image attachment before upload
 */
export function validateChatAttachment(
  file: { name: string; size: number; type: string },
  forcedType?: 'image' | 'file'
): { isValid: boolean; errorKey?: string; type: 'image' | 'file' } {
  const isImageMime = (CHAT_LIMITS.ALLOWED_IMAGE_MIMES as readonly string[]).includes(file.type.toLowerCase());
  const type: 'image' | 'file' = forcedType || (isImageMime ? 'image' : 'file');

  if (type === 'image') {
    if (!isImageMime) {
      return { isValid: false, errorKey: 'chatUnsupportedImageMime', type };
    }
    if (file.size > CHAT_LIMITS.MAX_IMAGE_SIZE_BYTES) {
      return { isValid: false, errorKey: 'chatFileTooLarge', type };
    }
  } else {
    if (file.size > CHAT_LIMITS.MAX_FILE_SIZE_BYTES) {
      return { isValid: false, errorKey: 'chatFileTooLarge', type };
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if ((CHAT_LIMITS.DISALLOWED_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return { isValid: false, errorKey: 'chatUnsupportedFileType', type };
    }
  }

  return { isValid: true, type };
}

/**
 * Returns deterministic conversation ID for a given request.
 * Guaranteed idempotency: 1 Request = 1 Conversation.
 */
export function getConversationId(requestId: string): string {
  return `conv_${requestId.trim()}`;
}

// =================== Appointment Models ===================

export type AppointmentStatus =
  | 'PROPOSED'
  | 'CONFIRMED'
  | 'RESCHEDULED'
  | 'CANCELLED'
  | 'COMPLETED';

export type WorkStatus =
  | 'NOT_STARTED'
  | 'PROVIDER_ON_THE_WAY'
  | 'PROVIDER_ARRIVED'
  | 'WORK_STARTED'
  | 'WORK_COMPLETED'
  | 'CANCELLED';

export interface Appointment {
  id: string; // Deterministic: "appointment_${requestId}"
  requestId: string;
  customerId: string;
  providerId: string;
  providerUserId: string;

  proposedBy: 'customer' | 'provider';

  scheduledAt: string; // ISO 8601 string or readable datetime
  durationMinutes?: number;

  status: AppointmentStatus;

  note?: string;

  workStatus?: WorkStatus;
  workStatusUpdatedAt?: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * Validates strictly linear forward and cancellation transitions for WorkStatus.
 * Progression: NOT_STARTED -> PROVIDER_ON_THE_WAY -> PROVIDER_ARRIVED -> WORK_STARTED -> WORK_COMPLETED
 * Cancellation: From any state except WORK_COMPLETED or already CANCELLED -> CANCELLED
 * Terminal: WORK_COMPLETED cannot transition to CANCELLED or any other previous state.
 */
export function isValidWorkStatusTransition(
  current: WorkStatus | undefined,
  next: WorkStatus
): boolean {
  const from: WorkStatus = current || 'NOT_STARTED';
  if (from === next) return true; // Idempotent

  if (next === 'CANCELLED') {
    return from !== 'WORK_COMPLETED' && from !== 'CANCELLED';
  }

  switch (from) {
    case 'NOT_STARTED':
      return next === 'PROVIDER_ON_THE_WAY';
    case 'PROVIDER_ON_THE_WAY':
      return next === 'PROVIDER_ARRIVED';
    case 'PROVIDER_ARRIVED':
      return next === 'WORK_STARTED';
    case 'WORK_STARTED':
      return next === 'WORK_COMPLETED';
    case 'WORK_COMPLETED':
    case 'CANCELLED':
    default:
      return false;
  }
}

/**
 * Returns the next sequential linear work status in the flow.
 */
export function getNextWorkStatus(current: WorkStatus | undefined): WorkStatus | null {
  const from: WorkStatus = current || 'NOT_STARTED';
  switch (from) {
    case 'NOT_STARTED':
      return 'PROVIDER_ON_THE_WAY';
    case 'PROVIDER_ON_THE_WAY':
      return 'PROVIDER_ARRIVED';
    case 'PROVIDER_ARRIVED':
      return 'WORK_STARTED';
    case 'WORK_STARTED':
      return 'WORK_COMPLETED';
    default:
      return null;
  }
}

/**
 * Returns deterministic appointment ID for a given request.
 * Guaranteed idempotency: 1 Request = 1 active appointment document.
 */
export function getAppointmentId(requestId: string): string {
  return `appointment_${requestId.trim()}`;
}

// =================== Notification Models ===================

export type NotificationEventType =
  | 'CUSTOMER_NEW_OFFER'
  | 'CUSTOMER_OFFER_ACCEPTED'
  | 'CUSTOMER_NEW_MESSAGE'
  | 'CUSTOMER_NEW_ATTACHMENT'
  | 'CUSTOMER_WORK_COMPLETED'
  | 'CUSTOMER_REVIEW_REQUIRED'
  | 'CUSTOMER_APPOINTMENT_CREATED'
  | 'CUSTOMER_APPOINTMENT_UPDATED'
  | 'CUSTOMER_APPOINTMENT_CANCELLED'
  | 'CUSTOMER_PROVIDER_ON_THE_WAY'
  | 'CUSTOMER_PROVIDER_ARRIVED'
  | 'CUSTOMER_WORK_STARTED'
  | 'PROVIDER_WORK_STATUS_UPDATED'
  | 'PROVIDER_OFFER_ACCEPTED'
  | 'PROVIDER_NEW_MESSAGE'
  | 'PROVIDER_NEW_ATTACHMENT'
  | 'PROVIDER_REQUEST_CANCELLED'
  | 'PROVIDER_WORK_COMPLETED'
  | 'PROVIDER_APPOINTMENT_CREATED'
  | 'PROVIDER_APPOINTMENT_UPDATED'
  | 'PROVIDER_APPOINTMENT_CANCELLED';

export type NotificationTargetScreen =
  | 'request_detail'
  | 'chat'
  | 'offers_list'
  | 'review_modal';

export interface AppNotification {
  id: string; // Deterministic/idempotent: notif_offer_${offerId}, notif_msg_${messageId}, etc.
  recipientUserId: string;
  recipientRole: 'customer' | 'provider';
  type: NotificationEventType;

  title: {
    kz: string;
    ru: string;
  };

  body: {
    kz: string;
    ru: string;
  };

  requestId?: string;
  offerId?: string;
  conversationId?: string;
  providerId?: string;

  targetScreen: NotificationTargetScreen;

  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}
