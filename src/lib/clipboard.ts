/**
 * Copy text to the clipboard, returning whether it actually succeeded.
 *
 * Tries the async Clipboard API first (only in a secure context, where it is
 * available and permitted), then falls back to a hidden `<textarea>` +
 * `document.execCommand('copy')`. The fallback matters because the async API is
 * `undefined` on plain-HTTP origins (e.g. a self-hosted Docker/nginx build) and
 * can be blocked when the document lacks focus — cases where the old
 * fire-and-forget `navigator.clipboard.writeText(...)` failed silently while the
 * UI still claimed "copied".
 *
 * Never throws: callers get a boolean and can offer a manual-copy fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Blocked (no focus, permission denied, …) — fall through to the legacy path.
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // readonly + off-screen so the textarea never steals focus visibly or
    // pops up the mobile keyboard, while still being selectable for the copy.
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
