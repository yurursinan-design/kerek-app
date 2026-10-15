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
    nameRu: 'Уборка и клининг',
    nameKz: 'Тазалау',
    description: 'Уборка квартир и офисов, генеральная уборка, химчистка мебели, стирка ковров, мойка окон, дезинсекция',
  },
  // Groups from the full service catalogue (src/data/serviceCatalog.ts)
  { id: 'construction', nameRu: 'Строительство', nameKz: 'Құрылыс', description: 'Кладка, строительство дома, кровля, бетон и фундамент, сварка, окна, двери, фасад, заборы, бани' },
  { id: 'moving', nameRu: 'Переезд и грузоперевозки', nameKz: 'Көшу және жүк тасымалы', description: 'Квартирный и офисный переезд, Газель, грузчики, курьер и доставка, вывоз мусора' },
  { id: 'household', nameRu: 'Мастер на час', nameKz: 'Үй шебері', description: 'Мастер на час, замки, повесить полку или карниз, пошив и ремонт одежды, ремонт обуви, ключи, шторы' },
  { id: 'auto', nameRu: 'Автоуслуги', nameKz: 'Автоқызметтер', description: 'Ремонт авто, эвакуатор, шиномонтаж, автомойка, прикурить, автоэлектрик, диагностика, кузовной ремонт' },
  { id: 'beauty', nameRu: 'Красота и здоровье', nameKz: 'Сұлулық және денсаулық', description: 'Парикмахер на дом, маникюр, визажист, ресницы и брови, массаж, косметолог, медсестра, тренер' },
  { id: 'tutoring', nameRu: 'Репетиторы и обучение', nameKz: 'Репетиторлар және оқыту', description: 'Математика, языки, подготовка к ЕНТ и школе, физика, химия, музыка, автоинструктор, программирование' },
  { id: 'events', nameRu: 'Праздники и мероприятия', nameKz: 'Мерекелер және іс-шаралар', description: 'Фотограф, видеооператор, тамада, организация тоя и свадьбы, кейтеринг, торты, DJ, аниматоры, оформление' },
  { id: 'it_digital', nameRu: 'Компьютеры и IT', nameKz: 'Компьютер және IT', description: 'Ремонт компьютеров и ноутбуков, Windows, Wi-Fi и роутер, сайты, дизайн, SMM, принтеры' },
  { id: 'care', nameRu: 'Няни и сиделки', nameKz: 'Бала және қарт күтімі', description: 'Няня, сиделка, домработница, повар на дом' },
  { id: 'pets', nameRu: 'Домашние животные', nameKz: 'Үй жануарлары', description: 'Ветеринар на дом, груминг, выгул собак, передержка животных' },
  { id: 'garden', nameRu: 'Сад и двор', nameKz: 'Бақ және аула', description: 'Уход за садом, спил деревьев, уборка снега, ландшафт, скважины, септики, бассейны' },
  { id: 'business', nameRu: 'Юристы и бухгалтеры', nameKz: 'Заң және бухгалтерия', description: 'Юрист, бухгалтер, регистрация ИП и ТОО, переводы, риелтор' },
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
  { id: 'petropavl', nameRu: 'Петропавловск', nameKz: 'Петропавл' },
  { id: 'taldykorgan', nameRu: 'Талдыкорган', nameKz: 'Талдықорған' },
  { id: 'zhezkazgan', nameRu: 'Жезказган', nameKz: 'Жезқазған' },
  { id: 'ekibastuz', nameRu: 'Экибастуз', nameKz: 'Екібастұз' },
  { id: 'temirtau', nameRu: 'Темиртау', nameKz: 'Теміртау' },
  { id: 'konaev', nameRu: 'Конаев', nameKz: 'Қонаев' },
  { id: 'kaskelen', nameRu: 'Каскелен', nameKz: 'Қаскелең' },
  { id: 'talgar', nameRu: 'Талгар', nameKz: 'Талғар' },
  { id: 'rudny', nameRu: 'Рудный', nameKz: 'Рудный' },
  { id: 'zhanaozen', nameRu: 'Жанаозен', nameKz: 'Жаңаөзен' },
  { id: 'balkhash', nameRu: 'Балхаш', nameKz: 'Балқаш' },
  { id: 'satbayev', nameRu: 'Сатпаев', nameKz: 'Сәтбаев' },
  { id: 'kentau', nameRu: 'Кентау', nameKz: 'Кентау' },
  { id: 'stepnogorsk', nameRu: 'Степногорск', nameKz: 'Степногорск' },
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
  if (clean === 'cargo_moving' || clean === 'cargo' || clean === 'грузоперевозки' || clean === 'жүк тасымалдау') {
    return 'moving';
  }
  if (clean === 'cleaning') {
    return 'cleaning_moving';
  }
  if (clean === 'electronics') {
    return 'appliances';
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
