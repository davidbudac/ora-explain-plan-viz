import { allReferencedColumns } from '../advisor/rules/sargable.ts';

/**
 * Upper-cased names of the columns the given predicates reference (access and filter predicates of
 * one or more plan lines), de-duplicated, first seen first. Literals, binds, function names and
 * keywords are never returned: see `allReferencedColumns`, which does the parsing.
 */
export function extractPredicateColumns(
  ...predicates: Array<string | undefined>
): string[] {
  return allReferencedColumns(predicates);
}
