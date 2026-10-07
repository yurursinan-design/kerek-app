/**
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
}

export const cloudRepository = new CloudRepository();
