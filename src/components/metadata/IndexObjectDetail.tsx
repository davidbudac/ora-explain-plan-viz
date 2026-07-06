import type { MetadataBundle, IndexObject } from '../../lib/metadata/bundle';
import { formatNumberShort } from '../../lib/format';
import { Card, DdlBlock, StatItem, formatBytes, formatDateShort } from './shared';

interface IndexObjectDetailProps {
  objectKey: string;
  index: IndexObject;
  bundle: MetadataBundle;
  onSelectObject: (key: string) => void;
}

export function IndexObjectDetail({ objectKey, index, bundle, onSelectObject }: IndexObjectDetailProps) {
  const { stats } = index;
  const tableExists = Boolean(bundle.objects[index.table]);

  return (
    <div className="p-4 space-y-3 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <code className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400 break-all">{objectKey}</code>
        <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-indigo-500 text-white uppercase shrink-0">Index</span>
      </div>

      <Card title="On Table">
        {tableExists ? (
          <button
            type="button"
            onClick={() => onSelectObject(index.table)}
            className="text-[12px] font-mono text-blue-600 dark:text-blue-400 hover:underline"
          >
            {index.table}
          </button>
        ) : (
          <span className="text-[12px] font-mono text-slate-600 dark:text-slate-400">{index.table}</span>
        )}
      </Card>

      <Card title="Columns">
        <div className="flex flex-wrap gap-1.5">
          {index.columns.length > 0 ? (
            index.columns.map((c) => (
              <span key={c} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {c}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
          )}
        </div>
      </Card>

      <Card title="Stats">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
          <StatItem label="Type" value={stats.index_type} />
          <StatItem label="Uniqueness" value={stats.uniqueness} />
          <StatItem label="Status" value={stats.status} />
          <StatItem label="Visibility" value={stats.visibility} />
          <StatItem label="C-Factor" value={formatNumberShort(stats.clustering_factor ?? undefined)} />
          <StatItem label="B-Level" value={stats.blevel?.toString()} />
          <StatItem label="Leaf Blocks" value={formatNumberShort(stats.leaf_blocks ?? undefined)} />
          <StatItem label="Distinct Keys" value={formatNumberShort(stats.distinct_keys ?? undefined)} />
          <StatItem label="Num Rows" value={formatNumberShort(stats.num_rows ?? undefined)} />
          <StatItem label="Avg Leaf/Key" value={formatNumberShort(stats.avg_leaf_blocks_per_key ?? undefined)} />
          <StatItem label="Avg Data/Key" value={formatNumberShort(stats.avg_data_blocks_per_key ?? undefined)} />
          <StatItem label="Analyzed" value={formatDateShort(stats.last_analyzed ?? null)} />
          <StatItem label="Degree" value={stats.degree} />
          <StatItem label="Compression" value={stats.compression} />
          {index.segment && <StatItem label="Segment Size" value={formatBytes(index.segment.bytes)} />}
          {index.segment && <StatItem label="Extents" value={formatNumberShort(index.segment.extents)} />}
        </div>
      </Card>

      {stats.partitioned && (
        <Card title="Partitioning">
          <div className="text-[11px] font-mono text-slate-700 dark:text-slate-300 space-y-1">
            <div>
              {stats.locality}
              {stats.partition_type ? ` · ${stats.partition_type}` : ''}
            </div>
            {stats.partition_key && stats.partition_key.length > 0 && <div>({stats.partition_key.join(', ')})</div>}
          </div>
        </Card>
      )}

      {index.ddl && <DdlBlock ddl={index.ddl} />}
    </div>
  );
}
