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
