/**
 * Start-screen reassurance that plan data stays on this machine. The fine
 * print (localStorage, page-view counting) stays in the start-screen footer.
 */
export function PrivacyBadge() {
  return (
    <div
      data-testid="privacy-badge"
      className="mb-5 flex max-w-md items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-left text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200"
    >
      <svg
        className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
      </svg>
      <div className="text-sm leading-snug">
        <div className="font-semibold">Private by design: your plans never leave this browser.</div>
        <div className="text-xs text-emerald-800/90 dark:text-emerald-300/80">
          Parsing, layout and analysis all run locally. Nothing is uploaded.
        </div>
      </div>
    </div>
  );
}
