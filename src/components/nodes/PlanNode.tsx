import { Fragment } from 'react';
import { Handle, Position } from '@xyflow/react';
import { getOperationCategory, COLOR_SCHEMES, getMetricColor, getOperationTooltip } from '../../lib/types';
import { formatNumberShort, formatBytes, formatTimeCompact, formatCardinalityRatio, cardinalityRatioSeverity, computeCardinalityRatio, formatPartitionRange } from '../../lib/format';
import type { PlanNode as PlanNodeType, NodeDisplayOptions, ColorScheme, NodeIndicatorMetric } from '../../lib/types';
import { HighlightText } from '../HighlightText';
import { getHighlightColorDef } from '../../lib/annotations';
import type { HighlightColor, HighlightStyle } from '../../lib/annotations';
import type { MetadataBadge } from '../../lib/metadata/badges';
import type { ParallelSignal, PartitionPruning } from '../../lib/planSignals';
import type { FindingSeverity } from '../../lib/advisor';

export interface PlanNodeData extends Record<string, unknown> {
  label: string;
  node: PlanNodeType;
  totalCost: number;
  isSelected: boolean;
  isFiltered: boolean;
  isInFocusPath?: boolean;
  isFocusDimmed?: boolean;
  displayOptions?: NodeDisplayOptions;
  hasActualStats?: boolean;
  colorScheme?: ColorScheme;
  nodeIndicatorMetric?: NodeIndicatorMetric;
  maxActualRows?: number;
  maxStarts?: number;
  totalElapsedTime?: number;
  filterKey?: string; // Used to force re-renders when filters change
  searchText?: string;
  width?: number;
  height?: number;
  isHotNode?: boolean; // Node with highest self time
  annotationText?: string;
  highlightColor?: HighlightColor;
  highlightStyle?: HighlightStyle;
  metadataBadges?: MetadataBadge[];
  partitionPruning?: PartitionPruning;
  parallelSignals?: ParallelSignal[];
  advisorSeverity?: FindingSeverity;
  advisorCount?: number;
  advisorTitles?: string[];
}

interface PlanNodeProps {
  data: PlanNodeData;
}

function PlanNodeComponent({ data }: PlanNodeProps) {
  const {
    node,
    totalCost,
    isSelected,
    isFiltered,
    isInFocusPath,
    isFocusDimmed,
    displayOptions,
    hasActualStats,
    colorScheme = 'semantic',
    nodeIndicatorMetric = 'cost',
    maxActualRows,
    maxStarts,
    totalElapsedTime,
    searchText,
    isHotNode,
    annotationText,
    highlightColor,
    highlightStyle = 'circle',
    metadataBadges,
    partitionPruning,
    parallelSignals,
    advisorSeverity,
    advisorCount,
    advisorTitles,
  } = data;
  const category = getOperationCategory(node.operation);
  const schemeColors = COLOR_SCHEMES[colorScheme];
  const colors = schemeColors[category] || schemeColors['Other'];
  const isRail = colorScheme === 'rail';
  const isTicker = colorScheme === 'ticker';
  // Schemes that render stats as the Est ⇄ Act comparison grid
  const usesEstActGrid = ['estact', 'rail', 'contrast', 'semantic'].includes(colorScheme);

  const indicator = computeIndicatorMetric(node, nodeIndicatorMetric, totalCost, maxActualRows, maxStarts, totalElapsedTime);

  // Default display options if not provided
  const options = displayOptions || {
    showRows: true,
    showCost: true,
    showBytes: true,
    showObjectName: true,
    showPredicateIndicators: true,
    showPredicateDetails: false,
    showPartitionInfo: true,
    showQueryBlockBadge: true,
    showQueryBlockGrouping: true,
    showActualRows: true,
    showActualTime: true,
    showStarts: true,
    showHotspotBadge: true,
    showSpillBadge: true,
    showCardinalityBadge: true,
    showAdvisorBadge: true,
    showStaleStatsBadge: true,
    showMissingStatsBadge: true,
    showMismatchNoHistogramBadge: true,
    showAnnotations: true,
  };

  // Label for rows depends on whether we have actual stats
  const rowsLabel = hasActualStats ? 'E-Rows' : 'Rows';

  // Cardinality mismatch
  const cardinalityRatio = hasActualStats ? computeCardinalityRatio(node.rows, node.actualRows) : undefined;
  const cardSeverity = cardinalityRatioSeverity(cardinalityRatio);
  const cardLabel = formatCardinalityRatio(cardinalityRatio);

  // Spill detection
  const hasSpill = (node.tempUsed !== undefined && node.tempUsed > 0);

  // Operation tooltip
  const tooltip = getOperationTooltip(node.operation);

  let opacity = isFiltered ? 1 : 0.35;
  if (isFocusDimmed) {
    opacity = Math.min(opacity, 0.15);
  }
  if (isSelected) {
    opacity = 1;
  }

  // Effective visibility considering display options
  const showHot = isHotNode && options.showHotspotBadge;
  const showAnnotationsOverlay = options.showAnnotations;

  // Grid schemes show the mismatch inline in the stats grid; 'rail' moves badges to the footer rail
  const showHotInRow = showHot && !isRail;
  const showSpillInRow = hasSpill && options.showSpillBadge && !isRail;
  const showCardBadgeInRow =
    options.showCardinalityBadge && cardSeverity !== 'good' && !!cardLabel && !usesEstActGrid;
  const showAdvisorBadge = !!advisorSeverity && options.showAdvisorBadge;
  const advisorBadgeClasses: Record<FindingSeverity, string> = {
    info: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
    warning: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    critical: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  };

  // Rows for the comparison grid: metric | estimated | actual (| deviation)
  const estActRows = usesEstActGrid
    ? [
        {
          label: 'Rows',
          est: options.showRows && node.rows !== undefined ? formatNumberShort(node.rows) : undefined,
          act: options.showActualRows && node.actualRows !== undefined ? formatNumberShort(node.actualRows) : undefined,
          isRowsRow: true,
        },
        {
          label: 'Time',
          est: undefined,
          act: options.showActualTime && node.actualTime !== undefined ? formatTimeCompact(node.actualTime) : undefined,
        },
        {
          label: 'Cost',
          est: options.showCost && node.cost !== undefined ? formatNumberShort(node.cost) : undefined,
          act: undefined,
        },
        {
          label: 'Bytes',
          est: options.showBytes && node.bytes !== undefined ? formatBytes(node.bytes) : undefined,
          act: undefined,
        },
        {
          label: 'Starts',
          est: undefined,
          act: options.showStarts && node.starts !== undefined ? formatNumberShort(node.starts) : undefined,
        },
      ].filter((r) => r.est !== undefined || r.act !== undefined)
    : [];

  // Highlight is active when: has color and annotations visible (coexists with hot node)
  const showHighlight = !!(highlightColor && showAnnotationsOverlay);
  const colorDef = highlightColor ? getHighlightColorDef(highlightColor) : null;
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const hexColor = colorDef ? (isDark ? colorDef.hexDark : colorDef.hex) : '';

  // Style-specific classes for the outer div
  const glowStyle = showHighlight && highlightStyle === 'glow'
    ? { boxShadow: `0 0 16px 4px ${hexColor}80, 0 0 4px 1px ${hexColor}60` } : {};
  const tintStyle = showHighlight && highlightStyle === 'tint'
    ? { backgroundColor: `${hexColor}18` } : {};
  return (
    <div
      className={`
        relative ${isTicker ? 'w-[240px]' : 'w-[260px]'} rounded-xl shadow-sm transition-all duration-300
        ${colors.bg} ${colors.border}
        ${isSelected ? 'ring-2 ring-blue-600 ring-offset-4 dark:ring-offset-slate-950 scale-105 z-30' : ''}
        ${isInFocusPath && !(highlightColor && showAnnotationsOverlay) ? 'ring-2 ring-blue-400/40' : ''}
        ${showHot && !isSelected ? 'ring-2 ring-red-600 ring-offset-2 dark:ring-offset-slate-950' : ''}
      `}
      style={{ opacity, ...glowStyle, ...tintStyle }}
    >
      {/* Circle: hand-drawn marker strokes (three overlapping passes) */}
      {showHighlight && highlightStyle === 'circle' && (
        <div
          className={`absolute pointer-events-none z-10 ${colorDef!.text}`}
          style={{ inset: '-18px' }}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="w-full h-full highlight-breathe"
            fill="none"
            overflow="visible"
            style={{ transform: 'rotate(-3deg)' }}
          >
            {/* First marker pass — loose, slightly wobbly */}
            <path
              d="M 20,5 C 38,1 65,-1 85,4 C 98,7 105,16 103,30 C 104,55 103,74 100,87 C 97,101 87,105 70,102 C 48,104 26,103 12,99 C 0,95 -3,83 0,68 C -2,46 -1,26 2,14 C 5,4 13,2 22,6"
              stroke="currentColor"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity="0.4"
            />
            {/* Second marker pass — tighter, shifted inward */}
            <path
              d="M 24,9 C 44,4 66,3 84,8 C 96,12 101,22 99,35 C 100,57 99,73 96,84 C 93,96 83,100 68,98 C 50,100 32,99 18,95 C 6,91 1,81 3,66 C 2,48 3,30 6,18 C 9,8 16,5 28,10"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity="0.5"
            />
            {/* Third marker pass — most pressure, slight wobble outward */}
            <path
              d="M 16,7 C 36,0 62,0 82,5 C 97,9 104,19 102,33 C 103,56 102,75 98,88 C 95,99 85,103 71,101 C 51,103 29,102 14,97 C 2,94 -2,84 1,69 C -1,47 0,27 3,15 C 6,5 12,3 20,8"
              stroke="currentColor"
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity="0.45"
            />
          </svg>
        </div>
      )}

      {/* Hachure: hand-drawn diagonal hatching fill */}
      {showHighlight && highlightStyle === 'hachure' && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-[1] rounded-lg overflow-hidden"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern
              id={`hachure-${node.id}`}
              patternUnits="userSpaceOnUse"
              width="12"
              height="12"
              patternTransform="rotate(-45)"
            >
              <line x1="0" y1="2" x2="12" y2="2" stroke={hexColor} strokeWidth="2.5" strokeLinecap="round" opacity="0.35" />
              <line x1="0" y1="6.5" x2="12" y2="7" stroke={hexColor} strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" rx="8" fill={`url(#hachure-${node.id})`} />
        </svg>
      )}

      {/* Dot: pulsing colored circle in top-right corner */}
      {showHighlight && highlightStyle === 'dot' && (
        <div
          className="absolute -top-1.5 -right-1.5 z-10 pointer-events-none highlight-breathe"
          style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: hexColor, boxShadow: `0 0 6px 2px ${hexColor}80` }}
        />
      )}

      {/* Underline: marker stroke under the operation name — rendered inside the node below */}

      <Handle type="target" position={Position.Top} className="!opacity-0 !w-1 !h-1" />

      {/* Metric indicator bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-md overflow-hidden bg-gray-200 dark:bg-gray-700"
        title={
          nodeIndicatorMetric === 'cost'
            ? `${indicator.label}: ${indicator.formattedValue}`
            : `${indicator.label}: ${indicator.formattedValue} (${(indicator.ratio * 100).toFixed(1)}%)`
        }
      >
        <div
          className={`h-full ${indicator.color} transition-all`}
          style={{ width: `${Math.min(100, indicator.ratio * 100)}%` }}
        />
      </div>

      <div className="p-3 pt-4">
        {/* Operation ID badge */}
        <div className="absolute -top-2 -left-2 w-6 h-6 text-xs rounded-full bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900 font-bold flex items-center justify-center shadow">
          {node.id}
        </div>

        {/* Warning badges row (hot node, spill, cardinality, advisor, metadata, pruning, parallel) */}
        {(showHotInRow || showSpillInRow || showCardBadgeInRow || showAdvisorBadge || (metadataBadges && metadataBadges.length > 0) || partitionPruning === 'none' || (parallelSignals && parallelSignals.length > 0)) && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {showAdvisorBadge && (
              <span
                className={`px-1.5 py-0.5 text-[10px] rounded font-semibold flex items-center gap-0.5 ${advisorBadgeClasses[advisorSeverity!]}`}
                title={advisorTitles && advisorTitles.length > 0 ? advisorTitles.join('\n') : undefined}
              >
                ⚠ {advisorCount ?? 1}
              </span>
            )}
            {showHotInRow && (
              <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[10px] rounded font-semibold flex items-center gap-0.5" title="Slowest operation in plan (self time, excluding children)">
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" /></svg>
                Hotspot
              </span>
            )}
            {showSpillInRow && (
              <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 text-[10px] rounded font-semibold" title="Spill to disk — temp space used">
                Spill
              </span>
            )}
            {showCardBadgeInRow && (
              <span
                className={`px-1.5 py-0.5 text-[10px] rounded font-semibold ${
                  cardSeverity === 'bad'
                    ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                    : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                }`}
                title={`Cardinality mismatch: E-Rows=${formatNumberShort(node.rows)} vs A-Rows=${formatNumberShort(node.actualRows)}`}
              >
                {cardLabel}
              </span>
            )}
            {metadataBadges?.map((badge) => (
              <span
                key={badge.kind}
                className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] rounded font-semibold border border-indigo-300 dark:border-indigo-700 flex items-center gap-0.5"
                title={badge.reason}
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm11 1H6v8l4-2 4 2V6z" clipRule="evenodd" /></svg>
                {badge.kind === 'stale-stats'
                  ? 'Stale stats'
                  : badge.kind === 'missing-stats'
                    ? 'Missing stats'
                    : 'No histogram'}
              </span>
            ))}
            {partitionPruning === 'none' && (
              <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[10px] rounded font-semibold" title="No partition pruning — all partitions are scanned">
                No pruning
              </span>
            )}
            {parallelSignals?.map((signal, idx) => (
              <span
                key={`px-${signal.kind}-${idx}`}
                className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] rounded font-semibold"
                title={signal.reason}
              >
                {signal.kind === 'broadcast-large' ? 'Broadcast' : 'Serial point'}
              </span>
            ))}
          </div>
        )}

        {/* Operation name */}
        <div className="relative">
          <div className={`font-semibold text-sm leading-tight mb-1 ${colors.text}`} title={tooltip}>
            <HighlightText text={node.operation} query={searchText} />
            {isTicker && options.showObjectName && node.objectName && (
              <span className="font-mono font-semibold text-neutral-700 dark:text-neutral-200"> · <HighlightText text={node.objectName} query={searchText} /></span>
            )}
          </div>
          {showHighlight && highlightStyle === 'underline' && (
            <svg
              className="absolute bottom-0 left-0 w-full pointer-events-none"
              height="6"
              preserveAspectRatio="none"
              viewBox="0 0 200 6"
              overflow="visible"
            >
              <path
                d="M 2,3 C 40,1 80,5 120,2 C 160,0 180,4 198,3"
                fill="none"
                stroke={hexColor}
                strokeWidth="3"
                strokeLinecap="round"
                opacity="0.7"
              />
            </svg>
          )}
        </div>

        {/* Object name if present (ticker scheme renders it inline in the operation name) */}
        {!isTicker && options.showObjectName && node.objectName && (
          <div className="text-sm font-semibold font-mono text-neutral-700 dark:text-neutral-200 mb-2 truncate">
            <HighlightText text={node.objectName} query={searchText} />
          </div>
        )}

        {/* Query block badge (rail scheme moves it to the footer rail) */}
        {!isRail && options.showQueryBlockBadge && node.queryBlock && (
          <div className="flex flex-wrap gap-1 mb-2">
            <span className="px-1.5 py-0.5 text-xs rounded font-mono bg-violet-200 dark:bg-violet-800 text-violet-800 dark:text-violet-200">
              {node.queryBlock}
            </span>
            {node.objectAlias && (
              <span className="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 text-xs rounded font-mono">
                {node.objectAlias}
              </span>
            )}
          </div>
        )}

        {/* Stats - Estimated & Actual statistics */}
        {isTicker ? (
          /* Ticker mode: ultra-compact monospace ticker lines */
          (() => {
            const showRowsLine = (options.showRows && node.rows !== undefined) || (options.showActualRows && node.actualRows !== undefined);
            const showRuntimeLine = hasActualStats && ((options.showActualTime && node.actualTime !== undefined) || (options.showStarts && node.starts !== undefined));
            const showCostLine = (options.showCost && node.cost !== undefined) || (options.showBytes && node.bytes !== undefined);
            if (!showRowsLine && !showRuntimeLine && !showCostLine) return null;
            const showActRows = options.showActualRows && node.actualRows !== undefined;
            const showEstRows = options.showRows && node.rows !== undefined;
            const showActualTimePart = options.showActualTime && node.actualTime !== undefined;
            const showStartsPart = options.showStarts && node.starts !== undefined;
            const showCostPart = options.showCost && node.cost !== undefined;
            const showBytesPart = options.showBytes && node.bytes !== undefined;
            return (
              <div
                className="mt-1.5 space-y-0.5 font-mono text-[11px] leading-tight text-neutral-700 dark:text-neutral-300"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {showRowsLine && (
                  <div>
                    <span className="text-[9px] text-neutral-400 dark:text-neutral-500">rows </span>
                    {showEstRows && (
                      <span className={showActRows ? 'text-neutral-400 dark:text-neutral-500' : 'font-semibold'}>
                        {formatNumberShort(node.rows)}
                      </span>
                    )}
                    {showActRows && (
                      <span className={`font-semibold ${
                        cardSeverity === 'bad'
                          ? 'text-red-600 dark:text-red-400'
                          : cardSeverity === 'warn'
                            ? 'text-amber-600 dark:text-amber-400'
                            : ''
                      }`}>
                        →{formatNumberShort(node.actualRows)}
                      </span>
                    )}
                  </div>
                )}
                {showRuntimeLine && (
                  <div>
                    {showActualTimePart && (
                      <>
                        <span className="text-[9px] text-neutral-400 dark:text-neutral-500">t </span>
                        <span className="font-semibold">{formatTimeCompact(node.actualTime)}</span>
                      </>
                    )}
                    {showActualTimePart && showStartsPart && (
                      <span className="text-neutral-300 dark:text-neutral-600"> · </span>
                    )}
                    {showStartsPart && (
                      <>
                        <span className="text-[9px] text-neutral-400 dark:text-neutral-500">starts </span>
                        <span className="font-semibold">{formatNumberShort(node.starts)}</span>
                      </>
                    )}
                  </div>
                )}
                {showCostLine && (
                  <div>
                    {showCostPart && (
                      <>
                        <span className="text-[9px] text-neutral-400 dark:text-neutral-500">cost </span>
                        <span className="font-semibold">{formatNumberShort(node.cost)}</span>
                      </>
                    )}
                    {showCostPart && showBytesPart && (
                      <span className="text-neutral-300 dark:text-neutral-600"> · </span>
                    )}
                    {showBytesPart && (
                      <span className="font-semibold">{formatBytes(node.bytes)}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })()
        ) : usesEstActGrid ? (
          /* Est ⇄ Act mode: comparison grid — metric | estimated | actual | deviation */
          estActRows.length > 0 && (
            <div className="mt-1 rounded border border-neutral-200 dark:border-neutral-700 overflow-hidden bg-neutral-50/60 dark:bg-neutral-900/40">
              <div className={`grid ${hasActualStats ? 'grid-cols-[auto_1fr_1fr_auto]' : 'grid-cols-[auto_1fr]'} text-[11px] leading-tight`}>
                {hasActualStats && (
                  <>
                    <span className="px-2 py-0.5 bg-neutral-100/80 dark:bg-neutral-800/80" />
                    <span className="px-2 py-0.5 bg-neutral-100/80 dark:bg-neutral-800/80 text-right text-[9px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Est</span>
                    <span className="px-2 py-0.5 bg-neutral-100/80 dark:bg-neutral-800/80 text-right text-[9px] font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400">Act</span>
                    <span className="px-2 py-0.5 bg-neutral-100/80 dark:bg-neutral-800/80" />
                  </>
                )}
                {estActRows.map((r, i) => {
                  const rowBorder = i > 0 || hasActualStats ? 'border-t border-neutral-200/70 dark:border-neutral-700/70' : '';
                  return (
                    <Fragment key={r.label}>
                      <span className={`px-2 py-0.5 text-neutral-500 dark:text-neutral-400 ${rowBorder}`}>{r.label}</span>
                      <span className={`px-2 py-0.5 text-right font-mono tabular-nums ${rowBorder} ${
                        hasActualStats
                          ? r.est !== undefined ? 'text-neutral-500 dark:text-neutral-400' : 'text-neutral-300 dark:text-neutral-600'
                          : 'font-semibold text-neutral-900 dark:text-neutral-100'
                      }`}>
                        {r.est ?? '—'}
                      </span>
                      {hasActualStats && (
                        <span className={`px-2 py-0.5 text-right font-mono tabular-nums ${rowBorder} ${
                          r.act !== undefined ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'text-neutral-300 dark:text-neutral-600'
                        }`}>
                          {r.act ?? '—'}
                        </span>
                      )}
                      {hasActualStats && (
                        <span className={`pl-0.5 pr-1.5 py-0.5 flex items-center justify-end ${rowBorder}`}>
                          {'isRowsRow' in r && r.isRowsRow && cardLabel && cardSeverity !== 'good' ? (
                            <em
                              className={`not-italic px-1 rounded text-[9px] font-bold whitespace-nowrap ${
                                cardSeverity === 'bad'
                                  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                                  : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                              }`}
                              title={`Cardinality mismatch: E-Rows=${formatNumberShort(node.rows)} vs A-Rows=${formatNumberShort(node.actualRows)}`}
                            >
                              {cardLabel}
                            </em>
                          ) : 'isRowsRow' in r && r.isRowsRow && r.est !== undefined && r.act !== undefined ? (
                            <em className="not-italic px-1 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300" title="Estimate matches actual rows">
                              ≈
                            </em>
                          ) : null}
                        </span>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          /* Standard modes: inline badge layout */
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              {options.showRows && node.rows !== undefined && (
                <span className="px-1.5 py-0.5 rounded bg-white/50 dark:bg-black/20 text-gray-700 dark:text-gray-300">
                  {rowsLabel}: {formatNumberShort(node.rows)}
                </span>
              )}
              {options.showCost && node.cost !== undefined && (
                <span className="px-1.5 py-0.5 rounded bg-white/50 dark:bg-black/20 text-gray-700 dark:text-gray-300">
                  Cost: {formatNumberShort(node.cost)}
                </span>
              )}
              {options.showBytes && node.bytes !== undefined && (
                <span className="px-1.5 py-0.5 rounded bg-white/50 dark:bg-black/20 text-gray-700 dark:text-gray-300">
                  {formatBytes(node.bytes)}
                </span>
              )}
            </div>

            {/* Actual runtime statistics (SQL Monitor) */}
            {hasActualStats && (
              <div className="flex flex-wrap gap-2 text-xs mt-1">
                {options.showActualRows && node.actualRows !== undefined && (
                  <span className="px-1.5 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                    A-Rows: {formatNumberShort(node.actualRows)}
                  </span>
                )}
                {options.showActualTime && node.actualTime !== undefined && (
                  <span className="px-1.5 py-0.5 rounded font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                    A-Time: {formatTimeCompact(node.actualTime)}
                  </span>
                )}
                {options.showStarts && node.starts !== undefined && (
                  <span className={`px-1.5 py-0.5 rounded font-medium ${
                    node.starts >= 1000
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                      : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                  }`}>
                    Starts: {formatNumberShort(node.starts)}
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {/* Predicate indicators (rail scheme renders them as footer chips) */}
        {!isRail && options.showPredicateIndicators && (node.accessPredicates || node.filterPredicates) && (
          <div className="flex gap-1 mt-2">
            {node.accessPredicates && (
              <span className="rounded font-semibold px-1.5 py-0.5 text-xs bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200">
                Access
              </span>
            )}
            {node.filterPredicates && (
              <span className="rounded font-semibold px-1.5 py-0.5 text-xs bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
                Filter
              </span>
            )}
          </div>
        )}

        {/* Partition pruning indicator (Pstart/Pstop) — mirrors predicate chips */}
        {!isRail && options.showPartitionInfo && formatPartitionRange(node.pstart, node.pstop) && (
          <div className="flex gap-1 mt-2">
            <span
              className="rounded font-semibold px-1.5 py-0.5 text-xs bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200"
              title={`Partitions accessed — Pstart: ${node.pstart ?? '—'}, Pstop: ${node.pstop ?? '—'}`}
            >
              Part {formatPartitionRange(node.pstart, node.pstop)}
            </span>
          </div>
        )}

        {/* Predicate details */}
        {options.showPredicateDetails && (node.accessPredicates || node.filterPredicates) && (
          <div className="mt-2 space-y-1">
            {node.accessPredicates && (
              <div className="text-xs">
                <span className="font-medium text-green-700 dark:text-green-300">A: </span>
                <code className="text-gray-600 dark:text-gray-400 break-all">
                  <HighlightText text={node.accessPredicates} query={searchText} />
                </code>
              </div>
            )}
            {node.filterPredicates && (
              <div className="text-xs">
                <span className="font-medium text-amber-700 dark:text-amber-300">F: </span>
                <code className="text-gray-600 dark:text-gray-400 break-all">
                  <HighlightText text={node.filterPredicates} query={searchText} />
                </code>
              </div>
            )}
          </div>
        )}

        {/* Icon badge rail (rail scheme): fixed footer slot for badges + query block.
            Cardinality mismatch is shown inline in the comparison grid instead. */}
        {isRail &&
          (showHot ||
            (hasSpill && options.showSpillBadge) ||
            (options.showPredicateIndicators && (node.accessPredicates || node.filterPredicates)) ||
            (options.showPartitionInfo && formatPartitionRange(node.pstart, node.pstop)) ||
            (options.showQueryBlockBadge && node.queryBlock)) && (
            <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-neutral-200 dark:border-neutral-700">
              {showHot && (
                <span
                  className="w-5 h-5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 flex items-center justify-center shrink-0"
                  title="Hotspot — slowest operation in plan (self time, excluding children)"
                >
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" /></svg>
                </span>
              )}
              {hasSpill && options.showSpillBadge && (
                <span
                  className="w-5 h-5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 flex items-center justify-center text-[10px] font-bold shrink-0"
                  title={`Spill to disk — temp space used${node.tempUsed !== undefined ? `: ${formatBytes(node.tempUsed)}` : ''}`}
                >
                  ▾
                </span>
              )}
              {options.showPredicateIndicators && node.accessPredicates && (
                <span
                  className="w-5 h-5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700 flex items-center justify-center text-[10px] font-extrabold shrink-0"
                  title={`Access: ${node.accessPredicates}`}
                >
                  A
                </span>
              )}
              {options.showPredicateIndicators && node.filterPredicates && (
                <span
                  className="w-5 h-5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center justify-center text-[10px] font-extrabold shrink-0"
                  title={`Filter: ${node.filterPredicates}`}
                >
                  F
                </span>
              )}
              {options.showPartitionInfo && formatPartitionRange(node.pstart, node.pstop) && (
                <span
                  className="h-5 px-1 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 flex items-center justify-center text-[10px] font-extrabold shrink-0"
                  title={`Partitions accessed — Pstart: ${node.pstart ?? '—'}, Pstop: ${node.pstop ?? '—'}`}
                >
                  P {formatPartitionRange(node.pstart, node.pstop)}
                </span>
              )}
              {options.showQueryBlockBadge && node.queryBlock && (
                <span
                  className="ml-auto font-mono text-[10px] text-neutral-400 dark:text-neutral-500 truncate"
                  title={node.objectAlias ? `${node.queryBlock} · ${node.objectAlias}` : node.queryBlock}
                >
                  {node.queryBlock}
                  {node.objectAlias ? ` · ${node.objectAlias}` : ''}
                </span>
              )}
            </div>
          )}

        {/* Annotation preview */}
        {showAnnotationsOverlay && annotationText && (
          <div className="mt-2 pt-1.5 border-t border-neutral-200 dark:border-neutral-700">
            <div
              className={`text-[11px] whitespace-pre-wrap break-words ${
                highlightColor ? getHighlightColorDef(highlightColor).text : 'text-neutral-500 dark:text-neutral-400'
              }`}
            >
              {annotationText}
            </div>
          </div>
        )}
      </div>

      {node.children.length > 0 && (
        <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-1 !h-1" />
      )}
    </div>
  );
}

interface IndicatorResult {
  ratio: number;
  label: string;
  formattedValue: string;
  color: string;
}

function computeIndicatorMetric(
  node: PlanNodeType,
  metric: NodeIndicatorMetric,
  totalCost: number,
  maxActualRows?: number,
  maxStarts?: number,
  totalElapsedTime?: number,
): IndicatorResult {
  let ratio = 0;
  let label = '';
  let formattedValue = '';

  switch (metric) {
    case 'cost':
      ratio = totalCost > 0 ? (node.cost || 0) / totalCost : 0;
      label = 'Cost';
      formattedValue = `${node.cost || 0}`;
      break;
    case 'actualRows':
      ratio = maxActualRows && maxActualRows > 0 ? (node.actualRows || 0) / maxActualRows : 0;
      label = 'A-Rows';
      formattedValue = formatNumberShort(node.actualRows || 0) ?? '0';
      break;
    case 'actualTime':
      ratio = totalElapsedTime && totalElapsedTime > 0 ? (node.actualTime || 0) / totalElapsedTime : 0;
      label = 'A-Time';
      formattedValue = formatTimeCompact(node.actualTime || 0) ?? '0ms';
      break;
    case 'starts':
      ratio = maxStarts && maxStarts > 0 ? (node.starts || 0) / maxStarts : 0;
      label = 'Starts';
      formattedValue = formatNumberShort(node.starts || 0) ?? '0';
      break;
    case 'activityPercent':
      ratio = (node.activityPercent || 0) / 100;
      label = 'Activity %';
      formattedValue = `${(node.activityPercent || 0).toFixed(1)}%`;
      break;
  }

  return {
    ratio: Math.min(1, ratio),
    label,
    formattedValue,
    color: ratio === 0 ? 'bg-gray-200 dark:bg-gray-700' : getMetricColor(ratio),
  };
}

// No memo - we need to re-render when context changes (for filter state)
export const PlanNodeMemo = PlanNodeComponent;
