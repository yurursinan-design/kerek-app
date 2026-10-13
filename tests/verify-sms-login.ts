/**
 * SMS login through the Mobizon gateway (functions/src/smsLogin.ts), run against the Firestore and
 * Auth emulators with the SMS gateway replaced by a stub. Checks: only Kazakhstan numbers, the code
 * is texted and only its hash stored, wrong codes count, five tries end the code, a minute between
 * codes, the number is put on the caller's own account, and a second device with the same number
 * gets that account.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.MOBIZON_API_KEY = 'test-key';

let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

// SMS gateway stub: remembers the texts and can be told to refuse
const sent: { recipient: string; text: string; apiKey: string }[] = [];
let gatewayCode = 0;
(globalThis as any).fetch = async (url: string, init: { body: string }) => {
  const p = new URLSearchParams(init.body);
  if (String(url).includes('mobizon')) sent.push({ recipient: p.get('recipient') || '', text: p.get('text') || '', apiKey: p.get('apiKey') || '' });
  return { ok: true, status: 200, json: async () => ({ code: gatewayCode, data: {}, message: gatewayCode ? 'refused' : '' }) };
};

async function main() {
  // Loaded by path so the app's type check doesn't need the functions' own packages installed
  const smsLoginModule = '../functions/src/smsLogin';
  const { requestLoginCode, verifyLoginCode, normalizeKzPhone } = await import(smsLoginModule);
  // firebase-admin lives in functions/node_modules
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getAuth } = requireFromFunctions('firebase-admin/auth');
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');
  const auth = getAuth();

  const run = (fn: any, uid: string, data: any, ip = '10.0.0.1') =>
    fn.run({ data, auth: { uid, token: {} }, rawRequest: { headers: { 'x-forwarded-for': ip }, ip } });
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
  assert((await errCode(run(requestLoginCode, uidA, { phone: '+79121234567' }))) === 'invalid-argument', 'Request with a non-Kazakhstan number fails');
  assert((await errCode(requestLoginCode.run({ data: { phone }, rawRequest: { headers: {} } } as any))) === 'unauthenticated', 'Request without sign-in fails');

  // 1. Code texted, only a hash stored
  assert((await errCode(run(requestLoginCode, uidA, { phone, lang: 'ru' }))) === 'ok', 'Code is requested');
  const sms = sent[sent.length - 1];
  const code = (sms?.text.match(/\d{6}/) || [''])[0];
  assert(sms?.recipient === phone.slice(1) && sms.apiKey === 'test-key', 'SMS goes to the number through the gateway key');
  assert(/^Код входа KEREK: \d{6}\./.test(sms?.text || ''), 'Russian SMS text', sms?.text);
  const stored = await getFirestore().collection('loginCodes').get();
  assert(stored.docs.every((d: any) => !JSON.stringify(d.data()).includes(code)), 'The code itself is not stored');

  // 2. A minute between codes for one number
  assert((await errCode(run(requestLoginCode, uidA, { phone }))) === 'resource-exhausted', 'Second code within a minute is refused');

  // 3. Wrong code counts, right code links the number to the caller's account
  const wrong = code === '000000' ? '111111' : '000000';
  assert((await errCode(run(verifyLoginCode, uidA, { phone, code: wrong }))) === 'invalid-argument', 'Wrong code is refused');
  const res = await run(verifyLoginCode, uidA, { phone, code });
  assert(typeof res?.token === 'string' && res.token.length > 20, 'Right code returns a sign-in token');
  assert((await auth.getUser(uidA)).phoneNumber === phone, 'Number is now on the caller’s own account');
  assert((await errCode(run(verifyLoginCode, uidA, { phone, code }))) === 'deadline-exceeded', 'A used code cannot be used again');

  // 4. Same number on a second device: that existing account is used
  // (skip the one-minute wait: clear this number's per-minute counter)
  const { createHash } = await import('node:crypto');
  const phoneKey = createHash('sha256').update(`login:${phone}`).digest('hex').slice(0, 40);
  await getFirestore().collection('rateLimits').doc(`sms_phone_min_${phoneKey}`).delete();
  assert((await errCode(run(requestLoginCode, uidB, { phone, lang: 'kz' }, '10.0.0.2'))) === 'ok', 'Second device requests a code');
  const code2 = (sent[sent.length - 1].text.match(/\d{6}/) || [''])[0];
  assert(/^KEREK кіру коды: \d{6}\./.test(sent[sent.length - 1].text), 'Kazakh SMS text');
  const res2 = await run(verifyLoginCode, uidB, { phone, code: code2 });
  const claims = JSON.parse(Buffer.from(String(res2.token).split('.')[1], 'base64url').toString());
  assert(claims.uid === uidA, 'Second device signs in to the account that has the number', claims.uid);
  assert(!(await auth.getUser(uidB)).phoneNumber, 'The second anonymous account stays without the number');

  // 5. Five wrong tries end the code
  const phone3 = `+7702${tail}`;
  await run(requestLoginCode, uidB, { phone: phone3 }, '10.0.0.3');
  const code3 = (sent[sent.length - 1].text.match(/\d{6}/) || [''])[0];
  const bad = code3 === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await errCode(run(verifyLoginCode, uidB, { phone: phone3, code: bad }));
  assert((await errCode(run(verifyLoginCode, uidB, { phone: phone3, code: code3 }))) === 'deadline-exceeded', 'After five wrong tries even the right code is refused');

  // 6. Gateway refusal is reported, not hidden
  gatewayCode = 8;
  const phone4 = `+7705${tail}`;
  assert((await errCode(run(requestLoginCode, uidB, { phone: phone4 }, '10.0.0.4'))) === 'unavailable', 'Gateway refusal is reported as unavailable');

  console.log(failed ? `\nSMS LOGIN: ${failed} FAILED` : '\nSMS LOGIN: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('SMS login test error:', err);
  process.exit(1);
});
