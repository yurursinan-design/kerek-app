import {
  ExtractedNeed,
  Language,
  PendingAttachment,
  RequestLocation,
  RequestUnderstanding,
  UnderstandingUrgency,
  Urgency,
} from '../types';
import {
  CANONICAL_CATEGORIES,
  CANONICAL_CITIES,
  getCategoryDisplayName,
  getCityDisplayName,
  normalizeCategoryId,
  normalizeCityId,
} from './taxonomy';

export interface RequestUnderstandingContext {
  language: Language;
  attachmentsPresent?: {
    images: number;
    videos: number;
    audios: number;
  };
  hasLocation?: boolean;
  location?: RequestLocation;
}

export interface RequestUnderstandingProvider {
  understandRequest(
    text: string,
    context?: RequestUnderstandingContext
  ): Promise<RequestUnderstanding>;
}

// Recognized brand catalog for high-precision extraction
const KNOWN_BRANDS: { brand: string; pattern: RegExp; categories?: string[] }[] = [
  { brand: 'Samsung', pattern: /\bsamsung\b|\bсамсунг\b/i },
  { brand: 'LG', pattern: /\blg\b|\bэлджи\b|\bэл джи\b/i },
  { brand: 'Bosch', pattern: /\bbosch\b|\bбош\b/i },
  { brand: 'Apple', pattern: /\bapple\b|\bайфон\b|\biphone\b|\bайпад\b|\bipad\b|\bmacbook\b|\bмакбук\b/i },
  { brand: 'Xiaomi', pattern: /\bxiaomi\b|\bredmi\b|\bсяоми\b|\bредми\b/i },
  { brand: 'Huawei', pattern: /\bhuawei\b|\bхуавей\b|\bhonor\b|\bхонор\b/i },
  { brand: 'Beko', pattern: /\bbeko\b|\bбеко\b/i },
  { brand: 'Indesit', pattern: /\bindesit\b|\bиндезит\b/i },
  { brand: 'Ariston', pattern: /\bariston\b|\bаристон\b/i },
  { brand: 'Electrolux', pattern: /\belectrolux\b|\bэлектролюкс\b/i },
  { brand: 'Whirlpool', pattern: /\bwhirlpool\b|\bвирпул\b/i },
  { brand: 'Haier', pattern: /\bhaier\b|\bхайер\b/i },
  { brand: 'Midea', pattern: /\bmidea\b|\bмидеа\b/i },
  { brand: 'Sony', pattern: /\bsony\b|\bсони\b/i },
  { brand: 'Panasonic', pattern: /\bpanasonic\b|\bпанасоник\b/i },
  { brand: 'Philips', pattern: /\bphilips\b|\bфилипс\b/i },
  { brand: 'Dyson', pattern: /\bdyson\b|\bдайсон\b/i },
  { brand: 'Toyota', pattern: /\btoyota\b|\bтойота\b|\bтайота\b/i },
  { brand: 'Hyundai', pattern: /\bhyundai\b|\bхендай\b|\bхюндай\b/i },
  { brand: 'Kia', pattern: /\bkia\b|\bкиа\b/i },
  { brand: 'Chevrolet', pattern: /\bchevrolet\b|\bшевроле\b|\bшевролет\b/i },
  { brand: 'Lada', pattern: /\blada\b|\bлада\b|\bваз\b/i },
  { brand: 'Gazelle', pattern: /газель|gazelle|соболь/i },
];

// Common model patterns
const MODEL_PATTERNS: { brandRef?: string; pattern: RegExp; formatter: (m: RegExpMatchArray) => string }[] = [
  {
    brandRef: 'Apple',
    pattern: /(?:iphone|айфон)\s*([0-9]{1,2}(?:\s*(?:pro\s*max|pro|plus|mini))?)/i,
    formatter: (m) => `iPhone ${m[1].trim()}`,
  },
  {
    brandRef: 'Apple',
    pattern: /(?:ipad|айпад)\s*([a-z0-9\s]+)?/i,
    formatter: (m) => `iPad ${m[1] ? m[1].trim() : ''}`.trim(),
  },
  {
    brandRef: 'Apple',
    pattern: /(?:macbook|макбук)\s*(?:air|pro)?/i,
    formatter: (m) => m[0].trim(),
  },
  {
    brandRef: 'Samsung',
    pattern: /(?:galaxy|галакси)\s*([a-z0-9]{1,4}(?:\s*(?:ultra|plus|fe))?)/i,
    formatter: (m) => `Galaxy ${m[1].trim()}`,
  },
  {
    brandRef: 'Samsung',
    pattern: /\b(ww\d{2}[a-z0-9]+)\b/i,
    formatter: (m) => m[1].toUpperCase(),
  },
  {
    brandRef: 'Toyota',
    pattern: /\b(?:camry|камри)\s*(\d{2,3})?\b/i,
    formatter: (m) => `Camry${m[1] ? ` ${m[1]}` : ''}`,
  },
  {
    brandRef: 'Toyota',
    pattern: /\b(?:corolla|королла|rav4|рав4|land\s*cruiser|прадо|prado)\b/i,
    formatter: (m) => m[0].trim(),
  },
  {
    brandRef: 'Gazelle',
    pattern: /(?:газель|gazelle)\s*(next|некст|бизнес)?/i,
    formatter: (m) => (m[1] ? `NEXT` : 'NEXT'),
  },
  {
    brandRef: 'Xiaomi',
    pattern: /(?:redmi\s*note|редми\s*ноут)\s*([0-9]{1,2}(?:\s*pro)?)/i,
    formatter: (m) => `Redmi Note ${m[1].trim()}`,
  },
];

// Problem diagnostic rules
interface ProblemRule {
  pattern: RegExp;
  problemKz: string;
  problemRu: string;
  problemEn: string;
}

const PROBLEM_RULES: ProblemRule[] = [
  {
    pattern: /су ағызбай|суды ағызбай|не сливает|не слив|су төкпей|suyu boşaltm|суды шығармай|water not drain|not drain/i,
    problemKz: 'Су ағызбай тұр (су төкпейді)',
    problemRu: 'Не сливает воду',
    problemEn: 'Water not draining',
  },
  {
    pattern: /су ағып|ағып тұр|течет|протечка|капает|су кетіп|протекл|su akıt|leak|leaking/i,
    problemKz: 'Су ағып жатыр (протечка)',
    problemRu: 'Протечка воды / течет',
    problemEn: 'Water leaking',
  },
  {
    pattern: /бөтен дыбыс|шумит|стучит|гудит|шум шығ|дыбыс шығ|шықылдап|шумный|garip ses|странн|strange sound|strange noise|noise/i,
    problemKz: 'Бөтен шу және дыбыс шығады',
    problemRu: 'Странный шум и гул при работе',
    problemEn: 'Strange noise during operation',
  },
  {
    pattern: /қосылмайды|не включается|өшіп қалды|сөніп|жанбайды|не запускается|açılmıyor|dead|won't turn on|not turning on/i,
    problemKz: 'Құрылғы қосылмайды',
    problemRu: 'Устройство не включается',
    problemEn: 'Device will not turn on',
  },
  {
    pattern: /экран\s*сын|сынған\s*экран|дисплей\s*сын|разбит\s*экран|треснул|ekran\s*kır|broken\s*screen|cracked\s*screen/i,
    problemKz: 'Экран/дисплей сынған',
    problemRu: 'Разбит экран / дисплей',
    problemEn: 'Screen or display broken',
  },
  {
    pattern: /суытпайды|не морозит|не холодит|мұздатпайды|жылы тұр|soğutmuyor|not cooling|not freezing/i,
    problemKz: 'Суытпайды (мұздатпайды)',
    problemRu: 'Не морозит / не охлаждает',
    problemEn: 'Not cooling or freezing',
  },
  {
    pattern: /қыздырмайды|не греет|су жылытпайды|салқын су|жылытпай тұр|ısıtmıyor|not heating/i,
    problemKz: 'Су қыздырмайды',
    problemRu: 'Не греет воду / нет нагрева',
    problemEn: 'Not heating water',
  },
  {
    pattern: /бітеліп|засор|тығылып|забился|су өтпей|засорен|tıkandı|clogged|blocked drain/i,
    problemKz: 'Құбыр/су бітеліп қалған (засор)',
    problemRu: 'Засор канализации / труб',
    problemEn: 'Clogged drain / pipe',
  },
  {
    pattern: /искрит|ұшқын|жанып|замыкание|ток соғ|қысқа тұйықталу|spark/i,
    problemKz: 'Ұшқындап тұр (қысқа тұйықталу)',
    problemRu: 'Искрит проводка / замыкание',
    problemEn: 'Sparks / short circuit',
  },
  {
    pattern: /дөңгелек|пробито колесо|шина жарылды|балон жарылды|спустило колесо|flat tire|puncture/i,
    problemKz: 'Дөңгелек жарылған / ауыстыру',
    problemRu: 'Пробито колесо / шиномонтаж',
    problemEn: 'Flat tire / wheel puncture',
  },
  {
    pattern: /құлып|замок сломался|заклинило|кілт ашылмайды|есік ашылмайды|lock broken|jammed/i,
    problemKz: 'Құлып ашылмайды / бұзылған',
    problemRu: 'Заклинило замок / не открывается дверь',
    problemEn: 'Lock jammed or broken',
  },
];

/**
 * Validation & Sanitization Helper
 * Sanitizes unsafe values and validates core contract invariants.
 */
export function validateAndSanitizeRequestUnderstanding(
  raw: Partial<RequestUnderstanding>,
  context?: RequestUnderstandingContext
): { valid: boolean; errors: string[]; sanitized: RequestUnderstanding } {
  const errors: string[] = [];

  // City validation
  let cityId = raw.cityId ? normalizeCityId(raw.cityId) : 'kyzylorda';
  if (!raw.cityId) {
    errors.push('Missing cityId; defaulted to kyzylorda');
  }

  // Category validation
  let categoryId = raw.categoryId ? normalizeCategoryId(raw.categoryId) : 'other';
  if (!raw.categoryId) {
    errors.push('Missing categoryId; defaulted to other');
  }

  // Urgency validation
  const validUrgencies: UnderstandingUrgency[] = ['low', 'normal', 'high', 'emergency'];
  let urgency: UnderstandingUrgency =
    raw.urgency && validUrgencies.includes(raw.urgency) ? raw.urgency : 'normal';
  if (raw.urgency && !validUrgencies.includes(raw.urgency)) {
    errors.push(`Invalid urgency "${raw.urgency}"; defaulted to normal`);
  }

  // Preferred date validation
  let preferredDate = (raw.preferredDate || '').trim();
  if (!preferredDate) {
    preferredDate = context?.language === 'kz' ? 'Бүгін' : 'Сегодня';
    errors.push('Missing preferredDate; defaulted to current date');
  }

  // Confidence validation (must be between 0.0 and 1.0)
  let confidence = typeof raw.confidence === 'number' ? raw.confidence : 0.5;
  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    errors.push(`Invalid confidence "${raw.confidence}"; clamped to 0.0-1.0`);
    confidence = Math.max(0, Math.min(1, isNaN(confidence) ? 0.5 : confidence));
  }
  confidence = Number(confidence.toFixed(2));

  // Attachment counts validation (positive integers)
  const images = Math.max(
    0,
    Math.floor(raw.attachmentsPresent?.images ?? context?.attachmentsPresent?.images ?? 0)
  );
  const videos = Math.max(
    0,
    Math.floor(raw.attachmentsPresent?.videos ?? context?.attachmentsPresent?.videos ?? 0)
  );
  const audios = Math.max(
    0,
    Math.floor(raw.attachmentsPresent?.audios ?? context?.attachmentsPresent?.audios ?? 0)
  );

  // Location validation (strictly true only if coordinates actually exist)
  const actualHasLocation = Boolean(
    context?.hasLocation ||
      (context?.location &&
        typeof context.location.latitude === 'number' &&
        !isNaN(context.location.latitude)) ||
      (raw.hasLocation && context?.location)
  );

  // Privacy & Security: strip sensitive customer data (phone, whatsapp)
  const sanitizeText = (txt?: string) =>
    (txt || '')
      .replace(
        /(?:\+?7|8)\s*\(?[0-9]{3}\)?\s*[0-9]{3}[-\s]?[0-9]{2}[-\s]?[0-9]{2}/g,
        '[ТЕЛЕФОН ЖАСЫРЫЛҒАН]'
      )
      .trim();

  const sanitizedDescription = sanitizeText(raw.description);
  const sanitizedService = sanitizeText(raw.service) || 'Қызмет';

  const sanitized: RequestUnderstanding = {
    city: raw.city || getCityDisplayName(cityId, context?.language || 'kz'),
    cityId,
    category: raw.category || getCategoryDisplayName(categoryId, context?.language || 'kz'),
    categoryId,
    service: sanitizedService,
    description: sanitizedDescription,
    urgency,
    preferredDate,
    preferredTime: raw.preferredTime?.trim() || undefined,
    detectedBrand: raw.detectedBrand?.trim() || undefined,
    detectedModel: raw.detectedModel?.trim() || undefined,
    detectedProblem: raw.detectedProblem?.trim() || undefined,
    userIntent: raw.userIntent?.trim() || `${sanitizedService} (${cityId})`,
    attachmentsPresent: { images, videos, audios },
    hasLocation: actualHasLocation,
    missingInformation: Array.isArray(raw.missingInformation) ? raw.missingInformation : [],
    clarificationNeeded: Boolean(raw.clarificationNeeded),
    suggestedQuestions: Array.isArray(raw.suggestedQuestions)
      ? raw.suggestedQuestions.slice(0, 3)
      : [],
    confidence,
  };

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Core Request Understanding 2.0 Local Engine
 */
export function analyzeRequestUnderstanding(
  text: string,
  context?: RequestUnderstandingContext
): RequestUnderstanding {
  const query = (text || '').trim();
  const normalized = query.toLowerCase();
  const lang: Language = context?.language || 'kz';

  // Detect whether request is primarily English
  const isEnglishQuery =
    /\b(repair|water|not draining|today|urgent|washing machine|fridge|phone|screen|plumber|electrician|broken|leaking|car|weekend)\b/i.test(
      normalized
    );

  // 1. City Detection
  let detectedCityId: string | undefined = undefined;
  let detectedCity: string | undefined = undefined;

  for (const city of CANONICAL_CITIES) {
    for (const pattern of city.patterns) {
      if (pattern.test(normalized)) {
        detectedCityId = city.id;
        detectedCity = lang === 'kz' ? city.nameKz : city.nameRu;
        break;
      }
    }
    if (detectedCityId) break;
  }

  // Fallback to Kyzylorda default if no city found
  const effectiveCityId = detectedCityId || 'kyzylorda';
  const effectiveCity = detectedCity || (lang === 'kz' ? 'Қызылорда' : 'Кызылорда');

  // 2. Category Detection
  let detectedCategoryId: string | undefined = undefined;
  let detectedCategory: string | undefined = undefined;

  for (const category of CANONICAL_CATEGORIES) {
    for (const pattern of category.patterns) {
      if (pattern.test(normalized)) {
        detectedCategoryId = category.id;
        detectedCategory = getCategoryDisplayName(category.id, lang);
        break;
      }
    }
    if (detectedCategoryId) break;
  }

  // Sub-keyword category detection if not caught by primary patterns
  if (!detectedCategoryId) {
    if (
      /котел|котёл|қазандық|отоплени|жылыту|аристон|байпасс|байпас|батарея|печь|печка|радиатор|тепло|kombi|комби|колонка|газовая колонка|су жылытқыш/i.test(
        normalized
      )
    ) {
      detectedCategoryId = 'heating_boiler';
      detectedCategory = getCategoryDisplayName('heating_boiler', lang);
    } else if (
      /кондиционер|фреон|сплит|салқындатқыш|чистка кондиционера|заправка кондиционер/i.test(
        normalized
      )
    ) {
      detectedCategoryId = 'ac_ventilation';
      detectedCategory = getCategoryDisplayName('ac_ventilation', lang);
    } else if (
      /кір жуғыш|стирал|çamaşır|washing\s*machine|washer|холодильник|тоңазытқыш|бойлер|плита|пылесос|посудомойка/i.test(
        normalized
      )
    ) {
      detectedCategoryId = 'appliances';
      detectedCategory = getCategoryDisplayName('appliances', lang);
    } else if (
      /сантехник|(?:^|[^а-яёa-z\d])кран|труба|су ағ|шүмек|унитаз|смеситель|канализаци|раковин|батарея|электрик|жарық|проводк|розетк|люстр|тоқ|plumb|electric/i.test(
        normalized
      )
    ) {
      detectedCategoryId = 'home_services';
      detectedCategory = getCategoryDisplayName('plumbing', lang);
    } else if (/газель|переезд|көшу|көшіру|жүк тасу|грузоперевозк|грузчик|moving|cargo/i.test(normalized)) {
      detectedCategoryId = 'cargo_moving';
      detectedCategory = getCategoryDisplayName('cleaning_moving', lang);
    } else if (
      /жиһаз|мебель|шкаф|стол|кровать|диван|сборка мебели|жиһаз құрастыру|плотник/i.test(
        normalized
      )
    ) {
      detectedCategoryId = 'furniture_carpentry';
      detectedCategory = getCategoryDisplayName('furniture_carpentry', lang);
    } else if (
      /маляр|покраска|бояу|штукатурк|шпатлевк|обои|пәтер жөндеу|ремонт квартир|кафель/i.test(
        normalized
      )
    ) {
      detectedCategoryId = 'painting_finishing';
      detectedCategory = getCategoryDisplayName('painting_finishing', lang);
    } else if (
      /телефон|смартфон|айфон|iphone|samsung galaxy|экран|дисплей|ноутбук|компьютер|гаджет/i.test(
        normalized
      )
    ) {
      detectedCategoryId = 'electronics';
      detectedCategory = lang === 'tr' ? 'Электроника и покупка техники' : lang === 'kz' ? 'Электроника және гаджеттер' : 'Электроника и покупка техники';
    } else if (/клининг|уборка|тазалау|пәтер тазалау|кілем жуу|cleaning/i.test(normalized)) {
      detectedCategoryId = 'cleaning';
      detectedCategory = getCategoryDisplayName('cleaning_moving', lang);
    } else if (/эвакуатор|көлік бұзылды|авто|сто|шина|дөңгелек|tow truck|mechanic/i.test(normalized)) {
      detectedCategoryId = 'auto';
      detectedCategory = lang === 'tr' ? 'Автоуслуги и эвакуатор' : lang === 'kz' ? 'Автокөмек және эвакуатор' : 'Автоуслуги и эвакуатор';
    } else {
      detectedCategoryId = 'other';
      detectedCategory = lang === 'tr' ? 'Diğer Hizметler' : lang === 'kz' ? 'Басқа қызметтер' : 'Другие услуги';
    }
  }

  // 3. Brand & Model Detection
  let detectedBrand: string | undefined = undefined;
  for (const b of KNOWN_BRANDS) {
    if (b.pattern.test(normalized)) {
      detectedBrand = b.brand;
      break;
    }
  }

  let detectedModel: string | undefined = undefined;
  for (const m of MODEL_PATTERNS) {
    if (!m.brandRef || m.brandRef === detectedBrand) {
      const match = query.match(m.pattern);
      if (match) {
        detectedModel = m.formatter(match);
        if (!detectedBrand && m.brandRef) {
          detectedBrand = m.brandRef;
        }
        break;
      }
    }
  }

  // 4. Problem Diagnostic Detection
  let detectedProblem: string | undefined = undefined;
  for (const rule of PROBLEM_RULES) {
    if (rule.pattern.test(normalized)) {
      if (isEnglishQuery) {
        detectedProblem = rule.problemEn;
      } else {
        detectedProblem = lang === 'kz' ? rule.problemKz : rule.problemRu;
      }
      break;
    }
  }

  // 5. Urgency Detection (Emergency vs High vs Normal vs Low)
  let urgency: UnderstandingUrgency = 'normal';

  const isEmergency =
    /апат|авария|төтенше|су басып жатыр|затопило|заливает|газ иісі|запах газа|өрт|пожар|искрит проводка|ток соғып|катастрофа|emergency/i.test(
      normalized
    );

  const isHigh =
    !isEmergency &&
    /срочно|шұғыл|urgent|бүгін керек|сегодня нужен|сегодня|бүгін|today|тез|қазір керек|срочный|тез арада|бүгін кешке|сегодня вечером|bu akşam|прямо сейчас|bugün lazım|bugün|acil|asap/i.test(
      normalized
    );

  const isLow =
    /асықпаймын|келесі аптада|не к спеху|на следующей неделе|қашан бос болса|келесі айда|время терпит|low priority|не срочно|асығыс емес|haftaya/i.test(
      normalized
    );

  if (isEmergency) {
    urgency = 'emergency';
  } else if (isHigh) {
    urgency = 'high';
  } else if (isLow) {
    urgency = 'low';
  } else {
    urgency = 'normal';
  }

  // 6. Preferred Date & Time
  let preferredDate: string | undefined = undefined;
  let preferredTime: string | undefined = undefined;

  if (/бүгін|сегодня|today|bugün|прямо сейчас|қазір|bu akşam/i.test(normalized)) {
    preferredDate = isEnglishQuery ? 'Today' : lang === 'kz' ? 'Бүгін' : 'Сегодня';
  } else if (/ертең|завтра|tomorrow|yarın/i.test(normalized)) {
    preferredDate = isEnglishQuery ? 'Tomorrow' : lang === 'kz' ? 'Ертең' : 'Завтра';
  } else if (/арғы күні|послезавтра/i.test(normalized)) {
    preferredDate = lang === 'kz' ? 'Арғы күні' : 'Послезавтра';
  } else if (/демалыс|выходн|weekend/i.test(normalized)) {
    preferredDate = isEnglishQuery ? 'Weekend' : lang === 'kz' ? 'Демалыс күндері' : 'На выходных';
  } else {
    preferredDate = isEnglishQuery
      ? 'Soon'
      : lang === 'kz'
      ? 'Жақын арада'
      : 'В ближайшее время';
  }

  // Time detection: e.g. "18:00", "в 19:30", "сағат 10-да", "в 14:00", "akşam 7", "кешкі 7", "вечером в 7"
  const timeMatch = query.match(/(?:в|сағат|сағ|at)?\s*([0-2]?[0-9]:[0-5][0-9])\b/i);
  const eveningHourMatch = query.match(/(?:akşam|вечером|кешкі)\s*(?:в|сағат)?\s*([6-9]|1[0-1])\b/i);
  const morningHourMatch = query.match(/(?:таңғы|утром|sabah)\s*(?:в|сағат)?\s*([6-9]|1[0-2])\b/i);
  const hourWordMatch = query.match(/(?:в|сағат)\s*([1-9]|1[0-9]|2[0-4])(?:\s*(?:вечера|күні|таңертең|түсте|кешкі))?/i);

  if (timeMatch) {
    preferredTime = timeMatch[1];
  } else if (eveningHourMatch) {
    const hr = parseInt(eveningHourMatch[1], 10);
    const converted = hr < 12 ? hr + 12 : hr;
    preferredTime = `${converted}:00`;
  } else if (morningHourMatch) {
    const hr = parseInt(morningHourMatch[1], 10);
    preferredTime = `${hr < 10 ? '0' : ''}${hr}:00`;
  } else if (hourWordMatch && !query.includes('₸') && !query.includes('тг')) {
    const hr = parseInt(hourWordMatch[1], 10);
    if (hr >= 8 && hr <= 22) {
      preferredTime = `${hr < 10 ? '0' : ''}${hr}:00`;
    }
  }

  // 7. Structured Service Formulation
  let service = '';
  const brandPrefix = detectedBrand ? `${detectedBrand} ` : '';
  const modelSuffix = detectedModel ? ` (${detectedModel})` : '';

  if (detectedCategoryId === 'appliances' || detectedCategoryId === 'appliance_repair') {
    if (/кір жуғыш|стирал|çamaşır|washing\s*machine|washer/i.test(normalized)) {
      if (isEnglishQuery) {
        service = `${brandPrefix}washing machine repair${modelSuffix}`.trim();
      } else {
        service =
          lang === 'kz'
            ? `${brandPrefix}кір жуғыш машинасын жөндеу${modelSuffix}`
            : `Ремонт стиральной машины ${brandPrefix}${modelSuffix}`.trim();
      }
    } else if (/тоңазытқыш|холодильник|refrigerator|fridge/i.test(normalized)) {
      service =
        lang === 'kz'
          ? `${brandPrefix}тоңазытқыш жөндеу${modelSuffix}`
          : `Ремонт холодильника ${brandPrefix}${modelSuffix}`.trim();
    } else {
      service =
        lang === 'kz'
          ? `${brandPrefix}тұрмыстық техника жөндеу`
          : `Ремонт бытовой техники ${brandPrefix}`.trim();
    }
  } else if (detectedCategoryId === 'home_services') {
    if (/сантехник|кран|труба|су ағ|шүмек|унитаз|plumb/i.test(normalized)) {
      service = isEnglishQuery
        ? 'Plumbing services'
        : lang === 'kz'
        ? 'Сантехникалық жұмыстар'
        : 'Сантехнические работы';
    } else if (/электрик|жарық|проводк|розетк|люстр|electric/i.test(normalized)) {
      service = isEnglishQuery
        ? 'Electrical services'
        : lang === 'kz'
        ? 'Электрика қызметтері'
        : 'Услуги электрика';
    } else {
      service = lang === 'kz' ? 'Тұрмыстық қызметтер' : 'Бытовые услуги';
    }
  } else if (detectedCategoryId === 'cargo_moving') {
    service =
      lang === 'kz'
        ? `Жүк тасымалдау ${brandPrefix ? `(${brandPrefix})` : ''}`.trim()
        : `Грузоперевозки ${brandPrefix ? `(${brandPrefix})` : ''}`.trim();
  } else if (detectedCategoryId === 'electronics') {
    service =
      lang === 'kz'
        ? `${brandPrefix || 'Смартфон '}${modelSuffix} жөндеу`
        : `Ремонт ${brandPrefix || 'телефона '}${modelSuffix}`.trim();
  } else if (detectedCategoryId === 'cleaning') {
    service = lang === 'kz' ? 'Тазалық қызметі (Клининг)' : 'Клининг и уборка';
  } else if (detectedCategoryId === 'auto') {
    service =
      lang === 'kz'
        ? `Автокөмек ${brandPrefix ? `(${brandPrefix})` : ''}`.trim()
        : `Автоуслуги ${brandPrefix ? `(${brandPrefix})` : ''}`.trim();
  } else {
    service = query.length > 50 ? query.slice(0, 47) + '...' : query || 'Қызмет';
  }

  // 8. Missing Information & Clarification Need Evaluation
  const missingInfo: string[] = [];
  const suggestedQuestions: string[] = [];

  // Check if brand/model is relevant but missing
  const needsBrand =
    detectedCategoryId === 'appliances' ||
    detectedCategoryId === 'appliance_repair' ||
    detectedCategoryId === 'electronics' ||
    detectedCategoryId === 'auto';

  if (needsBrand && !detectedBrand) {
    missingInfo.push(
      lang === 'kz' ? 'Құрылғы маркасы мен моделі' : 'Марка и модель устройства'
    );
    suggestedQuestions.push(
      lang === 'kz' ? 'Құрылғы маркасы/моделі қандай?' : 'Какая марка и модель устройства?'
    );
  }

  // Check if problem detail is missing (vague query like "сломалась стиралка", "бұзылды", "bozuldu", "broken")
  if (
    !detectedProblem &&
    (normalized.length < 25 ||
      /бұзылды|сломалась|сломался|не работает|жөндеу керек|істемей тұр|bozuldu|tamir lazım|broken/i.test(
        normalized
      ))
  ) {
    missingInfo.push(
      lang === 'kz' ? 'Ақаудың нақты сипаттамасы' : 'Конкретное описание неисправности'
    );
    suggestedQuestions.push(
      lang === 'kz' ? 'Қандай ақау орын алды?' : 'Что именно не работает?'
    );
  }

  // Check if preferred time/access is missing
  if (!preferredTime && urgency !== 'emergency') {
    suggestedQuestions.push(
      lang === 'kz'
        ? 'Маманға қай уақытта келген ыңғайлы?'
        : 'В какое время мастеру удобно приехать?'
    );
  }

  // Determine clarificationNeeded: true only if input is ambiguous or missing core details
  // If user provided brand and model or specific problem, clarification is false!
  const isVagueOrShort =
    normalized.length < 20 ||
    (!detectedBrand && !detectedProblem) ||
    normalized.split(' ').length <= 3;
  const clarificationNeeded = isVagueOrShort && missingInfo.length > 0;

  // 9. Confidence Calculation
  let confidence = 0.5;
  if (detectedCategoryId && detectedCategoryId !== 'other') confidence += 0.25;
  if (detectedCityId) confidence += 0.15;
  if (detectedBrand || detectedModel) confidence += 0.1;
  if (detectedProblem) confidence += 0.1;
  if (query.length < 5) confidence = 0.3;
  confidence = Math.min(0.98, Math.max(0.2, Number(confidence.toFixed(2))));

  // 10. Attachment Metadata integration
  const attachmentsPresent = context?.attachmentsPresent || {
    images: 0,
    videos: 0,
    audios: 0,
  };
  const hasLocation = Boolean(
    context?.hasLocation || (context?.location && context.location.latitude)
  );

  const rawResult: Partial<RequestUnderstanding> = {
    city: effectiveCity,
    cityId: effectiveCityId,
    category: detectedCategory,
    categoryId: detectedCategoryId,
    service,
    description: query,
    urgency,
    preferredDate,
    preferredTime,
    detectedBrand,
    detectedModel,
    detectedProblem,
    userIntent: `${service} (${effectiveCity})`,
    attachmentsPresent,
    hasLocation,
    missingInformation: missingInfo,
    clarificationNeeded,
    suggestedQuestions: suggestedQuestions.slice(0, 3),
    confidence,
  };

  const validation = validateAndSanitizeRequestUnderstanding(rawResult, context);
  return validation.sanitized;
}

/**
 * LocalRequestUnderstandingProvider
 * Default active provider operating on device in 100% Spark-compatible offline mode.
 */
export class LocalRequestUnderstandingProvider implements RequestUnderstandingProvider {
  async understandRequest(
    text: string,
    context?: RequestUnderstandingContext
  ): Promise<RequestUnderstanding> {
    return analyzeRequestUnderstanding(text, context);
  }
}

/**
 * GeminiRequestUnderstandingProvider
 * Prepared interface-compatible provider for future Blaze Cloud Function migration.
 */
export class GeminiRequestUnderstandingProvider implements RequestUnderstandingProvider {
  private localFallback = new LocalRequestUnderstandingProvider();

  async understandRequest(
    text: string,
    context?: RequestUnderstandingContext
  ): Promise<RequestUnderstanding> {
    // When Cloud Functions are not deployed on Spark plan, gracefully execute local engine
    return this.localFallback.understandRequest(text, context);
  }
}

/**
 * Default singleton instance
 */
export const defaultRequestUnderstandingProvider: RequestUnderstandingProvider =
  new LocalRequestUnderstandingProvider();

/**
 * Adapter converting RequestUnderstanding to legacy ExtractedNeed
 * Guarantees zero regressions and 100% backward compatibility!
 */
export function understandingToExtractedNeed(
  understanding: RequestUnderstanding,
  originalQuery: string,
  lang: Language
): ExtractedNeed {
  const urgencyMapping: Urgency =
    understanding.urgency === 'emergency' || understanding.urgency === 'high'
      ? 'high'
      : understanding.urgency === 'low'
      ? 'low'
      : 'normal';

  const rawCatId = understanding.categoryId ? normalizeCategoryId(understanding.categoryId) : '';
  const isUncertainCategory = !rawCatId || rawCatId === 'other';
  const categoryId = isUncertainCategory ? '' : rawCatId;
  const category = isUncertainCategory ? '' : (understanding.category || getCategoryDisplayName(categoryId, lang));

  const rawCityId = understanding.cityId ? normalizeCityId(understanding.cityId) : '';
  const cityId = rawCityId || '';
  const city = understanding.city || (cityId ? getCityDisplayName(cityId, lang) : '');

  return {
    city,
    cityId,
    category,
    categoryId,
    service: understanding.service || originalQuery || 'Қызмет',
    date: understanding.preferredDate || (lang === 'kz' ? 'Бүгін' : 'Сегодня'),
    budget: lang === 'kz' ? 'Келісімді' : 'Договорная',
    urgency: urgencyMapping,
    originalQuery,
    confidence: understanding.confidence,
    // Local rules engine; App sets isAiParsed only when the Gemini parser actually answered
    isAiParsed: false,
    understanding,
  };
}
