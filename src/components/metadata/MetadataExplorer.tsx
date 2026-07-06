import { useState } from 'react';
import type { MetadataBundle } from '../../lib/metadata/bundle';
import { ObjectListSidebar } from './ObjectListSidebar';
import { BundleOverview } from './BundleOverview';
import { TableObjectDetail } from './TableObjectDetail';
import { IndexObjectDetail } from './IndexObjectDetail';

interface MetadataExplorerProps {
  bundle: MetadataBundle;
}

/**
 * Master-detail explorer for a metadata bundle. Rendered both by the in-app
 * Metadata tab and by the popout window — same component instance stays in
 * sync via context in the popout case, a fresh instance (same bundle) in the
 * tab case.
 */
export function MetadataExplorer({ bundle }: MetadataExplorerProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = selectedKey ? bundle.objects[selectedKey] : null;

  return (
    <div className="h-full flex min-h-0">
      <ObjectListSidebar bundle={bundle} selectedKey={selectedKey} onSelect={setSelectedKey} />
      <div className="flex-1 min-w-0 overflow-y-auto bg-slate-50 dark:bg-slate-950">
        {!selected ? (
          <BundleOverview bundle={bundle} />
        ) : selected.type === 'TABLE' ? (
          <TableObjectDetail
            objectKey={selectedKey as string}
            table={selected}
            bundle={bundle}
            onSelectObject={setSelectedKey}
          />
        ) : (
          <IndexObjectDetail
            objectKey={selectedKey as string}
            index={selected}
            bundle={bundle}
            onSelectObject={setSelectedKey}
          />
        )}
      </div>
    </div>
  );
}
