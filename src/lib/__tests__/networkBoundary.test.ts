import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');

/** Every non-test source file under the given repo-relative directory. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|bench)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const FILES = [...sourceFiles('src'), ...sourceFiles('packages/ora-plan-core/src')];

/** The only modules allowed to talk to the network (see "Nothing leaves the browser" in CLAUDE.md). */
const NETWORK_MODULES = [
  'src/lib/agent/client.ts', // local DB connector
  'src/lib/ai/providers/agent.ts', // AI through the local DB connector
  'src/lib/ai/providers/anthropic.ts', // Anthropic SDK
  'src/lib/ai/providers/openaiCompat.ts', // OpenAI-compatible endpoint the user typed
];

const NETWORK_API =
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|\bnew\s+Image\s*\(|(?:from|import\()\s*['"]@anthropic-ai\/sdk/;

describe('network boundary', () => {
  it('scans a plausible number of files', () => {
    expect(FILES.length).toBeGreaterThan(150);
    for (const file of NETWORK_MODULES) expect(FILES, file).toContain(file);
  });

  it('uses network APIs only in the allow-listed modules', () => {
    const offenders = FILES.filter((file) => !NETWORK_MODULES.includes(file)).filter((file) =>
      NETWORK_API.test(readFileSync(join(root, file), 'utf-8')),
    );
    expect(offenders).toEqual([]);
  });

  it('loads third-party resources only from the font hosts', () => {
    const hosts = new Set<string>();
    for (const file of ['index.html', 'src/index.css']) {
      const text = readFileSync(join(root, file), 'utf-8');
      for (const m of text.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1].toLowerCase());
    }
    expect([...hosts].sort()).toEqual(['fonts.googleapis.com', 'fonts.gstatic.com']);
  });
});
