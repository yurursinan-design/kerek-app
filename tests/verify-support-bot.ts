/**
 * The WhatsApp support line AI (functions/src/supportBot.ts), run against the Firestore emulator
 * with Gemini and WhatsApp replaced by fakes. Checks: the webhook subscription handshake; unsigned
 * or wrongly signed events and a missing app secret are refused; only the support number is
 * answered; a message is answered once even when Meta delivers it twice; a voice message is written
 * down first; the history goes to the AI; a handoff and the owner's own reply from the phone keep
 * the AI quiet in that chat; a failing Gemini still gets the customer a polite answer.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';

import * as crypto from 'crypto';

let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  // Loaded by path so the app's type check doesn't need the functions' own packages installed
  const botModule = '../functions/src/supportBot';
  const bot = await import(botModule);
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');
  const db = getFirestore();

  const SECRET = 'app-secret-test';
  const PHONE_ID = '555000111';
  let clock = Date.parse('2026-11-01T08:00:00Z');
  const sent: { to: string; text: string }[] = [];
  const asked: any[][] = [];
  let nextAnswer: any = { reply: 'Сәлеметсіз бе! Мен Tapsyr-дың ИИ-көмекшісімін. Қосымша жақында шығады.', handoff: false };
  const deps = {
    ask: async (history: any[]) => {
      asked.push(history);
      if (nextAnswer instanceof Error) throw nextAnswer;
      return nextAnswer;
    },
    send: async (to: string, text: string) => {
      sent.push({ to, text });
    },
    transcribe: async (id: string) => (id === 'voice-1' ? 'Шебер ретінде қалай тіркелемін?' : ''),
    appSecret: () => SECRET,
    verifyToken: () => 'verify-me',
    phoneId: () => PHONE_ID,
    now: () => clock,
  };

  const call = async (req: any, d: any = deps) => {
    let status = 200;
    let body = '';
    const res = {
      status(c: number) {
        status = c;
        return res;
      },
      send(b: string) {
        body = b;
      },
    };
    await bot.handleSupportWebhook(req, res, d);
    return { status, body };
  };
  const signed = (payload: unknown, secret = SECRET) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return { method: 'POST', body: payload, rawBody: raw, headers: { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') } };
  };
  const event = (field: string, value: any, phoneId = PHONE_ID) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId }, ...value } }] }],
  });
  const text = (id: string, from: string, body: string) =>
    event('messages', { contacts: [{ wa_id: from, profile: { name: 'Айгүл' } }], messages: [{ id, from, type: 'text', text: { body } }] });

  // Handshake
  const ok = await call({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' } });
  assert(ok.status === 200 && ok.body === '12345', 'Meta subscription handshake answers the challenge');
  const bad = await call({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' } });
  assert(bad.status === 403, 'A wrong verify token is refused');

  // Signatures
  assert((await call({ method: 'POST', body: text('m0', '77011112233', 'hi'), rawBody: Buffer.from('{}'), headers: {} })).status === 401, 'An unsigned event is refused');
  assert((await call(signed(text('m0', '77011112233', 'hi'), 'other-secret'))).status === 401, 'An event signed with another secret is refused');
  assert((await call(signed(text('m0', '77011112233', 'hi')), { ...deps, appSecret: () => 'unset' })).status === 401, 'Nothing is accepted while the app secret is not set');
  assert(sent.length === 0, 'Refused events send nothing');

  // Other number of the same Meta app (login codes): ignored
  await call(signed(event('messages', { messages: [{ id: 'x1', from: '77011112233', type: 'text', text: { body: 'hi' } }] }, '999')));
  assert(sent.length === 0, 'Messages to the login-code number are not answered');

  // A question is answered, once
  const r1 = await call(signed(text('m1', '77011112233', 'Сәлем! Қосымша қашан шығады?')));
  assert(r1.status === 200 && sent.length === 1 && sent[0].to === '77011112233' && sent[0].text.includes('ИИ-көмекші'), 'The customer gets the AI answer', JSON.stringify(sent));
  await call(signed(text('m1', '77011112233', 'Сәлем! Қосымша қашан шығады?')));
  assert(sent.length === 1, 'A message delivered twice is answered once');
  const chat = (await db.collection('supportChats').doc('77011112233').get()).data();
  assert(chat?.name === 'Айгүл' && chat?.expireAt, 'The chat is stored with the name and a deletion date');

  // Voice message: written down, then answered with the history
  clock += 60000;
  nextAnswer = { reply: 'Сайттағы формамен тіркеле аласыз: https://tapsyrapp.com/#join', handoff: false };
  await call(signed(event('messages', { messages: [{ id: 'm2', from: '77011112233', type: 'audio', audio: { id: 'voice-1' } }] })));
  const last = asked[asked.length - 1];
  assert(sent.length === 2 && last.length === 3 && last[2].text.includes('тіркелемін') && last[1].from === 'ai', 'A voice message is written down and answered with the chat so far', JSON.stringify(last));

  // Handoff: the AI says an operator will reply and stays quiet
  clock += 60000;
  nextAnswer = { reply: 'Оператор жақын арада жауап береді.', handoff: true };
  await call(signed(text('m3', '77011112233', 'Мен шағым айтқым келеді!')));
  assert(sent.length === 3, 'The handoff answer is sent');
  clock += 60000;
  await call(signed(text('m4', '77011112233', 'Жауап бересіз бе?')));
  assert(sent.length === 3, 'After a handoff the AI stays quiet');
  assert((await db.collection('supportChats').doc('77011112233').get()).data()?.needsOwner === true, 'The chat is marked for the owner');
  clock += bot.HANDOFF_PAUSE_MS + 1000;
  nextAnswer = { reply: 'Тағы сұрағыңыз бар ма?', handoff: false };
  await call(signed(text('m5', '77011112233', 'Сәлем')));
  assert(sent.length === 4, 'After the pause the AI answers again');

  // The owner replies from the phone: the AI leaves the chat for a while
  await call(signed(event('smb_message_echoes', { message_echoes: [{ id: 'e1', from: '77479693852', to: '77022223344', type: 'text', text: { body: 'Сәлеметсіз бе, мен Мадина' } }] })));
  await call(signed(text('m6', '77022223344', 'Рақмет!')));
  assert(sent.length === 4, 'After the owner wrote from the phone the AI does not answer');
  const owner = await db.collection('supportChats').doc('77022223344').collection('supportMessages').doc('e1').get();
  assert(owner.data()?.from === 'owner', "The owner's reply is kept in the chat");

  // Gemini fails: a polite fallback, in Russian for a Russian message
  nextAnswer = new Error('quota');
  await call(signed(text('m7', '77033334455', 'Здравствуйте, когда выйдет приложение?')));
  assert(sent.length === 5 && sent[4].text === bot.FALLBACK.ru, 'When Gemini fails the customer still gets an answer', JSON.stringify(sent[4]));

  // Pure helpers
  assert(bot.parseReply('```json\n{"reply":"ok","handoff":true}\n```')?.handoff === true && bot.parseReply('not json') === null, 'The AI answer is read only when it is the expected JSON');
  assert(bot.guessLang('Здравствуйте') === 'ru' && bot.guessLang('Сәлеметсіз бе') === 'kz', 'The fallback language follows the message');
  assert(bot.buildSystemPrompt().includes('https://tapsyrapp.com/#join'), 'The AI knows the pre-registration link');

  if (failed) {
    console.error(`\nSUPPORT BOT: ${failed} FAILED`);
    process.exit(1);
  }
  console.log('\nSUPPORT BOT: ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
