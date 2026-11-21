/**
 * The rules every speech unit must honour, checked over a recorded log of
 * what the caller asked of one speech session (its calls) and what the
 * session said (its events), in order. Each entry carries the audio counter
 * as it stood then, so the rules about numbering can be checked from the log
 * alone.
 *
 * The suite reads ONE session's log, with a counter that only that session
 * advances. Two voices that share a counter are checked where both are
 * visible: in the tests of the composite that runs them.
 */
import type { LegName } from '../conversation/types';
import type { Ref, TextRange } from './adapter';
import type { Violation } from './conformance';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from './speech';

type PayloadOf<K extends keyof SpeechEvents> = Parameters<SpeechEvents[K]>[0];
type SpeechEvent = { [K in keyof SpeechEvents]: { kind: K; payload: PayloadOf<K> } }[keyof SpeechEvents];

/** A call on the session, recorded before it is made. `closed`: `close()` has returned. */
export type SpeechCall =
  | { kind: 'start' }
  | { kind: 'open' }
  | { kind: 'speak'; ref: Ref; text: string; span: TextRange; language: string; home?: LegName }
  | { kind: 'endUtterance'; ref: Ref }
  | { kind: 'setOn'; on: boolean }
  | { kind: 'recycle' }
  | { kind: 'close' }
  | { kind: 'closed' };

/** One call or one event, as it is recorded. */
export type SpeechRecord = SpeechCall | SpeechEvent;
/** `counts`: the request's counter of audio entries per ref, copied when the entry was recorded. */
export type SpeechLogEntry = SpeechRecord & { counts: ReadonlyMap<Ref, number> };
export type SpeechLog = SpeechLogEntry[];

/**
 * Starts a speech session and records it: every call on the session returned
 * here and every event the unit emits are appended to `log`, in order, and
 * passed on (the events to `forward`, when one is given). The log opens with
 * a `start` entry holding the counter as the session found it.
 */
export function recordSpeech<C, K>(
  start: (request: SpeechStartRequest<C, K>, events: SpeechEvents) => SpeechSession,
  request: SpeechStartRequest<C, K>,
  forward?: SpeechEvents,
  log: SpeechLog = [],
): { session: SpeechSession; log: SpeechLog } {
  const note = (entry: SpeechRecord) => { log.push({ ...entry, counts: new Map(request.counts) }); };
  const events: SpeechEvents = {
    audio: (payload) => { note({ kind: 'audio', payload }); forward?.audio(payload); },
    speechRanges: (payload) => { note({ kind: 'speechRanges', payload }); forward?.speechRanges(payload); },
    degraded: (payload) => { note({ kind: 'degraded', payload }); forward?.degraded(payload); },
    frame: (payload) => { note({ kind: 'frame', payload }); forward?.frame(payload); },
  };
  note({ kind: 'start' });
  const inner = start(request, events);
  const session: SpeechSession = {
    open: () => { note({ kind: 'open' }); return inner.open(); },
    speak: (ref, text, span, language, home) => {
      note({ kind: 'speak', ref, text, span, language, ...(home === undefined ? {} : { home }) });
      inner.speak(ref, text, span, language, home);
    },
    endUtterance: (ref) => { note({ kind: 'endUtterance', ref }); inner.endUtterance(ref); },
    setOn: (on) => { note({ kind: 'setOn', on }); inner.setOn(on); },
    close: () => { note({ kind: 'close' }); inner.close(); note({ kind: 'closed' }); },
  };
  // Present only when the unit has one: a caller asks `recycle?.()`.
  if (inner.recycle) session.recycle = () => { note({ kind: 'recycle' }); inner.recycle!(); };
  return { session, log };
}

const EVENT_KINDS: ReadonlySet<string> = new Set(['audio', 'speechRanges', 'degraded', 'frame']);
const validRange = ([start, end]: TextRange) => start >= 0 && start <= end;

/**
 * The rules:
 * - `audio-has-ref`: every `audio` names the row it reads.
 * - `audio-index-counts`: a voice advances the counter of a ref by one before it emits an `audio` for it, and
 *   at no other time. The place of an entry among its row's audio is the count before it.
 * - `ranges-entry-exists`: a `speechRanges` names entries this session emitted for the ref.
 * - `ranges-ascend`: a ref's ranged entries ascend without overlapping, in entry order.
 * - `range-in-span`: a range, carried or filled in, lies within the spans spoken for its ref; spans that touch are one.
 * - `silent-when-off`: no `audio` while speech is off, and none afterwards for a ref until text is spoken for it
 *   with speech on. Audio that carries a range lies within what was spoken for its ref with speech on since then:
 *   a stretch handed over before or during the time off is not read once the row is spoken again.
 * - `nothing-after-close`: no event once `close()` has returned, and only a `frame` while it runs. A log with no
 *   `closed` entry admits nothing after `close`.
 */
export function checkSpeech(log: SpeechLog): Violation[] {
  const out: Violation[] = [];
  const flag = (rule: string, detail: string, index: number) => out.push({ rule, detail, index });

  /** The counter at the entry before: at `start`, as the session found it. */
  let before: ReadonlyMap<Ref, number> = log[0]?.kind === 'start' ? log[0].counts : new Map();
  /** Per ref, the entries this session emitted, and the range each holds. */
  const emitted = new Map<Ref, Set<number>>();
  const entryRanges = new Map<Ref, Map<number, TextRange>>();
  /** Per ref, every span ever spoken, merged where they touch or overlap, in order: what a range may name. */
  const spans = new Map<Ref, TextRange[]>();
  /** Per ref, the spans spoken with speech on since it was last switched off: what audio may still read. */
  const audible = new Map<Ref, TextRange[]>();
  /** Offending pairs already flagged: every later ranged event re-reads the whole ref. */
  const flaggedOrder = new Set<string>();
  let on = true;
  /** Refs spoken at all, and those spoken with speech on since it was last switched off. */
  const spoken = new Set<Ref>();
  const live = new Set<Ref>();
  let closing = false;
  const returnedAt = log.findIndex((e) => e.kind === 'closed');

  const addSpan = (to: Map<Ref, TextRange[]>, ref: Ref, span: TextRange) => {
    const merged: TextRange[] = [];
    for (const next of [...(to.get(ref) ?? []), span].sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && next[0] <= last[1]) last[1] = Math.max(last[1], next[1]);
      else merged.push([next[0], next[1]]);
    }
    to.set(ref, merged);
  };
  const within = (of: Map<Ref, TextRange[]>, ref: Ref, range: TextRange) => (of.get(ref) ?? []).some(([a, b]) => a <= range[0] && range[1] <= b);
  const checkSpan = (ref: Ref, range: TextRange, index: number): boolean => {
    if (!validRange(range)) {
      flag('range-in-span', `range [${range[0]}, ${range[1]}] is not a valid range`, index);
      return false;
    }
    if (!within(spans, ref, range)) {
      flag('range-in-span', `ref ${ref}: range [${range[0]}, ${range[1]}] is outside the spans spoken for it`, index);
    }
    return true;
  };
  const setRange = (ref: Ref, entry: number, range: TextRange) => {
    const byEntry = entryRanges.get(ref) ?? new Map<number, TextRange>();
    byEntry.set(entry, range);
    entryRanges.set(ref, byEntry);
  };
  const checkOrder = (ref: Ref, index: number) => {
    const ordered = [...(entryRanges.get(ref) ?? new Map<number, TextRange>()).entries()].sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < ordered.length; k++) {
      const [[a, ra], [b, rb]] = [ordered[k - 1], ordered[k]];
      if (rb[0] >= ra[1]) continue;
      const pair = `${ref}:${a}[${ra}]:${b}[${rb}]`;
      if (flaggedOrder.has(pair)) continue;
      flaggedOrder.add(pair);
      flag('ranges-ascend', `ref ${ref}: entry ${b}'s range starts before entry ${a}'s ends`, index);
    }
  };

  log.forEach((entry, index) => {
    if (entry.kind === 'start') return;

    const audioRef = entry.kind === 'audio' && typeof entry.payload.ref === 'number' ? entry.payload.ref : undefined;
    for (const ref of new Set([...before.keys(), ...entry.counts.keys(), ...(audioRef === undefined ? [] : [audioRef])])) {
      const moved = (entry.counts.get(ref) ?? 0) - (before.get(ref) ?? 0);
      const due = ref === audioRef ? 1 : 0;
      if (moved !== due) flag('audio-index-counts', `ref ${ref}: the counter moved by ${moved} at ${entry.kind}, not by ${due}`, index);
    }
    const place = audioRef === undefined ? 0 : (before.get(audioRef) ?? 0);
    before = entry.counts;

    if (EVENT_KINDS.has(entry.kind) && closing && (entry.kind !== 'frame' || !(index < returnedAt))) {
      flag('nothing-after-close', `${entry.kind} after close()`, index);
    }

    switch (entry.kind) {
      case 'speak':
        // A malformed span is not merged: it would make a range outside the spoken text look spoken.
        if (validRange(entry.span)) {
          addSpan(spans, entry.ref, entry.span);
          if (on) addSpan(audible, entry.ref, entry.span);
        } else flag('range-in-span', `ref ${entry.ref}: the spoken span [${entry.span[0]}, ${entry.span[1]}] is not a range`, index);
        spoken.add(entry.ref);
        if (on) live.add(entry.ref);
        break;
      case 'setOn':
        on = entry.on;
        if (!on) {
          live.clear();
          audible.clear();
        }
        break;
      case 'close':
        closing = true;
        break;
      case 'audio': {
        if (audioRef === undefined) {
          flag('audio-has-ref', 'audio names no ref', index);
          break;
        }
        const quiet = 'audio for text spoken before speech was switched off, or while it was off';
        if (!on) flag('silent-when-off', `ref ${audioRef}: audio with speech off`, index);
        else if (spoken.has(audioRef) && !live.has(audioRef)) flag('silent-when-off', `ref ${audioRef}: ${quiet}`, index);
        else if (live.has(audioRef) && entry.payload.range && validRange(entry.payload.range) && within(spans, audioRef, entry.payload.range) && !within(audible, audioRef, entry.payload.range)) {
          // A range outside everything spoken is `range-in-span`'s; this one names text that was spoken, but not to be read.
          const [a, b] = entry.payload.range;
          flag('silent-when-off', `ref ${audioRef}: range [${a}, ${b}]: ${quiet}`, index);
        }
        const mine = emitted.get(audioRef) ?? new Set<number>();
        mine.add(place);
        emitted.set(audioRef, mine);
        const { range } = entry.payload;
        if (range && checkSpan(audioRef, range, index)) {
          setRange(audioRef, place, range);
          checkOrder(audioRef, index);
        }
        break;
      }
      case 'speechRanges': {
        const { ref, ranges } = entry.payload;
        for (const { index: named, range } of ranges) {
          if (!emitted.get(ref)?.has(named)) {
            flag('ranges-entry-exists', `ranges name speech entry ${named} of ref ${ref}, which this session did not emit`, index);
            continue;
          }
          if (checkSpan(ref, range, index)) setRange(ref, named, range);
        }
        checkOrder(ref, index);
        break;
      }
      default:
        break;
    }
  });
  return out;
}
