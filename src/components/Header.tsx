import { useRef, useCallback, useEffect, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { useAi } from '../hooks/useAiAnalysis';
import type { ColorScheme, AppPalette } from '../lib/types';
import { APP_PALETTE_LABELS, APP_PALETTE_ORDER } from '../lib/types';
import { hasAnnotations } from '../lib/annotations';

// Shared focus token for the header chrome. `focus-visible` only, so mouse
// clicks stay quiet and keyboard tabbing gets a clear ring.
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

const ICON_BTN =
  `h-8 w-8 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${FOCUS_RING}`;

const MENU_TRIGGER =
  `h-8 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${FOCUS_RING}`;

const MENU_ITEM =
  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed';

const MENU_SECTION_HEADER =
  'px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

const MENU_SEPARATOR = 'border-t border-slate-200 dark:border-slate-700 my-1';

const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  contrast: 'High Contrast',
  semantic: 'Semantic',
  estact: 'Est ⇄ Act',
  rail: 'Icon Rail',
  ticker: 'Ticker',
  stripe: 'Stripe',
  tinted: 'Tinted',
  terminal: 'Terminal',
};

// Below this the single top bar has no room for the full action cluster, so it
// folds into one "⋯" popover (every action stays reachable, just one click in).
const COMPACT_ACTIONS_QUERY = '(max-width: 1100px)';

function useCompactActions(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(COMPACT_ACTIONS_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

/**
 * Closes a panel on an outside mousedown or Escape. Shared by every menu
 * (File, Appearance, the compact "⋯" popover) so they all behave the same.
 */
function useOutsideDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref, onClose]);
}

/**
 * Glyph-only brand mark. The app title lives in the document `<title>` and in
 * this mark's tooltip — the merged top bar has no room for a wordmark.
 */
export function BrandMark() {
  return (
    <span
      className="shrink-0 flex items-center"
      title="Oracle Plan Visualizer"
      aria-label="Oracle Plan Visualizer"
      role="img"
    >
      <svg
        className="w-5 h-5 text-slate-500 dark:text-slate-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    </span>
  );
}

interface HeaderMenuProps {
  label: string;
  icon: React.ReactNode;
  title?: string;
  align?: 'left' | 'right';
  children: (close: () => void) => React.ReactNode;
}

/**
 * A small dropdown menu trigger + popover panel, used for the File and
 * Appearance groups. Closes itself on an outside click, Escape, or after an
 * item inside calls the `close` callback it hands to `children`.
 */
function HeaderMenu({ label, icon, title, align = 'right', children }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideDismiss(open, ref, close);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? label}
        className={open ? `${MENU_TRIGGER} bg-slate-100 dark:bg-slate-800` : MENU_TRIGGER}
      >
        {icon}
        <span>{label}</span>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 min-w-[15rem] p-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

function MenuSectionHeader({ children }: { children: React.ReactNode }) {
  return <div className={MENU_SECTION_HEADER}>{children}</div>;
}

function MenuSeparator() {
  return <div className={MENU_SEPARATOR} aria-hidden="true" />;
}

interface RadioRowProps {
  label: string;
  checked: boolean;
  onSelect: () => void;
}

function MenuRadioRow({ label, checked, onSelect }: RadioRowProps) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onSelect}
      className={MENU_ITEM}
    >
      <span className="w-3.5 shrink-0 flex items-center justify-center">
        {checked && (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

/**
 * The former app-header action cluster (import/export, PNG, share, command
 * palette, color scheme, theme, GitHub). Rendered inside the input panel's
 * header row now that the app is down to two chrome bars.
 */
export function HeaderActions() {
  const {
    theme,
    setTheme,
    colorScheme,
    setColorScheme,
    palette,
    setPalette,
    parsedPlan,
    annotations,
    hasUnsavedAnnotations,
    exportAnnotatedPlan,
    importAnnotatedPlan,
    exportPngFnRef,
    share,
    shareNotice,
    plans,
    viewMode,
    treeCompareEnabled,
    setCommandPaletteOpen,
    setReportDialogOpen,
    setShortcutsOverlayOpen,
    setBaselineDialogOpen,
    focusMode,
    setFocusMode,
  } = usePlan();
  const { openAiDialog } = useAi();
  const aiCompare = treeCompareEnabled && viewMode === 'compare';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const compact = useCompactActions();
  const [menuOpen, setMenuOpen] = useState(false);
  // `manual`/`warning`/`error` are shown in the App-level share dialog; the
  // button itself only needs to reflect the current outcome at a glance.
  const shareKind = shareNotice?.kind ?? null;
  const shareCopied = shareKind === 'copied' || shareKind === 'warning';

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

  const handleShare = useCallback(() => { void share(); }, [share]);

  // Close the compact popover on an outside click or Escape.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useOutsideDismiss(menuOpen, menuRef, closeMenu);

  useEffect(() => {
    if (!compact) setMenuOpen(false);
  }, [compact]);

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
  // Mirrors App's `focusModeActive`: focus mode is inert in the comparison
  // workspace, so the button must not advertise itself as on there.
  const focusModeApplies = viewMode !== 'compare';
  const focusModeOn = focusMode && focusModeApplies;

  const actions = (
    <>
      {/* File menu: import/export actions */}
      <HeaderMenu
        label="File"
        title="Import / export"
        icon={
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        }
      >
        {(close) => (
          <>
            <MenuSectionHeader>Import</MenuSectionHeader>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                handleLoad();
              }}
              className={MENU_ITEM}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>Load annotated plan (.json)</span>
            </button>

            <MenuSectionHeader>Export</MenuSectionHeader>
            {showSave && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  exportAnnotatedPlan();
                }}
                className={`${MENU_ITEM} relative`}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Save annotated plan (.json)</span>
                {hasSomethingToSave && (
                  <span
                    aria-hidden="true"
                    title="Unsaved changes"
                    className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0"
                  />
                )}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={!canExportPng || exporting}
              onClick={() => {
                close();
                void handleExportPng();
              }}
              className={MENU_ITEM}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Plan as PNG</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={parsedPlan === null}
              onClick={() => {
                close();
                setReportDialogOpen(true);
              }}
              className={MENU_ITEM}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Client report (.html / PDF)</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={parsedPlan === null}
              onClick={() => {
                close();
                setBaselineDialogOpen(true);
              }}
              className={MENU_ITEM}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M4 8h16M5 8h14a1 1 0 011 1v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9a1 1 0 011-1z" />
              </svg>
              <span>SQL Plan Baseline script…</span>
            </button>
          </>
        )}
      </HeaderMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* AI analysis */}
      <button
        onClick={() => openAiDialog(aiCompare ? 'compare' : 'analyze')}
        disabled={parsedPlan === null}
        className={`h-8 px-3 flex items-center gap-1.5 rounded-md text-xs font-semibold bg-slate-800 text-slate-100 hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING}`}
        title={aiCompare ? 'AI compare plans (Beta)…' : 'AI plan analysis (Beta)…'}
        aria-label="AI plan analysis (Beta)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
        <span>Analyze</span>
      </button>

      {/* Share plan via URL */}
      <button
        onClick={handleShare}
        disabled={!hasAnyInput}
        className={
          shareCopied
            ? `h-8 w-8 flex items-center justify-center rounded-md bg-green-50 dark:bg-green-900/30 transition-colors ${FOCUS_RING}`
            : shareKind === 'error'
              ? `h-8 w-8 flex items-center justify-center rounded-md text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 transition-colors ${FOCUS_RING}`
              : shareKind === 'manual'
                ? `h-8 w-8 flex items-center justify-center rounded-md text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 transition-colors ${FOCUS_RING}`
                : `${ICON_BTN} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400`
        }
        aria-label="Share plan via URL"
        title={
          shareKind === 'copied' ? 'URL copied to clipboard!'
            : shareKind === 'warning' ? 'URL copied — verify the full link pasted'
            : shareKind === 'manual' ? 'Copy the link manually'
            : shareKind === 'error' ? 'Could not build a share link'
            : 'Share plan via URL'
        }
      >
        {shareCopied ? (
          <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        )}
      </button>

      <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden="true" />

      {/* Focus mode — docked side panels give way to floating instruments.
          The comparison workspace has no docked panels to trade away, so the
          toggle reads as unavailable there rather than as a no-op. */}
      <button
        onClick={() => setFocusMode(!focusMode)}
        disabled={parsedPlan === null || !focusModeApplies}
        aria-pressed={focusModeOn}
        className={
          focusModeOn
            ? `h-8 w-8 flex items-center justify-center rounded-md text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-300 dark:ring-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 motion-safe:transition-colors ${FOCUS_RING}`
            : `${ICON_BTN} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400`
        }
        title={
          !focusModeApplies
            ? 'Focus mode is unavailable in the comparison workspace'
            : focusMode
              ? 'Exit focus mode (z)'
              : 'Focus mode (z)'
        }
        aria-label="Focus mode"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V6a2 2 0 012-2h2m8 0h2a2 2 0 012 2v2m0 8v2a2 2 0 01-2 2h-2m-8 0H6a2 2 0 01-2-2v-2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 12a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      </button>

      {/* Command palette */}
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${FOCUS_RING}`}
        title="Command palette — search every action and setting"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <kbd className="text-[10px] font-semibold">{navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl+K'}</kbd>
      </button>

      <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden="true" />

      {/* Appearance menu: theme, graph colors, app palette */}
      <HeaderMenu
        label="Appearance"
        title="Appearance"
        icon={
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        }
      >
        {(close) => (
          <>
            <MenuSectionHeader>Theme</MenuSectionHeader>
            <MenuRadioRow
              label="Light"
              checked={theme === 'light'}
              onSelect={() => {
                setTheme('light');
                close();
              }}
            />
            <MenuRadioRow
              label="Dark"
              checked={theme === 'dark'}
              onSelect={() => {
                setTheme('dark');
                close();
              }}
            />

            <MenuSectionHeader>Graph Colors</MenuSectionHeader>
            {Object.entries(COLOR_SCHEME_LABELS).map(([value, label]) => (
              <MenuRadioRow
                key={value}
                label={label}
                checked={colorScheme === value}
                onSelect={() => {
                  setColorScheme(value as ColorScheme);
                  close();
                }}
              />
            ))}

            <MenuSectionHeader>App Palette</MenuSectionHeader>
            {APP_PALETTE_ORDER.map((value) => (
              <MenuRadioRow
                key={value}
                label={APP_PALETTE_LABELS[value]}
                checked={palette === value}
                onSelect={() => {
                  setPalette(value as AppPalette);
                  close();
                }}
              />
            ))}

            <MenuSeparator />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                setShortcutsOverlayOpen(true);
              }}
              className={MENU_ITEM}
            >
              <span>Keyboard shortcuts</span>
            </button>
            <a
              href="https://github.com/davidbudac/ora-explain-plan-viz"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              onClick={close}
              className={MENU_ITEM}
            >
              <span>View on GitHub ↗</span>
            </a>
          </>
        )}
      </HeaderMenu>
    </>
  );

  if (!compact) {
    return <div className="flex items-center gap-1.5 shrink-0">{actions}</div>;
  }

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="More actions"
        title="More actions"
        className={
          menuOpen
            ? `h-8 w-8 flex items-center justify-center rounded-md text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 motion-safe:transition-colors ${FOCUS_RING}`
            : ICON_BTN
        }
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 p-1.5 flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50"
        >
          {actions}
        </div>
      )}
    </div>
  );
}
