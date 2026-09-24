/**
 * L1 — one per leg. Folds the adapter's event stream into immutable
 * segments: identity, time, the growth trace, audio attached by ref, notices.
 * Knows nothing about the other leg.
 */
import type { SegmentTiming, TextRange } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { AdapterEvent } from '../contract/events';
import { CLIENT_DIAGNOSTICS } from '../diagnostics/clientDiagnostics';
import { describeCause } from '../diagnostics/describeCause';
import { countSkeleton, offsetAfterSkeleton } from '../segmentation/sealCursor';
import { baseLang } from '../segmentation/sentenceEnd';
import { fillIn, type Punctuator } from './fillIn';
import { reanchorRanges } from './reanchor';
import { EMPTY_PCM } from './types';
import type { Languages, Leg, LegName, Mark, Notice, NoticeInput, Segment, Speech } from './types';

/** Writes closer together than this collapse into one mark. It is the
 *  smallest pause a user can configure (`MIN_SEGMENT_PAUSE_MS`), so no cut
 *  a setting could ask for is lost to compaction. */
export const MARK_COMPACT_MS = 100;

/** A `degraded` notice repeating its code within this window is dropped, as the Logs panel throttles per key. */
export const DEGRADED_DEDUPE_MS = 5_000;

export interface ConversationDiagnostic {
  code: 'contract_violation' | 'range_out_of_text' | 'listener_threw';
  message: string;
}

export interface Retention {
  /** Off: pcm is dropped on arrival; the row keeps its range and loses replay. */
  keepPcm: boolean;
  /** Above this many bytes of pcm across the leg, the oldest pcm is dropped. */
  maxPcmBytes: number;
}

export const DEFAULT_RETENTION: Retention = { keepPcm: true, maxPcmBytes: 64 * 1024 * 1024 };

export interface ConversationOptions {
  leg: LegName;
  session: string;
  languages: Languages;
  clock: Clock;
  onDiagnostic?: (d: ConversationDiagnostic) => void;
  /** Punctuation fill-in for segments that close without a sentence end. */
  punctuate?: Punctuator;
  retention?: Retention;
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
  private pcmBytes = 0;
  private readonly inflight = new Set<Promise<void>>();
  private retention: Retention;
  private readonly lastDegradedAt = new Map<string, number>();

  constructor(private readonly opts: ConversationOptions) { this.retention = opts.retention ?? DEFAULT_RETENTION; }

  apply(event: AdapterEvent): void {
    this.batch(() => this.dispatch(event));
  }

  private dispatch(event: AdapterEvent): void {
    switch (event.kind) {
      case 'segmentOpened': return this.open(event.payload.ref, event.payload.side, event.payload.origin);
      case 'segmentText': return this.text(event.payload.ref, event.payload.text, event.payload.timing, event.payload.language);
      case 'segmentClosed': return this.close(event.payload.ref, event.payload.origin);
      case 'audio': return this.audio(event.payload.ref, event.payload.range, event.payload.pcm);
      case 'failed': {
        this.addNotice({ severity: 'error', message: event.payload.message, code: event.payload.code ?? 'leg_failed' });
        this.finalizeAll();
        return;
      }
      case 'degraded': {
        const { code, message } = event.payload;
        if (!this.admitDegraded(code)) return;
        return this.addNotice({ severity: CLIENT_DIAGNOSTICS[code]?.severity ?? 'warning', message, code });
      }
      case 'closed': return this.finalizeAll();
      default: return;
    }
  }

  /** False when a degradation with this code was recorded within `DEGRADED_DEDUPE_MS`; otherwise notes it. */
  private admitDegraded(code: string): boolean {
    const now = this.opts.clock.now();
    const last = this.lastDegradedAt.get(code);
    if (last !== undefined && now - last < DEGRADED_DEDUPE_MS) return false;
    this.lastDegradedAt.set(code, now);
    return true;
  }

  /** Every open segment becomes final. Idempotent. */
  finalizeAll(): void {
    this.batch(() => {
      this.segments.forEach((seg, i) => { if (!seg.final) this.markFinal(i); });
      for (const list of this.pending.values()) for (const s of list) this.pcmBytes -= s.pcm.byteLength;
      this.pending.clear();
    });
  }

  /** Records a notice from outside the adapter's stream: the runner's (a source ended, a lease ended). */
  notice(input: NoticeInput): void {
    this.batch(() => this.addNotice(input));
  }

  /** A degradation from outside the adapter's stream (a source's): a warning, throttled per code like `degraded`. */
  degraded(code: string, message: string): void {
    if (!this.admitDegraded(code)) return;
    this.batch(() => this.addNotice({ severity: 'warning', message, code }));
  }

  /**
   * Applies a retention policy now (`keepReplayAudio` takes effect
   * immediately): off drops every pcm held, ranges kept; a lower ceiling trims
   * the oldest.
   */
  setRetention(retention: Retention): void {
    this.batch(() => {
      this.retention = retention;
      if (retention.keepPcm) {
        this.afterAudio();
        return;
      }
      this.segments.forEach((seg, i) => {
        if (!seg.speech.some((s) => s.pcm.length > 0)) return;
        this.replace(i, { ...seg, speech: seg.speech.map((s) => (s.pcm.length > 0 ? { ...s, pcm: EMPTY_PCM } : s)) });
      });
      for (const [ref, list] of this.pending) this.pending.set(ref, list.map((s) => ({ ...s, pcm: EMPTY_PCM })));
      this.pcmBytes = 0;
    });
  }

  /** Drops every closed segment, every notice and all pcm; segments still open stay open with empty text. */
  clear(): void {
    this.batch(() => {
      const kept = this.segments.filter((s) => !s.final).map((s) => ({ ...s, text: '', marks: [], speech: [], timing: undefined }));
      this.segments = kept;
      this.notices = [];
      this.indexByRef.clear();
      kept.forEach((s, i) => this.indexByRef.set(s.ref, i));
      this.pending.clear();
      this.pcmBytes = 0;
      this.lastDegradedAt.clear();
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

  /** Resolves once every punctuation fill-in started so far has landed. */
  async settled(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
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
    if (speech.length > 0) this.afterAudio();
    this.touch();
  }

  private text(ref: number, text: string, timing?: SegmentTiming, language?: string): void {
    const i = this.indexByRef.get(ref);
    if (i === undefined) return this.violation(`text for ref ${ref} before it opened`);
    const seg = this.segments[i];
    if (seg.text === text && sameTiming(seg.timing, timing ?? seg.timing) && (language ?? seg.language) === seg.language) return;
    // A timing- or language-only snapshot is not growth: a mark there would
    // read as the end of a pause to L2's cut.
    this.replaceText(i, text, { timing, language, mark: seg.text !== text });
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
      this.afterAudio();
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

  private addNotice(input: NoticeInput): void {
    this.notices.push({ id: `${this.opts.session}:${this.opts.leg}:n${++this.noticeCounter}`, at: this.opts.clock.now(), ...input });
    this.touch();
  }

  // ---- hooks ----

  /** Replaces a segment's text, re-anchoring its speech ranges and extending the growth trace. */
  private replaceText(i: number, text: string, o: { timing?: SegmentTiming; language?: string; mark: boolean }): void {
    const seg = this.segments[i];
    const ranges = reanchorRanges(seg.text, text, seg.speech.map((s) => s.range));
    const speech = seg.speech.map((s, k) => (ranges[k] === s.range ? s : { ...s, range: ranges[k] }));
    const grew = text.startsWith(seg.text);
    const remapped = grew
      ? seg.marks
      : seg.marks.map((m) => ({ at: m.at, len: Math.min(text.length, offsetAfterSkeleton(text, countSkeleton(seg.text.slice(0, m.len)))) }));
    const marks = o.mark ? pushMark(remapped, this.opts.clock.now(), text.length) : remapped;
    this.replace(i, { ...seg, text, timing: o.timing ?? seg.timing, language: o.language ?? seg.language, marks, speech });
  }

  /** Marks a segment final and starts punctuation fill-in for it. */
  private markFinal(i: number): void {
    const seg = { ...this.segments[i], final: true };
    this.replace(i, seg);
    const punctuate = this.opts.punctuate;
    if (!punctuate) return;
    const lang = this.fillInLanguage(seg);
    if (!lang) return;
    const before = seg.text;
    const job: Promise<void> = fillIn(lang, before, punctuate).then((filled) => {
      const j = this.indexByRef.get(seg.ref);
      if (j === undefined || filled === before || this.segments[j].text !== before) return;
      this.replaceText(j, filled, { mark: false });
    });
    this.inflight.add(job);
    const done = () => { this.inflight.delete(job); };
    job.then(done, done);
  }

  /** The detected language wins; otherwise the leg's configured one; `auto` means no fill-in. */
  private fillInLanguage(seg: Segment): string | null {
    const configured = seg.side === 'source' ? this.opts.languages.source : this.opts.languages.target;
    const lang = seg.language ?? configured;
    if (!lang || lang === 'auto') return null;
    return baseLang(lang);
  }

  /** Counts or drops arriving pcm per the retention policy. */
  private retain(pcm: Int16Array): Int16Array {
    if (!this.retention.keepPcm) return EMPTY_PCM;
    this.pcmBytes += pcm.byteLength;
    return pcm;
  }

  /** Drops the oldest pcm until the leg is under its ceiling. */
  private afterAudio(): void {
    const max = this.retention.maxPcmBytes;
    for (let i = 0; i < this.segments.length && this.pcmBytes > max; i++) {
      const seg = this.segments[i];
      const k = seg.speech.findIndex((s) => s.pcm.length > 0);
      if (k < 0) continue;
      const speech = seg.speech.map((s, j) => (j === k ? { ...s, pcm: EMPTY_PCM } : s));
      this.pcmBytes -= seg.speech[k].pcm.byteLength;
      this.replace(i, { ...seg, speech });
      i--; // the same segment may hold more pcm
    }
    // Still over: audio held for refs that have not opened yet, oldest first.
    for (const [ref, list] of this.pending) {
      if (this.pcmBytes <= max) break;
      for (const s of list) this.pcmBytes -= s.pcm.byteLength;
      this.pending.delete(ref);
    }
  }

  // ---- internals ----

  private replace(i: number, next: Segment): void {
    this.segments[i] = next;
    this.touch();
  }

  private touch(): void {
    this.version++;
    if (this.depth > 0) { this.dirty = true; return; }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        // One subscriber's bug must not reach the adapter's event callback, or the next subscriber.
        this.opts.onDiagnostic?.({ code: 'listener_threw', message: `A conversation subscriber threw: ${describeCause(error)}` });
      }
    }
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

function sameTiming(a?: SegmentTiming, b?: SegmentTiming): boolean {
  return a === b || (!!a && !!b && a.startMs === b.startMs && a.endMs === b.endMs);
}
