/**
 * L1 — one per leg. Folds the adapter's event stream into immutable
 * segments: identity, time, the growth trace, audio attached by ref, notices.
 * Knows nothing about the other leg.
 */
import type { SegmentTiming, TextRange } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { AdapterEvent } from '../contract/events';
import { CLIENT_DIAGNOSTICS } from '../diagnostics/clientDiagnostics';
import type { Languages, Leg, LegName, Mark, Notice, Segment, Speech } from './types';

/** Writes closer together than this collapse into one mark. It is the
 *  smallest pause a user can configure (`MIN_SEGMENT_PAUSE_MS`), so no cut
 *  a setting could ask for is lost to compaction. */
export const MARK_COMPACT_MS = 100;

export interface ConversationDiagnostic {
  code: 'contract_violation' | 'range_out_of_text';
  message: string;
}

export interface ConversationOptions {
  leg: LegName;
  session: string;
  languages: Languages;
  clock: Clock;
  onDiagnostic?: (d: ConversationDiagnostic) => void;
}

export class Conversation {
  private segments: Segment[] = [];
  private notices: Notice[] = [];
  private readonly indexByRef = new Map<number, number>();
  /** Audio that arrived before its segment opened. */
  private readonly pending = new Map<number, Speech[]>();
  private counter = 0;
  private noticeCounter = 0;
  private version = 0;
  private snapshotVersion = -1;
  private cached: Leg | null = null;
  private readonly listeners = new Set<() => void>();
  private depth = 0;
  private dirty = false;

  constructor(protected readonly opts: ConversationOptions) {}

  apply(event: AdapterEvent): void {
    this.batch(() => this.dispatch(event));
  }

  private dispatch(event: AdapterEvent): void {
    switch (event.kind) {
      case 'segmentOpened': return this.open(event.payload.ref, event.payload.side, event.payload.origin);
      case 'segmentText': return this.text(event.payload.ref, event.payload.text, event.payload.timing, event.payload.language);
      case 'segmentClosed': return this.close(event.payload.ref, event.payload.origin);
      case 'audio': return this.audio(event.payload.ref, event.payload.range, event.payload.pcm);
      case 'failed': return this.notice('error', event.payload.message, event.payload.code);
      case 'degraded': {
        const severity = CLIENT_DIAGNOSTICS[event.payload.code]?.severity ?? 'warning';
        return this.notice(severity, event.payload.message, event.payload.code);
      }
      case 'closed': return this.finalizeAll();
      default: return;
    }
  }

  /** Every open segment becomes final. Idempotent. */
  finalizeAll(): void {
    this.batch(() => {
      this.segments.forEach((seg, i) => { if (!seg.final) this.markFinal(i); });
    });
  }

  /** Extended in Task 7. */
  clear(): void {
    this.batch(() => {
      this.segments = [];
      this.notices = [];
      this.indexByRef.clear();
      this.pending.clear();
      this.touch();
    });
  }

  snapshot(): Leg {
    if (this.cached && this.snapshotVersion === this.version) return this.cached;
    this.cached = {
      leg: this.opts.leg,
      session: this.opts.session,
      languages: this.opts.languages,
      segments: [...this.segments],
      notices: [...this.notices],
    };
    this.snapshotVersion = this.version;
    return this.cached;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ---- events ----

  private open(ref: number, side: Segment['side'], origin?: string): void {
    if (this.indexByRef.has(ref)) return this.violation(`ref ${ref} opened twice`);
    const n = ++this.counter;
    const speech = this.pending.get(ref) ?? [];
    this.pending.delete(ref);
    const seg: Segment = {
      id: `${this.opts.session}:${this.opts.leg}:${n}`,
      ref, side, text: '', final: false,
      openedAt: this.opts.clock.now(), marks: [], origin, speech,
    };
    this.indexByRef.set(ref, this.segments.length);
    this.segments.push(seg);
    this.touch();
  }

  private text(ref: number, text: string, timing?: SegmentTiming, language?: string): void {
    const i = this.indexByRef.get(ref);
    if (i === undefined) return this.violation(`text for ref ${ref} before it opened`);
    this.replaceText(i, text, { timing, language, mark: true });
  }

  private close(ref: number, origin?: string): void {
    const i = this.indexByRef.get(ref);
    if (i === undefined) return this.violation(`close for ref ${ref} before it opened`);
    const seg = this.segments[i];
    this.replace(i, { ...seg, origin: origin ?? seg.origin });
    if (!seg.final) this.markFinal(i);
  }

  private audio(ref: number | undefined, range: TextRange | undefined, pcm: Int16Array): void {
    if (ref === undefined) return;
    const i = this.indexByRef.get(ref);
    if (i === undefined) {
      const list = this.pending.get(ref) ?? [];
      list.push({ range, pcm: this.retain(pcm) });
      this.pending.set(ref, list);
      return;
    }
    const seg = this.segments[i];
    let kept = range;
    if (range && (range[0] < 0 || range[0] > range[1] || range[1] > seg.text.length)) {
      this.opts.onDiagnostic?.({ code: 'range_out_of_text', message: `range [${range[0]}, ${range[1]}] outside ${seg.id}'s text of length ${seg.text.length}` });
      kept = undefined;
    }
    this.replace(i, { ...seg, speech: [...seg.speech, { range: kept, pcm: this.retain(pcm) }] });
    this.afterAudio();
  }

  private notice(severity: Notice['severity'], message: string, code?: string): void {
    this.notices.push({ id: `${this.opts.session}:${this.opts.leg}:n${++this.noticeCounter}`, at: this.opts.clock.now(), severity, message, code });
    this.touch();
  }

  // ---- hooks the later tasks fill in ----

  /** Task 6 re-anchors speech ranges and runs punctuation fill-in here. */
  protected replaceText(i: number, text: string, o: { timing?: SegmentTiming; language?: string; mark: boolean }): void {
    const seg = this.segments[i];
    const marks = o.mark ? pushMark(seg.marks, this.opts.clock.now(), text.length) : seg.marks;
    this.replace(i, { ...seg, text, timing: o.timing ?? seg.timing, language: o.language ?? seg.language, marks });
  }

  /** Task 6 triggers fill-in from here. */
  protected markFinal(i: number): void {
    this.replace(i, { ...this.segments[i], final: true });
  }

  /** Task 7 applies the retention policy here. */
  protected retain(pcm: Int16Array): Int16Array { return pcm; }
  protected afterAudio(): void {}

  // ---- internals ----

  protected replace(i: number, next: Segment): void {
    this.segments[i] = next;
    this.touch();
  }

  protected touch(): void {
    this.version++;
    if (this.depth > 0) { this.dirty = true; return; }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Runs `fn` and notifies subscribers once at the end, however many changes it made. */
  private batch(fn: () => void): void {
    this.depth++;
    try {
      fn();
    } finally {
      this.depth--;
      if (this.depth === 0 && this.dirty) {
        this.dirty = false;
        this.notify();
      }
    }
  }

  private violation(message: string): void {
    this.opts.onDiagnostic?.({ code: 'contract_violation', message });
  }
}

function pushMark(marks: readonly Mark[], at: number, len: number): Mark[] {
  const last = marks[marks.length - 1];
  if (last && at - last.at < MARK_COMPACT_MS) return [...marks.slice(0, -1), { at, len }];
  return [...marks, { at, len }];
}
