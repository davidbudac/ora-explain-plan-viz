import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { NodeToolbar, Position, useReactFlow } from '@xyflow/react';
import { usePlan } from '../../hooks/usePlanContext';
import { highlightMatchesBrush } from '../../lib/annotations';
import type { HighlightBrush, HighlightStyle, NodeHighlight } from '../../lib/annotations';
import { copyToClipboard } from '../../lib/clipboard';
import { formatNodeSummary } from '../../lib/nodeSummary';
import type { PlanNode } from '../../lib/types';
import { FOCUS_RING, useToast } from '../ui';
import { BrushPicker } from './BrushPicker';
import { brushHex, paintButtonLabel } from './brush';
import { NodeNoteEditor } from './NodeNoteEditor';
import { NodePopover } from './NodePopover';
import type { PopoverCloseReason } from './NodePopover';
import { isFocusVisible, stopKeyPropagation, surfaceIdOf } from './toolbarSurface';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Contextual actions for the plan node under the pointer (tree view only):
 *
 *   [🖌 paint | ▾ brush]  ·  [✎ note]  ·  [⛶ zoom to subtree] [⧉ copy]
 *
 * The highlight "brush" is a two-step flow — pick a colour + style once (the
 * caret), then one-click paint (the brush) as many nodes as you like.
 *
 * Placement uses React Flow's `NodeToolbar`, which does not scale with the
 * viewport: the icons stay clickable however far the plan is zoomed out. It is
 * mounted only while visible (see `useNodeToolbarVisibility`), so at most a
 * couple of toolbars ever subscribe to the plan context.
 */

// ---------------------------------------------------------------------------
// Icons (Heroicons v2 outline, 24×24)
// ---------------------------------------------------------------------------

function Icon({ path, strokeWidth = 1.5, className = 'h-3.5 w-3.5' }: { path: string; strokeWidth?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

const PATH_BRUSH =
  'M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42';
const PATH_NOTE =
  'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10';
const PATH_ZOOM =
  'M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z';
const PATH_COPY =
  'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75';
const PATH_CARET = 'm19.5 8.25-7.5 7.5-7.5-7.5';

// ---------------------------------------------------------------------------
// Presentational toolbar (no context, no React Flow hooks)
// ---------------------------------------------------------------------------

const ITEM_BASE = `inline-flex h-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white ${FOCUS_RING}`;

/** The split button's halves sit on a shared hover background; each half still deepens it. */
const SPLIT_HOVER = 'hover:!bg-slate-200 dark:hover:!bg-slate-600';

type ItemKey = 'paint' | 'brush' | 'note' | 'zoom' | 'copy';
type PopoverKind = 'brush' | 'note';

export interface NodeActionToolbarViewProps {
  nodeId: number;
  operation: string;
  hasChildren: boolean;
  brush: HighlightBrush;
  /** The node's current highlight, if any. */
  highlight?: NodeHighlight;
  /** Style a legacy highlight (saved without one) is drawn in. */
  fallbackStyle: HighlightStyle;
  /** The node's note ('' when it has none). */
  note: string;
  /** False when annotation overlays are hidden: paint, brush and note would have no visible effect. */
  annotationTools: boolean;
  /** Ties the pill and its popovers together for "outside" detection. */
  surfaceId?: string;
  className?: string;
  /** Move focus to the first button (keyboard entry). */
  autoFocus?: boolean;
  onBrushChange: (patch: Partial<HighlightBrush>) => void;
  /** Toggle: paints with the brush, or clears the highlight when it already matches. */
  onPaint: () => void;
  /** Apply the brush to this node and keep it painted (the popover's "Paint #N"). */
  onSetHighlight: () => void;
  onClearHighlight: () => void;
  onSaveNote: (text: string) => void;
  onDeleteNote: () => void;
  onZoom: () => void;
  onCopy: () => void;
  onHoverChange?: (hovering: boolean) => void;
  /** Keyboard focus entered / left the pill or one of its popovers. */
  onFocusWithinChange?: (focused: boolean) => void;
  onPopoverOpenChange?: (open: boolean) => void;
  /** Escape on the pill: hide it. */
  onRequestClose?: () => void;
}

export function NodeActionToolbarView({
  nodeId,
  operation,
  hasChildren,
  brush,
  highlight,
  fallbackStyle,
  note,
  annotationTools,
  surfaceId: surfaceIdProp,
  className = '',
  autoFocus = false,
  onBrushChange,
  onPaint,
  onSetHighlight,
  onClearHighlight,
  onSaveNote,
  onDeleteNote,
  onZoom,
  onCopy,
  onHoverChange,
  onFocusWithinChange,
  onPopoverOpenChange,
  onRequestClose,
}: NodeActionToolbarViewProps) {
  const ownSurfaceId = useId();
  const surfaceId = surfaceIdProp ?? ownSurfaceId;
  const pillRef = useRef<HTMLDivElement | null>(null);
  const brushBtnRef = useRef<HTMLButtonElement | null>(null);
  const noteBtnRef = useRef<HTMLButtonElement | null>(null);

  const [openState, setOpenState] = useState<PopoverKind | null>(null);
  // Hidden annotation tools take their popovers with them
  const open = annotationTools ? openState : null;
  const [activeKey, setActiveKey] = useState<ItemKey>('paint');

  const onPopoverOpenChangeRef = useRef(onPopoverOpenChange);
  const popoverOpenRef = useRef(false);
  useEffect(() => {
    onPopoverOpenChangeRef.current = onPopoverOpenChange;
  });
  // The host keeps the toolbar visible while a popover is open; never leave it
  // believing one is (only when one really is: Strict Mode's mount-time
  // unmount/remount must stay silent).
  useEffect(
    () => () => {
      if (popoverOpenRef.current) onPopoverOpenChangeRef.current?.(false);
    },
    [],
  );

  const setPopover = useCallback((next: PopoverKind | null) => {
    setOpenState(next);
    popoverOpenRef.current = next !== null;
    onPopoverOpenChangeRef.current?.(next !== null);
  }, []);

  const closePopover = useCallback(
    (restoreFocus: boolean) => {
      const opener = open === 'note' ? noteBtnRef.current : brushBtnRef.current;
      setPopover(null);
      if (restoreFocus) opener?.focus({ preventScroll: true });
    },
    [open, setPopover],
  );

  const handlePopoverClose = (reason: PopoverCloseReason) => closePopover(reason === 'escape');

  // Keyboard entry (Shift+F10 / Menu key on the node): focus the first button
  const programmaticFocusRef = useRef(false);
  useEffect(() => {
    if (!autoFocus) return;
    const first = pillRef.current?.querySelector<HTMLElement>('[data-toolbar-item][tabindex="0"]');
    programmaticFocusRef.current = true;
    first?.focus({ preventScroll: true });
    programmaticFocusRef.current = false;
  }, [autoFocus]);

  const matches = highlightMatchesBrush(highlight, brush, fallbackStyle);
  const hasNote = note.trim() !== '';
  const paintLabel = paintButtonLabel(brush, matches);

  const keys: ItemKey[] = annotationTools ? ['paint', 'brush', 'note', 'zoom', 'copy'] : ['zoom', 'copy'];
  const rovingKey = keys.includes(activeKey) ? activeKey : keys[0];
  const itemProps = (key: ItemKey) => ({
    'data-toolbar-item': '',
    tabIndex: rovingKey === key ? 0 : -1,
    onFocus: () => setActiveKey(key),
  });

  const handlePillKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keys bubbling up from a popover (a React child, portalled elsewhere) are not ours
    if (e.currentTarget.contains(e.target as Node)) {
      const items = Array.from(pillRef.current?.querySelectorAll<HTMLElement>('[data-toolbar-item]') ?? []);
      const current = items.indexOf((e.target as Element).closest<HTMLElement>('[data-toolbar-item]') as HTMLElement);
      let target: HTMLElement | undefined;
      if (e.key === 'ArrowRight') target = items[(current + 1) % items.length];
      else if (e.key === 'ArrowLeft') target = items[(current - 1 + items.length) % items.length];
      else if (e.key === 'Home') target = items[0];
      else if (e.key === 'End') target = items[items.length - 1];
      if (target) {
        e.preventDefault();
        target.focus({ preventScroll: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (open) closePopover(true);
        else onRequestClose?.();
      }
    }
    stopKeyPropagation(e);
  };

  const handleFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    // A mouse click focuses the clicked button too; only keyboard focus keeps the toolbar up
    onFocusWithinChange?.(programmaticFocusRef.current || isFocusVisible(e.target));
  };
  const handleBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (surfaceIdOf(e.relatedTarget) === surfaceId) return;
    onFocusWithinChange?.(false);
  };

  const hex = brushHex(brush.color);

  return (
    <div
      ref={pillRef}
      role="toolbar"
      aria-label={`Actions for operation ${nodeId}`}
      data-node-action-surface={surfaceId}
      className={`nodrag nopan nowheel node-toolbar-enter flex items-center gap-0.5 rounded-lg border border-slate-200/90 bg-white/95 p-0.5 shadow-md backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95 ${className}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handlePillKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      {annotationTools && (
        <>
          {/* Split button: paint with the current brush | choose the brush */}
          <div className="flex items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-700">
            <button
              type="button"
              {...itemProps('paint')}
              aria-pressed={matches}
              aria-label={paintLabel}
              title={paintLabel}
              onClick={onPaint}
              className={`${ITEM_BASE} ${SPLIT_HOVER} w-6 rounded-r-none`}
            >
              <span className="flex flex-col items-center gap-px">
                <Icon path={PATH_BRUSH} />
                <span className="block h-[3px] w-3.5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: hex }} />
              </span>
            </button>
            <button
              ref={brushBtnRef}
              type="button"
              {...itemProps('brush')}
              aria-haspopup="dialog"
              aria-expanded={open === 'brush'}
              aria-label="Choose highlight brush"
              title="Choose highlight brush"
              onClick={() => setPopover(open === 'brush' ? null : 'brush')}
              className={`${ITEM_BASE} ${SPLIT_HOVER} w-4 rounded-l-none`}
            >
              <Icon path={PATH_CARET} strokeWidth={2} className="h-3 w-3" />
            </button>
          </div>

          <Separator />

          <button
            ref={noteBtnRef}
            type="button"
            {...itemProps('note')}
            aria-haspopup="dialog"
            aria-expanded={open === 'note'}
            aria-label={hasNote ? 'Edit note' : 'Add note'}
            title={hasNote ? 'Edit note' : 'Add note'}
            onClick={() => setPopover(open === 'note' ? null : 'note')}
            className={`${ITEM_BASE} relative w-6`}
          >
            <Icon path={PATH_NOTE} />
            {hasNote && (
              <span
                aria-hidden="true"
                data-note-badge=""
                className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400"
              />
            )}
          </button>

          <Separator />
        </>
      )}

      <button
        type="button"
        {...itemProps('zoom')}
        aria-label={hasChildren ? 'Zoom to subtree' : 'Zoom to operation'}
        title={hasChildren ? 'Zoom to subtree' : 'Zoom to operation'}
        onClick={onZoom}
        className={`${ITEM_BASE} w-6`}
      >
        <Icon path={PATH_ZOOM} />
      </button>
      <button
        type="button"
        {...itemProps('copy')}
        aria-label="Copy operation details"
        title="Copy operation details"
        onClick={onCopy}
        className={`${ITEM_BASE} w-6`}
      >
        <Icon path={PATH_COPY} />
      </button>

      {open === 'brush' && (
        <NodePopover anchorRef={brushBtnRef} surfaceId={surfaceId} label="Highlight brush" onClose={handlePopoverClose}>
          <BrushPicker
            brush={brush}
            nodeId={nodeId}
            hasHighlight={highlight !== undefined}
            onBrushChange={onBrushChange}
            onPaint={() => {
              onSetHighlight();
              closePopover(true);
            }}
            onClear={() => {
              onClearHighlight();
              closePopover(true);
            }}
          />
        </NodePopover>
      )}
      {open === 'note' && (
        <NodePopover anchorRef={noteBtnRef} surfaceId={surfaceId} label={`Note for operation ${nodeId}`} onClose={handlePopoverClose}>
          <NodeNoteEditor
            nodeId={nodeId}
            operation={operation}
            initialText={note}
            onSave={onSaveNote}
            onDelete={onDeleteNote}
            onClose={() => closePopover(true)}
          />
        </NodePopover>
      )}
    </div>
  );
}

function Separator() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-700" />;
}

// ---------------------------------------------------------------------------
// Container: context + React Flow wiring
// ---------------------------------------------------------------------------

/** Total overlap of the pill with the card's top edge: a 28px pill centred on it. */
const TOOLBAR_OFFSET = -14;

/** Ids of `node` and every descendant. */
function subtreeIds(node: PlanNode): number[] {
  const ids: number[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    ids.push(current.id);
    for (const child of current.children) stack.push(child);
  }
  return ids;
}

interface NodeActionToolbarProps {
  node: PlanNode;
  /** The plan slot this node's pane renders (tree-compare has two). */
  planIndex: number;
  hasActualStats?: boolean;
  /** Whether annotation overlays are shown (`showAnnotations` display option). */
  annotationsVisible: boolean;
  surfaceId?: string;
  autoFocus?: boolean;
  onHoverChange?: (hovering: boolean) => void;
  onFocusWithinChange?: (focused: boolean) => void;
  onPopoverOpenChange?: (open: boolean) => void;
  onRequestClose?: () => void;
}

export function NodeActionToolbar({
  node,
  planIndex,
  hasActualStats,
  annotationsVisible,
  ...hostProps
}: NodeActionToolbarProps) {
  const {
    highlightBrush,
    setHighlightBrush,
    highlightStyle,
    paintNodeWithBrush,
    getAnnotationsForPlan,
    setNodeHighlightForPlan,
    removeNodeHighlightForPlan,
    setNodeAnnotationForPlan,
    removeNodeAnnotationForPlan,
  } = usePlan();
  const { fitView } = useReactFlow();
  const reducedMotion = usePrefersReducedMotion();
  const toast = useToast();

  const annotations = getAnnotationsForPlan(planIndex);
  const highlight = annotations.nodeHighlights.get(node.id);
  const note = annotations.nodeAnnotations.get(node.id)?.text ?? '';

  const handleZoom = () => {
    // Collapsed (hidden) descendants are not in React Flow's node lookup and are ignored by fitView
    void fitView({
      nodes: subtreeIds(node).map((id) => ({ id: String(id) })),
      padding: 0.2,
      maxZoom: 1.25,
      duration: reducedMotion ? 0 : 300,
    });
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(formatNodeSummary(node, { hasActualStats, note }));
    if (ok) toast.show({ tone: 'success', message: `Copied operation #${node.id}` });
    else toast.show({ tone: 'error', message: `Could not copy operation #${node.id} to the clipboard.` });
  };

  return (
    <NodeToolbar
      isVisible
      position={Position.Top}
      align="end"
      offset={TOOLBAR_OFFSET}
      // The viewport (z-index 2) would otherwise paint nodes over the toolbar
      style={{ zIndex: 10 }}
      className="nodrag nopan nowheel pointer-events-none"
    >
      <NodeActionToolbarView
        nodeId={node.id}
        operation={node.operation}
        hasChildren={node.children.length > 0}
        brush={highlightBrush}
        highlight={highlight}
        fallbackStyle={highlightStyle}
        note={note}
        annotationTools={annotationsVisible}
        className="pointer-events-auto mr-3"
        onBrushChange={setHighlightBrush}
        onPaint={() => paintNodeWithBrush(planIndex, node.id)}
        onSetHighlight={() => setNodeHighlightForPlan(planIndex, node.id, highlightBrush.color, highlightBrush.style)}
        onClearHighlight={() => removeNodeHighlightForPlan(planIndex, node.id)}
        onSaveNote={(text) => setNodeAnnotationForPlan(planIndex, node.id, text)}
        onDeleteNote={() => removeNodeAnnotationForPlan(planIndex, node.id)}
        onZoom={handleZoom}
        onCopy={() => void handleCopy()}
        {...hostProps}
      />
    </NodeToolbar>
  );
}
