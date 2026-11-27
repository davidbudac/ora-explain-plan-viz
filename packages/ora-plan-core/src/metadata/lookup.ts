import type { MetadataBundle, MetadataObject } from './bundle.ts';

/**
 * Bundle keys are OWNER.NAME. With an owner, only that schema's object matches; without one, an
 * unqualified name resolves only when a single schema has it, so stats never come from a namesake.
 */
export function findObjectInBundle(
  bundle: MetadataBundle,
  objectName: string | undefined,
  objectOwner?: string,
): { key: string; object: MetadataObject } | null {
  if (!objectName) return null;
  const keys = objectOwner ? [`${objectOwner}.${objectName}`, objectName] : [objectName];
  for (const key of keys) {
    const object = bundle.objects[key];
    if (object) return { key, object };
  }
  if (objectOwner) return null;

  const suffix = `.${objectName}`;
  const matches = Object.keys(bundle.objects).filter((key) => key.endsWith(suffix));
  return matches.length === 1 ? { key: matches[0], object: bundle.objects[matches[0]] } : null;
}
