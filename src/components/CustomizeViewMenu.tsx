import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FilterState, NodeDisplayOptions } from '../lib/types';

type CommandSection = 'Behavior' | 'Node fields' | 'Runtime fields' | 'Warning badges' | 'Annotations';

type NodeOptionKey =
  | 'showObjectName'
  | 'showRows'
  | 'showCost'
  | 'showBytes'
  | 'showPredicateIndicators'
  | 'showPredicateDetails'
  | 'showQueryBlockBadge'
  | 'showQueryBlockGrouping'
  | 'showActualRows'
  | 'showActualTime'
  | 'showStarts'
  | 'showHotspotBadge'
  | 'showSpillBadge'
  | 'showCardinalityBadge'
  | 'showAnnotations';

type CommandKey = 'animateEdges' | 'focusSelection' | NodeOptionKey;

interface ViewCommand {
  key: CommandKey;
  section: CommandSection;
  label: string;
  keywords: string[];
  runtimeOnly?: boolean;
}

interface CustomizeViewMenuProps {
  filters: FilterState;
  setFilters: (filters: Partial<FilterState>) => void;
  hasActualStats: boolean;
  defaultNodeDisplayOptions: NodeDisplayOptions;
}

const SECTION_ORDER: CommandSection[] = ['Behavior', 'Node fields', 'Runtime fields', 'Warning badges', 'Annotations'];

function buildCommands(hasActualStats: boolean): ViewCommand[] {
  return [
    {
      key: 'animateEdges',
      section: 'Behavior',
      label: 'Animate edges',
      keywords: ['animate', 'edges', 'motion', 'flow'],
    },
    {
      key: 'focusSelection',
      section: 'Behavior',
      label: 'Focus selection path',
      keywords: ['focus', 'selection', 'path', 'highlight'],
    },
    {
      key: 'showObjectName',
      section: 'Node fields',
      label: 'Object name',
      keywords: ['object', 'name', 'table'],
    },
    {
      key: 'showRows',
      section: 'Node fields',
      label: hasActualStats ? 'E-Rows' : 'Rows',
      keywords: ['rows', 'estimated', 'e-rows'],
    },
    {
      key: 'showCost',
      section: 'Node fields',
      label: 'Cost',
      keywords: ['cost', 'optimizer'],
    },
    {
      key: 'showBytes',
      section: 'Node fields',
      label: 'Bytes',
      keywords: ['bytes', 'size', 'memory'],
    },
    {
      key: 'showPredicateIndicators',
      section: 'Node fields',
      label: 'Predicate indicators',
      keywords: ['predicate', 'indicator', 'access', 'filter'],
    },
    {
      key: 'showPredicateDetails',
      section: 'Node fields',
      label: 'Predicate details',
      keywords: ['predicate', 'details', 'expressions'],
    },
    {
      key: 'showQueryBlockBadge',
      section: 'Node fields',
      label: 'Query block badge',
      keywords: ['query', 'block', 'badge'],
    },
    {
      key: 'showQueryBlockGrouping',
      section: 'Node fields',
      label: 'Query block grouping',
      keywords: ['query', 'block', 'group', 'grouping'],
    },
    {
      key: 'showActualRows',
      section: 'Runtime fields',
      label: 'A-Rows',
      keywords: ['actual', 'rows', 'runtime', 'a-rows'],
      runtimeOnly: true,
    },
    {
      key: 'showActualTime',
      section: 'Runtime fields',
      label: 'A-Time',
      keywords: ['actual', 'time', 'runtime', 'a-time'],
      runtimeOnly: true,
    },
    {
      key: 'showStarts',
      section: 'Runtime fields',
      label: 'Starts',
      keywords: ['starts', 'runtime', 'executions'],
      runtimeOnly: true,
    },
    {
      key: 'showHotspotBadge',
      section: 'Warning badges',
      label: 'Hotspot',
      keywords: ['hotspot', 'hot', 'node', 'warning', 'badge'],
      runtimeOnly: true,
    },
    {
      key: 'showSpillBadge',
      section: 'Warning badges',
      label: 'Spill to disk',
      keywords: ['spill', 'disk', 'temp', 'warning', 'badge'],
    },
    {
      key: 'showCardinalityBadge',
      section: 'Warning badges',
      label: 'Cardinality mismatch',
      keywords: ['cardinality', 'mismatch', 'estimate', 'warning', 'badge'],
      runtimeOnly: true,
    },
    {
      key: 'showAnnotations',
      section: 'Annotations',
      label: 'Show annotations',
      keywords: ['annotations', 'notes', 'highlights', 'overlay'],
    },
  ];
}

function isCommandEnabled(commandKey: CommandKey, filters: FilterState): boolean {
  if (commandKey === 'animateEdges') return filters.animateEdges;
  if (commandKey === 'focusSelection') return filters.focusSelection;
  return filters.nodeDisplayOptions[commandKey] ?? false;
}

export function CustomizeViewMenu({
  filters,
  setFilters,
  hasActualStats,
  defaultNodeDisplayOptions,
}: CustomizeViewMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });

  const commands = useMemo(() => buildCommands(hasActualStats), [hasActualStats]);
  const availableCommands = useMemo(
    () => commands.filter((command) => !command.runtimeOnly || hasActualStats),
    [commands, hasActualStats]
  );

  const filteredCommands = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return availableCommands;
    return availableCommands.filter((command) => {
      if (command.label.toLowerCase().includes(term)) return true;
      return command.keywords.some((keyword) => keyword.toLowerCase().includes(term));
    });
  }, [availableCommands, query]);

  const groupedCommands = useMemo(() => {
    return SECTION_ORDER.map((section) => ({
      section,
      items: filteredCommands.filter((command) => command.section === section),
    })).filter((group) => group.items.length > 0);
  }, [filteredCommands]);

  const availableCount = availableCommands.length;
  const enabledCount = useMemo(
    () => availableCommands.reduce((count, command) => count + (isCommandEnabled(command.key, filters) ? 1 : 0), 0),
    [availableCommands, filters]
  );

  useEffect(() => {
    if (!open) return;

    const updatePopoverPosition = () => {
      const triggerElement = triggerRef.current;
      const popoverElement = popoverRef.current;
      if (!triggerElement || !popoverElement) return;

      const triggerRect = triggerElement.getBoundingClientRect();
      const popoverWidth = popoverElement.offsetWidth || 320;
      const popoverHeight = popoverElement.offsetHeight || 360;
      const viewportPadding = 8;
      const gap = 8;

      let left = triggerRect.left;
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - popoverWidth - viewportPadding));

      let top = triggerRect.top - popoverHeight - gap;
      if (top < viewportPadding) {
        top = Math.min(
          triggerRect.bottom + gap,
          window.innerHeight - popoverHeight - viewportPadding
        );
      }

      setPopoverPosition({ top, left });
    };

    const handleOutsideClick = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      const clickedTrigger = triggerRef.current?.contains(targetNode);
      const clickedPopover = popoverRef.current?.contains(targetNode);
      if (!clickedTrigger && !clickedPopover) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    const animationFrame = requestAnimationFrame(updatePopoverPosition);
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);

    return () => {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const toggleCommand = (commandKey: CommandKey) => {
    const nextValue = !isCommandEnabled(commandKey, filters);
    if (commandKey === 'animateEdges') {
      setFilters({ animateEdges: nextValue });
      return;
    }
    if (commandKey === 'focusSelection') {
      setFilters({ focusSelection: nextValue });
      return;
    }
    setFilters({
      nodeDisplayOptions: {
        ...filters.nodeDisplayOptions,
        [commandKey]: nextValue,
      },
    });
  };

  const setAllVisible = (enabled: boolean) => {
    let nextAnimateEdges = filters.animateEdges;
    let nextFocusSelection = filters.focusSelection;
    const nextNodeDisplayOptions = { ...filters.nodeDisplayOptions };

    for (const command of availableCommands) {
      if (command.key === 'animateEdges') {
        nextAnimateEdges = enabled;
      } else if (command.key === 'focusSelection') {
        nextFocusSelection = enabled;
      } else {
        nextNodeDisplayOptions[command.key as NodeOptionKey] = enabled;
      }
    }

    setFilters({
      animateEdges: nextAnimateEdges,
      focusSelection: nextFocusSelection,
      nodeDisplayOptions: nextNodeDisplayOptions,
    });
  };

  const toggleSectionAll = (items: ViewCommand[], enabled: boolean) => {
    let nextAnimateEdges = filters.animateEdges;
    let nextFocusSelection = filters.focusSelection;
    const nextNodeDisplayOptions = { ...filters.nodeDisplayOptions };

    for (const command of items) {
      if (command.key === 'animateEdges') {
        nextAnimateEdges = enabled;
      } else if (command.key === 'focusSelection') {
        nextFocusSelection = enabled;
      } else {
        nextNodeDisplayOptions[command.key as NodeOptionKey] = enabled;
      }
    }

    setFilters({
      animateEdges: nextAnimateEdges,
      focusSelection: nextFocusSelection,
      nodeDisplayOptions: nextNodeDisplayOptions,
    });
  };

  const resetDefaults = () => {
    setFilters({
      animateEdges: false,
      focusSelection: false,
      nodeDisplayOptions: { ...defaultNodeDisplayOptions },
    });
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="customize-view-popover"
        onClick={() => setOpen((value) => !value)}
        className="w-full h-8 px-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors flex items-center justify-between"
      >
        <span>Customize view</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
        {enabledCount}/{availableCount} enabled
      </p>

      {open && createPortal(
        <div
          ref={popoverRef}
          id="customize-view-popover"
          role="dialog"
          aria-label="Customize view"
          className="fixed z-[80] w-[320px] max-w-[calc(100vw-1rem)] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl"
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
        >
          <div className="p-2 border-b border-neutral-200 dark:border-neutral-700">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search view options..."
              className="w-full px-2 py-1.5 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 dark:placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
            />
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                onClick={resetDefaults}
                className="px-2 py-1 text-[11px] rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Reset defaults
              </button>
              <button
                type="button"
                onClick={() => setAllVisible(true)}
                className="px-2 py-1 text-[11px] rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Enable all
              </button>
              <button
                type="button"
                onClick={() => setAllVisible(false)}
                className="px-2 py-1 text-[11px] rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Disable all
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-2 space-y-2">
            {groupedCommands.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-neutral-500 dark:text-neutral-400">No matching options</div>
            )}
            {groupedCommands.map((group) => {
              const sectionEnabled = group.items.filter(c => isCommandEnabled(c.key, filters)).length;
              const sectionTotal = group.items.length;
              const allOn = sectionEnabled === sectionTotal;
              const allOff = sectionEnabled === 0;
              return (
                <div key={group.section}>
                  <div className="flex items-center justify-between px-2 pb-1">
                    <h4 className="text-[11px] tracking-wide text-neutral-500 dark:text-neutral-400">
                      {group.section}
                    </h4>
                    {sectionTotal > 1 && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => toggleSectionAll(group.items, true)}
                          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                            allOn
                              ? 'text-neutral-400 dark:text-neutral-500 cursor-default'
                              : 'text-neutral-500 dark:text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400'
                          }`}
                          disabled={allOn}
                        >
                          All on
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSectionAll(group.items, false)}
                          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                            allOff
                              ? 'text-neutral-400 dark:text-neutral-500 cursor-default'
                              : 'text-neutral-500 dark:text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400'
                          }`}
                          disabled={allOff}
                        >
                          All off
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((command) => {
                      const enabled = isCommandEnabled(command.key, filters);
                      return (
                        <button
                          key={command.key}
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => toggleCommand(command.key)}
                          className={`w-full px-2 py-1.5 rounded-md text-xs border transition-colors flex items-center justify-between ${
                            enabled
                              ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                              : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                          }`}
                        >
                          <span className="text-left">{command.label}</span>
                          <span className="text-[11px] font-semibold">{enabled ? 'ON' : 'OFF'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
