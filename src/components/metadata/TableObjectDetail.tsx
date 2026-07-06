import { useMemo, useState } from 'react';
import type { MetadataBundle, TableObject } from '../../lib/metadata/bundle';
import { resolveIndexesForBlock } from '../../lib/metadata/indexes';
import { formatNumberShort } from '../../lib/format';
import { Card, DdlBlock, Tag, StatItem, formatBytes, formatDateShort } from './shared';
import { ColumnsTable } from './ColumnsTable';

interface TableObjectDetailProps {
  objectKey: string;
  table: TableObject;
  bundle: MetadataBundle;
  onSelectObject: (key: string) => void;
}

export function TableObjectDetail({ objectKey, table, bundle, onSelectObject }: TableObjectDetailProps) {
  const [showGenerated, setShowGenerated] = useState(false);
  const indexBlock = useMemo(
    () => resolveIndexesForBlock({ key: objectKey, object: table }, bundle),
    [objectKey, table, bundle],
  );
  const constraints = table.constraints;
  const checks = constraints?.checks ?? [];
  const visibleChecks = showGenerated ? checks : checks.filter((c) => !c.generated);
  const hiddenGeneratedCount = checks.length - visibleChecks.length;
  const hasConstraints =
    Boolean(constraints) &&
    (Boolean(constraints!.primary_key) ||
      (constraints!.unique?.length ?? 0) > 0 ||
      (constraints!.foreign_keys?.length ?? 0) > 0 ||
      checks.length > 0);

  return (
    <div className="p-4 space-y-3 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <code className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400 break-all">{objectKey}</code>
        {table.stats.stale_stats === 'YES' && (
          <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-amber-500 text-white shrink-0 uppercase">Stale</span>
        )}
      </div>

      <Card title="Stats">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
          <StatItem label="Rows" value={formatNumberShort(table.stats.num_rows ?? undefined)} />
          <StatItem label="Blocks" value={formatNumberShort(table.stats.blocks ?? undefined)} />
          <StatItem label="Avg Row Len" value={table.stats.avg_row_len != null ? `${table.stats.avg_row_len} B` : undefined} />
          <StatItem label="Analyzed" value={formatDateShort(table.stats.last_analyzed)} />
          {table.segment && <StatItem label="Segment Size" value={formatBytes(table.segment.bytes)} />}
          {table.segment && <StatItem label="Extents" value={formatNumberShort(table.segment.extents)} />}
          {table.physical?.compression && (
            <StatItem
              label="Compression"
              value={`${table.physical.compression}${table.physical.compress_for ? ` (${table.physical.compress_for})` : ''}`}
            />
          )}
          {table.physical?.degree && <StatItem label="Degree" value={table.physical.degree} />}
        </div>
      </Card>

      {table.stats.partitioned && (
        <Card title="Partitioning">
          <div className="text-[11px] font-mono text-slate-700 dark:text-slate-300 space-y-1">
            <div>
              {table.stats.partition_type}
              {table.stats.interval ? ' · INTERVAL' : ''}
              {table.stats.partition_key?.length ? ` (${table.stats.partition_key.join(', ')})` : ''}
            </div>
            {table.stats.subpartition_type && table.stats.subpartition_type !== 'NONE' && (
              <div>
                Subpartition: {table.stats.subpartition_type}
                {table.stats.subpartition_key?.length ? ` (${table.stats.subpartition_key.join(', ')})` : ''}
              </div>
            )}
            {table.stats.partition_count !== undefined && <div>{table.stats.partition_count} partitions</div>}
          </div>
        </Card>
      )}

      <Card title={`Columns (${Object.keys(table.columns).length})`}>
        <ColumnsTable columns={table.columns} />
      </Card>

      {hasConstraints && (
        <Card title="Constraints">
          <div className="space-y-2 text-[11px]">
            {constraints!.primary_key && (
              <ConstraintRow label="Primary Key" name={constraints!.primary_key.name} columns={constraints!.primary_key.columns} />
            )}
            {constraints!.unique?.map((u) => (
              <ConstraintRow key={u.name} label="Unique" name={u.name} columns={u.columns} />
            ))}
            {constraints!.foreign_keys?.map((fk) => {
              const refKey = `${fk.ref_owner}.${fk.ref_table}`;
              const refExists = Boolean(bundle.objects[refKey]);
              return (
                <div key={fk.name} className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Tag>Foreign Key</Tag>
                    <code className="font-mono font-semibold text-slate-800 dark:text-slate-200">{fk.name}</code>
                  </div>
                  <div className="font-mono text-slate-600 dark:text-slate-400">
                    ({fk.columns.join(', ')}) →{' '}
                    {refExists ? (
                      <button
                        type="button"
                        onClick={() => onSelectObject(refKey)}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {refKey}
                      </button>
                    ) : (
                      <span>{refKey}</span>
                    )}{' '}
                    ({fk.ref_columns.join(', ')})
                  </div>
                  <div className="text-slate-400 dark:text-slate-500 mt-0.5">ON DELETE {fk.delete_rule}</div>
                </div>
              );
            })}
            {visibleChecks.map((c) => (
              <div key={c.name} className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Tag>Check</Tag>
                  <code className="font-mono font-semibold text-slate-800 dark:text-slate-200">{c.name}</code>
                </div>
                <div className="font-mono text-slate-600 dark:text-slate-400">{c.condition ?? '—'}</div>
              </div>
            ))}
            {!showGenerated && hiddenGeneratedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowGenerated(true)}
                className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Show {hiddenGeneratedCount} system-generated NOT NULL check{hiddenGeneratedCount === 1 ? '' : 's'}
              </button>
            )}
            {showGenerated && checks.some((c) => c.generated) && (
              <button
                type="button"
                onClick={() => setShowGenerated(false)}
                className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Hide system-generated checks
              </button>
            )}
          </div>
        </Card>
      )}

      {table.extended_stats && table.extended_stats.length > 0 && (
        <Card title="Extended Statistics">
          <div className="space-y-1.5">
            {table.extended_stats.map((es) => (
              <div key={es.extension_name} className="text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono font-semibold text-slate-800 dark:text-slate-200">{es.extension_name}</code>
                  {es.has_histogram && <Tag>Histogram</Tag>}
                </div>
                <div className="font-mono text-slate-500 dark:text-slate-400 mt-0.5">{es.extension}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {indexBlock.indexes.length > 0 && (
        <Card title={`Indexes (${indexBlock.indexes.length})`}>
          <div className="space-y-1.5">
            {indexBlock.indexes.map((idx) => (
              <button
                key={idx.key}
                type="button"
                onClick={() => onSelectObject(idx.key)}
                className="w-full text-left text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800 p-2 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono font-semibold text-slate-800 dark:text-slate-200 truncate">{idx.key}</code>
                  <span className="text-slate-400 dark:text-slate-500 shrink-0">{idx.object.stats.uniqueness}</span>
                </div>
                <div className="font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  ({idx.object.columns.join(', ')})
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {table.ddl && <DdlBlock ddl={table.ddl} />}
    </div>
  );
}

function ConstraintRow({ label, name, columns }: { label: string; name: string; columns: string[] }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Tag>{label}</Tag>
        <code className="font-mono font-semibold text-slate-800 dark:text-slate-200">{name}</code>
      </div>
      <div className="font-mono text-slate-600 dark:text-slate-400">({columns.join(', ')})</div>
    </div>
  );
}
