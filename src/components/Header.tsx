import { useRef, useCallback, useState, useEffect } from 'react';
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
    exportPngFnRef,
    sharePlan,
    plans,
    viewMode,
    treeCompareEnabled,
  } = usePlan();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [shareError, setShareError] = useState<string | null>(null);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const handleExportPng = useCallback(async () => {
    const fn = exportPngFnRef.current;
    if (!fn) return;
    setExporting(true);
    try {
      await fn();
    } catch {
      // Silently fail — nothing critical
    } finally {
      setExporting(false);
    }
  }, [exportPngFnRef]);

  const handleShare = useCallback(async () => {
    const result = await sharePlan();
    if (result.ok) {
      setShareStatus('copied');
      setShareError(null);
    } else {
      setShareStatus('error');
      setShareError(result.error);
    }
  }, [sharePlan]);

  // Reset share status after a delay
  useEffect(() => {
    if (shareStatus === 'idle') return;
    const timer = setTimeout(() => {
      setShareStatus('idle');
      setShareError(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [shareStatus]);

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
  const hasAnyInput = plans.some((slot) => slot.rawInput.trim().length > 0);
  const canExportPng = parsedPlan !== null && viewMode === 'hierarchical' && !treeCompareEnabled;

  return (
    <header className="h-[52px] flex items-center justify-between gap-3 px-3 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center gap-2 min-w-0">
        <svg
          className="w-6 h-6 text-neutral-700 dark:text-neutral-300 shrink-0"
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
        <h1 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          Oracle Plan Visualizer
        </h1>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Load annotated plan */}
        <button
          onClick={handleLoad}
          className="h-8 w-8 flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          title="Load annotated plan (.json)"
        >
          <svg className="w-4 h-4 text-neutral-700 dark:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            className={`h-8 w-8 flex items-center justify-center rounded-md border transition-colors ${
              hasSomethingToSave
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700'
            }`}
            title="Save annotated plan (.json)"
          >
            <svg className={`w-4 h-4 ${hasSomethingToSave ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-700 dark:text-neutral-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        )}

        {/* Export as PNG */}
        <button
          onClick={handleExportPng}
          disabled={!canExportPng || exporting}
          className="h-8 w-8 flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Export plan as PNG"
        >
          <svg className="w-4 h-4 text-neutral-700 dark:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Share plan via URL */}
        <div className="relative">
          <button
            onClick={handleShare}
            disabled={!hasAnyInput}
            className={`h-8 w-8 flex items-center justify-center rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              shareStatus === 'copied'
                ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30'
                : shareStatus === 'error'
                  ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30'
                  : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700'
            }`}
            title={shareStatus === 'copied' ? 'URL copied to clipboard!' : shareStatus === 'error' ? shareError ?? 'Error' : 'Share plan via URL'}
          >
            {shareStatus === 'copied' ? (
              <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-neutral-700 dark:text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            )}
          </button>
          {shareStatus === 'error' && shareError && (
            <div className="absolute right-0 top-full mt-1 z-50 w-64 p-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-md shadow-lg">
              {shareError}
            </div>
          )}
        </div>

        <select
          value={colorScheme}
          onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
          className="h-8 px-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/60"
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
          className="h-8 w-8 flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? (
            <svg className="w-4 h-4 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          className="h-8 w-8 flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          title="View on GitHub"
        >
          <svg className="w-4 h-4 text-neutral-700 dark:text-neutral-300" fill="currentColor" viewBox="0 0 24 24">
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
