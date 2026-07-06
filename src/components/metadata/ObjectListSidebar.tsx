import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MetadataBundle } from '../../lib/metadata/bundle';

interface ObjectListSidebarProps {
  bundle: MetadataBundle;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

interface Badge {
  label: string;
  title: string;
}

export function ObjectListSidebar({ bundle, selectedKey, onSelect }: ObjectListSidebarProps) {
  const [search, setSearch] = useState('');

  const { tables, indexes } = useMemo(() => {
    const entries = Object.entries(bundle.objects);
    const term = search.trim().toLowerCase();
    const filtered = term ? entries.filter(([key]) => key.toLowerCase().includes(term)) : entries;
    return {
      tables: filtered.filter(([, obj]) => obj.type === 'TABLE').sort(([a], [b]) => a.localeCompare(b)),
      indexes: filtered.filter(([, obj]) => obj.type === 'INDEX').sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [bundle.objects, search]);

  const coverageKeys = useMemo(
    () => new Set(bundle.coverage_warnings.map((w) => w.object)),
    [bundle.coverage_warnings],
  );

  return (
    <div className="w-64 shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="p-2 border-b border-slate-200 dark:border-slate-800">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter objects…"
          className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors ${
            selectedKey === null
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Bundle overview
        </button>

        {tables.length > 0 && (
          <SidebarGroup title={`Tables (${tables.length})`}>
            {tables.map(([key, obj]) => (
              <ObjectRow
                key={key}
                objectKey={key}
                isSelected={selectedKey === key}
                onSelect={() => onSelect(key)}
                hasCoverageWarning={coverageKeys.has(key)}
                staleDot={obj.type === 'TABLE' && obj.stats.stale_stats === 'YES'}
                badges={obj.type === 'TABLE' && obj.stats.partitioned ? [{ label: 'P', title: 'Partitioned' }] : []}
              />
            ))}
          </SidebarGroup>
        )}

        {indexes.length > 0 && (
          <SidebarGroup title={`Indexes (${indexes.length})`}>
            {indexes.map(([key, obj]) => (
              <ObjectRow
                key={key}
                objectKey={key}
                isSelected={selectedKey === key}
                onSelect={() => onSelect(key)}
                hasCoverageWarning={coverageKeys.has(key)}
                badges={obj.type === 'INDEX' ? indexBadges(obj.stats) : []}
              />
            ))}
          </SidebarGroup>
        )}

        {tables.length === 0 && indexes.length === 0 && (
          <p className="px-3 py-4 text-[11px] text-slate-400 dark:text-slate-500 text-center">No objects match.</p>
        )}
      </div>
    </div>
  );
}

function indexBadges(stats: { uniqueness: string; visibility: string }): Badge[] {
  const badges: Badge[] = [];
  if (stats.uniqueness === 'UNIQUE') badges.push({ label: 'UNIQ', title: 'Unique index' });
  if (stats.uniqueness === 'BITMAP') badges.push({ label: 'BMP', title: 'Bitmap index' });
  if (stats.visibility === 'INVISIBLE') badges.push({ label: 'INV', title: 'Invisible index' });
  return badges;
}

function SidebarGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function ObjectRow({
  objectKey,
  isSelected,
  onSelect,
  badges,
  staleDot,
  hasCoverageWarning,
}: {
  objectKey: string;
  isSelected: boolean;
  onSelect: () => void;
  badges: Badge[];
  staleDot?: boolean;
  hasCoverageWarning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-mono transition-colors ${
        isSelected
          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      {staleDot && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Stale stats" />}
      {hasCoverageWarning && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" title="Coverage warning" />}
      <span className="truncate flex-1">{objectKey}</span>
      {badges.map((b) => (
        <span
          key={b.label}
          title={b.title}
          className="shrink-0 px-1 py-px text-[8px] font-bold rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 uppercase"
        >
          {b.label}
        </span>
      ))}
    </button>
  );
}
