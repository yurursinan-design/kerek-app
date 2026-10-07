import { ExtractedNeed, Language, Urgency } from '../types';
import { normalizeCategoryId, normalizeCityId } from './taxonomy';

interface CityPattern {
  nameKz: string;
  nameRu: string;
  patterns: RegExp[];
}

const CITIES: CityPattern[] = [
  {
    nameKz: 'Қызылорда',
    nameRu: 'Кызылорда',
    patterns: [/қ[ыи]з[ыи]лорда/i, /к[ыи]з[ыи]лорд/i, /kyzylorda/i],
  },
  {
    nameKz: 'Алматы',
    nameRu: 'Алматы',
    patterns: [/алмат/i, /almaty/i, /ала-ата/i, /алма-ата/i],
  },
  {
    nameKz: 'Астана',
    nameRu: 'Астана',
    patterns: [/астана/i, /astana/i, /н[ұу]р-с[ұу]лтан/i],
  },
  {
    nameKz: 'Шымкент',
    nameRu: 'Шымкент',
    patterns: [/шымкент/i, /чимкент/i, /shymkent/i],
  },
  {
    nameKz: 'Ақтөбе',
    nameRu: 'Актобе',
    patterns: [/ақтөбе/i, /акт[ое]бе/i, /aktobe/i, /актюбинск/i],
  },
  {
    nameKz: 'Қарағанды',
    nameRu: 'Караганда',
    patterns: [/қарағанд/i, /караганд/i, /karaganda/i],
  },
  {
    nameKz: 'Тараз',
    nameRu: 'Тараз',
    patterns: [/тараз/i, /taraz/i, /джамбул/i],
  },
  {
    nameKz: 'Павлодар',
    nameRu: 'Павлодар',
    patterns: [/павлодар/i, /pavlodar/i],
  },
  {
    nameKz: 'Өскемен',
    nameRu: 'Усть-Каменогорск',
    patterns: [/өскемен/i, /оскемен/i, /усть-каменогорск/i, /oskemen/i],
  },
  {
    nameKz: 'Семей',
    nameRu: 'Семей',
    patterns: [/семей/i, /семипалатинск/i, /semey/i],
  },
  {
    nameKz: 'Атырау',
    nameRu: 'Атырау',
    patterns: [/атырау/i, /atyrau/i, /гурьев/i],
  },
  {
    nameKz: 'Ақтау',
    nameRu: 'Актау',
    patterns: [/ақтау/i, /актау/i, /aktau/i, /шевченко/i],
  },
  {
    nameKz: 'Қостанай',
    nameRu: 'Костанай',
    patterns: [/қостанай/i, /костанай/i, /kostanay/i],
  },
  {
    nameKz: 'Орал',
    nameRu: 'Уральск',
    patterns: [/орал/i, /уральск/i, /uralsk/i],
  },
  {
    nameKz: 'Түркістан',
    nameRu: 'Туркестан',
    patterns: [/түркістан/i, /туркестан/i, /turkestan/i],
  },
  {
    nameKz: 'Көкшетау',
    nameRu: 'Кокшетау',
    patterns: [/көкшетау/i, /кокшетау/i, /kokshetau/i],
  },
];

export const ALL_CITIES_LIST = [
  { kz: 'Алматы', ru: 'Алматы' },
  { kz: 'Астана', ru: 'Астана' },
  { kz: 'Шымкент', ru: 'Шымкент' },
  { kz: 'Қызылорда', ru: 'Кызылорда' },
  { kz: 'Ақтөбе', ru: 'Актобе' },
  { kz: 'Қарағанды', ru: 'Караганда' },
  { kz: 'Тараз', ru: 'Тараз' },
  { kz: 'Павлодар', ru: 'Павлодар' },
  { kz: 'Өскемен', ru: 'Усть-Каменогорск' },
  { kz: 'Семей', ru: 'Семей' },
  { kz: 'Атырау', ru: 'Атырау' },
  { kz: 'Ақтау', ru: 'Актау' },
  { kz: 'Қостанай', ru: 'Костанай' },
  { kz: 'Орал', ru: 'Уральск' },
  { kz: 'Түркістан', ru: 'Туркестан' },
  { kz: 'Көкшетау', ru: 'Кокшетау' },
];

export const CATEGORIES_LIST = [
  { id: 'home_services', kz: 'Тұрмыстық қызметтер (Сантехник, Электрик)', ru: 'Бытовые услуги (Сантехник, Электрик)' },
  { id: 'appliance_repair', kz: 'Тұрмыстық техника жөндеу', ru: 'Ремонт бытовой техники' },
  { id: 'cargo_moving', kz: 'Жүк тасымалдау және көшу', ru: 'Грузоперевозки и переезд' },
  { id: 'electronics', kz: 'Электроника және гаджеттер', ru: 'Электроника и покупка техники' },
  { id: 'cleaning', kz: 'Тазалық қызметі (Клининг)', ru: 'Клининг и уборка' },
  { id: 'auto', kz: 'Автокөмек және эвакуатор', ru: 'Автоуслуги и эвакуатор' },
  { id: 'other', kz: 'Басқа қызметтер', ru: 'Другие услуги' },
];

export function analyzeRequestLocally(query: string, lang: Language): ExtractedNeed {
  const normalized = query.toLowerCase().trim();

  // 1. Detect City
  let detectedCity = lang === 'kz' ? 'Қызылорда' : 'Кызылорда';
  let foundCity = false;

  for (const city of CITIES) {
    for (const pattern of city.patterns) {
      if (pattern.test(normalized)) {
        detectedCity = lang === 'kz' ? city.nameKz : city.nameRu;
        foundCity = true;
        break;
      }
    }
    if (foundCity) break;
  }

  // If no city explicitly mentioned, default gracefully
  if (!foundCity) {
    detectedCity = lang === 'kz' ? 'Қызылорда' : 'Кызылорда';
  }

  // 2. Detect Date & Urgency
  let detectedDate = lang === 'kz' ? 'Бүгін' : 'Сегодня';
  let detectedUrgency: Urgency = 'normal';

  const isToday =
    /бүгін|сегодня|bugün|bugun|прямо сейчас|қазір|кәзір|шұғыл|срочно|тез|срочный/i.test(normalized);
  const isTomorrow = /ертең|завтра|yarın|yarin/i.test(normalized);
  const isWeekend = /демалыс|выходн|hafta sonu/i.test(normalized);
  const isUrgentWord = /шұғыл|срочно|тез|апат|срочный|прямо сейчас|шұғылдық|lazım|acil|керек|нужен/i.test(normalized);

  if (isUrgentWord || (isToday && /керек|нужен|срочно|lazım|керек/i.test(normalized))) {
    detectedUrgency = 'high';
  }

  if (isToday) {
    detectedDate = lang === 'kz' ? 'Бүгін' : 'Сегодня';
  } else if (isTomorrow) {
    detectedDate = lang === 'kz' ? 'Ертең' : 'Завтра';
  } else if (isWeekend) {
    detectedDate = lang === 'kz' ? 'Осы демалыста' : 'На выходных';
  } else {
    detectedDate = lang === 'kz' ? 'Бүгін / Жақын арада' : 'Сегодня / В ближайшее время';
  }

  // 3. Detect Budget
  let detectedBudget = lang === 'kz' ? 'Келісімді' : 'Договорная';

  // Pattern for budgets: "до 150 000 ₸", "150 000 тг", "150к", "150000 тенге"
  const budgetMatch = normalized.match(
    /(?:до|дейін|бюджет|бағасы|kadar)?\s*(\d{1,3}(?:[\s.,]\d{3})*|\d+)\s*(?:₸|тг|тенге|теңге|мың|тыс|k|к|tl|kzt)?(?:\s*дейін|\s*до|\s*kadar)?/i
  );

  // Look specifically for realistic monetary amounts (e.g. 5000, 150 000, 150k)
  const numbersWithCurrency = normalized.match(
    /(\d[\d\s.,]*\d|\d+)\s*(?:₸|тг|тенге|теңге|мың|тыс|k|к|kzt)/i
  );
  const doMatch = normalized.match(/(?:до|дейін|kadar)\s*(\d[\d\s.,]*\d|\d+)/i);

  if (numbersWithCurrency || doMatch || budgetMatch) {
    const rawVal = numbersWithCurrency?.[1] || doMatch?.[1] || budgetMatch?.[1];
    if (rawVal) {
      const cleanNum = rawVal.replace(/[\s.,]/g, '');
      const parsedNum = parseInt(cleanNum, 10);
      if (!isNaN(parsedNum) && parsedNum > 100) {
        let finalNum = parsedNum;
        if (/мың|тыс|k|к/i.test(normalized) && parsedNum < 1000) {
          finalNum = parsedNum * 1000;
        }
        const formatted = new Intl.NumberFormat('ru-RU').format(finalNum);
        detectedBudget = lang === 'kz' ? `${formatted} ₸ дейін` : `до ${formatted} ₸`;
      }
    }
  }

  // 4. Detect Category and Service/Product
  let detectedCategory = '';
  let detectedService = '';

  if (
    /кір жуғыш|стирал|çamaşır|camasir|холодильник|тоңазытқыш|buzdolabı|бойлер|плита|кондиционер|пылесос|техника|tamir/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'kz' ? 'Тұрмыстық техника жөндеу' : 'Ремонт бытовой техники';
    if (/кір жуғыш|стирал|çamaşır|camasir/i.test(normalized)) {
      detectedService =
        lang === 'kz'
          ? 'Кір жуғыш машина жөндеу'
          : 'Ремонт стиральных машин';
    } else if (/тоңазытқыш|холодильник|buzdolabı/i.test(normalized)) {
      detectedService =
        lang === 'kz' ? 'Тоңазытқыш жөндеу' : 'Ремонт холодильника';
    } else {
      detectedService =
        lang === 'kz' ? 'Тұрмыстық техника шебері' : 'Мастер по ремонту техники';
    }
  } else if (
    /сантехник|кран|труба|су ағ|құбыр|унитаз|смеситель|канализаци|раковин|батарея|tesisat/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'kz' ? 'Тұрмыстық қызметтер' : 'Бытовые услуги';
    detectedService =
      lang === 'kz' ? 'Сантехник қызметі' : 'Услуги сантехника';
  } else if (
    /электрик|жарық|проводк|розетк|тоқ|люстр|свет/i.test(normalized)
  ) {
    detectedCategory =
      lang === 'kz' ? 'Тұрмыстық қызметтер' : 'Бытовые услуги';
    detectedService =
      lang === 'kz' ? 'Электрик шебері' : 'Услуги электрика';
  } else if (
    /переезд|көшу|көшіру|машина для переезда|газель|жүк тасу|грузоперевозк|жүк көлік|грузчик/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'kz' ? 'Жүк тасымалдау' : 'Грузоперевозки';
    detectedService =
      lang === 'kz'
        ? 'Көшуге арналған көлік (Газель)'
        : 'Машина для переезда (Газель)';
  } else if (
    /телефон|смартфон|айфон|iphone|samsung|xiaomi|redmi|гаджет|ноутбук/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'kz' ? 'Электроника және гаджеттер' : 'Электроника и гаджеты';
    detectedService =
      lang === 'kz' ? 'Смартфон сатып алу' : 'Покупка смартфона';
  } else if (
    /тазалау|клининг|уборка|пәтер тазалау|кілем|мойка/i.test(normalized)
  ) {
    detectedCategory =
      lang === 'kz' ? 'Тазалық қызметі' : 'Клининг и уборка';
    detectedService =
      lang === 'kz' ? 'Пәтер тазалау (клининг)' : 'Генеральная уборка квартиры';
  } else if (
    /эвакуатор|көлік бұзылды|авто|сто|шина|дөңгелек/i.test(normalized)
  ) {
    detectedCategory =
      lang === 'kz' ? 'Автоқызметтер' : 'Автоуслуги';
    detectedService =
      lang === 'kz' ? 'Эвакуатор шақыру' : 'Вызов эвакуатора';
  } else {
    // Generic fallback
    detectedCategory =
      lang === 'kz' ? 'Қызметтер мен тауарлар' : 'Услуги и товары';
    detectedService =
      query.length > 40 ? query.slice(0, 37) + '...' : query;
  }

  return {
    city: detectedCity,
    cityId: normalizeCityId(detectedCity),
    category: detectedCategory,
    categoryId: normalizeCategoryId(detectedCategory),
    service: detectedService,
    date: detectedDate,
    budget: detectedBudget,
    urgency: detectedUrgency,
    originalQuery: query,
  };
}
