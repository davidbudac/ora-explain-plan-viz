import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const site = join(__dirname, '../../../site');
const PAGES = ['index.html', 'docs.html'];
const read = (file: string) => readFileSync(join(site, file), 'utf-8');

/**
 * Regex source matching a class name as Tailwind writes it in a selector:
 * `sm:py-1.5` -> `sm\:py-1\.5`; a comma -> `\2c ` and a leading digit -> `\3N `
 * (hex escapes; the minifier drops the trailing space when it is not needed).
 */
function selectorPattern(name: string): string {
  return [...name]
    .map((ch, i) => {
      if (i === 0 && /\d/.test(ch)) return `\\\\3${ch} ?`;
      if (/[A-Za-z0-9_-]/.test(ch)) return ch;
      if (ch === ',') return '\\\\2c ?';
      return `\\\\${ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`;
    })
    .join('');
}

/** True when `css` has a selector for the class (not just a longer class starting with it). */
const hasClassRule = (css: string, name: string) =>
  new RegExp(`\\.${selectorPattern(name)}(?![A-Za-z0-9_\\\\-])`).test(css);

describe('site/ pages', () => {
  it('load no script from another host', () => {
    for (const page of PAGES) {
      const external = [...read(page).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi)].map(
        (m) => m[1],
      );
      expect(external, page).toEqual([]);
    }
  });

  it('link the compiled stylesheet', () => {
    for (const page of PAGES) expect(read(page), page).toContain('<link rel="stylesheet" href="assets/site.css">');
  });

  it('have a CSS rule for every class they use (run `npm run build:site-css` after editing classes)', () => {
    const compiled = read('assets/site.css');
    for (const page of PAGES) {
      const html = read(page);
      // The page's own <style> blocks define its hand-written classes (.doc, .shot, ...).
      const css = compiled + [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
      const used = new Set([...html.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)));
      const missing = [...used].filter((name) => !hasClassRule(css, name)).sort();
      expect(missing, page).toEqual([]);
    }
  });
});
