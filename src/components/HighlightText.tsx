import { useMemo } from 'react';
import type { ReactNode } from 'react';

interface HighlightTextProps {
  text?: string;
  query?: string;
  className?: string;
  highlightClassName?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function HighlightText({
  text,
  query,
  className,
  highlightClassName = 'bg-yellow-200/80 dark:bg-yellow-700/40 text-gray-900 dark:text-yellow-100 rounded px-0.5',
}: HighlightTextProps) {
  const safeText = text ?? '';
  const trimmed = query?.trim() ?? '';

  return useMemo(() => {
    if (!safeText) return null;

    if (!trimmed) {
      return <span className={className}>{safeText}</span>;
    }

    const safeQuery = escapeRegExp(trimmed);
    const regex = new RegExp(safeQuery, 'ig');
    const segments: ReactNode[] = [];
    let lastIndex = 0;
    let matchIndex = 0;

    for (const match of safeText.matchAll(regex)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        segments.push(safeText.slice(lastIndex, index));
      }

      segments.push(
        <mark key={`m-${matchIndex}`} className={highlightClassName}>
          {match[0]}
        </mark>
      );

      lastIndex = index + match[0].length;
      matchIndex += 1;
    }

    if (lastIndex < safeText.length) {
      segments.push(safeText.slice(lastIndex));
    }

    return <span className={className}>{segments}</span>;
  }, [safeText, trimmed, className, highlightClassName]);
}
