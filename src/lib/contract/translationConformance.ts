/**
 * The rules every translation unit must honour, checked over a recorded log
 * of what the caller asked of one translation session (its calls) and what
 * the session said (its events), in order.
 *
 * The suite reads ONE session's log: one leg, one direction. What a leg does
 * with the translations (its rows, its refs, its voice) is checked where it
 * is visible: in the tests of the composite that runs the session.
 */
import type { Ref } from './adapter';
import type { Violation } from './conformance';
import { hasSpeech } from './translation';
import type { SourceSnapshot, TranslationEvents, TranslationSession, TranslationStartRequest } from './translation';

type PayloadOf<K extends keyof TranslationEvents> = Parameters<TranslationEvents[K]>[0];
type TranslationEvent = { [K in keyof TranslationEvents]: { kind: K; payload: PayloadOf<K> } }[keyof TranslationEvents];

/** A call on the session, recorded before it is made. `stopped`: the promise of `stop()` has settled. */
export type TranslationCall =
  | { kind: 'start' }
  | { kind: 'open' }
  | { kind: 'source'; snapshot: SourceSnapshot }
  | { kind: 'stop' }
  | { kind: 'stopped' };

/** One call or one event, as it is recorded. */
export type TranslationRecord = TranslationCall | TranslationEvent;
export type TranslationLog = TranslationRecord[];

/**
 * Starts a translation session and records it: every call on the session returned here and every event the unit
 * emits are appended to `log`, in order, and passed on (the events to `forward`, when one is given). What is
 * recorded is a copy: a unit that says the same object again, changed, is read as it said it each time.
 */
export function recordTranslation<C, K>(
  start: (request: TranslationStartRequest<C, K>, events: TranslationEvents) => TranslationSession,
  request: TranslationStartRequest<C, K>,
  forward?: Partial<TranslationEvents>,
  log: TranslationLog = [],
): { session: TranslationSession; log: TranslationLog } {
  const events: TranslationEvents = {
    translationOpened: (payload) => { log.push({ kind: 'translationOpened', payload: { ...payload } }); forward?.translationOpened?.(payload); },
    translationText: (payload) => { log.push({ kind: 'translationText', payload: { ...payload } }); forward?.translationText?.(payload); },
    translationClosed: (payload) => { log.push({ kind: 'translationClosed', payload: { ...payload } }); forward?.translationClosed?.(payload); },
    failed: (payload) => { log.push({ kind: 'failed', payload: { ...payload } }); forward?.failed?.(payload); },
    degraded: (payload) => { log.push({ kind: 'degraded', payload: { ...payload } }); forward?.degraded?.(payload); },
    loading: (payload) => { log.push({ kind: 'loading', payload: { ...payload } }); forward?.loading?.(payload); },
    frame: (payload) => { log.push({ kind: 'frame', payload: { ...payload } }); forward?.frame?.(payload); },
  };
  log.push({ kind: 'start' });
  const inner = start(request, events);
  const session: TranslationSession = {
    open: () => { log.push({ kind: 'open' }); return inner.open(); },
    source: (snapshot) => { log.push({ kind: 'source', snapshot: { ...snapshot } }); inner.source(snapshot); },
    stop: () => {
      log.push({ kind: 'stop' });
      const settled = () => { log.push({ kind: 'stopped' }); };
      const stopping = inner.stop();
      stopping.then(settled, settled);
      return stopping;
    },
  };
  return { session, log };
}

const EVENT_KINDS: ReadonlySet<string> = new Set(['translationOpened', 'translationText', 'translationClosed', 'failed', 'degraded', 'loading', 'frame']);

/**
 * The rules:
 * - `ref-opened-once`: a ref names one translation segment; it is never opened again.
 * - `origin-given`: a translation names an origin the session was handed before, by `source()`.
 * - `text-before-open`: no text for a ref that has not opened.
 * - `text-after-close`: no text for a ref that has closed.
 * - `close-unopened`: no close for a ref that has not opened.
 * - `closed-once`: a ref closes once.
 * - `stable-len-in-text`: `stableLen` is a whole number from 0 to the length of the text.
 * - `stable-len-holds`: a ref's stable length never goes back, and the text it covers never changes.
 * - `nothing-after-failed`: no event after `failed`.
 * - `nothing-after-stop`: no event once `stop()` has settled, and only a `frame` while it runs. A log with no
 *   `stopped` entry admits nothing after `stop`.
 * - `translation-closed`: in a session that neither failed nor was stopped, every translation that opened has
 *   closed by the end of the log.
 * - `source-answered`: in a session that neither failed nor was stopped, every source that closed holding a letter
 *   or a digit (`hasSpeech`) is answered by the end of the log: at least one translation names its origin, or the
 *   session said `degraded` after it was first handed the origin (its stretch could not be translated, and the row
 *   keeps its source). A source that closed without one holds nothing to translate, and is owed nothing.
 */
export function checkTranslation(log: TranslationLog): Violation[] {
  const out: Violation[] = [];
  const flag = (rule: string, detail: string, index: number) => out.push({ rule, detail, index });

  /** Per origin: where the session was first handed it, and where it closed with something to translate, if it has. */
  const given = new Map<string, { first: number; closedAt?: number }>();
  const opened = new Set<Ref>();
  const closed = new Set<Ref>();
  /** The origins some translation names. */
  const answered = new Set<string>();
  /** Per ref, the start of its text that a `stableLen` said will not change. */
  const stableOf = new Map<Ref, string>();
  const degradedAt: number[] = [];
  let failed = false;
  let stopping = false;
  const stoppedAt = log.findIndex((e) => e.kind === 'stopped');

  log.forEach((entry, index) => {
    if (EVENT_KINDS.has(entry.kind)) {
      if (failed) flag('nothing-after-failed', `${entry.kind} after failed`, index);
      if (stopping && (entry.kind !== 'frame' || !(index < stoppedAt))) flag('nothing-after-stop', `${entry.kind} after stop()`, index);
    }
    switch (entry.kind) {
      case 'source': {
        const { origin, text, closed: over } = entry.snapshot;
        const known = given.get(origin) ?? { first: index };
        if (over && hasSpeech(text) && known.closedAt === undefined) known.closedAt = index;
        given.set(origin, known);
        break;
      }
      case 'stop':
        stopping = true;
        break;
      case 'translationOpened': {
        const { ref, origin } = entry.payload;
        if (opened.has(ref)) flag('ref-opened-once', `ref ${ref} opened twice`, index);
        opened.add(ref);
        if (!given.has(origin)) flag('origin-given', `ref ${ref} names origin "${origin}", which the session was not handed`, index);
        answered.add(origin);
        break;
      }
      case 'translationText': {
        const { ref, text, stableLen } = entry.payload;
        if (!opened.has(ref)) flag('text-before-open', `text for ref ${ref} before it opened`, index);
        if (closed.has(ref)) flag('text-after-close', `text for ref ${ref} after it closed`, index);
        const held = stableOf.get(ref) ?? '';
        if (!Number.isInteger(stableLen) || stableLen < 0 || stableLen > text.length) {
          flag('stable-len-in-text', `stableLen ${stableLen} is not a length within text of length ${text.length}`, index);
        } else if (stableLen < held.length) {
          flag('stable-len-holds', `ref ${ref}: stableLen went back from ${held.length} to ${stableLen}`, index);
        } else if (!text.startsWith(held)) {
          flag('stable-len-holds', `ref ${ref}: the first ${held.length} characters, said to be stable, changed`, index);
        } else {
          stableOf.set(ref, text.slice(0, stableLen));
        }
        break;
      }
      case 'translationClosed': {
        const { ref } = entry.payload;
        if (!opened.has(ref)) flag('close-unopened', `close for ref ${ref}, which never opened`, index);
        else if (closed.has(ref)) flag('closed-once', `ref ${ref} closed twice`, index);
        closed.add(ref);
        break;
      }
      case 'degraded':
        degradedAt.push(index);
        break;
      case 'failed':
        failed = true;
        break;
      default:
        break;
    }
  });

  // What a session owes by its end is owed only by one that ran to it: a stop abandons what is pending, and a
  // failed unit translates nothing more.
  if (failed || stopping) return out;
  for (const ref of opened) {
    if (!closed.has(ref)) flag('translation-closed', `ref ${ref} opened and never closed`, log.length);
  }
  for (const [origin, { first, closedAt }] of given) {
    if (closedAt === undefined || answered.has(origin) || degradedAt.some((at) => at > first)) continue;
    flag('source-answered', `the source "${origin}" closed with text to translate and was neither translated nor said to have failed`, closedAt);
  }
  return out;
}
