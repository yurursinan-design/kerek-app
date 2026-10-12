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
