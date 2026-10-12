/**
 * Service catalogue: main groups and the services inside them, in Kazakh and Russian.
 *
 * A group id is the request's categoryId (the eight original ids are kept, so existing requests
 * and provider profiles keep matching). A service id is stored as serviceId on requests and in
 * serviceIds on provider profiles. `keywords` are lowercase word stems used by the search box.
 * `emoji` is the file name of a 3D icon in public/img/3d (Microsoft Fluent Emoji, MIT licence).
 * `quick` are one-tap answers offered in the first step of a request for that group.
 */

export interface CatalogService {
  id: string;
  kz: string;
  ru: string;
  emoji: string;
  keywords?: string[];
  popular?: boolean;
}

export interface QuickTag {
  kz: string;
  ru: string;
}

export interface CatalogGroup {
  id: string;
  kz: string;
  ru: string;
  /** Short line under the group name */
  kzHint: string;
  ruHint: string;
  emoji: string;
  /** Tailwind colour family for the tile (see TONES in components/CategoryIcon.tsx) */
  color: string;
  quick: QuickTag[];
  services: CatalogService[];
  /** Work that can need a licence, permit or certificate in Kazakhstan: customers see a reminder */
  licensed?: boolean;
}

/** Groups whose work can need a licence or certificate (gas, electrical, care, legal/accounting) */
const LICENSED_GROUPS = ['heating_boiler', 'electrician', 'care', 'business'];

const REPAIR_TAGS: QuickTag[] = [
  { kz: 'Жөндеу', ru: 'Ремонт' },
  { kz: 'Орнату', ru: 'Установка' },
  { kz: 'Ауыстыру', ru: 'Замена' },
  { kz: 'Диагностика', ru: 'Диагностика' },
];

export const SERVICE_CATALOG: CatalogGroup[] = [
  {
    id: 'painting_finishing',
    kz: 'Жөндеу және әрлеу',
    ru: 'Ремонт и отделка',
    kzHint: 'Бояу, плитка, ламинат, толық жөндеу',
    ruHint: 'Покраска, плитка, ламинат, ремонт под ключ',
    emoji: '1f58c-fe0f',
    color: 'orange',
    quick: [
      { kz: 'Пәтер', ru: 'Квартира' },
      { kz: 'Жеке үй', ru: 'Частный дом' },
      { kz: 'Кеңсе', ru: 'Офис' },
      { kz: 'Жаңа салынған үй', ru: 'Новостройка' },
    ],
    services: [
      { id: 'painting', kz: 'Бояу жұмыстары', ru: 'Покраска стен и потолков', emoji: '1f58c-fe0f', keywords: ['бояу', 'покрас', 'краск', 'маляр'], popular: true },
      { id: 'whitewash', kz: 'Ақтау', ru: 'Побелка', emoji: '1faa3', keywords: ['ақта', 'побел'] },
      { id: 'plastering', kz: 'Сылақ және шпаклевка', ru: 'Штукатурка и шпаклёвка', emoji: '1f9f1', keywords: ['сылақ', 'штукатур', 'шпакл', 'выравнив'] },
      { id: 'wallpaper', kz: 'Тұсқағаз жапсыру', ru: 'Поклейка обоев', emoji: '1f4dc', keywords: ['тұсқағаз', 'обои', 'обоев'] },
      { id: 'tiling', kz: 'Плитка төсеу', ru: 'Укладка плитки', emoji: '1f9e9', keywords: ['плитк', 'кафел', 'керамик'], popular: true },
      { id: 'flooring', kz: 'Ламинат және паркет төсеу', ru: 'Ламинат и паркет', emoji: '1fab5', keywords: ['ламинат', 'паркет', 'еден', 'линолеум'] },
      { id: 'drywall', kz: 'Гипсокартон жұмыстары', ru: 'Гипсокартон', emoji: '1f4cf', keywords: ['гипсокартон', 'гкл'] },
      { id: 'ceiling', kz: 'Керме және аспалы төбе', ru: 'Натяжные и подвесные потолки', emoji: '1f4d0', keywords: ['натяжн', 'подвесн', 'төбе', 'потол'] },
      { id: 'screed', kz: 'Еден стяжкасы', ru: 'Стяжка пола', emoji: '1f6a7', keywords: ['стяжк'] },
      { id: 'apartment_renovation', kz: 'Пәтерді толық жөндеу', ru: 'Ремонт квартиры под ключ', emoji: '1f3e0', keywords: ['под ключ', 'капремонт', 'евроремонт', 'толық жөнде'] },
      { id: 'bathroom_renovation', kz: 'Жуынатын бөлмені жөндеу', ru: 'Ремонт ванной комнаты', emoji: '1f6c1', keywords: ['ремонт ванн', 'санузел', 'жуынатын'] },
      { id: 'kitchen_renovation', kz: 'Асүйді жөндеу', ru: 'Ремонт кухни', emoji: '1f373', keywords: ['ремонт кухн', 'асүй'] },
      { id: 'decorative_plaster', kz: 'Сәндік сылақ', ru: 'Декоративная штукатурка', emoji: '1f3a8', keywords: ['декоратив'] },
    ],
  },
  {
    id: 'construction',
    kz: 'Құрылыс',
    ru: 'Строительство',
    kzHint: 'Үй, шатыр, терезе, есік, қоршау',
    ruHint: 'Дом, кровля, окна, двери, заборы',
    emoji: '1f3d7-fe0f',
    color: 'amber',
    quick: [
      { kz: 'Жеке үй', ru: 'Частный дом' },
      { kz: 'Саяжай', ru: 'Дача' },
      { kz: 'Пәтер', ru: 'Квартира' },
      { kz: 'Коммерциялық нысан', ru: 'Коммерческий объект' },
    ],
    services: [
      { id: 'masonry', kz: 'Кірпіш және блок қалау', ru: 'Кладка кирпича и блоков', emoji: '1f9f1', keywords: ['кладк', 'кірпіш', 'кирпич', 'блок'] },
      { id: 'house_building', kz: 'Үй салу', ru: 'Строительство дома', emoji: '1f3e1', keywords: ['үй салу', 'строительство дом', 'коттедж'] },
      { id: 'roofing', kz: 'Шатыр жабу және жөндеу', ru: 'Кровельные работы', emoji: '1f3d8-fe0f', keywords: ['шатыр', 'кровл', 'крыш'] },
      { id: 'concrete', kz: 'Бетон және іргетас', ru: 'Бетонные работы и фундамент', emoji: '1faa8', keywords: ['бетон', 'фундамент', 'іргетас'] },
      { id: 'welding', kz: 'Дәнекерлеу жұмыстары', ru: 'Сварочные работы', emoji: '1f529', keywords: ['дәнекер', 'свар'] },
      { id: 'windows', kz: 'Терезе орнату', ru: 'Установка окон', emoji: '1fa9f', keywords: ['терезе', 'окн', 'окон', 'пластиков'], popular: true },
      { id: 'doors', kz: 'Есік орнату', ru: 'Установка дверей', emoji: '1f6aa', keywords: ['есік', 'двер'] },
      { id: 'facade', kz: 'Қасбет және жылыту', ru: 'Фасад и утепление', emoji: '1f3e2', keywords: ['қасбет', 'фасад', 'утеплен', 'сайдинг'] },
      { id: 'demolition', kz: 'Бұзу жұмыстары', ru: 'Демонтаж', emoji: '1f6a7', keywords: ['бұзу', 'демонтаж', 'снос'] },
      { id: 'fence', kz: 'Қоршау және қақпа', ru: 'Заборы и ворота', emoji: '1fab5', keywords: ['қоршау', 'забор', 'ворот'] },
      { id: 'bath_sauna', kz: 'Монша салу', ru: 'Строительство бани', emoji: '2668-fe0f', keywords: ['монша', 'баня', 'бани', 'саун'] },
    ],
  },
  {
    id: 'plumbing',
    kz: 'Сантехника',
    ru: 'Сантехника',
    kzHint: 'Кран, құбыр, унитаз, бітелу',
    ruHint: 'Краны, трубы, унитазы, засоры',
    emoji: '1faa0',
    color: 'sky',
    quick: [
      { kz: 'Су ағып тұр', ru: 'Течёт вода' },
      { kz: 'Бітеліп қалды', ru: 'Засор' },
      { kz: 'Орнату', ru: 'Установка' },
      { kz: 'Ауыстыру', ru: 'Замена' },
    ],
    services: [
      { id: 'plumbing_repair', kz: 'Сантехник шақыру', ru: 'Сантехник на дом', emoji: '1f527', keywords: ['сантехник', 'ағып', 'течь', 'протека', 'ағады'], popular: true },
      { id: 'faucet', kz: 'Кран және смеситель', ru: 'Краны и смесители', emoji: '1f6b0', keywords: ['кран', 'смесител', 'шүмек'] },
      { id: 'toilet', kz: 'Унитаз орнату және жөндеу', ru: 'Унитазы', emoji: '1f6bd', keywords: ['унитаз', 'бачок'] },
      { id: 'drain_cleaning', kz: 'Бітелген құбырды тазалау', ru: 'Устранение засоров', emoji: '1faa0', keywords: ['засор', 'бітел', 'прочист', 'канализ'] },
      { id: 'pipes', kz: 'Құбырларды ауыстыру', ru: 'Замена труб', emoji: '1f529', keywords: ['құбыр', 'труб', 'стояк'] },
      { id: 'water_heater', kz: 'Су жылытқыш (бойлер)', ru: 'Водонагреватель (бойлер)', emoji: '1f321-fe0f', keywords: ['бойлер', 'водонагрев', 'су жылыт'] },
      { id: 'shower', kz: 'Душ кабина және ванна', ru: 'Душевые кабины и ванны', emoji: '1f6bf', keywords: ['душ', 'ванн'] },
      { id: 'water_meter', kz: 'Су есептегіші', ru: 'Счётчики воды', emoji: '1f4a7', keywords: ['есептегіш', 'счётчик', 'счетчик'] },
      { id: 'washing_machine_install', kz: 'Кір жуғыш машинаны қосу', ru: 'Подключение стиральной машины', emoji: '1f9fa', keywords: ['подключ'] },
    ],
  },
  {
    id: 'electrician',
    kz: 'Электрика',
    ru: 'Электрика',
    kzHint: 'Розетка, жарық, сымдар, камера',
    ruHint: 'Розетки, свет, проводка, камеры',
    emoji: '26a1',
    color: 'yellow',
    quick: REPAIR_TAGS,
    services: [
      { id: 'electric_repair', kz: 'Электрик шақыру', ru: 'Электрик на дом', emoji: '26a1', keywords: ['электрик', 'жарық жоқ', 'нет света', 'замыкан'], popular: true },
      { id: 'sockets', kz: 'Розетка және сөндіргіш', ru: 'Розетки и выключатели', emoji: '1f50c', keywords: ['розетк', 'выключател', 'сөндіргіш'] },
      { id: 'lighting', kz: 'Люстра және шам орнату', ru: 'Люстры и освещение', emoji: '1f4a1', keywords: ['люстр', 'шам', 'светильник', 'освещ'] },
      { id: 'wiring', kz: 'Электр сымдарын ауыстыру', ru: 'Замена проводки', emoji: '1f9f6', keywords: ['проводк', 'сым', 'кабел'] },
      { id: 'panel', kz: 'Электр щиті және автоматтар', ru: 'Электрощит и автоматы', emoji: '1f50b', keywords: ['щит', 'автомат', 'щиток'] },
      { id: 'cctv', kz: 'Бейнебақылау орнату', ru: 'Видеонаблюдение', emoji: '1f4f9', keywords: ['камер', 'бейнебақыл', 'видеонаблюд'] },
      { id: 'intercom', kz: 'Домофон орнату', ru: 'Домофоны', emoji: '1f514', keywords: ['домофон'] },
      { id: 'tv_internet_cable', kz: 'Интернет, ТВ кабелі, антенна', ru: 'Интернет, ТВ-кабель, антенна', emoji: '1f4e1', keywords: ['интернет кабел', 'тв кабел', 'антенн'] },
      { id: 'electric_meter', kz: 'Электр есептегіші', ru: 'Электросчётчики', emoji: '1f4ca', keywords: ['электросчётчик', 'электросчетчик'] },
    ],
  },
  {
    id: 'heating_boiler',
    kz: 'Жылыту және қазандықтар',
    ru: 'Отопление и котлы',
    kzHint: 'Газ қазандығы, радиатор, жылы еден',
    ruHint: 'Газовые котлы, радиаторы, тёплый пол',
    emoji: '1f525',
    color: 'red',
    quick: REPAIR_TAGS,
    services: [
      { id: 'boiler_repair', kz: 'Газ қазандығын жөндеу', ru: 'Ремонт газовых котлов', emoji: '1f525', keywords: ['қазандық', 'котел', 'котла', 'котёл'], popular: true },
      { id: 'boiler_install', kz: 'Қазандық орнату', ru: 'Установка котла', emoji: '1f6e0-fe0f', keywords: ['установка котл'] },
      { id: 'radiators', kz: 'Радиатор (батарея)', ru: 'Радиаторы и батареи', emoji: '1f321-fe0f', keywords: ['радиатор', 'батаре'] },
      { id: 'heating_system', kz: 'Жылыту жүйесін орнату', ru: 'Монтаж отопления', emoji: '2668-fe0f', keywords: ['отоплен', 'жылыту'] },
      { id: 'underfloor_heating', kz: 'Жылы еден', ru: 'Тёплый пол', emoji: '1f3e0', keywords: ['тёплый пол', 'теплый пол', 'жылы еден'] },
      { id: 'heating_flush', kz: 'Жылыту жүйесін жуу', ru: 'Промывка отопления', emoji: '1f4a7', keywords: ['промывк'] },
      { id: 'gas_equipment', kz: 'Газ жабдықтары', ru: 'Газовое оборудование', emoji: '1f6e2-fe0f', keywords: ['газов', 'газ плит', 'газ құбыр'] },
    ],
  },
  {
    id: 'ac_ventilation',
    kz: 'Кондиционер және желдету',
    ru: 'Кондиционеры и вентиляция',
    kzHint: 'Орнату, тазалау, фреон',
    ruHint: 'Установка, чистка, заправка фреоном',
    emoji: '2744-fe0f',
    color: 'cyan',
    quick: REPAIR_TAGS,
    services: [
      { id: 'ac_install', kz: 'Кондиционер орнату', ru: 'Установка кондиционера', emoji: '2744-fe0f', keywords: ['кондиционер', 'сплит'], popular: true },
      { id: 'ac_service', kz: 'Кондиционерді тазалау және жөндеу', ru: 'Чистка и ремонт кондиционера', emoji: '1f32c-fe0f', keywords: ['чистка кондиц', 'заправк', 'фреон'] },
      { id: 'ventilation', kz: 'Желдету жүйесі', ru: 'Вентиляция', emoji: '1f4a8', keywords: ['желдет', 'вентиляц', 'вытяжк'] },
      { id: 'air_purifier', kz: 'Ауа тазартқыш және ылғалдатқыш', ru: 'Очистители и увлажнители воздуха', emoji: '1f343', keywords: ['очистител', 'увлажнит'] },
    ],
  },
  {
    id: 'appliances',
    kz: 'Техника жөндеу',
    ru: 'Ремонт техники',
    kzHint: 'Кір жуғыш, тоңазытқыш, теледидар',
    ruHint: 'Стиральные машины, холодильники, ТВ',
    emoji: '1f6e0-fe0f',
    color: 'indigo',
    quick: REPAIR_TAGS,
    services: [
      { id: 'washing_machine', kz: 'Кір жуғыш машина жөндеу', ru: 'Ремонт стиральных машин', emoji: '1f9fa', keywords: ['кір жуғыш', 'стирал', 'стиралк'], popular: true },
      { id: 'fridge', kz: 'Тоңазытқыш жөндеу', ru: 'Ремонт холодильников', emoji: '1f9ca', keywords: ['тоңазытқыш', 'холодильник', 'морозил'], popular: true },
      { id: 'dishwasher', kz: 'Ыдыс жуғыш машина жөндеу', ru: 'Ремонт посудомоечных машин', emoji: '1f37d-fe0f', keywords: ['ыдыс жуғыш', 'посудомо'] },
      { id: 'oven', kz: 'Плита және духовка жөндеу', ru: 'Ремонт плит и духовок', emoji: '1f373', keywords: ['плит', 'духов', 'пеш'] },
      { id: 'microwave', kz: 'Микротолқынды пеш жөндеу', ru: 'Ремонт микроволновок', emoji: '1f35c', keywords: ['микроволн', 'микротолқын'] },
      { id: 'tv_repair', kz: 'Теледидар жөндеу', ru: 'Ремонт телевизоров', emoji: '1f4fa', keywords: ['теледидар', 'телевизор'] },
      { id: 'phone_repair', kz: 'Телефон жөндеу', ru: 'Ремонт телефонов', emoji: '1f4f1', keywords: ['телефон', 'смартфон', 'экран'] },
      { id: 'small_appliances', kz: 'Ұсақ тұрмыстық техника', ru: 'Ремонт мелкой техники', emoji: '1f50c', keywords: ['пылесос', 'шаңсорғыш', 'утюг', 'чайник'] },
      { id: 'coffee_machine', kz: 'Кофе машина жөндеу', ru: 'Ремонт кофемашин', emoji: '2615', keywords: ['кофемаш'] },
    ],
  },
  {
    id: 'furniture_carpentry',
    kz: 'Жиһаз және ағаш шебері',
    ru: 'Мебель и столяр',
    kzHint: 'Құрастыру, жөндеу, тапсырыспен жасау',
    ruHint: 'Сборка, ремонт, мебель на заказ',
    emoji: '1f6cb-fe0f',
    color: 'stone',
    quick: [
      { kz: 'Құрастыру', ru: 'Сборка' },
      { kz: 'Жөндеу', ru: 'Ремонт' },
      { kz: 'Тапсырыспен жасау', ru: 'Изготовление на заказ' },
    ],
    services: [
      { id: 'furniture_assembly', kz: 'Жиһаз құрастыру', ru: 'Сборка мебели', emoji: '1fa9b', keywords: ['жиһаз құраст', 'сборка мебел', 'сборк'], popular: true },
      { id: 'furniture_repair', kz: 'Жиһаз жөндеу', ru: 'Ремонт мебели', emoji: '1f528', keywords: ['ремонт мебел', 'жиһаз жөнде'] },
      { id: 'upholstery', kz: 'Жұмсақ жиһазды қаптау', ru: 'Перетяжка мебели', emoji: '1f6cb-fe0f', keywords: ['перетяжк', 'қаптау'] },
      { id: 'custom_furniture', kz: 'Тапсырыспен жиһаз жасау', ru: 'Мебель на заказ', emoji: '1fa9a', keywords: ['на заказ', 'тапсырыспен'] },
      { id: 'kitchen_cabinets', kz: 'Асүй жиһазы', ru: 'Кухонные гарнитуры', emoji: '1f5c4-fe0f', keywords: ['гарнитур', 'кухонн'] },
      { id: 'wardrobe', kz: 'Шкаф-купе', ru: 'Шкафы-купе', emoji: '1f45a', keywords: ['шкаф', 'купе'] },
      { id: 'carpentry', kz: 'Ағаш шебері', ru: 'Столяр и плотник', emoji: '1fab5', keywords: ['столяр', 'плотник', 'ағаш'] },
    ],
  },
  {
    id: 'cleaning_moving',
    kz: 'Тазалау',
    ru: 'Уборка и клининг',
    kzHint: 'Үй, кеңсе, кілем, диван',
    ruHint: 'Квартиры, офисы, ковры, мебель',
    emoji: '1f9f9',
    color: 'emerald',
    quick: [
      { kz: '1 бөлмелі', ru: '1-комнатная' },
      { kz: '2 бөлмелі', ru: '2-комнатная' },
      { kz: '3+ бөлмелі', ru: '3 и более комнат' },
      { kz: 'Жеке үй', ru: 'Частный дом' },
      { kz: 'Кеңсе', ru: 'Офис' },
    ],
    services: [
      { id: 'home_cleaning', kz: 'Үй тазалау', ru: 'Уборка квартиры', emoji: '1f9f9', keywords: ['тазала', 'уборк', 'клининг'], popular: true },
      { id: 'deep_cleaning', kz: 'Жалпы тазалау', ru: 'Генеральная уборка', emoji: '1f9fd', keywords: ['генеральн'] },
      { id: 'post_renovation_cleaning', kz: 'Жөндеуден кейін тазалау', ru: 'Уборка после ремонта', emoji: '1f6a7', keywords: ['после ремонт', 'жөндеуден кейін'] },
      { id: 'office_cleaning', kz: 'Кеңсе тазалау', ru: 'Уборка офиса', emoji: '1f3e2', keywords: ['уборка офис', 'кеңсе тазала'] },
      { id: 'carpet_cleaning', kz: 'Кілем жуу', ru: 'Стирка ковров', emoji: '1f9fc', keywords: ['кілем', 'ковр', 'ковер'] },
      { id: 'sofa_cleaning', kz: 'Жиһаз химчисткасы', ru: 'Химчистка мебели', emoji: '1f6cb-fe0f', keywords: ['химчистк', 'диван'] },
      { id: 'window_cleaning', kz: 'Терезе жуу', ru: 'Мойка окон', emoji: '1fa9f', keywords: ['мойка окон', 'терезе жуу'] },
      { id: 'pest_control', kz: 'Дезинсекция және дезинфекция', ru: 'Дезинсекция и дезинфекция', emoji: '1f41c', keywords: ['таракан', 'клоп', 'дезинс', 'дезинф', 'тышқан', 'мыш'] },
    ],
  },
  {
    id: 'moving',
    kz: 'Көшу және жүк тасымалы',
    ru: 'Переезд и грузоперевозки',
    kzHint: 'Газель, жүк тиеушілер, курьер',
    ruHint: 'Газель, грузчики, курьер',
    emoji: '1f69a',
    color: 'blue',
    quick: [
      { kz: 'Қала ішінде', ru: 'По городу' },
      { kz: 'Қалааралық', ru: 'Межгород' },
      { kz: 'Жүк тиеушілермен', ru: 'С грузчиками' },
    ],
    services: [
      { id: 'apartment_moving', kz: 'Пәтер көшіру', ru: 'Квартирный переезд', emoji: '1f4e6', keywords: ['көшу', 'көшір', 'переезд'], popular: true },
      { id: 'office_moving', kz: 'Кеңсе көшіру', ru: 'Офисный переезд', emoji: '1f5c2-fe0f', keywords: ['офисный переезд'] },
      { id: 'cargo', kz: 'Жүк тасымалы (Газель)', ru: 'Грузоперевозки (Газель)', emoji: '1f69a', keywords: ['газель', 'жүк', 'груз', 'перевоз'] },
      { id: 'movers', kz: 'Жүк тиеушілер', ru: 'Грузчики', emoji: '1f4aa', keywords: ['грузчик', 'тиеуші'] },
      { id: 'courier', kz: 'Курьер', ru: 'Курьер и доставка', emoji: '1f6f5', keywords: ['курьер', 'доставк', 'жеткіз'] },
      { id: 'garbage_removal', kz: 'Қоқыс шығару', ru: 'Вывоз мусора', emoji: '1f5d1-fe0f', keywords: ['мусор', 'қоқыс'] },
      { id: 'piano_moving', kz: 'Пианино тасымалы', ru: 'Перевозка пианино', emoji: '1f3b9', keywords: ['пианино'] },
    ],
  },
  {
    id: 'household',
    kz: 'Үй шебері',
    ru: 'Мастер на час',
    kzHint: 'Құлып, сөре, тігін, ұсақ жұмыстар',
    ruHint: 'Замки, полки, пошив, мелкий ремонт',
    emoji: '1f9f0',
    color: 'lime',
    quick: [
      { kz: 'Бір жұмыс', ru: 'Одна задача' },
      { kz: 'Бірнеше жұмыс', ru: 'Несколько задач' },
    ],
    services: [
      { id: 'handyman', kz: 'Сағаттық шебер', ru: 'Мастер на час', emoji: '1f9f0', keywords: ['мастер на час', 'муж на час', 'сағаттық'], popular: true },
      { id: 'locksmith', kz: 'Құлып ашу және ауыстыру', ru: 'Вскрытие и замена замков', emoji: '1f511', keywords: ['құлып', 'замок', 'замк', 'вскрыт'] },
      { id: 'hanging', kz: 'Сөре, карниз, сурет ілу', ru: 'Повесить полку, карниз, картину', emoji: '1f5bc-fe0f', keywords: ['карниз', 'полк', 'сөре', 'повесить'] },
      { id: 'tailoring', kz: 'Тігін және киім жөндеу', ru: 'Пошив и ремонт одежды', emoji: '1f9f5', keywords: ['тігін', 'ателье', 'пошив', 'швея'] },
      { id: 'shoe_repair', kz: 'Аяқ киім жөндеу', ru: 'Ремонт обуви', emoji: '1f45e', keywords: ['обув', 'аяқ киім'] },
      { id: 'key_copy', kz: 'Кілт жасау', ru: 'Изготовление ключей', emoji: '1f5dd-fe0f', keywords: ['ключ', 'кілт'] },
      { id: 'blinds', kz: 'Жалюзи және перде', ru: 'Жалюзи и шторы', emoji: '1fa9f', keywords: ['жалюзи', 'штор', 'перде'] },
      { id: 'watch_jewelry', kz: 'Сағат және зергерлік бұйым жөндеу', ru: 'Ремонт часов и ювелирных изделий', emoji: '231a', keywords: ['сағат жөнде', 'часов', 'ювелир', 'зергер'] },
    ],
  },
  {
    id: 'auto',
    kz: 'Автоқызметтер',
    ru: 'Автоуслуги',
    kzHint: 'Жөндеу, эвакуатор, шиномонтаж',
    ruHint: 'Ремонт, эвакуатор, шиномонтаж',
    emoji: '1f697',
    color: 'slate',
    quick: [
      { kz: 'Жеңіл көлік', ru: 'Легковой' },
      { kz: 'Джип', ru: 'Внедорожник' },
      { kz: 'Жүк көлігі', ru: 'Грузовой' },
      { kz: 'Жолда тұрмын', ru: 'Стою на дороге' },
    ],
    services: [
      { id: 'car_repair', kz: 'Көлік жөндеу', ru: 'Ремонт авто', emoji: '1f697', keywords: ['көлік', 'автомобил', 'авто ремонт', 'сто '], popular: true },
      { id: 'tow_truck', kz: 'Эвакуатор', ru: 'Эвакуатор', emoji: '1f69b', keywords: ['эвакуатор'] },
      { id: 'tire_service', kz: 'Шиномонтаж', ru: 'Шиномонтаж', emoji: '1f6de', keywords: ['шина', 'шиномонтаж', 'дөңгелек', 'колес'] },
      { id: 'car_wash', kz: 'Көлік жуу', ru: 'Автомойка и химчистка', emoji: '1f9fc', keywords: ['автомойк', 'көлік жуу'] },
      { id: 'battery_jump', kz: 'Аккумулятор оталдыру', ru: 'Прикурить авто', emoji: '1f50b', keywords: ['аккумулятор', 'прикур'] },
      { id: 'auto_electric', kz: 'Автоэлектрик', ru: 'Автоэлектрик', emoji: '1f50c', keywords: ['автоэлектрик'] },
      { id: 'car_diagnostics', kz: 'Компьютерлік диагностика', ru: 'Диагностика авто', emoji: '1f4ca', keywords: ['диагностика авто', 'компьютерная диагност'] },
      { id: 'body_repair', kz: 'Кузов жөндеу және бояу', ru: 'Кузовной ремонт и покраска', emoji: '1f3a8', keywords: ['кузов', 'вмятин'] },
      { id: 'driver', kz: 'Жүргізуші (сергек жүргізуші)', ru: 'Трезвый водитель', emoji: '1f698', keywords: ['водител', 'жүргізуші'] },
    ],
  },
  {
    id: 'beauty',
    kz: 'Сұлулық және денсаулық',
    ru: 'Красота и здоровье',
    kzHint: 'Шаштараз, маникюр, массаж',
    ruHint: 'Парикмахер, маникюр, массаж',
    emoji: '1f485',
    color: 'pink',
    quick: [
      { kz: 'Үйге шақыру', ru: 'С выездом на дом' },
      { kz: 'Шебердің орнында', ru: 'У мастера' },
    ],
    services: [
      { id: 'hairdresser', kz: 'Шаштараз', ru: 'Парикмахер', emoji: '1f487', keywords: ['шаштараз', 'парикмахер', 'стрижк', 'шаш қию'], popular: true },
      { id: 'manicure', kz: 'Маникюр және педикюр', ru: 'Маникюр и педикюр', emoji: '1f485', keywords: ['маникюр', 'педикюр', 'тырнақ', 'ногт'], popular: true },
      { id: 'makeup', kz: 'Визажист', ru: 'Визажист', emoji: '1f484', keywords: ['макияж', 'визаж', 'бояну'] },
      { id: 'lashes_brows', kz: 'Кірпік және қас', ru: 'Ресницы и брови', emoji: '1f441-fe0f', keywords: ['кірпік', 'ресниц', 'қас', 'бров'] },
      { id: 'massage', kz: 'Массаж', ru: 'Массаж', emoji: '1f486', keywords: ['массаж', 'уқалау'] },
      { id: 'cosmetology', kz: 'Косметолог', ru: 'Косметолог', emoji: '1f9f4', keywords: ['косметолог'] },
      { id: 'nurse', kz: 'Үйге медбике шақыру', ru: 'Медсестра на дом', emoji: '1f489', keywords: ['медсестр', 'медбике', 'укол', 'капельниц'] },
      { id: 'fitness_trainer', kz: 'Жеке жаттықтырушы', ru: 'Персональный тренер', emoji: '1f3cb-fe0f', keywords: ['тренер', 'жаттықтырушы', 'фитнес'] },
    ],
  },
  {
    id: 'tutoring',
    kz: 'Репетиторлар және оқыту',
    ru: 'Репетиторы и обучение',
    kzHint: 'Пәндер, тілдер, ҰБТ, музыка',
    ruHint: 'Предметы, языки, ЕНТ, музыка',
    emoji: '1f393',
    color: 'violet',
    quick: [
      { kz: 'Мектеп оқушысы', ru: 'Школьник' },
      { kz: 'Студент', ru: 'Студент' },
      { kz: 'Ересек', ru: 'Взрослый' },
      { kz: 'Онлайн', ru: 'Онлайн' },
      { kz: 'Үйде', ru: 'На дому' },
    ],
    services: [
      { id: 'math', kz: 'Математика', ru: 'Математика', emoji: '1f4d0', keywords: ['математик', 'алгебр', 'геометр'], popular: true },
      { id: 'english', kz: 'Ағылшын тілі', ru: 'Английский язык', emoji: '1f30d', keywords: ['ағылшын', 'английск'], popular: true },
      { id: 'russian_lang', kz: 'Орыс тілі', ru: 'Русский язык', emoji: '1f4da', keywords: ['орыс тіл', 'русск'] },
      { id: 'kazakh_lang', kz: 'Қазақ тілі', ru: 'Казахский язык', emoji: '1f4d6', keywords: ['қазақ тіл', 'казахск'] },
      { id: 'ent_prep', kz: 'ҰБТ-ға дайындық', ru: 'Подготовка к ЕНТ', emoji: '1f4dd', keywords: ['ұбт', 'ент'] },
      { id: 'school_prep', kz: 'Мектепке дайындық', ru: 'Подготовка к школе', emoji: '1f392', keywords: ['мектепке дайын', 'подготовка к школ'] },
      { id: 'physics_chemistry', kz: 'Физика және химия', ru: 'Физика и химия', emoji: '1f9ea', keywords: ['физик', 'хими'] },
      { id: 'music_lessons', kz: 'Музыка сабақтары', ru: 'Уроки музыки', emoji: '1f3b8', keywords: ['музык', 'гитар', 'фортепиан', 'домбыр'] },
      { id: 'speech_therapist', kz: 'Логопед', ru: 'Логопед', emoji: '1f5e3-fe0f', keywords: ['логопед'] },
      { id: 'driving', kz: 'Көлік жүргізуге үйрету', ru: 'Автоинструктор', emoji: '1f6a6', keywords: ['автоинструктор', 'вождени'] },
      { id: 'programming', kz: 'Бағдарламалау', ru: 'Программирование', emoji: '1f4bb', keywords: ['программир', 'бағдарлама'] },
    ],
  },
  {
    id: 'events',
    kz: 'Той және мерекелер',
    ru: 'Праздники и мероприятия',
    kzHint: 'Фотограф, асаба, кейтеринг',
    ruHint: 'Фотограф, тамада, кейтеринг',
    emoji: '1f389',
    color: 'fuchsia',
    quick: [
      { kz: 'Той', ru: 'Той / свадьба' },
      { kz: 'Туған күн', ru: 'День рождения' },
      { kz: 'Корпоратив', ru: 'Корпоратив' },
      { kz: 'Балалар мерекесі', ru: 'Детский праздник' },
    ],
    services: [
      { id: 'photographer', kz: 'Фотограф', ru: 'Фотограф', emoji: '1f4f8', keywords: ['фотограф', 'фотосессия'], popular: true },
      { id: 'videographer', kz: 'Видеограф', ru: 'Видеооператор', emoji: '1f3a5', keywords: ['видеограф', 'видеооператор', 'видеосъём'] },
      { id: 'toy_host', kz: 'Асаба', ru: 'Ведущий (тамада)', emoji: '1f3a4', keywords: ['асаба', 'тамада', 'ведущ'] },
      { id: 'toy_organization', kz: 'Той ұйымдастыру', ru: 'Организация тоя и свадьбы', emoji: '1f48d', keywords: ['той ұйымд', 'свадьб', 'үйлену'] },
      { id: 'catering', kz: 'Кейтеринг және торт', ru: 'Кейтеринг и торты', emoji: '1f382', keywords: ['кейтеринг', 'торт'] },
      { id: 'musicians', kz: 'Әншілер және DJ', ru: 'Музыканты и DJ', emoji: '1f3a7', keywords: ['dj', 'диджей', 'әнші', 'музыкант'] },
      { id: 'animator', kz: 'Аниматор', ru: 'Аниматоры для детей', emoji: '1f973', keywords: ['аниматор'] },
      { id: 'decor', kz: 'Безендіру және шарлар', ru: 'Оформление и шары', emoji: '1f388', keywords: ['шарлар', 'шары', 'безенд', 'оформлен'] },
    ],
  },
  {
    id: 'it_digital',
    kz: 'Компьютер және IT',
    ru: 'Компьютеры и IT',
    kzHint: 'Жөндеу, Wi-Fi, сайт, дизайн',
    ruHint: 'Ремонт, Wi-Fi, сайты, дизайн',
    emoji: '1f4bb',
    color: 'teal',
    quick: REPAIR_TAGS,
    services: [
      { id: 'computer_repair', kz: 'Компьютер және ноутбук жөндеу', ru: 'Ремонт компьютеров и ноутбуков', emoji: '1f4bb', keywords: ['компьютер', 'ноутбук'], popular: true },
      { id: 'windows_install', kz: 'Windows және бағдарламалар орнату', ru: 'Установка Windows и программ', emoji: '1f4bf', keywords: ['windows', 'виндовс', 'программ'] },
      { id: 'wifi_setup', kz: 'Wi-Fi және роутер баптау', ru: 'Настройка Wi-Fi и роутера', emoji: '1f4f6', keywords: ['wi-fi', 'wifi', 'роутер'] },
      { id: 'website', kz: 'Сайт жасау', ru: 'Создание сайтов', emoji: '1f310', keywords: ['сайт'] },
      { id: 'graphic_design', kz: 'Графикалық дизайн және логотип', ru: 'Графический дизайн и логотипы', emoji: '1f3a8', keywords: ['дизайн', 'логотип'] },
      { id: 'smm', kz: 'SMM және жарнама', ru: 'SMM и реклама', emoji: '1f4e3', keywords: ['smm', 'таргет', 'реклам', 'инстаграм'] },
      { id: 'printer_repair', kz: 'Принтер жөндеу', ru: 'Ремонт принтеров', emoji: '1f5a8-fe0f', keywords: ['принтер'] },
    ],
  },
  {
    id: 'care',
    kz: 'Күтім: бала, қарт, жануар',
    ru: 'Няни, сиделки, животные',
    kzHint: 'Бала күтуші, сиделка, ветеринар',
    ruHint: 'Няни, сиделки, ветеринар',
    emoji: '1f9f8',
    color: 'rose',
    quick: [
      { kz: 'Бір рет', ru: 'Разово' },
      { kz: 'Тұрақты', ru: 'Постоянно' },
      { kz: 'Түнгі уақытта', ru: 'В ночное время' },
    ],
    services: [
      { id: 'nanny', kz: 'Бала күтуші', ru: 'Няня', emoji: '1f37c', keywords: ['бала күт', 'няня', 'няни'], popular: true },
      { id: 'elderly_care', kz: 'Қарт адамға күтуші', ru: 'Сиделка', emoji: '1f475', keywords: ['сиделк', 'қарт'] },
      { id: 'housekeeper', kz: 'Үй көмекшісі', ru: 'Домработница', emoji: '1f3e1', keywords: ['домработниц', 'үй көмекші'] },
      { id: 'pet_sitting', kz: 'Жануарға қарау', ru: 'Передержка животных', emoji: '1f415', keywords: ['передержк', 'жануар', 'собак', 'кошк'] },
      { id: 'dog_walking', kz: 'Итті серуендету', ru: 'Выгул собак', emoji: '1f43e', keywords: ['выгул', 'серуенде'] },
      { id: 'grooming', kz: 'Груминг', ru: 'Груминг', emoji: '2702-fe0f', keywords: ['груминг', 'стрижка собак'] },
      { id: 'vet', kz: 'Ветеринар (үйге)', ru: 'Ветеринар на дом', emoji: '1fa7a', keywords: ['ветеринар', 'мал дәрігер'] },
      { id: 'cook', kz: 'Аспазшы (үйге)', ru: 'Повар на дом', emoji: '1f9d1-200d-1f373', keywords: ['повар', 'аспазшы'] },
    ],
  },
  {
    id: 'garden',
    kz: 'Бақ және аула',
    ru: 'Сад и двор',
    kzHint: 'Бақ, ағаш кесу, қар, құдық',
    ruHint: 'Сад, спил деревьев, снег, скважины',
    emoji: '1f333',
    color: 'green',
    quick: [
      { kz: 'Жеке үй', ru: 'Частный дом' },
      { kz: 'Саяжай', ru: 'Дача' },
    ],
    services: [
      { id: 'gardening', kz: 'Бақ күтімі', ru: 'Уход за садом', emoji: '1fab4', keywords: ['бақ күт', 'уход за сад', 'газон'], popular: true },
      { id: 'tree_cutting', kz: 'Ағаш кесу', ru: 'Спил деревьев', emoji: '1fab5', keywords: ['спил', 'ағаш кесу'] },
      { id: 'snow_removal', kz: 'Қар тазалау', ru: 'Уборка снега', emoji: '2603-fe0f', keywords: ['қар тазала', 'снег'] },
      { id: 'landscaping', kz: 'Ландшафт дизайны', ru: 'Ландшафтный дизайн', emoji: '1f337', keywords: ['ландшафт'] },
      { id: 'well_drilling', kz: 'Құдық және скважина', ru: 'Бурение скважин', emoji: '1f4a7', keywords: ['скважин', 'құдық', 'колодец'] },
      { id: 'septic', kz: 'Септик және ассенизатор', ru: 'Септики и ассенизатор', emoji: '1faa3', keywords: ['септик', 'ассениз', 'выгребн'] },
      { id: 'pool', kz: 'Бассейн күтімі', ru: 'Обслуживание бассейнов', emoji: '1f3ca', keywords: ['бассейн'] },
    ],
  },
  {
    id: 'business',
    kz: 'Заң және бухгалтерия',
    ru: 'Юристы и бухгалтеры',
    kzHint: 'Заңгер, бухгалтер, тіркеу, аударма',
    ruHint: 'Юрист, бухгалтер, регистрация, переводы',
    emoji: '2696-fe0f',
    color: 'zinc',
    quick: [
      { kz: 'Кеңес', ru: 'Консультация' },
      { kz: 'Құжат дайындау', ru: 'Подготовка документов' },
      { kz: 'Тұрақты қызмет', ru: 'Постоянное обслуживание' },
    ],
    services: [
      { id: 'lawyer', kz: 'Заңгер кеңесі', ru: 'Консультация юриста', emoji: '2696-fe0f', keywords: ['заңгер', 'юрист', 'адвокат'], popular: true },
      { id: 'accountant', kz: 'Бухгалтер', ru: 'Бухгалтерские услуги', emoji: '1f9fe', keywords: ['бухгалтер', 'декларац', 'налог', 'салық'] },
      { id: 'ip_registration', kz: 'ЖК / ЖШС тіркеу', ru: 'Регистрация ИП и ТОО', emoji: '1f4cb', keywords: ['регистрац', 'ип ', 'тоо', 'жк ', 'жшс'] },
      { id: 'translation', kz: 'Аударма', ru: 'Переводы', emoji: '1f4ac', keywords: ['аударма', 'перевод'] },
      { id: 'realtor', kz: 'Риелтор', ru: 'Риелтор', emoji: '1f3d8-fe0f', keywords: ['риелтор', 'риэлтор', 'жылжымайтын'] },
    ],
  },
];

for (const g of SERVICE_CATALOG) {
  if (LICENSED_GROUPS.includes(g.id)) g.licensed = true;
}

/** Path of a 3D icon (public/img/3d). */
export function emojiSrc(code: string): string {
  return `/img/3d/${code}.webp`;
}

export function getGroup(groupId?: string): CatalogGroup | undefined {
  return SERVICE_CATALOG.find((g) => g.id === groupId);
}

export function getService(serviceId?: string): { group: CatalogGroup; service: CatalogService } | undefined {
  if (!serviceId) return undefined;
  for (const group of SERVICE_CATALOG) {
    const service = group.services.find((s) => s.id === serviceId);
    if (service) return { group, service };
  }
  return undefined;
}

export function groupName(group: CatalogGroup, language: string): string {
  return language === 'kz' ? group.kz : group.ru;
}

export function serviceName(service: CatalogService, language: string): string {
  return language === 'kz' ? service.kz : service.ru;
}

export function popularServices(): { group: CatalogGroup; service: CatalogService }[] {
  const out: { group: CatalogGroup; service: CatalogService }[] = [];
  for (const group of SERVICE_CATALOG) {
    for (const service of group.services) {
      if (service.popular) out.push({ group, service });
    }
  }
  return out;
}

/** Services whose name or keywords contain the typed text (both languages are searched). */
export function searchServices(text: string, limit = 8): { group: CatalogGroup; service: CatalogService }[] {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored: { score: number; group: CatalogGroup; service: CatalogService }[] = [];
  for (const group of SERVICE_CATALOG) {
    for (const service of group.services) {
      const names = [service.kz.toLowerCase(), service.ru.toLowerCase()];
      let score = 0;
      if (names.some((n) => n.startsWith(q))) score = 3;
      else if (names.some((n) => n.includes(q))) score = 2;
      else if ((service.keywords || []).some((k) => q.includes(k.trim()) || k.trim().startsWith(q))) score = 1;
      else if ([group.kz.toLowerCase(), group.ru.toLowerCase()].some((n) => n.includes(q))) score = 0.5;
      if (score > 0) scored.push({ score, group, service });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const TOTAL_SERVICE_COUNT = SERVICE_CATALOG.reduce((n, g) => n + g.services.length, 0);

/** Groups a provider works in: categoryIds, or the single legacy categoryId. */
export function providerGroupIds(p: { categoryIds?: string[]; categoryId?: string } | null | undefined): string[] {
  if (!p) return [];
  if (Array.isArray(p.categoryIds) && p.categoryIds.length > 0) return p.categoryIds;
  return p.categoryId ? [p.categoryId] : [];
}

/** Keeps only known ids, without duplicates, so profiles never store free text in these lists. */
export function cleanCatalogIds(serviceIds: unknown): { serviceIds: string[]; categoryIds: string[] } {
  const ids = Array.isArray(serviceIds) ? serviceIds.filter((x): x is string => typeof x === 'string') : [];
  const services: string[] = [];
  const groups: string[] = [];
  for (const id of ids) {
    const found = getService(id);
    if (!found || services.includes(id)) continue;
    services.push(id);
    if (!groups.includes(found.group.id)) groups.push(found.group.id);
  }
  return { serviceIds: services.slice(0, 160), categoryIds: groups };
}
