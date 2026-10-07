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

// AI Request Parser (Callable Cloud Function)
export { parseServiceRequest } from './aiRequestParser';
export type {
  AiParsedRequestResult,
  AiParserResponse,
  AiParserError,
  AiParserErrorCode,
} from './aiRequestParser';

export type { Repository };
