// capture-showcase.mjs
//
// Regenerates the README / landing-page showcase media in site/assets/:
// animated GIF walkthroughs (*.gif) plus the static screenshots (*.png).
//
// Usage:
//   1. Start the dev server:            npm run dev
//   2. Start headless Chrome:
//        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//          --headless=new --remote-debugging-port=9222 --hide-scrollbars \
//          --user-data-dir="$TMPDIR/chrome-shots-profile" \
//          --window-size=1280,800 about:blank &
//   3. Run:  node scripts/capture-showcase.mjs [appBaseUrl] [cdpPort] [outDir] [only]
//      e.g.  node scripts/capture-showcase.mjs http://localhost:5173 9222 site/assets
//            node scripts/capture-showcase.mjs http://localhost:5173 9222 site/assets flame
//
// GIFs are recorded at a 1280x800 viewport (dark theme) with a synthetic
// cursor overlay, then encoded with ffmpeg (palettegen/paletteuse, 1000px
// wide). Static PNGs are captured at deviceScaleFactor 2. Requires Node 22+
// and ffmpeg on PATH.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const CDP_PORT = Number(process.argv[3] || 9222);
const OUT_DIR = process.argv[4] || 'site/assets';
const ONLY = process.argv[5] || null;

let VIEW_W = 1280;
let VIEW_H = 800;
const GIF_WIDTH = 1000;
const GIF_FPS = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP client
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
        else resolve(msg.result);
      }
    });
  }

  static async connect(port) {
    let page;
    try {
      page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    } catch {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = list.find((t) => t.type === 'page');
    }
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target found');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

let cdp;

// ------------------------------------------------------------------- helpers
async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error(`Page exception: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`);
  }
  return res.result.value;
}

async function waitFor(expression, { timeout = 15000, interval = 150, label = expression } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expression)) return;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function verify(expression, label) {
  if (!(await evaluate(expression))) throw new Error(`VERIFY FAILED: ${label}`);
  console.log(`  verified: ${label}`);
}

async function setScale(deviceScaleFactor) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor, mobile: false });
}

/** Change the viewport for the next shots (the tabs bar needs ≥1440px for two plans). */
async function setViewport(w, h) {
  VIEW_W = w; VIEW_H = h;
  await setScale(1);
}

// ------------------------------------------------------------ cursor overlay
// A fake pointer drawn into the page so GIF viewers can follow the clicks.
const CURSOR_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='30' viewBox='0 0 22 30'>` +
  `<path d='M2 2 L2 24 L8 18 L12 28 L16 26 L12 16.5 L20 16.5 Z' fill='white' stroke='black' stroke-width='1.6' stroke-linejoin='round'/></svg>`;

async function installCursor() {
  await evaluate(`(() => {
    if (document.getElementById('__shot_cursor')) return;
    const c = document.createElement('div');
    c.id = '__shot_cursor';
    Object.assign(c.style, {
      position: 'fixed', left: '0px', top: '0px', width: '22px', height: '30px', zIndex: 2147483647,
      pointerEvents: 'none', backgroundImage: "url(\\"data:image/svg+xml;utf8,${CURSOR_SVG.replace(/"/g, "'").replace(/#/g, '%23')}\\")",
      backgroundRepeat: 'no-repeat', transform: 'translate(-2px,-2px)', opacity: '0',
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))',
    });
    const r = document.createElement('div');
    r.id = '__shot_ripple';
    Object.assign(r.style, {
      position: 'fixed', left: '0px', top: '0px', width: '28px', height: '28px', borderRadius: '50%',
      border: '3px solid #f59e0b', zIndex: 2147483646, pointerEvents: 'none', opacity: '0',
      transform: 'translate(-50%,-50%)', boxSizing: 'border-box',
    });
    document.body.appendChild(c);
    document.body.appendChild(r);
    window.__cursorPos = { x: 0, y: 0 };
  })()`);
}

async function cursorAt(x, y, { show = true } = {}) {
  await evaluate(`(() => {
    const c = document.getElementById('__shot_cursor'); if (!c) return;
    c.style.left = '${x}px'; c.style.top = '${y}px'; c.style.opacity = '${show ? 1 : 0}';
    window.__cursorPos = { x: ${x}, y: ${y} };
  })()`);
}

async function ripple(x, y) {
  await evaluate(`(() => {
    const r = document.getElementById('__shot_ripple'); if (!r) return;
    r.style.left = '${x}px'; r.style.top = '${y}px';
    r.style.transition = 'none'; r.style.opacity = '0.9'; r.style.width = '10px'; r.style.height = '10px';
    void r.offsetWidth;
    r.style.transition = 'all 420ms ease-out'; r.style.opacity = '0'; r.style.width = '44px'; r.style.height = '44px';
  })()`);
}

/** Smoothly move the fake cursor from its current position to (x, y). */
async function moveCursor(x, y, { duration = 450 } = {}) {
  const from = (await evaluate(`window.__cursorPos || null`)) || { x: VIEW_W / 2, y: VIEW_H / 2 };
  const steps = Math.max(4, Math.round(duration / 40));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out
    await cursorAt(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e });
    await sleep(40);
  }
}

async function rectOf(elExpr) {
  return evaluate(`(() => {
    const el = (${elExpr});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
}

/** Trusted click at (x, y), with cursor travel + ripple. */
async function clickAt(x, y, { clickCount = 1, move = true, modifiers = 0, settle = 250 } = {}) {
  if (move) await moveCursor(x, y);
  await ripple(x, y);
  const opts = { x, y, button: 'left', pointerType: 'mouse', modifiers };
  for (let i = 1; i <= clickCount; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: i, ...opts });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', clickCount: i, ...opts });
    if (clickCount > 1) await sleep(60);
  }
  await sleep(settle);
}

async function clickEl(elExpr, { label = elExpr, ...opts } = {}) {
  const r = await rectOf(elExpr);
  if (!r) throw new Error(`clickEl: element not found: ${label}`);
  await clickAt(r.cx, r.cy, opts);
  return r;
}

const btnByText = (text) =>
  `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} || b.textContent.trim().startsWith(${JSON.stringify(text)}))`;

async function typeText(text, { delay = 28 } = {}) {
  for (const ch of text) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(delay);
  }
}

async function pressKey(key, { code, keyCode, modifiers = 0 } = {}) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code ?? key, windowsVirtualKeyCode: keyCode, modifiers });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code ?? key, windowsVirtualKeyCode: keyCode, modifiers });
}

/** Set a React-controlled textarea's value (native setter + input event). */
async function setTextarea(taExpr, text) {
  const ok = await evaluate(`(() => {
    const ta = (${taExpr});
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`setTextarea: textarea not found: ${taExpr}`);
}

/** Merge into the app's persisted settings (localStorage) before a navigation. */
async function setSettings(partial) {
  await evaluate(`(() => {
    const key = 'ora-explain-viz-settings';
    let cur = {}; try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
    localStorage.setItem(key, JSON.stringify({ ...cur, ...${JSON.stringify(partial)} }));
  })()`);
}

async function goto(url, { waitNodes = true, settle = 1200, filterPanel = false } = {}) {
  await setSettings({ filterPanelCollapsed: !filterPanel });
  await cdp.send('Page.navigate', { url });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('#root > *')`, { label: 'app mount' });
  if (waitNodes) await waitFor(`document.querySelectorAll('.react-flow__node').length > 0`, { label: 'react-flow nodes' });
  await sleep(settle);
  await installCursor();
}

// ----------------------------------------------------------------- recording
class Recorder {
  constructor(name) {
    this.name = name;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), `shot-${name}-`));
    this.frames = [];
    this.running = false;
  }

  async start() {
    this.running = true;
    this.t0 = Date.now();
    this.loop = (async () => {
      while (this.running) {
        const t = Date.now();
        const res = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
        const file = path.join(this.dir, `f${String(this.frames.length).padStart(5, '0')}.png`);
        fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
        this.frames.push({ file, t: t - this.t0 });
        const spent = Date.now() - t;
        await sleep(Math.max(0, 1000 / GIF_FPS - spent));
      }
    })();
  }

  /** Capture a single frame and hold it for `ms` (without live-recording the wait). */
  async hold(ms) {
    await sleep(ms);
  }

  async stop({ tailHold = 1500 } = {}) {
    await sleep(tailHold);
    this.running = false;
    await this.loop;
    // Resample the variable-rate capture to a fixed GIF_FPS sequence (hard links
    // to the latest captured frame at each tick) so wall-clock timing is preserved.
    const seqDir = path.join(this.dir, 'seq');
    fs.mkdirSync(seqDir);
    const total = this.frames[this.frames.length - 1].t;
    let idx = 0;
    let n = 0;
    for (let t = 0; t <= total; t += 1000 / GIF_FPS) {
      while (idx + 1 < this.frames.length && this.frames[idx + 1].t <= t) idx++;
      fs.linkSync(this.frames[idx].file, path.join(seqDir, `${String(n++).padStart(6, '0')}.png`));
    }
    const out = path.join(OUT_DIR, `${this.name}.gif`);
    const vf = `scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(GIF_FPS), '-i', path.join(seqDir, '%06d.png'), '-vf', vf, '-loop', '0', out]);
    fs.rmSync(this.dir, { recursive: true, force: true });
    const { size } = fs.statSync(out);
    console.log(`  saved ${out} (${(size / 1024 / 1024).toFixed(2)} MB, ${n} frames, ${(total / 1000).toFixed(1)}s)`);
  }
}

async function screenshot(name) {
  await cursorAt(-100, -100, { show: false });
  await setScale(2);
  await sleep(400);
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await setScale(1);
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  const { size } = fs.statSync(file);
  console.log(`  saved ${file} (${(size / 1024).toFixed(0)} KB)`);
}

// ------------------------------------------------------------------ page ops
const NODE = (id) => `document.querySelector('.react-flow__node[data-id="${id}"]')`;
const VISIBLE_NODE_FILTER = `(n => { const r = n.getBoundingClientRect(); return r.left > 60 && r.top > 200 && r.right < 960 && r.bottom < 780; })`;

async function visibleNodeIds() {
  return evaluate(`[...document.querySelectorAll('.react-flow__node')].filter(${VISIBLE_NODE_FILTER}).map(n => n.getAttribute('data-id'))`);
}

async function detailsByTitle(title) {
  return `[...document.querySelectorAll('details')].find(d => d.querySelector('summary h4')?.textContent.trim() === ${JSON.stringify(title)})`;
}

async function openAccordion(title) {
  const sel = await detailsByTitle(title);
  const r = await rectOf(`${sel}?.querySelector('summary')`);
  if (!r) throw new Error(`accordion not found: ${title}`);
  const isOpen = await evaluate(`${sel}?.open`);
  if (!isOpen) await clickAt(r.cx, r.cy);
  return sel;
}

// --------------------------------------------------------------------- shots
const SHOTS = {
  // 1. Paste → parse → explore the tree, open a node's details
  async explore() {
    await goto(`${BASE}/`, { waitNodes: false, settle: 600 });
    const planText = fs.readFileSync(path.join('src/examples', '22-sql_monitor-Cardinality Trap (NL).txt'), 'utf8');
    const rec = new Recorder('explore');
    await rec.start();
    await sleep(600);
    const ta = await rectOf(`document.querySelector('textarea')`);
    await clickAt(ta.x + 200, ta.y + 60);
    await sleep(200);
    await setTextarea(`document.querySelector('textarea')`, planText);
    await sleep(900);
    await clickEl(btnByText('Parse'), { label: 'Parse button' });
    await waitFor(`document.querySelectorAll('.react-flow__node').length > 0`, { label: 'tree' });
    await sleep(1800);
    // Click a mid-plan node with predicates.
    const ids = await visibleNodeIds();
    let picked = null;
    for (const id of ids.filter((id) => Number(id) > 1)) {
      await clickEl(NODE(id), { label: `node ${id}` });
      await sleep(350);
      if (await evaluate(`[...document.querySelectorAll('details summary h4')].some(h => h.textContent.includes('Predicates'))`)) { picked = id; break; }
    }
    if (!picked) throw new Error('explore: no node with predicates');
    await sleep(1500);
    // Arrow-key navigation: parent, then sibling.
    await pressKey('ArrowUp', { keyCode: 38 });
    await sleep(1000);
    await pressKey('ArrowRight', { keyCode: 39 });
    await sleep(1000);
    await rec.stop();
    await screenshot('tree.png');
  },

  // 2. Hotspots + cardinality mismatch drill-down
  async hotspots() {
    await goto(`${BASE}/?example=22&view=hierarchical`);
    await verify(`[...document.querySelectorAll('span,h4')].some(el => el.textContent.trim() === 'Hotspots')`, 'Hotspots panel visible');
    await screenshot('hotspot.png');
    const rec = new Recorder('hotspots');
    await rec.start();
    await sleep(900);
    // Hover the hotspot node first.
    const hot = await rectOf(`[...document.querySelectorAll('.react-flow__node')].find(n => /Hotspot/i.test(n.textContent))`);
    if (hot) { await moveCursor(hot.cx, hot.cy, { duration: 700 }); await sleep(900); }
    // Expand the first advisor finding, then jump to its node.
    const FINDING = `document.querySelector('button[title="Expand"]')`;
    await clickEl(FINDING, { label: 'expand first finding' });
    await sleep(1800);
    await clickEl(`document.querySelector('button[title="Collapse"]')?.parentElement?.querySelector('button.flex-1')`, { label: 'first finding title' });
    await sleep(2000);
    await verify(`[...document.querySelectorAll('span,h4,div')].some(el => /Cardinality mismatch/i.test(el.textContent) && el.children.length === 0)`, 'cardinality mismatch shown in detail panel');
    await screenshot('cardinality.png');
    // Back to the overview, then jump to the slowest operation.
    await pressKey('Escape', { keyCode: 27 });
    await sleep(900);
    const slowest = await detailsByTitle('Slowest Ops');
    await clickEl(`${slowest}?.querySelector('div button')`, { label: 'first slowest op' });
    await sleep(1800);
    await rec.stop();
  },

  // 3. Compare two plans (before / after)
  async compare() {
    await setViewport(1440, 800);
    await goto(`${BASE}/?example=19&view=hierarchical`);
    const rec = new Recorder('compare');
    await rec.start();
    await sleep(900);
    await clickEl(btnByText('Add Plan'), { label: 'Add Plan' });
    await sleep(600);
    await clickEl(btnByText('Load Example'), { label: 'Load Example' });
    await sleep(700);
    await clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Compare After (Hash Join)')`, { label: 'example 20 entry' });
    await waitFor(`[...document.querySelectorAll('[role="tab"]')].filter(t => !t.textContent.includes('(empty)')).length >= 2`, { label: 'two plan tabs' });
    await sleep(1500);
    // Command palette (Cmd+K) → "Split compare (dual trees)".
    await pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: 4 });
    await sleep(700);
    await typeText('split compare', { delay: 60 });
    await sleep(900);
    await pressKey('Enter', { keyCode: 13 });
    await sleep(1200);
    await pressKey('Escape', { keyCode: 27 }); // palette stays open after toggles
    await sleep(2200);
    await verify(`document.querySelectorAll('.react-flow').length >= 2`, 'two tree panes');
    await clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Compare' && !b.disabled)`, { label: 'Compare tab' });
    await sleep(2500);
    await verify(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Compare' && b.className.includes('bg-blue-600'))`, 'Compare tab active');
    await rec.stop();
    await screenshot('compare.png');
    await setViewport(1280, 800);
  },

  // 4. Flame graph: metric toggle + zoom
  async flame() {
    await setSettings({ flameMetric: 'cost' });
    await goto(`${BASE}/?example=18&view=flame`, { waitNodes: false, filterPanel: true });
    await waitFor(`document.querySelectorAll('svg rect').length > 5`, { label: 'flame rects' });
    await sleep(800);
    const rec = new Recorder('flame');
    await rec.start();
    await sleep(900);
    await clickEl(btnByText('A-Time'), { label: 'A-Time metric' });
    await sleep(1600);
    // Zoom into the widest non-root bar on row 2+ (double-click).
    const target = await evaluate(`(() => {
      const rects = [...document.querySelectorAll('svg rect.cursor-pointer')].map(r => r.getBoundingClientRect());
      const rows = [...new Set(rects.map(r => Math.round(r.y)))].sort((a, b) => a - b);
      const candidates = rects.filter(r => Math.round(r.y) >= rows[2] && r.width > 120 && r.width < rects[0].width * 0.8);
      candidates.sort((a, b) => b.width - a.width);
      const c = candidates[0]; return c ? { cx: c.x + c.width / 2, cy: c.y + c.height / 2 } : null;
    })()`);
    if (!target) throw new Error('flame: no zoom candidate');
    await clickAt(target.cx, target.cy, { clickCount: 2 });
    await sleep(2000);
    // Hover a bar to show a tooltip.
    const hover = await evaluate(`(() => {
      const rects = [...document.querySelectorAll('svg rect.cursor-pointer')].map(r => r.getBoundingClientRect()).filter(r => r.width > 80);
      const c = rects[Math.min(3, rects.length - 1)]; return c ? { cx: c.x + c.width / 2, cy: c.y + c.height / 2 } : null;
    })()`);
    if (hover) { await moveCursor(hover.cx, hover.cy); await sleep(1400); }
    // Zoom back out.
    await clickEl(btnByText('Reset zoom'), { label: 'Reset zoom' });
    await sleep(1400);
    await rec.stop();
    await screenshot('flame.png');
  },

  // 5. Sankey with metric toggle
  async sankey() {
    await goto(`${BASE}/?example=21&view=sankey`, { waitNodes: false, filterPanel: true });
    await waitFor(`document.querySelectorAll('svg path').length > 5`, { label: 'sankey paths' });
    await sleep(1000);
    await screenshot('sankey.png');
    const rec = new Recorder('sankey');
    await rec.start();
    await sleep(900);
    await clickEl(btnByText('A-Time'), { label: 'A-Time metric' });
    await sleep(1800);
    await clickEl(btnByText('Rows × Starts'), { label: 'Rows x Starts metric' });
    await sleep(1800);
    await clickEl(btnByText('Cost'), { label: 'Cost metric' });
    await sleep(1500);
    // Hover a flow link for the tooltip.
    const link = await evaluate(`(() => { const p = [...document.querySelectorAll('svg path')].map(p => p.getBoundingClientRect()).filter(r => r.width > 40 && r.height > 20).sort((a,b) => b.height - a.height)[0]; return p ? { cx: p.x + p.width / 2, cy: p.y + p.height / 2 } : null; })()`);
    if (link) { await moveCursor(link.cx, link.cy); await sleep(1400); }
    await rec.stop();
  },

  // 6. Annotate (note + highlight) and share via URL
  async annotate() {
    await goto(`${BASE}/?example=02&view=hierarchical`);
    const rec = new Recorder('annotate');
    await rec.start();
    await sleep(800);
    const nodeA = `([...document.querySelectorAll('.react-flow__node')].find(n => /TABLE ACCESS/.test(n.textContent) && /FULL/.test(n.textContent) && ${VISIBLE_NODE_FILTER}(n)) || [...document.querySelectorAll('.react-flow__node')].filter(${VISIBLE_NODE_FILTER})[2])`;
    await clickEl(nodeA, { label: 'node A (full scan)' });
    await sleep(600);
    const nodeAId = await evaluate(`document.querySelector('.react-flow__node.selected')?.getAttribute('data-id')`);
    await clickEl(`document.querySelector('textarea[placeholder="Add a note..."]')`, { label: 'note textarea' });
    await typeText('Full scan — candidate for index on ORDER_DATE');
    await sleep(800);
    await clickEl(`document.querySelector('button[title^="Orange"]')`, { label: 'orange highlight' });
    await sleep(900);
    await clickEl(
      `[...document.querySelectorAll('.react-flow__node')].find(n => n.getAttribute('data-id') !== ${JSON.stringify(String(nodeAId))} && /HASH JOIN|NESTED LOOPS|SORT/.test(n.textContent) && ${VISIBLE_NODE_FILTER}(n))`,
      { label: 'node B' }
    );
    await sleep(500);
    await clickEl(`document.querySelector('button[title^="Blue"]')`, { label: 'blue highlight' });
    await sleep(900);
    await clickEl(NODE(nodeAId), { label: 're-select node A' });
    await sleep(1200);
    await verify(`document.querySelector('textarea[placeholder="Add a note..."]')?.value.includes('Full scan')`, 'annotation text present');
    await screenshot('annotations.png');
    // Share via URL.
    await clickEl(`document.querySelector('button[title="Share plan via URL"]')`, { label: 'share button' });
    await sleep(2200);
    await rec.stop();
    await pressKey('Escape', { keyCode: 27 });
  },

  // 7. Hero screenshot (static)
  async hero() {
    await goto(`${BASE}/?example=21&view=hierarchical`, { filterPanel: true });
    await verify(`document.documentElement.classList.contains('dark')`, 'dark theme active');
    await screenshot('hero.png');
  },

  // 8. Experimental: timeline Gantt (static)
  async timeline() {
    await goto(`${BASE}/?example=23&view=hierarchical`);
    await clickEl(btnByText('Experimental'), { label: 'Experimental tab' });
    await sleep(600);
    const tl = await rectOf(btnByText('Timeline'));
    if (tl) await clickAt(tl.cx, tl.cy);
    await sleep(1500);
    await screenshot('timeline.png');
  },
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  cdp = await CDP.connect(CDP_PORT);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await setScale(1);

  // Initial navigation (plain): gives us a same-origin page so localStorage is reachable.
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('#root > *')`, { label: 'app mount' });
  await evaluate(`localStorage.setItem('theme', 'dark')`);

  const names = ONLY ? ONLY.split(',') : Object.keys(SHOTS);
  for (const name of names) {
    if (!SHOTS[name]) throw new Error(`unknown shot: ${name}`);
    console.log(`shot: ${name}`);
    await SHOTS[name]();
  }
  cdp.close();
  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
