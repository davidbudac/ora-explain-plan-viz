import { useRef, useCallback } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import type { ColorScheme } from '../lib/types';
import { hasAnnotations } from '../lib/annotations';

const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  muted: 'Muted',
  professional: 'Professional',
  vibrant: 'Vibrant',
  monochrome: 'Monochrome',
};

export function Header() {
  const {
    theme,
    setTheme,
    colorScheme,
    setColorScheme,
    parsedPlan,
    annotations,
    hasUnsavedAnnotations,
    exportAnnotatedPlan,
    importAnnotatedPlan,
  } = usePlan();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const handleLoad = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        importAnnotatedPlan(file);
      }
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [importAnnotatedPlan]
  );

  const showSave = parsedPlan !== null;
  const hasSomethingToSave = showSave && (hasAnnotations(annotations) || hasUnsavedAnnotations);

  return (
    <header className="h-12 flex items-center justify-between gap-3 px-3 bg-[var(--surface)] dark:bg-[var(--surface-dark)] border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)] shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <svg
          className="w-6 h-6 text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <h1 className="text-[14px] font-bold text-cyan-600 dark:text-cyan-400 truncate">
          Oracle Plan Visualizer
        </h1>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Load annotated plan */}
        <button
          onClick={handleLoad}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] dark:border-[var(--border-color-dark)] bg-[var(--surface-raised)] dark:bg-[var(--surface-card-dark)] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          title="Load annotated plan (.json)"
        >
          <svg className="w-4 h-4 text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Save annotated plan */}
        {showSave && (
          <button
            onClick={exportAnnotatedPlan}
            className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-colors ${
              hasSomethingToSave
                ? 'border-cyan-300 dark:border-cyan-700 bg-cyan-50 dark:bg-cyan-900/30 hover:bg-cyan-100 dark:hover:bg-cyan-900/50'
                : 'border-[var(--border-color)] dark:border-[var(--border-color-dark)] bg-[var(--surface-raised)] dark:bg-[var(--surface-card-dark)] hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
            title="Save annotated plan (.json)"
          >
            <svg className={`w-4 h-4 ${hasSomethingToSave ? 'text-cyan-600 dark:text-cyan-400' : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        )}

        <select
          value={colorScheme}
          onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
          className="h-8 px-2.5 rounded-lg border border-[var(--border-color)] dark:border-[var(--border-color-dark)] bg-[var(--surface-raised)] dark:bg-[var(--surface-card-dark)] text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
          title="Graph color palette"
        >
          {Object.entries(COLOR_SCHEME_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <button
          onClick={toggleTheme}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] dark:border-[var(--border-color-dark)] bg-[var(--surface-raised)] dark:bg-[var(--surface-card-dark)] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? (
            <svg className="w-4 h-4 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          )}
        </button>

        <a
          href="https://github.com/davidbudac/ora-explain-plan-viz"
          target="_blank"
          rel="noopener noreferrer"
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--border-color)] dark:border-[var(--border-color-dark)] bg-[var(--surface-raised)] dark:bg-[var(--surface-card-dark)] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          title="View on GitHub"
        >
          <svg className="w-4 h-4 text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]" fill="currentColor" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"
            />
          </svg>
        </a>
      </div>
    </header>
  );
}
