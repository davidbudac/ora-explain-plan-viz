/** Selector matching elements that can receive keyboard focus via Tab. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

function isRendered(el: HTMLElement, boundary: HTMLElement): boolean {
  // Prefer the native check (Chrome 105+, Safari 17.4+, Firefox 106+).
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
  }
  // Fallback (jsdom, older browsers): walk up to the boundary looking for
  // display:none / visibility:hidden. Geometry checks (offsetParent, client
  // rects) are avoided because jsdom reports none.
  for (let node: HTMLElement | null = el; node && node !== boundary.parentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none') return false;
    if (node === el && style.visibility === 'hidden') return false;
  }
  return true;
}

/**
 * Tabbable descendants of `container`, in DOM order (positive tabindex is not
 * re-ordered; the app never uses it). Excludes disabled, hidden, inert and
 * `tabindex="-1"` elements.
 */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => {
    if (el.tabIndex < 0) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) {
      // Radios in a group are a single tab stop; keep only the checked one, or
      // the first when none is checked.
      const group = el.name
        ? Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
            (r) => r.name === el.name && r.form === el.form,
          )
        : [el];
      const checked = group.find((r) => r.checked);
      if (checked ? checked !== el : group[0] !== el) return false;
    }
    return isRendered(el, container);
  });
}
