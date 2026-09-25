/**
 * The rules of "What every adapter must honour", checked over a recorded
 * event log. Markers record what the caller did (stop, turns, text input) so
 * the rules that depend on it can be checked from the log alone.
 */
import type { SessionContext } from './adapter';
import { redact } from '../diagnostics/redact';
import { eventsFrom, type AdapterEvent } from './events';

export type MarkerName = 'stop' | 'endTurn' | 'cancelTurn' | 'appendText';
/** `text` is the typed text, for `appendText` markers. */
export interface Marker { kind: 'marker'; payload: MarkerName; text?: string }
export type ConformanceLog = Array<AdapterEvent | Marker>;

export interface Violation { rule: string; detail: string; index: number }

/** Key names that hold a credential. Whole names only: a substring match
 *  would flag `input_tokens`, which every OpenAI usage frame carries. */
const CREDENTIAL_KEY = /^(api[_-]?key|app[_-]?key|access[_-]?key|access[_-]?token|client[_-]?secret|secret|token|password|authorization|bearer|x[_-]api[_-](app|access)[_-]key)$/i;
const MAX_FRAME_STRING = 2048;
/** A frame `type` shaped `domain.event` (spec D8). */
const FRAME_TYPE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

export function recordConformance(): {
  events: ReturnType<typeof eventsFrom>;
  log: ConformanceLog;
  mark(name: MarkerName, text?: string): void;
} {
  const log: ConformanceLog = [];
  return {
    events: eventsFrom((e) => log.push(e)),
    log,
    mark: (name, text) => log.push(text === undefined ? { kind: 'marker', payload: name } : { kind: 'marker', payload: name, text }),
  };
}

/** A typed text waiting for its answer: a source segment with exactly this
 *  text, then a translation segment opening after it. */
interface PendingText { index: number; text: string; sourceRef?: number; answered: boolean }

export function checkConformance(log: ConformanceLog, context: SessionContext): Violation[] {
  const out: Violation[] = [];
  const opened = new Set<number>();
  const sideOf = new Map<number, 'source' | 'translation'>();
  const textOf = new Map<number, string>();
  const pending: PendingText[] = [];
  let ended = false;
  let stopped = false;

  const flag = (rule: string, detail: string, index: number) => out.push({ rule, detail, index });

  // A range beyond the text that has arrived so far is not flagged at
  // arrival — the text may still be a snapshot — but checked against the
  // text when its segment closes, and on every later revision (a
  // `segmentText` for an already-closed ref), mirroring L1's `clampRanges`.
  const rangesByRef = new Map<number, Array<{ index: number; range: [number, number] }>>();
  const closedRefs = new Set<number>();
  const flaggedRange = new Set<number>();
  const checkRangesForRef = (ref: number) => {
    const entries = rangesByRef.get(ref);
    if (!entries) return;
    const len = (textOf.get(ref) ?? '').length;
    for (const e of entries) {
      if (flaggedRange.has(e.index)) continue;
      if (e.range[1] > len) {
        flag('range-in-text', `range [${e.range[0]}, ${e.range[1]}] outside text of length ${len}`, e.index);
        flaggedRange.add(e.index);
      }
    }
  };

  log.forEach((entry, index) => {
    if (entry.kind === 'marker') {
      if (entry.payload === 'stop') stopped = true;
      if (entry.payload === 'appendText') pending.push({ index, text: entry.text ?? '', answered: false });
      return;
    }
    if (ended) flag('ended-silence', `${entry.kind} after failed/closed`, index);
    if (stopped) flag('stop-silence', `${entry.kind} after stop()`, index);

    switch (entry.kind) {
      case 'segmentOpened': {
        const { ref, side } = entry.payload;
        if (opened.has(ref)) flag('ref-opened-once', `ref ${ref} opened twice`, index);
        opened.add(ref);
        sideOf.set(ref, side);
        if (!textOf.has(ref)) textOf.set(ref, '');
        if (side === 'translation') {
          const p = pending.find((q) => q.sourceRef !== undefined && !q.answered);
          if (p) p.answered = true;
        }
        break;
      }
      case 'segmentText': {
        const { ref, text } = entry.payload;
        if (!opened.has(ref)) flag('text-before-open', `text for ref ${ref} before segmentOpened`, index);
        textOf.set(ref, text);
        if (sideOf.get(ref) === 'source') {
          const p = pending.find((q) => q.sourceRef === undefined && q.text === text);
          if (p) p.sourceRef = ref;
        }
        if (closedRefs.has(ref)) checkRangesForRef(ref); // a revision: re-check its ranges against the new text
        break;
      }
      case 'segmentClosed': {
        const { ref } = entry.payload;
        if (!opened.has(ref)) flag('close-unopened', `close for ref ${ref} that never opened`, index);
        closedRefs.add(ref);
        checkRangesForRef(ref);
        break;
      }
      case 'audio': {
        const { ref, range, pcm } = entry.payload;
        if (!context.speech) flag('no-audio-when-silent', 'audio with speech: false', index);
        if (!(pcm instanceof Int16Array)) flag('audio-int16', 'pcm is not an Int16Array', index);
        if (ref !== undefined && sideOf.get(ref) === 'source') flag('audio-on-source', `audio on source-side ref ${ref}`, index);
        if (range) {
          const [start, end] = range;
          if (start < 0 || start > end) {
            flag('range-in-text', `range [${start}, ${end}] is not a valid range`, index);
          } else if (ref !== undefined) {
            const list = rangesByRef.get(ref) ?? [];
            list.push({ index, range: [start, end] });
            rangesByRef.set(ref, list);
            if (closedRefs.has(ref)) checkRangesForRef(ref);
          }
        }
        break;
      }
      case 'failed':
      case 'closed':
        ended = true;
        // Mirrors L1's finalizeAll: every ref still open when the session
        // ends is checked too, not only one that got its own segmentClosed.
        for (const ref of opened) { if (!closedRefs.has(ref)) checkRangesForRef(ref); }
        break;
      case 'frame': {
        const { type, payload } = entry.payload;
        if (!FRAME_TYPE.test(type)) flag('frame-type', `frame type "${type}" is not shaped like domain.event`, index);
        const problem = dirtyFrame(payload);
        if (problem) flag('frame-clean', problem, index);
        const secret = frameSecret(payload);
        if (secret) flag('frame-secret', secret, index);
        break;
      }
      default:
        break;
    }
  });

  // A log that ends without failed/closed (after `stop`, say): the refs
  // still open are checked as the session end above checks them.
  if (!ended) {
    for (const ref of opened) { if (!closedRefs.has(ref)) checkRangesForRef(ref); }
  }

  for (const p of pending) {
    if (!p.answered) flag('text-input-answered', `typed text "${p.text}" was not answered with a source segment and then a translation`, p.index);
  }
  return out;
}

/** Why a frame payload is not fit for the Logs panel, or null. */
function dirtyFrame(value: unknown, path = 'payload'): string | null {
  if (value instanceof Int16Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return `${path} carries audio`;
  if (typeof value === 'string') return value.length >= MAX_FRAME_STRING ? `${path} is a ${value.length}-char string` : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = dirtyFrame(value[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_KEY.test(k)) return `${path}.${k} looks like a credential`;
      const p = dirtyFrame(v, `${path}.${k}`);
      if (p) return p;
    }
  }
  return null;
}

/** Where a frame payload holds a string value `redact()` would change, or null: a credential by shape, not by key name. */
function frameSecret(value: unknown, path = 'payload'): string | null {
  if (value instanceof Int16Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return null;
  if (typeof value === 'string') return redact(value) !== value ? `${path} carries a credential-shaped value` : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = frameSecret(value[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = frameSecret(v, `${path}.${k}`);
      if (p) return p;
    }
  }
  return null;
}
