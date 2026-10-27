/**
 * The website's pre-registration form for masters (scripts/landingPage.ts) and its check on the
 * server (masterSignup.ts). No imports, so the website build can use the same list and rules.
 */

/** Kinds of work a master can pick; the ids are stored, the labels are shown */
export const SIGNUP_CATEGORIES: { id: string; kz: string; ru: string }[] = [
  { id: 'plumbing', kz: 'Сантехник', ru: 'Сантехник' },
  { id: 'electrician', kz: 'Электрик', ru: 'Электрик' },
  { id: 'appliances', kz: 'Техника жөндеу', ru: 'Ремонт техники' },
  { id: 'cleaning', kz: 'Тазалау', ru: 'Уборка' },
  { id: 'beauty', kz: 'Сұлулық', ru: 'Красота' },
  { id: 'household', kz: 'Үй шебері', ru: 'Мастер на час' },
  { id: 'tutoring', kz: 'Репетитор', ru: 'Репетитор' },
  { id: 'auto', kz: 'Автоқызметтер', ru: 'Автоуслуги' },
  { id: 'construction', kz: 'Құрылыс және жөндеу', ru: 'Строительство и ремонт' },
  { id: 'moving', kz: 'Жүк тасымалы', ru: 'Грузоперевозки' },
  { id: 'care', kz: 'Бала және қарт күтімі', ru: 'Няни и сиделки' },
  { id: 'events', kz: 'Той және мерекелер', ru: 'Праздники' },
  { id: 'other', kz: 'Басқа', ru: 'Другое' },
];

export interface MasterSignup {
  name: string;
  /** +77XXXXXXXXX */
  phone: string;
  category: string;
  district: string;
  /** Google account for the Play test, lower case; '' when not given */
  email: string;
  lang: 'kz' | 'ru';
  consentVersion: string;
}

const clean = (v: unknown, max: number) =>
  String(typeof v === 'string' ? v : '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** A Kazakhstan mobile number (+7 7xx …, 8 7xx … or 7xx …) as +77XXXXXXXXX, or ''. */
export function kzMobile(raw: unknown): string {
  let d = String(typeof raw === 'string' ? raw : '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('7')) d = '7' + d;
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  // Mobile codes are 70x and 74x–77x; 71x and 72x are city lines
  return /^77[04-7]\d{8}$/.test(d) ? `+${d}` : '';
}

/** The form's fields checked and cleaned, or the name of the first field that is wrong. */
export function checkMasterSignup(body: unknown): { ok: true; value: MasterSignup } | { ok: false; field: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = clean(b.name, 60);
  if (name.length < 2) return { ok: false, field: 'name' };
  const phone = kzMobile(b.phone);
  if (!phone) return { ok: false, field: 'phone' };
  const category = String(b.category || '');
  if (!SIGNUP_CATEGORIES.some((c) => c.id === category)) return { ok: false, field: 'category' };
  const district = clean(b.district, 60);
  const email = clean(b.email, 100).toLowerCase();
  if (email && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return { ok: false, field: 'email' };
  const lang = b.lang === 'ru' ? 'ru' : 'kz';
  if (b.consent !== true) return { ok: false, field: 'consent' };
  const consentVersion = String(b.consentVersion || '');
  if (!/^\d{4}-\d{2}-\d{2}(\.\d{1,3})?$/.test(consentVersion)) return { ok: false, field: 'consent' };
  return { ok: true, value: { name, phone, category, district, email, lang, consentVersion } };
}
