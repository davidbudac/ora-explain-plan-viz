import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { sqlMonitorXmlParser } from '../sqlMonitorParser';
import {
  normalizeObjectAlias,
  parsePlanInfo,
  planNotesFromInfo,
  parseOutlineHints,
  parseParallelInfo,
  pxSkew,
} from '../sqlMonitorXmlExtras';
import type { ParallelServer } from '../../types';

const EXAMPLES = join(__dirname, '../../../examples');
const PARALLEL_EXAMPLE = '27-sql_monitor-Partitioned Star Query.txt';

function readExample(name: string): string {
  return readFileSync(join(EXAMPLES, name), 'utf-8');
}

function toDoc(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

const xmlExamples = readdirSync(EXAMPLES).filter(
  (f) => f.includes('sql_monitor') && f.endsWith('.txt') && readExample(f).includes('<sql_monitor_report'),
);

/** Hand-written (not a capture): a minimal report with an adaptive plan and an aliased scan. */
const ADAPTIVE_XML = `<?xml version="1.0"?>
<report db_version="19.0.0.0.0">
  <sql_monitor_report version="4.0">
    <report_parameters><sql_id>abc123</sql_id></report_parameters>
    <target sql_plan_hash="111"><sql_fulltext>select 1 from dual</sql_fulltext></target>
    <stats type="monitor"><stat name="elapsed_time">1000</stat></stats>
    <plan>
      <operation name="SELECT STATEMENT" id="0" depth="0" pos="5">
        <cost>5</cost>
        <other_xml>
          <info type="adaptive_plan" note="y">yes</info>
          <info type="dynamic_sampling" note="y">4</info>
          <info type="sql_profile" note="y">PROF_1</info>
          <info type="sql_patch" note="y">PATCH_1</info>
          <info type="baseline" note="y">SQL_PLAN_abc</info>
          <info type="cardinality_feedback" note="y">yes</info>
          <info type="parse_schema"><![CDATA["APP"]]></info>
          <outline_data>
            <hint><![CDATA[FULL(@"SEL$1" "O"@"SEL$1")]]></hint>
            <hint><![CDATA[USE_NL(@"SEL$1" "I"@"SEL$1")]]></hint>
          </outline_data>
        </other_xml>
      </operation>
      <operation name="HASH JOIN" id="1" depth="1" pos="1"><card>10</card><cost>5</cost></operation>
      <operation name="TABLE ACCESS" options="FULL" id="2" depth="2" pos="1">
        <object>O</object><object_alias>&quot;O&quot;@&quot;SEL$1&quot;</object_alias><card>10</card><cost>2</cost>
      </operation>
      <operation name="NESTED LOOPS" id="3" depth="2" pos="2"><card>999999</card><cost>3</cost></operation>
    </plan>
    <plan_monitor>
      <operation id="0" name="SELECT STATEMENT" depth="0" position="0" skp="0">
        <stats type="plan_monitor"><stat name="cardinality">1</stat><stat name="starts">1</stat></stats>
      </operation>
      <operation id="1" parent_id="0" name="HASH JOIN" depth="1" position="1" skp="0">
        <stats type="plan_monitor"><stat name="cardinality">10</stat><stat name="starts">1</stat></stats>
      </operation>
      <operation id="2" parent_id="1" name="TABLE ACCESS" options="FULL" depth="2" position="1" skp="0">
        <object type="TABLE"><name>O</name></object>
        <stats type="plan_monitor"><stat name="cardinality">10</stat><stat name="starts">1</stat></stats>
      </operation>
      <operation id="3" parent_id="1" name="NESTED LOOPS" depth="2" position="2" skp="1">
        <stats type="plan_monitor"><stat name="cardinality">500000</stat><stat name="starts">77</stat></stats>
      </operation>
    </plan_monitor>
  </sql_monitor_report>
</report>`;

/** Hand-written (not a capture): one server in set 2 does most of the work. */
const SKEWED_XML = `<?xml version="1.0"?>
<report><sql_monitor_report>
  <target sql_id="x"><servers_requested>8</servers_requested><servers_allocated>4</servers_allocated></target>
  <parallel_info qc_instance_id="1" qc_session_id="1" is_cross_instance="N" dop="4" server_group_count="1" server_set_count="1">
    <sessions>
      <session inst_id="1" process_name="PX Coordinator" session_id="1" session_serial="1">
        <stats type="monitor"><stat name="elapsed_time">900000</stat></stats>
      </session>
      <session inst_id="1" process_name="p000" session_id="2" session_serial="1" server_group="1" server_set="1" server_num="1">
        <stats type="monitor"><stat name="elapsed_time">100000</stat><stat name="cpu_time">90000</stat><stat name="buffer_gets">100</stat></stats>
      </session>
      <session inst_id="1" process_name="p001" session_id="3" session_serial="1" server_group="1" server_set="1" server_num="2">
        <stats type="monitor"><stat name="elapsed_time">100000</stat><stat name="buffer_gets">100</stat></stats>
      </session>
      <session inst_id="1" process_name="p002" session_id="4" session_serial="1" server_group="1" server_set="1" server_num="3">
        <stats type="monitor"><stat name="elapsed_time">700000</stat><stat name="buffer_gets">700</stat></stats>
      </session>
      <session inst_id="1" process_name="p003" session_id="5" session_serial="1" server_group="1" server_set="1" server_num="4">
        <stats type="monitor"><stat name="elapsed_time">100000</stat></stats>
      </session>
    </sessions>
  </parallel_info>
</sql_monitor_report></report>`;

describe('adaptive plans (skp="1")', () => {
  const plan = sqlMonitorXmlParser.parse(ADAPTIVE_XML);

  it('marks skipped operations inactive and leaves the others alone', () => {
    const byId = new Map(plan.allNodes.map((n) => [n.id, n]));
    expect(byId.get(3)?.inactive).toBe(true);
    expect(byId.get(0)?.inactive).toBeUndefined();
    expect(byId.get(2)?.inactive).toBeUndefined();
  });

  it('keeps the inactive node in the tree', () => {
    expect(plan.rootNode?.children[0].children.map((c) => c.id)).toEqual([2, 3]);
  });

  it('excludes inactive nodes from maxRows / maxActualRows / maxStarts', () => {
    expect(plan.maxActualRows).toBe(10);
    expect(plan.maxStarts).toBe(1);
    expect(plan.maxRows).toBe(10);
  });

  it('never sets inactive on the bundled captures (none contains skp="1")', () => {
    for (const file of xmlExamples) {
      const parsed = sqlMonitorXmlParser.parse(readExample(file));
      expect(parsed.allNodes.some((n) => n.inactive), file).toBe(false);
    }
  });
});

describe('alias normalisation', () => {
  it('strips the double quotes', () => {
    expect(normalizeObjectAlias('"O"@"SEL$1"')).toBe('O@SEL$1');
    expect(normalizeObjectAlias('O@SEL$1')).toBe('O@SEL$1');
    expect(normalizeObjectAlias('  ')).toBeUndefined();
    expect(normalizeObjectAlias(undefined)).toBeUndefined();
  });

  it('applies to the parsed node alias', () => {
    const plan = sqlMonitorXmlParser.parse(ADAPTIVE_XML);
    expect(plan.allNodes.find((n) => n.id === 2)?.objectAlias).toBe('O@SEL$1');
  });

  it('leaves no quoted alias in any bundled XML capture', () => {
    let seen = 0;
    for (const file of xmlExamples) {
      for (const node of sqlMonitorXmlParser.parse(readExample(file)).allNodes) {
        if (node.objectAlias === undefined) continue;
        seen++;
        expect(node.objectAlias, file).not.toContain('"');
        expect(node.objectAlias, file).toMatch(/@/);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('<info> entries', () => {
  it('collects raw info types into planInfo (real capture)', () => {
    const plan = sqlMonitorXmlParser.parse(readExample(PARALLEL_EXAMPLE));
    expect(plan.planInfo).toMatchObject({
      dop: '4',
      dop_reason: 'hint',
      db_version: '19.0.0.0',
      parse_schema: '"PLANVIZ"',
      plan_hash_full: '123073720',
      plan_hash: '4218842216',
      px_in_memory: 'no',
    });
    // Repeated type keeps both distinct values
    expect(plan.planInfo?.['nodeid/pflags']).toBe('000012000001, 000011000001');
  });

  it('builds a Note-style line for dop + dop_reason without setting flags (real capture)', () => {
    const plan = sqlMonitorXmlParser.parse(readExample(PARALLEL_EXAMPLE));
    expect(plan.notes?.rawLines).toEqual(['Degree of Parallelism is 4 because of hint']);
    expect(plan.notes?.dynamicSampling).toBeUndefined();
  });

  it('yields planInfo for every bundled capture; the only Note lines are the DOP ones', () => {
    for (const file of xmlExamples) {
      const plan = sqlMonitorXmlParser.parse(readExample(file));
      expect(plan.planInfo?.db_version, file).toBe('19.0.0.0');
      // No capture carries adaptive_plan / dynamic_sampling / profile / baseline infos
      expect(plan.notes?.adaptivePlan, file).toBeUndefined();
      expect(plan.notes?.dynamicSampling, file).toBeUndefined();
      for (const line of plan.notes?.rawLines ?? []) {
        expect(line, file).toMatch(/^Degree of Parallelism is \d+ because of /);
      }
    }
  });

  it('maps the info types the Note section models (documented shape, not a capture)', () => {
    const plan = sqlMonitorXmlParser.parse(ADAPTIVE_XML);
    expect(plan.notes).toMatchObject({
      adaptivePlan: true,
      dynamicSampling: true,
      dynamicSamplingLevel: 4,
      sqlProfile: 'PROF_1',
      sqlPlanBaseline: 'SQL_PLAN_abc',
      cardinalityFeedback: true,
    });
    expect(plan.notes?.rawLines).toContain('this is an adaptive plan');
    expect(plan.notes?.rawLines).toContain('dynamic statistics used: dynamic sampling (level=4)');
    expect(plan.notes?.rawLines).toContain('SQL patch "PATCH_1" used for this statement');
    expect(plan.notes?.rawLines).toContain('SQL profile "PROF_1" used for this statement');
    expect(plan.planInfo?.parse_schema).toBe('"APP"');
  });

  it('treats an explicit "no" as absent', () => {
    expect(planNotesFromInfo({ adaptive_plan: 'no', dynamic_sampling: 'n' })).toBeUndefined();
    expect(planNotesFromInfo(undefined)).toBeUndefined();
  });

  it('returns undefined planInfo without a <plan>', () => {
    expect(parsePlanInfo(toDoc('<report/>'))).toBeUndefined();
  });
});

describe('outline hints', () => {
  it('reads the hints verbatim and in order (real capture)', () => {
    const plan = sqlMonitorXmlParser.parse(readExample(PARALLEL_EXAMPLE));
    const hints = plan.outlineHints!;
    expect(hints).toHaveLength(24);
    expect(hints[0]).toBe('IGNORE_OPTIM_EMBEDDED_HINTS');
    expect(hints[1]).toBe("OPTIMIZER_FEATURES_ENABLE('19.1.0')");
    expect(hints).toContain('FULL(@"SEL$9E43CB6E" "P"@"SEL$1")');
    expect(hints[hints.length - 1]).toBe('USE_HASH_GBY_FOR_PUSHDOWN(@"SEL$9E43CB6E")');
  });

  it('is present on every bundled capture', () => {
    for (const file of xmlExamples) {
      const hints = sqlMonitorXmlParser.parse(readExample(file)).outlineHints;
      expect(hints?.length, file).toBeGreaterThan(0);
      expect(hints![0], file).toBe('IGNORE_OPTIM_EMBEDDED_HINTS');
    }
  });

  it('decodes CDATA and is undefined when absent', () => {
    expect(parseOutlineHints(toDoc(ADAPTIVE_XML))).toEqual([
      'FULL(@"SEL$1" "O"@"SEL$1")',
      'USE_NL(@"SEL$1" "I"@"SEL$1")',
    ]);
    expect(parseOutlineHints(toDoc('<report><plan/></report>'))).toBeUndefined();
  });
});

describe('parallel servers', () => {
  it('parses the PX sessions of the real parallel capture', () => {
    const plan = sqlMonitorXmlParser.parse(readExample(PARALLEL_EXAMPLE));
    const meta = plan.monitorMetadata!;
    const servers = meta.parallelServers!;

    expect(servers).toHaveLength(9);
    expect(servers[0]).toMatchObject({
      name: 'PX Coordinator',
      isCoordinator: true,
      elapsedMs: 86.1,
      cpuMs: 8.698,
      bufferGets: 18,
    });
    expect(servers[0].set).toBeUndefined();

    const p005 = servers.find((s) => s.name === 'p005')!;
    expect(p005).toMatchObject({
      set: 2,
      group: 1,
      serverNum: 2,
      instance: 1,
      sessionId: 282,
      elapsedMs: 67.052,
      cpuMs: 31.797,
      ioWaitMs: 2.709,
      otherWaitMs: 32.306,
      bufferGets: 745,
      readReqs: 20,
      readBytes: 5677056,
    });

    expect(meta.dop).toBe(4);
    expect(meta.pxServerSets).toBe(2);
    expect(meta.pxServerGroups).toBe(1);
    // <servers_requested>/<servers_allocated> are <target> child elements in real reports
    expect(meta.pxServersRequested).toBe(8);
    expect(meta.pxServersAllocated).toBe(8);
  });

  it('computes skew per server set for the real capture', () => {
    const servers = sqlMonitorXmlParser.parse(readExample(PARALLEL_EXAMPLE)).monitorMetadata!
      .parallelServers!;
    const skew = pxSkew(servers);
    expect(skew.map((s) => s.set)).toEqual([1, 2]);
    expect(skew.every((s) => s.serverCount === 4)).toBe(true);

    // Set 1 (producers): 3576 / 2843 / 2603 / 2980 us elapsed, no buffer gets reported
    expect(skew[0].elapsed!.max).toBeCloseTo(3.576);
    expect(skew[0].elapsed!.avg).toBeCloseTo((3.576 + 2.843 + 2.603 + 2.98) / 4);
    expect(skew[0].elapsed!.ratio).toBeCloseTo(3.576 / ((3.576 + 2.843 + 2.603 + 2.98) / 4));
    expect(skew[0].bufferGets).toBeUndefined();

    // Set 2 (consumers): buffer gets 687 / 745 / 672 / 685
    expect(skew[1].bufferGets!.max).toBe(745);
    expect(skew[1].bufferGets!.avg).toBeCloseTo((687 + 745 + 672 + 685) / 4);
    expect(skew[1].bufferGets!.ratio).toBeGreaterThan(1);
    expect(skew[1].bufferGets!.ratio).toBeLessThan(1.1);
  });

  it('no other bundled capture is parallel', () => {
    for (const file of xmlExamples.filter((f) => f !== PARALLEL_EXAMPLE)) {
      expect(sqlMonitorXmlParser.parse(readExample(file)).monitorMetadata?.parallelServers, file)
        .toBeUndefined();
    }
  });

  it('flags a lopsided set and ignores the coordinator (synthetic)', () => {
    const info = parseParallelInfo(toDoc(SKEWED_XML))!;
    expect(info.servers).toHaveLength(5);
    expect(info.serversRequested).toBe(8);
    expect(info.serversAllocated).toBe(4);
    expect(info.dop).toBe(4);

    const [set1] = pxSkew(info.servers);
    expect(set1.serverCount).toBe(4);
    expect(set1.elapsed).toEqual({ max: 700, avg: 250, ratio: 2.8 });
    // p003 reported no buffer gets: counts as 0 -> (100 + 100 + 700 + 0) / 4
    expect(set1.bufferGets).toEqual({ max: 700, avg: 225, ratio: 700 / 225 });
  });

  it('handles empty input', () => {
    expect(pxSkew(undefined)).toEqual([]);
    expect(pxSkew([])).toEqual([]);
    const coordinatorOnly: ParallelServer[] = [{ name: 'PX Coordinator', isCoordinator: true }];
    expect(pxSkew(coordinatorOnly)).toEqual([]);
    expect(parseParallelInfo(toDoc('<report/>'))).toBeUndefined();
  });
});
