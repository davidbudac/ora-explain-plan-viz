const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

interface PanelEdgeTabProps {
  /** Which canvas seam the tab is attached to — i.e. which panel it collapses. */
  side: 'left' | 'right';
  label: string;
  onClick: () => void;
}

/**
 * Small tab riding the canvas seam that collapses the adjoining panel. It sits
 * inside the (relative) canvas `<main>` and replaces the old in-header chevron
 * buttons, so the panel headers stay free of furniture. At rest it is a bare
 * chevron; hover/focus reveals the label. Reopening is handled by the panels'
 * own collapsed rails.
 */
export function PanelEdgeTab({ side, label, onClick }: PanelEdgeTabProps) {
  const isLeft = side === 'left';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={true}
      className={`group absolute top-1/2 -translate-y-1/2 z-30 h-16 min-w-[18px] max-w-[18px] hover:max-w-[150px] focus-visible:max-w-[150px] hover:px-2 focus-visible:px-2 flex items-center justify-center gap-1.5 overflow-hidden shadow-sm
        bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600
        text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-100
        hover:bg-slate-50 dark:hover:bg-slate-700
        motion-safe:transition-all motion-safe:duration-150
        ${isLeft ? 'left-0 border-l-0 rounded-r-lg' : 'right-0 border-r-0 rounded-l-lg'}
        ${FOCUS_RING}`}
    >
      <svg
        className="shrink-0 w-3 h-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={isLeft ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'}
        />
      </svg>
      <span className="max-w-0 opacity-0 group-hover:max-w-[90px] group-hover:opacity-100 group-focus-visible:max-w-[90px] group-focus-visible:opacity-100 motion-safe:transition-all motion-safe:duration-150 whitespace-nowrap text-[11px] font-semibold">
        {label}
      </span>
    </button>
  );
}
