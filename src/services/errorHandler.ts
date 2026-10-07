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

export function logTechnicalError(context: string, error: unknown): void {
  // Graceful technical logging for development and monitoring
  console.warn(`[KEREK CentralErrorHandler] [${context}]:`, error);
}

export function getFriendlyErrorMessage(error: unknown, lang: Language = 'ru'): string {
  if (error instanceof AppError) {
    return lang === 'kz' ? error.userMessageKz : error.userMessageRu;
  }

  if (error instanceof Error) {
    // If validation error with specific custom message (e.g. self-review or field message)
    if (error.message.startsWith('Validation Error:')) {
      const specific = error.message.replace(/^Validation Error:\s*/, '').trim();
      if (specific) return specific;
    }

    if (error.message.includes('validation') || error.message.includes('Validation')) {
      return lang === 'kz'
        ? 'Өтініш деректері қате толтырылған. Тексеріп, қайта көріңіз.'
        : 'Данные заявки некорректны. Пожалуйста, проверьте поля.';
    }

    if (error.message.includes('duplicate') || error.message.includes('Duplicate')) {
      return lang === 'kz'
        ? 'Сіз жақында осыған ұқсас сұраныс жібердіңіз.'
        : 'Вы недавно уже отправляли похожую заявку.';
    }

    if (error.message.includes('rate') || error.message.includes('Rapid')) {
      return lang === 'kz'
        ? 'Тым жиі басылды. Бірнеше секундтан кейін қайталаңыз.'
        : 'Слишком частые действия. Подождите пару секунд.';
    }
  }

  // Safe localized generic message (never technical stack traces)
  return lang === 'kz'
    ? 'Күтпеген қате орын алды. Қайта көріңіз немесе кейінірек қайталаңыз.'
    : 'Произошла ошибка при обработке запроса. Пожалуйста, попробуйте снова.';
}
