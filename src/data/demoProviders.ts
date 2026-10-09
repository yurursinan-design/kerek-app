import { DemoProvider, ExtractedNeed, Language } from '../types';
import { normalizeCategoryId, normalizeCityId } from '../services/taxonomy';

function enrich(providers: DemoProvider[], defaultCatId: string, defaultCityId?: string): DemoProvider[] {
  return providers.map((p) => ({
    ...p,
    cityId: p.cityId || defaultCityId,
    categoryId: p.categoryId || defaultCatId,
  }));
}

export function getDemoProviders(need: ExtractedNeed, lang: Language): DemoProvider[] {
  const city = need.city || (lang === 'kz' ? 'Қызылорда' : 'Кызылорда');
  const cat = (need.category || '').toLowerCase();
  const srv = (need.service || '').toLowerCase();
  const catId = need.categoryId || normalizeCategoryId(need.category);
  const cityId = need.cityId || normalizeCityId(city);

  // 1. Appliances Repair (Кір жуғыш машина, стиралка, техника)
  if (catId === 'appliances' || catId === 'appliance_repair' || cat.includes('техник') || srv.includes('кір жуғыш') || srv.includes('стирал') || srv.includes('тоңазытқыш')) {
    return enrich([
      {
        id: 'demo-appliance-1',
        name: lang === 'kz' ? '«МастерТех» сервисі (ДЕМО)' : 'Сервис «МастерТех» (ДЕМО)',
        category: lang === 'kz' ? 'Тұрмыстық техника жөндеу' : 'Ремонт бытовой техники',
        service: lang === 'kz' ? 'Кір жуғыш машина жөндеу, үйге бару' : 'Ремонт стиральных машин с выездом',
        approxPrice: lang === 'kz' ? '5 000 – 12 000 ₸' : '5 000 – 12 000 ₸',
        distance: lang === 'kz' ? `1.4 км (${city})` : `1.4 км (${city})`,
        responseTime: lang === 'kz' ? '5-10 мин ішінде жауап береді' : 'отвечает за 5-10 мин',
        city,
        rating: 4.9,
        reviewsCount: 48,
        phone: '+7 777 001 02 03',
        whatsapp: '+77770010203',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, орталық аудан` : `${city}, центральный район`,
      },
      {
        id: 'demo-appliance-2',
        name: lang === 'kz' ? '«Адал Мастер» жеке шебері (ДЕМО)' : 'Частный мастер «Адал Мастер» (ДЕМО)',
        category: lang === 'kz' ? 'Тұрмыстық техника' : 'Бытовая техника',
        service: lang === 'kz' ? 'Шұғыл диагностика және бөлшектерін ауыстыру' : 'Срочная диагностика и замена деталей',
        approxPrice: lang === 'kz' ? '4 000 – 10 000 ₸' : '4 000 – 10 000 ₸',
        distance: lang === 'kz' ? `2.8 км (${city})` : `2.8 км (${city})`,
        responseTime: lang === 'kz' ? '3 мин ішінде' : 'отвечает за 3 мин',
        city,
        rating: 4.8,
        reviewsCount: 32,
        phone: '+7 705 111 22 33',
        whatsapp: '+77051112233',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, микрорайон` : `${city}, микрорайон`,
      },
      {
        id: 'demo-appliance-3',
        name: lang === 'kz' ? '«ProРемонт 24/7» желісі (ДЕМО)' : 'Сеть «ProРемонт 24/7» (ДЕМО)',
        category: lang === 'kz' ? 'Тұрмыстық техника' : 'Ремонт техники',
        service: lang === 'kz' ? 'Барлық маркадағы техниканы кепілдікпен жөндеу' : 'Ремонт всех марок с гарантией 1 год',
        approxPrice: lang === 'kz' ? '6 000 – 15 000 ₸' : '6 000 – 15 000 ₸',
        distance: lang === 'kz' ? `3.5 км (${city})` : `3.5 км (${city})`,
        responseTime: lang === 'kz' ? '15 мин ішінде' : 'отвечает за 15 мин',
        city,
        rating: 4.7,
        reviewsCount: 64,
        phone: '+7 701 999 88 77',
        whatsapp: '+77019998877',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, өндірістік аймақ` : `${city}, промзона`,
      },
    ], 'appliances', cityId);
  }

  // 2. Home Services (Plumbing, Electrician / Сантехник, Электрик)
  if (catId === 'home_services' || cat.includes('тұрмыстық') || cat.includes('бытов') || srv.includes('сантехник') || srv.includes('электрик')) {
    return enrich([
      {
        id: 'demo-home-1',
        name: lang === 'kz' ? '«СантехПрофи» бригадасы (ДЕМО)' : 'Бригада «СантехПрофи» (ДЕМО)',
        category: lang === 'kz' ? 'Сантехника қызметі' : 'Услуги сантехника',
        service: lang === 'kz' ? 'Су құбырларын жөндеу, кран ауыстыру, тазалау' : 'Устранение засоров, замена смесителей и труб',
        approxPrice: lang === 'kz' ? '5 000 – 12 000 ₸' : '5 000 – 12 000 ₸',
        distance: lang === 'kz' ? `1.1 км (${city})` : `1.1 км (${city})`,
        responseTime: lang === 'kz' ? '5 мин ішінде жауап береді' : 'отвечает за 5 мин',
        city,
        rating: 4.9,
        reviewsCount: 56,
        phone: '+7 775 555 44 33',
        whatsapp: '+77755554433',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, орталық` : `${city}, центр`,
      },
      {
        id: 'demo-home-2',
        name: lang === 'kz' ? 'Ерлан — жедел сантехник (ДЕМО)' : 'Ерлан — срочный сантехник (ДЕМО)',
        category: lang === 'kz' ? 'Сантехника және жылу' : 'Сантехника и отопление',
        service: lang === 'kz' ? 'Шұғыл шақыру, апаттық жағдайларды реттеу' : 'Срочный аварийный выезд в течение 30 минут',
        approxPrice: lang === 'kz' ? '4 000 – 8 000 ₸' : '4 000 – 8 000 ₸',
        distance: lang === 'kz' ? `2.3 км (${city})` : `2.3 км (${city})`,
        responseTime: lang === 'kz' ? '3 мин ішінде' : 'отвечает за 3 мин',
        city,
        rating: 4.8,
        reviewsCount: 39,
        phone: '+7 707 333 22 11',
        whatsapp: '+77073332211',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, 4-ықшамаудан` : `${city}, 4-й микрорайон`,
      },
      {
        id: 'demo-home-3',
        name: lang === 'kz' ? '«Үй Шебері Сервис» ЖШС (ДЕМО)' : 'ТОО «Дом Мастер Сервис» (ДЕМО)',
        category: lang === 'kz' ? 'Кешенді тұрмыстық қызмет' : 'Комплексный бытовой сервис',
        service: lang === 'kz' ? 'Сантехника, электр желісі, ұсақ жөндеу' : 'Сантехника, электрика, мелкий ремонт',
        approxPrice: lang === 'kz' ? '6 000 – 18 000 ₸' : '6 000 – 18 000 ₸',
        distance: lang === 'kz' ? `4.0 км (${city})` : `4.0 км (${city})`,
        responseTime: lang === 'kz' ? '8 мин ішінде' : 'отвечает за 8 мин',
        city,
        rating: 4.6,
        reviewsCount: 28,
        phone: '+7 747 888 77 66',
        whatsapp: '+77478887766',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, Сәтбаев көшесі` : `${city}, ул. Сатпаева`,
      },
    ], 'home_services', cityId);
  }

  // 3. Cargo & Moving (Грузоперевозки / Жүк тасымалдау)
  if (catId === 'cargo_moving' || cat.includes('жүк') || cat.includes('груз') || srv.includes('переезд') || srv.includes('газель') || srv.includes('көшу')) {
    return enrich([
      {
        id: 'demo-cargo-1',
        name: lang === 'kz' ? '«ҚазКөлік Груз» Газель қызметі (ДЕМО)' : 'Газель «КазТранс Груз» (ДЕМО)',
        category: lang === 'kz' ? 'Жүк тасымалдау' : 'Грузоперевозки',
        service: lang === 'kz' ? 'Пәтер мен кеңсе көшіру, Газель 4.2м + 2 жүкші' : 'Квартирные и офисные переезды, Газель 4.2м + 2 грузчика',
        approxPrice: lang === 'kz' ? '7 000 ₸/сағат' : '7 000 ₸/час',
        distance: lang === 'kz' ? `1.8 км (${city})` : `1.8 км (${city})`,
        responseTime: lang === 'kz' ? '5 мин ішінде' : 'отвечает за 5 мин',
        city,
        rating: 4.9,
        reviewsCount: 71,
        phone: '+7 702 444 33 22',
        whatsapp: '+77024443322',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, сол жағалау` : `${city}, левый берег`,
      },
      {
        id: 'demo-cargo-2',
        name: lang === 'kz' ? 'Нұрлан — Тез Көшу Газель (ДЕМО)' : 'Нурлан — Быстрый Переезд Газель (ДЕМО)',
        category: lang === 'kz' ? 'Жүк көлігі' : 'Грузовое авто',
        service: lang === 'kz' ? 'Қала ішінде және облысқа тасымалдау, жиһаз жинау' : 'Перевозка по городу и области, разборка мебели',
        approxPrice: lang === 'kz' ? '6 000 ₸/сағат' : '6 000 ₸/час',
        distance: lang === 'kz' ? `2.5 км (${city})` : `2.5 км (${city})`,
        responseTime: lang === 'kz' ? '3 мин ішінде' : 'отвечает за 3 мин',
        city,
        rating: 4.8,
        reviewsCount: 45,
        phone: '+7 778 222 11 00',
        whatsapp: '+7782221100',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, орталық аудан` : `${city}, центральный район`,
      },
      {
        id: 'demo-cargo-3',
        name: lang === 'kz' ? '«Астана-Көлік Логистика» (ДЕМО)' : '«Астана-Транс Логистика» (ДЕМО)',
        category: lang === 'kz' ? 'Логистика' : 'Грузоперевозки под ключ',
        service: lang === 'kz' ? 'Үлкен жүктер, орау материалдары мен қауіпсіз жеткізу' : 'Упаковка вещей, страховка, перевозка под ключ',
        approxPrice: lang === 'kz' ? '8 500 ₸/сағат' : '8 500 ₸/час',
        distance: lang === 'kz' ? `3.9 км (${city})` : `3.9 км (${city})`,
        responseTime: lang === 'kz' ? '10 мин ішінде' : 'отвечает за 10 мин',
        city,
        rating: 4.7,
        reviewsCount: 38,
        phone: '+7 701 555 77 99',
        whatsapp: '+77015557799',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, магистраль бойы` : `${city}, вдоль объездной`,
      },
    ], 'cargo_moving', cityId);
  }

  // 4. Electronics & Phones (Электроника, телефон, смартфон)
  if (catId === 'electronics' || cat.includes('электроник') || srv.includes('телефон') || srv.includes('смартфон') || srv.includes('айфон')) {
    const budgetNote = need.budget.includes('₸') ? need.budget : '150 000 ₸ дейін';
    return enrich([
      {
        id: 'demo-elec-1',
        name: lang === 'kz' ? '«SmartMarket KZ» дүкені (ДЕМО)' : 'Магазин «SmartMarket KZ» (ДЕМО)',
        category: lang === 'kz' ? 'Смартфондар мен гаджеттер' : 'Смартфоны и гаджеты',
        service: lang === 'kz' ? `Қолжетімді смартфондар (${budgetNote}), ресми кепілдік` : `Смартфоны по вашему бюджету (${budgetNote}), гарантия 1 год`,
        approxPrice: lang === 'kz' ? '85 000 – 149 990 ₸' : '85 000 – 149 990 ₸',
        distance: lang === 'kz' ? `0.9 км (${city})` : `0.9 км (${city})`,
        responseTime: lang === 'kz' ? '5 мин ішінде' : 'отвечает за 5 мин',
        city,
        rating: 4.9,
        reviewsCount: 112,
        phone: '+7 700 900 11 22',
        whatsapp: '+77009001122',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, «Достық» сауда орталығы` : `${city}, ТЦ «Достык»`,
      },
      {
        id: 'demo-elec-2',
        name: lang === 'kz' ? '«iStore Trade & Outlet» (ДЕМО)' : '«iStore Trade & Outlet» (ДЕМО)',
        category: lang === 'kz' ? 'Жаңа және тексерілген құрылғылар' : 'Новые и проверенные устройства',
        service: lang === 'kz' ? 'Redmi, Samsung және iPhone модельдері жақсы жағдайда' : 'Модели Redmi, Samsung и iPhone в отличном состоянии',
        approxPrice: lang === 'kz' ? '70 000 – 145 000 ₸' : '70 000 – 145 000 ₸',
        distance: lang === 'kz' ? `2.1 км (${city})` : `2.1 км (${city})`,
        responseTime: lang === 'kz' ? '2 мин ішінде' : 'отвечает за 2 мин',
        city,
        rating: 4.8,
        reviewsCount: 84,
        phone: '+7 707 444 88 00',
        whatsapp: '+77074448800',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, Абай даңғылы` : `${city}, пр. Абая`,
      },
      {
        id: 'demo-elec-3',
        name: lang === 'kz' ? '«ТехноCity Outlet» (ДЕМО)' : '«ТехноCity Outlet» (ДЕМО)',
        category: lang === 'kz' ? 'Тұрмыстық электроника' : 'Цифровая техника',
        service: lang === 'kz' ? 'Таңдау бойынша кеңес, бүгін жеткізу тегін' : 'Консультация по подбору, бесплатная доставка сегодня',
        approxPrice: lang === 'kz' ? '90 000 – 150 000 ₸' : '90 000 – 150 000 ₸',
        distance: lang === 'kz' ? `3.3 км (${city})` : `3.3 км (${city})`,
        responseTime: lang === 'kz' ? '7 мин ішінде' : 'отвечает за 7 мин',
        city,
        rating: 4.7,
        reviewsCount: 53,
        phone: '+7 776 333 99 11',
        whatsapp: '+7763339911',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, Бәйтерек маңы` : `${city}, район Байтерека`,
      },
    ], 'electronics', cityId);
  }

  // 5. Cleaning & Housekeeping (Клининг / Тазалық)
  if (catId === 'cleaning' || cat.includes('тазалық') || cat.includes('клининг') || srv.includes('уборка') || srv.includes('тазалау')) {
    return enrich([
      {
        id: 'demo-clean-1',
        name: lang === 'kz' ? '«Таза Үй» клининг компаниясы (ДЕМО)' : 'Клининговая компания «Таза Үй» (ДЕМО)',
        category: lang === 'kz' ? 'Клининг қызметі' : 'Услуги клининга',
        service: lang === 'kz' ? 'Пәтерлерді бас тазалау, терезе жуу, кәсіби химия' : 'Генеральная уборка квартир, мойка окон, эко-химия',
        approxPrice: lang === 'kz' ? '15 000 – 35 000 ₸' : '15 000 – 35 000 ₸',
        distance: lang === 'kz' ? `1.7 км (${city})` : `1.7 км (${city})`,
        responseTime: lang === 'kz' ? '5 мин ішінде' : 'отвечает за 5 мин',
        city,
        rating: 4.9,
        reviewsCount: 67,
        phone: '+7 705 600 55 44',
        whatsapp: '+77056005544',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, орталық саябақ маңы` : `${city}, район горпарка`,
      },
      {
        id: 'demo-clean-2',
        name: lang === 'kz' ? '«Мөлдір» жедел тазалау бригадасы (ДЕМО)' : 'Срочный клининг «Молдир» (ДЕМО)',
        category: lang === 'kz' ? 'Шұғыл клининг' : 'Экспресс-уборка',
        service: lang === 'kz' ? 'Бүгінге шақыру қабылдаймыз, 2-3 сағат ішінде тазалау' : 'Приезд в день заказа, уборка за 2-3 часа',
        approxPrice: lang === 'kz' ? '12 000 – 25 000 ₸' : '12 000 – 25 000 ₸',
        distance: lang === 'kz' ? `2.6 км (${city})` : `2.6 км (${city})`,
        responseTime: lang === 'kz' ? '4 мин ішінде' : 'отвечает за 4 мин',
        city,
        rating: 4.8,
        reviewsCount: 42,
        phone: '+7 771 800 90 90',
        whatsapp: '+77718009090',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, тұрғын үй кешені` : `${city}, жилой комплекс`,
      },
      {
        id: 'demo-clean-3',
        name: lang === 'kz' ? '«ProClean KZ» қызметі (ДЕМО)' : 'Сервис «ProClean KZ» (ДЕМО)',
        category: lang === 'kz' ? 'Клининг және химчистка' : 'Клининг и химчистка мебели',
        service: lang === 'kz' ? 'Пәтер мен диван-кілемді арнайы аппаратпен тазалау' : 'Уборка помещений и глубокая чистка мебели Karcher',
        approxPrice: lang === 'kz' ? '18 000 – 40 000 ₸' : '18 000 – 40 000 ₸',
        distance: lang === 'kz' ? `3.8 км (${city})` : `3.8 км (${city})`,
        responseTime: lang === 'kz' ? '12 мин ішінде' : 'отвечает за 12 мин',
        city,
        rating: 4.7,
        reviewsCount: 31,
        phone: '+7 747 200 30 40',
        whatsapp: '+77472003040',
        verified: true,
        addressSnippet: lang === 'kz' ? `${city}, шығыс аудан` : `${city}, восточный район`,
      },
    ], 'cleaning', cityId);
  }

  // 6. Generic Default Fallback based on user's exact need
  return enrich([
    {
      id: 'demo-gen-1',
      name: lang === 'kz' ? `«Шеберлік Орталығы» (${city}) (ДЕМО)` : `Центр услуг «Шеберлік» (${city}) (ДЕМО)`,
      category: need.category || (lang === 'kz' ? 'Қызметтер' : 'Услуги'),
      service: need.service || (lang === 'kz' ? 'Тапсырысты орындау' : 'Исполнение заявки'),
      approxPrice: need.budget !== 'Договорная' && need.budget !== 'Келісімді' ? need.budget : 'от 5 000 ₸',
      distance: lang === 'kz' ? `1.5 км (${city})` : `1.5 км (${city})`,
      responseTime: lang === 'kz' ? '5 мин ішінде жауап береді' : 'отвечает за 5 мин',
      city,
      rating: 4.9,
      reviewsCount: 42,
      phone: '+7 777 999 11 22',
      whatsapp: '+77779991122',
      verified: true,
      addressSnippet: lang === 'kz' ? `${city}, орталық аудан` : `${city}, центральный район`,
    },
    {
      id: 'demo-gen-2',
      name: lang === 'kz' ? `«Жедел Шешім» тобы (ДЕМО)` : `Группа специалистов «Жедел Шешім» (ДЕМО)`,
      category: need.category || (lang === 'kz' ? 'Қызметтер' : 'Услуги'),
      service: need.service || (lang === 'kz' ? 'Маман көмегі' : 'Помощь мастера'),
      approxPrice: need.budget !== 'Договорная' && need.budget !== 'Келісімді' ? need.budget : 'от 4 000 ₸',
      distance: lang === 'kz' ? `2.7 км (${city})` : `2.7 км (${city})`,
      responseTime: lang === 'kz' ? '3 мин ішінде' : 'отвечает за 3 мин',
      city,
      rating: 4.8,
      reviewsCount: 29,
      phone: '+7 707 555 66 77',
      whatsapp: '+77075556677',
      verified: true,
      addressSnippet: lang === 'kz' ? `${city}, қала іші` : `${city}, по городу`,
    },
    {
      id: 'demo-gen-3',
      name: lang === 'kz' ? `«Қазақстан Сервис Плюс» (ДЕМО)` : `«Казахстан Сервис Плюс» (ДЕМО)`,
      category: need.category || (lang === 'kz' ? 'Қызметтер' : 'Услуги'),
      service: need.service || (lang === 'kz' ? 'Кепілдікпен қызмет' : 'Услуга с гарантией'),
      approxPrice: need.budget !== 'Договорная' && need.budget !== 'Келісімді' ? need.budget : 'от 6 000 ₸',
      distance: lang === 'kz' ? `3.9 км (${city})` : `3.9 км (${city})`,
      responseTime: lang === 'kz' ? '10 мин ішінде' : 'отвечает за 10 мин',
      city,
      rating: 4.7,
      reviewsCount: 35,
      phone: '+7 701 333 44 55',
      whatsapp: '+77013334455',
      verified: true,
      addressSnippet: lang === 'kz' ? `${city}, бизнес орталық` : `${city}, деловой район`,
    },
  ], catId || 'other', cityId);
}
