/**
 * Stamps the canonical gather_plan_metadata.sql template into a
 * self-contained script: literal arguments instead of positional `&1..&3`
 * plumbing, and either spool-to-file or print-to-screen output. The template
 * marks the swappable regions with `-- @@GEN:<NAME>:BEGIN@@` /
 * `-- @@GEN:<NAME>:END@@` comment lines.
 */

export type GatherTarget =
  | { mode: 'sqlid'; sqlId: string; planHash?: string }
  | { mode: 'manual'; objectList: string };

export type GatherOutput = 'spool' | 'screen';

export const BUNDLE_SPOOL_FILE = 'bundle.json';
// Deliberately free of the "ORA-" prefix so error scans over a session
// transcript don't false-positive on the markers.
export const SCREEN_BEGIN_MARKER = '==== PLAN-METADATA BUNDLE BEGIN ====';
export const SCREEN_END_MARKER = '==== PLAN-METADATA BUNDLE END ====';

// Values land inside `DEFINE x = "..."` and `'&x'` PL/SQL literals; strip
// anything that could escape either context. UI validation is stricter —
// this is a backstop, not the gatekeeper.
function sanitize(value: string): string {
  return value.replace(/["'&\r\n]/g, '');
}

function replaceSection(script: string, name: string, replacement: string[]): string {
  const lines = script.split('\n');
  const begin = lines.findIndex((l) => l.trim() === `-- @@GEN:${name}:BEGIN@@`);
  const end = lines.findIndex((l) => l.trim() === `-- @@GEN:${name}:END@@`);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`Gather script template is missing the ${name} section markers`);
  }
  return [...lines.slice(0, begin), ...replacement, ...lines.slice(end + 1)].join('\n');
}

export function buildGatherScript(
  template: string,
  target: GatherTarget,
  output: GatherOutput,
): string {
  const arg1 = target.mode === 'sqlid' ? sanitize(target.sqlId) : 'LIST';
  const arg2 =
    target.mode === 'sqlid' ? sanitize(target.planHash ?? '') : sanitize(target.objectList);

  const args = [
    '-- Arguments stamped by the visualizer - no positional parameters needed.',
    `DEFINE arg1 = "${arg1}"`,
    `DEFINE arg2 = "${arg2}"`,
  ];
  const cleanup = ['UNDEFINE arg1', 'UNDEFINE arg2'];
  if (output === 'spool') {
    args.push(`DEFINE spool_target = "${BUNDLE_SPOOL_FILE}"`);
    cleanup.push('UNDEFINE spool_target');
  }

  let script = replaceSection(template, 'ARGS', args);
  script = replaceSection(script, 'CLEANUP', cleanup);

  const stripMarkers = (s: string) =>
    s
      .split('\n')
      .filter((l) => !/^-- @@GEN:\w+:(BEGIN|END)@@$/.test(l.trim()))
      .join('\n');

  if (output === 'screen') {
    script = replaceSection(script, 'OPEN', [
      'PROMPT Gathering plan metadata - the JSON bundle will print below.',
      `PROMPT ${SCREEN_BEGIN_MARKER}`,
    ]);
    script = replaceSection(script, 'CLOSE', [
      `PROMPT ${SCREEN_END_MARKER}`,
      'PROMPT Done. Copy everything between the two markers and paste it into',
      "PROMPT the visualizer's gather dialog to attach it to your plan.",
    ]);
  }

  const banner =
    output === 'screen'
      ? [
          '-- Self-contained gather script stamped by the Oracle Plan Visualizer.',
          '-- Paste this whole script into a SQL*Plus / SQLcl session connected to',
          '-- the database that ran the plan, then copy the JSON it prints back',
          '-- into the visualizer.',
        ]
      : [
          '-- Self-contained gather script stamped by the Oracle Plan Visualizer.',
          `-- No arguments needed - run it and it writes ${BUNDLE_SPOOL_FILE} to the`,
          `-- current directory:  @${downloadFilename(target)}`,
        ];
  return `${banner.join('\n')}\n${stripMarkers(script)}`;
}

export function downloadFilename(target: GatherTarget): string {
  if (target.mode === 'sqlid' && target.sqlId) {
    return `gather_plan_metadata_${sanitize(target.sqlId).toLowerCase()}.sql`;
  }
  return 'gather_plan_metadata.sql';
}
