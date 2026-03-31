import { useMemo } from 'react';
import { HighlightText } from './HighlightText';

interface PredicateClause {
  keyword?: 'AND' | 'OR';
  text: string;
}

/**
 * Split a predicate string on top-level AND/OR keywords (not those inside parentheses or string literals).
 */
function splitPredicateClauses(text: string): PredicateClause[] {
  const clauses: PredicateClause[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let pendingKeyword: 'AND' | 'OR' | undefined = undefined;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Handle Oracle string literals (single-quoted)
    if (ch === "'" && !inString) {
      inString = true;
      current += ch;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === "'") {
        // Escaped quote ('')
        if (i + 1 < text.length && text[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === '(') depth++;
    if (ch === ')') depth--;

    if (depth === 0) {
      const remaining = text.substring(i);
      if (remaining.startsWith(' AND ')) {
        if (current.trim()) clauses.push({ keyword: pendingKeyword, text: current.trim() });
        pendingKeyword = 'AND';
        current = '';
        i += 4; // skip " AND", loop increment handles the next char
        continue;
      }
      if (remaining.startsWith(' OR ')) {
        if (current.trim()) clauses.push({ keyword: pendingKeyword, text: current.trim() });
        pendingKeyword = 'OR';
        current = '';
        i += 3;
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) {
    clauses.push({ keyword: pendingKeyword, text: current.trim() });
  }

  return clauses;
}

/**
 * Unwrap a single layer of surrounding parentheses if the entire text is wrapped.
 * E.g. `("A"=1 OR "B"=2)` → `"A"=1 OR "B"=2`
 */
function unwrapOuterParens(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return trimmed;

  // Verify the closing paren matches the opening one (not an inner group)
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '(') depth++;
    if (trimmed[i] === ')') depth--;
    if (depth === 0 && i < trimmed.length - 1) return trimmed; // Closed before end
  }
  return trimmed.slice(1, -1).trim();
}

interface FormattedPredicateProps {
  text: string;
  searchQuery?: string;
}

export function FormattedPredicate({ text, searchQuery }: FormattedPredicateProps) {
  const clauses = useMemo(() => {
    const unwrapped = unwrapOuterParens(text);
    return splitPredicateClauses(unwrapped);
  }, [text]);

  if (clauses.length <= 1) {
    return <HighlightText text={text} query={searchQuery} />;
  }

  return (
    <span>
      {clauses.map((clause, i) => (
        <span key={i} className={i > 0 ? 'block mt-1' : 'block'}>
          {clause.keyword && (
            <span className="text-blue-500 dark:text-blue-400 font-semibold select-none mr-1">
              {clause.keyword}
            </span>
          )}
          <HighlightText text={clause.text} query={searchQuery} />
        </span>
      ))}
    </span>
  );
}
