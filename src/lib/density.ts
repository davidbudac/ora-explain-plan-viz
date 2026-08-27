import type { NodeDisplayOptions } from './types';

/**
 * Density presets bundle the node-display toggles into three curated
 * levels. Presets are DERIVED, never stored: the active selection is computed
 * by comparing the current options against these tables, so any manual toggle
 * automatically reads as "custom" with no coordination code.
 */
export type DensityPreset = 'minimal' | 'compact' | 'detailed';
export type DensitySelection = DensityPreset | 'custom';

/** Presets in increasing-detail order — drives the selector and the palette. */
export const DENSITY_PRESET_ORDER: DensityPreset[] = ['minimal', 'compact', 'detailed'];

export const DENSITY_PRESETS: Record<DensityPreset, NodeDisplayOptions> = {
  // Progressive disclosure: operation + object + one quiet metric line, with a
  // single amber dot standing in for every warning badge. The badge/metadata
  // toggles stay ON on purpose — `compactStats` suppresses the chips, but those
  // flags still gate the upstream signal detection that feeds the dot.
  minimal: {
    showRows: false,
    showCost: false,
    showBytes: false,
    showObjectName: true,
    showPredicateIndicators: false,
    showPredicateDetails: false,
    showPartitionInfo: false,
    showQueryBlockBadge: false,
    showQueryBlockGrouping: false,
    showActualRows: false,
    showActualTime: false,
    showStarts: false,
    showHotspotBadge: true,
    showSpillBadge: true,
    showCardinalityBadge: true,
    showAdvisorBadge: true,
    showStaleStatsBadge: true,
    showMissingStatsBadge: true,
    showMismatchNoHistogramBadge: true,
    showAnnotations: true,
    compactStats: true,
  },
  // Triage mode: tree shape + where the time goes. Keeps the bottom
  // icon/badge row (predicate chips, hotspot, spill) visible for orientation.
  compact: {
    showRows: false,
    showCost: false,
    showBytes: false,
    showObjectName: true,
    showPredicateIndicators: true,
    showPredicateDetails: false,
    showPartitionInfo: true,
    showQueryBlockBadge: false,
    showQueryBlockGrouping: false,
    showActualRows: false,
    showActualTime: true,
    showStarts: false,
    showHotspotBadge: true,
    showSpillBadge: true,
    showCardinalityBadge: true,
    showAdvisorBadge: true,
    showStaleStatsBadge: false,
    showMissingStatsBadge: false,
    showMismatchNoHistogramBadge: false,
    showAnnotations: true,
    compactStats: false,
  },
  detailed: {
    showRows: true,
    showCost: true,
    showBytes: true,
    showObjectName: true,
    showPredicateIndicators: true,
    showPredicateDetails: true,
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
    compactStats: false,
  },
};

export const DENSITY_PRESET_LABELS: Record<DensitySelection, string> = {
  minimal: 'Minimal',
  compact: 'Compact',
  detailed: 'Detailed',
  custom: 'Custom',
};

/** Which preset (if any) the given options exactly match. */
export function matchDensityPreset(options: NodeDisplayOptions): DensitySelection {
  for (const preset of DENSITY_PRESET_ORDER) {
    const table = DENSITY_PRESETS[preset];
    const keys = Object.keys(table) as (keyof NodeDisplayOptions)[];
    if (keys.every((key) => options[key] === table[key])) {
      return preset;
    }
  }
  return 'custom';
}
