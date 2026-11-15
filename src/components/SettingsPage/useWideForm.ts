// src/components/SettingsPage/useWideForm.ts
//
// Whether a full page (Settings, History) has room for its navigation beside its content: at least 768 px wide on
// the desktop. The extension always uses the narrow form.
import { useLayoutEffect, useState, type RefObject } from 'react';
import { isExtension } from '../../utils/environment';

export const WIDE_MIN = 768;

export function useWideForm(root: RefObject<HTMLElement | null>): boolean {
  const measure = () => {
    if (isExtension()) return false;
    const width = root.current?.getBoundingClientRect().width || window.innerWidth;
    return width >= WIDE_MIN;
  };
  const [wide, setWide] = useState(() => !isExtension() && window.innerWidth >= WIDE_MIN);
  useLayoutEffect(() => {
    const update = () => setWide(measure());
    update();
    if (typeof ResizeObserver !== 'undefined' && root.current) {
      const observer = new ResizeObserver(update);
      observer.observe(root.current);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return wide;
}
