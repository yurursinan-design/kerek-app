/**
 * Google Play through the Play Developer API, run by .github/workflows/play.yml with the
 * github-deploy service account (invited in Play Console with app permissions for KEREK).
 *
 *   node scripts/play.mjs check              what Play has now (nothing changes)
 *   node scripts/play.mjs listing            store texts, icon, feature graphic and screenshots from store/
 *   node scripts/play.mjs release <app.aab>  the app bundle as a draft release on closed testing
 *
 * Nothing here sends a release to users: releases stay drafts until rolled out in Play Console.
 * The service account only sees the app once its invitation is saved in Play Console (Users and
 * permissions); until then, and for a new app before its first bundle, Play answers "Package not found".
 * store/<language>/ holds title.txt, short-description.txt, full-description.txt,
 * feature-graphic.jpg and phone-screenshots/1.jpg… (in display order); store/icon.png is shared.
 */
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE = 'kerek.kz.app';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;
const STORE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'store');
const LANGUAGES = ['ru-RU', 'kk'];
const DETAILS = { defaultLanguage: 'ru-RU', contactEmail: 'support.kerek@gmail.com', contactWebsite: 'https://kerek-9d153.web.app' };
/** Closed testing ("alpha" is the closed track Play Console makes for every app) */
const TEST_TRACK = 'alpha';

const token = process.env.PLAY_TOKEN;
if (!token) throw new Error('PLAY_TOKEN is missing');

/** Turkish hints for the usual refusals, printed under the API's own message */
function hint(status, text) {
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) {
    return 'Play API bu projede kapalı: Cloud Shell satırını (androidpublisher) çalıştırın.';
  }
  if (status === 401 || status === 403) return 'Robot hesabın bu uygulamada izni yok: Play Console daveti ve izinleri kontrol edilmeli.';
  // A new app is only visible to the API after its first bundle was uploaded in Play Console
  if (status === 404) return `Play ${PACKAGE} uygulamasını henüz görmüyor: ilk paket (AAB) Play Console'dan elle yüklenmeli ("[play] bundle").`;
  return '';
}

async function call(method, url, { json, body, type } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (type) headers['Content-Type'] = type;
  const res = await fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : body });
  const text = await res.text();
  if (!res.ok) {
    const h = hint(res.status, text);
    throw new Error(`${method} ${url.replace(/^https:\/\/[^/]+/, '')} → ${res.status}\n${text.slice(0, 800)}${h ? `\n→ ${h}` : ''}`);
  }
  return text ? JSON.parse(text) : {};
}

const read = (...p) => fs.readFileSync(path.join(STORE, ...p), 'utf8').trim();
const imageType = (file) => (file.endsWith('.png') ? 'image/png' : 'image/jpeg');

async function uploadImage(edit, language, kind, file) {
  const body = fs.readFileSync(file);
  await call('POST', `${UPLOAD}/edits/${edit}/listings/${language}/${kind}?uploadType=media`, { body, type: imageType(file) });
  console.log(`  ${language} ${kind}: ${path.relative(STORE, file)}`);
}

async function check(edit) {
  const details = await call('GET', `${API}/edits/${edit}/details`);
  const listings = await call('GET', `${API}/edits/${edit}/listings`);
  const tracks = await call('GET', `${API}/edits/${edit}/tracks`);
  console.log('Bağlantı tamam.');
  console.log('Ayrıntılar:', JSON.stringify(details));
  console.log('Mağaza dilleri:', (listings.listings || []).map((l) => `${l.language} "${l.title}"`).join(', ') || '(henüz yok)');
  for (const t of tracks.tracks || []) {
    console.log(`Kanal ${t.track}:`, (t.releases || []).map((r) => `${r.name || '-'} [${r.status}] ${r.versionCodes || ''}`).join('; ') || '(boş)');
  }
}

async function listing(edit) {
  await call('PATCH', `${API}/edits/${edit}/details`, { json: DETAILS });
  console.log('Ayrıntılar:', JSON.stringify(DETAILS));
  for (const language of LANGUAGES) {
    try {
      await uploadListing(edit, language);
    } catch (err) {
      // A translation Play refuses is reported but does not hold back the default listing
      if (language === DETAILS.defaultLanguage) throw err;
      console.warn(`UYARI: ${language} yüklenemedi, diğerleri kaydediliyor.\n${err.message || err}`);
    }
  }
}

async function uploadListing(edit, language) {
  const texts = { language, title: read(language, 'title.txt'), shortDescription: read(language, 'short-description.txt'), fullDescription: read(language, 'full-description.txt') };
  await call('PUT', `${API}/edits/${edit}/listings/${language}`, { json: texts });
  console.log(`${language}: "${texts.title}" (${texts.shortDescription.length}/80, ${texts.fullDescription.length}/4000)`);
  // Replace the images instead of adding to them
  for (const kind of ['icon', 'featureGraphic', 'phoneScreenshots']) {
    await call('DELETE', `${API}/edits/${edit}/listings/${language}/${kind}`);
  }
  await uploadImage(edit, language, 'icon', path.join(STORE, 'icon.png'));
  await uploadImage(edit, language, 'featureGraphic', path.join(STORE, language, 'feature-graphic.jpg'));
  const dir = path.join(STORE, language, 'phone-screenshots');
  const shots = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  for (const f of shots) await uploadImage(edit, language, 'phoneScreenshots', path.join(dir, f));
}

async function release(edit, aab) {
  if (!aab || !fs.existsSync(aab)) throw new Error(`App bundle not found: ${aab}`);
  const bundle = await call('POST', `${UPLOAD}/edits/${edit}/bundles?uploadType=media`, { body: fs.readFileSync(aab), type: 'application/octet-stream' });
  const versionCode = String(bundle.versionCode);
  const name = `${process.env.KEREK_VERSION_NAME || '1.0'} (${versionCode})`;
  console.log(`Yüklendi: sürüm kodu ${versionCode}`);
  await call('PUT', `${API}/edits/${edit}/tracks/${TEST_TRACK}`, {
    json: {
      track: TEST_TRACK,
      releases: [{
        name,
        versionCodes: [versionCode],
        // A draft: Play Console rolls it out to testers once the app's setup is complete
        status: 'draft',
        releaseNotes: [
          { language: 'ru-RU', text: 'Тестовая версия Tapsyr. Спасибо, что помогаете!' },
          { language: 'kk', text: 'Tapsyr сынақ нұсқасы. Көмектескеніңіз үшін рақмет!' },
        ],
      }],
    },
  });
  console.log(`Kapalı test (${TEST_TRACK}) için taslak sürüm: ${name}`);
}

const [mode, arg] = process.argv.slice(2);
const actions = { check, listing, release };
if (!actions[mode]) throw new Error(`Unknown mode "${mode}" (check | listing | release)`);

const { id: edit } = await call('POST', `${API}/edits`, { json: {} });
try {
  await actions[mode](edit, arg);
  if (mode === 'check') await call('DELETE', `${API}/edits/${edit}`);
  else {
    await call('POST', `${API}/edits/${edit}:commit`);
    console.log("Play Console'a kaydedildi.");
  }
} catch (err) {
  await call('DELETE', `${API}/edits/${edit}`).catch(() => {});
  console.error(String(err.message || err));
  process.exit(1);
}
