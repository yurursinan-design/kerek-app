import { Provider } from '../types';

// Seeded realistic DEMO providers in Kyzylorda & Kazakhstan cities
export const INITIAL_DEMO_PROVIDERS: Provider[] = [
  // Kyzylorda - Washing machine & appliances
  {
    id: 'demo-p-kzo-1',
    name: '«Сыр Шебері» Кір жуғыш жөндеу (ДЕМО)',
    phone: '+7 724 220 11 22',
    whatsapp: '+77242201122',
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    district: 'Астана даңғылы',
    category: 'Тұрмыстық техника жөндеу',
    categoryId: 'appliances',
    services: 'Кір жуғыш машина жөндеу, мотор және барабан ауыстыру',
    priceRange: '12 000 – 18 000 ₸',
    workingHours: '09:00 - 20:00',
    description: 'Кызылордада 7 жылдан астам тәжірибесі бар мамандар. Түпнұсқа қосалқы бөлшектер.',
    verified: true,
    iinVerified: true,
    hasCertificate: true,
    tradeLicense: 'KZ-TECH-2024-88',
    isDemo: true,
  },
  {
    id: 'demo-p-kzo-2',
    name: '«Арай-Сервис Кызылорда» (ДЕМО)',
    phone: '+7 705 330 44 55',
    whatsapp: '+77053304455',
    city: 'Кызылорда',
    cityId: 'kyzylorda',
    district: 'мкр. Ақмешіт',
    category: 'Ремонт бытовой техники',
    categoryId: 'appliances',
    services: 'Ремонт стиральных машин, замена насосов, электроника',
    priceRange: '10 000 – 22 000 ₸',
    workingHours: '08:30 - 21:00',
    description: 'Выезд по всему городу Кызылорда и пригородам в день обращения.',
    verified: true,
    iinVerified: true,
    isDemo: true,
  },
  {
    id: 'demo-p-kzo-3',
    name: 'Шебер Азамат — жедел жөндеу (ДЕМО)',
    phone: '+7 707 900 88 77',
    whatsapp: '+77079008877',
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    district: 'мкр. Мерей',
    category: 'Тұрмыстық техника жөндеу',
    categoryId: 'appliances',
    services: 'Кір жуғыш машина мен тоңазытқыш жөндеу',
    priceRange: 'Келісімді',
    workingHours: '24/7 шұғыл шақыру',
    description: 'Жедел шақыру, сапалы қызмет және кепілдік беріледі.',
    verified: true,
    isDemo: true,
  },

  // Kyzylorda - Plumbing / Сантехник
  {
    id: 'demo-p-kzo-4',
    name: '«Қызылорда Су-Құбыр» сервисі (ДЕМО)',
    phone: '+7 775 888 12 34',
    whatsapp: '+77758881234',
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    district: 'Орталық',
    category: 'Тұрмыстық қызметтер',
    categoryId: 'home_services',
    services: 'Сантехник қызметі, құбыр ауыстыру, кран жөндеу',
    priceRange: '5 000 – 15 000 ₸',
    workingHours: '08:00 - 22:00',
    description: 'Тұрмыстық сантехниканы толық қалпына келтіру.',
    verified: true,
    isDemo: true,
  },
  {
    id: 'demo-p-kzo-5',
    name: 'Ерлан Сантехник (ДЕМО)',
    phone: '+7 701 444 77 66',
    whatsapp: '+77014447766',
    city: 'Кызылорда',
    cityId: 'kyzylorda',
    district: 'ул. Желтоксан',
    category: 'Бытовые услуги',
    categoryId: 'home_services',
    services: 'Услуги сантехника, устранение засоров',
    priceRange: 'от 5 000 ₸',
    workingHours: '09:00 - 21:00',
    description: 'Частный сантехник с выездом за 30-40 минут.',
    verified: true,
    isDemo: true,
  },

  // Kyzylorda - Cargo & Moving / Газель
  {
    id: 'demo-p-kzo-6',
    name: '«Сырдарья-Транс Газель» (ДЕМО)',
    phone: '+7 708 111 99 22',
    whatsapp: '+77081119922',
    city: 'Қызылорда',
    cityId: 'kyzylorda',
    district: 'Жібек жолы',
    category: 'Жүк тасымалдау',
    categoryId: 'cargo_moving',
    services: 'Көшуге арналған көлік, Газель 4.2м, жүкшілер',
    priceRange: '6 000 ₸/сағат',
    workingHours: '08:00 - 23:00',
    description: 'Қызылорда қаласы мен аудандарға қауіпсіз тасымалдау.',
    verified: true,
    isDemo: true,
  },

  // Almaty & Astana Demo Providers
  {
    id: 'demo-p-ala-1',
    name: '«Алматы МастерТех» (ДЕМО)',
    phone: '+7 777 001 02 03',
    whatsapp: '+77770010203',
    city: 'Алматы',
    cityId: 'almaty',
    district: 'Бостандық ауданы',
    category: 'Тұрмыстық техника жөндеу',
    categoryId: 'appliances',
    services: 'Кір жуғыш машина жөндеу, үйге бару',
    priceRange: '8 000 – 20 000 ₸',
    workingHours: '09:00 - 21:00',
    description: 'Алматы қаласы бойынша кәсіби шеберлер.',
    verified: true,
    isDemo: true,
  },
  {
    id: 'demo-p-ast-1',
    name: '«Астана ПроРемонт» (ДЕМО)',
    phone: '+7 701 999 88 77',
    whatsapp: '+77019998877',
    city: 'Астана',
    cityId: 'astana',
    district: 'Есіл ауданы',
    category: 'Ремонт бытовой техники',
    categoryId: 'appliances',
    services: 'Ремонт стиральных машин и бытовой техники',
    priceRange: '10 000 – 25 000 ₸',
    workingHours: '08:00 - 22:00',
    description: 'Быстрый выезд по левому и правому берегу Астаны.',
    verified: true,
    isDemo: true,
  },
];

/**
 * Completely purges all 'kerek_' entries from localStorage.
 */
export function clearAllKerekLocalStorage(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const removed: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('kerek_') || key.startsWith('kerek'))) {
        removed.push(key);
      }
    }
    removed.forEach((k) => localStorage.removeItem(k));
    console.log(`[KEREK] LocalStorage temizlendi (${removed.length} anahtar):`, removed);
  } catch (e) {
    console.warn('[KEREK] LocalStorage temizlenirken hata:', e);
  }
  return removed;
}

/** Settings that are not personal and survive logout: screen language and customer/provider mode. */
const KEEP_ON_LOGOUT = ['kerek_language_v1', 'kerek_app_mode_v1'];

const personalDataClearHooks: Array<() => void> = [];

/** Lets in-memory copies of the user's data (device store) be emptied together with the stored copy. */
export function onPersonalDataCleared(hook: () => void): void {
  personalDataClearHooks.push(hook);
}

/**
 * Removes this device's copy of the user's data (requests, offers, chats, contacts, location,
 * queued changes) on logout or account deletion, so the next person on the phone can't read it.
 */
export function clearPersonalLocalData(): void {
  personalDataClearHooks.forEach((hook) => {
    try {
      hook();
    } catch {}
  });
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('kerek') && !KEEP_ON_LOGOUT.includes(key)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage unavailable: nothing stored on this device
  }
  try {
    sessionStorage.clear();
  } catch {}
}

