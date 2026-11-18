// src/lib/notes/live/useNarrowWindow.ts
//
// Whether the window is as narrow as the one MainPanel puts the live notes above the conversation in (its
// `max-width: 767px`), as it changes.
import { useEffect, useState } from 'react';

const NARROW = '(max-width: 767px)';

export function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return narrow;
}
