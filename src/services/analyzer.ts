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
  { id: 'plumbing', kz: 'Сантехника және құбырлар', ru: 'Сантехника и канализация', tr: 'Su Tesisatı & Kanalizasyon' },
  { id: 'electrician', kz: 'Электрик және тоқ желісі', ru: 'Электрика и монтаж', tr: 'Elektrik Tesisatı & Arıza' },
  { id: 'heating_boiler', kz: 'Жылыту және қазандықтар', ru: 'Отопление и котлы', tr: 'Kombi, Şofben & Isıtma' },
  { id: 'ac_ventilation', kz: 'Кондиционерлер мен желдету', ru: 'Кондиционеры и вентиляция', tr: 'Klima & Havalandırma' },
  { id: 'appliances', kz: 'Тұрмыстық техника жөндеу', ru: 'Ремонт бытовой техники', tr: 'Beyaz Eşya Tamiri' },
  { id: 'furniture_carpentry', kz: 'Жиһаз құрастыру', ru: 'Сборка мебели', tr: 'Mobilya Montajı & Marangozluk' },
  { id: 'painting_finishing', kz: 'Бояу және жөндеу', ru: 'Малярные работы и ремонт', tr: 'Boya, Badana & Tadilat' },
  { id: 'cleaning_moving', kz: 'Тазалау және көшу', ru: 'Уборка и переезд', tr: 'Temizlik & Taşıma' },
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
    /котел|котёл|қазандық|отоплени|жылыту|аристон|байпасс|байпас|батарея|печь|печка|радиатор|тепло/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'tr'
        ? 'Kombi, Şofben & Isıtma'
        : lang === 'kz'
        ? 'Жылыту және қазандықтар'
        : 'Отопление и котлы';
    detectedService =
      lang === 'tr'
        ? 'Kombi ve ısıtma servisi'
        : lang === 'kz'
        ? 'Қазандық пен жылыту жүйесін жөндеу'
        : 'Ремонт котла и системы отопления';
  } else if (
    /кондиционер|фреон|сплит|салқындатқыш|чистка кондиционера|заправка кондиционер/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'tr'
        ? 'Klima & Havalandırma'
        : lang === 'kz'
        ? 'Кондиционерлер мен желдету'
        : 'Кондиционеры и вентиляция';
    detectedService =
      lang === 'tr'
        ? 'Klima bakımı ve gaz dolumu'
        : lang === 'kz'
        ? 'Кондиционер орнату және фреон құю'
        : 'Чистка и заправка кондиционера';
  } else if (
    /сантехник|кран|труба|су ағ|құбыр|унитаз|смеситель|канализаци|раковин|засор|прочистка|tesisat/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'tr'
        ? 'Su Tesisatı & Kanalizasyon'
        : lang === 'kz'
        ? 'Сантехника және құбырлар'
        : 'Сантехника и канализация';
    detectedService =
      lang === 'tr'
        ? 'Su tesisatı tamiri'
        : lang === 'kz'
        ? 'Сантехник қызметі'
        : 'Услуги сантехника';
  } else if (
    /электрик|жарық|проводк|розетк|тоқ|люстр|свет|замыкание/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'tr'
        ? 'Elektrik Tesisatı & Arıza'
        : lang === 'kz'
        ? 'Электрик және тоқ желісі'
        : 'Электрика и монтаж';
    detectedService =
      lang === 'tr'
        ? 'Elektrik arıza tamiri'
        : lang === 'kz'
        ? 'Электрик шебері'
        : 'Услуги электрика';
  } else if (
    /кір жуғыш|стирал|çamaşır|camasir|холодильник|тоңазытқыш|buzdolabı|плита|пылесос|посудомойк/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'tr'
        ? 'Beyaz Eşya Tamiri'
        : lang === 'kz'
        ? 'Тұрмыстық техника жөндеу'
        : 'Ремонт бытовой техники';
    if (/кір жуғыш|стирал|çamaşır|camasir/i.test(normalized)) {
      const isSamsung = /samsung/i.test(normalized);
      const isLg = /lg/i.test(normalized);
      const isBosch = /bosch/i.test(normalized);
      const brand = isSamsung ? 'Samsung ' : isLg ? 'LG ' : isBosch ? 'Bosch ' : '';
      detectedService =
        lang === 'tr'
          ? `${brand}Çamaşır makinesi tamiri`.trim()
          : lang === 'kz'
          ? (brand ? `${brand}кір жуғыш машинасын жөндеу` : 'Кір жуғыш машина жөндеу')
          : (brand ? `Ремонт стиральной машины ${brand}`.trim() : 'Ремонт стиральных машин');
    } else if (/тоңазытқыш|холодильник|buzdolabı/i.test(normalized)) {
      detectedService =
        lang === 'tr' ? 'Buzdolabı tamiri' : lang === 'kz' ? 'Тоңазытқыш жөндеу' : 'Ремонт холодильника';
    } else {
      detectedService =
        lang === 'tr' ? 'Beyaz eşya servisi' : lang === 'kz' ? 'Тұрмыстық техника шебері' : 'Мастер по ремонту техники';
    }
  } else if (
    /жиһаз|мебель|шкаф|стол|кровать|диван|сборка мебели|жиһаз құрастыру|плотник/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'tr' ? 'Mobilya Montajı & Marangozluk' : lang === 'kz' ? 'Жиһаз құрастыру' : 'Сборка мебели';
    detectedService =
      lang === 'tr' ? 'Mobilya montajı' : lang === 'kz' ? 'Жиһаз құрастыру' : 'Сборка и ремонт мебели';
  } else if (
    /маляр|покраска|бояу|штукатурк|шпатлевк|обои|пәтер жөндеу|ремонт квартир|кафель/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'tr' ? 'Boya, Badana & Tadilat' : lang === 'kz' ? 'Бояу және жөндеу' : 'Малярные работы и ремонт';
    detectedService =
      lang === 'tr' ? 'Boya badana ve tadilat' : lang === 'kz' ? 'Пәтер жөндеу жұмыстары' : 'Ремонт квартир и отделка';
  } else if (
    /переезд|көшу|көшіру|клининг|уборка|тазалау|газель|жүк тасу|грузоперевозк|грузчик/i.test(
      normalized
    )
  ) {
    detectedCategory =
      lang === 'tr' ? 'Temizlik & Taşıma' : lang === 'kz' ? 'Тазалау және көшу' : 'Уборка и переезд';
    detectedService =
      lang === 'tr' ? 'Ev taşıma ve temizlik' : lang === 'kz' ? 'Көшу және тазалау қызметі' : 'Переезд и клининг';
  } else {
    // Generic fallback
    detectedCategory =
      lang === 'tr' ? 'Diğer Hizmetler' : lang === 'kz' ? 'Қызметтер мен тауарлар' : 'Услуги и товары';
    detectedService =
      query.length > 40 ? query.slice(0, 37) + '...' : query;
  }

  const confidence = foundCity && detectedCategory ? 0.95 : detectedCategory ? 0.85 : 0.65;

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
    confidence,
    isAiParsed: false,
  };
}
