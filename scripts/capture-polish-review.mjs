// capture-polish-review.mjs
//
// Captures the before/after screenshot set for the UI-polish review
// (feat/ui-visual-polish). One shot (or clip) per polish item.
//
// Usage:
//   1. npm run dev  (port 5173)
//   2. "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//        --headless=new --remote-debugging-port=9223 --hide-scrollbars \
//        --user-data-dir="$TMPDIR/chrome-polish-profile" \
//        --window-size=1280,800 about:blank &
//   3. node scripts/capture-polish-review.mjs <outDir> [appBaseUrl] [cdpPort] [only]
//      e.g. node scripts/capture-polish-review.mjs /tmp/shots/before http://localhost:5173 9223

import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = process.argv[2];
const BASE = (process.argv[3] || 'http://localhost:5173').replace(/\/$/, '');
const CDP_PORT = Number(process.argv[4] || 9223);
const ONLY = process.argv[5] || null;
if (!OUT_DIR) { console.error('outDir required'); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

let VIEW_W = 1280;
let VIEW_H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
}

let cdp;

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(`evaluate failed: ${res.exceptionDetails.text} :: ${expression.slice(0, 120)}`);
  return res.result.value;
}

async function waitFor(expression, { timeout = 15000, interval = 120, label = expression } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expression)) return;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function setViewport(w, h) {
  VIEW_W = w; VIEW_H = h;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
}

async function setSettings(partial) {
  await evaluate(`(() => {
    const key = 'ora-explain-viz-settings';
    let cur = {}; try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
    localStorage.setItem(key, JSON.stringify({ ...cur, ...${JSON.stringify(partial)} }));
  })()`);
}

async function goto(url, { waitNodes = true, settle = 1400, filterPanel = true, theme = 'dark' } = {}) {
  // localStorage is only reachable from the app's origin — hop there first if needed.
  const onOrigin = await evaluate(`location.origin === ${JSON.stringify(new URL(BASE).origin)}`).catch(() => false);
  if (!onOrigin) {
    await cdp.send('Page.navigate', { url: `${BASE}/` });
    await waitFor(`document.readyState === 'complete'`, { label: 'origin hop' });
  }
  await evaluate(`localStorage.setItem('theme', ${JSON.stringify(theme)})`);
  await setSettings({ filterPanelCollapsed: !filterPanel });
  await cdp.send('Page.navigate', { url });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('#root > *')`, { label: 'app mount' });
  if (waitNodes) await waitFor(`document.querySelectorAll('.react-flow__node').length > 0`, { label: 'react-flow nodes' });
  await sleep(settle);
}

async function rectOf(elExpr) {
  return evaluate(`(() => {
    const el = (${elExpr});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  })()`);
}

async function clickEl(elExpr, { label = elExpr, settle = 300 } = {}) {
  const r = await rectOf(elExpr);
  if (!r) throw new Error(`clickEl: element not found: ${label}`);
  const opts = { x: r.cx, y: r.cy, button: 'left', pointerType: 'mouse' };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...opts });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: 1, ...opts });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', clickCount: 1, ...opts });
  await sleep(settle);
  return r;
}

const btnByText = (text) =>
  `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} || b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const btnByTitle = (title) => `document.querySelector('button[title=${JSON.stringify(title)}]')`;

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

async function screenshot(name, { clip = null, scale = 1 } = {}) {
  await sleep(250);
  const params = { format: 'png' };
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale };
  const res = await cdp.send('Page.captureScreenshot', params);
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log(`  saved ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

/** Load a second plan into slot B via the UI (Add Plan -> paste -> Parse). */
async function loadPlanB(exampleFile) {
  const text = fs.readFileSync(path.join('src/examples', exampleFile), 'utf8');
  await clickEl(btnByTitle('Add another plan to compare'), { label: 'Add Plan', settle: 500 });
  await waitFor(`!!document.querySelector('textarea')`, { label: 'plan B textarea' });
  await setTextarea(`document.querySelector('textarea')`, text);
  await sleep(300);
  await clickEl(btnByText('Parse'), { label: 'Parse (plan B)', settle: 600 });
  await waitFor(`document.querySelectorAll('.react-flow__node').length > 0`, { label: 'plan B nodes' });
  await sleep(800);
}

/** Clip rect of an element (padded, clamped to viewport). */
async function clipOf(elExpr, { pad = 4, fullWidth = false } = {}) {
  const r = await rectOf(elExpr);
  if (!r) throw new Error(`clipOf: element not found: ${elExpr}`);
  const x = fullWidth ? 0 : Math.max(0, r.x - pad);
  const w = fullWidth ? VIEW_W : Math.min(VIEW_W - x, r.w + pad * 2);
  return { x, y: Math.max(0, r.y - pad), w, h: Math.min(VIEW_H, r.h + pad * 2) };
}

const RIBBON = `(${btnByText('Tree')})?.closest('.justify-between')`;

const SHOTS = {
  // 1. Nav ribbon overflow: one plan at 1280 (Add Plan clipping) + two plans (tabs off-screen)
  async ribbon() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=hierarchical`);
    await screenshot('01a-ribbon-1plan.png', { clip: await clipOf(RIBBON, { fullWidth: true }), scale: 2 });
    await loadPlanB('21-sql_monitor-Star Schema Rollup.txt');
    await screenshot('01b-ribbon-2plans.png', { clip: await clipOf(RIBBON, { fullWidth: true }), scale: 2 });
    await screenshot('01c-ribbon-2plans-full.png');
  },

  // 2. Palette seam: header / input bar / ribbon stack, dark mode
  async seam() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=hierarchical`);
    const rib = await clipOf(RIBBON, { pad: 0 });
    await screenshot('02-chrome-seam.png', { clip: { x: 0, y: 0, w: 900, h: rib.y + rib.h + 4 }, scale: 2 });
  },

  // 3. Flame view vertical fill
  async flame() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=flame`, { waitNodes: false });
    await screenshot('03-flame.png');
    await goto(`${BASE}/?example=21&view=flame`, { waitNodes: false });
    await screenshot('03b-flame-star.png');
  },

  // 4+5. Findings list + Slowest Ops (right details rail)
  async rail() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=hierarchical`);
    const rail = `[...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('border-l') && d.className.includes('shrink-0'))`;
    await screenshot('04-findings-rail.png', { clip: await clipOf(rail, { pad: 0 }), scale: 2 });
  },

  // 6. Plan B empty-slot state
  async planb() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=hierarchical`);
    await clickEl(btnByTitle('Add another plan to compare'), { label: 'Add Plan', settle: 700 });
    await screenshot('06-planb-empty.png');
  },

  // 7. Sankey labels
  async sankey() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=sankey`, { waitNodes: false });
    await screenshot('07-sankey.png');
  },

  // 8. Compare header delta chip
  async compare() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=hierarchical`);
    await loadPlanB('21-sql_monitor-Star Schema Rollup.txt');
    await clickEl(btnByText('Compare'), { label: 'Compare tab', settle: 900 });
    const rib = await clipOf(RIBBON, { pad: 0 });
    await screenshot('08-compare-header.png', { clip: { x: 0, y: rib.y + rib.h, w: 1280, h: 120 }, scale: 2 });
    await screenshot('08b-compare-full.png');
  },

  // 9. Tree view-switch ghost frame (timing-sensitive: shoot right after switching)
  async ghost() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=tabular`, { waitNodes: false });
    const r = await rectOf(btnByText('Tree'));
    const opts = { x: r.cx, y: r.cy, button: 'left', pointerType: 'mouse' };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: 1, ...opts });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', clickCount: 1, ...opts });
    await sleep(160);
    await screenshot('09-tree-switch-160ms.png');
    await sleep(2000);
    await screenshot('09b-tree-switch-settled.png');
  },

  // 10. Command palette rows
  async palette() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=hierarchical`);
    await clickEl(btnByTitle('Command palette — search every action and setting'), { label: 'palette button', settle: 400 });
    await waitFor(`!!document.querySelector('input[placeholder="Type a command..."]')`, { label: 'palette open' });
    const dialog = `(() => { const i = document.querySelector('input[placeholder="Type a command..."]'); let e = i; while (e && !/rounded/.test(e.className || '')) e = e.parentElement; return e || i.parentElement.parentElement; })()`;
    await screenshot('10-command-palette.png', { clip: await clipOf(dialog, { pad: 8 }), scale: 2 });
  },

  // 11. Tabular right edge under the details rail
  async tabular() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=tabular`, { waitNodes: false });
    await screenshot('11-tabular.png');
  },

  // Bonus: light-mode overall (palette sweep regression check)
  async light() {
    await setViewport(1280, 800);
    await goto(`${BASE}/?example=22&view=hierarchical`, { theme: 'light' });
    await screenshot('12-light-tree.png');
    const rib = await clipOf(RIBBON, { pad: 0 });
    await screenshot('12b-light-seam.png', { clip: { x: 0, y: 0, w: 900, h: rib.y + rib.h + 4 }, scale: 2 });
  },
};

cdp = await CDP.connect(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await setViewport(VIEW_W, VIEW_H);

for (const [name, fn] of Object.entries(SHOTS)) {
  if (ONLY && name !== ONLY) continue;
  console.log(`shot: ${name}`);
  try {
    await fn();
  } catch (err) {
    console.error(`  FAILED ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}
console.log('done');
process.exit(process.exitCode || 0);
