export interface ConversionHit {
  fn: 'INTERNAL_FUNCTION' | 'TO_NUMBER' | 'TO_CHAR' | 'TO_DATE';
  column: string;
  fragment: string;
  source: 'access' | 'filter';
}

const QUALIFIED_COLUMN = '(?:"[^"]+"\\.){0,2}"[^"]+"';
const INTERNAL_FUNCTION_RE = new RegExp(`INTERNAL_FUNCTION\\(\\s*(${QUALIFIED_COLUMN})\\s*\\)`, 'g');
const CONVERSION_FN_RE = new RegExp(`\\b(TO_NUMBER|TO_CHAR|TO_DATE)\\(\\s*(${QUALIFIED_COLUMN})\\s*[,)]`, 'g');

function stripQuotes(qualifiedColumn: string): string {
  const parts = qualifiedColumn.split('.');
  const last = parts[parts.length - 1];
  if (last.startsWith('"') && last.endsWith('"')) return last.slice(1, -1);
  return last;
}

/** Blank out single-quoted literals so quotes/parens inside them can't confuse the context checks. */
function maskLiterals(predicate: string): string {
  return predicate.replace(/'(?:[^']|'')*'/g, (lit) => ' '.repeat(lit.length));
}

/** True when `index` sits inside an analytic clause: OVER ( ... ). */
function insideOverClause(masked: string, index: number): boolean {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = masked[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth > 0) depth--;
      else if (/\bOVER\s*$/i.test(masked.slice(0, i))) return true;
    }
  }
  return false;
}

const COMPARISON_BEFORE_RE = /(?:=|<|>|\bLIKE|\bBETWEEN)\s*$/i;
const COMPARISON_AFTER_RE = /^\s*(?:=|<|>|!=|\^=|(?:NOT\s+)?(?:LIKE|BETWEEN|IN)\b)/i;
const SORT_KEY_AFTER_RE = /^\s*(?:ASC|DESC)\b/i;

/**
 * Oracle prints INTERNAL_FUNCTION in places that are not conversions on a
 * compared column: DESC sort keys in analytic clauses, and a bare boolean term
 * (its IN-list representation). Only an operand of a comparison counts.
 */
function isConversionContext(masked: string, start: number, end: number): boolean {
  if (SORT_KEY_AFTER_RE.test(masked.slice(end))) return false;
  if (insideOverClause(masked, start)) return false;
  return COMPARISON_BEFORE_RE.test(masked.slice(0, start)) || COMPARISON_AFTER_RE.test(masked.slice(end));
}

function scan(predicate: string, source: 'access' | 'filter'): ConversionHit[] {
  const hits: ConversionHit[] = [];
  const masked = maskLiterals(predicate);

  for (const match of predicate.matchAll(INTERNAL_FUNCTION_RE)) {
    const start = match.index ?? 0;
    if (!isConversionContext(masked, start, start + match[0].length)) continue;
    hits.push({
      fn: 'INTERNAL_FUNCTION',
      column: stripQuotes(match[1]),
      fragment: match[0],
      source,
    });
  }

  for (const match of predicate.matchAll(CONVERSION_FN_RE)) {
    const fn = match[1] as 'TO_NUMBER' | 'TO_CHAR' | 'TO_DATE';
    hits.push({
      fn,
      column: stripQuotes(match[2]),
      fragment: match[0],
      source,
    });
  }

  return hits;
}

export function findImplicitConversions(access?: string, filter?: string): ConversionHit[] {
  const hits: ConversionHit[] = [];
  if (access) hits.push(...scan(access, 'access'));
  if (filter) hits.push(...scan(filter, 'filter'));
  return hits;
}
