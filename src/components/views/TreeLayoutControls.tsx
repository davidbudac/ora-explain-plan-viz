import type { ReactNode } from 'react';
import type { TreeLayoutDirection, TreeMinimapMode } from '../../lib/settings';
import { FOCUS_RING } from '../ui/focusRing';

/**
 * Compact control strip for the plan tree: layout direction, overview map,
 * expand / collapse all, focus selected and redraw.
 *
 * Purely presentational — every action comes in through props. The workspace
 * toolbar (and focus mode's View chip) mounts it for the single-plan tree,
 * wired to the context values `treeLayoutDirection` / `treeMinimap`,
 * `treeViewActionsRef` and `treeViewState`; the tree-compare panes mount it as
 * a per-pane canvas overlay (HierarchicalView, top-left).
 */

export interface TreeLayoutControlsProps {
  direction: TreeLayoutDirection;
  onDirectionChange: (direction: TreeLayoutDirection) => void;
  minimap: TreeMinimapMode;
  onMinimapChange: (mode: TreeMinimapMode) => void;
  /** Whether the map is currently on screen (resolves 'auto' for the tooltip). */
  minimapShown?: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** Number of operations currently hidden in collapsed subtrees. */
  hiddenCount?: number;
  /** False when the plan has no subtree that could be collapsed. */
  canCollapse?: boolean;
  onFocusSelected?: () => void;
  canFocusSelected?: boolean;
  /** Reset node positions to the computed layout and fit the tree. */
  onRedraw?: () => void;
  className?: string;
}

const NEXT_MINIMAP_MODE: Record<TreeMinimapMode, TreeMinimapMode> = { auto: 'on', on: 'off', off: 'auto' };
const MINIMAP_MODE_LABEL: Record<TreeMinimapMode, string> = { auto: 'Auto', on: 'On', off: 'Off' };

const BUTTON =
  `inline-flex items-center justify-center gap-0.5 h-7 min-w-6 px-1 rounded-md text-[11px] font-medium ` +
  `text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700/80 dark:hover:text-white ` +
  `motion-safe:transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent dark:disabled:hover:bg-transparent ${FOCUS_RING}`;
const PRESSED = 'bg-slate-200/90 text-slate-900 dark:bg-slate-600/80 dark:text-white';

function Divider() {
  return <span aria-hidden className="mx-px h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function TreeLayoutControls({
  direction,
  onDirectionChange,
  minimap,
  onMinimapChange,
  minimapShown,
  onExpandAll,
  onCollapseAll,
  hiddenCount = 0,
  canCollapse = true,
  onFocusSelected,
  canFocusSelected = false,
  onRedraw,
  className = '',
}: TreeLayoutControlsProps) {
  const nextMinimap = NEXT_MINIMAP_MODE[minimap];
  const minimapTitle =
    `Overview map: ${MINIMAP_MODE_LABEL[minimap]}` +
    (minimap === 'auto' ? ` (${minimapShown ? 'shown' : 'hidden'} — appears for plans with more than 12 visible operations)` : '') +
    `. Switch to ${MINIMAP_MODE_LABEL[nextMinimap]}`;
  const expandTitle = hiddenCount > 0
    ? `Expand all (${hiddenCount} operation${hiddenCount === 1 ? '' : 's'} hidden)`
    : 'Expand all';

  return (
    <div
      role="toolbar"
      aria-label="Tree layout"
      className={`flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/70 bg-white/85 dark:bg-slate-800/75 backdrop-blur-sm p-0.5 shadow-sm ${className}`}
    >
      <div role="group" aria-label="Layout direction" className="flex items-center gap-0.5">
        <button
          type="button"
          className={`${BUTTON} ${direction === 'TB' ? PRESSED : ''}`}
          data-tree-direction="TB"
          aria-pressed={direction === 'TB'}
          aria-label="Top-down layout"
          title="Top-down layout"
          onClick={() => onDirectionChange('TB')}
        >
          <Icon>
            <rect x="8.5" y="3" width="7" height="5" rx="1.2" />
            <rect x="3" y="16" width="7" height="5" rx="1.2" />
            <rect x="14" y="16" width="7" height="5" rx="1.2" />
            <path d="M12 8v4M6.5 16v-2.5h11V16" />
          </Icon>
        </button>
        <button
          type="button"
          className={`${BUTTON} ${direction === 'LR' ? PRESSED : ''}`}
          data-tree-direction="LR"
          aria-pressed={direction === 'LR'}
          aria-label="Left-to-right layout"
          title="Left-to-right layout"
          onClick={() => onDirectionChange('LR')}
        >
          <Icon>
            <rect x="3" y="8.5" width="5" height="7" rx="1.2" />
            <rect x="16" y="3" width="5" height="7" rx="1.2" />
            <rect x="16" y="14" width="5" height="7" rx="1.2" />
            <path d="M8 12h4M16 6.5h-2.5v11H16" />
          </Icon>
        </button>
      </div>

      <Divider />

      <button
        type="button"
        className={`${BUTTON} ${minimap === 'on' ? PRESSED : ''}`}
        aria-label={`Overview map: ${MINIMAP_MODE_LABEL[minimap]}`}
        title={minimapTitle}
        onClick={() => onMinimapChange(nextMinimap)}
      >
        <Icon>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <rect x="12" y="11" width="6" height="6" rx="1" />
        </Icon>
        <span aria-hidden className="tabular-nums">{MINIMAP_MODE_LABEL[minimap]}</span>
      </button>

      <Divider />

      <button
        type="button"
        className={BUTTON}
        aria-label={expandTitle}
        title={expandTitle}
        disabled={hiddenCount === 0}
        onClick={onExpandAll}
      >
        <Icon>
          <path d="M7 4l5 5 5-5M7 20l5-5 5 5" />
        </Icon>
        {hiddenCount > 0 && <span aria-hidden className="tabular-nums">{hiddenCount}</span>}
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-label="Collapse all"
        title="Collapse all subtrees"
        disabled={!canCollapse}
        onClick={onCollapseAll}
      >
        <Icon>
          <path d="M7 9l5-5 5 5M7 15l5 5 5-5" />
        </Icon>
      </button>

      {(onFocusSelected || onRedraw) && <Divider />}

      {onFocusSelected && (
        <button
          type="button"
          className={BUTTON}
          aria-label="Focus selected"
          title={canFocusSelected ? 'Focus selected — centre the selected operation' : 'Focus selected — select an operation first'}
          disabled={!canFocusSelected}
          onClick={onFocusSelected}
        >
          <Icon>
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" />
          </Icon>
        </button>
      )}
      {onRedraw && (
        <button
          type="button"
          className={BUTTON}
          aria-label="Redraw layout"
          title="Redraw layout and fit the tree"
          onClick={onRedraw}
        >
          <Icon>
            <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </Icon>
        </button>
      )}
    </div>
  );
}
