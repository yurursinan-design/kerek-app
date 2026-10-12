import { Language } from '../types';
import { SERVICE_CATALOG, getGroup } from '../data/serviceCatalog';

export interface CategoryDefinition {
  id: string;
  nameKz: string;
  nameRu: string;
  nameTr?: string;
  patterns: RegExp[];
}

export interface CityDefinition {
  id: string;
  nameKz: string;
  nameRu: string;
  nameTr?: string;
  patterns: RegExp[];
}

export const CANONICAL_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'plumbing',
    nameKz: 'Сантехника және құбырлар',
    nameRu: 'Сантехника и канализация',
    nameTr: 'Su Tesisatı & Kanalizasyon',
    patterns: [
      /plumbing/i,
      /home_services/i,
      /сантехник/i,
      /сантехника/i,
      /труба/i,
      /құбыр/i,
      /шүмек/i,
      /смеситель/i,
      /канализаци/i,
      /засор/i,
      /прочистка/i,
      /раковин/i,
      /унитаз/i,
      /(?:^|[^\p{L}\d])кран[а-яё]*(?:[^\p{L}\d]|$)/iu,
    ],
  },
  {
    id: 'electrician',
    nameKz: 'Электрик және тоқ желісі',
    nameRu: 'Электрика и монтаж',
    nameTr: 'Elektrik Tesisatı & Arıza',
    patterns: [
      /electrician/i,
      /электрик/i,
      /электрика/i,
      /розетк/i,
      /проводк/i,
      /жарық/i,
      /свет/i,
      /люстр/i,
      /замыкание/i,
      /монтаж/i,
      /выключател/i,
    ],
  },
  {
    id: 'heating_boiler',
    nameKz: 'Жылыту және қазандықтар',
    nameRu: 'Отопление и котлы',
    nameTr: 'Kombi, Şofben & Isıtma',
    patterns: [
      /heating_boiler/i,
      /heating/i,
      /boiler/i,
      /котел/i,
      /котёл/i,
      /қазандық/i,
      /отоплени/i,
      /жылыту/i,
      /аристон/i,
      /байпасс/i,
      /байпас/i,
      /батарея/i,
      /печь/i,
      /печка/i,
      /радиатор/i,
      /тепло/i,
      /отопител/i,
      /kombi/i,
      /комби/i,
      /колонка/i,
      /газовая колонка/i,
      /су жылытқыш/i,
    ],
  },
  {
    id: 'ac_ventilation',
    nameKz: 'Кондиционерлер мен желдету',
    nameRu: 'Кондиционеры и вентиляция',
    nameTr: 'Klima & Havalandırma',
    patterns: [
      /ac_ventilation/i,
      /кондиционер/i,
      /фреон/i,
      /сплит/i,
      /салқындатқыш/i,
      /чистка кондиционера/i,
      /заправка кондиционер/i,
      /вентиляци/i,
      /климат/i,
    ],
  },
  {
    id: 'appliances',
    nameKz: 'Тұрмыстық техника жөндеу',
    nameRu: 'Ремонт бытовой техники',
    nameTr: 'Beyaz Eşya Tamiri',
    patterns: [
      /appliances?_repair/i,
      /appliances/i,
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
      /пылесос/i,
      /плита/i,
      /посудомойк/i,
      /dishwasher/i,
      /микроволновк/i,
      /духовк/i,
      /electronics/i,
      /смартфон/i,
      /телефон/i,
      /ноутбук/i,
    ],
  },
  {
    id: 'furniture_carpentry',
    nameKz: 'Жиһаз құрастыру',
    nameRu: 'Сборка мебели',
    nameTr: 'Mobilya Montajı & Marangozluk',
    patterns: [
      /furniture_carpentry/i,
      /furniture/i,
      /carpentry/i,
      /жиһаз/i,
      /мебель/i,
      /сборка мебели/i,
      /жиһаз құрастыру/i,
      /шкаф/i,
      /стол/i,
      /диван/i,
      /кровать/i,
      /плотник/i,
      /столяр/i,
      /ағаш шебері/i,
    ],
  },
  {
    id: 'painting_finishing',
    nameKz: 'Бояу және жөндеу',
    nameRu: 'Малярные работы и ремонт',
    nameTr: 'Boya, Badana & Tadilat',
    patterns: [
      /painting_finishing/i,
      /painting/i,
      /finishing/i,
      /маляр/i,
      /покраска/i,
      /бояу/i,
      /штукатурк/i,
      /шпатлевк/i,
      /обои/i,
      /тушкағаз/i,
      /пәтер жөндеу/i,
      /ремонт квартир/i,
      /кафель/i,
      /плитка/i,
    ],
  },
  {
    id: 'cleaning_moving',
    nameKz: 'Тазалау және көшу',
    nameRu: 'Уборка и переезд',
    nameTr: 'Temizlik & Taşıma',
    patterns: [
      /cleaning_moving/i,
      /cleaning/i,
      /тазалау/i,
      /клининг/i,
      /уборка/i,
    ],
  },
  // Groups added with the full service catalogue. They match by id or name here; free text is
  // matched to them through the catalogue keywords (detectCatalogService).
  ...SERVICE_CATALOG.filter(
    (g) =>
      !['plumbing', 'electrician', 'heating_boiler', 'ac_ventilation', 'appliances', 'furniture_carpentry', 'painting_finishing', 'cleaning_moving'].includes(g.id)
  ).map((g) => ({
    id: g.id,
    nameKz: g.kz,
    nameRu: g.ru,
    patterns: [new RegExp(`^${g.id}$`, 'i')],
  })),
];

export const CANONICAL_CITIES: CityDefinition[] = [
  {
    id: 'kyzylorda',
    nameKz: 'Қызылорда',
    nameRu: 'Кызылорда',
    nameTr: 'Kızılorda',
    patterns: [/kyzylord[a-zа-яё]*|kızılord[a-zа-яё]*|kizilord[a-zа-яё]*|қызылорд[а-яёқ]*|кызылорд[а-яё]*|\bкзо\b/i],
  },
  {
    id: 'almaty',
    nameKz: 'Алматы',
    nameRu: 'Алматы',
    nameTr: 'Almatı',
    patterns: [/almat[a-zа-яё]*|алмат[а-яё]*|алма-ат[а-яё]*/i],
  },
  {
    id: 'astana',
    nameKz: 'Астана',
    nameRu: 'Астана',
    nameTr: 'Astana',
    patterns: [/astan[a-zа-яё]*|астан[а-яё]*|нур-султан/i],
  },
  {
    id: 'shymkent',
    nameKz: 'Шымкент',
    nameRu: 'Шымкент',
    nameTr: 'Çimkent',
    patterns: [/shymkent[a-zа-яё]*|шымкент[а-яё]*|чимкент[а-яё]*/i],
  },
  {
    id: 'aktobe',
    nameKz: 'Ақтөбе',
    nameRu: 'Актобе',
    nameTr: 'Aktöbe',
    patterns: [/aktob[a-zа-яё]*|ақтөб[а-яё]*|актоб[а-яё]*/i],
  },
  {
    id: 'karaganda',
    nameKz: 'Қарағанды',
    nameRu: 'Караганда',
    nameTr: 'Karaganda',
    patterns: [/karagand[a-zа-яё]*|қарағанд[а-яёқ]*|караганд[а-яё]*/i],
  },
  {
    id: 'taraz',
    nameKz: 'Тараз',
    nameRu: 'Тараз',
    nameTr: 'Taraz',
    patterns: [/taraz[a-zа-яё]*|тараз[а-яё]*/i],
  },
  {
    id: 'pavlodar',
    nameKz: 'Павлодар',
    nameRu: 'Павлодар',
    nameTr: 'Pavlodar',
    patterns: [/pavlodar[a-zа-яё]*|павлодар[а-яё]*/i],
  },
  {
    id: 'oskemen',
    nameKz: 'Өскемен',
    nameRu: 'Усть-Каменогорск',
    nameTr: 'Öskemen',
    patterns: [/oskemen[a-zа-яё]*|өскемен[а-яё]*|усть-каменогорск[а-яё]*/i],
  },
  {
    id: 'semey',
    nameKz: 'Семей',
    nameRu: 'Семей',
    nameTr: 'Semey',
    patterns: [/semey[a-zа-яё]*|семей[а-яё]*|семипалатинск[а-яё]*/i],
  },
  {
    id: 'atyrau',
    nameKz: 'Атырау',
    nameRu: 'Атырау',
    nameTr: 'Atırav',
    patterns: [/atyrau[a-zа-яё]*|атырау[а-яё]*/i],
  },
  {
    id: 'aktau',
    nameKz: 'Ақтау',
    nameRu: 'Актау',
    nameTr: 'Aktav',
    patterns: [/aktau[a-zа-яё]*|ақтау[а-яё]*|актау[а-яё]*/i],
  },
  {
    id: 'kostanay',
    nameKz: 'Қостанай',
    nameRu: 'Костанай',
    nameTr: 'Kostanay',
    patterns: [/kostana[a-zа-яё]*|қостанай[а-яё]*|костанай[а-яё]*|костанае/i],
  },
  {
    id: 'oral',
    nameKz: 'Орал',
    nameRu: 'Уральск',
    nameTr: 'Oral',
    patterns: [/oral[a-zа-яё]*|орал[а-яё]*|уральск[а-яё]*/i],
  },
  {
    id: 'turkestan',
    nameKz: 'Түркістан',
    nameRu: 'Туркестан',
    nameTr: 'Türkistan',
    patterns: [/turkestan[a-zа-яё]*|түркістан[а-яё]*|туркестан[а-яё]*/i],
  },
  {
    id: 'kokshetau',
    nameKz: 'Көкшетау',
    nameRu: 'Кокшетау',
    nameTr: 'Kökşetav',
    patterns: [/kokshetau[a-zа-яё]*|көкшетау[а-яё]*|кокшетау[а-яё]*/i],
  },
  {
    id: 'petropavl',
    nameKz: 'Петропавл',
    nameRu: 'Петропавловск',
    patterns: [/petropavl[a-zа-яё]*|петропавл[а-яё]*/i],
  },
  {
    id: 'taldykorgan',
    nameKz: 'Талдықорған',
    nameRu: 'Талдыкорган',
    patterns: [/taldyk[a-z]*|талдық[а-яёғ]*|талдык[а-яё]*/i],
  },
  {
    id: 'zhezkazgan',
    nameKz: 'Жезқазған',
    nameRu: 'Жезказган',
    patterns: [/zhezk[a-z]*|жезқ[а-яёғ]*|жезк[а-яё]*/i],
  },
  {
    id: 'ekibastuz',
    nameKz: 'Екібастұз',
    nameRu: 'Экибастуз',
    patterns: [/ekibast[a-z]*|екібаст[а-яёұ]*|экибаст[а-яё]*/i],
  },
  {
    id: 'temirtau',
    nameKz: 'Теміртау',
    nameRu: 'Темиртау',
    patterns: [/temirt[a-z]*|теміртау[а-яё]*|темиртау[а-яё]*/i],
  },
  {
    id: 'konaev',
    nameKz: 'Қонаев',
    nameRu: 'Конаев',
    patterns: [/kona[ey]e?v[a-z]*|қонаев[а-яё]*|конаев[а-яё]*|капчага[а-яё]*|қапшағ[а-яё]*/i],
  },
  {
    id: 'kaskelen',
    nameKz: 'Қаскелең',
    nameRu: 'Каскелен',
    patterns: [/kaskelen[a-z]*|қаскелең[а-яё]*|каскелен[а-яё]*/i],
  },
  {
    id: 'talgar',
    nameKz: 'Талғар',
    nameRu: 'Талгар',
    patterns: [/talgar[a-z]*|талғар[а-яё]*|талгар[а-яё]*/i],
  },
  {
    id: 'rudny',
    nameKz: 'Рудный',
    nameRu: 'Рудный',
    patterns: [/rudn[a-z]*|рудн[а-яё]*/i],
  },
  {
    id: 'zhanaozen',
    nameKz: 'Жаңаөзен',
    nameRu: 'Жанаозен',
    patterns: [/zhanaoz[a-z]*|жаңаөз[а-яё]*|жанаоз[а-яё]*/i],
  },
  {
    id: 'balkhash',
    nameKz: 'Балқаш',
    nameRu: 'Балхаш',
    patterns: [/balkh?ash[a-z]*|балқаш[а-яё]*|балхаш[а-яё]*/i],
  },
  {
    id: 'satbayev',
    nameKz: 'Сәтбаев',
    nameRu: 'Сатпаев',
    patterns: [/satba?y?ev[a-z]*|сәтбаев[а-яё]*|сатпаев[а-яё]*/i],
  },
  {
    id: 'kentau',
    nameKz: 'Кентау',
    nameRu: 'Кентау',
    patterns: [/kentau[a-z]*|кентау[а-яё]*/i],
  },
  {
    id: 'stepnogorsk',
    nameKz: 'Степногорск',
    nameRu: 'Степногорск',
    patterns: [/stepnogorsk[a-z]*|степногорск[а-яё]*/i],
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
  if (
    clean === 'appliance_repair' ||
    clean === 'appliances_repair' ||
    clean === 'appliances' ||
    clean === 'appliance'
  ) {
    return 'appliances';
  }
  if (clean === 'home_service' || clean === 'home_services') {
    return 'home_services';
  }
  if (clean === 'cargo' || clean === 'cargo_moving' || clean === 'moving') {
    return 'moving';
  }

  // 1. Direct ID match
  const exact = CANONICAL_CATEGORIES.find((c) => c.id === clean);
  if (exact) return exact.id;

  // 1b. Catalogue group names (the current display names)
  const byGroupName = SERVICE_CATALOG.find((g) => g.kz.toLowerCase() === clean || g.ru.toLowerCase() === clean);
  if (byGroupName) return byGroupName.id;

  // 2. Pattern and name match
  for (const cat of CANONICAL_CATEGORIES) {
    if (
      clean === cat.nameKz.toLowerCase() ||
      clean === cat.nameRu.toLowerCase() ||
      (cat.nameTr && clean === cat.nameTr.toLowerCase())
    ) {
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
export function getCategoryDisplayName(categoryId: string | undefined, lang: Language): string {
  if (!categoryId) {
    if (lang === 'tr') return 'Genel Hizmet';
    return lang === 'kz' ? 'Жалпы қызмет' : 'Общие услуги';
  }
  const normId = normalizeCategoryId(categoryId);
  let found = CANONICAL_CATEGORIES.find((c) => c.id === normId || c.id === categoryId);
  if (!found) {
    if (normId === 'appliance_repair' || categoryId === 'appliance_repair') {
      found = CANONICAL_CATEGORIES.find((c) => c.id === 'appliances');
    } else if (normId === 'home_services' || categoryId === 'home_services') {
      found = CANONICAL_CATEGORIES.find((c) => c.id === 'plumbing');
    } else if (normId === 'cargo_moving' || categoryId === 'cargo_moving') {
      found = CANONICAL_CATEGORIES.find((c) => c.id === 'moving');
    }
  }
  // Names from the service catalogue (broader group names) take precedence
  const group = getGroup(found ? found.id : normId);
  if (group && lang !== 'tr') return lang === 'kz' ? group.kz : group.ru;
  if (!found) {
    return categoryId;
  }
  if (lang === 'tr') return found.nameTr || found.nameRu;
  return lang === 'kz' ? found.nameKz : found.nameRu;
}

/**
 * Returns localized display name for a canonical cityId.
 */
export function getCityDisplayName(cityId: string | undefined, lang: Language): string {
  if (!cityId) {
    if (lang === 'tr') return 'Belirtilmemiş Şehir';
    return lang === 'kz' ? 'Белгісіз қала' : 'Неуказанный город';
  }
  const normId = normalizeCityId(cityId);
  if (!normId) return cityId;
  const found = CANONICAL_CITIES.find((c) => c.id === normId);
  if (!found) return cityId;
  if (lang === 'tr') return found.nameTr || found.nameRu;
  return lang === 'kz' ? found.nameKz : found.nameRu;
}

/**
 * Canonical equality check for categories
 */
export function isCategoryMatch(cat1?: string, cat2?: string): boolean {
  if (!cat1 || !cat2) return false;
  const c1 = cat1.trim().toLowerCase();
  const c2 = cat2.trim().toLowerCase();

  if (c1 === c2) return true;

  const n1 = normalizeCategoryId(c1);
  const n2 = normalizeCategoryId(c2);

  if (n1 === n2) return true;

  // Cross-alias bridges between legacy IDs and 8 focus category IDs
  const isAppl1 = n1 === 'appliances' || n1 === 'appliance_repair' || c1.includes('appliance');
  const isAppl2 = n2 === 'appliances' || n2 === 'appliance_repair' || c2.includes('appliance');
  if (isAppl1 && isAppl2) return true;

  const isPlumb1 = n1 === 'plumbing' || n1 === 'home_services';
  const isPlumb2 = n2 === 'plumbing' || n2 === 'home_services';
  if (isPlumb1 && isPlumb2) return true;

  const isElec1 = n1 === 'electrician' || n1 === 'home_services';
  const isElec2 = n2 === 'electrician' || n2 === 'home_services';
  if (isElec1 && isElec2) return true;

  const isMove1 = n1 === 'cleaning_moving' || n1 === 'cargo_moving' || n1 === 'cleaning';
  const isMove2 = n2 === 'cleaning_moving' || n2 === 'cargo_moving' || n2 === 'cleaning';
  if (isMove1 && isMove2) return true;

  return false;
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

/**
 * Best catalogue service for a free-text request: the service whose keywords match the most
 * characters of the text (longer, more specific keywords win). `withinGroup` limits the search.
 */
export function detectCatalogService(
  text: string,
  withinGroup?: string
): { groupId: string; serviceId: string } | undefined {
  const t = ` ${(text || '').toLowerCase()} `;
  let best: { groupId: string; serviceId: string; score: number } | undefined;
  for (const group of SERVICE_CATALOG) {
    if (withinGroup && group.id !== withinGroup) continue;
    for (const service of group.services) {
      let score = 0;
      for (const k of service.keywords || []) {
        if (t.includes(k)) score += k.trim().length;
      }
      for (const name of [service.kz, service.ru]) {
        if (t.includes(name.toLowerCase())) score += name.length;
      }
      if (score > 0 && (!best || score > best.score)) best = { groupId: group.id, serviceId: service.id, score };
    }
  }
  return best ? { groupId: best.groupId, serviceId: best.serviceId } : undefined;
}
