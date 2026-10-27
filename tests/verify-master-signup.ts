/**
 * Masters' pre-registration from the website (functions/src/masterSignup.ts), run against the
 * Firestore emulator. Checks: a valid form is saved under the phone number with the consent and a
 * deletion date a year ahead; wrong fields and a missing consent are refused; the bot trap field
 * saves nothing; sending again updates the entry and keeps the operator's status; one network can
 * send only a few forms an hour.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';

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
  const signupModule = '../functions/src/masterSignup';
  const fieldsModule = '../functions/src/masterSignupFields';
  const { handleMasterSignup } = await import(signupModule);
  const { kzMobile, checkMasterSignup } = await import(fieldsModule);
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getFirestore } = requireFromFunctions('firebase-admin/firestore');
  const db = getFirestore();

  const send = async (body: unknown, ip = '10.1.0.1', method = 'POST') => {
    let status = 200;
    let json: any = null;
    const res = {
      status(code: number) {
        status = code;
        return res;
      },
      json(b: unknown) {
        json = b;
      },
    };
    await handleMasterSignup({ method, body, ip, headers: { 'x-forwarded-for': ip } }, res);
    return { status, json };
  };
  const form = {
    name: '  Ерлан  Сейтов ',
    phone: '8 (701) 123-45-67',
    category: 'plumbing',
    district: 'Шұғыла',
    email: 'Erlan.Test@Gmail.com',
    lang: 'kz',
    consent: true,
    consentVersion: '2026-10-27.1',
  };

  // Field checks
  assert(kzMobile('+7 701 123 45 67') === '+77011234567' && kzMobile('87011234567') === '+77011234567' && kzMobile('7011234567') === '+77011234567', 'Kazakhstan mobile numbers in any common form are accepted');
  assert(kzMobile('+79121234567') === '' && kzMobile('+7 727 123 45 67') === '' && kzMobile('123') === '', 'Other numbers are refused');
  assert(checkMasterSignup({ ...form, name: 'A' }).ok === false, 'Too short a name is refused');
  assert(checkMasterSignup({ ...form, category: 'drugs' }).ok === false, 'An unknown kind of work is refused');
  assert(checkMasterSignup({ ...form, email: 'not-an-email' }).ok === false, 'A wrong e-mail is refused');
  assert(checkMasterSignup({ ...form, email: '' }).ok === true, 'E-mail is optional');
  assert(checkMasterSignup({ ...form, name: '<b>Ерлан</b>' }).ok === true && (checkMasterSignup({ ...form, name: '<b>Ерлан</b>' }) as any).value.name.includes('<') === false, 'Markup is removed from the name');

  // Refusals
  assert((await send(form, '10.1.0.9', 'GET')).status === 405, 'Only POST is accepted');
  const noConsent = await send({ ...form, consent: false }, '10.1.0.2');
  assert(noConsent.status === 400 && noConsent.json.field === 'consent', 'Without the consent nothing is saved', JSON.stringify(noConsent));
  const trap = await send({ ...form, phone: '+77021112233', website: 'http://spam' }, '10.1.0.3');
  assert(trap.json?.ok === true && !(await db.collection('masterSignups').doc('77021112233').get()).exists, 'A filled bot trap answers ok but saves nothing');

  // Saved
  const ok = await send(form);
  assert(ok.status === 200 && ok.json?.ok === true, 'A valid form is accepted', JSON.stringify(ok));
  const ref = db.collection('masterSignups').doc('77011234567');
  const saved = (await ref.get()).data();
  assert(saved?.name === 'Ерлан Сейтов' && saved?.phone === '+77011234567' && saved?.email === 'erlan.test@gmail.com', 'Saved under the number, cleaned');
  assert(saved?.status === 'new' && saved?.consentVersion === '2026-10-27.1' && saved?.consentAt && saved?.createdAt, 'Status new, consent version and time recorded');
  const days = (saved?.expireAt.toMillis() - Date.now()) / 86400000;
  assert(days > 364 && days < 366, 'Deleted automatically after a year', String(days));

  // Sending again updates, the operator's status stays
  await ref.update({ status: 'contacted' });
  await send({ ...form, district: 'Сырдария' }, '10.1.0.4');
  const again = (await ref.get()).data();
  assert(again?.district === 'Сырдария' && again?.status === 'contacted', 'Sending again updates the entry and keeps the status');

  // One network: five forms an hour
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) codes.push((await send({ ...form, phone: `+7705000000${i}` }, '10.1.0.50')).status);
  assert(codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429, 'The sixth form from one network within an hour is refused', codes.join(','));

  if (failed) {
    console.error(`\nMASTER SIGNUP: ${failed} FAILED`);
    process.exit(1);
  }
  console.log('\nMASTER SIGNUP: ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
