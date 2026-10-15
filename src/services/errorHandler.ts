import { Language } from '../types';

export class AppError extends Error {
  public readonly code: string;
  public readonly userMessageKz: string;
  public readonly userMessageRu: string;

  constructor(
    code: string,
    userMessageRu: string,
    userMessageKz: string,
    technicalDetails?: string
  ) {
    super(technicalDetails || userMessageRu);
    this.name = 'AppError';
    this.code = code;
    this.userMessageRu = userMessageRu;
    this.userMessageKz = userMessageKz;
  }
}

/**
 * True when the cloud definitively rejected an operation (security rules, invalid data,
 * missing document). Retrying or caching the write locally cannot fix these, so callers must
 * surface them instead of pretending the write succeeded. Network/availability problems are
 * not rejections: those may still be queued for a later retry.
 */
export function isCloudRejection(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown } | null;
  const code = String(err?.code || '');
  if (
    [
      'permission-denied',
      'invalid-argument',
      'failed-precondition',
      'not-found',
      'already-exists',
      'out-of-range',
      'unauthenticated',
      'storage/unauthorized',
      'storage/unauthenticated',
    ].includes(code)
  ) {
    return true;
  }
  const msg = String(err?.message || error || '');
  return /PERMISSION_DENIED|permission-denied|insufficient permissions|FirestorePermissionDenied|INVALID_ARGUMENT|Validation Error:|Unauthorized:|not found/i.test(msg);
}

export function logTechnicalError(context: string, error: unknown): void {
  // Graceful technical logging for development and monitoring
  console.warn(`[KEREK CentralErrorHandler] [${context}]:`, error);
}

type Msg = { kz: string; ru: string };

function pick(msg: Msg, lang: Language): string {
  return lang === 'kz' ? msg.kz : msg.ru;
}

const MESSAGES = {
  invalid: {
    kz: 'Өтініш деректері қате толтырылған. Тексеріп, қайта көріңіз.',
    ru: 'Данные заполнены некорректно. Пожалуйста, проверьте поля.',
  },
  duplicate: {
    kz: 'Сіз жақында осыған ұқсас сұраныс жібердіңіз.',
    ru: 'Вы недавно уже отправляли похожую заявку.',
  },
  rate: {
    kz: 'Тым жиі басылды. Бірнеше секундтан кейін қайталаңыз.',
    ru: 'Слишком частые действия. Подождите пару секунд.',
  },
  alreadyAccepted: {
    kz: 'Бұл өтінішке орындаушы таңдалып қойған.',
    ru: 'Для этой заявки исполнитель уже выбран.',
  },
  offerClosed: {
    kz: 'Бұл ұсыныс енді белсенді емес.',
    ru: 'Это предложение больше не активно.',
  },
  offerLimit: {
    kz: 'Бұл өтінімге 5 ұсыныс түсіп қойды. Басқа өтінімдерді қараңыз.',
    ru: 'На эту заявку уже пришло 5 предложений. Посмотрите другие заявки.',
  },
  requestExpired: {
    kz: 'Бұл өтінімнің мерзімі бітті, оған енді ұсыныс жіберуге болмайды.',
    ru: 'Срок этой заявки истёк, отправить предложение уже нельзя.',
  },
  notFound: {
    kz: 'Деректер табылмады. Бетті жаңартып, қайта көріңіз.',
    ru: 'Данные не найдены. Обновите страницу и попробуйте снова.',
  },
  denied: {
    kz: 'Бұл әрекетке рұқсат жоқ. Өзгеріс сақталмады. Бетті жаңартып, қайта көріңіз.',
    ru: 'Нет доступа для этого действия. Изменение не сохранено. Обновите страницу и попробуйте снова.',
  },
  offline: {
    kz: 'Интернет байланысы жоқ сияқты. Байланысты тексеріп, қайталаңыз.',
    ru: 'Похоже, нет подключения к интернету. Проверьте связь и повторите.',
  },
  generic: {
    kz: 'Күтпеген қате орын алды. Қайта көріңіз немесе кейінірек қайталаңыз.',
    ru: 'Произошла ошибка при обработке запроса. Пожалуйста, попробуйте снова.',
  },
} satisfies Record<string, Msg>;

/** Turns any thrown value into a short message in the viewer's language; never shows technical details. */
export function getFriendlyErrorMessage(error: unknown, lang: Language = 'ru'): string {
  if (error instanceof AppError) {
    return lang === 'kz' ? error.userMessageKz : error.userMessageRu;
  }

  const msg = error instanceof Error ? error.message : String(error ?? '');

  // Field validation messages are written in Kazakh/Russian; show them as they are
  if (msg.startsWith('Validation Error:')) {
    const specific = msg.replace(/^Validation Error:\s*/, '').trim();
    if (/[\u0400-\u04FF]/.test(specific)) return specific;
  }

  if (/offer-limit-reached/.test(msg)) return pick(MESSAGES.offerLimit, lang);
  if (/request-expired/.test(msg)) return pick(MESSAGES.requestExpired, lang);
  if (/already been accepted/i.test(msg)) return pick(MESSAGES.alreadyAccepted, lang);
  if (/no longer pending|Cannot update offer/i.test(msg)) return pick(MESSAGES.offerClosed, lang);
  if (/duplicate/i.test(msg)) return pick(MESSAGES.duplicate, lang);
  if (/rate limit|rate-limit|Rapid|resource-exhausted|Too many requests/i.test(msg)) return pick(MESSAGES.rate, lang);
  if (isCloudRejection(error) && !/not found/i.test(msg) && !msg.startsWith('Validation Error:')) {
    return pick(MESSAGES.denied, lang);
  }
  if (/not found/i.test(msg)) return pick(MESSAGES.notFound, lang);
  if (/validation/i.test(msg)) return pick(MESSAGES.invalid, lang);
  if (/network|offline|unavailable|Failed to fetch|deadline-exceeded|timeout/i.test(msg)) {
    return pick(MESSAGES.offline, lang);
  }
  return pick(MESSAGES.generic, lang);
}
