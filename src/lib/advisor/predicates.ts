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

function scan(predicate: string, source: 'access' | 'filter'): ConversionHit[] {
  const hits: ConversionHit[] = [];

  for (const match of predicate.matchAll(INTERNAL_FUNCTION_RE)) {
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
