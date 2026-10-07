import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured, ensureFirebaseAuth } from './firebase';
import { checkClientRateLimit, resetClientRateLimit } from './rateLimiter';

/**
 * Result returned from the AI request parser
 */
export interface AiParsedRequestResult {
  cityId: string | null;
  categoryId: string | null;
  service: string | null;
  urgency: 'high' | 'normal' | 'low' | null;
  confidence: number;
}

/**
 * Structured error codes for controlled error handling in the frontend
 */
export type AiParserErrorCode =
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LONG'
  | 'RATE_LIMITED'
  | 'FIREBASE_NOT_CONFIGURED'
  | 'UNAUTHENTICATED'
  | 'FUNCTION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface AiParserError {
  code: AiParserErrorCode;
  message: string;
  details?: unknown;
}

export interface AiParserResponse {
  success: boolean;
  data: AiParsedRequestResult | null;
  error?: AiParserError;
}

const RATE_LIMIT_ACTION = 'ai_request_parser';
const RATE_LIMIT_COOLDOWN_MS = 1500; // 1.5s cooldown between consecutive AI parser invocations

/**
 * Parses user service request text into canonical structured metadata using
 * Gemini via Firebase Callable Cloud Function (region: "asia-south1").
 *
 * Does not write directly to Firestore or alter request creation flows.
 * UI components do not need to know Firebase Functions implementation details.
 */
export async function parseServiceRequest(text: string): Promise<AiParserResponse> {
  // 1. Client-Side Input Validation
  if (!text || typeof text !== 'string') {
    return {
      success: false,
      data: null,
      error: {
        code: 'EMPTY_INPUT',
        message: 'Текст запроса не может быть пустым.',
      },
    };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      success: false,
      data: null,
      error: {
        code: 'EMPTY_INPUT',
        message: 'Текст запроса не может быть пустым.',
      },
    };
  }

  if (trimmed.length > 500) {
    return {
      success: false,
      data: null,
      error: {
        code: 'INPUT_TOO_LONG',
        message: 'Длина текста не должна превышать 500 символов.',
      },
    };
  }

  // 2. Client-Side Rate Limiter
  if (!checkClientRateLimit(RATE_LIMIT_ACTION, RATE_LIMIT_COOLDOWN_MS)) {
    return {
      success: false,
      data: null,
      error: {
        code: 'RATE_LIMITED',
        message: 'Слишком частые запросы к AI парсеру. Пожалуйста, подождите секунду.',
      },
    };
  }

  // 3. Check Firebase configuration
  if (!isFirebaseConfigured() || !app) {
    return {
      success: false,
      data: null,
      error: {
        code: 'FIREBASE_NOT_CONFIGURED',
        message: 'Firebase Cloud Functions недоступны (режим офлайн/демо).',
      },
    };
  }

  try {
    // 4. Ensure an authenticated session exists before invoking callable function
    const userId = await ensureFirebaseAuth();
    if (!userId) {
      resetClientRateLimit(RATE_LIMIT_ACTION);
      return {
        success: false,
        data: null,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Пользователь должен быть авторизован для вызова AI парсера.',
        },
      };
    }

    // 5. Invoke Callable Cloud Function in the specified region (asia-south1)
    const functions = getFunctions(app, 'asia-south1');
    const parseCallable = httpsCallable<{ text: string }, AiParsedRequestResult>(
      functions,
      'parseServiceRequest'
    );

    const result = await parseCallable({ text: trimmed });
    const payload = result.data;

    return {
      success: true,
      data: {
        cityId: payload?.cityId ?? null,
        categoryId: payload?.categoryId ?? null,
        service: payload?.service ?? null,
        urgency: payload?.urgency ?? null,
        confidence: typeof payload?.confidence === 'number' ? payload.confidence : 0,
      },
    };
  } catch (err: any) {
    // Reset rate limiter on failure so user is not penalized for backend/network errors
    resetClientRateLimit(RATE_LIMIT_ACTION);

    console.warn('[aiRequestParser] Error invoking parseServiceRequest:', err);

    let code: AiParserErrorCode = 'UNKNOWN_ERROR';
    let message = 'Не удалось обработать запрос с помощью AI.';

    const rawCode = err?.code || '';
    if (rawCode.includes('unauthenticated')) {
      code = 'UNAUTHENTICATED';
      message = 'Ошибка авторизации пользователя.';
    } else if (rawCode.includes('invalid-argument')) {
      code = 'EMPTY_INPUT';
      message = err?.message || 'Некорректный ввод текста запроса.';
    } else if (rawCode.includes('resource-exhausted')) {
      code = 'RATE_LIMITED';
      message = 'Превышен лимит запросов к AI сервису.';
    } else if (rawCode.includes('unavailable') || rawCode.includes('network') || err?.name === 'FirebaseError') {
      code = 'NETWORK_ERROR';
      message = 'Сервер AI функций временно недоступен.';
    } else if (err?.message) {
      code = 'FUNCTION_ERROR';
      message = err.message;
    }

    return {
      success: false,
      data: null,
      error: {
        code,
        message,
        details: err,
      },
    };
  }
}
