export interface FormatOptions {
  empty?: string;
  infinity?: string;
}

export function formatNumberShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
  return value.toString();
}

export function formatBytes(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 1073741824) return (value / 1073741824).toFixed(1) + ' GB';
  if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
  if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
  return value + ' B';
}

export function formatTimeCompact(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) {
    const mins = Math.floor(value / 60000);
    const secs = ((value % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
  }
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  return value.toFixed(0) + 'ms';
}

export function formatTimeShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) return (value / 60000).toFixed(1) + 'm';
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  return value.toFixed(0) + 'ms';
}

export function formatTimeDetailed(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) {
    const minutes = Math.floor(value / 60000);
    const seconds = ((value % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  if (value >= 1) return value.toFixed(1) + 'ms';
  return (value * 1000).toFixed(0) + 'us';
}
