import { useId, useMemo, useRef, useState } from 'react';
import { buildBaselineScript, baselineScriptFilename } from '../lib/baselineScript';
import { buildSqlPatchScript, sqlPatchScriptFilename } from '../lib/sqlPatchScript';
import { downloadTextFile } from '../lib/fileExport';
import type { BaselineSource, BaselineScriptOptions } from '../lib/baselineScript';
import { CopyButton, Dialog, DialogBody, DialogFooter, BTN_PRIMARY, BTN_SECONDARY, FOCUS_RING } from './ui';

export type ScriptKind = 'baseline' | 'patch';

interface BaselineScriptModalProps {
  initialSqlId?: string;
  initialPlanHash?: string;
  /** Which script the dialog opens on; the user can switch. Default 'baseline'. */
  initialKind?: ScriptKind;
  /** Verbatim outline hints of the loaded plan; prefill the SQL Patch hint text. */
  initialOutlineHints?: string[];
  onClose: () => void;
}

const SQL_ID_RE = /^[a-z0-9]{1,13}$/i;
const PLAN_HASH_RE = /^\d+$/;
const PATCH_NAME_RE = /^[A-Za-z0-9_$#]{1,128}$/;

const KIND_OPTIONS: { value: ScriptKind; label: string; sub: string }[] = [
  { value: 'baseline', label: 'SQL Plan Baseline', sub: 'DBMS_SPM' },
  { value: 'patch', label: 'SQL Patch', sub: 'DBMS_SQLDIAG' },
];

const LABEL_CLASS = 'block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide';

function inputClass(ok: boolean, extra = ''): string {
  return `w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 ${extra} ${
    ok
      ? 'border border-slate-200 dark:border-slate-700 focus:ring-blue-500/60'
      : 'border border-red-400 dark:border-red-500 focus:ring-red-500/60'
  }`;
}

const SOURCE_OPTIONS: { value: BaselineSource; label: string; description: string }[] = [
  {
    value: 'cursor_cache',
    label: 'Cursor cache',
    description: 'Plan still running/recent — loads straight from V$SQL.',
  },
  {
    value: 'awr',
    label: 'AWR (19c+)',
    description:
      'Plan aged out — loads from AWR snapshots via DBMS_SPM.LOAD_PLANS_FROM_AWR. In a multitenant PDB this needs PDB-local snapshots.',
  },
  {
    value: 'awr_sts',
    label: 'AWR via SQL Tuning Set',
    description:
      'Pre-19c compatible — stages the plan through a temporary STS. In a multitenant PDB this reads the CDB-root AWR.',
  },
];

export function BaselineScriptModal({
  initialSqlId,
  initialPlanHash,
  initialKind = 'baseline',
  initialOutlineHints,
  onClose,
}: BaselineScriptModalProps) {
  const outlinePrefill = useMemo(() => (initialOutlineHints ?? []).join('\n'), [initialOutlineHints]);
  const [kind, setKind] = useState<ScriptKind>(initialKind);
  const [hintText, setHintText] = useState(outlinePrefill);
  // null = follow the SQL_ID (PLANVIZ_PATCH_<SQL_ID>) until the user edits the name
  const [patchNameEdit, setPatchNameEdit] = useState<string | null>(null);
  const [sqlId, setSqlId] = useState(initialSqlId ?? '');
  const [planHash, setPlanHash] = useState(initialPlanHash ?? '');
  const [source, setSource] = useState<BaselineSource>('cursor_cache');
  const [fixed, setFixed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const sqlIdRef = useRef<HTMLInputElement>(null);
  const sqlIdInputId = useId();
  const planHashInputId = useId();
  const patchNameInputId = useId();
  const hintTextInputId = useId();
  const kindRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const isPatch = kind === 'patch';
  const patchName = patchNameEdit ?? `PLANVIZ_PATCH_${sqlId}`;

  // Typed values: Escape and backdrop clicks ask before discarding them
  const dirty =
    sqlId !== (initialSqlId ?? '') ||
    planHash !== (initialPlanHash ?? '') ||
    hintText !== outlinePrefill ||
    patchNameEdit !== null;

  const sqlIdValid = sqlId !== '' && SQL_ID_RE.test(sqlId);
  const planHashValid = planHash !== '' && PLAN_HASH_RE.test(planHash);
  const patchNameValid = PATCH_NAME_RE.test(patchName);
  const hintsEmpty = hintText.trim() === '';
  const hintsValid = !hintsEmpty;

  const baselineOptions = useMemo<BaselineScriptOptions | null>(() => {
    if (isPatch || !sqlIdValid || !planHashValid) return null;
    return { sqlId, planHash, source, fixed, enabled };
  }, [isPatch, sqlIdValid, planHashValid, sqlId, planHash, source, fixed, enabled]);

  const { script, filename } = useMemo<{ script: string | null; filename: string }>(() => {
    if (isPatch) {
      if (!sqlIdValid || !patchNameValid || !hintsValid) return { script: null, filename: '' };
      const opts = { sqlId, hintText, name: patchName };
      return { script: buildSqlPatchScript(opts), filename: sqlPatchScriptFilename(opts) };
    }
    if (!baselineOptions) return { script: null, filename: '' };
    return { script: buildBaselineScript(baselineOptions), filename: baselineScriptFilename(baselineOptions) };
  }, [isPatch, sqlIdValid, patchNameValid, hintsValid, sqlId, hintText, patchName, baselineOptions]);

  const download = () => {
    if (!script) return;
    downloadTextFile(script, filename);
  };

  // Radiogroup keyboard: arrows move + select, like native radios.
  const onKindKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = (index + dir + KIND_OPTIONS.length) % KIND_OPTIONS.length;
    setKind(KIND_OPTIONS[next].value);
    kindRefs.current[next]?.focus();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={isPatch ? 'Create SQL Patch' : 'Create SQL Plan Baseline'}
      size="lg"
      initialFocusRef={sqlIdRef}
      dirty={dirty}
    >
      <DialogBody className="space-y-4 pb-4">
        <div
          role="radiogroup"
          aria-label="Script type"
          className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60"
        >
          {KIND_OPTIONS.map((opt, i) => {
            const selected = kind === opt.value;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  kindRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setKind(opt.value)}
                onKeyDown={(e) => onKindKeyDown(e, i)}
                className={`px-2 py-1.5 rounded-md text-left transition-colors ${FOCUS_RING} ${
                  selected
                    ? 'bg-white dark:bg-slate-900 shadow-sm ring-1 ring-indigo-300 dark:ring-indigo-700'
                    : 'hover:bg-white/60 dark:hover:bg-slate-800'
                }`}
              >
                <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">{opt.label}</span>
                <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400">{opt.sub}</span>
              </button>
            );
          })}
        </div>

        {isPatch ? (
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
            This generates a script that attaches optimizer hints to this statement as a SQL Patch via{' '}
            <code>DBMS_SQLDIAG.CREATE_SQL_PATCH</code> — no Tuning or Diagnostics Pack needed. The app stays
            offline — you run the script yourself in SQL*Plus / SQLcl on the target database. Requires the{' '}
            <code>ADMINISTER SQL MANAGEMENT OBJECT</code> privilege.
          </p>
        ) : (
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
            This generates a script that captures this exact plan (SQL ID + plan hash value) as a{' '}
            SQL Plan Baseline via <code>DBMS_SPM</code>. The app stays offline — you run the script
            yourself in SQL*Plus / SQLcl on the target database. Requires the{' '}
            <code>ADMINISTER SQL MANAGEMENT OBJECT</code> privilege.
          </p>
        )}

        <div className={isPatch ? '' : 'grid grid-cols-2 gap-3'}>
          <div>
            <label htmlFor={sqlIdInputId} className={LABEL_CLASS}>
              SQL_ID
            </label>
            <input
              id={sqlIdInputId}
              ref={sqlIdRef}
              type="text"
              value={sqlId}
              onChange={(e) => setSqlId(e.target.value.trim())}
              placeholder="e.g. an05rsj1up1k5"
              spellCheck={false}
              className={inputClass(sqlId === '' || sqlIdValid)}
            />
            {sqlId !== '' && !sqlIdValid && (
              <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                SQL_ID is up to 13 alphanumeric characters.
              </p>
            )}
          </div>
          {!isPatch && (
            <div>
              <label htmlFor={planHashInputId} className={LABEL_CLASS}>
                Plan hash
              </label>
              <input
                id={planHashInputId}
                type="text"
                value={planHash}
                onChange={(e) => setPlanHash(e.target.value.trim())}
                placeholder="e.g. 3001234567"
                spellCheck={false}
                className={inputClass(planHash === '' || planHashValid)}
              />
              {planHash !== '' && !planHashValid && (
                <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                  Plan hash is digits only.
                </p>
              )}
            </div>
          )}
        </div>

        {isPatch ? (
          <>
            <div>
              <label htmlFor={patchNameInputId} className={LABEL_CLASS}>
                Patch name
              </label>
              <input
                id={patchNameInputId}
                type="text"
                value={patchName}
                onChange={(e) => setPatchNameEdit(e.target.value.trim())}
                placeholder="PLANVIZ_PATCH_<SQL_ID>"
                spellCheck={false}
                className={inputClass(patchNameValid)}
              />
              {!patchNameValid && (
                <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                  Patch name is 1–128 letters, digits, <code>_</code>, <code>$</code> or <code>#</code>.
                </p>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor={hintTextInputId} className={`${LABEL_CLASS} mb-0`}>
                  Hint text
                </label>
                {outlinePrefill !== '' && hintText !== outlinePrefill && (
                  <button
                    type="button"
                    onClick={() => setHintText(outlinePrefill)}
                    className={`text-[10px] px-1.5 py-0.5 rounded text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${FOCUS_RING}`}
                  >
                    Use plan outline
                  </button>
                )}
              </div>
              <textarea
                id={hintTextInputId}
                value={hintText}
                onChange={(e) => setHintText(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder={'One hint per line, e.g.\nFULL(@"SEL$1" "E"@"SEL$1")'}
                className={`${inputClass(true)} resize-y whitespace-pre`}
              />
              {outlinePrefill !== '' ? (
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                  Prefilled with this plan&apos;s full outline, which pins the current plan. Trim it to the hints you need.
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                  Hints come from DBMS_XPLAN <code>ADVANCED</code> / <code>+OUTLINE</code> output or a SQL Monitor XML
                  report, or type them by hand, e.g. <code>FULL(@&quot;SEL$1&quot; &quot;E&quot;@&quot;SEL$1&quot;)</code>.
                </p>
              )}
              {hintsEmpty && (
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Enter at least one hint.</p>
              )}
            </div>
          </>
        ) : (
          <>
        <div>
          <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
            Source
          </span>
          <div className="flex flex-col gap-1.5">
            {SOURCE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                  source === opt.value
                    ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="baseline-source"
                  value={opt.value}
                  checked={source === opt.value}
                  onChange={() => setSource(opt.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                    {opt.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={fixed}
              onChange={(e) => setFixed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                Mark as FIXED
              </span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                Fixed baselines take priority and stop automatic plan evolution for the statement.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
              ENABLED
            </span>
          </label>
        </div>
          </>
        )}

        <div>
          <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
            Get the script
          </span>
          {!script && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
              {isPatch
                ? 'Enter a valid SQL_ID, patch name and hint text above to generate the script.'
                : 'Enter a valid SQL_ID and plan hash above to generate the script.'}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {script ? (
              // Only claims "Copied" after the copy really succeeded; shows an error toast otherwise.
              <CopyButton
                text={script}
                label="Copy script"
                copiedLabel="Copied!"
                size="sm"
                variant="primary"
                className="w-full"
              />
            ) : (
              <button
                type="button"
                disabled
                className={`${BTN_PRIMARY} w-full`}
              >
                Copy script
              </button>
            )}
            <button
              type="button"
              onClick={download}
              disabled={!script}
              className={BTN_SECONDARY}
            >
              Download .sql
            </button>
          </div>
          {script && (
            <details className="mt-2">
              <summary className={`text-[10px] text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300 rounded ${FOCUS_RING}`}>
                Preview script ({script.split('\n').length} lines)
              </summary>
              <pre className="mt-1 text-[10px] font-mono p-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 whitespace-pre overflow-auto max-h-72">
                {script}
              </pre>
            </details>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>
          Close
        </button>
      </DialogFooter>
    </Dialog>
  );
}
