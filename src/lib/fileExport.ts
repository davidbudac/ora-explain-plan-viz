/**
 * Browser-side file export helpers shared by the export/script dialogs
 * (client report, SQL Plan Baseline script, gather script).
 *
 * Failures are reported with error toasts (via the hook-free `toast` accessor)
 * rather than native `alert()` dialogs or silent no-ops, and every function
 * returns whether it worked so callers can confirm success themselves.
 */
import { toast } from '../components/ui';

/** Error-toast text for a blocked `window.open`, e.g. `popupBlockedMessage('print view')`. */
export function popupBlockedMessage(what: string): string {
  return `Pop-up blocked. Allow pop-ups for this site to open the ${what} in a window`;
}

/**
 * Saves `content` as a file named `filename` through a temporary object URL
 * and anchor click. Returns true when the download was started, false (after an
 * error toast) when the browser refused.
 */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8',
): boolean {
  let url: string | null = null;
  try {
    const blob = new Blob([content], { type: mimeType });
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return true;
  } catch (error) {
    toast.show({
      tone: 'error',
      title: 'Download failed',
      message: error instanceof Error && error.message ? error.message : `Could not save ${filename}`,
    });
    return false;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/**
 * Opens `html` in a new window and starts the browser's print dialog (the
 * "save as PDF" route). Returns false, after an error toast, when the popup
 * was blocked.
 */
export function printHtml(html: string): boolean {
  const win = window.open('', '_blank');
  if (!win) {
    toast.show({ tone: 'error', message: popupBlockedMessage('print view') });
    return false;
  }
  try {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (error) {
    win.close();
    toast.show({
      tone: 'error',
      title: 'Could not open the print view',
      message: error instanceof Error && error.message ? error.message : 'The new window did not accept the document',
    });
    return false;
  }
  // Give the new document a beat to lay out before opening the print dialog.
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      /* the user may have closed the window already */
    }
  }, 250);
  return true;
}
