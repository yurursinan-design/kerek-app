/**
 * Phone login with a code sent to WhatsApp (functions/src/whatsappLogin.ts), run against the
 * Firestore and Auth emulators with the WhatsApp Cloud API replaced by a stub. Checks: only
 * Kazakhstan numbers, the code goes out as the authentication template (Kazakh or Russian, Russian
 * when the Kazakh one is missing) and only its hash is stored, wrong codes count, five tries end the
 * code, a minute between codes, the number is put on the caller's own account, a second device with
 * the same number gets that account, refusals are reported, and Google Play's review number signs in
 * with its fixed code without any message.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_TEMPLATE = 'kerek_login_code';
process.env.WHATSAPP_GRAPH_VERSION = 'v23.0';

let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

// WhatsApp Cloud API stub: remembers the messages; `refuse` makes it answer with a Graph API error
type Sent = { url: string; auth: string; to: string; template: string; lang: string; bodyCode: string; buttonCode: string };
const sent: Sent[] = [];
let refuse: ((lang: string) => number | null) | null = null;
(globalThis as any).fetch = async (url: string, init: { body: string; headers: Record<string, string> }) => {
  const b = JSON.parse(init.body);
  const lang = b.template?.language?.code;
  const errCode = refuse ? refuse(lang) : null;
  if (errCode) return { ok: false, status: 400, json: async () => ({ error: { code: errCode, message: 'refused' } }) };
  sent.push({
    url: String(url),
    auth: init.headers.Authorization,
    to: b.to,
    template: b.template?.name,
    lang,
    bodyCode: b.template?.components?.[0]?.parameters?.[0]?.text,
    buttonCode: b.template?.components?.[1]?.parameters?.[0]?.text,
  });
  return { ok: true, status: 200, json: async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.test' }] }) };
};

async function main() {
  // Loaded by path so the app's type check doesn't need the functions' own packages installed
  const loginModule = '../functions/src/whatsappLogin';
  const { requestLoginCode, verifyLoginCode, normalizeKzPhone } = await import(loginModule);
  // firebase-admin lives in functions/node_modules
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getAuth } = requireFromFunctions('firebase-admin/auth');
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');
  const auth = getAuth();

  // The app sends the privacy policy version the user accepted with every code check
  const run = (fn: any, uid: string, data: any, ip = '10.0.0.1') =>
    fn.run({
      data: fn === verifyLoginCode && !('consentVersion' in data) ? { ...data, consentVersion: '2026-10-17.3' } : data,
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

  // Unique numbers per run: rate-limit counters stay in the emulator between runs
  const tail = String(Date.now()).slice(-7);
  const phone = `+7701${tail}`;
  const uidA = `anonA_${tail}`;
  const uidB = `anonB_${tail}`;
  await auth.createUser({ uid: uidA });
  await auth.createUser({ uid: uidB });

  assert(normalizeKzPhone('+7 701 123 45 67') === '+77011234567', 'Kazakhstan number is accepted');
  assert(normalizeKzPhone('+7 912 123 45 67') === null, 'Russian number is refused');
  assert(normalizeKzPhone('+90 532 123 45 67') === '+905321234567', 'Turkish tester number is accepted during the closed test');
  assert((await errCode(run(requestLoginCode, uidA, { phone: '+79121234567' }))) === 'invalid-argument', 'Request with a non-Kazakhstan number fails');
  assert((await errCode(requestLoginCode.run({ data: { phone }, rawRequest: { headers: {} } } as any))) === 'unauthenticated', 'Request without sign-in fails');

  // 1. Code sent to WhatsApp as the authentication template, only a hash stored
  assert((await errCode(run(requestLoginCode, uidA, { phone, lang: 'ru' }))) === 'ok', 'Code is requested');
  const msg = sent[sent.length - 1];
  const code = msg?.bodyCode || '';
  assert(/^\d{6}$/.test(code) && msg.buttonCode === code, 'The code is in the message and its copy button');
  assert(msg?.to === phone.slice(1) && msg.auth === 'Bearer test-token', 'Message goes to the number with the business token');
  assert(msg?.url === 'https://graph.facebook.com/v23.0/1234567890/messages' && msg.template === 'kerek_login_code', 'Sent from the business number with the login template');
  assert(msg?.lang === 'ru', 'Russian template for the Russian app', msg?.lang);
  const stored = await getFirestore().collection('loginCodes').get();
  assert(stored.docs.every((d: any) => !JSON.stringify(d.data()).includes(code)), 'The code itself is not stored');

  // 2. A minute between codes for one number
  assert((await errCode(run(requestLoginCode, uidA, { phone }))) === 'resource-exhausted', 'Second code within a minute is refused');

  // 3. Wrong code counts, right code links the number to the caller's account
  const wrong = code === '000000' ? '111111' : '000000';
  assert((await errCode(run(verifyLoginCode, uidA, { phone, code: wrong }))) === 'invalid-argument', 'Wrong code is refused');
  assert((await errCode(run(verifyLoginCode, uidA, { phone, code, consentVersion: '' }))) === 'failed-precondition', 'Without the consent the code is not accepted');
  const res = await run(verifyLoginCode, uidA, { phone, code });
  assert(typeof res?.token === 'string' && res.token.length > 20, 'Right code returns a sign-in token');
  assert((await auth.getUser(uidA)).phoneNumber === phone, 'Number is now on the caller’s own account');
  assert((await errCode(run(verifyLoginCode, uidA, { phone, code }))) === 'deadline-exceeded', 'A used code cannot be used again');

  // 4. Same number on a second device: that existing account is used
  // (skip the one-minute wait: clear this number's per-minute counter)
  const { createHash } = await import('node:crypto');
  const phoneKey = createHash('sha256').update(`login:${phone}`).digest('hex').slice(0, 40);
  await getFirestore().collection('rateLimits').doc(`otp_phone_min_${phoneKey}`).delete();
  assert((await errCode(run(requestLoginCode, uidB, { phone, lang: 'kz' }, '10.0.0.2'))) === 'ok', 'Second device requests a code');
  const code2 = sent[sent.length - 1].bodyCode;
  assert(sent[sent.length - 1].lang === 'kk', 'Kazakh template for the Kazakh app');
  const consent = (await getFirestore().collection('consents').doc(uidA).get()).data();
  const history = await getFirestore().collection('consents').doc(uidA).collection('history').get();
  assert(consent?.version === '2026-10-17.3' && typeof consent?.acceptedAt?.toMillis === 'function' && history.size >= 1, 'The consent is recorded on the server with its version and server time');
  const res2 = await run(verifyLoginCode, uidB, { phone, code: code2 });
  const claims = JSON.parse(Buffer.from(String(res2.token).split('.')[1], 'base64url').toString());
  assert(claims.uid === uidA, 'Second device signs in to the account that has the number', claims.uid);
  assert(!(await auth.getUser(uidB)).phoneNumber, 'The second anonymous account stays without the number');

  // 5. Five wrong tries end the code
  const phone3 = `+7702${tail}`;
  await run(requestLoginCode, uidB, { phone: phone3 }, '10.0.0.3');
  const code3 = sent[sent.length - 1].bodyCode;
  const bad = code3 === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await errCode(run(verifyLoginCode, uidB, { phone: phone3, code: bad }));
  assert((await errCode(run(verifyLoginCode, uidB, { phone: phone3, code: code3 }))) === 'deadline-exceeded', 'After five wrong tries even the right code is refused');

  // 6. No Kazakh template yet: the Russian one is sent instead
  refuse = (lang) => (lang === 'kk' ? 132001 : null);
  const phone4 = `+7705${tail}`;
  assert((await errCode(run(requestLoginCode, uidB, { phone: phone4, lang: 'kz' }, '10.0.0.4'))) === 'ok', 'Kazakh app still gets a code');
  assert(sent[sent.length - 1].lang === 'ru' && sent[sent.length - 1].to === phone4.slice(1), 'Russian template is used when the Kazakh one is missing');

  // 7. Refusals are reported, not hidden (a fresh account: each account may ask for 5 codes an hour)
  const uidC = `anonC_${tail}`;
  await auth.createUser({ uid: uidC });
  refuse = () => 131056;
  assert((await errCode(run(requestLoginCode, uidC, { phone: `+7706${tail}` }, '10.0.0.5'))) === 'resource-exhausted', 'Sending too fast is reported as too many requests');
  refuse = () => 190;
  assert((await errCode(run(requestLoginCode, uidC, { phone: `+7707${tail}` }, '10.0.0.6'))) === 'unavailable', 'Other refusals (e.g. expired token) are reported as unavailable');
  refuse = null;

  // 8. Not set up yet: a clear error instead of a broken request
  process.env.WHATSAPP_PHONE_NUMBER_ID = '';
  assert((await errCode(run(requestLoginCode, uidC, { phone: `+7708${tail}` }, '10.0.0.7'))) === 'failed-precondition', 'Missing business number is reported as not set up');
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';

  // 9. Google Play review number: its fixed code, no message (works even before WhatsApp is set up)
  const reviewPhone = `+7709${tail}`;
  process.env.PLAY_REVIEW_LOGIN = `${reviewPhone.slice(1)}:246810`;
  process.env.WHATSAPP_PHONE_NUMBER_ID = '';
  const uidD = `anonD_${tail}`;
  await auth.createUser({ uid: uidD });
  const sentBefore = sent.length;
  assert((await errCode(run(requestLoginCode, uidD, { phone: reviewPhone }, '10.0.0.8'))) === 'ok', 'Review number gets a code before WhatsApp is set up');
  assert(sent.length === sentBefore, 'No WhatsApp message for the review number');
  assert((await errCode(run(verifyLoginCode, uidD, { phone: reviewPhone, code: '135790' }))) === 'invalid-argument', 'Review number refuses a wrong code');
  const res4 = await run(verifyLoginCode, uidD, { phone: reviewPhone, code: '246810' });
  assert(typeof res4?.token === 'string' && (await auth.getUser(uidD)).phoneNumber === reviewPhone, 'Review number signs in with its fixed code');
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  const other = `+7704${tail}`;
  assert((await errCode(run(requestLoginCode, uidD, { phone: other }, '10.0.0.9'))) === 'ok', 'Other numbers still get a code');
  const otherMsg = sent[sent.length - 1];
  assert(sent.length === sentBefore + 1 && otherMsg.to === other.slice(1), 'Other numbers still get a WhatsApp message');
  assert((await errCode(run(verifyLoginCode, uidD, { phone: other, code: '246810' }))) === 'invalid-argument' || otherMsg.bodyCode === '246810', 'The review code does not open other numbers');
  process.env.PLAY_REVIEW_LOGIN = '';
  await getFirestore().collection('rateLimits').doc(`otp_phone_min_${createHash('sha256').update(`login:${reviewPhone}`).digest('hex').slice(0, 40)}`).delete();
  assert((await errCode(run(requestLoginCode, uidD, { phone: reviewPhone }, '10.0.0.10'))) === 'ok' && sent[sent.length - 1].to === reviewPhone.slice(1), 'Without the setting the review number is an ordinary number');

  // Checking codes is limited per account and per network address, even when no code exists
  const noCode = `+7604${tail}`;
  const uidE = `anonE_${tail}`;
  const codesE: string[] = [];
  for (let i = 0; i < 15; i++) codesE.push(await errCode(run(verifyLoginCode, uidE, { phone: noCode, code: '123456' }, '10.0.0.30')));
  assert(codesE.every((c) => c === 'deadline-exceeded'), 'Fifteen checks an hour are answered normally', codesE.join(','));
  assert((await errCode(run(verifyLoginCode, uidE, { phone: noCode, code: '123456' }, '10.0.0.31'))) === 'resource-exhausted', 'The 16th check from one account in an hour is refused');
  const fromOneIp: string[] = [];
  for (let i = 0; i < 40; i++) fromOneIp.push(await errCode(run(verifyLoginCode, `anonF${Math.floor(i / 14)}_${tail}`, { phone: noCode, code: '123456' }, '10.0.0.31')));
  assert(fromOneIp.every((c) => c === 'deadline-exceeded'), 'Forty checks an hour from one address are answered normally', fromOneIp.join(','));
  assert((await errCode(run(verifyLoginCode, `anonG_${tail}`, { phone: noCode, code: '123456' }, '10.0.0.31'))) === 'resource-exhausted', 'More checks from the same address, even from new accounts, are refused');

  console.log(failed ? `\nWHATSAPP LOGIN: ${failed} FAILED` : '\nWHATSAPP LOGIN: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('WhatsApp login test error:', err);
  process.exit(1);
});
