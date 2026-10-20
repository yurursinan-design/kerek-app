import type { Business } from './types';

/**
 * Ready-made demo businesses. Names and addresses are invented; the page marks them as demos.
 * Prices are typical for Kyzylorda in 2026.
 */

const salon: Business = {
  template: 'salon',
  name: 'Nur Beauty',
  kind: 'booking',
  type_ru: 'Салон красоты',
  type_kz: 'Сұлулық салоны',
  address: 'Кызылорда, ул. Айтеке би, 27',
  hours: [['09:00', '20:00'], ['09:00', '20:00'], ['09:00', '20:00'], ['09:00', '20:00'], ['09:00', '20:00'], ['09:00', '20:00'], ['10:00', '18:00']],
  staff: [
    { id: 'aigerim', name: 'Айгерим', role_ru: 'парикмахер', role_kz: 'шаштараз' },
    { id: 'dinara', name: 'Динара', role_ru: 'парикмахер-колорист', role_kz: 'шаштараз-колорист' },
    { id: 'zhanna', name: 'Жанна', role_ru: 'мастер маникюра', role_kz: 'маникюр шебері' },
    { id: 'kamila', name: 'Камила', role_ru: 'брови и ресницы', role_kz: 'қас пен кірпік шебері' },
  ],
  services: [
    { id: 'haircut_w', ru: 'Женская стрижка', kz: 'Әйелдер шаш қиюы', price: 4000, minutes: 60, staff: ['aigerim', 'dinara'] },
    { id: 'haircut_m', ru: 'Мужская стрижка', kz: 'Ерлер шаш қиюы', price: 2500, minutes: 30, staff: ['aigerim'] },
    { id: 'haircut_kid', ru: 'Детская стрижка (до 10 лет)', kz: 'Балалар шаш қиюы (10 жасқа дейін)', price: 2000, minutes: 30, staff: ['aigerim', 'dinara'] },
    { id: 'styling', ru: 'Укладка', kz: 'Шаш сәндеу', price: 3500, minutes: 45, staff: ['aigerim', 'dinara'] },
    {
      id: 'coloring',
      ru: 'Окрашивание в один тон',
      kz: 'Шашты бір түске бояу',
      price: 12000,
      priceFrom: true,
      minutes: 150,
      staff: ['dinara'],
      note: 'Цена зависит от длины и густоты волос; точную цену мастер назовёт на месте.',
    },
    { id: 'manicure', ru: 'Маникюр с гель-лаком', kz: 'Гель-лакпен маникюр', price: 5000, minutes: 90, staff: ['zhanna'] },
    { id: 'manicure_plain', ru: 'Маникюр без покрытия', kz: 'Жабынсыз маникюр', price: 3000, minutes: 45, staff: ['zhanna'] },
    { id: 'pedicure', ru: 'Педикюр с гель-лаком', kz: 'Гель-лакпен педикюр', price: 7000, minutes: 90, staff: ['zhanna'] },
    { id: 'lashes', ru: 'Наращивание ресниц (классика)', kz: 'Кірпік ұзарту (классика)', price: 8000, minutes: 120, staff: ['kamila'] },
    { id: 'brows', ru: 'Коррекция и окрашивание бровей', kz: 'Қасты түзету және бояу', price: 3500, minutes: 45, staff: ['kamila'] },
  ],
  products: [],
  facts: [
    'Оплата: Kaspi QR, перевод на Kaspi или наличные.',
    'Бесплатная парковка у входа.',
    'Гель-лак держится 3–4 недели. Снятие старого покрытия входит в цену.',
    'Если клиент опаздывает больше чем на 15 минут, запись может сдвинуться.',
    'Есть подарочные сертификаты от 5 000 ₸.',
  ],
  delivery: null,
};

const auto: Business = {
  template: 'auto',
  name: 'Тұлпар Авто',
  kind: 'booking',
  type_ru: 'Автосервис и шиномонтаж',
  type_kz: 'Автосервис және шиномонтаж',
  address: 'Кызылорда, ул. Бокейхана, 105',
  hours: [['09:00', '19:00'], ['09:00', '19:00'], ['09:00', '19:00'], ['09:00', '19:00'], ['09:00', '19:00'], ['09:00', '19:00'], null],
  staff: [
    { id: 'erlan', name: 'Ерлан', role_ru: 'мастер, пост 1', role_kz: 'шебер, 1-бокс' },
    { id: 'asylbek', name: 'Асылбек', role_ru: 'мастер, пост 2', role_kz: 'шебер, 2-бокс' },
  ],
  services: [
    { id: 'tires_15', ru: 'Переобувка R13–R15, 4 колеса с балансировкой', kz: 'Дөңгелек ауыстыру R13–R15, 4 дөңгелек теңгеруімен', price: 7000, minutes: 45, staff: ['erlan', 'asylbek'] },
    { id: 'tires_18', ru: 'Переобувка R16–R18, 4 колеса с балансировкой', kz: 'Дөңгелек ауыстыру R16–R18, 4 дөңгелек теңгеруімен', price: 9000, minutes: 60, staff: ['erlan', 'asylbek'] },
    { id: 'tires_19', ru: 'Переобувка R19 и больше, 4 колеса', kz: 'Дөңгелек ауыстыру R19 және одан үлкен, 4 дөңгелек', price: 12000, minutes: 60, staff: ['erlan', 'asylbek'] },
    {
      id: 'oil',
      ru: 'Замена масла в двигателе (работа)',
      kz: 'Қозғалтқыш майын ауыстыру (жұмыс)',
      price: 3000,
      minutes: 30,
      staff: ['erlan', 'asylbek'],
      note: 'Масло клиента или наше (Shell, Mobil, Total); цену масла называет мастер.',
    },
    { id: 'diag', ru: 'Компьютерная диагностика', kz: 'Компьютерлік диагностика', price: 5000, minutes: 30, staff: ['erlan', 'asylbek'] },
    { id: 'alignment', ru: 'Развал-схождение', kz: 'Дөңгелек бұрыштарын реттеу (развал-схождение)', price: 7000, minutes: 60, staff: ['erlan'] },
    { id: 'pads', ru: 'Замена тормозных колодок, одна ось', kz: 'Тежегіш қалыптарын ауыстыру, бір ось', price: 5000, priceFrom: true, minutes: 60, staff: ['erlan', 'asylbek'] },
  ],
  products: [],
  facts: [
    'Хранение шин: 15 000 ₸ за сезон (4 колеса).',
    'Оплата: Kaspi QR или наличные.',
    'Есть зона ожидания с кофе и Wi-Fi.',
    'В сезон переобувки лучше записаться: без записи — живая очередь.',
    'Грузовые машины и автобусы не обслуживаем.',
  ],
  delivery: null,
};

const cake: Business = {
  template: 'cake',
  name: 'Tätti',
  kind: 'order',
  type_ru: 'Кондитерская, торты на заказ',
  type_kz: 'Кондитерлік, тапсырыспен торттар',
  address: 'Кызылорда, ул. Желтоксан, 18',
  hours: [['09:00', '21:00'], ['09:00', '21:00'], ['09:00', '21:00'], ['09:00', '21:00'], ['09:00', '21:00'], ['09:00', '21:00'], ['10:00', '20:00']],
  staff: [],
  services: [],
  products: [
    { id: 'medovik', ru: 'Торт «Медовик»', kz: '«Медовик» торты', price: 7500, unit: 'кг', available: true, leadDays: 1 },
    { id: 'napoleon', ru: 'Торт «Наполеон»', kz: '«Наполеон» торты', price: 7000, unit: 'кг', available: true, leadDays: 1 },
    { id: 'redvelvet', ru: 'Торт «Красный бархат»', kz: '«Қызыл барқыт» торты', price: 9000, unit: 'кг', available: false, leadDays: 1 },
    { id: 'cheesecake', ru: 'Чизкейк «Нью-Йорк»', kz: '«Нью-Йорк» чизкейкі', price: 9500, unit: 'кг', available: true, leadDays: 1 },
    { id: 'bento', ru: 'Бенто-торт с надписью, 500 г', kz: 'Жазуы бар бенто-торт, 500 г', price: 6000, unit: 'шт', available: false, leadDays: 1, note: 'Надпись и цвет — по желанию клиента.' },
    { id: 'cupcakes', ru: 'Капкейки, набор 6 шт', kz: 'Капкейктер, 6 дана', price: 4500, unit: 'набор', available: true, leadDays: 1 },
    { id: 'eclairs', ru: 'Эклеры, набор 6 шт', kz: 'Эклерлер, 6 дана', price: 3600, unit: 'набор', available: true, leadDays: 1 },
    {
      id: 'custom',
      ru: 'Торт на заказ с декором (от 2 кг)',
      kz: 'Декорлы тапсырыс торт (2 кг-нан бастап)',
      price: 9000,
      priceFrom: true,
      unit: 'кг',
      available: false,
      leadDays: 2,
      note: 'Дизайн обсуждает кондитер; клиент может прислать фото-пример.',
    },
  ],
  facts: [
    'Доставка по Кызылорде 1 000 ₸, бесплатно от 20 000 ₸. Самовывоз бесплатно.',
    'Торты на заказ — предоплата 50% через Kaspi, остальное при получении.',
    'Надпись на торте бесплатно.',
    'Торты без сахара и без глютена не делаем.',
    'Торты весовые: от 1 кг, шаг 0,5 кг.',
  ],
  delivery: { price: 1000, freeFrom: 20000 },
};

export const TEMPLATES: Record<string, Business> = { salon, auto, cake };

export function cloneTemplate(id: string): Business | null {
  const t = TEMPLATES[id];
  return t ? (JSON.parse(JSON.stringify(t)) as Business) : null;
}
