import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parsePlan, detectFormat } from '../index';
import { decodeActiveReport } from '../activeReport';
import { describeParseFailure } from '../../formats';
import type { PlanWarning } from '../../types';

const FIXTURES = join(__dirname, 'fixtures');
const EXAMPLES = join(__dirname, '../../../examples');
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8');

const WORKAREA = read('allstats-workarea.txt');
const HASH_JOIN_XML = read('sql-monitor-xml-hash-join.txt');
const ACTIVE_HTML = read('sql-monitor-active-19c.html');
const SQL_MONITOR_TEXT = readFileSync(join(EXAMPLES, '18-sql_monitor-Skewed Parallel (J. Lewis).txt'), 'utf-8');

const codes = (warnings: PlanWarning[] | undefined): string[] => (warnings ?? []).map((w) => w.code);
const find = (warnings: PlanWarning[] | undefined, code: string): PlanWarning | undefined =>
  (warnings ?? []).find((w) => w.code === code);

/** Append one cell to every line of the plan table (header text, then filler cells). */
function appendColumn(text: string, header: string, subHeader = ''): string {
  let seenHeader = false;
  let afterHeader = 0;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*\|\s*Id\b/.test(line)) {
        seenHeader = true;
        return `${line} ${header} |`;
      }
      if (seenHeader && /^\|/.test(line)) {
        afterHeader++;
        const isSubHeader = afterHeader === 1 && !/\d/.test(line.replace(/\(.*?\)/g, ''));
        return `${line}${isSubHeader ? ` ${subHeader} |` : '    42 |'}`;
      }
      if (seenHeader && /^[-=]{10,}$/.test(line.trim())) return `${line}${line.trim()[0].repeat(header.length + 3)}`;
      return line;
    })
    .join('\n');
}

/** Wrap every line longer than `width` the way SQL*Plus does when LINESIZE is too small. */
function wrapAt(text: string, width: number): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const out: string[] = [];
      for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width));
      return out.length > 0 ? out : [''];
    })
    .join('\n');
}

describe('partial-parse warnings', () => {
  describe('plan-table columns', () => {
    it('lists an unrecognised DBMS_XPLAN column and still loads the plan', () => {
      const plan = parsePlan(appendColumn(WORKAREA, 'Cu Reads'));
      expect(plan.rootNode).toBeTruthy();
      const warning = find(plan.warnings, 'unknown_columns');
      expect(warning?.message).toContain('Cu Reads');
      expect(codes(plan.warnings)).toEqual(['unknown_columns']);
    });

    it('lists an unrecognised SQL Monitor text column (header + sub-header)', () => {
      const plan = parsePlan(appendColumn(SQL_MONITOR_TEXT, 'Shiny', '(new)'));
      expect(plan.source).toBe('sql_monitor_text');
      expect(plan.rootNode).toBeTruthy();
      expect(find(plan.warnings, 'unknown_columns')?.message).toContain('Shiny (new)');
    });

    it('does not warn for the columns the parsers deliberately skip (Cell Offload, Activity Detail)', () => {
      const plan = parsePlan(SQL_MONITOR_TEXT);
      expect(plan.warnings).toBeUndefined();
    });
  });

  describe('sections', () => {
    it('reports an unrecognised "(identified by …)" section', () => {
      const text = `${WORKAREA}\n\nFuture Section (identified by operation id):\n------------------------------------------\n\n   3 - something new\n`;
      const plan = parsePlan(text);
      const warning = find(plan.warnings, 'unread_sections');
      expect(warning?.message).toContain('Future Section');
    });

    it('reports an underlined title nobody reads, but not the known ones', () => {
      const plan = parsePlan(`${WORKAREA}\n\nBrand New Block\n--------------\n   something\n`);
      expect(find(plan.warnings, 'unread_sections')?.message).toContain('Brand New Block');
      // Predicate Information and Note are in WORKAREA and are consumed.
      expect(find(parsePlan(WORKAREA).warnings, 'unread_sections')).toBeUndefined();
    });
  });

  describe('rows and ids', () => {
    it('reports a row the row parser rejects, with the missing id', () => {
      const damaged = WORKAREA.replace(/^\|\*?\s*3 \|\s*HASH JOIN\s*/m, (m) => `${'|   3 |'}${' '.repeat(m.length - 7)}`);
      expect(damaged).not.toBe(WORKAREA);
      const plan = parsePlan(damaged);
      const warning = find(plan.warnings, 'unparsed_rows');
      expect(warning).toBeTruthy();
      expect(warning?.detail).toContain('Missing operation ids: 3');
    });

    it('reports an id gap when a row was lost from the paste', () => {
      const damaged = WORKAREA.split('\n').filter((line) => !/^\|\*?\s*5 \|/.test(line)).join('\n');
      const plan = parsePlan(damaged);
      expect(plan.allNodes.some((n) => n.id === 5)).toBe(false);
      const warning = find(plan.warnings, 'id_gaps');
      expect(warning?.message).toContain('5');
      expect(find(plan.warnings, 'unparsed_rows')).toBeUndefined();
    });

    it('reports predicates for an operation id that is not in the plan', () => {
      const plan = parsePlan(WORKAREA.replace('   3 - access(', '  99 - access(').replace(/\n$/, '') + '\n');
      expect(find(plan.warnings, 'predicate_unknown_ids')?.message).toContain('99');
    });
  });

  describe('wrong route', () => {
    it('says so when an A-Rows table without a "Plan hash value" goes to the SQL Monitor text parser', () => {
      const text = WORKAREA.replace(/^Plan hash value:.*\n/m, '');
      expect(detectFormat(text)).toBe('sql_monitor_text');
      const plan = parsePlan(text);
      const warning = find(plan.warnings, 'bare_a_rows_table');
      expect(warning?.severity).toBe('info');
      expect(warning?.message).toContain('Plan hash value');
    });

    it('flags input that matched no parser (and says what is supported)', () => {
      const plan = parsePlan('this is not a plan at all');
      expect(plan.rootNode).toBeNull();
      expect(codes(plan.warnings)).toEqual(['unrecognised_format']);
      expect(describeParseFailure('this is not a plan at all')).toContain('Supported formats');
    });

    it('explains rows pasted without their header row', () => {
      const rowsOnly = WORKAREA.split('\n').filter((line) => /^\|\*?\s*\d+ \|/.test(line)).join('\n');
      expect(describeParseFailure(rowsOnly)).toContain('no header row');
    });
  });

  describe('cut-off input', () => {
    it('detects an XML report that stops mid-document and mentions SET LONG', () => {
      const cut = HASH_JOIN_XML.slice(0, Math.floor(HASH_JOIN_XML.length / 2));
      expect(detectFormat(cut)).toBe('sql_monitor_xml');
      const plan = parsePlan(cut);
      expect(plan.rootNode).toBeNull();
      expect(find(plan.warnings, 'truncated_xml')?.message).toContain('SET LONG 100000000 LONGCHUNKSIZE 100000000');
      expect(describeParseFailure(cut)).toContain('SET LONG');
    });

    it('recognises the SQL*Plus default (LONG 80) cut-off', () => {
      const cut = HASH_JOIN_XML.slice(0, 80);
      expect(describeParseFailure(cut)).toContain('SET LONG');
    });

    it('does not blame truncation for XML that is complete but malformed', () => {
      const broken = HASH_JOIN_XML.replace('<sql_monitor_report', '<sql_monitor_report <<');
      const plan = parsePlan(broken);
      expect(plan.rootNode).toBeNull();
      expect(codes(plan.warnings)).toEqual(['xml_unparseable']);
      expect(describeParseFailure(broken)).not.toContain('SET LONG');
    });

    it('detects an ACTIVE report whose embedded payload was cut short', async () => {
      const cut = ACTIVE_HTML.slice(0, Math.floor(ACTIVE_HTML.length * 0.6));
      await expect(decodeActiveReport(cut)).rejects.toThrow(/SET LONG 100000000/);
    });

    it('still gives the generic decode error for a complete but corrupt ACTIVE report', async () => {
      const corrupt = ACTIVE_HTML.replace(/(<report_id>[\s\S]*?<\/report_id>\s*)[A-Za-z0-9+/]{40}/, '$1!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      await expect(decodeActiveReport(corrupt)).rejects.toThrow(/could not be decoded/);
    });

    it('flags a plan table that ends in the middle of a row', () => {
      const lines = WORKAREA.split('\n');
      const lastRow = lines.findIndex((line) => /^\|\*?\s*6 \|/.test(line));
      const cut = [...lines.slice(0, lastRow), lines[lastRow].slice(0, 60)].join('\n');
      const plan = parsePlan(cut);
      expect(codes(plan.warnings)).toContain('truncated_plan_table');
      expect(find(plan.warnings, 'truncated_plan_table')?.message).toContain('SET LONG');
    });
  });

  describe('SQL*Plus wrapper around XML', () => {
    const preamble = [
      "SQL> select dbms_sql_monitor.report_sql_monitor(sql_id=>'7ch0an9vx5ysp', type=>'XML') from dual;",
      '',
      "DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(SQL_ID=>'7CH0AN9VX5YSP',TYPE=>'XML')",
      '--------------------------------------------------------------------------------',
      'old   1: select &1 from dual',
      'new   1: select 1 from dual',
    ].join('\n');
    const trailer = '\n\n1 row selected.\n\nSQL> ';

    it('strips the echo and the row-count line, parses the plan, and notes it as info', () => {
      const clean = parsePlan(HASH_JOIN_XML);
      const wrapped = `${preamble}\n${HASH_JOIN_XML}${trailer}`;
      expect(detectFormat(wrapped)).toBe('sql_monitor_xml');
      const plan = parsePlan(wrapped);
      expect(plan.allNodes.length).toBe(clean.allNodes.length);
      expect(plan.sqlId).toBe(clean.sqlId);
      const warning = find(plan.warnings, 'xml_wrapper_ignored');
      expect(warning?.severity).toBe('info');
      expect(warning?.detail).toContain('before the XML');
      expect(warning?.detail).toContain('1 row selected.');
      expect(codes(plan.warnings)).toEqual(['xml_wrapper_ignored']);
    });

    it('also copes with only a trailer', () => {
      const plan = parsePlan(`${HASH_JOIN_XML}\n\n1 row selected.\n`);
      expect(plan.rootNode).toBeTruthy();
      expect(find(plan.warnings, 'xml_wrapper_ignored')?.detail).toContain('after it');
    });

    it('stays quiet for a clean report', () => {
      expect(parsePlan(HASH_JOIN_XML).warnings).toBeUndefined();
    });
  });

  describe('SQL*Plus line wrapping', () => {
    it('warns about LINESIZE when rows are split across lines', () => {
      const plan = parsePlan(wrapAt(WORKAREA, 80));
      expect(codes(plan.warnings)).toEqual(['wrapped_plan_table']);
      expect(plan.warnings?.[0].message).toContain('SET LINESIZE 300');
      expect(plan.warnings?.[0].message).toContain('TRIMSPOOL ON');
    });

    it('also explains it when nothing could be parsed', () => {
      const wrapped = wrapAt(WORKAREA, 30);
      const plan = parsePlan(wrapped);
      if (!plan.rootNode) {
        expect(describeParseFailure(wrapped)).toContain('LINESIZE');
      } else {
        expect(codes(plan.warnings)).toContain('wrapped_plan_table');
      }
    });
  });

  describe('no false alarms', () => {
    const fileNames = (dir: string): string[] =>
      readdirSync(dir).filter((name) => /\.txt$/.test(name));

    it.each(fileNames(FIXTURES))('fixture %s parses without warnings', (name) => {
      const plan = parsePlan(read(name));
      expect(plan.rootNode).toBeTruthy();
      expect(plan.warnings).toBeUndefined();
    });

    it.each(fileNames(EXAMPLES))('bundled example %s parses without warnings', (name) => {
      const plan = parsePlan(readFileSync(join(EXAMPLES, name), 'utf-8'));
      expect(plan.rootNode).toBeTruthy();
      expect(plan.warnings).toBeUndefined();
    });

    it('decoded ACTIVE report parses without warnings', async () => {
      const plan = parsePlan(await decodeActiveReport(ACTIVE_HTML));
      expect(plan.rootNode).toBeTruthy();
      expect(plan.warnings).toBeUndefined();
    });
  });
});
