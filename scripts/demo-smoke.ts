/**
 * Calls the deployed demo functions the way the page does (anonymous sign-in, then callables) and
 * prints the conversation, to check the live setup end to end. No secrets needed.
 * Run: npx tsx scripts/demo-smoke.ts   (CI: demo-eval.yml, commit message starting with "[demo-smoke]")
 */
const API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyA2tm7w5In7uV6qEPbfCjSOKZ6Sj2fRoHI';
const BASE = 'https://asia-south1-kerek-9d153.cloudfunctions.net';
const REFERER = 'https://tapsyr.web.app/';

async function main() {
  const signUp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: REFERER },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const authRaw = await signUp.text();
  let auth: { idToken?: string; error?: unknown };
  try {
    auth = JSON.parse(authRaw);
  } catch {
    throw new Error(`sign-in HTTP ${signUp.status}: ${authRaw.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  if (!auth.idToken) throw new Error(`sign-in failed: ${JSON.stringify(auth.error)}`);
  const call = async (name: string, data: unknown) => {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}`, Origin: 'https://tapsyr.web.app' },
      body: JSON.stringify({ data }),
    });
    const raw = await res.text();
    let body: { result?: any; error?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(`${name} HTTP ${res.status}: ${raw.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    if (!body.result) throw new Error(`${name} ${res.status}: ${JSON.stringify(body.error ?? body)}`);
    console.log(`  (${name} ${((Date.now() - t0) / 1000).toFixed(1)} s, CORS ${res.headers.get('access-control-allow-origin') ?? '-'})`);
    return body.result;
  };
  let view = await call('demoStart', { template: 'salon', lang: 'ru' });
  let shown = 0;
  const show = () => {
    for (const m of view.messages.slice(shown)) console.log(`${m.from === 'customer' ? '👤' : '🤖'} ${m.text}${m.buttons ? ` [${m.buttons.map((b: any) => b.label).join(' | ')}]` : ''}`);
    shown = view.messages.length;
  };
  console.log(`demo ${view.id}: ${view.business.name}, ${view.bookings.length} invented bookings`);
  view = await call('demoSend', { id: view.id, text: 'Здравствуйте! Есть завтра время на маникюр после обеда?' });
  show();
  view = await call('demoSend', { id: view.id, button: 'consent_yes' });
  show();
  view = await call('demoSend', { id: view.id, text: 'Давайте первое из предложенных, меня зовут Алия' });
  show();
  const mine = view.bookings.filter((b: any) => b.source === 'bot');
  console.log(`bookings made: ${JSON.stringify(mine.map((b: any) => `${b.date} ${b.start} ${b.serviceId}`))}`);
  if (mine[0]) {
    view = await call('demoOwner', { id: view.id, action: 'remind', ref: mine[0].id });
    show();
  }
  view = await call('demoOwner', { id: view.id, action: 'get' });
  console.log(`get ok, ${view.messages.length} messages, alerts ${view.alerts.length}`);
  // Another visitor can't open this demo
  const other = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: REFERER }, body: JSON.stringify({ returnSecureToken: true }) });
  const otherToken = ((await other.json()) as { idToken: string }).idToken;
  const peek = await fetch(`${BASE}/demoOwner`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` }, body: JSON.stringify({ data: { id: view.id, action: 'get' } }) });
  console.log(`another visitor reading it: HTTP ${peek.status} ${JSON.stringify(((await peek.json()) as any).error?.status ?? '')}`);
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
