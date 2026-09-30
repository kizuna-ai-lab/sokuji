/**
 * OpenAI Live's deltas and audio → segments, on the request's clock
 * (rulings 2–4). `ContinuousSegments` holds both sides (ruling 3): the
 * translation is cut where the source was, and states that source as its
 * origin. What is Live's own sits around it:
 *
 * - **The source's cuts** are read off the input's `start_ms` / `end_ms` —
 *   the session's timeline (choice 6): a gap on it of at least the source
 *   pause ends the open source, whatever it holds (ruling 10), and a delta's
 *   leading marks belong to the text before them (dropped with none open); a
 *   source is cut inside a delta after every `sentencesPerSegment`-th
 *   sentence end (ruling 4; choice 7); past 8 s at its last clause mark and
 *   at 12 s anywhere, in every mode — the old client's caps. The module's own
 *   pause still closes a source by arrival, deferred mid-sentence in sentence
 *   mode.
 * - **The translation**: a delta's leading marks dropped with none open, and
 *   a space restored where the output's timeline paused between two words
 *   that the stream joined without one (choice 8).
 * - **The audio** (ruling 2; choices 9, 10): every output frame advances the
 *   output's sample clock — the noise floor's too — on which `start_ms` /
 *   `end_ms` stand: 0 at the session's first output frame, samples ÷ 24 ms. A
 *   voiced frame speaks the text whose stamps its window covers: the
 *   segment of the delta whose stamps lie nearest the frame's middle, and,
 *   within that segment, the characters from where its start falls to where
 *   its end falls — interpolated inside a delta, held at a delta's end
 *   through a gap. Real ranges, computed as the frame arrives (the text
 *   leads its audio, U4), never filled in later.
 *
 * Pure: every timer is the module's, on the clock it is handed.
 */
import type { Ref, TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { ContinuousSegments, type CutSummary, type SegmentSink } from '../../lib/segmentation/continuousSegments';
import { lastClauseEnd, LEADING_PUNCT_RE, sentenceEnds } from '../../lib/segmentation/sentenceEnd';
import type { LiveConfig } from './config';

/** Past this span a source is cut at its last clause mark (`OpenAILiveClient.ts:69`)… */
export const SOURCE_CLAUSE_MS = 8_000;
/** …and at this one anywhere (`:70`), in every mode (ruling 4). */
export const SOURCE_CAP_MS = 12_000;
/**
 * At or below this RMS an output frame is the stream's dithered floor, not
 * speech (`OpenAILiveClient.ts:50-60`: the floor measured 1.3e-5 – 5.8e-4,
 * speech 0.03 – 0.08): it counts on the clock and nothing else. Not OpenAI
 * Translate's exact-zero heartbeat: Live's floor is never zero.
 */
export const FLOOR_RMS = 0.002;

/** RMS over [0, 1]: the floor test, and the Logs' audio frames. */
export function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length) / 32768;
}

/** The output's sample clock: 24 samples a millisecond. */
const SAMPLES_PER_MS = 24;
/** A delta's stamps kept this long behind the audio: no frame arrives that late. */
const SPAN_KEEP_MS = 60_000;

/** A delta's leading marks — `LEADING_PUNCT_RE` without its whitespace: they end the text before them. */
const LEADING_MARKS_RE = /^[。．！？!?.,，、;；:：—–"'”’」』）)\]]+/;
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** What may end a word before a space: a letter, a digit, a Latin mark or a closer. */
const WORD_END = /[\p{L}\p{N}.,!?;:'"”’)\]]/u;
const WORD_START = /[\p{L}\p{N}]/u;
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Two words the stream joined with no space, across a pause on its timeline
 * ("Japanese." then "The decor", "are" then "really" — the probe's sessions),
 * need one: both sides written with spaces between words (choice 8).
 */
function needsSpace(before: string, after: string): boolean {
  return WORD_END.test(before) && WORD_START.test(after) && !SPACELESS.test(before) && !SPACELESS.test(after);
}

/** One translation delta on the output's timeline: its characters in its segment, `[c0, c1)`, and its stamps, `[s, e)` ms. */
interface Span { ref: Ref; s: number; e: number; c0: number; c1: number }

export interface LiveSegmentsOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  silence: LiveConfig['silence'];
  sentencesPerSegment: number;
  sink: SegmentSink;
  /** Each translation cut, for the Logs (Stage 2 translation cuts, choice 14). */
  cut?: (summary: CutSummary) => void;
}

export class LiveSegments {
  private readonly core: ContinuousSegments;
  /** The open segments, as the module opened them. */
  private sourceRef: Ref | null = null;
  private translationRef: Ref | null = null;
  /** The open source's text, and the timeline's start of its first delta. */
  private sourceText = '';
  private sourceStartMs: number | null = null;
  /** The last input delta's `end_ms`, across sources: a pause is measured from it. */
  private lastEndMs: number | null = null;
  /** Each translation segment's text as sent, while its stamps are kept. */
  private readonly texts = new Map<Ref, string>();
  /** The translation's deltas on the output's timeline, in arrival order. */
  private spans: Span[] = [];
  /** Where each segment's last range ended: ranges ascend and never overlap. */
  private readonly spoken = new Map<Ref, number>();
  /** Output samples so far this connection: the frame's place on the timeline. */
  private samples = 0;
  /** The last translation character sent and its delta's `end_ms`: a join's space is read off them. */
  private lastOut: { char: string; endMs: number | null } | null = null;
  private lastTextRef: Ref | null = null;
  private stopped = false;

  constructor(private readonly o: LiveSegmentsOptions) {
    const sink: SegmentSink = {
      segmentOpened: (e) => {
        if (e.side === 'source') this.sourceRef = e.ref;
        else this.translationRef = e.ref;
        o.sink.segmentOpened(e);
      },
      segmentText: (e) => {
        if (e.ref === this.sourceRef) this.sourceText = e.text;
        else {
          this.texts.set(e.ref, e.text);
          this.lastTextRef = e.ref;
        }
        o.sink.segmentText(e);
      },
      segmentClosed: (e) => {
        if (e.ref === this.sourceRef) {
          this.sourceRef = null;
          this.sourceText = '';
          this.sourceStartMs = null;
        }
        if (e.ref === this.translationRef) this.translationRef = null;
        o.sink.segmentClosed(e);
      },
      // The module plays nothing: every frame is placed here, by the timeline.
      audio: () => {},
    };
    this.core = new ContinuousSegments({ clock: o.clock, silence: o.silence, sink, cut: o.cut });
  }

  /** A source transcript delta and its stamps on the session's timeline. */
  input(delta: string, startMs: number | null, endMs: number | null): void {
    if (this.stopped) return;
    const lead = LEADING_PUNCT_RE.exec(delta)?.[0] ?? '';
    let text = delta;
    if (this.sourceRef === null) {
      // Punctuation whose sentence is already closed has no home.
      text = delta.slice(lead.length);
    } else if (this.pauseEnds(startMs)) {
      // The speaker paused: the mark at the head of this delta belongs to the text before the pause.
      const mark = lead.trimEnd();
      if (mark) this.appendSource(mark, startMs);
      this.core.cutSource();
      text = delta.slice(lead.length);
    }
    this.takeSource(text, startMs, endMs);
    if (endMs !== null) this.lastEndMs = endMs;
  }

  /**
   * A translation transcript delta and its stamps on the output's sample
   * clock. With a translation open, its leading marks end that
   * translation's text before any cut due is taken, and a space is restored
   * where the timeline paused; with none open, they are dropped (choice 8).
   */
  output(delta: string, startMs: number | null, endMs: number | null): void {
    if (this.stopped) return;
    let text = delta;
    let marks = '';
    if (this.translationRef === null) text = delta.slice((LEADING_PUNCT_RE.exec(delta)?.[0] ?? '').length);
    else {
      marks = LEADING_MARKS_RE.exec(delta)?.[0] ?? '';
      text = delta.slice(marks.length);
      if (!marks && this.lastOut && startMs !== null && this.lastOut.endMs !== null && startMs > this.lastOut.endMs && needsSpace(this.lastOut.char, text[0] ?? '')) text = ` ${text}`;
    }
    const sent = marks + text;
    if (!sent) return;
    let marksRef: Ref | null = null;
    if (marks) {
      this.core.translationContinues(marks);
      marksRef = this.lastTextRef;
    }
    if (text) this.core.translationText(text);
    const ref = this.lastTextRef;
    const whole = ref === null ? undefined : this.texts.get(ref);
    if (ref !== null && whole !== undefined && startMs !== null && endMs !== null && endMs > startMs) {
      if (marksRef !== null && marksRef !== ref) {
        // A cut fell between the marks and the text: the marks end the earlier segment's last delta, the stamps go with the text.
        for (let i = this.spans.length - 1; i >= 0; i--) if (this.spans[i].ref === marksRef) { this.spans[i].c1 += marks.length; break; }
        this.spans.push({ ref, s: startMs, e: endMs, c0: whole.length - text.length, c1: whole.length });
      } else this.spans.push({ ref, s: startMs, e: endMs, c0: whole.length - sent.length, c1: whole.length });
      this.prune();
    }
    this.lastOut = { char: sent[sent.length - 1], endMs };
  }

  /**
   * An output audio frame, in arrival order. Every frame advances the
   * timeline; a voiced one is the translation's activity when it speaks the
   * open segment's text, or text not yet come, and plays on the segment its
   * window's text is in — a closed one's too, as that segment's last words
   * (choice 10). The noise floor's frames never play (parity).
   */
  audio(pcm: Int16Array, o: { voiced: boolean; play: boolean }): void {
    if (this.stopped) return;
    const t0 = this.samples / SAMPLES_PER_MS;
    this.samples += pcm.length;
    const t1 = this.samples / SAMPLES_PER_MS;
    if (!o.voiced || pcm.length === 0) return;
    let ref = this.refAt((t0 + t1) / 2);
    if (ref === null || ref === this.translationRef) {
      this.core.audio(pcm, { play: false, active: true });
      ref = ref ?? this.translationRef;
    }
    if (!o.play || ref === null) return;
    const range = this.rangeOf(ref, t0, t1);
    this.o.sink.audio(range ? { pcm, ref, range } : { pcm, ref });
  }

  /** The connection is gone: both sides close as they stand, and the next connection's timelines start again at 0. */
  connectionLost(): void {
    this.core.closeAll();
    this.reset();
  }

  /** No timer is left, and nothing is said after it: L1 finalizes what is open. */
  stop(): void {
    this.stopped = true;
    this.core.stop();
    this.reset();
  }

  private reset(): void {
    this.lastEndMs = null;
    this.texts.clear();
    this.spans = [];
    this.spoken.clear();
    this.samples = 0;
    this.lastOut = null;
    this.lastTextRef = null;
  }

  /**
   * A gap on the timeline before `startMs` of at least the source pause — the
   * user's setting, as OpenAI Translate's and Gemini Live Translate's sources
   * end — ends the open source, whatever it holds (ruling 10). Not the old
   * client's 600 ms gap with a 4 s span: it cut rows at a comma's pause.
   */
  private pauseEnds(startMs: number | null): boolean {
    if (startMs === null || this.lastEndMs === null) return false;
    return startMs - this.lastEndMs >= this.o.silence.sourceMs;
  }

  /** The text of one delta into the source, cut after every N-th sentence end, and past 8 s at a clause, at 12 s anywhere. */
  private takeSource(text: string, startMs: number | null, endMs: number | null): void {
    let rest = text;
    while (rest.length > 0) {
      const start = this.sourceStartMs ?? startMs;
      const span = start !== null && endMs !== null ? endMs - start : null;
      let split = this.sentenceCut(rest);
      if (split <= 0 && span !== null && span >= SOURCE_CLAUSE_MS) split = lastClauseEnd(rest);
      if (split <= 0) {
        this.appendSource(rest, startMs);
        if (span !== null && span >= SOURCE_CAP_MS) this.core.cutSource();
        return;
      }
      this.appendSource(rest.slice(0, split), startMs);
      this.core.cutSource();
      rest = rest.slice(split);
    }
  }

  /** Where in `text` the open source reaches its N-th sentence end, or -1 (ruling 4; choice 7). */
  private sentenceCut(text: string): number {
    const n = this.o.sentencesPerSegment;
    if (n <= 0) return -1;
    const prefix = this.sourceText;
    const ends = sentenceEnds(prefix + text);
    for (let j = n - 1; j < ends.length; j++) if (ends[j] > prefix.length) return ends[j] - prefix.length;
    return -1;
  }

  private appendSource(text: string, startMs: number | null): void {
    // A new source starts at its first word.
    const piece = this.sourceRef === null ? text.replace(/^\s+/, '') : text;
    if (!piece) return;
    if (this.sourceStartMs === null) this.sourceStartMs = startMs;
    this.core.sourceText(piece);
  }

  /** The segment whose text is spoken at `t`: that of the delta whose stamps lie nearest it, the later on a tie. */
  private refAt(t: number): Ref | null {
    let best: Span | null = null;
    let bestDistance = Infinity;
    for (let i = this.spans.length - 1; i >= 0; i--) {
      const sp = this.spans[i];
      const distance = t < sp.s ? sp.s - t : t >= sp.e ? t - sp.e : 0;
      if (distance < bestDistance) {
        best = sp;
        bestDistance = distance;
      }
      // Spans before this one end earlier still: none of them is nearer.
      if (sp.e <= t) break;
    }
    return best?.ref ?? null;
  }

  /** The characters of `ref` spoken over `[t0, t1)`, after the last range it had; none while it has no stamped text. */
  private rangeOf(ref: Ref, t0: number, t1: number): TextRange | undefined {
    const spans = this.spans.filter((sp) => sp.ref === ref);
    const text = this.texts.get(ref);
    if (spans.length === 0 || text === undefined) return undefined;
    const from = this.spoken.get(ref) ?? 0;
    const start = Math.max(from, snap(text, charAt(spans, t0)));
    const end = Math.max(start, snap(text, charAt(spans, t1)));
    this.spoken.set(ref, end);
    return [start, end];
  }

  /** Stamps the audio has passed long ago: no frame will read them. */
  private prune(): void {
    const behind = this.samples / SAMPLES_PER_MS - SPAN_KEEP_MS;
    if (this.spans.length === 0 || this.spans[0].e >= behind) return;
    this.spans = this.spans.filter((sp) => sp.e >= behind);
    const live = new Set(this.spans.map((sp) => sp.ref));
    for (const ref of [...this.texts.keys()]) {
      if (live.has(ref) || ref === this.translationRef) continue;
      this.texts.delete(ref);
      this.spoken.delete(ref);
    }
  }
}

/** Where the text stands at `t` on one segment's deltas: inside a delta, in proportion; in a gap, at the end of the delta before it. */
function charAt(spans: readonly Span[], t: number): number {
  if (t <= spans[0].s) return spans[0].c0;
  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    if (t < sp.s) return spans[i - 1].c1;
    if (t < sp.e) return sp.c0 + Math.round(((sp.c1 - sp.c0) * (t - sp.s)) / (sp.e - sp.s));
  }
  return spans[spans.length - 1].c1;
}

/** A boundary inside a surrogate pair moves past it (as `tileSpan`'s). */
function snap(text: string, i: number): number {
  return i > 0 && i < text.length && isHigh(text.charCodeAt(i - 1)) && isLow(text.charCodeAt(i)) ? i + 1 : i;
}
