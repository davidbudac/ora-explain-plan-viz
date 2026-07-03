import { looksLikeMetadataBundle, type MetadataBundle, type CoverageWarning } from './bundle';

export type DropClassification =
  | { kind: 'bundle' }
  | { kind: 'plan' }
  | { kind: 'error'; message: string };

export function classifyDroppedFile(filename: string, text: string): DropClassification {
  // Bundle content wins over extension: spool files are often .lst/.txt and
  // may carry SQL*Plus noise around the JSON. parseBundle handles cleanup.
  if (looksLikeMetadataBundle(text)) {
    return { kind: 'bundle' };
  }
  const isJsonFile = /\.json$/i.test(filename);
  if (!isJsonFile) {
    return { kind: 'plan' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      kind: 'error',
      message: `File has a .json extension but is not valid JSON: ${detail}`,
    };
  }
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
    return { kind: 'plan' };
  }
  return {
    kind: 'error',
    message: 'JSON file is neither a metadata bundle nor a recognized plan format.',
  };
}

export function findCoverageWarning(
  bundle: MetadataBundle,
  objectName: string | undefined,
): CoverageWarning | null {
  if (!objectName) return null;
  const direct = bundle.coverage_warnings.find((w) => w.object === objectName);
  if (direct) return direct;
  const suffix = `.${objectName}`;
  const suffixed = bundle.coverage_warnings.find((w) => w.object.endsWith(suffix));
  return suffixed ?? null;
}
