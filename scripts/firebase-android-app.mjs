/**
 * Registers an Android package in the Firebase project (if it isn't yet) and prints its
 * google-services.json, which the Android build needs for push messages. Run by play.yml
 * ("[play] firebase") with the github-deploy service account:
 *
 *   node scripts/firebase-android-app.mjs <package name>
 */
const PROJECT = process.env.FIREBASE_PROJECT_ID || 'kerek-9d153';
const API = 'https://firebase.googleapis.com/v1beta1';
const token = process.env.GCP_TOKEN;
const pkg = process.argv[2];
if (!token || !pkg) throw new Error('usage: GCP_TOKEN=… node scripts/firebase-android-app.mjs <package name>');

async function call(method, url, json) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(API, '')} → ${res.status}\n${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

const { apps = [] } = await call('GET', `${API}/projects/${PROJECT}/androidApps?pageSize=100`);
let app = apps.find((a) => a.packageName === pkg);
if (app) {
  console.log(`Firebase'de zaten var: ${pkg} (${app.appId})`);
} else {
  let op = await call('POST', `${API}/projects/${PROJECT}/androidApps`, { packageName: pkg, displayName: 'KEREK' });
  for (let i = 0; !op.done && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    op = await call('GET', `${API}/${op.name}`);
  }
  if (op.error) throw new Error(`Firebase app not created: ${JSON.stringify(op.error)}`);
  if (!op.done) throw new Error('Firebase app creation did not finish in time');
  app = op.response;
  console.log(`Firebase'e eklendi: ${pkg} (${app.appId})`);
}
const config = await call('GET', `${API}/projects/${PROJECT}/androidApps/${app.appId}/config`);
console.log('----- google-services.json -----');
console.log(Buffer.from(config.configFileContents, 'base64').toString('utf8'));
console.log('----- end -----');
