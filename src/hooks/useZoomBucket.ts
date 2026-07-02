import { useStore } from '@xyflow/react';

/**
 * Semantic zoom levels for plan nodes:
 * - overview (<0.5): solid category-colored block, operation name only
 * - mid (0.5–0.8): card chrome with one headline metric
 * - full (>0.8): everything
 */
export type ZoomBucket = 'overview' | 'mid' | 'full';

export function zoomToBucket(zoom: number): ZoomBucket {
  if (zoom < 0.5) return 'overview';
  if (zoom < 0.8) return 'mid';
  return 'full';
}

/**
 * Current zoom bucket, quantized so components re-render only when the
 * viewport crosses a bucket threshold (not on every zoom tick).
 * Must be used inside a ReactFlowProvider.
 */
export function useZoomBucket(): ZoomBucket {
  return useStore((s) => zoomToBucket(s.transform[2]));
}
