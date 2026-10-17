/**
 * Login codes through Telegram (functions/src/telegramGateway.ts), against the Firestore and Auth
 * emulators with the Telegram Gateway API and the WhatsApp Cloud API replaced by a stub. Checks:
 * Telegram is used when WhatsApp isn't set up, the number is checked first and the message reuses
 * that request (one fee), the code from Telegram signs in, a number without Telegram is told so and
 * gets no message, refusals are reported, the app can ask for either channel when both are set up,
 * and the placeholder token keeps Telegram off.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const TG_TOKEN = 'tg-test-token-0123456789abcdef';
process.env.TELEGRAM_GATEWAY_TOKEN = TG_TOKEN;
process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';
process.env.WHATSAPP_TEMPLATE = 'tapsyr_login_code';
process.env.WHATSAPP_GRAPH_VERSION = 'v23.0';

let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

// Stubs: Telegram Gateway (checkSendAbility / sendVerificationMessage) and the WhatsApp Cloud API
type Call = { method: string; auth: string; body: any };
const tgCalls: Call[] = [];
const waSent: any[] = [];
let checkError: string | null = null;
let sendError: string | null = null;
(globalThis as any).fetch = async (url: string, init: { body: string; headers: Record<string, string> }) => {
  const body = JSON.parse(init.body);
  if (String(url).startsWith('https://gatewayapi.telegram.org/')) {
    const method = String(url).slice('https://gatewayapi.telegram.org/'.length);
    tgCalls.push({ method, auth: init.headers.Authorization, body });
    const error = method === 'checkSendAbility' ? checkError : sendError;
    if (error) return { ok: true, status: 200, json: async () => ({ ok: false, error }) };
    const result = { request_id: method === 'checkSendAbility' ? `req_${tgCalls.length}` : body.request_id, phone_number: body.phone_number, request_cost: 0.01 };
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  }
  waSent.push(body);
  return { ok: true, status: 200, json: async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.test' }] }) };
};

async function main() {
  const loginModule = '../functions/src/whatsappLogin';
  const { requestLoginCode, verifyLoginCode } = await import(loginModule);
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getAuth } = requireFromFunctions('firebase-admin/auth');
  const auth = getAuth();

  const run = (fn: any, uid: string, data: any, ip: string) =>
    fn.run({
      data: fn === verifyLoginCode ? { consentVersion: '2026-10-17.4', ...data } : data,
      auth: { uid, token: {} },
      rawRequest: { headers: { 'x-forwarded-for': ip }, ip },
    });
  const errCode = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e: any) {
      return String(e?.code || e?.message);
    }
  };

  // Unique numbers per run (+7 76x, unused by the other login test): rate-limit counters stay in the emulator
  const tail = String(Date.now()).slice(-7);
  const uids = ['A', 'B', 'C', 'D'].map((k) => `tg${k}_${tail}`);
  for (const uid of uids) await auth.createUser({ uid });
  const [uidA, uidB, uidC, uidD] = uids;

  // 1. Only Telegram set up: the code goes to Telegram, checked first, then sent with that request id
  const phone = `+7761${tail}`;
  const res = await run(requestLoginCode, uidA, { phone, lang: 'kz' }, '10.1.0.1');
  assert(res?.channel === 'telegram' && JSON.stringify(res.channels) === '["telegram"]', 'Telegram is used when WhatsApp is not set up', JSON.stringify(res));
  const [check, send] = tgCalls.slice(-2);
  assert(check?.method === 'checkSendAbility' && check.body.phone_number === phone, 'The number is checked first');
  assert(send?.method === 'sendVerificationMessage' && send.body.request_id === 'req_1', 'The message reuses the checked request (one fee)', JSON.stringify(send?.body));
  assert(/^\d{6}$/.test(send?.body.code || '') && send.body.ttl === 600, 'Our own 6-digit code, expiring with the code');
  assert(check?.auth === `Bearer ${TG_TOKEN}` && send?.auth === `Bearer ${TG_TOKEN}`, 'Calls carry the Gateway token');
  assert(waSent.length === 0, 'Nothing goes to WhatsApp');

  // 2. The code from Telegram signs in
  const token = await run(verifyLoginCode, uidA, { phone, code: send.body.code }, '10.1.0.1');
  assert(typeof token?.token === 'string' && (await auth.getUser(uidA)).phoneNumber === phone, 'The Telegram code signs in and puts the number on the account');

  // 3. A number without Telegram: told so, no message sent, no fee
  checkError = 'PHONE_NUMBER_NOT_FOUND';
  const before = tgCalls.length;
  assert((await errCode(run(requestLoginCode, uidB, { phone: `+7762${tail}` }, '10.1.0.2'))) === 'not-found', 'A number without Telegram is reported as such');
  assert(tgCalls.length === before + 1 && tgCalls[tgCalls.length - 1].method === 'checkSendAbility', 'No message is sent to it');

  // 4. Refusals: too fast, and anything else (balance, token)
  checkError = 'FLOOD_WAIT_30';
  assert((await errCode(run(requestLoginCode, uidB, { phone: `+7763${tail}` }, '10.1.0.3'))) === 'resource-exhausted', 'Sending too fast is reported as too many requests');
  checkError = null;
  sendError = 'BALANCE_NOT_ENOUGH';
  assert((await errCode(run(requestLoginCode, uidC, { phone: `+7764${tail}` }, '10.1.0.4'))) === 'unavailable', 'An empty balance is reported as unavailable');
  checkError = 'ACCESS_TOKEN_INVALID';
  sendError = null;
  assert((await errCode(run(requestLoginCode, uidC, { phone: `+7765${tail}` }, '10.1.0.5'))) === 'unavailable', 'A wrong token is reported as unavailable, not as "no Telegram"');
  checkError = null;

  // 5. Both set up: WhatsApp first, Telegram when the app asks for it
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  const both = await run(requestLoginCode, uidD, { phone: `+7766${tail}` }, '10.1.0.6');
  assert(both?.channel === 'whatsapp' && JSON.stringify(both.channels) === '["whatsapp","telegram"]' && waSent.length === 1, 'With both set up WhatsApp is the default and both are offered', JSON.stringify(both));
  const tgBefore = tgCalls.length;
  const asked = await run(requestLoginCode, uidD, { phone: `+7767${tail}`, channel: 'telegram' }, '10.1.0.7');
  assert(asked?.channel === 'telegram' && tgCalls.length === tgBefore + 2 && waSent.length === 1, 'The app can ask for Telegram');

  // 6. The placeholder token keeps Telegram off; with nothing set up the app is told so
  process.env.TELEGRAM_GATEWAY_TOKEN = 'henuz-yok';
  const onlyWa = await run(requestLoginCode, uidD, { phone: `+7768${tail}`, channel: 'telegram' }, '10.1.0.8');
  assert(onlyWa?.channel === 'whatsapp' && JSON.stringify(onlyWa.channels) === '["whatsapp"]', 'With the placeholder token Telegram is off and WhatsApp is used');
  process.env.WHATSAPP_PHONE_NUMBER_ID = '';
  const uidE = `tgE_${tail}`;
  await auth.createUser({ uid: uidE });
  assert((await errCode(run(requestLoginCode, uidE, { phone: `+7769${tail}` }, '10.1.0.9'))) === 'failed-precondition', 'With neither channel set up the app is told login is not set up');

  console.log(failed ? `\nTELEGRAM LOGIN: ${failed} FAILED` : '\nTELEGRAM LOGIN: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Telegram login test error:', err);
  process.exit(1);
});
