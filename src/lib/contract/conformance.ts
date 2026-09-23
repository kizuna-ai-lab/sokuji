/**
 * The rules of "What every adapter must honour", checked over a recorded
 * event log. Markers record what the caller did (stop, turns, text input) so
 * the rules that depend on it can be checked from the log alone.
 */
import type { SessionContext } from './adapter';
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
        break;
      }
      case 'audio': {
        const { ref, range, pcm } = entry.payload;
        if (!context.speech) flag('no-audio-when-silent', 'audio with speech: false', index);
        if (!(pcm instanceof Int16Array)) flag('audio-int16', 'pcm is not an Int16Array', index);
        if (range) {
          const [start, end] = range;
          const len = opened.has(ref ?? -1) ? (textOf.get(ref ?? -1) ?? '').length : Infinity;
          if (start < 0 || start > end || end > len) flag('range-in-text', `range [${start}, ${end}] outside text of length ${len}`, index);
        }
        break;
      }
      case 'failed':
      case 'closed':
        ended = true;
        break;
      case 'frame': {
        const problem = dirtyFrame(entry.payload.payload);
        if (problem) flag('frame-clean', problem, index);
        break;
      }
      default:
        break;
    }
  });

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
