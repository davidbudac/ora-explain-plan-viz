import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';
import { isActiveReport, decodeActiveReport } from '../activeReport';
import { parsePlan } from '../index';
import { looksLikePlan } from '../../formats';

const FIXTURE = readFileSync(join(__dirname, 'fixtures/sql-monitor-active-19c.html'), 'utf-8');

const MINI_REPORT = `<sql_monitor_report version="4.0"><target><sql_id>abc</sql_id></target><plan><operation id="0" name="SELECT STATEMENT"/></plan></sql_monitor_report>`;

function wrap(reportTag: string, body: string): string {
  return `<html><body><script id="fxtmodel" type="text/xml">\n<!--FXTMODEL-->\n${reportTag}${body}</report>\n</script></body></html>`;
}

describe('SQL Monitor ACTIVE report', () => {
  it('detects the real 19c capture and not plain plans', () => {
    expect(isActiveReport(FIXTURE)).toBe(true);
    expect(looksLikePlan(FIXTURE)).toBe(true);
    expect(isActiveReport('<report><sql_monitor_report/></report>')).toBe(false);
    expect(isActiveReport('| Id | Operation |')).toBe(false);
  });

  it('decodes the real fixture into XML the SQL Monitor parser reads', async () => {
    const xml = await decodeActiveReport(FIXTURE);
    expect(xml).toMatch(/^<report db_version="19\.0\.0\.0\.0"/);
    expect(xml).not.toMatch(/encode=|compress=/);
    expect(xml).toContain('<report_id>');
    expect(xml).toContain('<sql_monitor_report');
    expect(isActiveReport(xml)).toBe(false);

    const plan = parsePlan(xml);
    expect(plan.source).toBe('sql_monitor_xml');
    expect(plan.sqlId).toBe('8zj3du1stjvwr');
    expect(String(plan.planHashValue)).toBe('3027739212');
    expect(plan.allNodes.length).toBeGreaterThan(0);
    expect(plan.rootNode).toBeTruthy();
  });

  it('decodes a synthetic compressed report with wrapped base64', async () => {
    const b64 = deflateSync(Buffer.from(MINI_REPORT)).toString('base64').replace(/(.{20})/g, '$1\n   ');
    const html = wrap(
      '<report db_version="19.0" encode="base64" compress="zlib">',
      `<report_id><![CDATA[/x]]></report_id>\n${b64}\n`,
    );
    const xml = await decodeActiveReport(html);
    expect(xml).toBe(`<report db_version="19.0"><report_id><![CDATA[/x]]></report_id>${MINI_REPORT}</report>`);
  });

  it('supports the uncompressed variant', async () => {
    const html = wrap('<report db_version="12.2">', MINI_REPORT);
    expect(isActiveReport(html)).toBe(true);
    const xml = await decodeActiveReport(html);
    expect(xml).toBe(`<report db_version="12.2">${MINI_REPORT}</report>`);
  });

  it('throws a clear error for corrupt or truncated payloads', async () => {
    const message = /embedded data could not be decoded/;
    const bad = wrap('<report encode="base64" compress="zlib">', '<report_id><![CDATA[/x]]></report_id>!!!not base64!!!');
    await expect(decodeActiveReport(bad)).rejects.toThrow(message);

    const notZlib = wrap('<report encode="base64" compress="zlib">', Buffer.from('hello world').toString('base64'));
    await expect(decodeActiveReport(notZlib)).rejects.toThrow(message);

    const full = deflateSync(Buffer.from(MINI_REPORT));
    const truncated = wrap(
      '<report encode="base64" compress="zlib">',
      full.subarray(0, Math.floor(full.length / 2)).toString('base64'),
    );
    await expect(decodeActiveReport(truncated)).rejects.toThrow(message);
  });
});
