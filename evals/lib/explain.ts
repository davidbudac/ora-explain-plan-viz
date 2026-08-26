/**
 * EXPLAIN PLAN capture: runs EXPLAIN PLAN FOR <sql> and returns the
 * DBMS_XPLAN.DISPLAY text, ready for the app's parser.
 */

import type { DbConnection } from './db';

export async function explainPlanText(conn: DbConnection, sql: string): Promise<string> {
  await conn.execute(`DELETE FROM plan_table`);
  await conn.execute(`EXPLAIN PLAN FOR ${sql}`);
  const result = await conn.execute(
    `SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY(format => 'TYPICAL'))`,
  );
  return (result.rows ?? []).map((row) => String((row as unknown[])[0] ?? '')).join('\n');
}

/** EVAL_-prefixed tables currently in the connected schema. */
export async function listEvalTables(conn: DbConnection): Promise<string[]> {
  const result = await conn.execute(
    `SELECT table_name FROM user_tables WHERE table_name LIKE 'EVAL\\_%' ESCAPE '\\' ORDER BY table_name`,
  );
  return (result.rows ?? []).map((row) => String((row as unknown[])[0]));
}
