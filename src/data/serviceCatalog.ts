/**
 * Service catalogue: main groups and the services inside them, in Kazakh and Russian.
 *
 * A group id is the request's categoryId (the eight original ids are kept, so existing requests
 * and provider profiles keep matching). A service id is stored as serviceId on requests and in
 * serviceIds on provider profiles. `keywords` are lowercase word stems used by the search box.
 */

export interface CatalogService {
  id: string;
  kz: string;
  ru: string;
  keywords?: string[];
  popular?: boolean;
}

export interface CatalogGroup {
  id: string;
  kz: string;
  ru: string;
  /** lucide-react icon name, mapped in components/CategoryIcon.tsx */
  icon: string;
  /** Tailwind colour family for the tile */
  color: string;
  services: CatalogService[];
}

export const SERVICE_CATALOG: CatalogGroup[] = [
  {
    id: 'painting_finishing',
    kz: 'Жөндеу және әрлеу',
    ru: 'Ремонт и отделка',
    icon: 'PaintRoller',
    color: 'orange',
    services: [
      { id: 'painting', kz: 'Бояу жұмыстары', ru: 'Покраска стен и потолков', keywords: ['бояу', 'покрас', 'краск', 'маляр'], popular: true },
      { id: 'whitewash', kz: 'Ақтау', ru: 'Побелка', keywords: ['ақта', 'побел'] },
      { id: 'plastering', kz: 'Сылақ жұмыстары', ru: 'Штукатурка и шпаклёвка', keywords: ['сылақ', 'штукатур', 'шпакл', 'выравнив'] },
      { id: 'wallpaper', kz: 'Тұсқағаз жапсыру', ru: 'Поклейка обоев', keywords: ['тұсқағаз', 'обои', 'обоев'] },
      { id: 'tiling', kz: 'Плитка төсеу', ru: 'Укладка плитки', keywords: ['плитк', 'кафел', 'керамик'], popular: true },
      { id: 'flooring', kz: 'Ламинат және паркет төсеу', ru: 'Ламинат и паркет', keywords: ['ламинат', 'паркет', 'еден', 'пол ', 'линолеум'] },
      { id: 'drywall', kz: 'Гипсокартон жұмыстары', ru: 'Гипсокартон', keywords: ['гипсокартон', 'гкл'] },
      { id: 'ceiling', kz: 'Аспалы және керме төбе', ru: 'Натяжные и подвесные потолки', keywords: ['натяжн', 'подвесн', 'төбе', 'потол'] },
      { id: 'screed', kz: 'Еден стяжкасы', ru: 'Стяжка пола', keywords: ['стяжк'] },
      { id: 'apartment_renovation', kz: 'Пәтерді толық жөндеу', ru: 'Ремонт квартиры под ключ', keywords: ['под ключ', 'капремонт', 'евроремонт', 'толық жөнде'] },
      { id: 'bathroom_renovation', kz: 'Жуынатын бөлмені жөндеу', ru: 'Ремонт ванной комнаты', keywords: ['ванн', 'санузел', 'жуынатын'] },
      { id: 'kitchen_renovation', kz: 'Асүйді жөндеу', ru: 'Ремонт кухни', keywords: ['ремонт кухн', 'асүй'] },
      { id: 'decorative_plaster', kz: 'Сәндік сылақ', ru: 'Декоративная штукатурка', keywords: ['декоратив'] },
    ],
  },
  {
    id: 'construction',
    kz: 'Құрылыс',
    ru: 'Строительство',
    icon: 'HardHat',
    color: 'amber',
    services: [
      { id: 'masonry', kz: 'Кірпіш қалау', ru: 'Кладка кирпича и блоков', keywords: ['кладк', 'кірпіш', 'кирпич', 'блок'] },
      { id: 'house_building', kz: 'Үй салу', ru: 'Строительство дома', keywords: ['үй салу', 'строительство дом', 'коттедж'] },
      { id: 'roofing', kz: 'Шатыр жабу және жөндеу', ru: 'Кровельные работы', keywords: ['шатыр', 'кровл', 'крыш'] },
      { id: 'concrete', kz: 'Бетон жұмыстары', ru: 'Бетонные работы и фундамент', keywords: ['бетон', 'фундамент', 'іргетас'] },
      { id: 'welding', kz: 'Дәнекерлеу жұмыстары', ru: 'Сварочные работы', keywords: ['дәнекер', 'свар'] },
      { id: 'windows', kz: 'Терезе орнату', ru: 'Установка окон', keywords: ['терезе', 'окн', 'окон', 'пластиков'] },
      { id: 'doors', kz: 'Есік орнату', ru: 'Установка дверей', keywords: ['есік', 'двер'] },
      { id: 'facade', kz: 'Қасбет жұмыстары', ru: 'Фасадные работы и утепление', keywords: ['қасбет', 'фасад', 'утеплен', 'сайдинг'] },
      { id: 'demolition', kz: 'Бұзу жұмыстары', ru: 'Демонтаж', keywords: ['бұзу', 'демонтаж', 'снос'] },
      { id: 'fence', kz: 'Қоршау орнату', ru: 'Заборы и ворота', keywords: ['қоршау', 'забор', 'ворот'] },
      { id: 'bath_sauna', kz: 'Монша салу', ru: 'Строительство бани', keywords: ['монша', 'бан', 'саун'] },
    ],
  },
  {
    id: 'plumbing',
    kz: 'Сантехника',
    ru: 'Сантехника',
    icon: 'Wrench',
    color: 'sky',
    services: [
      { id: 'plumbing_repair', kz: 'Сантехникалық ақауларды жөндеу', ru: 'Сантехник на дом', keywords: ['сантехник', 'ағып', 'течь', 'протека', 'ағады'], popular: true },
      { id: 'faucet', kz: 'Кран және смеситель', ru: 'Краны и смесители', keywords: ['кран', 'смесител', 'шүмек'] },
      { id: 'toilet', kz: 'Унитаз орнату және жөндеу', ru: 'Унитазы', keywords: ['унитаз', 'бачок'] },
      { id: 'drain_cleaning', kz: 'Бітелген құбырды тазалау', ru: 'Устранение засоров', keywords: ['засор', 'бітел', 'прочист', 'канализ'] },
      { id: 'pipes', kz: 'Құбырларды ауыстыру', ru: 'Замена труб', keywords: ['құбыр', 'труб', 'стояк'] },
      { id: 'water_heater', kz: 'Су жылытқыш орнату', ru: 'Установка водонагревателя', keywords: ['бойлер', 'водонагрев', 'су жылыт'] },
      { id: 'shower', kz: 'Душ кабина және ванна орнату', ru: 'Душевые кабины и ванны', keywords: ['душ', 'ванн'] },
      { id: 'water_meter', kz: 'Су есептегішін орнату', ru: 'Установка счётчиков воды', keywords: ['есептегіш', 'счётчик', 'счетчик'] },
      { id: 'washing_machine_install', kz: 'Кір жуғыш машинаны қосу', ru: 'Подключение стиральной машины', keywords: ['подключ'] },
    ],
  },
  {
    id: 'electrician',
    kz: 'Электрика',
    ru: 'Электрика',
    icon: 'Zap',
    color: 'yellow',
    services: [
      { id: 'electric_repair', kz: 'Электрик шақыру', ru: 'Электрик на дом', keywords: ['электрик', 'жарық жоқ', 'нет света', 'замыкан'], popular: true },
      { id: 'sockets', kz: 'Розетка және сөндіргіш', ru: 'Розетки и выключатели', keywords: ['розетк', 'выключател', 'сөндіргіш'] },
      { id: 'lighting', kz: 'Люстра және шам орнату', ru: 'Люстры и освещение', keywords: ['люстр', 'шам', 'светильник', 'освещ'] },
      { id: 'wiring', kz: 'Электр сымдарын ауыстыру', ru: 'Замена проводки', keywords: ['проводк', 'сым', 'кабел'] },
      { id: 'panel', kz: 'Электр щиті', ru: 'Электрощит и автоматы', keywords: ['щит', 'автомат', 'щиток'] },
      { id: 'cctv', kz: 'Бейнебақылау орнату', ru: 'Видеонаблюдение', keywords: ['камер', 'бейнебақыл', 'видеонаблюд'] },
      { id: 'intercom', kz: 'Домофон орнату', ru: 'Домофоны', keywords: ['домофон'] },
      { id: 'tv_internet_cable', kz: 'Интернет және ТВ кабелі', ru: 'Интернет и ТВ-кабель', keywords: ['интернет кабел', 'тв кабел', 'антенн'] },
      { id: 'electric_meter', kz: 'Электр есептегішін орнату', ru: 'Установка электросчётчика', keywords: ['электросчётчик', 'электросчетчик'] },
    ],
  },
  {
    id: 'heating_boiler',
    kz: 'Жылыту және қазандықтар',
    ru: 'Отопление и котлы',
    icon: 'Flame',
    color: 'red',
    services: [
      { id: 'boiler_repair', kz: 'Газ қазандығын жөндеу', ru: 'Ремонт газовых котлов', keywords: ['қазандық', 'котел', 'котла', 'котёл'], popular: true },
      { id: 'boiler_install', kz: 'Қазандық орнату', ru: 'Установка котла', keywords: ['установка котл'] },
      { id: 'radiators', kz: 'Радиатор орнату және жөндеу', ru: 'Радиаторы и батареи', keywords: ['радиатор', 'батаре'] },
      { id: 'heating_system', kz: 'Жылыту жүйесін орнату', ru: 'Монтаж отопления', keywords: ['отоплен', 'жылыту'] },
      { id: 'underfloor_heating', kz: 'Жылы еден', ru: 'Тёплый пол', keywords: ['тёплый пол', 'теплый пол', 'жылы еден'] },
      { id: 'heating_flush', kz: 'Жылыту жүйесін жуу', ru: 'Промывка отопления', keywords: ['промывк'] },
      { id: 'gas_equipment', kz: 'Газ жабдықтары', ru: 'Газовое оборудование', keywords: ['газ', 'газов'] },
    ],
  },
  {
    id: 'ac_ventilation',
    kz: 'Кондиционер және желдету',
    ru: 'Кондиционеры и вентиляция',
    icon: 'Snowflake',
    color: 'cyan',
    services: [
      { id: 'ac_install', kz: 'Кондиционер орнату', ru: 'Установка кондиционера', keywords: ['кондиционер', 'сплит'], popular: true },
      { id: 'ac_service', kz: 'Кондиционерді тазалау және жөндеу', ru: 'Чистка и ремонт кондиционера', keywords: ['чистка кондиц', 'заправк', 'фреон'] },
      { id: 'ventilation', kz: 'Желдету жүйесі', ru: 'Вентиляция', keywords: ['желдет', 'вентиляц', 'вытяжк'] },
      { id: 'air_purifier', kz: 'Ауа тазартқыштар', ru: 'Очистители воздуха', keywords: ['очистител'] },
    ],
  },
  {
    id: 'appliances',
    kz: 'Техника жөндеу',
    ru: 'Ремонт техники',
    icon: 'WashingMachine',
    color: 'indigo',
    services: [
      { id: 'washing_machine', kz: 'Кір жуғыш машина жөндеу', ru: 'Ремонт стиральных машин', keywords: ['кір жуғыш', 'стирал', 'стиралк'], popular: true },
      { id: 'fridge', kz: 'Тоңазытқыш жөндеу', ru: 'Ремонт холодильников', keywords: ['тоңазытқыш', 'холодильник', 'морозил'], popular: true },
      { id: 'dishwasher', kz: 'Ыдыс жуғыш машина жөндеу', ru: 'Ремонт посудомоечных машин', keywords: ['ыдыс жуғыш', 'посудомо'] },
      { id: 'oven', kz: 'Пеш және плита жөндеу', ru: 'Ремонт плит и духовок', keywords: ['плит', 'духов', 'пеш'] },
      { id: 'microwave', kz: 'Микротолқынды пеш жөндеу', ru: 'Ремонт микроволновок', keywords: ['микроволн', 'микротолқын'] },
      { id: 'tv_repair', kz: 'Теледидар жөндеу', ru: 'Ремонт телевизоров', keywords: ['теледидар', 'телевизор'] },
      { id: 'phone_repair', kz: 'Телефон жөндеу', ru: 'Ремонт телефонов', keywords: ['телефон', 'смартфон', 'экран'] },
      { id: 'small_appliances', kz: 'Ұсақ тұрмыстық техника', ru: 'Ремонт мелкой техники', keywords: ['пылесос', 'шаңсорғыш', 'утюг', 'чайник'] },
      { id: 'coffee_machine', kz: 'Кофе машина жөндеу', ru: 'Ремонт кофемашин', keywords: ['кофемаш'] },
    ],
  },
  {
    id: 'furniture_carpentry',
    kz: 'Жиһаз және ағаш жұмыстары',
    ru: 'Мебель и столярные работы',
    icon: 'Armchair',
    color: 'stone',
    services: [
      { id: 'furniture_assembly', kz: 'Жиһаз құрастыру', ru: 'Сборка мебели', keywords: ['жиһаз құраст', 'сборка мебел', 'сборк'], popular: true },
      { id: 'furniture_repair', kz: 'Жиһаз жөндеу', ru: 'Ремонт мебели', keywords: ['ремонт мебел', 'жиһаз жөнде'] },
      { id: 'upholstery', kz: 'Жұмсақ жиһазды қаптау', ru: 'Перетяжка мебели', keywords: ['перетяжк', 'қаптау'] },
      { id: 'custom_furniture', kz: 'Тапсырыспен жиһаз жасау', ru: 'Мебель на заказ', keywords: ['на заказ', 'тапсырыспен'] },
      { id: 'kitchen_cabinets', kz: 'Асүй жиһазы', ru: 'Кухонные гарнитуры', keywords: ['гарнитур', 'кухонн'] },
      { id: 'wardrobe', kz: 'Шкаф-купе', ru: 'Шкафы-купе', keywords: ['шкаф', 'купе'] },
      { id: 'carpentry', kz: 'Ағаш шебері', ru: 'Столяр и плотник', keywords: ['столяр', 'плотник', 'ағаш'] },
    ],
  },
  {
    id: 'cleaning_moving',
    kz: 'Тазалау',
    ru: 'Уборка и клининг',
    icon: 'Sparkles',
    color: 'emerald',
    services: [
      { id: 'home_cleaning', kz: 'Үй тазалау', ru: 'Уборка квартиры', keywords: ['тазала', 'уборк', 'клининг'], popular: true },
      { id: 'deep_cleaning', kz: 'Жалпы тазалау', ru: 'Генеральная уборка', keywords: ['генеральн'] },
      { id: 'post_renovation_cleaning', kz: 'Жөндеуден кейін тазалау', ru: 'Уборка после ремонта', keywords: ['после ремонт', 'жөндеуден кейін'] },
      { id: 'office_cleaning', kz: 'Кеңсе тазалау', ru: 'Уборка офиса', keywords: ['офис', 'кеңсе'] },
      { id: 'carpet_cleaning', kz: 'Кілем жуу', ru: 'Стирка ковров', keywords: ['кілем', 'ковр', 'ковер'] },
      { id: 'sofa_cleaning', kz: 'Диван химчисткасы', ru: 'Химчистка мебели', keywords: ['химчистк', 'диван'] },
      { id: 'window_cleaning', kz: 'Терезе жуу', ru: 'Мойка окон', keywords: ['мойка окон', 'терезе жуу'] },
      { id: 'pest_control', kz: 'Дезинсекция', ru: 'Дезинсекция и дезинфекция', keywords: ['таракан', 'клоп', 'дезинс', 'дезинф', 'тышқан', 'мыш'] },
    ],
  },
  {
    id: 'moving',
    kz: 'Көшу және жүк тасымалы',
    ru: 'Переезд и грузоперевозки',
    icon: 'Truck',
    color: 'blue',
    services: [
      { id: 'apartment_moving', kz: 'Пәтер көшіру', ru: 'Квартирный переезд', keywords: ['көшу', 'көшір', 'переезд'], popular: true },
      { id: 'office_moving', kz: 'Кеңсе көшіру', ru: 'Офисный переезд', keywords: ['офисный переезд'] },
      { id: 'cargo', kz: 'Жүк тасымалы (Газель)', ru: 'Грузоперевозки (Газель)', keywords: ['газель', 'жүк', 'груз', 'перевоз'] },
      { id: 'movers', kz: 'Жүк тиеушілер', ru: 'Грузчики', keywords: ['грузчик', 'тиеуші'] },
      { id: 'courier', kz: 'Курьер', ru: 'Курьер и доставка', keywords: ['курьер', 'доставк', 'жеткіз'] },
      { id: 'garbage_removal', kz: 'Қоқыс шығару', ru: 'Вывоз мусора', keywords: ['мусор', 'қоқыс'] },
      { id: 'piano_moving', kz: 'Пианино тасымалы', ru: 'Перевозка пианино', keywords: ['пианино'] },
    ],
  },
  {
    id: 'household',
    kz: 'Үй шебері',
    ru: 'Мастер на час',
    icon: 'Hammer',
    color: 'lime',
    services: [
      { id: 'handyman', kz: 'Сағаттық шебер', ru: 'Мастер на час', keywords: ['мастер на час', 'муж на час', 'сағаттық'], popular: true },
      { id: 'locksmith', kz: 'Құлып ашу және ауыстыру', ru: 'Вскрытие и замена замков', keywords: ['құлып', 'замок', 'замк', 'вскрыт'] },
      { id: 'hanging', kz: 'Сөре, карниз, сурет ілу', ru: 'Повесить полку, карниз, картину', keywords: ['карниз', 'полк', 'сөре', 'повесить'] },
      { id: 'tailoring', kz: 'Тігін және киім жөндеу', ru: 'Пошив и ремонт одежды', keywords: ['тігін', 'ателье', 'пошив', 'швея'] },
      { id: 'shoe_repair', kz: 'Аяқ киім жөндеу', ru: 'Ремонт обуви', keywords: ['обув', 'аяқ киім'] },
      { id: 'key_copy', kz: 'Кілт жасау', ru: 'Изготовление ключей', keywords: ['ключ', 'кілт'] },
      { id: 'blinds', kz: 'Жалюзи және перде орнату', ru: 'Жалюзи и шторы', keywords: ['жалюзи', 'штор', 'перде'] },
    ],
  },
  {
    id: 'auto',
    kz: 'Автоқызметтер',
    ru: 'Автоуслуги',
    icon: 'Car',
    color: 'slate',
    services: [
      { id: 'car_repair', kz: 'Көлік жөндеу', ru: 'Ремонт авто', keywords: ['көлік', 'машин', 'авто', 'сто'], popular: true },
      { id: 'tow_truck', kz: 'Эвакуатор', ru: 'Эвакуатор', keywords: ['эвакуатор'] },
      { id: 'tire_service', kz: 'Шиномонтаж', ru: 'Шиномонтаж', keywords: ['шина', 'шиномонтаж', 'дөңгелек', 'колес'] },
      { id: 'car_wash', kz: 'Көлік жуу', ru: 'Автомойка', keywords: ['автомойк', 'көлік жуу'] },
      { id: 'battery_jump', kz: 'Аккумулятор оталдыру', ru: 'Прикурить авто', keywords: ['аккумулятор', 'прикур'] },
      { id: 'auto_electric', kz: 'Автоэлектрик', ru: 'Автоэлектрик', keywords: ['автоэлектрик'] },
      { id: 'car_diagnostics', kz: 'Компьютерлік диагностика', ru: 'Диагностика авто', keywords: ['диагност'] },
      { id: 'body_repair', kz: 'Кузов жөндеу және бояу', ru: 'Кузовной ремонт и покраска', keywords: ['кузов', 'вмятин'] },
      { id: 'driver', kz: 'Жүргізуші', ru: 'Трезвый водитель', keywords: ['водител', 'жүргізуші'] },
    ],
  },
  {
    id: 'beauty',
    kz: 'Сұлулық және денсаулық',
    ru: 'Красота и здоровье',
    icon: 'Scissors',
    color: 'pink',
    services: [
      { id: 'hairdresser', kz: 'Шаштараз (үйге)', ru: 'Парикмахер на дом', keywords: ['шаштараз', 'парикмахер', 'стрижк', 'шаш'], popular: true },
      { id: 'manicure', kz: 'Маникюр және педикюр', ru: 'Маникюр и педикюр', keywords: ['маникюр', 'педикюр', 'тырнақ', 'ногт'] },
      { id: 'makeup', kz: 'Визажист', ru: 'Визажист', keywords: ['макияж', 'визаж', 'бояну'] },
      { id: 'lashes_brows', kz: 'Кірпік және қас', ru: 'Ресницы и брови', keywords: ['кірпік', 'ресниц', 'қас', 'бров'] },
      { id: 'massage', kz: 'Массаж', ru: 'Массаж', keywords: ['массаж', 'уқалау'] },
      { id: 'cosmetology', kz: 'Косметолог', ru: 'Косметолог', keywords: ['косметолог'] },
      { id: 'nurse', kz: 'Үйге медбике шақыру', ru: 'Медсестра на дом', keywords: ['медсестр', 'медбике', 'укол', 'капельниц'] },
      { id: 'fitness_trainer', kz: 'Жеке жаттықтырушы', ru: 'Персональный тренер', keywords: ['тренер', 'жаттықтырушы', 'фитнес'] },
    ],
  },
  {
    id: 'tutoring',
    kz: 'Репетиторлар және оқыту',
    ru: 'Репетиторы и обучение',
    icon: 'GraduationCap',
    color: 'violet',
    services: [
      { id: 'math', kz: 'Математика', ru: 'Математика', keywords: ['математик', 'алгебр', 'геометр'], popular: true },
      { id: 'english', kz: 'Ағылшын тілі', ru: 'Английский язык', keywords: ['ағылшын', 'английск'] },
      { id: 'russian_lang', kz: 'Орыс тілі', ru: 'Русский язык', keywords: ['орыс тіл', 'русск'] },
      { id: 'kazakh_lang', kz: 'Қазақ тілі', ru: 'Казахский язык', keywords: ['қазақ тіл', 'казахск'] },
      { id: 'ent_prep', kz: 'ҰБТ-ға дайындық', ru: 'Подготовка к ЕНТ', keywords: ['ұбт', 'ент'] },
      { id: 'school_prep', kz: 'Мектепке дайындық', ru: 'Подготовка к школе', keywords: ['мектепке дайын', 'подготовка к школ'] },
      { id: 'physics_chemistry', kz: 'Физика және химия', ru: 'Физика и химия', keywords: ['физик', 'хими'] },
      { id: 'music_lessons', kz: 'Музыка сабақтары', ru: 'Уроки музыки', keywords: ['музык', 'гитар', 'фортепиан', 'домбыр'] },
      { id: 'driving', kz: 'Көлік жүргізуге үйрету', ru: 'Автоинструктор', keywords: ['автоинструктор', 'вождени'] },
      { id: 'programming', kz: 'Бағдарламалау', ru: 'Программирование', keywords: ['программир', 'бағдарлама'] },
    ],
  },
  {
    id: 'events',
    kz: 'Мерекелер және іс-шаралар',
    ru: 'Праздники и мероприятия',
    icon: 'PartyPopper',
    color: 'fuchsia',
    services: [
      { id: 'photographer', kz: 'Фотограф', ru: 'Фотограф', keywords: ['фотограф', 'фотосессия'], popular: true },
      { id: 'videographer', kz: 'Видеограф', ru: 'Видеооператор', keywords: ['видеограф', 'видеооператор', 'видеосъём'] },
      { id: 'toy_host', kz: 'Той асабасы', ru: 'Ведущий (тамада)', keywords: ['асаба', 'тамада', 'ведущ'] },
      { id: 'toy_organization', kz: 'Той ұйымдастыру', ru: 'Организация тоя и свадьбы', keywords: ['той', 'свадьб', 'үйлену'] },
      { id: 'catering', kz: 'Кейтеринг және торт', ru: 'Кейтеринг и торты', keywords: ['кейтеринг', 'торт'] },
      { id: 'musicians', kz: 'Әншілер және DJ', ru: 'Музыканты и DJ', keywords: ['dj', 'диджей', 'әнші', 'музыкант'] },
      { id: 'animator', kz: 'Аниматор', ru: 'Аниматоры для детей', keywords: ['аниматор'] },
      { id: 'decor', kz: 'Безендіру және шарлар', ru: 'Оформление и шары', keywords: ['шар', 'безенд', 'оформлен'] },
    ],
  },
  {
    id: 'it_digital',
    kz: 'Компьютер және IT',
    ru: 'Компьютеры и IT',
    icon: 'Laptop',
    color: 'teal',
    services: [
      { id: 'computer_repair', kz: 'Компьютер жөндеу', ru: 'Ремонт компьютеров и ноутбуков', keywords: ['компьютер', 'ноутбук'], popular: true },
      { id: 'windows_install', kz: 'Windows орнату', ru: 'Установка Windows и программ', keywords: ['windows', 'виндовс', 'программ'] },
      { id: 'wifi_setup', kz: 'Wi-Fi баптау', ru: 'Настройка Wi-Fi и роутера', keywords: ['wi-fi', 'wifi', 'роутер'] },
      { id: 'website', kz: 'Сайт жасау', ru: 'Создание сайтов', keywords: ['сайт'] },
      { id: 'graphic_design', kz: 'Графикалық дизайн', ru: 'Графический дизайн и логотипы', keywords: ['дизайн', 'логотип'] },
      { id: 'smm', kz: 'SMM және жарнама', ru: 'SMM и реклама', keywords: ['smm', 'таргет', 'реклам', 'инстаграм'] },
      { id: 'printer_repair', kz: 'Принтер жөндеу', ru: 'Ремонт принтеров', keywords: ['принтер'] },
    ],
  },
  {
    id: 'care',
    kz: 'Бала, қарт және жануар күтімі',
    ru: 'Няни, сиделки, животные',
    icon: 'HeartHandshake',
    color: 'rose',
    services: [
      { id: 'nanny', kz: 'Бала күтуші', ru: 'Няня', keywords: ['бала күт', 'няня', 'няни'], popular: true },
      { id: 'elderly_care', kz: 'Қарт адам күтушісі', ru: 'Сиделка', keywords: ['сиделк', 'қарт'] },
      { id: 'housekeeper', kz: 'Үй көмекшісі', ru: 'Домработница', keywords: ['домработниц', 'үй көмекші'] },
      { id: 'pet_sitting', kz: 'Жануарға қарау', ru: 'Передержка животных', keywords: ['передержк', 'жануар', 'собак', 'кошк'] },
      { id: 'dog_walking', kz: 'Итті серуендету', ru: 'Выгул собак', keywords: ['выгул', 'серуенде'] },
      { id: 'grooming', kz: 'Груминг', ru: 'Груминг', keywords: ['груминг', 'стрижка собак'] },
      { id: 'cook', kz: 'Аспазшы (үйге)', ru: 'Повар на дом', keywords: ['повар', 'аспазшы'] },
    ],
  },
  {
    id: 'garden',
    kz: 'Бақ және аула',
    ru: 'Сад и двор',
    icon: 'Trees',
    color: 'green',
    services: [
      { id: 'gardening', kz: 'Бақ күтімі', ru: 'Уход за садом', keywords: ['бақ', 'сад', 'газон'], popular: true },
      { id: 'tree_cutting', kz: 'Ағаш кесу', ru: 'Спил деревьев', keywords: ['спил', 'ағаш кесу'] },
      { id: 'snow_removal', kz: 'Қар тазалау', ru: 'Уборка снега', keywords: ['қар', 'снег'] },
      { id: 'landscaping', kz: 'Ландшафт дизайны', ru: 'Ландшафтный дизайн', keywords: ['ландшафт'] },
      { id: 'well_drilling', kz: 'Құдық қазу', ru: 'Бурение скважин', keywords: ['скважин', 'құдық', 'колодец'] },
      { id: 'septic', kz: 'Септик және ассенизатор', ru: 'Септики и ассенизатор', keywords: ['септик', 'ассениз', 'выгребн'] },
      { id: 'pool', kz: 'Бассейн күтімі', ru: 'Обслуживание бассейнов', keywords: ['бассейн'] },
    ],
  },
  {
    id: 'business',
    kz: 'Заң және бухгалтерия',
    ru: 'Юристы и бухгалтеры',
    icon: 'Scale',
    color: 'zinc',
    services: [
      { id: 'lawyer', kz: 'Заңгер кеңесі', ru: 'Консультация юриста', keywords: ['заңгер', 'юрист', 'адвокат'], popular: true },
      { id: 'accountant', kz: 'Бухгалтер', ru: 'Бухгалтерские услуги', keywords: ['бухгалтер', 'декларац', 'налог', 'салық'] },
      { id: 'ip_registration', kz: 'ЖК / ЖШС тіркеу', ru: 'Регистрация ИП и ТОО', keywords: ['регистрац', 'ип ', 'тоо', 'жк ', 'жшс'] },
      { id: 'translation', kz: 'Аударма', ru: 'Переводы', keywords: ['аударма', 'перевод'] },
      { id: 'realtor', kz: 'Риелтор', ru: 'Риелтор', keywords: ['риелтор', 'риэлтор', 'жылжымайтын'] },
    ],
  },
];

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
