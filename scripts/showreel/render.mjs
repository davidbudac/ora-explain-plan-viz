// render.mjs — render scene.html to an MP4 (+ WebM + poster) frame by frame.
//
// The scene is a pure function of time, so we seek it deterministically
// instead of screen-recording: every run produces the exact same file.
//
// Usage:
//   node scripts/showreel/render.mjs [outDir] [fps] [supersample]
//   node scripts/showreel/render.mjs site/assets 60 2
//
// Requires Chrome (CHROME env var, or the usual system paths) and ffmpeg
// (FFMPEG env var, or on PATH).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const OUT_DIR = path.resolve(ROOT, process.argv[2] || 'site/assets');
const FPS = Number(process.argv[3] || 60);
const SS = Number(process.argv[4] || 2);          // supersample factor
const NAME = process.env.SHOWREEL_NAME || 'showreel';

const CHROME = process.env.CHROME || [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => fs.existsSync(p));
if (!CHROME) throw new Error('No Chrome found — set CHROME=/path/to/chrome');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
if (spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).error)
  throw new Error(`ffmpeg not runnable (${FFMPEG}) — set FFMPEG=/path/to/ffmpeg`);

/* ------------------------------------------------ serve the scene folder */
const MIME = { '.html': 'text/html', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'scene.html';
  const file = path.join(HERE, rel);
  if (!file.startsWith(HERE) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

/* ------------------------------------------------------- drive the page */
const puppeteer = (await import('puppeteer-core')).default;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showreel-chrome-'));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  userDataDir,
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb',
         '--disable-lcd-text', '--font-render-hinting=none', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 270, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${PORT}/scene.html?render=1&ss=${SS}`, { waitUntil: 'networkidle0' });
await page.evaluate(() => window.__ready);
await page.evaluate(() => document.fonts.load("800 90px Inter").then(() => document.fonts.load("700 17px 'JetBrains Mono'")));

const DURATION = await page.evaluate(() => window.__DURATION);
const TOTAL = Math.round(DURATION * FPS);
fs.mkdirSync(OUT_DIR, { recursive: true });

const mp4 = path.join(OUT_DIR, `${NAME}.mp4`);
const poster = path.join(OUT_DIR, `${NAME}-poster.png`);
const posterRaw = path.join(os.tmpdir(), `${NAME}-poster-raw.png`);
const args = [
  '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
  '-vf', `scale=1920:1080:flags=lanczos,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
  '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart',
  '-r', String(FPS), mp4,
];
const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
let ffErr = '';
ff.stderr.on('data', d => { ffErr += d; if (ffErr.length > 40000) ffErr = ffErr.slice(-20000); });
const ffDone = new Promise((res, rej) =>
  ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg failed:\n' + ffErr.slice(-3000)))));

const write = (buf) => ff.stdin.write(buf) ? Promise.resolve()
  : new Promise(r => ff.stdin.once('drain', r));

console.log(`rendering ${TOTAL} frames @ ${FPS}fps, ${1920 * SS}x${1080 * SS} → 1920x1080`);
const started = Date.now();
for (let i = 0; i < TOTAL; i++) {
  const t = i / FPS;
  const b64 = await page.evaluate((tt) => {
    window.__seek(tt);
    return document.getElementById('c').toDataURL('image/png').slice(22);
  }, t);
  const buf = Buffer.from(b64, 'base64');
  await write(buf);
  if (i === Math.round(13.9 * FPS)) fs.writeFileSync(posterRaw, buf);
  if (i % 30 === 0 || i === TOTAL - 1) {
    const pct = ((i + 1) / TOTAL * 100).toFixed(0);
    const el = (Date.now() - started) / 1000;
    process.stdout.write(`\r  frame ${i + 1}/${TOTAL}  ${pct}%  ${el.toFixed(0)}s elapsed   `);
  }
}
ff.stdin.end();
await ffDone;
process.stdout.write('\n');

await browser.close();
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

/* ------------------------------------------------------- web-friendly webm */
const webm = path.join(OUT_DIR, `${NAME}.webm`);
const r = spawnSync(FFMPEG, ['-y', '-i', mp4, '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
                             '-row-mt', '1', '-cpu-used', '2', '-pix_fmt', 'yuv420p', webm],
                    { stdio: ['ignore', 'ignore', 'pipe'] });
if (r.status !== 0) console.warn('webm encode skipped:', String(r.stderr).slice(-400));

// the poster frame comes out supersampled; bring it down to 1920x1080
spawnSync(FFMPEG, ['-y', '-i', posterRaw, '-vf', 'scale=1920:1080:flags=lanczos', poster], { stdio: 'ignore' });
fs.rmSync(posterRaw, { force: true });

for (const f of [mp4, webm, poster]) {
  if (fs.existsSync(f)) console.log(`${path.relative(ROOT, f)}  ${(fs.statSync(f).size / 1048576).toFixed(2)} MB`);
}
