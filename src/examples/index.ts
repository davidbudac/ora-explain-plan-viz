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
 *
 * Optional one-line descriptions and the start-screen `featured` flag live in
 * ./descriptions.ts, keyed by the file stem.
 */

import { getExampleDescription } from './descriptions';

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
  /** One-line "what it teaches" blurb (see ./descriptions.ts). */
  description?: string;
  /** Shown on the start screen's example cards. */
  featured?: boolean;
}

export type SampleCategory = SamplePlan['category'];

/** Display labels for the example categories (menu group headings, card badges). */
export const SAMPLE_CATEGORY_LABELS: Record<SampleCategory, string> = {
  dbms_xplan: 'DBMS_XPLAN',
  sql_monitor: 'SQL Monitor',
  json: 'JSON (V$SQL_PLAN)',
  xbi: 'XBI (Tanel Poder)',
};

/** Short badge text per category. */
export const SAMPLE_CATEGORY_BADGES: Record<SampleCategory, string> = {
  dbms_xplan: 'DBMS_XPLAN',
  sql_monitor: 'SQL Monitor',
  json: 'JSON',
  xbi: 'XBI',
};

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
    const blurb = getExampleDescription(stem);
    return {
      ...meta,
      data,
      metadata: metadataByStem[stem],
      description: blurb?.description,
      featured: blurb?.featured,
    };
  })
  .filter((plan): plan is SamplePlan & { order: number } => plan !== null)
  .sort((a, b) => a.order - b.order);

// Same list, with the NN order prefix retained. Used to resolve `?example=<NN>` deep links.
export const SAMPLE_PLANS_WITH_ORDER: Array<SamplePlan & { order: number }> = sortedPlansWithOrder;

export const SAMPLE_PLANS: SamplePlan[] = sortedPlansWithOrder.map(({ name, category, data, metadata, description, featured }) => ({
  name,
  category,
  data,
  metadata,
  description,
  featured,
}));

// Group plans by category for the dropdown menu
export const SAMPLE_PLANS_BY_CATEGORY = {
  dbms_xplan: SAMPLE_PLANS.filter((p) => p.category === 'dbms_xplan'),
  sql_monitor: SAMPLE_PLANS.filter((p) => p.category === 'sql_monitor'),
  json: SAMPLE_PLANS.filter((p) => p.category === 'json'),
  xbi: SAMPLE_PLANS.filter((p) => p.category === 'xbi'),
};

/** Preferred order of menu groups; categories not listed here follow in first-seen order. */
const CATEGORY_ORDER: SampleCategory[] = ['dbms_xplan', 'sql_monitor', 'json', 'xbi'];

export interface SamplePlanGroup {
  category: SampleCategory;
  label: string;
  samples: SamplePlan[];
}

/** Example groups derived from the categories actually present (empty groups are omitted). */
export function groupSamplePlans(samples: SamplePlan[] = SAMPLE_PLANS): SamplePlanGroup[] {
  const present: SampleCategory[] = [];
  for (const sample of samples) {
    if (!present.includes(sample.category)) present.push(sample.category);
  }
  present.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
  });
  return present.map((category) => ({
    category,
    label: SAMPLE_CATEGORY_LABELS[category] ?? category,
    samples: samples.filter((s) => s.category === category),
  }));
}

export const SAMPLE_PLAN_GROUPS: SamplePlanGroup[] = groupSamplePlans();

/** Examples flagged `featured` in ./descriptions.ts, in example order. */
export const FEATURED_SAMPLE_PLANS: SamplePlan[] = SAMPLE_PLANS.filter((s) => s.featured);
