import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ColumnStats } from '../../lib/metadata/bundle';
import { formatHistogramLabel } from './shared';
import { formatNumberShort } from '../../lib/format';

type SortKey = 'name' | 'data_type' | 'nullable' | 'num_distinct' | 'num_nulls' | 'density' | 'low_value' | 'high_value' | 'histogram';

interface ColumnsTableProps {
  columns: Record<string, ColumnStats>;
  /** Column names to visually highlight (e.g. predicate references). */
  highlightColumns?: Set<string>;
}

/** Full sortable column-stats table. Default order is insertion order (unsorted). */
export function ColumnsTable({ columns, highlightColumns }: ColumnsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const rows = useMemo(() => {
    const entries = Object.entries(columns);
    if (!sortKey) return entries;
    const sorted = [...entries].sort(([nameA, a], [nameB, b]) => {
      const va = sortValue(sortKey, nameA, a);
      const vb = sortValue(sortKey, nameB, b);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortAsc ? sorted : sorted.reverse();
  }, [columns, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  if (rows.length === 0) {
    return <p className="text-[11px] text-slate-500 dark:text-slate-400">No column stats in the bundle.</p>;
  }

  return (
    <div className="overflow-auto rounded-md border border-slate-200 dark:border-slate-800 max-h-96">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10">
          <tr>
            <Th label="Name" sortKey="name" active={sortKey} asc={sortAsc} onSort={toggleSort} />
            <Th label="Type" sortKey="data_type" active={sortKey} asc={sortAsc} onSort={toggleSort} />
            <Th label="Null?" sortKey="nullable" active={sortKey} asc={sortAsc} onSort={toggleSort} />
            <Th label="NDV" sortKey="num_distinct" active={sortKey} asc={sortAsc} onSort={toggleSort} align="right" />
            <Th label="Nulls" sortKey="num_nulls" active={sortKey} asc={sortAsc} onSort={toggleSort} align="right" />
            <Th label="Density" sortKey="density" active={sortKey} asc={sortAsc} onSort={toggleSort} align="right" />
            <Th label="Low" sortKey="low_value" active={sortKey} asc={sortAsc} onSort={toggleSort} />
            <Th label="High" sortKey="high_value" active={sortKey} asc={sortAsc} onSort={toggleSort} />
            <Th label="Histogram" sortKey="histogram" active={sortKey} asc={sortAsc} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, col], i) => (
            <tr
              key={name}
              className={`${i % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-900/40'} ${
                highlightColumns?.has(name) ? 'bg-blue-50 dark:bg-blue-950/30' : ''
              }`}
            >
              <td className="px-2 py-1 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                {name}
                {col.virtual && (
                  <span className="ml-1 px-1 py-px text-[8px] font-bold rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 uppercase">
                    Virtual
                  </span>
                )}
                {col.hidden && (
                  <span className="ml-1 px-1 py-px text-[8px] font-bold rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 uppercase">
                    Hidden
                  </span>
                )}
              </td>
              <td className="px-2 py-1 text-slate-600 dark:text-slate-400 whitespace-nowrap">{col.data_type}</td>
              <td className="px-2 py-1 text-slate-600 dark:text-slate-400">{col.nullable ? 'Y' : 'N'}</td>
              <td className="px-2 py-1 text-right font-mono text-slate-700 dark:text-slate-300">
                {formatNumberShort(col.num_distinct ?? undefined) ?? '—'}
              </td>
              <td className="px-2 py-1 text-right font-mono text-slate-700 dark:text-slate-300">
                {formatNumberShort(col.num_nulls ?? undefined) ?? '—'}
              </td>
              <td className="px-2 py-1 text-right font-mono text-slate-700 dark:text-slate-300">
                {col.density != null ? col.density.toPrecision(2) : '—'}
              </td>
              <td className="px-2 py-1 font-mono text-slate-500 dark:text-slate-400 truncate max-w-[8rem]" title={col.low_value ?? undefined}>
                {col.low_value ?? '—'}
              </td>
              <td className="px-2 py-1 font-mono text-slate-500 dark:text-slate-400 truncate max-w-[8rem]" title={col.high_value ?? undefined}>
                {col.high_value ?? '—'}
              </td>
              <td className="px-2 py-1 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                {formatHistogramLabel(col.histogram.type, col.histogram.buckets)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sortValue(key: SortKey, name: string, col: ColumnStats): string | number {
  switch (key) {
    case 'name': return name;
    case 'data_type': return col.data_type;
    case 'nullable': return col.nullable ? 1 : 0;
    case 'num_distinct': return col.num_distinct ?? -1;
    case 'num_nulls': return col.num_nulls ?? -1;
    case 'density': return col.density ?? -1;
    case 'low_value': return col.low_value ?? '';
    case 'high_value': return col.high_value ?? '';
    case 'histogram': return col.histogram.type;
  }
}

function Th({
  label, sortKey, active, asc, onSort, align,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey | null;
  asc: boolean;
  onSort: (key: SortKey) => void;
  align?: 'right';
}): ReactNode {
  const isActive = active === sortKey;
  return (
    <th
      className={`px-2 py-1.5 font-semibold text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 cursor-pointer select-none whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );
}
