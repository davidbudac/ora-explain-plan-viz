/**
 * Programmatic "Open plan file…" picker shared by the File menu, the compact
 * menu, the command palette and the Cmd/Ctrl+O shortcut. The chosen files go to
 * the plan context's `loadFiles` — the same entry point as a full-window drop —
 * so classification, confirmations, bundle pairing and toasts behave alike.
 */

/** Plan text, SQL Monitor XML/HTML, JSON plans, metadata bundles and annotated exports. */
export const PLAN_FILE_ACCEPT = '.txt,.log,.lst,.sql,.out,.xml,.html,.htm,.json,text/*';

// One hidden input for the page's lifetime. It lives in the DOM (Safari does not
// reliably fire `change` for a detached input) and is reused by every caller.
let sharedInput: HTMLInputElement | null = null;

function getInput(): HTMLInputElement | null {
  if (typeof document === 'undefined') return null;
  if (sharedInput && sharedInput.isConnected) return sharedInput;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = PLAN_FILE_ACCEPT;
  input.tabIndex = -1;
  input.hidden = true;
  input.setAttribute('aria-hidden', 'true');
  input.setAttribute('data-testid', 'plan-file-input');
  document.body.appendChild(input);
  sharedInput = input;
  return input;
}

/**
 * Opens the browser's file picker (must be called from a user gesture) and
 * hands the chosen files to `onFiles`. Cancelling does nothing; the input is
 * reset afterwards so picking the same file twice works.
 */
export function openPlanFilePicker(onFiles: (files: File[]) => void): void {
  const input = getInput();
  if (!input) return;
  input.value = '';
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    // Reset so the same file can be re-selected.
    input.value = '';
    input.onchange = null;
    if (files.length > 0) onFiles(files);
  };
  input.click();
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
/** Display label of the global Open shortcut (see `isOpenFileShortcut`). */
export const OPEN_FILE_SHORTCUT_LABEL = IS_MAC ? '⌘O' : 'Ctrl+O';

/**
 * True for Cmd/Ctrl+O pressed outside a text field. Inside inputs, textareas,
 * selects and contenteditable the key is left alone (the browser's own Open).
 */
export function isOpenFileShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== 'o') return false;
  const target = event.target;
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return false;
  }
  return true;
}
