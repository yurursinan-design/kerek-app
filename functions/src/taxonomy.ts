/**
 * Canonical taxonomy definitions for KEREK backend.
 * Aligns 1:1 with frontend canonical sources (src/services/taxonomy.ts).
 */

export interface CanonicalCategory {
  id: string;
  nameRu: string;
  nameKz: string;
  description: string;
}

export interface CanonicalCity {
  id: string;
  nameRu: string;
  nameKz: string;
}

export const CANONICAL_CATEGORIES: readonly CanonicalCategory[] = [
  {
    id: 'plumbing',
    nameRu: 'Сантехника и канализация',
    nameKz: 'Сантехника және құбырлар',
    description: 'Устранение засоров, замена кранов, труб, унитазов, смесителей',
  },
  {
    id: 'electrician',
    nameRu: 'Электрика и монтаж',
    nameKz: 'Электрик және тоқ желісі',
    description: 'Розетки, проводка, люстры, выключатели, устранение короткого замыкания',
  },
  {
    id: 'heating_boiler',
    nameRu: 'Отопление и котлы',
    nameKz: 'Жылыту және қазандықтар',
    description: 'Котлы, система отопления, радиаторы, аристоны, байпасы, печи',
  },
  {
    id: 'ac_ventilation',
    nameRu: 'Кондиционеры и вентиляция',
    nameKz: 'Кондиционерлер мен желдету',
    description: 'Установка и чистка кондиционеров, заправка фреоном, вентиляция',
  },
  {
    id: 'appliances',
    nameRu: 'Ремонт бытовой техники',
    nameKz: 'Тұрмыстық техника жөндеу',
    description: 'Стиральные машины, холодильники, пылесосы, духовки, плиты',
  },
  {
    id: 'furniture_carpentry',
    nameRu: 'Сборка мебели',
    nameKz: 'Жиһаз құрастыру',
    description: 'Сборка шкафов, кроватей, столов, ремонт мебели, плотницкие работы',
  },
  {
    id: 'painting_finishing',
    nameRu: 'Малярные работы и ремонт',
    nameKz: 'Бояу және жөндеу',
    description: 'Покраска стен, поклейка обоев, штукатурка, кафель, ремонт квартир',
  },
  {
    id: 'cleaning_moving',
    nameRu: 'Уборка и переезд',
    nameKz: 'Тазалау және көшу',
    description: 'Уборка квартир, клининг, грузоперевозки, Газель, переезд, грузчики',
  },
] as const;

export const CANONICAL_CITIES: readonly CanonicalCity[] = [
  { id: 'kyzylorda', nameRu: 'Кызылорда', nameKz: 'Қызылорда' },
  { id: 'almaty', nameRu: 'Алматы', nameKz: 'Алматы' },
  { id: 'astana', nameRu: 'Астана', nameKz: 'Астана' },
  { id: 'shymkent', nameRu: 'Шымкент', nameKz: 'Шымкент' },
  { id: 'aktobe', nameRu: 'Актобе', nameKz: 'Ақтөбе' },
  { id: 'karaganda', nameRu: 'Караганда', nameKz: 'Қарағанды' },
  { id: 'taraz', nameRu: 'Тараз', nameKz: 'Тараз' },
  { id: 'pavlodar', nameRu: 'Павлодар', nameKz: 'Павлодар' },
  { id: 'oskemen', nameRu: 'Усть-Каменогорск', nameKz: 'Өскемен' },
  { id: 'semey', nameRu: 'Семей', nameKz: 'Семей' },
  { id: 'atyrau', nameRu: 'Атырау', nameKz: 'Атырау' },
  { id: 'aktau', nameRu: 'Актау', nameKz: 'Ақтау' },
  { id: 'kostanay', nameRu: 'Костанай', nameKz: 'Қостанай' },
  { id: 'oral', nameRu: 'Уральск', nameKz: 'Орал' },
  { id: 'turkestan', nameRu: 'Туркестан', nameKz: 'Түркістан' },
  { id: 'kokshetau', nameRu: 'Кокшетау', nameKz: 'Көкшетау' },
] as const;

export const CANONICAL_CATEGORY_IDS = new Set<string>(
  CANONICAL_CATEGORIES.map((c) => c.id)
);

export const CANONICAL_CITY_IDS = new Set<string>(
  CANONICAL_CITIES.map((c) => c.id)
);

/**
 * Validates and normalizes category ID received from Gemini.
 * Returns valid canonical categoryId or null if invalid/unrecognized.
 */
export function validateAndNormalizeCategoryId(rawCategory?: unknown): string | null {
  if (typeof rawCategory !== 'string' || !rawCategory.trim()) {
    return null;
  }
  const clean = rawCategory.trim().toLowerCase();

  // 1. Direct ID match
  if (CANONICAL_CATEGORY_IDS.has(clean)) {
    return clean;
  }

  // 2. Backward compatibility & common aliases
  if (clean === 'appliance_repair' || clean === 'appliances_repair' || clean === 'appliance' || clean === 'бытовая техника' || clean === 'тұрмыстық техника') {
    return 'appliances';
  }
  if (clean === 'home_services' || clean === 'home_service' || clean === 'plumber' || clean === 'сантехник') {
    return 'plumbing';
  }
  if (clean === 'cargo_moving' || clean === 'cargo' || clean === 'moving' || clean === 'грузоперевозки' || clean === 'жүк тасымалдау' || clean === 'cleaning') {
    return 'cleaning_moving';
  }
  if (clean === 'electronics') {
    return 'appliances';
  }
  if (clean === 'auto') {
    return 'plumbing';
  }
  if (clean === 'другое' || clean === 'басқа' || clean === 'misc') {
    return 'other';
  }

  // Reject unrecognized category ID
  return null;
}

/**
 * Validates and normalizes city ID received from Gemini.
 * Returns valid canonical cityId or null if invalid/unrecognized.
 */
export function validateAndNormalizeCityId(rawCity?: unknown): string | null {
  if (typeof rawCity !== 'string' || !rawCity.trim()) {
    return null;
  }
  const clean = rawCity.trim().toLowerCase();

  // 1. Direct ID match
  if (CANONICAL_CITY_IDS.has(clean)) {
    return clean;
  }

  // 2. City name aliases in Russian / Kazakh / Cyrillic
  const cityMap: Record<string, string> = {
    'кызылорда': 'kyzylorda',
    'қызылорда': 'kyzylorda',
    'кзо': 'kyzylorda',
    'алматы': 'almaty',
    'алма-ата': 'almaty',
    'астана': 'astana',
    'нур-султан': 'astana',
    'шымкент': 'shymkent',
    'чимкент': 'shymkent',
    'актобе': 'aktobe',
    'ақтөбе': 'aktobe',
    'караганда': 'karaganda',
    'қарағанды': 'karaganda',
    'тараз': 'taraz',
    'павлодар': 'pavlodar',
    'усть-каменогорск': 'oskemen',
    'өскемен': 'oskemen',
    'семей': 'semey',
    'семипалатинск': 'semey',
    'атырау': 'atyrau',
    'актау': 'aktau',
    'ақтау': 'aktau',
    'костанай': 'kostanay',
    'қостанай': 'kostanay',
    'уральск': 'oral',
    'орал': 'oral',
    'туркестан': 'turkestan',
    'түркістан': 'turkestan',
    'кокшетау': 'kokshetau',
    'көкшетау': 'kokshetau',
  };

  if (cityMap[clean]) {
    return cityMap[clean];
  }

  // Reject unrecognized city ID
  return null;
}
