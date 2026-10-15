/**
 * Makes sure an Android package is registered in the Firebase project and prints one
 * google-services.json with every Android app of the project in it, which the Android build needs
 * for push messages. Run by play.yml ("[play] firebase") with the github-deploy service account,
 * which can read the project's apps; registering a new one needs Firebase console access.
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
if (!apps.some((a) => a.packageName === pkg)) {
  let op = await call('POST', `${API}/projects/${PROJECT}/androidApps`, { packageName: pkg, displayName: 'KEREK' });
  for (let i = 0; !op.done && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    op = await call('GET', `${API}/${op.name}`);
  }
  if (op.error || !op.done) throw new Error(`Firebase app not created: ${JSON.stringify(op.error || 'timeout')}`);
  apps.push(op.response);
  console.log(`Firebase'e eklendi: ${pkg}`);
}

// One file for all packages: the build picks the entry that matches its applicationId
let merged = null;
for (const app of apps) {
  const { configFileContents } = await call('GET', `${API}/projects/${PROJECT}/androidApps/${app.appId}/config`);
  const config = JSON.parse(Buffer.from(configFileContents, 'base64').toString('utf8'));
  if (!merged) merged = config;
  else merged.client.push(...config.client.filter((c) => !merged.client.some((m) => m.client_info.mobilesdk_app_id === c.client_info.mobilesdk_app_id)));
  console.log(`${app.packageName}: ${app.appId}`);
}
console.log('----- google-services.json -----');
console.log(JSON.stringify(merged, null, 2));
console.log('----- end -----');
