import type { NodeDisplayOptions } from './types';

/**
 * Density presets bundle the 18 node-display toggles into two curated
 * levels. Presets are DERIVED, never stored: the active selection is computed
 * by comparing the current options against these tables, so any manual toggle
 * automatically reads as "custom" with no coordination code.
 */
export type DensityPreset = 'compact' | 'detailed';
export type DensitySelection = DensityPreset | 'custom';

export const DENSITY_PRESETS: Record<DensityPreset, NodeDisplayOptions> = {
  // Triage mode: tree shape + where the time goes. Keeps the bottom
  // icon/badge row (predicate chips, hotspot, spill) visible for orientation.
  compact: {
    showRows: false,
    showCost: false,
    showBytes: false,
    showObjectName: true,
    showPredicateIndicators: true,
    showPredicateDetails: false,
    showQueryBlockBadge: false,
    showQueryBlockGrouping: false,
    showActualRows: false,
    showActualTime: true,
    showStarts: false,
    showHotspotBadge: true,
    showSpillBadge: true,
    showCardinalityBadge: true,
    showStaleStatsBadge: false,
    showMissingStatsBadge: false,
    showMismatchNoHistogramBadge: false,
    showAnnotations: true,
  },
  detailed: {
    showRows: true,
    showCost: true,
    showBytes: true,
    showObjectName: true,
    showPredicateIndicators: true,
    showPredicateDetails: true,
    showQueryBlockBadge: true,
    showQueryBlockGrouping: true,
    showActualRows: true,
    showActualTime: true,
    showStarts: true,
    showHotspotBadge: true,
    showSpillBadge: true,
    showCardinalityBadge: true,
    showStaleStatsBadge: true,
    showMissingStatsBadge: true,
    showMismatchNoHistogramBadge: true,
    showAnnotations: true,
  },
};

export const DENSITY_PRESET_LABELS: Record<DensitySelection, string> = {
  compact: 'Compact',
  detailed: 'Detailed',
  custom: 'Custom',
};

/** Which preset (if any) the given options exactly match. */
export function matchDensityPreset(options: NodeDisplayOptions): DensitySelection {
  for (const preset of ['compact', 'detailed'] as const) {
    const table = DENSITY_PRESETS[preset];
    const keys = Object.keys(table) as (keyof NodeDisplayOptions)[];
    if (keys.every((key) => options[key] === table[key])) {
      return preset;
    }
  }
  return 'custom';
}
