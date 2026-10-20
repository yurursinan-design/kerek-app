// The WhatsApp assistant demo: calendar, consent, tool loop, owner actions and orders, with a fake Gemini
import { checkBooking, freeTimes, localNow, nearestFree, seedBookings, toHHMM } from '../functions/src/demo/calendar';
import { customerTurn, historyContents, ownerAction, cleanReply, type GeminiLike } from '../functions/src/demo/engine';
import { detectLang } from '../functions/src/demo/texts';
import { cloneTemplate } from '../functions/src/demo/templates';
import { runTool } from '../functions/src/demo/tools';
import type { Session } from '../functions/src/demo/types';

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

// Wednesday 21 October 2026, 10:00 in Kyzylorda (05:00 UTC)
const NOW = Date.parse('2026-10-21T05:00:00Z');

function session(template: string): Session {
  const business = cloneTemplate(template)!;
  return {
    ownerUid: 'u1',
    business,
    bookings: [],
    orders: [],
    messages: [],
    alerts: [],
    consent: 'none',
    chatLang: 'ru',
    botPaused: false,
    seq: 0,
    createdAt: NOW,
    expiresAt: NOW + 3 * 86400000,
    busyUntil: 0,
  };
}

type Step = { calls?: { name: string; args: Record<string, unknown> }[]; text?: string };
/** Plays scripted model turns and records what it was sent */
function fakeAi(steps: Step[]) {
  const seen: any[] = [];
  const ai: GeminiLike = {
    models: {
      generateContent: async (params: any) => {
        // A copy: the engine keeps adding to the same contents array
        seen.push(JSON.parse(JSON.stringify(params)));
        const step = steps.shift() ?? { text: 'ok' };
        const calls = (step.calls ?? []).map((c, i) => ({ id: `c${i}`, name: c.name, args: c.args }));
        return {
          text: step.text,
          functionCalls: calls.length ? calls : undefined,
          candidates: [{ content: { role: 'model', parts: calls.length ? calls.map((c) => ({ functionCall: c })) : [{ text: step.text }] } }],
        } as any;
      },
    },
  };
  return { ai, seen };
}

// --- Time and calendar ---
const now = localNow(NOW);
check('Kyzylorda time is UTC+5', now.date === '2026-10-21' && toHHMM(now.minutes) === '10:00' && now.weekday === 2);

const salon = session('salon');
salon.bookings.push({ id: 'x1', serviceId: 'manicure', staffId: 'zhanna', date: '2026-10-22', start: '12:00', minutes: 90, customer: 'A', source: 'seed', status: 'active', createdAt: NOW });
const zhanna = freeTimes(salon.business, salon.bookings, 'manicure', '2026-10-22', now)[0];
check('A booked manicure blocks overlapping starts', !zhanna.times.includes(12 * 60) && !zhanna.times.includes(11 * 60) && zhanna.times.includes(13 * 60 + 30));
check('Last start ends by closing time', zhanna.times[zhanna.times.length - 1] === 20 * 60 - 90);
const today = freeTimes(salon.business, salon.bookings, 'manicure', '2026-10-21', now)[0];
check('Today starts half an hour from now', today.times[0] === 10 * 60 + 30);
check('Busy time is refused', 'problem' in checkBooking(salon.business, salon.bookings, { serviceId: 'manicure', date: '2026-10-22', time: '12:30', customer: 'B' }, now));
check('Free time picks the staff member', JSON.stringify(checkBooking(salon.business, salon.bookings, { serviceId: 'manicure', date: '2026-10-22', time: '14:00', customer: 'B' }, now)) === '{"staffId":"zhanna"}');
const auto = session('auto');
check('Closed Sunday is refused', JSON.stringify(checkBooking(auto.business, [], { serviceId: 'oil', date: '2026-10-25', time: '10:00', customer: 'B' }, now)) === '{"problem":"closed"}');
const near = nearestFree(salon.business, salon.bookings, 'manicure', '2026-10-22', 12 * 60, now);
check('Alternatives are close to the wanted time', near.length === 3 && near.every((x) => x.date === '2026-10-22') && near[0].time !== '12:00', JSON.stringify(near));
const seeded = seedBookings(salon.business, NOW, 'abc');
check('Invented calendar is deterministic and has no overlaps', seeded.length > 20 && JSON.stringify(seeded) === JSON.stringify(seedBookings(salon.business, NOW, 'abc')) &&
  seeded.every((a) => !seeded.some((b) => a !== b && a.staffId === b.staffId && a.date === b.date && Number(a.start.replace(':', '')) < Number(b.start.replace(':', '')) && Number(b.start.slice(0, 2)) * 60 + Number(b.start.slice(3)) < Number(a.start.slice(0, 2)) * 60 + Number(a.start.slice(3)) + a.minutes)));

// --- Language ---
check('Kazakh letters → kz', detectLang('Ертең маникюрге бос уақыт бар ма?', 'ru') === 'kz');
check('Kazakh in Latin → kz', detectLang('salem, erteñ bos uaqyt bar ma', 'ru') === 'kz');
check('Russian → ru', detectLang('Сколько стоит стрижка?', 'kz') === 'ru');
check('Markdown bold becomes WhatsApp bold', cleanReply('**5 000 ₸** за маникюр') === '*5 000 ₸* за маникюр');

async function main() {
  // --- Consent comes before any AI call ---
  {
    const s = session('salon');
    const { ai, seen } = fakeAi([]);
    await customerTurn(s, { text: 'Сколько стоит маникюр?' }, ai, NOW);
    check('First message gets the consent buttons, no AI call', seen.length === 0 && s.consent === 'asked' && s.messages[1].buttons?.[0].id === 'consent_yes');
    await customerTurn(s, { text: 'алло?' }, ai, NOW);
    check('Typing instead of tapping: buttons again and the owner is told', seen.length === 0 && s.messages.length === 4 && s.alerts.some((a) => a.kind === 'no_consent' && !a.done));
    await customerTurn(s, { text: 'ну?' }, ai, NOW);
    check('No third prompt', s.messages.length === 5);
    const { ai: ai2, seen: seen2 } = fakeAi([{ text: 'Маникюр с гель-лаком — **5 000 ₸**.' }]);
    await customerTurn(s, { button: 'consent_yes' }, ai2, NOW);
    const last = s.messages[s.messages.length - 1];
    const sent = seen2[0].contents as any[];
    check('After consent the AI answers the question', s.consent === 'given' && last.from === 'bot' && last.text === 'Маникюр с гель-лаком — *5 000 ₸*.');
    check('Consent messages are not shown to the AI', sent.length === 1 && sent[0].role === 'user' && sent[0].parts.map((p: any) => p.text).join('|') === 'Сколько стоит маникюр?|алло?|ну?');
    check('Consent alert closed', !s.alerts.some((a) => a.kind === 'no_consent' && !a.done));
    let threw = false;
    try {
      await customerTurn(s, { button: 'made_up' }, ai2, NOW);
    } catch {
      threw = true;
    }
    check('Unknown buttons are refused', threw);
  }

  // --- Voice before consent waits; it is transcribed only after the tap ---
  {
    const s = session('salon');
    const { ai, seen } = fakeAi([{ text: 'Завтра маникюр хочу' }, { text: 'Хорошо, на какое время?' }]);
    await customerTurn(s, { voice: { data: 'AAAA', mime: 'audio/wav', seconds: 4 } }, ai, NOW);
    check('Voice before consent is not sent to the AI', seen.length === 0 && s.messages[0].kind === 'voice' && !s.messages[0].note);
    await customerTurn(s, { button: 'consent_yes', voice: { data: 'AAAA', mime: 'audio/wav', seconds: 4 } }, ai, NOW);
    check('After consent the voice is transcribed and answered', seen.length === 2 && s.messages[0].note === 'Завтра маникюр хочу' && s.messages[s.messages.length - 1].text === 'Хорошо, на какое время?');
    check('The AI sees the transcript', JSON.stringify(seen[1].contents).includes('[Голосовое] Завтра маникюр хочу'));
  }

  // --- Tool loop: free time, then booking ---
  {
    const s = session('salon');
    s.consent = 'given';
    s.bookings.push({ id: 'x1', serviceId: 'manicure', staffId: 'zhanna', date: '2026-10-22', start: '15:00', minutes: 90, customer: 'A', source: 'seed', status: 'active', createdAt: NOW });
    const { ai, seen } = fakeAi([
      { calls: [{ name: 'book_appointment', args: { service_id: 'manicure', date: '2026-10-22', time: '15:00', customer_name: 'Аружан' } }] },
      { calls: [{ name: 'book_appointment', args: { service_id: 'manicure', date: '2026-10-22', time: '16:30', customer_name: 'Аружан' } }] },
      { text: 'Записала вас на завтра в 16:30 ✅' },
    ]);
    await customerTurn(s, { text: 'Запишите на маникюр завтра в 15:00, Аружан' }, ai, NOW);
    const firstResult = seen[1].contents[seen[1].contents.length - 1].parts[0].functionResponse.response;
    check('Taken time is refused with alternatives', firstResult.error === 'busy' && firstResult.alternatives.length > 0, JSON.stringify(firstResult));
    const mine = s.bookings.filter((b) => b.source === 'bot');
    check('Free time is booked', mine.length === 1 && mine[0].start === '16:30' && mine[0].staffId === 'zhanna');
    check('The model turn with the call is sent back unchanged', seen[1].contents.some((c: any) => c.role === 'model' && c.parts[0].functionCall?.name === 'book_appointment'));
    check('Reply recorded with its answer time', s.messages[s.messages.length - 1].text.startsWith('Записала') && typeof s.messages[s.messages.length - 1].tookMs === 'number');

    // Owner takes over, then hands back
    ownerAction(s, { action: 'remind', id: mine[0].id }, NOW);
    check('Reminder has the two buttons', s.messages[s.messages.length - 1].buttons?.length === 2);
    ownerAction(s, { action: 'reply', text: 'Здравствуйте, это администратор' }, NOW);
    const before = seen.length;
    await customerTurn(s, { text: 'Спасибо!' }, ai, NOW);
    check('After the owner writes, the bot stays quiet and the owner is told', seen.length === before && s.botPaused && s.alerts.some((a) => a.kind === 'paused' && !a.done));
    ownerAction(s, { action: 'resume' }, NOW);
    check('Bot handed back', !s.botPaused && !s.alerts.some((a) => a.kind === 'paused' && !a.done));
    check('History marks the owner message', JSON.stringify(historyContents(s)).includes('(Ответил администратор лично)'));
    const cancel = runTool(s, 'cancel_booking', { booking_id: 'x1' }, NOW);
    check("The customer can't cancel someone else's booking", cancel.error === 'not_found');
  }

  // --- A promise to pass it on without the tool still reaches the owner ---
  {
    const s = session('salon');
    s.consent = 'given';
    const { ai } = fakeAi([{ text: 'Мне очень жаль. Я передала вашу жалобу администратору, он скоро свяжется с вами.' }]);
    await customerTurn(s, { text: 'Мастер испортила мне волосы' }, ai, NOW);
    check('Owner alert even when the model forgot the tool', s.alerts.some((a) => a.kind === 'handoff' && !a.done && a.text_ru.includes('испортила')));
    const { ai: ai2 } = fakeAi([{ text: 'Маникюр стоит 5 000 ₸.' }]);
    const before = s.alerts.length;
    await customerTurn(s, { text: 'Сколько стоит маникюр?' }, ai2, NOW);
    check('No alert for an ordinary answer', s.alerts.length === before);
  }

  // --- Orders ---
  {
    const s = session('cake');
    s.consent = 'given';
    const early = runTool(s, 'create_order', { items: [{ product_id: 'redvelvet', qty: 1 }], date: '2026-10-21', time: '18:00', mode: 'pickup', customer_name: 'Дана' }, NOW);
    check('Made-to-order cake needs its days', early.error === 'cannot_order', JSON.stringify(early));
    const noAddress = runTool(s, 'create_order', { items: [{ product_id: 'medovik', qty: 1.5 }], date: '2026-10-21', time: '18:00', mode: 'delivery', customer_name: 'Дана' }, NOW);
    check('Delivery needs an address', noAddress.error === 'no_address');
    const ok = runTool(s, 'create_order', { items: [{ product_id: 'medovik', qty: 1.5 }], date: '2026-10-21', time: '18:00', mode: 'delivery', address: 'ул. Абая 5', customer_name: 'Дана' }, NOW);
    check('Showcase cake today with delivery: total includes delivery', ok.ok === true && ok.total === 7500 * 1.5 + 1000, JSON.stringify(ok));
    check('New order waits for the owner', s.orders[0].status === 'new' && s.alerts.some((a) => a.kind === 'order' && a.refId === s.orders[0].id));
    ownerAction(s, { action: 'confirm', id: String(ok.order_id) }, NOW);
    check('Confirming tells the customer', s.orders[0].status === 'confirmed' && s.messages[s.messages.length - 1].text.includes('подтверждён') && !s.alerts.some((a) => a.refId === s.orders[0].id && !a.done));
    const late = runTool(s, 'create_order', { items: [{ product_id: 'napoleon', qty: 1 }], date: '2026-10-21', time: '10:30', mode: 'pickup', customer_name: 'Дана' }, NOW);
    check('Too soon today is refused', late.error === 'too_soon');
  }

  if (failed) {
    console.log(`${failed} demo bot check(s) failed`);
    process.exit(1);
  }
  console.log('ALL DEMO BOT CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
