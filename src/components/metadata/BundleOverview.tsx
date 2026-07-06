import type { ReactNode } from 'react';
import type { MetadataBundle } from '../../lib/metadata/bundle';
import { Card, Tag, formatDateShort } from './shared';

function KV({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px] py-0.5">
      <span className="text-slate-400 dark:text-slate-500 shrink-0">{label}</span>
      <span className="font-mono text-slate-800 dark:text-slate-200 text-right truncate">{value}</span>
    </div>
  );
}

/** Landing pane for the metadata explorer: bundle-wide cards, no single object selected. */
export function BundleOverview({ bundle }: { bundle: MetadataBundle }) {
  const objects = Object.values(bundle.objects);
  const tableCount = objects.filter((o) => o.type === 'TABLE').length;
  const indexCount = objects.filter((o) => o.type === 'INDEX').length;
  const sql = bundle.sql_management;
  const hasSqlManagement =
    Boolean(sql) &&
    ((sql!.baselines?.length ?? 0) > 0 ||
      (sql!.profiles?.length ?? 0) > 0 ||
      (sql!.patches?.length ?? 0) > 0 ||
      (sql!.directives?.length ?? 0) > 0);

  return (
    <div className="p-4 space-y-3 max-w-3xl">
      <Card title="Source & Capture">
        <KV label="Database" value={bundle.source.db_name} />
        <KV label="Oracle Version" value={bundle.source.oracle_version} />
        <KV label="Container" value={bundle.source.container_name} />
        <KV label="Captured" value={formatDateShort(bundle.captured_at) ?? bundle.captured_at} />
        <KV label="SQL_ID" value={bundle.plan_ref.sql_id} />
        <KV label="Plan Hash" value={bundle.plan_ref.plan_hash_value} />
        <KV label="Objects" value={`${tableCount} tables, ${indexCount} indexes`} />
        <KV label="Bundle Version" value={bundle.version} />
      </Card>

      {bundle.system_params && (
        <Card title="System Parameters">
          <KV label="DB Block Size" value={`${bundle.system_params.db_block_size} bytes`} />
          <KV label="Optimizer Features Enable" value={bundle.system_params.optimizer_features_enable} />
          <KV label="Optimizer Index Cost Adj" value={bundle.system_params.optimizer_index_cost_adj} />
          <KV label="Optimizer Index Caching" value={bundle.system_params.optimizer_index_caching} />
        </Card>
      )}

      {bundle.optimizer_env && bundle.optimizer_env.length > 0 && (
        <Card title={`Optimizer Environment (${bundle.optimizer_env.length} non-default)`}>
          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {bundle.optimizer_env.map((p) => (
              <KV key={p.name} label={p.name} value={p.value} />
            ))}
          </div>
        </Card>
      )}

      {hasSqlManagement && (
        <Card title="SQL Management">
          <div className="space-y-3">
            {sql!.baselines && sql!.baselines.length > 0 && (
              <SqlManagementGroup title="Baselines">
                {sql!.baselines.map((b) => (
                  <div key={b.plan_name} className="text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-mono font-semibold truncate">{b.plan_name}</code>
                      <div className="flex gap-1 shrink-0">
                        {b.enabled && <Tag>Enabled</Tag>}
                        {b.accepted && <Tag>Accepted</Tag>}
                        {b.fixed && <Tag color="amber">Fixed</Tag>}
                      </div>
                    </div>
                    {b.origin && <div className="text-slate-400 dark:text-slate-500 mt-0.5">{b.origin}</div>}
                  </div>
                ))}
              </SqlManagementGroup>
            )}
            {sql!.profiles && sql!.profiles.length > 0 && (
              <SqlManagementGroup title="Profiles">
                {sql!.profiles.map((p) => (
                  <div key={p.name} className="text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-1.5 font-mono">
                    {p.name} {p.status && <span className="text-slate-400 dark:text-slate-500">({p.status})</span>}
                  </div>
                ))}
              </SqlManagementGroup>
            )}
            {sql!.patches && sql!.patches.length > 0 && (
              <SqlManagementGroup title="Patches">
                {sql!.patches.map((p) => (
                  <div key={p.name} className="text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-1.5 font-mono">
                    {p.name} {p.status && <span className="text-slate-400 dark:text-slate-500">({p.status})</span>}
                  </div>
                ))}
              </SqlManagementGroup>
            )}
            {sql!.directives && sql!.directives.length > 0 && (
              <SqlManagementGroup title="Directives">
                {sql!.directives.map((d) => (
                  <div key={d.directive_id} className="text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-1.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <code className="font-mono">{d.directive_id}</code>
                      <div className="flex gap-1 shrink-0">
                        <Tag>{d.type}</Tag>
                        <Tag color={d.state === 'USABLE' ? undefined : 'amber'}>{d.state}</Tag>
                      </div>
                    </div>
                    {d.reason && <div className="text-slate-500 dark:text-slate-400 mb-1">{d.reason}</div>}
                    {d.objects.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {d.objects.map((o, i) => (
                          <span
                            key={`${o.owner}.${o.object_name}.${o.subobject_name ?? ''}.${i}`}
                            title={o.object_type}
                            className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono"
                          >
                            {o.owner}.{o.object_name}
                            {o.subobject_name ? `.${o.subobject_name}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </SqlManagementGroup>
            )}
          </div>
        </Card>
      )}

      {bundle.coverage_warnings.length > 0 && (
        <Card title={`Coverage Warnings (${bundle.coverage_warnings.length})`}>
          <ul className="space-y-1">
            {bundle.coverage_warnings.map((w, i) => (
              <li key={i} className="text-[11px] text-amber-700 dark:text-amber-400">
                <span className="font-mono font-semibold">{w.object}</span>: {w.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function SqlManagementGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-tighter text-slate-400 dark:text-slate-500 mb-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
