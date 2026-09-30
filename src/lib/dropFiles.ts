/**
 * File loading for drag-and-drop (window overlay and the input panel).
 *
 * Pure-ish helpers: reading a File as text, classifying what it is, and
 * deciding what to do when several files arrive in one drop. The plan context
 * owns the side effects (parsing, attaching, error reporting).
 */
import { classifyDroppedFile } from './metadata/dropClassify';
import { validateExport } from './annotations';
import type { AnnotatedPlanExport } from './annotations';

export type DroppedFileKind =
  | { kind: 'plan'; name: string; text: string }
  | { kind: 'bundle'; name: string; text: string }
  | { kind: 'annotated'; name: string; text: string; data: AnnotatedPlanExport }
  | { kind: 'error'; name: string; message: string };

export interface DroppedTextFile {
  name: string;
  text: string;
}

/**
 * What a drop should do. `ignored` lists files that were not used (e.g. a
 * second plan file) so the UI can mention them.
 */
export type DropPlan =
  | { action: 'load-plan'; name: string; text: string; bundleText?: string; bundleName?: string; ignored: string[] }
  | { action: 'import-annotated'; name: string; data: AnnotatedPlanExport; bundleText?: string; bundleName?: string; ignored: string[] }
  | { action: 'attach-bundle'; name: string; text: string; ignored: string[] }
  | { action: 'error'; message: string };

/** Read a File as UTF-8 text. Rejects with a readable message on I/O errors. */
export function readFileAsText(file: Blob & { name?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const label = file.name ? `"${file.name}"` : 'the file';
    let reader: FileReader;
    try {
      reader = new FileReader();
    } catch {
      reject(new Error(`Could not read ${label}: file reading is not supported in this browser.`));
      return;
    }
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      const detail = reader.error?.message;
      reject(new Error(`Could not read ${label}${detail ? `: ${detail}` : '.'}`));
    };
    reader.onabort = () => {
      reject(new Error(`Reading ${label} was aborted.`));
    };
    reader.readAsText(file);
  });
}

/**
 * True when `text` is the app's own "Save annotated plan" JSON export.
 * Returns the parsed export, or null.
 */
export function parseAnnotatedExport(text: string): AnnotatedPlanExport | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return validateExport(data) ? data : null;
}

/** Classify a single dropped file by content (extension only breaks ties). */
export function classifyFileText(name: string, text: string): DroppedFileKind {
  if (!text.trim()) {
    return { kind: 'error', name, message: `"${name}" is empty — nothing to load.` };
  }

  // Annotated exports must be checked before bundles: a v2 export embeds a
  // metadata bundle, so it also matches the bundle sniffing.
  const annotated = parseAnnotatedExport(text);
  if (annotated) {
    return { kind: 'annotated', name, text, data: annotated };
  }

  const classification = classifyDroppedFile(name, text);
  if (classification.kind === 'bundle') return { kind: 'bundle', name, text };
  if (classification.kind === 'plan') return { kind: 'plan', name, text };

  const isJson = /\.json$/i.test(name);
  const message = isJson && !classification.message.includes('not valid JSON')
    ? `"${name}" is JSON, but not a plan (V$SQL_PLAN rows), a metadata bundle or an annotated-plan export.`
    : `"${name}": ${classification.message}`;
  return { kind: 'error', name, message };
}

/**
 * Decide what to do with a (possibly multi-file) drop:
 *  - one plan (or annotated export) is loaded; a bundle among the files is
 *    auto-attached to it;
 *  - a bundle on its own is attached to the loaded plan(s);
 *  - when nothing is usable, the first error is reported.
 */
export function planDrop(files: DroppedTextFile[]): DropPlan {
  if (files.length === 0) {
    return { action: 'error', message: 'Nothing was dropped.' };
  }

  const classified = files.map((f) => classifyFileText(f.name, f.text));
  const primary = classified.find((c) => c.kind === 'plan' || c.kind === 'annotated');
  const bundle = classified.find((c): c is Extract<DroppedFileKind, { kind: 'bundle' }> => c.kind === 'bundle');

  const ignoredExcept = (...used: Array<DroppedFileKind | undefined>) =>
    classified.filter((c) => !used.includes(c)).map((c) => c.name);

  if (primary?.kind === 'plan') {
    return {
      action: 'load-plan',
      name: primary.name,
      text: primary.text,
      ...(bundle ? { bundleText: bundle.text, bundleName: bundle.name } : {}),
      ignored: ignoredExcept(primary, bundle),
    };
  }

  if (primary?.kind === 'annotated') {
    return {
      action: 'import-annotated',
      name: primary.name,
      data: primary.data,
      ...(bundle ? { bundleText: bundle.text, bundleName: bundle.name } : {}),
      ignored: ignoredExcept(primary, bundle),
    };
  }

  if (bundle) {
    return { action: 'attach-bundle', name: bundle.name, text: bundle.text, ignored: ignoredExcept(bundle) };
  }

  const firstError = classified.find((c): c is Extract<DroppedFileKind, { kind: 'error' }> => c.kind === 'error');
  return { action: 'error', message: firstError?.message ?? 'None of the dropped files could be loaded.' };
}

/** True when a drag carries files (not text or links dragged from the page). */
export function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

/** Read every file of a drop as text; per-file read errors become error entries. */
export async function readDroppedFiles(files: File[]): Promise<{ files: DroppedTextFile[]; errors: string[] }> {
  const results = await Promise.allSettled(files.map((file) => readFileAsText(file)));
  const out: DroppedTextFile[] = [];
  const errors: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      out.push({ name: files[i].name, text: result.value });
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : `Could not read "${files[i].name}".`);
    }
  });
  return { files: out, errors };
}
