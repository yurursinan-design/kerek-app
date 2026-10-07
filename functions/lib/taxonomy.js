"use strict";
/**
 * Canonical taxonomy definitions for KEREK backend.
 * Aligns 1:1 with frontend canonical sources (src/services/taxonomy.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_CITY_IDS = exports.CANONICAL_CATEGORY_IDS = exports.CANONICAL_CITIES = exports.CANONICAL_CATEGORIES = void 0;
exports.validateAndNormalizeCategoryId = validateAndNormalizeCategoryId;
exports.validateAndNormalizeCityId = validateAndNormalizeCityId;
exports.CANONICAL_CATEGORIES = [
    {
        id: 'appliance_repair',
        nameRu: 'Ремонт бытовой техники',
        nameKz: 'Тұрмыстық техника жөндеу',
        description: 'Стиральные машины, холодильники, бойлеры, пылесосы, духовки, кондиционеры',
    },
    {
        id: 'home_services',
        nameRu: 'Бытовые услуги (Сантехник, Электрик)',
        nameKz: 'Тұрмыстық қызметтер (Сантехник, Электрик)',
        description: 'Сантехника, краны, трубы, электрика, розетки, проводка, мелкий домашний ремонт',
    },
    {
        id: 'cargo_moving',
        nameRu: 'Грузоперевозки и переезд',
        nameKz: 'Жүк тасымалдау және көшу',
        description: 'Газель, грузчики, перевозка мебели, квартирный/офисный переезд',
    },
    {
        id: 'electronics',
        nameRu: 'Электроника и гаджеты',
        nameKz: 'Электроника және гаджеттер',
        description: 'Ремонт телефонов, ноутбуков, компьютеров, планшетов, покупка техники',
    },
    {
        id: 'cleaning',
        nameRu: 'Клининг и уборка',
        nameKz: 'Тазалық қызметі (Клининг)',
        description: 'Уборка квартир, мытье окон, химчистка мебели, стирка ковров',
    },
    {
        id: 'auto',
        nameRu: 'Автоуслуги и эвакуатор',
        nameKz: 'Автокөмек және эвакуатор',
        description: 'СТО, эвакуатор, шиномонтаж, автоэлектрик, прикурить авто, буксировка',
    },
    {
        id: 'other',
        nameRu: 'Другие услуги',
        nameKz: 'Басқа қызметтер',
        description: 'Прочие бытовые, репетиторские, строительные и иные услуги',
    },
];
exports.CANONICAL_CITIES = [
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
];
exports.CANONICAL_CATEGORY_IDS = new Set(exports.CANONICAL_CATEGORIES.map((c) => c.id));
exports.CANONICAL_CITY_IDS = new Set(exports.CANONICAL_CITIES.map((c) => c.id));
/**
 * Validates and normalizes category ID received from Gemini.
 * Returns valid canonical categoryId or null if invalid/unrecognized.
 */
function validateAndNormalizeCategoryId(rawCategory) {
    if (typeof rawCategory !== 'string' || !rawCategory.trim()) {
        return null;
    }
    const clean = rawCategory.trim().toLowerCase();
    // 1. Direct ID match
    if (exports.CANONICAL_CATEGORY_IDS.has(clean)) {
        return clean;
    }
    // 2. Backward compatibility & common aliases
    if (clean === 'appliances_repair' || clean === 'appliance' || clean === 'бытовая техника' || clean === 'тұрмыстық техника') {
        return 'appliance_repair';
    }
    if (clean === 'home_service' || clean === 'plumber' || clean === 'electrician' || clean === 'сантехник' || clean === 'электрик') {
        return 'home_services';
    }
    if (clean === 'cargo' || clean === 'moving' || clean === 'грузоперевозки' || clean === 'жүк тасымалдау') {
        return 'cargo_moving';
    }
    if (clean === 'electronic' || clean === 'gadgets' || clean === 'электроника') {
        return 'electronics';
    }
    if (clean === 'clean' || clean === 'клининг' || clean === 'уборка') {
        return 'cleaning';
    }
    if (clean === 'car' || clean === 'авто' || clean === 'эвакуатор') {
        return 'auto';
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
function validateAndNormalizeCityId(rawCity) {
    if (typeof rawCity !== 'string' || !rawCity.trim()) {
        return null;
    }
    const clean = rawCity.trim().toLowerCase();
    // 1. Direct ID match
    if (exports.CANONICAL_CITY_IDS.has(clean)) {
        return clean;
    }
    // 2. City name aliases in Russian / Kazakh / Cyrillic
    const cityMap = {
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
//# sourceMappingURL=taxonomy.js.map