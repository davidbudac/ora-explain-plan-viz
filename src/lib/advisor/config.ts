export const DEFAULT_THRESHOLDS = {
  nlStartsWarn: 10_000,
  nlStartsCritical: 100_000,
  nlInnerRowsWarn: 100_000,
  nlInnerRowsCritical: 1_000_000,
  cartesianMinSideRows: 100,
  cartesianCriticalProduct: 10_000_000,
  ftsMinTableRows: 10_000,
  ftsSelectivityWarn: 0.01,
  ftsSelectivityCritical: 0.001,
  ftsCriticalMinTableRows: 1_000_000,
  ftsFallbackMaxRowsPerStart: 1_000,
  ftsFallbackMinGetsPerStart: 10_000,
  spillCriticalBytes: 1 << 30,
  maxFindingsPerRule: 5,
} as const;

export type AdvisorThresholds = typeof DEFAULT_THRESHOLDS;
