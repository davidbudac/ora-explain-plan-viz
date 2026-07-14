import { describe, it, expect } from 'vitest';
import { buildBaselineScript, baselineScriptFilename } from '../baselineScript';
import type { BaselineScriptOptions } from '../baselineScript';

const base: BaselineScriptOptions = {
  sqlId: 'an05rsj1up1k5',
  planHash: '3001234567',
  source: 'cursor_cache',
  fixed: false,
  enabled: true,
};

describe('buildBaselineScript', () => {
  it('cursor_cache: contains LOAD_PLANS_FROM_CURSOR_CACHE stamped with sql_id/plan hash, no ACCEPT prompts', () => {
    const script = buildBaselineScript(base);
    expect(script).toContain('DBMS_SPM.LOAD_PLANS_FROM_CURSOR_CACHE');
    expect(script).toContain('DEFINE sql_id    = "an05rsj1up1k5"');
    expect(script).toContain('DEFINE plan_hash = "3001234567"');
    expect(script).not.toContain('ACCEPT begin_snap');
    expect(script).not.toContain('ACCEPT end_snap');
  });

  it('awr: contains LOAD_PLANS_FROM_AWR, snapshot pre-check query, and ACCEPT prompts', () => {
    const script = buildBaselineScript({ ...base, source: 'awr' });
    expect(script).toContain('DBMS_SPM.LOAD_PLANS_FROM_AWR');
    expect(script).toContain('dba_hist_sqlstat');
    expect(script).toContain('dba_hist_snapshot');
    expect(script).toContain("ACCEPT begin_snap NUMBER PROMPT 'Begin snapshot id (from the list above): '");
    expect(script).toContain("ACCEPT end_snap   NUMBER PROMPT 'End snapshot id: '");
    expect(script).toContain('Oracle 19c or newer');
  });

  it('awr_sts: contains CREATE_SQLSET / SELECT_WORKLOAD_REPOSITORY / LOAD_PLANS_FROM_SQLSET / DROP_SQLSET', () => {
    const script = buildBaselineScript({ ...base, source: 'awr_sts' });
    expect(script).toContain('DBMS_SQLTUNE.CREATE_SQLSET');
    expect(script).toContain('DBMS_SQLTUNE.SELECT_WORKLOAD_REPOSITORY');
    expect(script).toContain('DBMS_SPM.LOAD_PLANS_FROM_SQLSET');
    expect(script).toContain('DBMS_SQLTUNE.DROP_SQLSET');
    expect(script).toContain('11.2');
  });

  it('fixed/enabled flags flip the YES/NO literals', () => {
    const defaultScript = buildBaselineScript(base);
    expect(defaultScript).toContain("fixed           => 'NO'");
    expect(defaultScript).toContain("enabled         => 'YES'");

    const flipped = buildBaselineScript({ ...base, fixed: true, enabled: false });
    expect(flipped).toContain("fixed           => 'YES'");
    expect(flipped).toContain("enabled         => 'NO'");
  });

  it('flips YES/NO for the awr_sts load call too', () => {
    const script = buildBaselineScript({ ...base, source: 'awr_sts', fixed: true, enabled: false });
    expect(script).toContain("fixed        => 'YES'");
    expect(script).toContain("enabled      => 'NO'");
  });

  it('sanitize strips quotes/ampersands/newlines from inputs', () => {
    const script = buildBaselineScript({
      ...base,
      sqlId: `a"b'c&d\r\ne`,
      planHash: `1"2'3&4\r\n5`,
    });
    expect(script).toContain('DEFINE sql_id    = "abcde"');
    expect(script).toContain('DEFINE plan_hash = "12345"');
  });

  it('generates the expected filename', () => {
    expect(baselineScriptFilename(base)).toBe('create_baseline_an05rsj1up1k5_3001234567.sql');
    expect(baselineScriptFilename({ ...base, sqlId: 'ABC123' })).toBe('create_baseline_abc123_3001234567.sql');
  });

  it('includes the crib sheet management comments and PROMPT sections in all modes', () => {
    for (const source of ['cursor_cache', 'awr', 'awr_sts'] as const) {
      const script = buildBaselineScript({ ...base, source });
      expect(script).toContain('DBMS_SPM.EVOLVE_SQL_PLAN_BASELINE');
      expect(script).toContain('DBMS_SPM.ALTER_SQL_PLAN_BASELINE');
      expect(script).toContain('DBMS_SPM.DROP_SQL_PLAN_BASELINE');
      expect(script).toContain('DBMS_XPLAN.DISPLAY_SQL_PLAN_BASELINE');
      expect(script).toContain('ADMINISTER SQL MANAGEMENT OBJECT');
      expect(script).toContain('UNDEFINE sql_id');
      expect(script).toContain('UNDEFINE plan_hash');
    }
  });
});
