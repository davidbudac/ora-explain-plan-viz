import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan } from '../index';
import { normalizePlanHash, normalizeSqlId } from '../values';

const FIXTURES = join(__dirname, 'fixtures');
const EXAMPLES = join(__dirname, '../../../examples');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8');
const example = (name: string): string => readFileSync(join(EXAMPLES, name), 'utf-8');

/** Harmless stand-ins for text that is not an id: blanks, quotes, a line break, an over-long word. */
const ODD_SQL_ID = 'not "an" id';
const LONG_WORD = 'not_a_real_sql_id_value';

describe('normalizeSqlId / normalizePlanHash', () => {
  it('keeps well-formed values (trimmed)', () => {
    expect(normalizeSqlId('7ch0an9vx5ysp')).toBe('7ch0an9vx5ysp');
    expect(normalizeSqlId('  7CH0AN9VX5YSP ')).toBe('7CH0AN9VX5YSP');
    expect(normalizeSqlId('abc123')).toBe('abc123');
    expect(normalizePlanHash(' 2341252972 ')).toBe('2341252972');
  });

  it.each([ODD_SQL_ID, LONG_WORD, "x'y", 'a;b', 'two\nlines', 'abcdefghijklmn', '', '   ', undefined, null])(
    'drops %j as a SQL_ID',
    (value) => {
      expect(normalizeSqlId(value)).toBeUndefined();
    },
  );

  it.each(['12 34', '12a', '-5', '1.5e+21', "1'--", '', undefined, null])('drops %j as a plan hash', (value) => {
    expect(normalizePlanHash(value)).toBeUndefined();
  });
});

describe('SQL_ID and plan hash from plan input', () => {
  it('DBMS_XPLAN header: keeps a real SQL_ID, drops a malformed one, plan stays intact', () => {
    const text = fixture('allstats-workarea.txt');
    const clean = parsePlan(text);
    expect(clean.sqlId).toBe('9fq3kz7w2m8ud');

    for (const odd of [`we"ird'id`, LONG_WORD]) {
      const plan = parsePlan(text.replace('9fq3kz7w2m8ud', odd));
      expect(plan.sqlId).toBeUndefined();
      expect(plan.childNumber).toBe(clean.childNumber);
      expect(plan.planHashValue).toBe(clean.planHashValue);
      expect(plan.allNodes).toHaveLength(clean.allNodes.length);
      expect(plan.warnings).toBeUndefined();
    }
  });

  it('JSON rows: keeps real values (number or string), drops malformed ones', () => {
    const rows = (sqlId: unknown, hash: unknown) =>
      JSON.stringify([
        { id: 0, operation: 'SELECT STATEMENT', sql_id: sqlId, plan_hash_value: hash },
        { id: 1, parent_id: 0, operation: 'TABLE ACCESS', options: 'FULL', object_name: 'T' },
      ]);
    const good = parsePlan(rows('7ch0an9vx5ysp', 2341252972));
    expect(good.sqlId).toBe('7ch0an9vx5ysp');
    expect(good.planHashValue).toBe('2341252972');

    const bad = parsePlan(rows(`${ODD_SQL_ID}\nsecond line`, '12 34'));
    expect(bad.sqlId).toBeUndefined();
    expect(bad.planHashValue).toBeUndefined();
    expect(bad.allNodes).toHaveLength(2);
  });

  it('CSV rows: keeps real values, drops malformed ones', () => {
    const csv = (sqlId: string, hash: string) =>
      [
        '"ID","PARENT_ID","DEPTH","OPERATION","OPTIONS","OBJECT_NAME","SQL_ID","PLAN_HASH_VALUE"',
        `0,,0,"SELECT STATEMENT",,,"${sqlId}",${hash}`,
        `1,0,1,"TABLE ACCESS","FULL","T","${sqlId}",${hash}`,
      ].join('\n');
    const good = parsePlan(csv('7ch0an9vx5ysp', '2341252972'));
    expect(good.source).toBe('csv');
    expect(good.sqlId).toBe('7ch0an9vx5ysp');
    expect(good.planHashValue).toBe('2341252972');

    const bad = parsePlan(csv('not an id', '"12 34"'));
    expect(bad.source).toBe('csv');
    expect(bad.sqlId).toBeUndefined();
    expect(bad.planHashValue).toBeUndefined();
    expect(bad.allNodes).toHaveLength(2);
  });

  it('SQL Monitor XML: keeps real values, drops malformed ones', () => {
    const xml = fixture('sql-monitor-xml-hash-join.txt');
    const clean = parsePlan(xml);
    expect(clean.sqlId).toBe('an05rsj1up1k5');
    expect(clean.planHashValue).toBe('2341252972');

    const plan = parsePlan(xml.split('an05rsj1up1k5').join('not an id').split('"2341252972"').join('"23x41"'));
    expect(plan.source).toBe('sql_monitor_xml');
    expect(plan.sqlId).toBeUndefined();
    expect(plan.planHashValue).toBeUndefined();
    expect(plan.allNodes).toHaveLength(clean.allNodes.length);
  });

  it('legacy SQL Monitor XML: drops malformed values', () => {
    const xml = (sqlId: string, hash: string) =>
      `<?xml version="1.0"?><report><sql_id>${sqlId}</sql_id><plan_hash>${hash}</plan_hash>` +
      '<operation id="0" name="SELECT STATEMENT" depth="0"/><operation id="1" name="TABLE ACCESS FULL" depth="1"/></report>';
    const good = parsePlan(xml('7ch0an9vx5ysp', '42'));
    expect(good.allNodes).toHaveLength(2);
    expect(good.sqlId).toBe('7ch0an9vx5ysp');
    expect(good.planHashValue).toBe('42');
    const bad = parsePlan(xml('not an id', '4 2'));
    expect(bad.allNodes).toHaveLength(2);
    expect(bad.sqlId).toBeUndefined();
    expect(bad.planHashValue).toBeUndefined();
  });

  it('SQL Monitor text report: drops an over-long word after "SQL ID :"', () => {
    const text = example('18-sql_monitor-Skewed Parallel (J. Lewis).txt');
    expect(parsePlan(text).sqlId).toBe('3cjg20q2vw41f');
    const plan = parsePlan(text.replace('3cjg20q2vw41f', LONG_WORD));
    expect(plan.source).toBe('sql_monitor_text');
    expect(plan.sqlId).toBeUndefined();
    expect(plan.allNodes).toHaveLength(34);
  });

  it('xbi.sql output: drops an over-long word after "sql_id="', () => {
    const text = example('13-xbi-XBI TPC-DS Query.txt');
    expect(parsePlan(text).sqlId).toBe('czxpthmzk8nnd');
    const plan = parsePlan(text.replace('sql_id=czxpthmzk8nnd', `sql_id=${LONG_WORD}`));
    expect(plan.source).toBe('xbi');
    expect(plan.sqlId).toBeUndefined();
    expect(plan.allNodes).toHaveLength(10);
  });
});
