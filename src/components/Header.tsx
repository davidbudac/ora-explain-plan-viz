import { useRef, useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import type { ColorScheme, AppPalette } from '../lib/types';
import { APP_PALETTE_LABELS, APP_PALETTE_ORDER } from '../lib/types';
import { hasAnnotations } from '../lib/annotations';
import { FOCUS_RING, FOCUS_RING_INSET, useMenuKeyboard, useToast } from './ui';
import { runPngExport, PNG_EXPORT_UNAVAILABLE_HINT } from '../lib/actionFeedback';
import { TOP_BAR_LABEL_ATTR, useTopBarMode } from '../hooks/useTopBarMode';
import { openPlanFilePicker, OPEN_FILE_SHORTCUT_LABEL } from '../lib/filePicker';
import { copyPlanAsMarkdown } from '../lib/planMarkdown';

const ICON_BTN =
  `h-8 w-8 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${FOCUS_RING}`;

const MENU_TRIGGER =
  `h-8 px-2 flex items-center gap-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${FOCUS_RING}`;

const MENU_ITEM =
  `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING_INSET}`;

const MENU_PANEL =
  'absolute top-full mt-1 min-w-[15rem] max-h-[min(80vh,40rem)] overflow-y-auto p-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50';

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

const GITHUB_URL = 'https://github.com/davidbudac/ora-explain-plan-viz';
// Same page the start screen's "Read the docs" link opens: how to get a plan
// (and a ready-made link) out of the database.
const GETTING_A_PLAN_URL = 'https://github.com/davidbudac/ora-explain-plan-viz/blob/main/scripts/README.md#plan_to_urlsql';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const PALETTE_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl+K';

// Below this the single top bar has no room for the full action cluster, so it
// folds into one "⋯" menu (every action stays reachable, just one click in).
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

/** Closes a menu on an outside mousedown (Escape is handled by the menu itself). */
function useOutsideDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current && !ref.current.contains(target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
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
        aria-hidden="true"
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

function Chevron({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ItemIcon({ d }: { d: string }) {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
}

const ICON_PATHS = {
  file: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  appearance: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01',
  help: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  upload: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  camera: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z',
  calendar: 'M9 3v2m6-2v2M4 8h16M5 8h14a1 1 0 011 1v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9a1 1 0 011-1z',
  share: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z',
  focus: 'M4 8V6a2 2 0 012-2h2m8 0h2a2 2 0 012 2v2m0 8v2a2 2 0 01-2 2h-2m-8 0H6a2 2 0 01-2-2v-2 M14 12a2 2 0 11-4 0 2 2 0 014 0z',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  tour: 'M5 3v18M5 4h11l-2 4 2 4H5',
  keyboard: 'M4 7h16a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z M7 10h.01M11 10h.01M15 10h.01M8 14h8',
  book: 'M12 6.253v13C10.832 18.477 9.246 18 7.5 18S4.168 18.477 3 19.253v-13C4.168 5.477 5.754 5 7.5 5s3.332.477 4.5 1.253zm0 0C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  external: 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14',
  back: 'M15 19l-7-7 7-7',
  forward: 'M9 5l7 7-7 7',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
} as const;

/**
 * Wires a `role="menu"` panel: keyboard behaviour from `useMenuKeyboard`
 * (arrows, Home/End, Escape → close and return focus to the trigger), Tab
 * closes, focus moves into the menu on open, outside clicks close.
 */
function useHeaderMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const closeAndReturnFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const { menuProps, focusFirst } = useMenuKeyboard<HTMLDivElement>({ onClose: closeAndReturnFocus });
  useOutsideDismiss(open, containerRef, close);

  useEffect(() => {
    if (open) focusFirst();
  }, [open, focusFirst]);

  const panelProps = {
    ...menuProps,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Tab') setOpen(false);
      menuProps.onKeyDown(event);
    },
  };

  return { open, setOpen, close, containerRef, triggerRef, panelProps, focusFirst };
}

interface HeaderMenuProps {
  label: string;
  icon: ReactNode;
  title?: string;
  align?: 'left' | 'right';
  /** Hide the text label (icon + chevron only); the trigger keeps its accessible name. */
  labelCollapsed: boolean;
  children: (close: () => void) => ReactNode;
}

/**
 * A dropdown menu trigger + popover panel, used for File, Appearance and Help.
 * Its text label collapses to the icon when the top bar needs the room for the
 * view ribbon (see `useTopBarMode`).
 */
function HeaderMenu({ label, icon, title, align = 'right', labelCollapsed, children }: HeaderMenuProps) {
  const { open, setOpen, close, containerRef, triggerRef, panelProps } = useHeaderMenu();
  const labelProps = { [TOP_BAR_LABEL_ATTR]: '' };

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        className={open ? `${MENU_TRIGGER} bg-slate-100 dark:bg-slate-800` : MENU_TRIGGER}
      >
        {icon}
        <span {...labelProps} className={labelCollapsed ? 'sr-only' : ''}>{label}</span>
        {/* Part of the collapsible label: an icon-only trigger drops its chevron too. */}
        <span {...labelProps} className={labelCollapsed ? 'sr-only' : ''}><Chevron /></span>
      </button>
      {open && (
        <div {...panelProps} aria-label={label} className={`${MENU_PANEL} ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

function MenuSectionHeader({ children }: { children: ReactNode }) {
  return <div className={MENU_SECTION_HEADER} role="presentation">{children}</div>;
}

function MenuSeparator() {
  return <div className={MENU_SEPARATOR} role="separator" />;
}

function MenuItem({
  onSelect,
  icon,
  disabled,
  title,
  children,
  haspopup,
}: {
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
  haspopup?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      title={title}
      aria-haspopup={haspopup ? 'menu' : undefined}
      onClick={onSelect}
      className={MENU_ITEM}
    >
      {icon ?? <span className="w-3.5 shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}

function MenuLink({ href, icon, onSelect, children }: { href: string; icon: ReactNode; onSelect: () => void; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      role="menuitem"
      tabIndex={-1}
      onClick={onSelect}
      className={MENU_ITEM}
    >
      {icon}
      <span className="flex-1">{children}</span>
      <ItemIcon d={ICON_PATHS.external} />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function CheckGlyph({ checked }: { checked: boolean }) {
  return (
    <span className="w-3.5 shrink-0 flex items-center justify-center" aria-hidden="true">
      {checked && (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  );
}

function MenuRadioRow({ label, checked, onSelect }: { label: string; checked: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} tabIndex={-1} onClick={onSelect} className={MENU_ITEM}>
      <CheckGlyph checked={checked} />
      <span>{label}</span>
    </button>
  );
}

function MenuCheckboxRow({
  label,
  checked,
  disabled,
  title,
  onSelect,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      tabIndex={-1}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={MENU_ITEM}
    >
      <CheckGlyph checked={checked} />
      <span>{label}</span>
    </button>
  );
}

type CompactView = 'root' | 'file' | 'appearance' | 'help';

/**
 * The app-header action cluster (import/export, PNG, share, command palette,
 * appearance, help), rendered at the right of the single top bar. Below
 * 1100px it folds into one "⋯" menu whose File / Appearance / Help entries
 * drill into the same items.
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
    loadFiles,
    exportPngFnRef,
    share,
    shareNotice,
    plans,
    viewMode,
    treeCompareEnabled,
    setCommandPaletteOpen,
    setReportDialogOpen,
    setShortcutsOverlayOpen,
    startWalkthrough,
    setBaselineDialogOpen,
    focusMode,
    setFocusMode,
    legendVisible,
    setLegendVisible,
  } = usePlan();
  const toast = useToast();
  const { labelsCollapsed } = useTopBarMode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const compact = useCompactActions();
  const compactMenu = useHeaderMenu();
  const [compactView, setCompactView] = useState<CompactView>('root');
  // `manual`/`warning`/`error` are shown in the App-level share dialog and
  // every outcome raises a toast (see CommandPalette); the button itself only
  // flashes the current outcome at a glance.
  const shareKind = shareNotice?.kind ?? null;
  const shareCopied = shareKind === 'copied' || shareKind === 'warning';

  const handleExportPng = useCallback(async () => {
    setExporting(true);
    try {
      await runPngExport(exportPngFnRef.current, toast.show);
    } finally {
      setExporting(false);
    }
  }, [exportPngFnRef, toast]);

  const handleShare = useCallback(() => { void share(); }, [share]);

  const { setOpen: setCompactOpen, focusFirst: focusFirstCompact } = compactMenu;
  useEffect(() => {
    if (!compact) setCompactOpen(false);
  }, [compact, setCompactOpen]);

  // Drilling in/out of a section re-renders the menu's items: put focus on
  // the first one again so keyboard users never lose their place.
  useEffect(() => {
    if (compactMenu.open) focusFirstCompact();
  }, [compactView, compactMenu.open, focusFirstCompact]);

  const handleLoad = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenPlanFile = useCallback(() => {
    openPlanFilePicker((files) => { void loadFiles(files); });
  }, [loadFiles]);

  const handleCopyMarkdown = useCallback(() => {
    if (parsedPlan) void copyPlanAsMarkdown(parsedPlan, toast.show);
  }, [parsedPlan, toast]);

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
  const focusModeTitle = !focusModeApplies
    ? 'Focus mode is unavailable in the comparison workspace'
    : focusMode
      ? 'Exit focus mode (z)'
      : 'Focus mode (z)';

  const fileItems = (close: () => void) => (
    <>
      <MenuSectionHeader>Import</MenuSectionHeader>
      <MenuItem
        icon={<ItemIcon d={ICON_PATHS.folder} />}
        title="Load a plan, SQL Monitor report, JSON plan or metadata bundle from a file — same as dropping it on the window"
        onSelect={() => { close(); handleOpenPlanFile(); }}
      >
        <span className="flex-1">Open plan file…</span>
        <kbd className="text-[10px] text-slate-400 dark:text-slate-500">{OPEN_FILE_SHORTCUT_LABEL}</kbd>
      </MenuItem>
      <MenuItem icon={<ItemIcon d={ICON_PATHS.upload} />} onSelect={() => { close(); handleLoad(); }}>
        <span>Load annotated plan (.json)</span>
      </MenuItem>

      <MenuSectionHeader>Export</MenuSectionHeader>
      {showSave && (
        <MenuItem icon={<ItemIcon d={ICON_PATHS.download} />} onSelect={() => { close(); exportAnnotatedPlan(); }}>
          <span>Save annotated plan (.json)</span>
          {hasSomethingToSave && (
            <>
              <span aria-hidden="true" title="Unsaved changes" className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
              <span className="sr-only">(unsaved changes)</span>
            </>
          )}
        </MenuItem>
      )}
      <MenuItem
        icon={<ItemIcon d={ICON_PATHS.clipboard} />}
        disabled={parsedPlan === null}
        onSelect={() => { close(); handleCopyMarkdown(); }}
      >
        <span>Copy plan as Markdown</span>
      </MenuItem>
      <MenuItem
        icon={<ItemIcon d={ICON_PATHS.camera} />}
        disabled={!canExportPng || exporting}
        title={canExportPng ? undefined : PNG_EXPORT_UNAVAILABLE_HINT}
        onSelect={() => { close(); void handleExportPng(); }}
      >
        <span>Plan as PNG</span>
      </MenuItem>
      <MenuItem
        icon={<ItemIcon d={ICON_PATHS.file} />}
        disabled={parsedPlan === null}
        onSelect={() => { close(); setReportDialogOpen(true); }}
      >
        <span>Client report (.html / PDF)</span>
      </MenuItem>
      <MenuItem
        icon={<ItemIcon d={ICON_PATHS.calendar} />}
        disabled={parsedPlan === null}
        onSelect={() => { close(); setBaselineDialogOpen(true); }}
      >
        <span>SQL Plan Baseline / Patch script…</span>
      </MenuItem>
    </>
  );

  const appearanceItems = (close: () => void) => (
    <>
      <MenuSectionHeader>Theme</MenuSectionHeader>
      <MenuRadioRow label="Light" checked={theme === 'light'} onSelect={() => { setTheme('light'); close(); }} />
      <MenuRadioRow label="Dark" checked={theme === 'dark'} onSelect={() => { setTheme('dark'); close(); }} />

      <MenuSectionHeader>Graph Colors</MenuSectionHeader>
      {Object.entries(COLOR_SCHEME_LABELS).map(([value, label]) => (
        <MenuRadioRow
          key={value}
          label={label}
          checked={colorScheme === value}
          onSelect={() => { setColorScheme(value as ColorScheme); close(); }}
        />
      ))}

      <MenuSectionHeader>App Palette</MenuSectionHeader>
      {APP_PALETTE_ORDER.map((value) => (
        <MenuRadioRow
          key={value}
          label={APP_PALETTE_LABELS[value]}
          checked={palette === value}
          onSelect={() => { setPalette(value as AppPalette); close(); }}
        />
      ))}

      <MenuSeparator />
      <MenuCheckboxRow
        label="Legend"
        checked={legendVisible}
        disabled={parsedPlan === null}
        title="Colour and badge key for the Tree, Tabular, Sankey and Flame views"
        onSelect={() => { setLegendVisible(!legendVisible); close(); }}
      />
    </>
  );

  const helpItems = (close: () => void) => (
    <>
      <MenuItem icon={<ItemIcon d={ICON_PATHS.tour} />} onSelect={() => { close(); void startWalkthrough(); }}>
        <span className="flex-1">Walkthrough</span>
      </MenuItem>
      <MenuItem icon={<ItemIcon d={ICON_PATHS.keyboard} />} onSelect={() => { close(); setShortcutsOverlayOpen(true); }}>
        <span className="flex-1">Keyboard shortcuts</span>
        <kbd className="text-[10px] text-slate-400 dark:text-slate-500">?</kbd>
      </MenuItem>
      <MenuLink href={GETTING_A_PLAN_URL} icon={<ItemIcon d={ICON_PATHS.book} />} onSelect={close}>
        Getting a plan
      </MenuLink>
      <MenuLink href={GITHUB_URL} icon={<ItemIcon d={ICON_PATHS.external} />} onSelect={close}>
        View on GitHub
      </MenuLink>
    </>
  );

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".json"
      onChange={handleFileChange}
      className="hidden"
      tabIndex={-1}
      aria-hidden="true"
    />
  );

  if (!compact) {
    const labelProps = { [TOP_BAR_LABEL_ATTR]: '' };
    return (
      <div data-tour="actions" className="flex items-center gap-1.5 shrink-0">
        <HeaderMenu label="File" title="Import / export" labelCollapsed={labelsCollapsed} icon={<ItemIcon d={ICON_PATHS.file} />}>
          {fileItems}
        </HeaderMenu>
        {fileInput}

        {/* Share plan via URL. The outcome is also announced by a toast. */}
        <button
          type="button"
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
            <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_PATHS.share} />
            </svg>
          )}
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden="true" />

        {/* Focus mode — docked side panels give way to floating instruments.
            The comparison workspace has no docked panels to trade away, so the
            toggle reads as unavailable there rather than as a no-op. */}
        <button
          type="button"
          onClick={() => setFocusMode(!focusMode)}
          disabled={parsedPlan === null || !focusModeApplies}
          aria-pressed={focusModeOn}
          className={
            focusModeOn
              ? `h-8 w-8 flex items-center justify-center rounded-md text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-300 dark:ring-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 motion-safe:transition-colors ${FOCUS_RING}`
              : `${ICON_BTN} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400`
          }
          title={focusModeTitle}
          aria-label="Focus mode"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_PATHS.focus} />
          </svg>
        </button>

        {/* Command palette */}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Open command palette"
          data-tour="palette"
          aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}
          className={`h-8 px-2 flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${FOCUS_RING}`}
          title={`Command palette (${PALETTE_SHORTCUT}) — search every action and setting`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_PATHS.search} />
          </svg>
          <kbd {...labelProps} className={`text-[10px] font-semibold ${labelsCollapsed ? 'sr-only' : ''}`}>{PALETTE_SHORTCUT}</kbd>
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden="true" />

        <HeaderMenu label="Appearance" labelCollapsed={labelsCollapsed} icon={<ItemIcon d={ICON_PATHS.appearance} />}>
          {appearanceItems}
        </HeaderMenu>
        <HeaderMenu label="Help" labelCollapsed={labelsCollapsed} icon={<ItemIcon d={ICON_PATHS.help} />}>
          {helpItems}
        </HeaderMenu>
      </div>
    );
  }

  const { open: menuOpen, containerRef, triggerRef, panelProps } = compactMenu;
  const closeCompact = () => {
    setCompactOpen(false);
    setCompactView('root');
  };
  const sectionTitle: Record<Exclude<CompactView, 'root'>, string> = { file: 'File', appearance: 'Appearance', help: 'Help' };

  return (
    <div data-tour="actions" className="relative shrink-0" ref={containerRef}>
      {fileInput}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setCompactView('root');
          setCompactOpen(!menuOpen);
        }}
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
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
      </button>
      {menuOpen && (
        <div
          {...panelProps}
          aria-label={compactView === 'root' ? 'More actions' : sectionTitle[compactView]}
          onKeyDown={(event) => {
            // Left arrow backs out of a section, like a submenu.
            if (event.key === 'ArrowLeft' && compactView !== 'root') {
              event.preventDefault();
              setCompactView('root');
              return;
            }
            panelProps.onKeyDown(event);
          }}
          className={`${MENU_PANEL} right-0`}
        >
          {compactView === 'root' ? (
            <>
              <MenuItem icon={<ItemIcon d={ICON_PATHS.share} />} disabled={!hasAnyInput} onSelect={() => { closeCompact(); handleShare(); }}>
                <span>Share plan via URL</span>
              </MenuItem>
              <MenuCheckboxRow
                label="Focus mode"
                checked={focusModeOn}
                disabled={parsedPlan === null || !focusModeApplies}
                title={focusModeTitle}
                onSelect={() => { closeCompact(); setFocusMode(!focusMode); }}
              />
              <MenuItem icon={<ItemIcon d={ICON_PATHS.search} />} onSelect={() => { closeCompact(); setCommandPaletteOpen(true); }}>
                <span className="flex-1">Command palette</span>
                <kbd className="text-[10px] text-slate-400 dark:text-slate-500">{PALETTE_SHORTCUT}</kbd>
              </MenuItem>
              <MenuSeparator />
              {(['file', 'appearance', 'help'] as const).map((view) => (
                <MenuItem
                  key={view}
                  haspopup
                  icon={<ItemIcon d={ICON_PATHS[view]} />}
                  onSelect={() => setCompactView(view)}
                >
                  <span className="flex-1">{sectionTitle[view]}</span>
                  <ItemIcon d={ICON_PATHS.forward} />
                </MenuItem>
              ))}
            </>
          ) : (
            <>
              <MenuItem icon={<ItemIcon d={ICON_PATHS.back} />} onSelect={() => setCompactView('root')}>
                <span className="sr-only">Back to all actions from </span>
                <span className="font-semibold">{sectionTitle[compactView]}</span>
              </MenuItem>
              <MenuSeparator />
              {compactView === 'file' && fileItems(closeCompact)}
              {compactView === 'appearance' && appearanceItems(closeCompact)}
              {compactView === 'help' && helpItems(closeCompact)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
