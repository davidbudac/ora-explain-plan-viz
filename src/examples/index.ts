/**
 * Example Plans Loader
 *
 * Automatically loads all .txt files from this folder as example plans.
 *
 * File naming convention: NN-category-Display Name.txt
 * - NN: Two-digit sort order (e.g., 01, 02, 03)
 * - category: Either "dbms_xplan" or "sql_monitor"
 * - Display Name: The name shown in the dropdown menu
 *
 * Examples:
 * - 01-dbms_xplan-Simple Plan.txt
 * - 02-dbms_xplan-Complex Plan.txt
 * - 03-sql_monitor-SQL Monitor.txt
 *
 * To add a new example, simply create a new .txt file following this convention.
 * No code changes required!
 */

export interface SamplePlan {
  name: string;
  category: 'dbms_xplan' | 'sql_monitor';
  data: string;
}

// Use Vite's glob import to load all .txt files as raw strings
const exampleFiles = import.meta.glob<string>('./*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Parse filename to extract metadata
function parseFilename(path: string): { order: number; category: 'dbms_xplan' | 'sql_monitor'; name: string } | null {
  // Extract filename from path (e.g., "./01-dbms_xplan-Simple Plan.txt" -> "01-dbms_xplan-Simple Plan.txt")
  const filename = path.split('/').pop()?.replace('.txt', '') || '';

  // Parse: NN-category-name
  const match = filename.match(/^(\d+)-(\w+)-(.+)$/);
  if (!match) {
    console.warn(`Invalid example filename format: ${filename}. Expected: NN-category-Name.txt`);
    return null;
  }

  const [, orderStr, category, name] = match;
  const order = parseInt(orderStr, 10);

  if (category !== 'dbms_xplan' && category !== 'sql_monitor') {
    console.warn(`Invalid category in filename: ${category}. Expected: dbms_xplan or sql_monitor`);
    return null;
  }

  return { order, category, name };
}

// Build the sample plans array from loaded files
export const SAMPLE_PLANS: SamplePlan[] = Object.entries(exampleFiles)
  .map(([path, data]) => {
    const meta = parseFilename(path);
    if (!meta) return null;
    return {
      ...meta,
      data,
    };
  })
  .filter((plan): plan is SamplePlan & { order: number } => plan !== null)
  .sort((a, b) => a.order - b.order)
  .map(({ name, category, data }) => ({ name, category, data }));

// Group plans by category for the dropdown menu
export const SAMPLE_PLANS_BY_CATEGORY = {
  dbms_xplan: SAMPLE_PLANS.filter((p) => p.category === 'dbms_xplan'),
  sql_monitor: SAMPLE_PLANS.filter((p) => p.category === 'sql_monitor'),
};
