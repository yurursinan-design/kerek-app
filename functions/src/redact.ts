/**
 * Personal details taken out of a text before it goes to Gemini (request parsing and the review
 * check): links, e-mail addresses, IINs, phone numbers, and street, house and flat numbers. Each one
 * becomes a placeholder, so the model still sees that something was there. The privacy policy
 * (src/data/legalTexts.ts, section 4) promises this.
 */

const NOT_LETTER_BEFORE = '(?<![\\p{L}\\d])';
const NOT_LETTER_AFTER = '(?![\\p{L}])';

const LINK = /(?:https?:\/\/|www\.)\S+|(?:t\.me|wa\.me|instagram\.com|vk\.com)\/\S*/giu;
const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.\p{L}{2,}/giu;
/** Twelve digits (an IIN or BIN), allowing one space or dash in the middle */
const IIN = new RegExp(`${NOT_LETTER_BEFORE}\\d{6}[\\s-]?\\d{6}(?!\\d)`, 'gu');
/**
 * Mobile and city numbers with spaces, brackets or dashes: 10 or 11 digits ("+7 701 123 45 67",
 * "8(7242)23-45-67"), or a local "23-45-67". Prices such as "1 500 000" (7 digits) stay.
 */
const PHONE = new RegExp(`${NOT_LETTER_BEFORE}(?:\\+?\\d(?:[\\s\\-()]*\\d){9,10}|\\d{2,3}-\\d{2}-\\d{2})(?!\\d)`, 'gu');
/**
 * An address word (Russian or Kazakh) followed by up to three words and a number: "ул. Абая 12",
 * "мкр Шугыла 5", "дом 7", "кв. 34", "көшесі 12". Square metres ("50 кв.м") are not an address.
 */
const ADDRESS_WORDS = [
  'шағын\\s+аудан',
  'ықшамаудан',
  'микрорайон',
  'квартира',
  'проспект',
  'даңғылы',
  'подъезд',
  'көшесі',
  'улица',
  'пәтер',
  'көше',
  'пр-т',
  'мкр',
  'дом',
  'кв(?!\\.?\\s*м(?![\\p{L}]))',
  'ул',
  'пр',
  'үй',
  'д',
];
const ADDRESS = new RegExp(
  `${NOT_LETTER_BEFORE}(?:${ADDRESS_WORDS.join('|')})${NOT_LETTER_AFTER}\\.?\\s*(?:[\\p{L}-]+\\s+){0,3}?№?\\s*\\d+\\p{L}?(?:\\s*[/-]\\s*\\d+)?`,
  'giu'
);
/** Kazakh puts the number first: "12 үй", "5-пәтер" */
const ADDRESS_NUMBER_FIRST = new RegExp(`${NOT_LETTER_BEFORE}\\d+\\p{L}?\\s*-?\\s*(?:үй|пәтер|подъезд)${NOT_LETTER_AFTER}`, 'giu');

export function redactPersonalDetails(text: string): string {
  return String(text || '')
    .replace(LINK, '[link]')
    .replace(EMAIL, '[email]')
    .replace(IIN, '[iin]')
    .replace(PHONE, '[phone]')
    .replace(ADDRESS, '[address]')
    .replace(ADDRESS_NUMBER_FIRST, '[address]');
}
