/**
 * Short dates in the app's language ("12 қазан, 10:07", "12 окт., 10:07", "12 Eki, 10:07").
 * Built by hand because some browsers ship without Kazakh locale data and fall back to English.
 */
const MONTHS: Record<string, string[]> = {
  kz: ['қаң.', 'ақп.', 'нау.', 'сәу.', 'мам.', 'мау.', 'шіл.', 'там.', 'қыр.', 'қаз.', 'қар.', 'жел.'],
  ru: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
  tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
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
