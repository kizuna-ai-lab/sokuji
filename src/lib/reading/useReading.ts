import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { holdLastReading, peekReading, requestReading, subscribeReading } from './annotate';
import type { ReadingLanguage, RubyPiece } from './types';

const noSubscription = () => () => {};

/** A row's ruby pieces, or null while they are not ready or the row gets no readings. */
export function useReading(text: string, lang: ReadingLanguage | null, holdTail: boolean): RubyPiece[] | null {
  const subscribe = useCallback(
    (listener: () => void) => (lang ? subscribeReading(text, lang, listener) : noSubscription()),
    [text, lang],
  );
  const pieces = useSyncExternalStore(subscribe, () => (lang ? peekReading(text, lang) : null));
  useEffect(() => {
    if (lang && !pieces) requestReading(text, lang);
  }, [text, lang, pieces]);
  return useMemo(() => (pieces && holdTail ? holdLastReading(pieces) : pieces), [pieces, holdTail]);
}
