/**
 * Karaoke timing, simulated over recorded sessions (Qwen's wire-probe logs,
 * the Soniox karaoke probe's): the recorded adapter events, at their arrival
 * times, through the app's own clip queue and `nextLit` on a simulated clock.
 * Three ways to state a chunk's range:
 *   A  today: as recorded — a chunk is rangeless until its segment's fill-in.
 *   B  estimate: a provisional range as the chunk arrives — the phrase's text
 *      divided by a speech rate learned from this session's fill-ins (a
 *      per-language prior before the first), capped short of the phrase's end
 *      — the recorded fill-in replacing it; and karaoke never steps back
 *      within a segment.
 *   C  hindsight: each chunk's final range from its first sample (the ceiling
 *      of tiling by sample count).
 * Each is measured against where the speech really is: faster-whisper's word
 * timestamps on the session's output audio, aligned onto the segment text.
 *
 *   npx tsx scripts/dev/karaoke-probe/simulate.mts [manifest.json] [outDir]
 *
 * manifest (default `scripts/dev/karaoke-probe/fixtures/manifest.json`):
 * [{ name, kind: 'qwen' | 'soniox', log, words, target, wav? }], paths
 * relative to the repository. Writes `summary.jsonl` (per provider and
 * method), `segments.jsonl`, `aligned.jsonl` and `traces.json` to outDir
 * (default `.superpowers/karaoke-probe/sim`), plus each run's playback wav
 * when its `wav` is given. See README.md for the acceptance run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ClipQueue, type AudioTimeline } from '../../../src/lib/audio/clipQueue';
import { clipKey } from '../../../src/lib/audio/playback';
import { nextLit, type Lit } from '../../../src/lib/view/karaoke';
import { QwenSegments } from '../../../src/providers/qwen_livetranslate/segments';
import { countSkeleton } from '../../../src/lib/segmentation/sealCursor';
import { SAMPLE_RATE, type TextRange } from '../../../src/lib/contract/adapter';
import type { Leg } from '../../../src/lib/conversation/types';
import { REPO, readWav, writeWav } from '../wire-probe/common.mts';

type Ev =
  | { t: number; kind: 'segmentOpened'; ref: number; side: string }
  | { t: number; kind: 'segmentText'; ref: number; text: string }
  | { t: number; kind: 'segmentClosed'; ref: number }
  | { t: number; kind: 'audio'; ref?: number; samples: number; range?: TextRange; offset: number; index: number; stream?: string }
  | { t: number; kind: 'speechRanges'; ref: number; ranges: Array<{ index: number; range: TextRange }> }
  | { t: number; kind: 'ttsText'; stream: string; text: string };

/** One recorded session: its event log, its word timestamps, and (optional, never committed) its output audio. */
interface Run { name: string; kind: 'qwen' | 'soniox'; log: string; words: string; target: string; wav?: string }

const TICK_MS = 25;
/** Samples per letter or digit before a session has measured its own: a guess per target language, not fitted to these recordings. */
const PRIOR: Record<string, number> = { en: 0.07 * SAMPLE_RATE, ja: 0.14 * SAMPLE_RATE, zh: 0.22 * SAMPLE_RATE };
/** How many characters' worth the prior counts for once a session measures. */
const PRIOR_WEIGHT = 10;

const readLines = (file: string) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---------- loading: each recording as adapter events ----------

function loadQwen(file: string): Ev[] {
  const out: Ev[] = [];
  let t = 0;
  let offset = 0;
  const counts = new Map<number, number>();
  const segments = new QwenSegments({
    person: false,
    sink: {
      segmentOpened: (e) => out.push({ t, kind: 'segmentOpened', ref: e.ref, side: e.side }),
      segmentText: (e) => out.push({ t, kind: 'segmentText', ref: e.ref, text: e.text }),
      segmentClosed: (e) => out.push({ t, kind: 'segmentClosed', ref: e.ref }),
      audio: (e) => {
        const index = e.ref === undefined ? 0 : counts.get(e.ref) ?? 0;
        if (e.ref !== undefined) counts.set(e.ref, index + 1);
        out.push({ t, kind: 'audio', ref: e.ref, samples: e.pcm.length, offset, index, ...(e.range ? { range: [e.range[0], e.range[1]] as TextRange } : {}) });
      },
      speechRanges: (e) => out.push({ t, kind: 'speechRanges', ref: e.ref, ranges: e.ranges.map((r) => ({ index: r.index, range: [...r.range] as TextRange })) }),
    },
  });
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  for (const line of readLines(file)) {
    if (line.dir !== 'in') continue;
    const e = line.d as Record<string, unknown>;
    t = line.t;
    const itemId = str(e.item_id);
    switch (e.type) {
      case 'input_audio_buffer.speech_started': if (itemId) segments.heard(itemId, typeof e.speaker_id === 'number' ? e.speaker_id : null); break;
      case 'conversation.item.created': {
        const item = (e.item ?? {}) as { id?: unknown; content?: unknown };
        const id = str(item.id);
        const inputAudio = Array.isArray(item.content) && item.content.some((c) => (c as { type?: unknown } | null)?.type === 'input_audio');
        if (id) segments.created(id, { inputAudio, previous: str(e.previous_item_id) });
        break;
      }
      case 'response.output_item.added': { const id = str((e.item as { id?: unknown } | undefined)?.id); if (id) segments.answer(id); break; }
      case 'conversation.item.input_audio_transcription.delta':
      case 'response.audio_transcript.delta':
      case 'response.text.delta': { const d = str(e.delta); if (itemId && d) segments.text(itemId, String(e.type).startsWith('conversation.') ? 'source' : 'translation', d); break; }
      case 'conversation.item.input_audio_transcription.completed':
      case 'response.audio_transcript.done':
      case 'response.text.done': if (itemId) segments.done(itemId, String(e.type).startsWith('conversation.') ? 'source' : 'translation', str(e.transcript) ?? str(e.text)); break;
      case 'response.audio.delta': {
        const samples = Number(e.samples ?? 0);
        if (itemId && samples > 0) segments.audio(itemId, new Int16Array(samples));
        offset += samples;
        break;
      }
      case 'response.audio.done': if (itemId) segments.audioDone(itemId); break;
    }
  }
  return out;
}

function loadSoniox(file: string): Ev[] {
  const out: Ev[] = [];
  let offset = 0;
  let stream: string | undefined;
  const counts = new Map<number, number>();
  for (const { t, kind, d } of readLines(file)) {
    if (kind === 'tts.in' && d.samples > 0) stream = d.stream;
    else if (kind === 'tts.out' && typeof d.text === 'string' && d.text !== '') out.push({ t, kind: 'ttsText', stream: d.stream, text: d.text });
    else if (kind === 'segmentOpened') out.push({ t, kind, ref: d.ref, side: d.side });
    else if (kind === 'segmentText') out.push({ t, kind, ref: d.ref, text: d.text });
    else if (kind === 'segmentClosed') out.push({ t, kind, ref: d.ref });
    else if (kind === 'speechRanges') out.push({ t, kind, ref: d.ref, ranges: d.ranges });
    else if (kind === 'audio') {
      const index = d.ref === undefined ? 0 : counts.get(d.ref) ?? 0;
      if (d.ref !== undefined) counts.set(d.ref, index + 1);
      out.push({ t, kind, ref: d.ref, samples: d.samples, ...(d.range ? { range: d.range } : {}), offset, index, stream });
      offset += d.samples;
    }
  }
  return out;
}

// ---------- the estimate (B) ----------

class Rate {
  private samples = 0;
  private chars = 0;
  constructor(private readonly prior: number) {}
  get(): number { return (this.samples + this.prior * PRIOR_WEIGHT * (this.chars > 0 ? 1 : 0)) / (this.chars + PRIOR_WEIGHT * (this.chars > 0 ? 1 : 0)) || this.prior; }
  learn(samples: number, chars: number): void { if (samples > 0 && chars > 0) { this.samples += samples; this.chars += chars; } }
}

/** A chunk's provisional range: `cum` samples of the phrase heard so far, against the phrase's estimated length; never past `cap` of it. */
function provisional([a, b]: TextRange, cum: number, prevEnd: number, skeleton: number, rate: number, cap: number): TextRange {
  if (b <= a || skeleton === 0) return [prevEnd, prevEnd];
  const f = Math.min(cap, cum / (skeleton * rate));
  return [prevEnd, Math.max(prevEnd, Math.min(b, a + Math.round((b - a) * f)))];
}

interface EstimateOptions { cap: number; priorScale: number; learn: boolean }

function estimateQwen(events: Ev[], target: string, o: EstimateOptions): Ev[] {
  const rate = new Rate(PRIOR[target] * o.priorScale);
  const st = new Map<number, { text: string; start: number; end: number | null; first: number; cum: number; prevEnd: number; samples: Map<number, number> }>();
  const of = (ref: number) => { let s = st.get(ref); if (!s) { s = { text: '', start: 0, end: null, first: 0, cum: 0, prevEnd: 0, samples: new Map() }; st.set(ref, s); } return s; };
  return events.map((e) => {
    if (e.kind === 'segmentText') of(e.ref).text = e.text;
    if (e.kind === 'speechRanges') {
      const s = of(e.ref);
      if (s.end === null || e.ranges.every((r) => r.index < s.first)) return e; // a restate, not a fill
      const a = e.ranges[0].range[0];
      const b = e.ranges[e.ranges.length - 1].range[1];
      if (o.learn) rate.learn(e.ranges.reduce((n, r) => n + (s.samples.get(r.index) ?? 0), 0), countSkeleton(s.text.slice(a, b)));
      Object.assign(s, { start: b, end: null, cum: 0, prevEnd: b });
      return e;
    }
    if (e.kind !== 'audio' || e.ref === undefined || e.range) return e;
    const s = of(e.ref);
    s.samples.set(e.index, e.samples);
    if (s.end === null) Object.assign(s, { end: s.text.length, first: e.index, prevEnd: s.start, cum: 0 });
    s.cum += e.samples;
    const span: TextRange = [s.start, s.end!];
    const range = provisional(span, s.cum, s.prevEnd, countSkeleton(s.text.slice(...span)), rate.get(), o.cap);
    s.prevEnd = range[1];
    return { ...e, range };
  });
}

function estimateSoniox(events: Ev[], target: string, o: EstimateOptions): Ev[] {
  const rate = new Rate(PRIOR[target] * o.priorScale);
  // Where each stream's text begins in its ref's text: what LegSpeech's tags say as it sends (here read off the fill-in, or the text sent before).
  const streamOfEntry = new Map<string, string>();
  for (const e of events) if (e.kind === 'audio' && e.ref !== undefined && e.stream) streamOfEntry.set(`${e.ref}:${e.index}`, e.stream);
  const fillStart = new Map<string, number>();
  for (const e of events) if (e.kind === 'speechRanges') { const s = streamOfEntry.get(`${e.ref}:${e.ranges[0].index}`); if (s) fillStart.set(s, e.ranges[0].range[0]); }
  const sent = new Map<string, string>();
  const st = new Map<string, { a: number; cum: number; prevEnd: number; samples: Map<number, number> }>();
  const sentBefore = new Map<number, number>();
  return events.map((e) => {
    if (e.kind === 'ttsText') { sent.set(e.stream, (sent.get(e.stream) ?? '') + e.text); return e; }
    if (e.kind === 'speechRanges') {
      const stream = streamOfEntry.get(`${e.ref}:${e.ranges[0].index}`);
      const s = stream ? st.get(stream) : undefined;
      if (o.learn && s && stream) rate.learn(e.ranges.reduce((n, r) => n + (s.samples.get(r.index) ?? 0), 0), countSkeleton(sent.get(stream) ?? ''));
      return e;
    }
    if (e.kind !== 'audio' || e.ref === undefined || !e.stream || e.range) return e;
    let s = st.get(e.stream);
    if (!s) {
      const a = fillStart.get(e.stream) ?? sentBefore.get(e.ref) ?? 0;
      s = { a, cum: 0, prevEnd: a, samples: new Map() };
      st.set(e.stream, s);
    }
    const text = sent.get(e.stream) ?? '';
    sentBefore.set(e.ref, s.a + text.length);
    s.samples.set(e.index, e.samples);
    s.cum += e.samples;
    const range = provisional([s.a, s.a + text.length], s.cum, s.prevEnd, countSkeleton(text), rate.get(), o.cap);
    s.prevEnd = range[1];
    return { ...e, range };
  });
}

function hindsight(events: Ev[]): Ev[] {
  const final = new Map<string, TextRange>();
  for (const e of events) if (e.kind === 'speechRanges') for (const r of e.ranges) final.set(`${e.ref}:${r.index}`, r.range);
  // Every chunk the fill-in names, provisional range or not: the ceiling is the final range from the first sample.
  return events.map((e) => (e.kind === 'audio' && e.ref !== undefined && final.has(`${e.ref}:${e.index}`) ? { ...e, range: final.get(`${e.ref}:${e.index}`) } : e));
}

// ---------- playback ----------

interface Tick { t: number; playing: number | null; seg: number | null; upTo: number }
interface Played { ticks: Tick[]; clips: Array<{ at: number; end: number }> }

function play(events: Ev[], monotone: boolean): Played {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; dead: boolean }> = [];
  const clips: Array<{ at: number; end: number }> = [];
  const timeline: AudioTimeline = {
    now: () => now / 1000,
    play: (pcm, at, onEnded) => {
      const end = at + pcm.length / SAMPLE_RATE;
      clips.push({ at: at * 1000, end: end * 1000 });
      const timer = { at: end * 1000, fn: onEnded, dead: false };
      timers.push(timer);
      return () => { if (!timer.dead) { timer.dead = true; onEnded(); } };
    },
  };
  const queue = new ClipQueue<string>(timeline);
  const segs = new Map<number, { id: string; ref: number; side: string; text: string; final: boolean; speech: Array<{ range?: TextRange; pcm: Int16Array }> }>();
  const legs = (): Leg[] => [{ leg: 'speaker', segments: [...segs.values()] } as unknown as Leg];
  let held: Lit | null = null;
  const ticks: Tick[] = [];
  const sample = () => {
    const playing = queue.position();
    let next = nextLit(held, playing, legs());
    if (monotone && held && next && next.segmentId === held.segmentId && next.upTo < held.upTo) {
      const seg = [...segs.values()].find((s) => s.id === held!.segmentId);
      next = { ...held, upTo: Math.min(held.upTo, seg?.text.length ?? held.upTo) };
    }
    held = next;
    const playingRef = playing ? Number(playing.key.split(':')[1]) : null;
    ticks.push({ t: now, playing: Number.isFinite(playingRef) ? playingRef : null, seg: held ? Number(held.segmentId.split(':')[2]) : null, upTo: held?.upTo ?? 0 });
  };
  const apply = (e: Ev) => {
    if (e.kind === 'segmentOpened') segs.set(e.ref, { id: `s:speaker:${e.ref}`, ref: e.ref, side: e.side, text: '', final: false, speech: [] });
    else if (e.kind === 'segmentText') { const s = segs.get(e.ref); if (s) s.text = e.text; }
    else if (e.kind === 'segmentClosed') { const s = segs.get(e.ref); if (s) s.final = true; }
    else if (e.kind === 'speechRanges') { const s = segs.get(e.ref); if (s) for (const r of e.ranges) if (s.speech[r.index]) s.speech[r.index] = { ...s.speech[r.index], range: r.range }; }
    else if (e.kind === 'audio') {
      if (e.ref !== undefined) segs.get(e.ref)?.speech.push({ ...(e.range ? { range: e.range } : {}), pcm: new Int16Array(0) });
      queue.enqueue(clipKey('speaker', e.ref, e.index), new Int16Array(e.samples));
    }
  };
  const last = events.reduce((m, e) => Math.max(m, e.t), 0) + 60_000;
  let i = 0;
  for (let tick = 0; tick <= last; tick += TICK_MS) {
    // Everything due by this tick, in time order: arrivals and clip ends.
    for (;;) {
      const nextEvent = i < events.length ? events[i].t : Infinity;
      const live = timers.filter((x) => !x.dead);
      const nextTimer = live.reduce((m, x) => Math.min(m, x.at), Infinity);
      const at = Math.min(nextEvent, nextTimer);
      if (at > tick) break;
      now = at;
      if (nextTimer <= nextEvent) { const x = live.find((y) => y.at === nextTimer)!; x.dead = true; x.fn(); }
      else apply(events[i++]);
    }
    now = tick;
    sample();
    if (i >= events.length && queue.pending === 0 && tick > (events[events.length - 1]?.t ?? 0) + 1000) break;
  }
  return { ticks, clips };
}

// ---------- where the speech really is ----------

const norm = (ch: string) => ch.normalize('NFKC').toLowerCase();
const isSkel = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** For each UTF-16 index of `text`, when it starts being spoken (ms), from timed whisper characters; monotone. */
function charTimes(text: string, heard: Array<{ ch: string; t: number }>, start: number, end: number): { times: number[]; matched: number; letters: number } {
  const tIdx: number[] = [];
  const tCh: string[] = [];
  for (let i = 0; i < text.length; i++) if (isSkel(text[i])) { tIdx.push(i); tCh.push(norm(text[i])); }
  const n = tCh.length;
  const m = heard.length;
  // LCS alignment of the text's letters onto the heard ones.
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) dp[x][y] = tCh[x] === heard[y].ch ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
  const at = new Array<number | undefined>(n).fill(undefined);
  for (let x = 0, y = 0; x < n && y < m;) {
    if (tCh[x] === heard[y].ch) { at[x] = heard[y].t; x++; y++; }
    else if (dp[x + 1][y] >= dp[x][y + 1]) x++;
    else y++;
  }
  // Unmatched letters: interpolated between their matched neighbours (the sound's start and end at the edges).
  const anchors: Array<[number, number]> = [[-1, start], ...at.flatMap((v, k) => (v === undefined ? [] : [[k, v] as [number, number]])), [n, end]];
  const skelTime = new Array<number>(n);
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [x0, t0] = anchors[k];
    const [x1, t1] = anchors[k + 1];
    for (let x = x0 + 1; x < x1; x++) skelTime[x] = t0 + ((t1 - t0) * (x - x0)) / (x1 - x0);
    if (x1 < n) skelTime[x1] = t1;
  }
  // A space or a mark is reached with the letter after it.
  const out = new Array<number>(text.length);
  let k = n - 1;
  let next = end;
  for (let i = text.length - 1; i >= 0; i--) {
    if (k >= 0 && tIdx[k] === i) { next = skelTime[k]; k--; }
    out[i] = next;
  }
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1]);
  return { times: out, matched: at.filter((v) => v !== undefined).length, letters: n };
}

// ---------- measuring ----------

interface SegMetric { ref: number; text: string; soundMs: number; darkMs: number; firstLightMs: number | null; maxJump: number; maxJumpShare: number; errs: number[] }

function measure(events: Ev[], run: Played, times: Map<number, number[]>, texts: Map<number, string>): SegMetric[] {
  const out: SegMetric[] = [];
  for (const [ref, c] of times) {
    const text = texts.get(ref) ?? '';
    const audio = events.filter((e) => e.kind === 'audio' && e.ref === ref);
    if (audio.length === 0 || text.length === 0) continue;
    let soundMs = 0;
    let darkMs = 0;
    let first: number | null = null;
    let prev = 0;
    let maxJump = 0;
    const errs: number[] = [];
    const firstAt = run.ticks.find((k) => k.playing === ref)?.t ?? 0;
    for (const k of run.ticks) {
      const lit = k.seg === ref ? Math.min(k.upTo, text.length) : 0;
      if (k.seg === ref) { maxJump = Math.max(maxJump, lit - prev); prev = lit; }
      if (k.playing !== ref) continue;
      soundMs += TICK_MS;
      if (lit === 0) { darkMs += TICK_MS; continue; }
      if (first === null) first = k.t - firstAt;
      const ahead = c[lit - 1] > k.t ? c[lit - 1] - k.t : 0;
      const behind = lit < c.length && c[lit] < k.t ? k.t - c[lit] : 0;
      errs.push(ahead > 0 ? ahead : -behind);
    }
    out.push({ ref, text, soundMs, darkMs, firstLightMs: first, maxJump, maxJumpShare: maxJump / text.length, errs });
  }
  return out;
}

const pct = (xs: number[], p: number) => { if (xs.length === 0) return NaN; const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function summarize(ms: SegMetric[]) {
  const sound = ms.reduce((n, m) => n + m.soundMs, 0);
  const dark = ms.reduce((n, m) => n + m.darkMs, 0);
  const errs = ms.flatMap((m) => m.errs);
  const abs = errs.map(Math.abs);
  const firsts = ms.map((m) => m.firstLightMs ?? m.soundMs);
  return {
    segments: ms.length,
    soundS: +(sound / 1000).toFixed(1),
    darkShare: +(dark / sound).toFixed(3),
    firstLightP50: Math.round(pct(firsts, 0.5)), firstLightP90: Math.round(pct(firsts, 0.9)),
    errP50: Math.round(pct(abs, 0.5)), errP90: Math.round(pct(abs, 0.9)),
    aheadShare: +(errs.filter((e) => e > 150).length / Math.max(1, errs.length)).toFixed(3),
    behindShare: +(errs.filter((e) => e < -150).length / Math.max(1, errs.length)).toFixed(3),
    jumpShareP50: +pct(ms.map((m) => m.maxJumpShare), 0.5).toFixed(2), jumpShareMax: +Math.max(...ms.map((m) => m.maxJumpShare)).toFixed(2),
  };
}

// ---------- main ----------

const [manifestArg, outArg] = process.argv.slice(2);
const inRepo = (p: string) => (path.isAbsolute(p) ? p : path.join(REPO, p));
const manifest = (JSON.parse(fs.readFileSync(inRepo(manifestArg ?? 'scripts/dev/karaoke-probe/fixtures/manifest.json'), 'utf8')) as Run[])
  .map((r) => ({ ...r, log: inRepo(r.log), words: inRepo(r.words), ...(r.wav ? { wav: inRepo(r.wav) } : {}) }));
const outDir = inRepo(outArg ?? '.superpowers/karaoke-probe/sim');
fs.mkdirSync(outDir, { recursive: true });
const METHODS: Record<string, (ev: Ev[], run: Run) => Ev[]> = {
  A: (ev) => ev,
  B: (ev, r) => (r.kind === 'qwen' ? estimateQwen : estimateSoniox)(ev, r.target, { cap: 0.85, priorScale: 1, learn: true }),
  'B cap1': (ev, r) => (r.kind === 'qwen' ? estimateQwen : estimateSoniox)(ev, r.target, { cap: 1, priorScale: 1, learn: true }),
  'B prior×0.6': (ev, r) => (r.kind === 'qwen' ? estimateQwen : estimateSoniox)(ev, r.target, { cap: 0.85, priorScale: 0.6, learn: true }),
  'B prior×1.6': (ev, r) => (r.kind === 'qwen' ? estimateQwen : estimateSoniox)(ev, r.target, { cap: 0.85, priorScale: 1.6, learn: true }),
  'B no-learn': (ev, r) => (r.kind === 'qwen' ? estimateQwen : estimateSoniox)(ev, r.target, { cap: 0.85, priorScale: 1, learn: false }),
  C: (ev) => hindsight(ev),
};
const all: Record<string, Record<string, SegMetric[]>> = {};
const pages: unknown[] = [];
const aligned: unknown[] = [];
for (const run of manifest) {
  const events = (run.kind === 'qwen' ? loadQwen : loadSoniox)(run.log).sort((x, y) => x.t - y.t);
  const texts = new Map<number, string>();
  for (const e of events) if (e.kind === 'segmentText') texts.set(e.ref, e.text);
  const base = play(events, false);
  const audio = events.filter((e): e is Extract<Ev, { kind: 'audio' }> => e.kind === 'audio');
  // Whisper's words, in the concatenated output, onto playback time and their segments.
  const words = (JSON.parse(fs.readFileSync(run.words, 'utf8')) as { words: Array<{ w: string; s: number; e: number }> }).words;
  const toPlayback = (sample: number) => {
    let k = audio.length - 1;
    while (k > 0 && audio[k].offset > sample) k--;
    return base.clips[k].at + ((sample - audio[k].offset) / SAMPLE_RATE) * 1000;
  };
  const refAt = (sample: number) => { let k = audio.length - 1; while (k > 0 && audio[k].offset > sample) k--; return audio[k].ref; };
  const heard = new Map<number, Array<{ ch: string; t: number }>>();
  for (const w of words) {
    const s0 = w.s * SAMPLE_RATE;
    const s1 = w.e * SAMPLE_RATE;
    const ref = refAt((s0 + s1) / 2);
    if (ref === undefined) continue;
    const chars = [...w.w].filter(isSkel).map(norm);
    const list = heard.get(ref) ?? [];
    chars.forEach((ch, k) => list.push({ ch, t: toPlayback(s0 + ((s1 - s0) * k) / chars.length) }));
    heard.set(ref, list);
  }
  const times = new Map<number, number[]>();
  const matched = new Map<number, string>();
  for (const ref of new Set(audio.flatMap((e) => (e.ref === undefined ? [] : [e.ref])))) {
    const mine = audio.map((e, k) => ({ e, k })).filter(({ e }) => e.ref === ref);
    const start = base.clips[mine[0].k].at;
    const end = base.clips[mine[mine.length - 1].k].end;
    const c = charTimes(texts.get(ref) ?? '', heard.get(ref) ?? [], start, end);
    times.set(ref, c.times);
    matched.set(ref, `${c.matched}/${c.letters}`);
    aligned.push({ run: run.name, ref, matched: `${c.matched}/${c.letters}`, heard: (heard.get(ref) ?? []).map((h) => h.ch).join('') });
  }
  all[run.name] = {};
  const traces: Record<string, Played> = {};
  for (const [m, f] of Object.entries(METHODS)) {
    const played = play(f(events, run), m.startsWith('B'));
    traces[m] = played;
    all[run.name][m] = measure(events, played, times, texts);
  }
  // The page's data: the playback as heard (gaps included) when the run's output audio is at hand, and each 50 ms what A and B light against the truth.
  if (run.wav && fs.existsSync(run.wav)) {
    const pcm = readWav(run.wav, SAMPLE_RATE);
    const total = Math.ceil((base.clips.reduce((x, c) => Math.max(x, c.end), 0) + 500) / 1000 * SAMPLE_RATE);
    const heardPcm = new Int16Array(total);
    audio.forEach((e, k) => heardPcm.set(pcm.subarray(e.offset, e.offset + e.samples), Math.round((base.clips[k].at / 1000) * SAMPLE_RATE)));
    writeWav(path.join(outDir, `${run.name}.playback.wav`), heardPcm, SAMPLE_RATE);
  }
  const segs = [...times.keys()].map((ref) => ({ ref, text: texts.get(ref) ?? '', times: times.get(ref)!.map(Math.round) }));
  const step = (p: Played) => p.ticks.filter((_, k) => k % 2 === 0).map((k) => [k.t, k.playing ?? -1, k.seg ?? -1, k.upTo]);
  const arrivals = events.flatMap((e) => (e.kind === 'segmentText' && segs.some((s) => s.ref === e.ref) ? [[e.t, e.ref, e.text.length]] : e.kind === 'speechRanges' ? [[e.t, e.ref, -1]] : []));
  pages.push({ name: run.name, kind: run.kind, target: run.target, segs, A: step(traces.A), B: step(traces.B), arrivals });
}
fs.writeFileSync(path.join(outDir, 'traces.json'), JSON.stringify(pages));
fs.writeFileSync(path.join(outDir, 'aligned.jsonl'), aligned.map((x) => JSON.stringify(x)).join('\n') + '\n');

const byKind = (kind: string) => manifest.filter((r) => r.kind === kind).map((r) => r.name);
const rows: string[] = [];
for (const group of [['qwen', byKind('qwen')], ['soniox', byKind('soniox')], ['all', manifest.map((r) => r.name)]] as Array<[string, string[]]>) {
  if (group[1].length === 0) continue;
  for (const m of Object.keys(METHODS)) rows.push(JSON.stringify({ group: group[0], method: m, ...summarize(group[1].flatMap((n) => all[n][m])) }));
}
fs.writeFileSync(path.join(outDir, 'summary.jsonl'), rows.join('\n') + '\n');
const perSeg = manifest.flatMap((r) => all[r.name].A.map((a, k) => ({ run: r.name, ref: a.ref, text: a.text.slice(0, 40), soundS: +(a.soundMs / 1000).toFixed(1), darkA: +(a.darkMs / a.soundMs).toFixed(2), darkB: +(all[r.name].B[k].darkMs / a.soundMs).toFixed(2), jumpA: +a.maxJumpShare.toFixed(2), jumpB: +all[r.name].B[k].maxJumpShare.toFixed(2), errB90: Math.round(pct(all[r.name].B[k].errs.map(Math.abs), 0.9)), errC90: Math.round(pct(all[r.name].C[k].errs.map(Math.abs), 0.9)) })));
fs.writeFileSync(path.join(outDir, 'segments.jsonl'), perSeg.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(rows.join('\n'));
