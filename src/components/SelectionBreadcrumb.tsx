import { FOCUS_RING } from './ui/focusRing';
import { collapseCrumbs, crumbTitle } from '../lib/breadcrumb';
import type { Crumb } from '../lib/breadcrumb';

/**
 * Ancestor path of the selected operation (root → … → selected) as a compact
 * breadcrumb, plus a "Return to selected" button that recentres the canvas.
 * Presentational: HierarchicalView supplies the path and callbacks and mounts
 * it as a canvas overlay (React Flow `Panel`, so PNG export leaves it out).
 */

export interface SelectionBreadcrumbProps {
  /** Root first, selected operation last. Empty renders nothing. */
  path: Crumb[];
  onSelect: (id: number) => void;
  /** Recentre the canvas on the selected operation. */
  onReturn: () => void;
  className?: string;
}

const CRUMB_BUTTON =
  `max-w-[9rem] truncate rounded px-1 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 ` +
  `hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700/80 dark:hover:text-white ` +
  `motion-safe:transition-colors ${FOCUS_RING}`;

export function SelectionBreadcrumb({ path, onSelect, onReturn, className = '' }: SelectionBreadcrumbProps) {
  if (path.length === 0) return null;
  const items = collapseCrumbs(path);
  const selectedId = path[path.length - 1].id;

  return (
    <nav
      aria-label="Selected operation path"
      data-export-exclude
      className={`flex max-w-full items-center gap-1 rounded-lg border border-slate-200/80 bg-white/85 p-0.5 pl-1 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-800/75 ${className}`}
    >
      <ol className="flex min-w-0 items-center gap-0.5">
        {items.map((item, index) => (
          <li key={item.kind === 'crumb' ? item.crumb.id : 'gap'} className="flex min-w-0 items-center gap-0.5">
            {index > 0 && (
              <span aria-hidden className="shrink-0 select-none text-[11px] text-slate-400 dark:text-slate-500">
                ›
              </span>
            )}
            {item.kind === 'gap' ? (
              <span
                className="shrink-0 px-1 text-[11px] text-slate-500 dark:text-slate-400"
                title={item.hidden.map(crumbTitle).join('\n')}
              >
                …
              </span>
            ) : (
              <button
                type="button"
                className={CRUMB_BUTTON}
                title={crumbTitle(item.crumb)}
                aria-current={item.crumb.id === selectedId ? 'location' : undefined}
                onClick={() => onSelect(item.crumb.id)}
              >
                <span className="tabular-nums text-slate-400 dark:text-slate-500">{item.crumb.id}</span>{' '}
                {item.crumb.operation}
              </button>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className={`${CRUMB_BUTTON} shrink-0 border-l border-slate-200 pl-1.5 dark:border-slate-700`}
        title="Centre the canvas on the selected operation"
        onClick={onReturn}
      >
        Return to selected
      </button>
    </nav>
  );
}
