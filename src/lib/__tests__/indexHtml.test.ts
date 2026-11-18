import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const read = (file: string) => readFileSync(join(root, file), 'utf-8');

describe('third-party scripts', () => {
  it('index.html loads no script from another host', () => {
    const external = [...read('index.html').matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi)].map(
      (m) => m[1],
    );
    expect(external).toEqual([]);
  });

  it('only the GitHub Pages build switches page-view counting on', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(Object.keys(scripts).filter((name) => scripts[name].includes('APP_ANALYTICS'))).toEqual(['build:pages']);
    for (const file of ['Dockerfile', 'docker-compose.yml', '.github/workflows/release.yml']) {
      expect(read(file), file).not.toContain('APP_ANALYTICS');
    }
  });
});
