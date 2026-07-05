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
  category: 'dbms_xplan' | 'sql_monitor' | 'json' | 'xbi';
  data: string;
  /**
   * Optional raw metadata-bundle JSON (gather_plan_metadata.sql output) shipped
   * alongside the example. A sidecar file named `<same stem>.meta.json` is
   * auto-attached when the example loads, so curated examples can demo the
   * schema-metadata feature without a manual drop.
   */
  metadata?: string;
}

// Use Vite's glob import to load all .txt files as raw strings
const exampleFiles = import.meta.glob<string>('./*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Optional metadata-bundle sidecars, keyed by the plan file's stem so
// `28-...-Partition Range Iterator.meta.json` pairs with the like-named .txt.
const metadataFiles = import.meta.glob<string>('./*.meta.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const metadataByStem: Record<string, string> = {};
for (const [path, raw] of Object.entries(metadataFiles)) {
  const stem = path.split('/').pop()?.replace(/\.meta\.json$/, '') ?? '';
  if (stem) metadataByStem[stem] = raw;
}

// Parse filename to extract metadata
function parseFilename(path: string): { order: number; category: SamplePlan['category']; name: string } | null {
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

  if (category !== 'dbms_xplan' && category !== 'sql_monitor' && category !== 'json' && category !== 'xbi') {
    console.warn(`Invalid category in filename: ${category}. Expected: dbms_xplan, sql_monitor, json, or xbi`);
    return null;
  }

  return { order, category, name };
}

// Build the sample plans array from loaded files (with order retained for lookups)
const sortedPlansWithOrder: Array<SamplePlan & { order: number }> = Object.entries(exampleFiles)
  .map(([path, data]): (SamplePlan & { order: number }) | null => {
    const meta = parseFilename(path);
    if (!meta) return null;
    const stem = path.split('/').pop()?.replace(/\.txt$/, '') ?? '';
    return {
      ...meta,
      data,
      metadata: metadataByStem[stem],
    };
  })
  .filter((plan): plan is SamplePlan & { order: number } => plan !== null)
  .sort((a, b) => a.order - b.order);

// Same list, with the NN order prefix retained. Used to resolve `?example=<NN>` deep links.
export const SAMPLE_PLANS_WITH_ORDER: Array<SamplePlan & { order: number }> = sortedPlansWithOrder;

export const SAMPLE_PLANS: SamplePlan[] = sortedPlansWithOrder.map(({ name, category, data, metadata }) => ({ name, category, data, metadata }));

// Group plans by category for the dropdown menu
export const SAMPLE_PLANS_BY_CATEGORY = {
  dbms_xplan: SAMPLE_PLANS.filter((p) => p.category === 'dbms_xplan'),
  sql_monitor: SAMPLE_PLANS.filter((p) => p.category === 'sql_monitor'),
  json: SAMPLE_PLANS.filter((p) => p.category === 'json'),
  xbi: SAMPLE_PLANS.filter((p) => p.category === 'xbi'),
};
