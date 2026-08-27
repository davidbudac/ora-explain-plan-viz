/**
 * Database helpers for the eval harness.
 *
 * `splitSqlScript` is PURE (no oracledb import) so unit tests never load the
 * driver. `connect`/`runScript`/`dropEvalObjects` lazily import `oracledb`
 * (thin mode, the default) inside the function body.
 */

// Deliberately structural (not `import type oracledb`): keeps the pure parts
// of this module importable without the driver's types being load-bearing.
export interface DbConnection {
  execute(sql: string, binds?: unknown[], options?: Record<string, unknown>): Promise<{
    rows?: unknown[][];
  }>;
  close(): Promise<void>;
}

export interface SplitResult {
  /** Executable statements, in script order, terminators stripped. */
  statements: string[];
  /** SQL*Plus-only lines that were skipped (SET/DEFINE/ACCEPT/PROMPT/...). */
  skipped: string[];
}

const SQLPLUS_ONLY = /^(SET|DEFINE|ACCEPT|PROMPT|UNDEFINE|VARIABLE|EXEC(UTE)?|WHENEVER|REM(ARK)?|SPOOL|COLUMN|TTITLE|BTITLE|BREAK|COMPUTE|CLEAR|PAUSE|SHOW|CONNECT|DISCONNECT|TIMING)\b/i;

const PLSQL_START =
  /^(DECLARE|BEGIN|CREATE\s+(OR\s+REPLACE\s+)?(\S+\s+)*?(FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE)\b)/i;

/**
 * Split a SQL*Plus-style script into individually executable statements.
 *
 * Handles:
 * - `;`-terminated SQL statements (terminator stripped);
 * - PL/SQL blocks (DECLARE/BEGIN/CREATE FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE)
 *   terminated by a lone `/` line — internal semicolons are kept;
 * - `--` full-line comments (dropped) and blank lines;
 * - SQL*Plus-only lines (SET/DEFINE/ACCEPT/PROMPT/UNDEFINE/VARIABLE/EXEC,
 *   WHENEVER, ...) which are skipped and recorded in `skipped`;
 * - a stray `/` after a `;`-terminated statement (re-execute) is ignored.
 */
export function splitSqlScript(text: string): SplitResult {
  const statements: string[] = [];
  const skipped: string[] = [];
  let buffer: string[] = [];
  let inPlsql = false;

  const flushSql = () => {
    const stmt = buffer.join('\n').trim().replace(/;\s*$/, '').trim();
    if (stmt) statements.push(stmt);
    buffer = [];
    inPlsql = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();

    // Lone slash: terminates a PL/SQL block; otherwise a re-execute — ignore.
    if (trimmed === '/') {
      if (inPlsql) {
        const stmt = buffer.join('\n').trim();
        if (stmt) statements.push(stmt);
        buffer = [];
        inPlsql = false;
      } else if (buffer.length > 0) {
        flushSql();
      }
      continue;
    }

    if (buffer.length === 0) {
      if (trimmed === '' || trimmed.startsWith('--')) continue;
      if (SQLPLUS_ONLY.test(trimmed)) {
        skipped.push(trimmed);
        continue;
      }
      inPlsql = PLSQL_START.test(trimmed);
      buffer.push(line);
    } else {
      // Inside a statement: drop full-line comments outside PL/SQL only
      // (comments are legal and harmless inside a block, keep them there).
      if (!inPlsql && trimmed.startsWith('--')) continue;
      buffer.push(line);
    }

    if (!inPlsql && trimmed.endsWith(';')) flushSql();
  }

  // Unterminated trailing statement: execute it anyway.
  if (buffer.length > 0) {
    if (inPlsql) {
      const stmt = buffer.join('\n').trim();
      if (stmt) statements.push(stmt);
    } else {
      flushSql();
    }
  }

  return { statements, skipped };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name} — see evals/README.md for setup.`,
    );
  }
  return value;
}

/** Open a connection to the dedicated eval scratch schema (thin mode). */
export async function connect(): Promise<DbConnection> {
  const oracledb = (await import('oracledb')).default;
  const conn = await oracledb.getConnection({
    user: requireEnv('ORA_EVAL_USER'),
    password: requireEnv('ORA_EVAL_PASSWORD'),
    connectString: requireEnv('ORA_EVAL_CONNECT'),
  });
  return conn as unknown as DbConnection;
}

export interface RunScriptResult {
  executed: number;
  skipped: string[];
  errors: { statement: string; message: string }[];
}

export interface RunScriptOptions {
  /** Collect statement errors instead of throwing on the first one. */
  continueOnError?: boolean;
}

/** Execute every statement of a SQL*Plus-style script on the connection. */
export async function runScript(
  conn: DbConnection,
  script: string,
  options: RunScriptOptions = {},
): Promise<RunScriptResult> {
  const { statements, skipped } = splitSqlScript(script);
  const errors: RunScriptResult['errors'] = [];
  let executed = 0;
  for (const statement of statements) {
    try {
      await conn.execute(statement);
      executed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!options.continueOnError) {
        throw new Error(`Statement failed: ${message}\n--- statement ---\n${statement}`);
      }
      errors.push({ statement, message });
    }
  }
  return { executed, skipped, errors };
}

/**
 * Drop every EVAL_-prefixed object in the connected schema. The harness owns
 * this prefix by contract (see evals/README.md); anything else is untouched.
 */
export async function dropEvalObjects(conn: DbConnection): Promise<void> {
  const result = await conn.execute(
    `SELECT object_name, object_type FROM user_objects
      WHERE object_name LIKE 'EVAL\\_%' ESCAPE '\\'
        AND object_type IN ('TABLE','VIEW','SEQUENCE','MATERIALIZED VIEW')
      ORDER BY DECODE(object_type,'MATERIALIZED VIEW',0,'VIEW',1,'TABLE',2,3)`,
  );
  for (const row of result.rows ?? []) {
    const [name, type] = row as [string, string];
    const suffix = type === 'TABLE' ? ' CASCADE CONSTRAINTS PURGE' : '';
    try {
      await conn.execute(`DROP ${type} ${name}${suffix}`);
    } catch {
      // Object may already be gone via a cascade; ignore.
    }
  }
}
