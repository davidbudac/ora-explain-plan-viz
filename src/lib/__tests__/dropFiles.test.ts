import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseAnnotatedExport,
  classifyFileText,
  planDrop,
  readFileAsText,
  readDroppedFiles,
  dragHasFiles,
} from '../dropFiles';
import type { AnnotatedPlanExport } from '../annotations';

function readExample(filename: string): string {
  return readFileSync(join(__dirname, '../../examples', filename), 'utf-8');
}

const PLAN_TEXT = readExample('01-dbms_xplan-Simple Plan.txt');
const BUNDLE_TEXT = readExample('22-sql_monitor-Cardinality Trap (NL).meta.json');

function annotatedExport(overrides: Partial<AnnotatedPlanExport> = {}): AnnotatedPlanExport {
  return {
    version: 1,
    exportedAt: '2026-09-30T10:00:00.000Z',
    rawPlanText: PLAN_TEXT,
    planSource: 'dbms_xplan',
    planHashValue: '1234567890',
    annotations: {
      nodeAnnotations: { '1': { nodeId: 1, text: 'look here', createdAt: 'x', updatedAt: 'x' } },
      nodeHighlights: { '2': { nodeId: 2, color: 'red' } },
      groups: [],
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseAnnotatedExport', () => {
  it('recognises the app\'s own "Save annotated plan" export', () => {
    const data = parseAnnotatedExport(JSON.stringify(annotatedExport(), null, 2));
    expect(data?.rawPlanText).toBe(PLAN_TEXT);
  });

  it('returns null for bundles, plan JSON arrays and garbage', () => {
    expect(parseAnnotatedExport(BUNDLE_TEXT)).toBeNull();
    expect(parseAnnotatedExport('[{"id":0,"operation":"SELECT STATEMENT"}]')).toBeNull();
    expect(parseAnnotatedExport('{broken')).toBeNull();
    expect(parseAnnotatedExport(PLAN_TEXT)).toBeNull();
  });
});

describe('classifyFileText', () => {
  it('treats a v2 export with an embedded bundle as annotated, not as a bundle', () => {
    const v2 = annotatedExport({ version: 2, metadataBundle: JSON.parse(BUNDLE_TEXT) });
    const out = classifyFileText('abc-annotated.json', JSON.stringify(v2));
    expect(out.kind).toBe('annotated');
  });

  it('classifies bundles, plans and empty files', () => {
    expect(classifyFileText('bundle.json', BUNDLE_TEXT).kind).toBe('bundle');
    expect(classifyFileText('plan.txt', PLAN_TEXT).kind).toBe('plan');
    const empty = classifyFileText('empty.txt', '  \n ');
    expect(empty).toMatchObject({ kind: 'error' });
    if (empty.kind === 'error') expect(empty.message).toMatch(/empty/);
  });

  it('explains what a foreign JSON file is not', () => {
    const out = classifyFileText('settings.json', '{"theme":"dark"}');
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      expect(out.message).toMatch(/annotated-plan export/);
      expect(out.message).toContain('settings.json');
    }
  });

  it('reports invalid JSON in a .json file', () => {
    const out = classifyFileText('broken.json', '{nope');
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.message).toMatch(/not valid JSON/);
  });
});

describe('planDrop', () => {
  it('loads the plan and auto-attaches a bundle dropped with it', () => {
    const drop = planDrop([
      { name: 'meta.json', text: BUNDLE_TEXT },
      { name: 'plan.txt', text: PLAN_TEXT },
    ]);
    expect(drop).toMatchObject({ action: 'load-plan', name: 'plan.txt', bundleName: 'meta.json', ignored: [] });
    if (drop.action === 'load-plan') expect(drop.bundleText).toBe(BUNDLE_TEXT);
  });

  it('loads only the first plan and lists the rest as ignored', () => {
    const drop = planDrop([
      { name: 'a.txt', text: PLAN_TEXT },
      { name: 'b.txt', text: PLAN_TEXT },
    ]);
    expect(drop).toMatchObject({ action: 'load-plan', name: 'a.txt', ignored: ['b.txt'] });
  });

  it('routes an annotated export through the import path', () => {
    const drop = planDrop([{ name: 'x-annotated.json', text: JSON.stringify(annotatedExport()) }]);
    expect(drop.action).toBe('import-annotated');
    if (drop.action === 'import-annotated') expect(drop.data.annotations.nodeHighlights['2'].color).toBe('red');
  });

  it('attaches a bundle dropped on its own', () => {
    expect(planDrop([{ name: 'meta.json', text: BUNDLE_TEXT }])).toMatchObject({ action: 'attach-bundle', name: 'meta.json' });
  });

  it('reports the first error when nothing is usable', () => {
    const drop = planDrop([
      { name: 'empty.txt', text: '' },
      { name: 'x.json', text: '{"a":1}' },
    ]);
    expect(drop.action).toBe('error');
    if (drop.action === 'error') expect(drop.message).toMatch(/empty/);
    expect(planDrop([])).toMatchObject({ action: 'error' });
  });
});

describe('reading files', () => {
  it('reads a File as text', async () => {
    const file = new File(['hello plan'], 'plan.txt', { type: 'text/plain' });
    await expect(readFileAsText(file)).resolves.toBe('hello plan');
  });

  it('rejects with a readable message when the reader fails', async () => {
    class FailingReader {
      result: string | null = null;
      error = new DOMException('boom', 'NotReadableError');
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsText() {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    vi.stubGlobal('FileReader', FailingReader);
    const file = new File(['x'], 'locked.txt');
    await expect(readFileAsText(file)).rejects.toThrow(/Could not read "locked.txt": boom/);

    const { files, errors } = await readDroppedFiles([file]);
    expect(files).toEqual([]);
    expect(errors[0]).toMatch(/locked\.txt/);
  });

  it('detects file drags', () => {
    expect(dragHasFiles(null)).toBe(false);
    expect(dragHasFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
    expect(dragHasFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
  });
});

describe('SQL Monitor ACTIVE (HTML) drops', () => {
  const ACTIVE_HTML = readFileSync(join(__dirname, '../parser/__tests__/fixtures/sql-monitor-active-19c.html'), 'utf-8');

  it('decodes an ACTIVE report on read and classifies it as a plan', async () => {
    const file = new File([ACTIVE_HTML], 'report.html', { type: 'text/html' });
    const { files, errors, decoded } = await readDroppedFiles([file]);
    expect(errors).toEqual([]);
    expect(decoded).toEqual(['report.html']);
    expect(files[0].text).toContain('<sql_monitor_report');
    expect(files[0].text).not.toContain('<html');

    const drop = planDrop(files);
    expect(drop.action).toBe('load-plan');
    if (drop.action === 'load-plan') expect(drop.name).toBe('report.html');
  });

  it('reports a corrupt ACTIVE report as a per-file error', async () => {
    const broken = ACTIVE_HTML.replace(/(compress="zlib">\s*<report_id>[\s\S]*?<\/report_id>\s*)[A-Za-z0-9+/]+/, '$1@@@@');
    const file = new File([broken], 'broken.html', { type: 'text/html' });
    const { files, errors } = await readDroppedFiles([file]);
    expect(files).toEqual([]);
    expect(errors[0]).toMatch(/broken\.html.*could not be decoded/);
  });
});
