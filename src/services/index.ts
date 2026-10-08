import { Repository } from './repository';
import { resilientRepository, ResilientRepository } from './resilientRepository';
import { firebaseRepository, FirebaseRepository } from './firebaseRepository';
import { localRepository, getCurrentUserId, generateUUID } from './localRepository';
import { isFirebaseConfigured, ensureFirebaseAuth, runFirebaseDiagnostics, getLatestDiagnosticReport } from './firebase';

// Single data access layer for all UI components.
// ResilientRepository automatically delegates to cloud when configured,
// and gracefully falls back to LocalRepository when offline or unconfigured.
export const repository: Repository = resilientRepository;

// Export repositories
export { localRepository, firebaseRepository, resilientRepository, isFirebaseConfigured, ensureFirebaseAuth, runFirebaseDiagnostics, getLatestDiagnosticReport };
export type { ResilientRepository, FirebaseRepository };

// User Identification
export { getCurrentUserId, generateUUID };

// Error Handling & Validation
export { getFriendlyErrorMessage, logTechnicalError } from './errorHandler';
export { checkClientRateLimit, resetClientRateLimit } from './rateLimiter';
export { exportLocalData, importLocalData } from './backupService';
export { validateRequestData, validateProviderData, validateOfferData, validateReviewData } from './validation';
export { matchProviders } from './matchingService';

// AI Request Parser & Request Understanding 2.0
export { parseServiceRequest } from './aiRequestParser';
export type {
  AiParsedRequestResult,
  AiParserResponse,
  AiParserError,
  AiParserErrorCode,
} from './aiRequestParser';
export {
  analyzeRequestUnderstanding,
  understandingToExtractedNeed,
  LocalRequestUnderstandingProvider,
  GeminiRequestUnderstandingProvider,
  defaultRequestUnderstandingProvider,
} from './requestUnderstanding';
export type {
  RequestUnderstandingContext,
  RequestUnderstandingProvider,
} from './requestUnderstanding';

// In-App Notification System
export {
  notificationService,
  playNotificationSound,
  showBrowserNotificationIfGranted,
} from './notificationService';

// Offline Mutation Queue & Cloud Sync Service
export { offlineQueueService, OfflineQueueService, isFatalError } from './offlineQueueService';
export type { QueuedMutation, MutationType, MutationStatus } from './offlineQueueService';

export type { Repository };
