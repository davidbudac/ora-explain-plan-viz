import type { PlanSource } from './types';

// --- Highlight Colors ---

export type HighlightColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';

export interface HighlightColorDef {
  name: HighlightColor;
  label: string;
  /** Tailwind classes for the ring around a plan node */
  ring: string;
  /** Tailwind classes for a small color chip button */
  chip: string;
  /** Tailwind classes for the active/selected chip */
  chipActive: string;
  /** Tailwind classes for annotation group bounding box border */
  groupBorder: string;
  /** Tailwind classes for annotation group bounding box background */
  groupBg: string;
  /** Tailwind classes for annotation text color */
  text: string;
}

export const HIGHLIGHT_COLORS: HighlightColorDef[] = [
  {
    name: 'red',
    label: 'Red',
    ring: 'ring-2 ring-red-500 dark:ring-red-400 ring-offset-1 dark:ring-offset-gray-900',
    chip: 'bg-red-400 dark:bg-red-500',
    chipActive: 'bg-red-500 dark:bg-red-400 ring-2 ring-red-300 dark:ring-red-600',
    groupBorder: 'border-red-400 dark:border-red-500',
    groupBg: 'bg-red-50/30 dark:bg-red-900/10',
    text: 'text-red-600 dark:text-red-400',
  },
  {
    name: 'orange',
    label: 'Orange',
    ring: 'ring-2 ring-orange-500 dark:ring-orange-400 ring-offset-1 dark:ring-offset-gray-900',
    chip: 'bg-orange-400 dark:bg-orange-500',
    chipActive: 'bg-orange-500 dark:bg-orange-400 ring-2 ring-orange-300 dark:ring-orange-600',
    groupBorder: 'border-orange-400 dark:border-orange-500',
    groupBg: 'bg-orange-50/30 dark:bg-orange-900/10',
    text: 'text-orange-600 dark:text-orange-400',
  },
  {
    name: 'yellow',
    label: 'Yellow',
    ring: 'ring-2 ring-yellow-500 dark:ring-yellow-400 ring-offset-1 dark:ring-offset-gray-900',
    chip: 'bg-yellow-400 dark:bg-yellow-500',
    chipActive: 'bg-yellow-500 dark:bg-yellow-400 ring-2 ring-yellow-300 dark:ring-yellow-600',
    groupBorder: 'border-yellow-400 dark:border-yellow-500',
    groupBg: 'bg-yellow-50/30 dark:bg-yellow-900/10',
    text: 'text-yellow-600 dark:text-yellow-400',
  },
  {
    name: 'green',
    label: 'Green',
    ring: 'ring-2 ring-green-500 dark:ring-green-400 ring-offset-1 dark:ring-offset-gray-900',
    chip: 'bg-green-400 dark:bg-green-500',
    chipActive: 'bg-green-500 dark:bg-green-400 ring-2 ring-green-300 dark:ring-green-600',
    groupBorder: 'border-green-400 dark:border-green-500',
    groupBg: 'bg-green-50/30 dark:bg-green-900/10',
    text: 'text-green-600 dark:text-green-400',
  },
  {
    name: 'blue',
    label: 'Blue',
    ring: 'ring-2 ring-blue-500 dark:ring-blue-400 ring-offset-1 dark:ring-offset-gray-900',
    chip: 'bg-blue-400 dark:bg-blue-500',
    chipActive: 'bg-blue-500 dark:bg-blue-400 ring-2 ring-blue-300 dark:ring-blue-600',
    groupBorder: 'border-blue-400 dark:border-blue-500',
    groupBg: 'bg-blue-50/30 dark:bg-blue-900/10',
    text: 'text-blue-600 dark:text-blue-400',
  },
  {
    name: 'purple',
    label: 'Purple',
    ring: 'ring-2 ring-purple-500 dark:ring-purple-400 ring-offset-1 dark:ring-offset-gray-900',
    chip: 'bg-purple-400 dark:bg-purple-500',
    chipActive: 'bg-purple-500 dark:bg-purple-400 ring-2 ring-purple-300 dark:ring-purple-600',
    groupBorder: 'border-purple-400 dark:border-purple-500',
    groupBg: 'bg-purple-50/30 dark:bg-purple-900/10',
    text: 'text-purple-600 dark:text-purple-400',
  },
  {
    name: 'pink',
    label: 'Pink',
    ring: 'ring-2 ring-pink-500 dark:ring-pink-400 ring-offset-1 dark:ring-offset-gray-900',
    chip: 'bg-pink-400 dark:bg-pink-500',
    chipActive: 'bg-pink-500 dark:bg-pink-400 ring-2 ring-pink-300 dark:ring-pink-600',
    groupBorder: 'border-pink-400 dark:border-pink-500',
    groupBg: 'bg-pink-50/30 dark:bg-pink-900/10',
    text: 'text-pink-600 dark:text-pink-400',
  },
];

export function getHighlightColorDef(color: HighlightColor): HighlightColorDef {
  return HIGHLIGHT_COLORS.find((c) => c.name === color) || HIGHLIGHT_COLORS[4]; // default blue
}

// --- Data Model ---

export interface NodeAnnotation {
  nodeId: number;
  text: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface NodeHighlight {
  nodeId: number;
  color: HighlightColor;
}

export interface AnnotationGroup {
  id: string; // UUID
  name: string;
  nodeIds: number[];
  color: HighlightColor;
  note?: string;
}

export interface AnnotationState {
  nodeAnnotations: Map<number, NodeAnnotation>;
  nodeHighlights: Map<number, NodeHighlight>;
  groups: AnnotationGroup[];
}

export function createEmptyAnnotationState(): AnnotationState {
  return {
    nodeAnnotations: new Map(),
    nodeHighlights: new Map(),
    groups: [],
  };
}

export function hasAnnotations(state: AnnotationState): boolean {
  return state.nodeAnnotations.size > 0 || state.nodeHighlights.size > 0 || state.groups.length > 0;
}

// --- Serialization ---

interface SerializedAnnotationState {
  nodeAnnotations: Record<string, NodeAnnotation>;
  nodeHighlights: Record<string, NodeHighlight>;
  groups: AnnotationGroup[];
}

export interface AnnotatedPlanExport {
  version: 1;
  exportedAt: string;
  rawPlanText: string;
  planSource: PlanSource;
  planHashValue?: string;
  sqlId?: string;
  annotations: SerializedAnnotationState;
  metadata?: {
    author?: string;
    description?: string;
  };
}

export function serializeAnnotations(state: AnnotationState): SerializedAnnotationState {
  const nodeAnnotations: Record<string, NodeAnnotation> = {};
  for (const [key, value] of state.nodeAnnotations) {
    nodeAnnotations[key.toString()] = value;
  }
  const nodeHighlights: Record<string, NodeHighlight> = {};
  for (const [key, value] of state.nodeHighlights) {
    nodeHighlights[key.toString()] = value;
  }
  return {
    nodeAnnotations,
    nodeHighlights,
    groups: state.groups,
  };
}

export function deserializeAnnotations(data: SerializedAnnotationState): AnnotationState {
  const nodeAnnotations = new Map<number, NodeAnnotation>();
  for (const [key, value] of Object.entries(data.nodeAnnotations || {})) {
    nodeAnnotations.set(parseInt(key), value);
  }
  const nodeHighlights = new Map<number, NodeHighlight>();
  for (const [key, value] of Object.entries(data.nodeHighlights || {})) {
    nodeHighlights.set(parseInt(key), value);
  }
  return {
    nodeAnnotations,
    nodeHighlights,
    groups: data.groups || [],
  };
}

// --- Validation ---

const VALID_HIGHLIGHT_COLORS: Set<string> = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);

export function validateExport(data: unknown): data is AnnotatedPlanExport {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) return false;
  if (typeof obj.rawPlanText !== 'string' || !obj.rawPlanText) return false;
  if (typeof obj.planSource !== 'string') return false;
  if (!['dbms_xplan', 'sql_monitor_text', 'sql_monitor_xml'].includes(obj.planSource as string)) return false;

  const annotations = obj.annotations;
  if (!annotations || typeof annotations !== 'object') return false;
  const ann = annotations as Record<string, unknown>;

  // Validate nodeHighlights colors
  if (ann.nodeHighlights && typeof ann.nodeHighlights === 'object') {
    for (const value of Object.values(ann.nodeHighlights as Record<string, unknown>)) {
      if (value && typeof value === 'object' && 'color' in value) {
        if (!VALID_HIGHLIGHT_COLORS.has((value as { color: string }).color)) return false;
      }
    }
  }

  // Validate groups
  if (ann.groups && Array.isArray(ann.groups)) {
    for (const group of ann.groups as AnnotationGroup[]) {
      if (!group.id || !group.name || !Array.isArray(group.nodeIds)) return false;
      if (!VALID_HIGHLIGHT_COLORS.has(group.color)) return false;
    }
  }

  return true;
}

// --- File I/O ---

export function downloadAnnotatedPlan(exportData: AnnotatedPlanExport): void {
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const parts: string[] = [];
  if (exportData.sqlId) parts.push(exportData.sqlId);
  if (exportData.planHashValue) parts.push(exportData.planHashValue);
  if (parts.length === 0) parts.push('plan');
  const filename = `${parts.join('-')}-annotated.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateGroupId(): string {
  return crypto.randomUUID();
}
