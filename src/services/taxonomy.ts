import { Language } from '../types';

export interface CategoryDefinition {
  id: string;
  nameKz: string;
  nameRu: string;
  patterns: RegExp[];
}

export interface CityDefinition {
  id: string;
  nameKz: string;
  nameRu: string;
  patterns: RegExp[];
}

export const CANONICAL_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'appliance_repair',
    nameKz: 'Тұрмыстық техника жөндеу',
    nameRu: 'Ремонт бытовой техники',
    patterns: [
      /appliances?_repair/i,
      /тұрмыстық техника/i,
      /бытовая техника/i,
      /бытовой техники/i,
      /ремонт бытовой техники/i,
      /ремонт техники/i,
      /кір жуғыш/i,
      /стирал/i,
      /тоңазытқыш/i,
      /холодильник/i,
      /бойлер/i,
      /пылесос/i,
      /плита/i,
    ],
  },
  {
    id: 'home_services',
    nameKz: 'Тұрмыстық қызметтер (Сантехник, Электрик)',
    nameRu: 'Бытовые услуги (Сантехник, Электрик)',
    patterns: [
      /home_services/i,
      /тұрмыстық қызметтер/i,
      /бытовые услуги/i,
      /сантехник/i,
      /сантехника/i,
      /электрик/i,
      /труба/i,
      /құбыр/i,
      /кран/i,
      /розетк/i,
      /проводк/i,
      /свет/i,
    ],
  },
  {
    id: 'cargo_moving',
    nameKz: 'Жүк тасымалдау және көшу',
    nameRu: 'Грузоперевозки и переезд',
    patterns: [
      /cargo_moving/i,
      /жүк тасымалдау/i,
      /грузоперевозк/i,
      /переезд/i,
      /көшу/i,
      /газель/i,
      /грузчик/i,
    ],
  },
  {
    id: 'electronics',
    nameKz: 'Электроника және гаджеттер',
    nameRu: 'Электроника и покупка техники',
    patterns: [
      /electronics/i,
      /электроника/i,
      /смартфон/i,
      /телефон/i,
      /гаджет/i,
      /ноутбук/i,
      /айфон/i,
      /iphone/i,
    ],
  },
  {
    id: 'cleaning',
    nameKz: 'Тазалық қызметі (Клининг)',
    nameRu: 'Клининг и уборка',
    patterns: [
      /cleaning/i,
      /клининг/i,
      /уборка/i,
      /тазалық/i,
      /мойка/i,
      /кілем жуу/i,
    ],
  },
  {
    id: 'auto',
    nameKz: 'Автокөмек және эвакуатор',
    nameRu: 'Автоуслуги и эвакуатор',
    patterns: [
      /auto/i,
      /авто/i,
      /эвакуатор/i,
      /сто/i,
      /шина/i,
      /дөңгелек/i,
    ],
  },
  {
    id: 'other',
    nameKz: 'Басқа қызметтер',
    nameRu: 'Другие услуги',
    patterns: [
      /other/i,
      /басқа/i,
      /другие/i,
      /қызметтер мен тауарлар/i,
      /услуги и товары/i,
    ],
  },
];

export const CANONICAL_CITIES: CityDefinition[] = [
  {
    id: 'kyzylorda',
    nameKz: 'Қызылорда',
    nameRu: 'Кызылорда',
    patterns: [/kyzylorda/i, /қызылорда/i, /кызылорда/i, /кзо/i],
  },
  {
    id: 'almaty',
    nameKz: 'Алматы',
    nameRu: 'Алматы',
    patterns: [/almaty/i, /алматы/i, /алма-ата/i],
  },
  {
    id: 'astana',
    nameKz: 'Астана',
    nameRu: 'Астана',
    patterns: [/astana/i, /астана/i, /нур-султан/i],
  },
  {
    id: 'shymkent',
    nameKz: 'Шымкент',
    nameRu: 'Шымкент',
    patterns: [/shymkent/i, /шымкент/i, /чимкент/i],
  },
  {
    id: 'aktobe',
    nameKz: 'Ақтөбе',
    nameRu: 'Актобе',
    patterns: [/aktobe/i, /ақтөбе/i, /актобе/i],
  },
  {
    id: 'karaganda',
    nameKz: 'Қарағанды',
    nameRu: 'Караганда',
    patterns: [/karaganda/i, /қарағанды/i, /караганда/i],
  },
  {
    id: 'taraz',
    nameKz: 'Тараз',
    nameRu: 'Тараз',
    patterns: [/taraz/i, /тараз/i],
  },
  {
    id: 'pavlodar',
    nameKz: 'Павлодар',
    nameRu: 'Павлодар',
    patterns: [/pavlodar/i, /павлодар/i],
  },
  {
    id: 'oskemen',
    nameKz: 'Өскемен',
    nameRu: 'Усть-Каменогорск',
    patterns: [/oskemen/i, /өскемен/i, /усть-каменогорск/i],
  },
  {
    id: 'semey',
    nameKz: 'Семей',
    nameRu: 'Семей',
    patterns: [/semey/i, /семей/i, /семипалатинск/i],
  },
  {
    id: 'atyrau',
    nameKz: 'Атырау',
    nameRu: 'Атырау',
    patterns: [/atyrau/i, /атырау/i],
  },
  {
    id: 'aktau',
    nameKz: 'Ақтау',
    nameRu: 'Актау',
    patterns: [/aktau/i, /ақтау/i, /актау/i],
  },
  {
    id: 'kostanay',
    nameKz: 'Қостанай',
    nameRu: 'Костанай',
    patterns: [/kostanay/i, /қостанай/i, /костанай/i],
  },
  {
    id: 'oral',
    nameKz: 'Орал',
    nameRu: 'Уральск',
    patterns: [/oral/i, /орал/i, /уральск/i],
  },
  {
    id: 'turkestan',
    nameKz: 'Түркістан',
    nameRu: 'Туркестан',
    patterns: [/turkestan/i, /түркістан/i, /туркестан/i],
  },
  {
    id: 'kokshetau',
    nameKz: 'Көкшетау',
    nameRu: 'Кокшетау',
    patterns: [/kokshetau/i, /көкшетау/i, /кокшетау/i],
  },
];

/**
 * Maps any category string (Kazakh, Russian, or ID) to a canonical stable categoryId.
 * Guaranteed backward compatibility for legacy records without categoryId.
 */
export function normalizeCategoryId(categoryOrId?: string): string {
  if (!categoryOrId) return 'other';
  const clean = categoryOrId.trim().toLowerCase();

  // Backward compatibility alias checks
  if (clean === 'appliance_repair' || clean === 'appliances_repair') {
    return 'appliance_repair';
  }
  if (clean === 'home_service' || clean === 'home_services') {
    return 'home_services';
  }
  if (clean === 'cargo' || clean === 'cargo_moving' || clean === 'moving') {
    return 'cargo_moving';
  }

  // 1. Direct ID match
  const exact = CANONICAL_CATEGORIES.find((c) => c.id === clean);
  if (exact) return exact.id;

  // 2. Pattern and name match
  for (const cat of CANONICAL_CATEGORIES) {
    if (clean === cat.nameKz.toLowerCase() || clean === cat.nameRu.toLowerCase()) {
      return cat.id;
    }
    for (const pat of cat.patterns) {
      if (pat.test(clean)) {
        return cat.id;
      }
    }
  }

  return 'other';
}

/**
 * Maps any city string (Kazakh, Russian, or ID) to a canonical stable cityId.
 */
export function normalizeCityId(cityOrId?: string): string {
  if (!cityOrId) return 'kyzylorda';
  const clean = cityOrId.trim().toLowerCase();

  // 1. Direct ID match
  const exact = CANONICAL_CITIES.find((c) => c.id === clean);
  if (exact) return exact.id;

  // 2. Pattern and name match
  for (const c of CANONICAL_CITIES) {
    if (clean === c.nameKz.toLowerCase() || clean === c.nameRu.toLowerCase()) {
      return c.id;
    }
    for (const pat of c.patterns) {
      if (pat.test(clean)) {
        return c.id;
      }
    }
  }

  return 'kyzylorda';
}

/**
 * Returns localized display name for a canonical categoryId.
 */
export function getCategoryDisplayName(categoryId: string, lang: Language): string {
  const normId = normalizeCategoryId(categoryId);
  const found = CANONICAL_CATEGORIES.find((c) => c.id === normId);
  if (!found) return lang === 'kz' ? 'Басқа қызметтер' : 'Другие услуги';
  return lang === 'kz' ? found.nameKz : found.nameRu;
}

/**
 * Returns localized display name for a canonical cityId.
 */
export function getCityDisplayName(cityId: string, lang: Language): string {
  const normId = normalizeCityId(cityId);
  const found = CANONICAL_CITIES.find((c) => c.id === normId);
  if (!found) return lang === 'kz' ? 'Қызылорда' : 'Кызылорда';
  return lang === 'kz' ? found.nameKz : found.nameRu;
}

/**
 * Canonical equality check for categories
 */
export function isCategoryMatch(cat1?: string, cat2?: string): boolean {
  if (!cat1 || !cat2) return false;
  return normalizeCategoryId(cat1) === normalizeCategoryId(cat2);
}

/**
 * Canonical equality check for cities
 */
export function isCityMatch(city1?: string, city2?: string): boolean {
  if (!city1 || !city2) return false;
  return normalizeCityId(city1) === normalizeCityId(city2);
}
