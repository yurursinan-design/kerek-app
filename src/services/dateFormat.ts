/**
 * Short dates in the app's language ("12 қаз., 10:07", "12 окт., 10:07").
 * Built by hand because some browsers ship without Kazakh locale data and fall back to English.
 */
const MONTHS: Record<string, string[]> = {
  kz: ['қаң.', 'ақп.', 'нау.', 'сәу.', 'мам.', 'мау.', 'шіл.', 'там.', 'қыр.', 'қаз.', 'қар.', 'жел.'],
  ru: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
};

export function formatShortDate(
  value: string | number | Date,
  language: string,
  opts: { time?: boolean; year?: boolean } = {}
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const months = MONTHS[language] || MONTHS.ru;
  let text = `${date.getDate()} ${months[date.getMonth()]}`;
  if (opts.year) text += ` ${date.getFullYear()}`;
  if (opts.time) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    text += `, ${hh}:${mm}`;
  }
  return text;
}

/** Kazakhstan's UTC offset (one zone for the whole country since March 2024): visit times are kept in it */
export const SERVICE_UTC_OFFSET = '+05:00';
const SERVICE_OFFSET_MS = 5 * 3600 * 1000;

/** Today's date in Kyzylorda ("2026-10-17"), whatever zone the phone is set to. */
export function serviceToday(now: number = Date.now()): string {
  return new Date(now + SERVICE_OFFSET_MS).toISOString().slice(0, 10);
}

/** A visit time as stored: Kyzylorda wall-clock time with its offset ("2026-10-18T10:00+05:00"). */
export function toScheduleValue(date: string, time: string): string {
  return `${date}T${time}${SERVICE_UTC_OFFSET}`;
}

/** The stored visit time for a moment (milliseconds), in Kyzylorda time: "2026-10-18T10:00+05:00". */
export function scheduleValueAt(ms: number): string {
  return `${new Date(ms + SERVICE_OFFSET_MS).toISOString().slice(0, 16)}${SERVICE_UTC_OFFSET}`;
}

/** Date and time of a stored visit time (also older "2026-10-18 10:00" entries), or null. */
export function scheduleParts(value: unknown): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(typeof value === 'string' ? value : '');
  return m ? { date: m[1], time: m[2] } : null;
}

/** A visit time for people: "18 қаз., 10:00", in Kyzylorda time on every phone; anything else as it is. */
export function formatSchedule(value: string | undefined, language: string): string {
  const parts = scheduleParts(value);
  if (!parts) return value || '';
  const [year, month, day] = parts.date.split('-').map(Number);
  const months = MONTHS[language] || MONTHS.ru;
  const yearText = String(year) === serviceToday().slice(0, 4) ? '' : ` ${year}`;
  return `${day} ${months[month - 1]}${yearText}, ${parts.time}`;
}

/** Whether a chosen date and time lie in the past (with the same 2 hours of slack as the security rules). */
export function isPastSchedule(date: string, time: string, now: number = Date.now()): boolean {
  const ms = Date.parse(toScheduleValue(date, time));
  return !Number.isFinite(ms) || ms < now - 2 * 3600 * 1000;
}

const TODAY_WORDS = /^(бүгін|сегодня|шұғыл|срочно)/i;
const TOMORROW_WORDS = /^(ертең|завтра)/i;

/**
 * "When" of a request for the provider. The customer picked a relative word ("Today",
 * "Tomorrow", "Urgent") when creating it, so it is counted from the creation day: a request made
 * last week for "today" shows that day's date instead of looking urgent forever.
 */
export function requestWhenLabel(dateText: string | undefined, createdAt: string | undefined, language: string): string {
  const text = (dateText || '').trim();
  const kz = language === 'kz';
  const created = createdAt ? new Date(createdAt) : null;
  const offset = TODAY_WORDS.test(text) ? 0 : TOMORROW_WORDS.test(text) ? 1 : null;
  if (offset === null || !created || Number.isNaN(created.getTime())) return text;
  const target = new Date(created.getFullYear(), created.getMonth(), created.getDate() + offset);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return /^(шұғыл|срочно)/i.test(text) ? text : kz ? 'Бүгін' : 'Сегодня';
  if (days === 1) return kz ? 'Ертең' : 'Завтра';
  return formatShortDate(target, language);
}
