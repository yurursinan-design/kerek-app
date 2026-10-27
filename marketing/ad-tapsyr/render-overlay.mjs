/**
 * Renders overlay.html frame by frame as transparent PNGs, for edit.py to lay over the footage.
 *
 *   node render-overlay.mjs <lang> <outDir> <fps> '<timeline json>' [t1,t2,...]
 *
 * PLAYWRIGHT_PATH may point at a playwright package and CHROMIUM_PATH at a Chromium binary
 * (the repo itself doesn't depend on Playwright). With a list of times, only those frames are
 * written (as still-<t>.png), to check the look.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const [lang, outDir, fps, tlJson, only] = process.argv.slice(2);
const tl = JSON.parse(tlJson);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.addInitScript((t) => { window.TL = t; }, tl);
await page.goto(`${pathToFileURL(path.join(here, 'overlay.html')).href}?lang=${lang}`, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
});

const times = only ? only.split(',').map(Number) : null;
const frames = times ? times.length : Math.round(tl.duration * Number(fps));
for (let i = 0; i < frames; i++) {
  const t = times ? times[i] : i / Number(fps);
  await page.evaluate((s) => window.seek(s), t);
  const name = times ? `still-${t}.png` : `f${String(i).padStart(4, '0')}.png`;
  await page.screenshot({ path: path.join(outDir, name), omitBackground: true });
}
await browser.close();
console.log(`${frames} frames (${lang})`);
