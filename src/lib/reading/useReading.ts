import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { holdLastReading, peekReading, requestReading, subscribeReading } from './annotate';
import type { ReadingLanguage, RubyPiece } from './types';

const noSubscription = () => () => {};

/** The last pieces this row was given, and the text and language they were for. */
interface Kept {
  text: string;
  lang: ReadingLanguage;
  pieces: RubyPiece[];
}

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
  // A growing row's text is a new key at every step, and a Japanese one waits on
  // the worker: rather than drop its ruby (and its line height) until the answer
  // comes, keep the last pieces with the new text plain after them (R11).
  const kept = useRef<Kept | null>(null);
  if (kept.current && kept.current.lang !== lang) kept.current = null;
  if (pieces && lang && kept.current?.pieces !== pieces) kept.current = { text, lang, pieces };
  const prev = kept.current;
  const shown = useMemo(() => {
    if (pieces || !prev || !text.startsWith(prev.text)) return pieces;
    return text.length > prev.text.length ? [...prev.pieces, { text: text.slice(prev.text.length) }] : prev.pieces;
  }, [pieces, prev, text]);
  return useMemo(() => (shown && holdTail ? holdLastReading(shown) : shown), [shown, holdTail]);
}
