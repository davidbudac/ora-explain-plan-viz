import { describe, it, expect } from 'vitest';
import { sqlMonitorXmlParser } from '../sqlMonitorParser';
import { readFileSync } from 'fs';
import { join } from 'path';

function readExample(filename: string): string {
  return readFileSync(join(__dirname, '../../../examples', filename), 'utf-8');
}

const LIVE_EXAMPLES = [
  '21-sql_monitor-Star Schema Rollup.txt',
  '22-sql_monitor-Cardinality Trap (NL).txt',
  '23-sql_monitor-Window Sort Spill.txt',
  '24-sql_monitor-Recursive BOM.txt',
] as const;

describe('Live-captured SQL Monitor XML examples', () => {
  describe.each(LIVE_EXAMPLES)('%s', (filename) => {
    const raw = readExample(filename);

    it('is detected as SQL Monitor XML', () => {
      expect(sqlMonitorXmlParser.canParse(raw)).toBe(true);
    });

    it('parses successfully with more than 5 nodes', () => {
      const result = sqlMonitorXmlParser.parse(raw);
      expect(result.rootNode).not.toBeNull();
      expect(result.allNodes.length).toBeGreaterThan(5);
    });

    it('reports source as sql_monitor_xml', () => {
      const result = sqlMonitorXmlParser.parse(raw);
      expect(result.source).toBe('sql_monitor_xml');
    });

    it('has actual rows on at least one node', () => {
      const result = sqlMonitorXmlParser.parse(raw);
      expect(result.hasActualStats).toBe(true);
      const withActuals = result.allNodes.filter(
        (n) => n.actualRows !== undefined && n.actualRows !== null
      );
      expect(withActuals.length).toBeGreaterThan(0);
    });
  });

  describe('22 - Cardinality Trap (NL)', () => {
    it('shows the ORDERS full scan cardinality misestimate (32 est vs 20000 actual)', () => {
      const result = sqlMonitorXmlParser.parse(
        readExample('22-sql_monitor-Cardinality Trap (NL).txt')
      );
      const orders = result.allNodes.find(
        (n) => n.operation === 'TABLE ACCESS FULL' && n.objectName === 'ORDERS'
      );
      expect(orders).toBeDefined();
      expect(orders?.rows).toBe(32);
      expect(orders?.actualRows).toBe(20000);
    });
  });

  describe('23 - Window Sort Spill', () => {
    it('has at least one node with temp space usage', () => {
      const result = sqlMonitorXmlParser.parse(
        readExample('23-sql_monitor-Window Sort Spill.txt')
      );
      const spilling = result.allNodes.filter((n) => (n.tempUsed ?? 0) > 0);
      expect(spilling.length).toBeGreaterThan(0);
    });
  });

  describe('24 - Recursive BOM', () => {
    it('contains a RECURSIVE WITH PUMP operation', () => {
      const result = sqlMonitorXmlParser.parse(
        readExample('24-sql_monitor-Recursive BOM.txt')
      );
      const pump = result.allNodes.find((n) =>
        n.operation.includes('RECURSIVE WITH PUMP')
      );
      expect(pump).toBeDefined();
    });
  });
});
