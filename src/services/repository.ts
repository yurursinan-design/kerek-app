import {
  Provider,
  ProviderOffer,
  RequestStatus,
  Review,
  ServiceRequest,
  User,
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
  updateRequest(requestId: string, updates: Partial<ServiceRequest>): Promise<ServiceRequest | null>;
  updateRequestStatus(
    requestId: string,
    status: RequestStatus,
    selectedOfferId?: string
  ): Promise<ServiceRequest | null>;

  // Offers
  createOffer(offerData: Partial<ProviderOffer>): Promise<ProviderOffer>;
  getOffers(filter?: OfferFilter): Promise<ProviderOffer[]>;
  updateOffer(offerId: string, updates: Partial<ProviderOffer>): Promise<ProviderOffer | null>;
  acceptOffer(requestId: string, offerId: string): Promise<{ request: ServiceRequest | null; offer: ProviderOffer | null }>;

  // Reviews
  createReview(reviewData: Partial<Review>): Promise<Review>;
  getReviews(filter?: ReviewFilter): Promise<Review[]>;

  // Matching
  matchProviders(request: ServiceRequest): Promise<Provider[]>;
}
