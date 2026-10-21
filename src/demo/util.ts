import type { Business } from '../../functions/src/demo/types';

/** Times are shown in Kyzylorda time (UTC+5), like the assistant uses */
const OFFSET = 5 * 3600 * 1000;

export function clock(ms: number): string {
  const d = new Date(ms + OFFSET);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function localDate(ms: number, addDays = 0): string {
  return new Date(ms + OFFSET + addDays * 86400000).toISOString().slice(0, 10);
}

export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function money(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU').replace(/[  ,]/g, ' ')} ₸`;
}

/** WhatsApp text formatting: *bold* and line breaks, safely (no HTML from the text) */
export function waParts(text: string): { bold: boolean; text: string }[] {
  const out: { bold: boolean; text: string }[] = [];
  const re = /\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ bold: false, text: text.slice(last, m.index) });
    out.push({ bold: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ bold: false, text: text.slice(last) });
  return out;
}

/** The sales contact (ИП TAPSYR's WhatsApp) */
export const CONTACT_NUMBER = '77479693852';

export function waLink(text: string): string {
  return `https://wa.me/${CONTACT_NUMBER}?text=${encodeURIComponent(text)}`;
}

export function initials(name: string): string {
  const words = name.replace(/[«»"]/g, '').trim().split(/\s+/);
  return (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
}

export const PHOTOS: Record<string, string> = {
  salon: '/img/photo/s_manicure.webp',
  auto: '/img/photo/s_car_repair.webp',
  cake: '/img/photo/g_events.webp',
  custom: '/img/photo/g_business.webp',
};

export function businessType(b: Business, lang: 'ru' | 'kz'): string {
  return lang === 'kz' ? b.type_kz : b.type_ru;
}
