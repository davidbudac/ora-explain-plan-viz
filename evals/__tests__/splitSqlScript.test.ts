import { describe, expect, it } from 'vitest';
import { splitSqlScript } from '../lib/db';

describe('splitSqlScript', () => {
  it('splits ;-terminated SQL statements and strips the terminator', () => {
    const { statements, skipped } = splitSqlScript(
      'CREATE TABLE eval_t (id NUMBER);\nINSERT INTO eval_t VALUES (1);\n',
    );
    expect(statements).toEqual(['CREATE TABLE eval_t (id NUMBER)', 'INSERT INTO eval_t VALUES (1)']);
    expect(skipped).toEqual([]);
  });

  it('handles multi-line SQL statements', () => {
    const { statements } = splitSqlScript(
      'INSERT INTO eval_t (a, b)\nSELECT level, MOD(level, 5)\nFROM dual CONNECT BY level <= 10;',
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('CONNECT BY level <= 10');
    expect(statements[0].endsWith(';')).toBe(false);
  });

  it('keeps internal semicolons in PL/SQL blocks terminated by /', () => {
    const script = [
      'BEGIN',
      "  DBMS_STATS.GATHER_TABLE_STATS(USER, 'EVAL_T');",
      '  NULL;',
      'END;',
      '/',
    ].join('\n');
    const { statements } = splitSqlScript(script);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("GATHER_TABLE_STATS(USER, 'EVAL_T');");
    expect(statements[0].trim().endsWith('END;')).toBe(true);
  });

  it('handles DECLARE blocks', () => {
    const script = 'DECLARE\n  n NUMBER;\nBEGIN\n  n := 1;\nEND;\n/\nSELECT 1 FROM dual;';
    const { statements } = splitSqlScript(script);
    expect(statements).toHaveLength(2);
    expect(statements[0].startsWith('DECLARE')).toBe(true);
    expect(statements[1]).toBe('SELECT 1 FROM dual');
  });

  it('skips SQL*Plus-only lines and records them', () => {
    const script = [
      'SET ECHO OFF',
      'WHENEVER SQLERROR EXIT FAILURE',
      'PROMPT === Object DDL ===',
      'DEFINE schema = SCOTT',
      'VARIABLE b1 NUMBER',
      'EXEC :b1 := 42',
      'CREATE TABLE eval_t (id NUMBER);',
    ].join('\n');
    const { statements, skipped } = splitSqlScript(script);
    expect(statements).toEqual(['CREATE TABLE eval_t (id NUMBER)']);
    expect(skipped).toHaveLength(6);
    expect(skipped[0]).toBe('SET ECHO OFF');
    expect(skipped).toContain('WHENEVER SQLERROR EXIT FAILURE');
    expect(skipped).toContain('EXEC :b1 := 42');
  });

  it('drops full-line comments and blank lines', () => {
    const { statements } = splitSqlScript(
      '-- header comment\n\nSELECT 1 FROM dual;\n-- trailing comment\n',
    );
    expect(statements).toEqual(['SELECT 1 FROM dual']);
  });

  it('ignores a re-execute slash after a ;-terminated statement', () => {
    const { statements } = splitSqlScript('SELECT 1 FROM dual;\n/\n');
    expect(statements).toEqual(['SELECT 1 FROM dual']);
  });

  it('keeps an unterminated trailing statement', () => {
    const { statements } = splitSqlScript('SELECT 1 FROM dual');
    expect(statements).toEqual(['SELECT 1 FROM dual']);
  });

  it('does not treat semicolons inside a PL/SQL block as terminators', () => {
    const script = 'BEGIN\n  a; b; c;\nEND;\n/';
    const { statements } = splitSqlScript(script);
    expect(statements).toHaveLength(1);
  });

  it('splits the shape of a generated test-case script', () => {
    const script = [
      'PROMPT === Optimizer statistics ===',
      '',
      'BEGIN',
      "  DBMS_STATS.SET_TABLE_STATS(ownname => USER, tabname => 'EVAL_T',",
      '    numrows => 100, numblks => 5, avgrlen => 20);',
      'END;',
      '/',
      '',
      'CREATE INDEX eval_t_ix ON eval_t (id);',
    ].join('\n');
    const { statements, skipped } = splitSqlScript(script);
    expect(statements).toHaveLength(2);
    expect(skipped).toEqual(['PROMPT === Optimizer statistics ===']);
  });
});
