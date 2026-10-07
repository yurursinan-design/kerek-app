import {
  Language,
  normalizeRequestStatus,
  Provider,
  ProviderOffer,
  Review,
  ServiceRequest,
} from '../types';
import {
  CANONICAL_CATEGORIES,
  CANONICAL_CITIES,
  getCategoryDisplayName,
  getCityDisplayName,
  normalizeCategoryId,
  normalizeCityId,
} from './taxonomy';

export interface ValidationResult {
  valid: boolean;
  message?: string;
  field?: string;
}

export function validateRequestData(
  data: Partial<ServiceRequest>,
  lang: Language = 'ru'
): ValidationResult {
  // 1. City / CityId validation & resolution
  const rawCity = (data.city || '').trim();
  const rawCityId = (data.cityId || '').trim();
  let resolvedCity = rawCity;

  if (!resolvedCity && rawCityId) {
    resolvedCity = getCityDisplayName(normalizeCityId(rawCityId), lang);
  }

  if (!resolvedCity) {
    return {
      valid: false,
      field: 'city',
      message: lang === 'kz' ? 'Қаланы көрсету міндетті' : 'Необходимо указать город',
    };
  }

  // 2. Category / CategoryId validation & resolution
  const rawCategory = (data.category || '').trim();
  const rawCategoryId = (data.categoryId || '').trim();
  let resolvedCategory = rawCategory;

  if (!resolvedCategory && rawCategoryId) {
    resolvedCategory = getCategoryDisplayName(normalizeCategoryId(rawCategoryId), lang);
  }

  if (!resolvedCategory) {
    return {
      valid: false,
      field: 'category',
      message: lang === 'kz' ? 'Санатты таңдау міндетті' : 'Необходимо указать категорию',
    };
  }

  // 3. RequestText / Description / Service resolution
  const requestText = (data.requestText || data.description || '').trim();
  const service = (data.service || requestText || resolvedCategory).trim();
  const effectiveDescription = (data.description || data.requestText || service).trim();

  if (!service && !requestText && !effectiveDescription) {
    return {
      valid: false,
      field: 'service',
      message: lang === 'kz' ? 'Қызмет түрін көрсету міндетті' : 'Необходимо указать требуемую услугу',
    };
  }

  // Relaxed length check: at least 2 chars in either requestText, service, or description
  if (requestText.length < 2 && service.length < 2 && effectiveDescription.length < 2) {
    return {
      valid: false,
      field: 'requestText',
      message: lang === 'kz' ? 'Сұранысты толығырақ сипаттаңыз' : 'Опишите запрос подробнее (не менее 2 символов)',
    };
  }

  // 4. Urgency validation (if provided, must be a known urgency)
  if (data.urgency && !['high', 'normal', 'low'].includes(data.urgency)) {
    return {
      valid: false,
      field: 'urgency',
      message: lang === 'kz' ? 'Шұғылдық деңгейі қате' : 'Недопустимый уровень срочности',
    };
  }

  return { valid: true };
}

export function validateProviderData(
  data: Partial<Provider>,
  lang: Language = 'ru'
): ValidationResult {
  if (!data.name || data.name.trim().length < 2) {
    return {
      valid: false,
      field: 'name',
      message: lang === 'kz' ? 'Атыңызды немесе ұйым атауын жазыңыз' : 'Укажите имя или название компании',
    };
  }

  if (!data.phone || data.phone.trim().length < 6) {
    return {
      valid: false,
      field: 'phone',
      message: lang === 'kz' ? 'Байланыс телефонын дұрыс енгізіңіз' : 'Введите корректный номер телефона',
    };
  }

  if (!data.city || data.city.trim().length === 0) {
    return {
      valid: false,
      field: 'city',
      message: lang === 'kz' ? 'Қаланы таңдаңыз' : 'Выберите город',
    };
  }

  if (!data.category || data.category.trim().length === 0) {
    return {
      valid: false,
      field: 'category',
      message: lang === 'kz' ? 'Қызмет санатын таңдаңыз' : 'Выберите категорию услуг',
    };
  }

  return { valid: true };
}

export function validateOfferData(
  data: Partial<ProviderOffer>,
  lang: Language = 'ru'
): ValidationResult {
  if (!data.requestId || data.requestId.trim().length === 0) {
    return {
      valid: false,
      field: 'requestId',
      message: lang === 'kz' ? 'Өтініш ID табылмады' : 'Отсутствует ID заявки',
    };
  }

  if (!data.providerId || data.providerId.trim().length === 0) {
    return {
      valid: false,
      field: 'providerId',
      message: lang === 'kz' ? 'Орындаушы ID табылмады' : 'Отсутствует ID исполнителя',
    };
  }

  // Validate priceType if provided; if omitted, legacy records default to 'fixed'
  if (data.priceType && !['fixed', 'from', 'inspection'].includes(data.priceType)) {
    return {
      valid: false,
      field: 'priceType',
      message: lang === 'kz' ? 'Баға түрі қате көрсетілген' : 'Недопустимый тип цены',
    };
  }

  const effectivePriceType = data.priceType || 'fixed';

  // For fixed and from price types, price is strictly required
  if (effectivePriceType === 'fixed' || effectivePriceType === 'from') {
    if (!data.price || data.price.trim().length === 0) {
      return {
        valid: false,
        field: 'price',
        message: lang === 'kz' ? 'Бағасын көрсетіңіз' : 'Укажите примерную стоимость',
      };
    }
  }
  // For 'inspection', price is NOT required (defaults to "После осмотра")

  if (!data.availability || data.availability.trim().length === 0) {
    return {
      valid: false,
      field: 'availability',
      message: lang === 'kz' ? 'Келу немесе орындау уақытын көрсетіңіз' : 'Укажите время выезда или готовности',
    };
  }

  return { valid: true };
}

/**
 * Strict server & client validation for Review records:
 * 1. requestId required
 * 2. customerId required
 * 3. providerId required
 * 4. customerId cannot equal providerId (provider cannot review themselves)
 * 5. rating must be an integer between 1 and 5
 * 6. comment optional, max 500 characters
 * 7. if request provided, status must be COMPLETED and customerId must match
 * 8. if acceptedOffer provided, status must be ACCEPTED and providerId must match
 */
export function validateReviewData(
  data: Partial<Review>,
  request?: ServiceRequest | null,
  acceptedOffer?: ProviderOffer | null,
  lang: Language = 'ru',
  isAnonymousSession: boolean = false
): ValidationResult {
  if (!data.requestId || data.requestId.trim().length === 0) {
    return {
      valid: false,
      field: 'requestId',
      message: lang === 'kz' ? 'Тапсырыс нөмірі қажет' : 'Отсутствует ID заявки',
    };
  }

  if (!data.customerId || data.customerId.trim().length === 0) {
    return {
      valid: false,
      field: 'customerId',
      message: lang === 'kz' ? 'Клиент нөмірі қажет' : 'Отсутствует ID клиента',
    };
  }

  if (!data.providerId || data.providerId.trim().length === 0) {
    return {
      valid: false,
      field: 'providerId',
      message: lang === 'kz' ? 'Орындаушы нөмірі қажет' : 'Отсутствует ID исполнителя',
    };
  }

  if (!isAnonymousSession && data.customerId.trim() === data.providerId.trim()) {
    return {
      valid: false,
      field: 'providerId',
      message: lang === 'kz' ? 'Орындаушы өзіне баға бере алмайды' : 'Исполнитель не может оценивать самого себя',
    };
  }

  if (
    typeof data.rating !== 'number' ||
    !Number.isInteger(data.rating) ||
    data.rating < 1 ||
    data.rating > 5
  ) {
    return {
      valid: false,
      field: 'rating',
      message: lang === 'kz' ? 'Баға 1 мен 5 арасындағы бүтін сан болуы тиіс' : 'Оценка должна быть целым числом от 1 до 5',
    };
  }

  if (data.comment && data.comment.length > 500) {
    return {
      valid: false,
      field: 'comment',
      message: lang === 'kz' ? 'Пікір 500 таңбадан аспауы тиіс' : 'Длина отзыва не может превышать 500 символов',
    };
  }

  // Cross-document relation verification
  if (request) {
    const canonicalStatus = normalizeRequestStatus(request.status);
    if (canonicalStatus !== 'COMPLETED') {
      return {
        valid: false,
        field: 'status',
        message: lang === 'kz' ? 'Тек аяқталған тапсырысқа баға беруге болады' : 'Оценивать можно только завершенные заказы',
      };
    }
    if (request.customerId && request.customerId !== data.customerId) {
      return {
        valid: false,
        field: 'customerId',
        message: lang === 'kz' ? 'Бағаны тек осы тапсырыс иесі бере алады' : 'Только заказчик может оставить отзыв',
      };
    }
  }

  if (acceptedOffer) {
    if (acceptedOffer.status !== 'ACCEPTED') {
      return {
        valid: false,
        field: 'offerStatus',
        message: lang === 'kz' ? 'Ұсыныс қабылданбаған' : 'Предложение не было принято',
      };
    }
    if (acceptedOffer.providerId && acceptedOffer.providerId !== data.providerId) {
      return {
        valid: false,
        field: 'providerId',
        message: lang === 'kz' ? 'Таңдалмаған орындаушыға баға беруге болмайды' : 'Нельзя оставить отзыв неподтвержденному исполнителю',
      };
    }
  }

  return { valid: true };
}
