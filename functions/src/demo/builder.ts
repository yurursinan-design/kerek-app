import { generate, QUALITY_FIRST, type GeminiLike, type MediaInput } from './engine';
import type { Business, Product, Service, Staff } from './types';

/**
 * "Your own business in two minutes": Gemini reads the owner's price list (a photo or typed text)
 * and the demo assistant starts answering with those services and prices.
 */

export interface BuildInput {
  name: string;
  type: string;
  text?: string;
  photo?: MediaInput;
  staff?: string;
  address?: string;
}

export const BUSINESS_TYPES: Record<string, { ru: string; kind: 'booking' | 'order' | null }> = {
  salon: { ru: 'салон красоты или барбершоп', kind: 'booking' },
  auto: { ru: 'автосервис или шиномонтаж', kind: 'booking' },
  clinic: { ru: 'клиника, стоматология или массаж', kind: 'booking' },
  courses: { ru: 'курсы, спорт или студия', kind: 'booking' },
  food: { ru: 'кондитерская, кафе или доставка еды', kind: 'order' },
  shop: { ru: 'магазин или продавец в Instagram', kind: 'order' },
  other: { ru: 'другое', kind: null },
};

const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['booking', 'order'] },
    type_ru: { type: 'string' },
    type_kz: { type: 'string' },
    services: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ru: { type: 'string' },
          kz: { type: 'string' },
          price: { type: 'number' },
          price_from: { type: 'boolean' },
          minutes: { type: 'integer' },
        },
        required: ['ru', 'kz', 'price', 'minutes'],
      },
    },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ru: { type: 'string' },
          kz: { type: 'string' },
          price: { type: 'number' },
          price_from: { type: 'boolean' },
          unit: { type: 'string' },
          available: { type: 'boolean' },
          lead_days: { type: 'integer' },
        },
        required: ['ru', 'kz', 'price', 'unit'],
      },
    },
    facts: { type: 'array', items: { type: 'string' } },
    hours: { type: 'array', items: { type: 'string' }, description: '7 строк, пн…вс: "09:00-19:00" или "выходной"; пусто, если часов нет' },
  },
  required: ['kind', 'type_ru', 'type_kz'],
};

const DEFAULT_HOURS: Business['hours'] = ['09:00-19:00', '09:00-19:00', '09:00-19:00', '09:00-19:00', '09:00-19:00', '09:00-19:00', '10:00-17:00'];

const clean = (v: unknown, max: number) => String(typeof v === 'string' ? v : '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function parseHours(raw: unknown): Business['hours'] {
  if (!Array.isArray(raw) || raw.length !== 7) return DEFAULT_HOURS;
  const out = raw.map((h) => {
    const m = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/.exec(String(h));
    if (!m) return null;
    const open = `${m[1].padStart(2, '0')}:${m[2]}`;
    const close = `${m[3].padStart(2, '0')}:${m[4]}`;
    return close > open ? `${open}-${close}` : null;
  });
  return out.some(Boolean) ? out : DEFAULT_HOURS;
}

export async function buildBusiness(ai: GeminiLike, input: BuildInput): Promise<Business> {
  const name = clean(input.name, 40);
  const type = BUSINESS_TYPES[input.type] ?? BUSINESS_TYPES.other;
  const text = String(input.text ?? '').slice(0, 4000);
  const prompt = `Ты настраиваешь ИИ-ассистента WhatsApp для малого бизнеса в Кызылорде (Казахстан). Из прайс-листа ${input.photo ? 'на фото' : 'ниже'} извлеки данные.
Название: «${name}». Вид бизнеса со слов владельца: ${type.ru}.${type.kind ? ` Значит kind = "${type.kind}".` : ''}

Правила:
- kind: "booking", если клиенты записываются на время (салон, автосервис, клиника, курсы); "order", если покупают товары (торты, цветы, еда, магазин).
- booking → services: услуги с ценой в тенге (число). minutes — длительность; если не указана, оцени разумно (женская стрижка 60, мужская 30, маникюр 90, диагностика 30, массаж 60). price_from = true, если цена «от».
- order → products: товары с ценой; unit — "кг", "шт", "набор", "порция" и т.п.; available = true, если обычно есть в наличии сегодня; lead_days — сколько дней готовить под заказ (0–3).
- ru и kz — название на русском и на казахском; если в прайсе один язык, переведи на второй (казахский — естественный, разговорный).
- type_ru и type_kz — вид бизнеса, 2–4 слова.
- facts — до 5 коротких фактов из прайса (оплата, доставка, условия) по-русски. Ничего не придумывай.
- hours — часы работы, если они есть в прайсе; иначе пустой массив.
- Позиции без цены пропускай. Цены не выдумывай. Не больше 30 позиций.${text ? `\n\nПрайс-лист:\n"""\n${text.replace(/"""/g, '"')}\n"""` : ''}`;

  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [];
  if (input.photo) parts.push({ inlineData: { mimeType: input.photo.mime, data: input.photo.data } });
  parts.push({ text: prompt });
  const res = await generate(ai, [{ role: 'user', parts }], {
    responseMimeType: 'application/json',
    responseJsonSchema: SCHEMA,
    temperature: 0.1,
    maxOutputTokens: 6000,
  }, QUALITY_FIRST);
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(res.text ?? '{}');
  } catch {
    raw = {};
  }

  const kind: Business['kind'] = type.kind ?? (raw.kind === 'order' ? 'order' : 'booking');
  const staffNames = clean(input.staff, 200)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  const staff: Staff[] =
    kind === 'booking'
      ? (staffNames.length ? staffNames : ['Мастер 1', 'Мастер 2']).map((n, i) => ({ id: `m${i + 1}`, name: n.slice(0, 24), role_ru: 'мастер', role_kz: 'шебер' }))
      : [];

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d.]/g, '')));
  const services: Service[] =
    kind === 'booking' && Array.isArray(raw.services)
      ? raw.services
          .slice(0, 30)
          .map((s: Record<string, unknown>, i: number) => ({
            id: `s${i + 1}`,
            ru: clean(s.ru, 80),
            kz: clean(s.kz, 80) || clean(s.ru, 80),
            price: Math.round(num(s.price)),
            ...(s.price_from === true ? { priceFrom: true } : {}),
            minutes: Math.min(480, Math.max(15, Math.round((num(s.minutes) || 60) / 15) * 15)),
            staff: staff.map((x) => x.id),
          }))
          .filter((s: Service) => s.ru && s.price > 0 && s.price < 10_000_000)
      : [];
  const products: Product[] =
    kind === 'order' && Array.isArray(raw.products)
      ? raw.products
          .slice(0, 30)
          .map((p: Record<string, unknown>, i: number) => ({
            id: `p${i + 1}`,
            ru: clean(p.ru, 80),
            kz: clean(p.kz, 80) || clean(p.ru, 80),
            price: Math.round(num(p.price)),
            ...(p.price_from === true ? { priceFrom: true } : {}),
            unit: /кг|kg|килограм/i.test(String(p.unit ?? '')) ? 'кг' : clean(p.unit, 12) || 'шт',
            available: p.available !== false,
            leadDays: Math.min(7, Math.max(0, Math.round(num(p.lead_days) || 0))),
          }))
          .filter((p: Product) => p.ru && p.price > 0 && p.price < 10_000_000)
      : [];
  if (!services.length && !products.length) throw new Error('nothing read');

  return {
    template: 'custom',
    name,
    kind,
    type_ru: clean(raw.type_ru, 40) || 'Малый бизнес',
    type_kz: clean(raw.type_kz, 40) || 'Шағын бизнес',
    address: clean(input.address, 80) || 'Кызылорда',
    hours: parseHours(raw.hours),
    staff,
    services,
    products,
    facts: Array.isArray(raw.facts) ? raw.facts.slice(0, 5).map((f) => clean(f, 160)).filter(Boolean) : [],
    delivery: null,
  };
}
