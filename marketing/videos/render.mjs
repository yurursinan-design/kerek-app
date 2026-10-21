/**
 * Renders the Tapsyr social videos frame by frame (Chromium via Playwright, then ffmpeg) into
 * 1080×1920 MP4s, 30 fps, without sound (music is added in Instagram/TikTok).
 *
 *   node marketing/videos/render.mjs [outDir] [name-filter]
 *   node marketing/videos/render.mjs --stills outDir 1,5,9   (JPG frames at those seconds, to check)
 *
 * PLAYWRIGHT_PATH may point at a playwright package (the repo itself doesn't depend on it);
 * CHROMIUM_PATH at a Chromium binary.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const VIDEOS = (process.env.VIDEOS ?? 'a-request,b-masters,c-categories').split(',');
const LANGS = ['kz', 'ru'];

const args = process.argv.slice(2);
const stills = args[0] === '--stills';
if (stills) args.shift();
const outDir = path.resolve(args[0] ?? path.join(here, 'out'));
const filter = stills ? '' : (args[1] ?? '');
const stillTimes = stills ? (args[1] ?? '1').split(',').map(Number) : [];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function open(name, lang) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(`${pathToFileURL(path.join(here, `${name}.html`)).href}?lang=${lang}`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
  });
  return page;
}

for (const name of VIDEOS.filter((v) => v.includes(filter))) {
  for (const lang of LANGS) {
    const page = await open(name, lang);
    if (stills) {
      for (const t of stillTimes) {
        await page.evaluate((s) => window.seek(s), t);
        await page.screenshot({ path: path.join(outDir, `${name}-${lang}-${t}.jpg`), type: 'jpeg', quality: 80 });
      }
      await page.close();
      continue;
    }
    const duration = await page.evaluate(() => window.DURATION);
    const out = path.join(outDir, `tapsyr-${name}-${lang}.mp4`);
    const ff = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-r', String(FPS), '-movflags', '+faststart', out],
      { stdio: ['pipe', 'ignore', 'inherit'] },
    );
    const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`)))));
    const frames = Math.round(duration * FPS);
    for (let i = 0; i < frames; i++) {
      await page.evaluate((s) => window.seek(s), i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
    await page.close();
    console.log(`${out} (${duration} s)`);
  }
}
await browser.close();
