/**
 * Start-screen reassurance that plan data stays on this machine. The fine
 * print (localStorage, page-view counting) stays in the start-screen footer.
 */
export function PrivacyBadge() {
  return (
    <div className="flex max-w-md items-start gap-3 text-left">
      <svg
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500 dark:text-slate-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
      </svg>
      <div className="text-sm leading-5">
        <div className="text-slate-700 dark:text-slate-300">Your plans never leave this browser</div>
        <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
          Parsing, layout and analysis all run locally. Nothing is uploaded.
        </div>
      </div>
    </div>
  );
}
