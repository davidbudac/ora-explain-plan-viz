import type { NodeDisplayOptions } from './types';
import { defaultNodeDisplayOptions } from './settings';

/**
 * Density presets bundle the 18 node-display toggles into three curated
 * levels. Presets are DERIVED, never stored: the active selection is computed
 * by comparing the current options against these tables, so any manual toggle
 * automatically reads as "custom" with no coordination code, and existing
 * users' persisted defaults land on "balanced".
 */
export type DensityPreset = 'compact' | 'balanced' | 'detailed';
export type DensitySelection = DensityPreset | 'custom';

export const DENSITY_PRESETS: Record<DensityPreset, NodeDisplayOptions> = {
  // Triage mode: tree shape + where the time goes, nothing else.
  compact: {
    showRows: false,
    showCost: false,
    showBytes: false,
    showObjectName: true,
    showPredicateIndicators: false,
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
  // MUST stay identical to the settings.ts defaults so existing users derive 'balanced'.
  balanced: { ...defaultNodeDisplayOptions },
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
  balanced: 'Balanced',
  detailed: 'Detailed',
  custom: 'Custom',
};

/** Which preset (if any) the given options exactly match. */
export function matchDensityPreset(options: NodeDisplayOptions): DensitySelection {
  for (const preset of ['compact', 'balanced', 'detailed'] as const) {
    const table = DENSITY_PRESETS[preset];
    const keys = Object.keys(table) as (keyof NodeDisplayOptions)[];
    if (keys.every((key) => options[key] === table[key])) {
      return preset;
    }
  }
  return 'custom';
}
