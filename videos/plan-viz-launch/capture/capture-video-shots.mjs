// capture-screenshots.mjs
//
// Regenerates the marketing screenshots in site/assets/ from the running app.
//
// Usage:
//   1. Start the dev server:            npm run dev
//   2. Start headless Chrome:
//        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//          --headless=new --remote-debugging-port=9222 \
//          --user-data-dir="$TMPDIR/chrome-shots-profile" \
//          --window-size=1600,1000 about:blank &
//   3. Run:  node scripts/capture-screenshots.mjs <appBaseUrl> [cdpPort] [outDir]
//      e.g.  node scripts/capture-screenshots.mjs http://localhost:5173 9222 site/assets
//
// All shots are taken at a 1600x1000 viewport with deviceScaleFactor 2
// (3200x2000 px images) in the DARK theme. Requires Node 22+ (global WebSocket).

import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const CDP_PORT = Number(process.argv[3] || 9222);
const OUT_DIR = process.argv[4] || 'capture/assets';

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

// ------------------------------------------------------------------- helpers
let cdp;

/** Evaluate a JS expression in the page; returns the JSON value. Throws on page exception. */
async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`Page exception: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`);
  }
  return res.result.value;
}

/** Poll a boolean page expression until it's truthy. */
async function waitFor(expression, { timeout = 15000, interval = 200, label = expression } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expression)) return;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/** Navigate and wait for the React app + React Flow nodes (unless waitNodes=false). */
async function goto(url, { waitNodes = true, settle = 1200 } = {}) {
  await cdp.send('Page.navigate', { url });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('#root > *')`, { label: 'app mount' });
  if (waitNodes) {
    await waitFor(`document.querySelectorAll('.react-flow__node').length > 0`, { label: 'react-flow nodes' });
  }
  await sleep(settle); // layout animation / fitView settle
}

/**
 * Trusted click at the centre of the element returned by `elExpr` (a JS
 * expression evaluating to an Element). Uses the CDP Input domain so React
 * Flow / d3 handlers see real events.
 */
async function clickEl(elExpr, { label = elExpr, scroll = true } = {}) {
  // Never scrollIntoView React Flow nodes — it pans the canvas between the
  // rect measurement and the click, so the click lands on the wrong node.
  const box = await evaluate(`(() => {
    const el = (${elExpr});
    if (!el) return null;
    if (${scroll} && !el.closest('.react-flow')) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) throw new Error(`clickEl: element not found: ${label}`);
  const opts = { x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...opts });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...opts });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...opts });
  await sleep(150);
}

/** Page expression finding a button whose visible text matches. */
const btnByText = (text) =>
  `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} || b.textContent.trim().startsWith(${JSON.stringify(text)}))`;

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

async function screenshot(name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  const { size } = fs.statSync(file);
  console.log(`  saved ${file} (${(size / 1024).toFixed(0)} KB)`);
}

/** Assert a condition about page state before shooting; throws on failure. */
async function verify(expression, label) {
  const ok = await evaluate(expression);
  if (!ok) throw new Error(`VERIFY FAILED: ${label}`);
  console.log(`  verified: ${label}`);
}

// --------------------------------------------------------------------- shots
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  cdp = await CDP.connect(CDP_PORT);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 2,
    mobile: false,
  });

  // Force dark theme via the app's own localStorage persistence.
  await goto(`${BASE}/`, { waitNodes: false, settle: 300 });
  await evaluate(`localStorage.setItem('theme', 'dark')`);

  // ---- 0. rawplan.png — the "problem": dense, unreadable DBMS_XPLAN text
  console.log('shot 0: rawplan.png');
  await goto(`${BASE}/?example=02&view=text`, { waitNodes: false, settle: 1000 });
  await verify(`document.documentElement.classList.contains('dark')`, 'dark theme active');
  await screenshot('rawplan.png');

  // ---- 1. hero.png — Star Schema Rollup (21), tree view, nothing selected
  console.log('shot 1: hero.png');
  await goto(`${BASE}/?example=21&view=hierarchical`);
  await verify(`document.documentElement.classList.contains('dark')`, 'dark theme active');
  await verify(`document.querySelectorAll('.react-flow__node').length > 5`, 'tree rendered');
  await verify(`!document.querySelector('.react-flow__node.selected')`, 'no node selected');
  await screenshot('hero.png');

  // ---- 2. tree.png — Complex Plan (02), a mid-plan node selected w/ predicates
  console.log('shot 2: tree.png');
  await goto(`${BASE}/?example=02&view=hierarchical`);
  {
    // Try mid-plan nodes (skip root) until the detail panel shows Predicates.
    const ids = await evaluate(
      `[...document.querySelectorAll('.react-flow__node')].map(n => n.getAttribute('data-id')).filter(id => Number(id) > 0).sort((a, b) => Number(a) - Number(b))`
    );
    let picked = null;
    for (const id of ids.slice(2, 14)) {
      await clickEl(`document.querySelector('.react-flow__node[data-id="${id}"]')`, { label: `node ${id}` });
      await sleep(300);
      const hasPred = await evaluate(
        `[...document.querySelectorAll('details summary h4')].some(h => h.textContent.includes('Predicates'))`
      );
      if (hasPred) { picked = id; break; }
    }
    if (!picked) throw new Error('tree.png: no mid-plan node with predicates found');
    console.log(`  selected node ${picked}`);
    await verify(`!!document.querySelector('.react-flow__node.selected')`, 'node selected');
    await sleep(500);
  }
  await screenshot('tree.png');

  // ---- 3. hotspot.png — Cardinality Trap (22), no selection, hotspots panel
  console.log('shot 3: hotspot.png');
  await goto(`${BASE}/?example=22&view=hierarchical`);
  await verify(`!document.querySelector('.react-flow__node.selected')`, 'no node selected');
  await verify(
    `[...document.querySelectorAll('span,h4')].some(el => el.textContent.trim() === 'Hotspots')`,
    'Hotspots panel visible'
  );
  await screenshot('hotspot.png');

  // ---- 4. cardinality.png — the cardinality trap. Still on example 22 from
  // shot 3. Nodes render the E-Rows/A-Rows deviation inline as "Nx over/under";
  // prefer the join (NESTED LOOPS / HASH JOIN) with the worst blow-up — that's
  // the textbook trap (optimizer estimates ~1 row, gets tens of thousands).
  console.log('shot 4: cardinality.png');
  {
    const pick = await evaluate(`(() => {
      const parse = (t) => {
        if (/∞\\s*over/.test(t)) return 1e9;
        const m = t.match(/([\\d.]+)x\\s*(over|under)/);
        return m ? Number(m[1]) : 0;
      };
      const nodes = [...document.querySelectorAll('.react-flow__node')]
        .map(n => ({ id: n.getAttribute('data-id'), t: n.textContent, dev: parse(n.textContent) }))
        .filter(n => n.dev > 0);
      const joins = nodes.filter(n => /NESTED LOOPS|HASH JOIN|MERGE JOIN/.test(n.t));
      const pool = joins.length ? joins : nodes;
      pool.sort((a, b) => b.dev - a.dev);
      return pool[0] ? { id: pool[0].id, dev: pool[0].dev } : null;
    })()`);
    if (!pick) throw new Error('cardinality.png: no node with a cardinality mismatch badge found');
    console.log(`  worst mismatch node ${pick.id} (${pick.dev}x)`);
    await clickEl(`document.querySelector('.react-flow__node[data-id="${pick.id}"]')`, { label: `node ${pick.id}` });
    await sleep(500);
    await verify(`!!document.querySelector('.react-flow__node.selected')`, 'node selected');
    await verify(
      `[...document.querySelectorAll('*')].some(el => el.children.length === 0 && el.textContent.trim() === 'A-Rows')`,
      'A-Rows stat shown in detail panel'
    );
  }
  await screenshot('cardinality.png');

  // ---- 5. sankey.png — Sankey view
  // TODO: example 05 (Hash Join) was removed; pick a replacement sql_monitor
  // example that renders a clean, readable Sankey. Large parallel plans
  // (e.g. 18) produce oversized cramped bars at this viewport.
  console.log('shot 5: sankey.png');
  await goto(`${BASE}/?example=21&view=sankey`, { waitNodes: false });
  await waitFor(`document.querySelectorAll('svg path').length > 5`, { label: 'sankey paths' });
  await sleep(1500);
  await screenshot('sankey.png');

  // ---- 6. compare.png — Plan A = 22 (Cardinality Trap), Plan B = 21 (Star
  // Schema Rollup); both sql_monitor with actual stats -> populated dashboard.
  console.log('shot 6: compare.png');
  await goto(`${BASE}/?example=22&view=hierarchical`);
  await clickEl(btnByText('Add Plan'), { label: 'Add Plan button' });
  await sleep(400);
  // The new empty slot is active; the input panel shows a "Load Example" menu.
  await clickEl(btnByText('Load Example'), { label: 'Load Example button' });
  await sleep(300);
  await clickEl(
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Star Schema Rollup')`,
    { label: 'Star Schema Rollup menu entry' }
  );
  await waitFor(
    `[...document.querySelectorAll('[role="tab"]')].filter(t => !t.textContent.includes('(empty)')).length >= 2`,
    { label: 'two parsed plan tabs' }
  );
  // Switch to the Compare dashboard.
  await clickEl(
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Compare' && !b.disabled)`,
    { label: 'Compare view tab' }
  );
  await sleep(1200);
  await verify(
    `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Compare' && b.className.includes('bg-blue-600'))`,
    'Compare tab active'
  );
  await screenshot('compare.png');

  // ---- 7. annotations.png — Complex Plan (02), note + two highlight colors
  console.log('shot 7: annotations.png');
  await goto(`${BASE}/?example=02&view=hierarchical`);
  {
    // Pick a full-scan node that is fully visible in the viewport (clicks on
    // off-screen canvas nodes are unreliable), else any visible mid node.
    const visible = `(n => { const r = n.getBoundingClientRect(); return r.left > 370 && r.top > 190 && r.right < 1580 && r.bottom < 980; })`;
    const nodeA = `([...document.querySelectorAll('.react-flow__node')].find(n => /TABLE ACCESS/.test(n.textContent) && /FULL/.test(n.textContent) && ${visible}(n)) || [...document.querySelectorAll('.react-flow__node')].filter(${visible})[2])`;
    await clickEl(nodeA, { label: 'node A (full scan)' });
    await sleep(400);
    const nodeAId = await evaluate(`document.querySelector('.react-flow__node.selected')?.getAttribute('data-id')`);
    await setTextarea(
      `document.querySelector('textarea[placeholder="Add a note..."]')`,
      'Full scan — candidate for index on ORDER_DATE'
    );
    await sleep(700); // annotation debounce
    await clickEl(`document.querySelector('button[title^="Orange"]')`, { label: 'orange highlight chip' });
    await sleep(300);

    // Second node with a different highlight (also viewport-visible).
    await clickEl(
      `[...document.querySelectorAll('.react-flow__node')].find(n => n.getAttribute('data-id') !== ${JSON.stringify(String(nodeAId))} && /HASH JOIN|NESTED LOOPS|SORT/.test(n.textContent) && ${visible}(n))`,
      { label: 'node B (join/sort)' }
    );
    await sleep(400);
    await clickEl(`document.querySelector('button[title^="Blue"]')`, { label: 'blue highlight chip' });
    await sleep(300);

    // Re-select node A so the editor shows the note text alongside both rings.
    await clickEl(`document.querySelector('.react-flow__node[data-id="${nodeAId}"]')`, { label: 're-select node A' });
    await sleep(600);
    await verify(
      `document.querySelector('textarea[placeholder="Add a note..."]')?.value.includes('Full scan')`,
      'annotation text present in editor'
    );
    await verify(`!!document.querySelector('button[title*="Orange"][title*="remove"]')`, 'orange highlight active on node A');
  }
  await screenshot('annotations.png');

  cdp.close();
  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
