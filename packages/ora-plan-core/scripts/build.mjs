// tsc emits ESM + d.ts into dist/. Sources import siblings as "./x.ts"; tsc rewrites those to ".js" in the
// JS output but leaves ".ts" in the declarations, so rewrite those here.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [join(root, '../../node_modules/typescript/bin/tsc'), '-p', root], { stdio: 'inherit' });

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
for (const f of walk(dist).filter((f) => f.endsWith('.d.ts'))) {
  const s = readFileSync(f, 'utf8');
  const t = s.replace(/(from\s+['"]\.{1,2}\/[^'"]*)\.ts(['"])/g, '$1.js$2');
  if (t !== s) writeFileSync(f, t);
}
