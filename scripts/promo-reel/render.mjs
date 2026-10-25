#!/usr/bin/env node
// Renders scene.html frame by frame in headless Chrome and encodes MP4 + WebM + poster.
//
//   node scripts/promo-reel/render.mjs                 # full render → scripts/promo-reel/out/
//   node scripts/promo-reel/render.mjs --snap 1.2,5.8  # stills at the given seconds (fast check)
//
// Env: CHROME (default /usr/bin/google-chrome), FFMPEG (default ffmpeg),
//      SAMPLES (motion-blur sub-frames per frame, default 4).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const SAMPLES = Number(process.env.SAMPLES || 4);
const snapArg = process.argv.indexOf('--snap');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text()));
await page.goto(pathToFileURL(join(here, 'scene.html')).href);
await page.evaluate(() => window.ready);
const { FPS, DUR } = await page.evaluate(() => window.meta);
const canvas = await page.$('canvas');

const run = (args) => new Promise((res, rej) => {
  const p = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('close', c => c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`)));
});

if (snapArg > -1) {
  for (const s of process.argv[snapArg + 1].split(',')) {
    const fi = Math.round(Number(s) * FPS);
    await page.evaluate((f, n) => window.renderFrame(f, n), fi, SAMPLES);
    const file = join(outDir, `snap-${Number(s).toFixed(2)}.png`);
    writeFileSync(file, await canvas.screenshot({ type: 'png' }));
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

const master = join(outDir, 'promo-reel-master.mp4'), mp4 = join(outDir, 'promo-reel.mp4');
const ff = spawn(FFMPEG, [
  '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'film', '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-movflags', '+faststart', master,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`))));

const total = Math.round(FPS * DUR);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate((f, n) => window.renderFrame(f, n), i, SAMPLES);
  const png = await canvas.screenshot({ type: 'png', optimizeForSpeed: true });
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % 60 === 0) console.log(`frame ${i}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await done;

// poster: a settled end-card frame
await page.evaluate((f, n) => window.renderFrame(f, n), Math.round(14.5 * FPS), SAMPLES);
writeFileSync(join(outDir, 'promo-reel-poster.png'), await canvas.screenshot({ type: 'png' }));
await browser.close();

// the grain makes the CRF 14 master huge (~300 MB); ship a bitrate-capped copy
await run(['-y', '-i', master, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', '16M', '-bufsize', '32M', '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', mp4]);
await run(['-y', '-i', master, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', join(outDir, 'promo-reel.webm')]);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outDir}`);
