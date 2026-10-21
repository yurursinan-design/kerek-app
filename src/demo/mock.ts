/**
 * Local stand-in for the demo functions (VITE_DEMO_MOCK=1 builds only): the real engine with a
 * scripted model instead of Gemini, so the page can be laid out and screenshotted offline.
 */
import { addDays, localNow, seedBookings, seedOrders } from '../../functions/src/demo/calendar';
import { customerTurn, ownerAction, type GeminiLike, type OwnerAction } from '../../functions/src/demo/engine';
import { cloneTemplate } from '../../functions/src/demo/templates';
import type { Business, Session } from '../../functions/src/demo/types';
import type { DemoApi, DemoView } from './api';

function view(id: string, s: Session): DemoView {
  return JSON.parse(JSON.stringify({ id, business: s.business, bookings: s.bookings, orders: s.orders, messages: s.messages, alerts: s.alerts, consent: s.consent, chatLang: s.chatLang, botPaused: s.botPaused, expiresAt: s.expiresAt }));
}

function scripted(s: Session): GeminiLike {
  return {
    models: {
      generateContent: async (params) => {
        await new Promise((r) => setTimeout(r, 900));
        const contents = params.contents as { role: string; parts: { text?: string; functionResponse?: unknown }[] }[];
        const last = contents[contents.length - 1];
        const text = last.parts.map((p) => p.text ?? '').join(' ');
        const reply = (t: string) => ({ text: t, functionCalls: undefined, candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] });
        if (last.parts[0]?.functionResponse) {
          const r = (last.parts[0].functionResponse as { response: Record<string, unknown> }).response;
          return reply(r.ok ? `Записала вас ✅\n*${r.service}* — ${r.weekday}, ${r.time}, мастер ${r.staff}.\nЦена: ${r.price} ₸. Адрес: ${r.address}.` : 'Это время занято. Могу предложить 16:30 или 18:00.') as never;
        }
        const time = /(\d{1,2})[:.](\d{2})/.exec(text);
        const b = s.business;
        if (time && b.kind === 'booking') {
          const call = { id: 'c1', name: 'book_appointment', args: { service_id: b.services[0].id, date: addDays(localNow(Date.now()).date, 1), time: `${time[1].padStart(2, '0')}:${time[2]}`, customer_name: 'Аружан' } };
          return { text: undefined, functionCalls: [call], candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }] } as never;
        }
        const first = b.kind === 'booking' ? b.services[0] : null;
        return reply(first ? `${first.ru} — *${first.price.toLocaleString('ru-RU')} ₸*, ${first.minutes} минут.\nЗавтра свободно в 11:00, 15:00 и 17:30. Записать вас?` : 'Сегодня в витрине: медовик, наполеон и чизкейк. На какой день нужен торт?') as never;
      },
    },
  };
}

export function mockApi(): DemoApi {
  const sessions = new Map<string, Session>();
  let n = 0;
  const get = (id: string) => {
    const s = sessions.get(id);
    if (!s) throw new Error('not found');
    return s;
  };
  return {
    async start(p) {
      await new Promise((r) => setTimeout(r, 500));
      const business: Business | null = p.template ? cloneTemplate(p.template) : p.build ? { ...cloneTemplate('salon')!, template: 'custom', name: p.build.name } : null;
      if (!business) throw new Error('no demo');
      const id = `mock${++n}aaaaaaaaaa`;
      const now = Date.now();
      const s: Session = { ownerUid: 'mock', business, bookings: seedBookings(business, now, id), orders: seedOrders(business, now, id), messages: [], alerts: [], consent: 'none', chatLang: p.lang, botPaused: false, seq: 0, createdAt: now, expiresAt: now + 86400000, busyUntil: 0 };
      sessions.set(id, s);
      return view(id, s);
    },
    async send(p) {
      const s = get(p.id);
      await customerTurn(s, { text: p.text, button: p.button, voice: p.voice, photo: p.photo }, scripted(s), Date.now());
      return view(p.id, s);
    },
    async owner(p) {
      const s = get(p.id);
      if (p.action !== 'get') ownerAction(s, { action: p.action, id: p.ref ?? '', text: p.text ?? '' } as OwnerAction, Date.now());
      return view(p.id, s);
    },
  };
}
