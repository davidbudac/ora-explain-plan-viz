import type { ViewMode } from '../lib/types';

/**
 * Outline-icon path for each view mode. Shared by the nav ribbon tabs and the
 * command palette so a view looks the same wherever it is offered.
 */
const VIEW_ICON_PATHS: Record<ViewMode, string> = {
  hierarchical:
    'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
  compare:
    'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  tabular: 'M3 10h18M3 14h18M3 6h18M3 18h18M9 6v12M15 6v12',
  sankey: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16',
  flame: 'M12 2c1 3-2 4-2 7a2 2 0 004 0c1 1 2 2.5 2 4.5A6 6 0 016 13.5c0-3 1.5-4.5 3-7 .5 1.5 1.5 2 2 1.5C10.5 6 11 4 12 2z',
  text: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  sql: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
  metadata: 'M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2zm0 0v10c0 1.1 3.6 2 8 2s8-.9 8-2V7M4 12c0 1.1 3.6 2 8 2s8-.9 8-2',
  monitor:
    'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  experimental:
    'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
  ai: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  'ai-report': 'M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM18 15l.9 2.3 2.3.9-2.3.9L18 21.4l-.9-2.3-2.3-.9 2.3-.9L18 15z',
};

/** Renders a stroke icon from any of the shared outline paths above. */
export function OutlineIcon({ path, className = 'w-4 h-4' }: { path: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
    </svg>
  );
}

export function ViewIcon({ mode, className }: { mode: ViewMode; className?: string }) {
  return <OutlineIcon path={VIEW_ICON_PATHS[mode]} className={className} />;
}

export { VIEW_ICON_PATHS };
