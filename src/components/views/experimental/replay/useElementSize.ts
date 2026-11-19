import { useEffect, useState } from 'react';

/** Content-box size of an element, kept current with a ResizeObserver. */
export function useElementSize(ref: React.RefObject<HTMLElement | null>, fallback = { w: 900, h: 520 }) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
