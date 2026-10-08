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
      /washing\s*machine/i,
      /washer/i,
      /dryer/i,
      /çamaşır/i,
      /тоңазытқыш/i,
      /холодильник/i,
      /refrigerator/i,
      /fridge/i,
      /бойлер/i,
      /пылесос/i,
      /vacuum/i,
      /плита/i,
      /посудомойк/i,
      /dishwasher/i,
      /микроволновк/i,
      /духовк/i,
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
      /plumb/i,
      /труба/i,
      /құбыр/i,
      /(?:^|[^\p{L}\d])кран[а-яё]*(?:[^\p{L}\d]|$)/iu,
      /шүмек/i,
      /смеситель/i,
      /канализаци/i,
      /раковин/i,
      /унитаз/i,
      /электрик/i,
      /electric/i,
      /розетк/i,
      /проводк/i,
      /свет/i,
      /люстр/i,
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
      /көшіру/i,
      /газель/i,
      /грузчик/i,
      /moving/i,
      /cargo/i,
      /truck/i,
      /delivery/i,
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
      /phone/i,
      /smartphone/i,
      /гаджет/i,
      /ноутбук/i,
      /laptop/i,
      /компьютер/i,
      /комп/i,
      /айфон/i,
      /iphone/i,
      /дисплей/i,
      /экран/i,
      /планшет/i,
      /ipad/i,
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
      /уборк/i,
      /cleaning/i,
      /тазалық/i,
      /тазалау/i,
      /мойка/i,
      /кілем жуу/i,
      /чистк/i,
    ],
  },
  {
    id: 'auto',
    nameKz: 'Автокөмек және эвакуатор',
    nameRu: 'Автоуслуги и эвакуатор',
    patterns: [
      /auto/i,
      /авто/i,
      /автокөмек/i,
      /автоуслуг/i,
      /эвакуатор/i,
      /tow\s*truck/i,
      /сто/i,
      /шина/i,
      /шиномонтаж/i,
      /дөңгелек/i,
      /колесо/i,
      /tire/i,
      /машина жөндеу/i,
      /ремонт авто/i,
      /аккумулятор/i,
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
    patterns: [/kyzylord[a-zа-яё]*|kızılord[a-zа-яё]*|kizilord[a-zа-яё]*|қызылорд[а-яёқ]*|кызылорд[а-яё]*|\bкзо\b/i],
  },
  {
    id: 'almaty',
    nameKz: 'Алматы',
    nameRu: 'Алматы',
    patterns: [/almat[a-zа-яё]*|алмат[а-яё]*|алма-ат[а-яё]*/i],
  },
  {
    id: 'astana',
    nameKz: 'Астана',
    nameRu: 'Астана',
    patterns: [/astan[a-zа-яё]*|астан[а-яё]*|нур-султан/i],
  },
  {
    id: 'shymkent',
    nameKz: 'Шымкент',
    nameRu: 'Шымкент',
    patterns: [/shymkent[a-zа-яё]*|шымкент[а-яё]*|чимкент[а-яё]*/i],
  },
  {
    id: 'aktobe',
    nameKz: 'Ақтөбе',
    nameRu: 'Актобе',
    patterns: [/aktob[a-zа-яё]*|ақтөб[а-яё]*|актоб[а-яё]*/i],
  },
  {
    id: 'karaganda',
    nameKz: 'Қарағанды',
    nameRu: 'Караганда',
    patterns: [/karagand[a-zа-яё]*|қарағанд[а-яёқ]*|караганд[а-яё]*/i],
  },
  {
    id: 'taraz',
    nameKz: 'Тараз',
    nameRu: 'Тараз',
    patterns: [/taraz[a-zа-яё]*|тараз[а-яё]*/i],
  },
  {
    id: 'pavlodar',
    nameKz: 'Павлодар',
    nameRu: 'Павлодар',
    patterns: [/pavlodar[a-zа-яё]*|павлодар[а-яё]*/i],
  },
  {
    id: 'oskemen',
    nameKz: 'Өскемен',
    nameRu: 'Усть-Каменогорск',
    patterns: [/oskemen[a-zа-яё]*|өскемен[а-яё]*|усть-каменогорск[а-яё]*/i],
  },
  {
    id: 'semey',
    nameKz: 'Семей',
    nameRu: 'Семей',
    patterns: [/semey[a-zа-яё]*|семей[а-яё]*|семипалатинск[а-яё]*/i],
  },
  {
    id: 'atyrau',
    nameKz: 'Атырау',
    nameRu: 'Атырау',
    patterns: [/atyrau[a-zа-яё]*|атырау[а-яё]*/i],
  },
  {
    id: 'aktau',
    nameKz: 'Ақтау',
    nameRu: 'Актау',
    patterns: [/aktau[a-zа-яё]*|ақтау[а-яё]*|актау[а-яё]*/i],
  },
  {
    id: 'kostanay',
    nameKz: 'Қостанай',
    nameRu: 'Костанай',
    patterns: [/kostana[a-zа-яё]*|қостанай[а-яё]*|костанай[а-яё]*|костанае/i],
  },
  {
    id: 'oral',
    nameKz: 'Орал',
    nameRu: 'Уральск',
    patterns: [/oral[a-zа-яё]*|орал[а-яё]*|уральск[а-яё]*/i],
  },
  {
    id: 'turkestan',
    nameKz: 'Түркістан',
    nameRu: 'Туркестан',
    patterns: [/turkestan[a-zа-яё]*|түркістан[а-яё]*|туркестан[а-яё]*/i],
  },
  {
    id: 'kokshetau',
    nameKz: 'Көкшетау',
    nameRu: 'Кокшетау',
    patterns: [/kokshetau[a-zа-яё]*|көкшетау[а-яё]*|кокшетау[а-яё]*/i],
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
 * Returns undefined if city is unparsed or unknown.
 */
export function normalizeCityId(cityOrId?: string): string | undefined {
  if (!cityOrId) return undefined;
  const clean = cityOrId.trim().toLowerCase();
  if (!clean) return undefined;

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

  return undefined;
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
export function getCityDisplayName(cityId: string | undefined, lang: Language): string {
  if (!cityId) return lang === 'kz' ? 'Белгісіз қала' : 'Неуказанный город';
  const normId = normalizeCityId(cityId);
  if (!normId) return cityId;
  const found = CANONICAL_CITIES.find((c) => c.id === normId);
  if (!found) return cityId;
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
  const c1 = normalizeCityId(city1);
  const c2 = normalizeCityId(city2);
  if (!c1 || !c2) return false;
  return c1 === c2;
}
