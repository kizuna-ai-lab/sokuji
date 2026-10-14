import { describeCause, reportWarning } from '../diagnostics/report';
import { furigana } from './ja/furigana';
import { getJapaneseState, subscribeJapanese, tokenizeJapanese } from './ja/runtime';
import type { ReadingLanguage, RubyPiece } from './types';

type SyncLanguage = Exclude<ReadingLanguage, 'ja'>;
type Annotator = (text: string) => RubyPiece[];

// Each annotator loads the first time its language is asked for, so none of this
// is in the startup bundle; once loaded it runs synchronously in render.
const LOADERS: Record<SyncLanguage, () => Promise<Annotator>> = {
  zh: () => import('./zh').then((m) => m.annotateChinese),
  ko: () => import('./ko').then((m) => m.annotateKorean),
  ru: () => import('./cyrillic').then((m) => (text: string) => m.annotateCyrillic(text, 'ru')),
  uk: () => import('./cyrillic').then((m) => (text: string) => m.annotateCyrillic(text, 'uk')),
};

export const CACHE_LIMIT = 2000;
const WAITING_LIMIT = 500;

const annotators = new Map<SyncLanguage, Annotator>();
const loading = new Set<SyncLanguage>();
/** Languages whose annotator failed to load; not retried this session. */
const failed = new Set<SyncLanguage>();
/** Languages already reported for pieces that did not join back to their text. */
const misjoined = new Set<ReadingLanguage>();
/** Pieces by language and text, least recently used first. Rows churn while streaming. */
const cache = new Map<string, RubyPiece[]>();
/** Japanese texts sent to the worker and not yet answered. */
const asked = new Set<string>();
/** Japanese texts asked for before the worker was ready. */
const waiting = new Map<string, string>();
const byKey = new Map<string, Set<() => void>>();
const everyone = new Set<() => void>();

const keyOf = (text: string, lang: ReadingLanguage) => `${lang}\u0000${text}`;

/**
 * Caches `pieces` as the newest, evicting the oldest key no mounted row is
 * subscribed to. A subscribed key is never evicted: rows evicting one another
 * during render would hand React a new snapshot on every read. Past the limit
 * with every key subscribed, the cache holds what is mounted.
 */
function remember(key: string, pieces: RubyPiece[]): RubyPiece[] {
  cache.delete(key);
  cache.set(key, pieces);
  if (cache.size > CACHE_LIMIT) {
    for (const old of cache.keys()) {
      if (byKey.has(old)) continue;
      cache.delete(old);
      break;
    }
  }
  return pieces;
}

/** The pieces, or the text as one plain piece when they do not concatenate to it (RubyText's karaoke relies on that). */
function joined(text: string, lang: ReadingLanguage, pieces: RubyPiece[]): RubyPiece[] {
  if (pieces.map((p) => p.text).join('') === text) return pieces;
  if (!misjoined.has(lang)) {
    misjoined.add(lang);
    reportWarning('Readings', `The ${lang} readings did not match their text, which is shown without them`, {
      dedupeKey: `reading.concat.${lang}`,
    });
  }
  return [{ text }];
}

function tell(listeners: Iterable<() => void> | undefined): void {
  if (listeners) for (const listener of [...listeners]) listener();
}

/** The pieces for `text`, or null while its annotator is not ready. Starts nothing (see `requestReading`). */
export function peekReading(text: string, lang: ReadingLanguage): RubyPiece[] | null {
  const key = keyOf(text, lang);
  const hit = cache.get(key);
  if (hit) return remember(key, hit);
  if (lang === 'ja') return null;
  const annotator = annotators.get(lang);
  return annotator ? remember(key, joined(text, lang, annotator(text))) : null;
}

/** Starts what `peekReading` is waiting on: loading an annotator, or tokenizing Japanese. */
export function requestReading(text: string, lang: ReadingLanguage): void {
  if (lang !== 'ja') {
    if (annotators.has(lang) || loading.has(lang) || failed.has(lang)) return;
    loading.add(lang);
    LOADERS[lang]().then(
      (annotator) => {
        annotators.set(lang, annotator);
        loading.delete(lang);
        tell(everyone);
      },
      (err) => {
        loading.delete(lang);
        failed.add(lang);
        reportWarning('Readings', `The ${lang} readings could not load: ${describeCause(err)}`, {
          cause: err,
          dedupeKey: `reading.load.${lang}`,
        });
      },
    );
    return;
  }
  const key = keyOf(text, 'ja');
  if (cache.has(key) || asked.has(key)) return;
  const pending = tokenizeJapanese(text);
  const wait = () => {
    waiting.delete(key);
    waiting.set(key, text);
    if (waiting.size > WAITING_LIMIT) waiting.delete(waiting.keys().next().value as string);
  };
  if (!pending) {
    wait();
    return;
  }
  asked.add(key);
  void pending.then(
    (tokens) => {
      asked.delete(key);
      if (!tokens) {
        wait();
        return;
      }
      remember(key, joined(text, 'ja', furigana(text, tokens)));
      tell(byKey.get(key));
    },
    () => {
      asked.delete(key);
      wait();
    },
  );
}

/** Tells `listener` when the pieces for `text` arrive or its annotator loads. */
export function subscribeReading(text: string, lang: ReadingLanguage, listener: () => void): () => void {
  const key = keyOf(text, lang);
  let listeners = byKey.get(key);
  if (!listeners) byKey.set(key, (listeners = new Set()));
  listeners.add(listener);
  everyone.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) byKey.delete(key);
    everyone.delete(listener);
  };
}

/** The pieces with the last reading dropped: a growing row's last word may still change (R11). */
export function holdLastReading(pieces: RubyPiece[]): RubyPiece[] {
  let last = -1;
  pieces.forEach((p, i) => { if (p.reading !== undefined) last = i; });
  if (last < 0) return pieces;
  return pieces.map((p, i) => (i === last ? { text: p.text } : p));
}

subscribeJapanese(() => {
  const phase = getJapaneseState().phase;
  if (phase === 'off') {
    waiting.clear();
    return;
  }
  if (phase !== 'ready') return;
  const texts = [...waiting.values()];
  waiting.clear();
  for (const text of texts) requestReading(text, 'ja');
});
