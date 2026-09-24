import { useCallback, useSyncExternalStore } from 'react';
import type { Readable } from '../../lib/view/conversationView';

/** A `Readable`'s value, re-rendering when it changes. */
export function useReadable<T>(source: Readable<T>): T {
  // A stable subscribe per source: a new function on every render would resubscribe every render.
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source]);
  return useSyncExternalStore(subscribe, source.get);
}
