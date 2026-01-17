import { useState } from 'react';
import { MiniMap } from '@xyflow/react';
import type { MiniMapProps } from '@xyflow/react';

interface CollapsibleMiniMapProps extends MiniMapProps {
  defaultCollapsed?: boolean;
}

export function CollapsibleMiniMap({
  defaultCollapsed = true,
  ...miniMapProps
}: CollapsibleMiniMapProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="absolute bottom-2 right-2 z-10">
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
          title="Show minimap"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="inline-block mr-1"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <rect x="12" y="12" width="6" height="6" rx="1" />
          </svg>
          Map
        </button>
      ) : (
        <div className="relative">
          <button
            onClick={() => setCollapsed(true)}
            className="absolute -top-1 -right-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full w-6 h-6 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-sm"
            title="Hide minimap"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <MiniMap
            {...miniMapProps}
            style={{ position: 'relative', margin: 0 }}
          />
        </div>
      )}
    </div>
  );
}
