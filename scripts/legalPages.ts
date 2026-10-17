/**
 * Public pages for the privacy policy, the terms of use and account deletion (/privacy/, /terms/,
 * /delete-account/), written into the build from the same texts the app shows (src/data/legalTexts.ts).
 * Google Play asks for links to them that open without the app. Plain HTML: no script needed,
 * Kazakh first, then Russian.
 */
import type { Plugin } from 'vite';
import { getLegalDocument, LEGAL_OPERATOR, LegalDocId, LegalDocument } from '../src/data/legalTexts';

const PAGES: { id: LegalDocId; path: string; kz: string; ru: string }[] = [
  { id: 'privacy', path: 'privacy', kz: 'Құпиялылық саясаты', ru: 'Политика конфиденциальности' },
  { id: 'terms', path: 'terms', kz: 'Пайдалану шарттары', ru: 'Условия использования' },
  { id: 'deletion', path: 'delete-account', kz: 'Аккаунтты жою', ru: 'Удаление аккаунта' },
];

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function section(doc: LegalDocument, lang: 'kz' | 'ru'): string {
  const body = doc.sections
    .map((s) => `<h2>${esc(s.heading)}</h2>\n${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n')}`)
    .join('\n');
  return `<article id="${lang}" lang="${lang === 'kz' ? 'kk' : 'ru'}">
<h1>${esc(doc.title)}</h1>
<p class="muted">${esc(doc.updated)}</p>
${body}
</article>`;
}

export function renderLegalPage(id: LegalDocId): string {
  const page = PAGES.find((p) => p.id === id)!;
  const kz = getLegalDocument(id, 'kz');
  const ru = getLegalDocument(id, 'ru');
  const nav = PAGES.map((p) => `<a href="/${p.path}/"${p.id === id ? ' aria-current="page"' : ''}>${esc(p.kz)} / ${esc(p.ru)}</a>`).join('\n');
  return `<!doctype html>
<html lang="kk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tapsyr — ${esc(page.kz)} / ${esc(page.ru)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
:root{--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#0284c7}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#111a2e;--text:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--accent:#38bdf8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header,main,footer{max-width:760px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;color:var(--text);text-decoration:none}
.brand img{width:36px;height:36px;border-radius:10px}
.lang a{color:var(--accent);margin-left:12px;font-weight:600}
nav{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:14px}
nav a{color:var(--accent)}
nav a[aria-current]{color:var(--text);font-weight:700;text-decoration:none}
article{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin:16px 0}
h1{font-size:24px;line-height:1.25;margin:0 0 4px}
h2{font-size:17px;margin:22px 0 6px}
p{margin:0 0 10px;overflow-wrap:anywhere}
.muted{color:var(--muted);font-size:14px}
footer{color:var(--muted);font-size:14px}
footer a{color:var(--accent)}
</style>
</head>
<body>
<header>
<a class="brand" href="/"><img src="/icon.svg" alt="">Tapsyr</a>
<span class="lang"><a href="#kz">Қазақша</a><a href="#ru">Русский</a></span>
</header>
<main>
<nav>
${nav}
</nav>
${section(kz, 'kz')}
${section(ru, 'ru')}
</main>
<footer><a href="/">Tapsyr</a> · ${esc(LEGAL_OPERATOR.name)}, ИИН ${LEGAL_OPERATOR.iin}, ${esc(LEGAL_OPERATOR.addressRu)} · <a href="mailto:${LEGAL_OPERATOR.email}">${esc(LEGAL_OPERATOR.email)}</a> · WhatsApp <a href="https://wa.me/${LEGAL_OPERATOR.whatsapp.replace(/\D/g, '')}">${esc(LEGAL_OPERATOR.whatsapp)}</a></footer>
</body>
</html>
`;
}

/** Vite plugin: adds the pages to the production build */
export function legalPages(): Plugin {
  return {
    name: 'kerek-legal-pages',
    apply: 'build',
    generateBundle() {
      for (const p of PAGES) {
        this.emitFile({ type: 'asset', fileName: `${p.path}/index.html`, source: renderLegalPage(p.id) });
      }
    },
  };
}
