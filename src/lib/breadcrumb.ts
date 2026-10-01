/** Pure helpers for the tree view's selected-operation breadcrumb. */

export interface Crumb {
  id: number;
  operation: string;
  objectName?: string;
}

/** Longest path shown in full; longer ones collapse their middle into "…". */
export const MAX_VISIBLE_CRUMBS = 5;

export type CrumbItem = { kind: 'crumb'; crumb: Crumb } | { kind: 'gap'; hidden: Crumb[] };

/**
 * Keep the root and the last (max − 2) crumbs of a long path, collapsing what
 * lies between into one `gap` item that remembers the hidden crumbs.
 */
export function collapseCrumbs(path: Crumb[], max: number = MAX_VISIBLE_CRUMBS): CrumbItem[] {
  if (path.length <= max) return path.map((crumb) => ({ kind: 'crumb', crumb }));
  const tail = Math.max(1, max - 2);
  return [
    { kind: 'crumb', crumb: path[0] },
    { kind: 'gap', hidden: path.slice(1, path.length - tail) },
    ...path.slice(path.length - tail).map((crumb): CrumbItem => ({ kind: 'crumb', crumb })),
  ];
}

export function crumbTitle(crumb: Crumb): string {
  return `${crumb.id} - ${crumb.operation}${crumb.objectName ? ` (${crumb.objectName})` : ''}`;
}
