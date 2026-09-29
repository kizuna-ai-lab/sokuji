/**
 * The Gemini probe's `hold` mode (`gemini.mts hold`): "Variant B" of the
 * no-drop research. Barge-in stays on; the microphone's frames are held
 * locally from the moment the server closes the user's turn until the
 * model's answer has finished generating, then released. This file holds
 * the pieces that are not the socket: the two utterances and their capture
 * timeline, the local hold every outgoing frame passes through, and the
 * per-run report — each model turn's cut class, each utterance heard and
 * translated whole or not, the latencies, and a pass/fail line for the
 * variant's criteria.
 *
 * Every time here is milliseconds on the run's clock (`Run.now()`), except
 * a "position" (`pos`), which is milliseconds into the capture stream: where
 * a real microphone would be when it produced that frame.
 */
import { ACTIVITY_END, ACTIVITY_START, audioFrame } from '../../../src/providers/gemini/wire';
import { concat, silence, sleep, type Run } from './common.mts';

export const POLICIES = ['none', 'generation', 'turn', 'turn2'] as const;
export const BEGINS = ['activity_end', 'input', 'output'] as const;
export const RELEASES = ['burst', 'frames', 'paced'] as const;
export type Policy = (typeof POLICIES)[number];
export type Begin = (typeof BEGINS)[number];
export type Release = (typeof RELEASES)[number];
export type Signal = Begin;
export type EndFlag = 'generationComplete' | 'interrupted' | 'turnComplete' | 'waitingForInput';

export interface HoldOptions {
  policy: Policy;
  /** The earliest begin signal honoured; the later ones in the cascade still begin a hold when it never comes. */
  begin: Begin;
  release: Release;
  /** `paced` release: this many times real time. */
  pace: number;
  /** Hold at least this long, whatever releases it earlier (P5's ~5 s hold). */
  minMs: number;
  /** The safety cap: a hold never outlives this. */
  maxMs: number;
  /** Push-to-talk: the hold begins when this client's own `activityEnd` goes out. */
  manual: boolean;
  gapMs: number;
  clip: 'default' | 'long';
  /**
   * `probe` (the `hold` mode's own): the `--begin` cascade, with its guards.
   * `plan` (the `multi` mode's): the Gemini hold plan's choice 2 — ACTIVITY_END
   * always begins; else a model turn's first output, or its first input
   * transcription only on a session that has heard no voice activity; none
   * while the user speaks, one per model turn, no "after generationComplete" guard.
   */
  rules?: 'probe' | 'plan';
  /**
   * `fixed`: `maxMs`. `plan` (choice 6): 2 s past the model turn's computed
   * playback end — its first audio's arrival plus all its audio — recomputed at
   * each part, or 10 s after the hold began while no model audio has come
   * (reason `idle`).
   */
  cap?: 'fixed' | 'plan';
  /** `turn2`: the pause that splits a release, and how long a split waits for its ACTIVITY_END (defaults SPLIT_MS, SPLIT_WAIT_MS). */
  splitMs?: number;
  splitWaitMs?: number;
}

/** The plan's cap (choice 6): the margin past the computed playback end, and the wait with no model audio. */
export const PLAN_CAP_MARGIN_MS = 2000;
export const PLAN_IDLE_MS = 10000;

/**
 * `--begin activity_end` begins on the first of a `voiceActivity`
 * ACTIVITY_END, an `inputTranscription` or the model's first output; `input`
 * drops the first of those, `output` keeps only the last. A model that sends
 * no `voiceActivity` (2.5) so falls back to the next signal instead of never
 * holding.
 */
const CASCADE: Record<Begin, readonly Signal[]> = {
  activity_end: ['activity_end', 'input', 'output'],
  input: ['input', 'output'],
  output: ['output'],
};
/** What ends a hold, per policy: `generation` at the answer's generation end, `turn` at its (simulated-playback) turn end. */
const RELEASED_BY: Record<Exclude<Policy, 'none'>, readonly EndFlag[]> = {
  generation: ['generationComplete', 'interrupted', 'turnComplete', 'waitingForInput'],
  turn: ['turnComplete', 'waitingForInput'],
  turn2: ['turnComplete', 'waitingForInput'],
};

/**
 * `turn2` (the 2026-09-29 multi batch's fixes to the plan's `turn`):
 * - (ii) an ACTIVITY_START while a hold is on lets it go at once: nothing is
 *   sent during a hold, so the server is hearing speech that went up before
 *   it — a burst it is still reading at ~3x — and must hear that speech's end
 *   (seven holds in the batch began at a burst's lagging ACTIVITY_END with the
 *   next utterance already open at the server, held its end, and waited out
 *   the 10 s idle cap);
 * - (iii) one utterance per release: at a release, the held audio goes up only
 *   to the first pause of at least `splitMs` after speech — the next
 *   utterance's onset stays held — and the leg keeps holding until the
 *   server's ACTIVITY_END for what went up (the hold then runs to that
 *   answer's turnComplete, as any hold does), or `splitWaitMs` without one
 *   (the pause closed no turn: the rest goes up). Held audio that ends in such
 *   a pause keeps holding the same way, so live speech right after a release
 *   cannot reach the server before the released utterance is answered (3.1
 *   cut the pending answer three times when it did). Held audio with no such
 *   pause goes up whole, as under `turn`.
 */
export const SPLIT_MS = 600;
export const SPLIT_WAIT_MS = 1500;

// ---------- the utterances ----------

/** One utterance on the capture timeline, in stream positions (ms). */
export interface Utterance {
  k: number;
  /** Where its audio begins. */
  start: number;
  /** Its speech: the first and last 10 ms frame louder than a tenth of the clip's loudest. */
  onset: number;
  end: number;
  /** Where its audio ends: "clip end". */
  stop: number;
  /** How many times the clip's sentence pair is spoken in it (3 for `--clip long`). */
  reps: number;
  /** The `multi` mode's: which sentence it is (`gemini-multi.mts`). */
  id?: string;
}

/** The first and last 10 ms frame louder than a tenth of the loudest one, in ms. */
export function speechBounds(pcm: Int16Array, rate: number): { onset: number; end: number } {
  const frame = Math.round(rate / 100);
  const rms: number[] = [];
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) s += pcm[j] * pcm[j];
    rms.push(Math.sqrt(s / frame));
  }
  const floor = Math.max(...rms) / 10;
  const first = rms.findIndex((r) => r > floor);
  let last = rms.length - 1;
  while (last > 0 && rms[last] <= floor) last -= 1;
  return { onset: Math.max(0, first) * 10, end: (last + 1) * 10 };
}

/**
 * `--clip long`: the probe's own Japanese clip spoken three times as one
 * ~17 s utterance. Each copy is cut 60 ms before its speech onset and 100 ms
 * after its speech end, and the copies are joined by 150 ms of silence, so
 * every pause inside is about 0.3 s — as long as the pause the clip already
 * has between its two sentences, which no model has ever ended a turn at.
 */
export function longClip(clip: Int16Array, rate: number): Int16Array {
  const { onset, end } = speechBounds(clip, rate);
  const at = (ms: number) => Math.round((rate * ms) / 1000);
  const from = at(Math.max(0, onset - 60));
  const to = at(end + 100);
  const pause = silence(150, rate);
  return concat(clip.subarray(0, to), pause, clip.subarray(from, to), pause, clip.subarray(from));
}

export type Entry =
  | { kind: 'audio'; pos: number; ms: number; pcm: Int16Array }
  | { kind: 'frame'; pos: number; label: 'activityStart' | 'activityEnd'; data: string };

/**
 * The capture timeline: the utterance, the gap, the utterance again, then
 * `tailMs` — silence under automatic detection (so the server can close the
 * second turn), nothing under push-to-talk (each utterance between its own
 * activity marks, nothing between presses, as `--manual` always sent).
 */
export function timeline(
  u: Int16Array, rate: number, chunkMs: number, gapMs: number, tailMs: number, manual: boolean, reps: number,
): { entries: Entry[]; utterances: Utterance[]; endPos: number } {
  const ms = (n: number) => (1000 * n) / rate;
  const uMs = ms(u.length);
  const b = speechBounds(u, rate);
  const utterances: Utterance[] = [0, uMs + gapMs].map((start, i) => ({ k: i + 1, start, onset: start + b.onset, end: start + b.end, stop: start + uMs, reps }));
  const step = Math.round((rate * chunkMs) / 1000);
  const chunks = (pcm: Int16Array, from: number): Entry[] => {
    const out: Entry[] = [];
    for (let off = 0; off < pcm.length; off += step) {
      const piece = pcm.subarray(off, off + step);
      out.push({ kind: 'audio', pos: from + ms(off), ms: ms(piece.length), pcm: piece });
    }
    return out;
  };
  if (!manual) {
    const all = concat(u, silence(gapMs, rate), u, silence(tailMs, rate));
    return { entries: chunks(all, 0), utterances, endPos: ms(all.length) };
  }
  const entries: Entry[] = [];
  for (const x of utterances) {
    entries.push({ kind: 'frame', pos: x.start, label: 'activityStart', data: ACTIVITY_START });
    entries.push(...chunks(u, x.start));
    entries.push({ kind: 'frame', pos: x.stop, label: 'activityEnd', data: ACTIVITY_END });
  }
  return { entries, utterances, endPos: utterances[1].stop + tailMs };
}

/** Where a stream position falls, in words, for `hold.begin`. */
export function whereIn(us: readonly Utterance[], pos: number): string {
  for (let i = us.length - 1; i >= 0; i--) {
    const u = us[i];
    if (pos >= u.onset && pos <= u.end) return `inside U${u.k}'s speech, ${Math.round(pos - u.onset)} ms after its onset`;
    if (pos > u.end) {
      const next = us[i + 1];
      return `${Math.round(pos - u.end)} ms after U${u.k}'s speech end${next ? `, ${Math.round(next.onset - pos)} ms before U${next.k}'s onset` : ''}`;
    }
  }
  return `before U1's speech, ${Math.round(us[0].onset - pos)} ms before its onset`;
}

// ---------- the hold ----------

export interface HoldRecord {
  /** 1-based, in the order holds began. */
  n: number;
  cause: string;
  /** Run time it began, and the stream position then. */
  t: number;
  pos: number;
  where: string;
  released?: number;
  /** The stream position when it let go. */
  releasedPos?: number;
  reason?: string;
  heldMs?: number;
  audioMs?: number;
  entries?: number;
  actions?: number;
  /** The longest stretch with no server message while it held: what an idle cap would have seen. */
  maxQuietMs?: number;
  sendMs?: number;
  /** The model turn's computed playback end (first audio's arrival plus all its audio), from the hold's begin; null with no model audio. */
  playbackEndMs?: number | null;
}

/** One audio frame as it went out: its stream position and length, when, and — when a hold had kept it — which hold (1-based) let it go. */
export interface SentAudio { pos: number; ms: number; at: number; held: boolean; hold?: number }

export interface HoldDeps {
  run: Run;
  ws: { send(data: string): void; readonly bufferedAmount: number };
  /** Milliseconds into the capture stream, now. */
  streamPos(): number;
  where(pos: number): string;
  closed(): boolean;
}

export type Hold = ReturnType<typeof createHold>;

/**
 * The local hold. Every captured entry passes through `push`: sent at once,
 * or queued while a hold is on (and while a release is still draining, so
 * order is kept). The socket's handler feeds it the server's signals.
 */
export function createHold(o: HoldOptions, d: HoldDeps) {
  const rules = o.rules ?? 'probe';
  const capRule = o.cap ?? 'fixed';
  const queue: Entry[] = [];
  const holds: HoldRecord[] = [];
  const sent: SentAudio[] = [];
  let current: HoldRecord | null = null;
  let draining = false;
  // Per model turn: has it finished generating, has its first output been seen, has a hold begun in it, and its audio
  // (first arrival, total ms: the plan's computed playback end). Per session: is the user speaking, has any voice activity come.
  let genDone = false;
  let outputSeen = false;
  let heldThisTurn = false;
  let turnFirstAudio: number | undefined;
  let turnAudioMs = 0;
  let vaOpen = false;
  let heardVa = false;
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  let minTimer: ReturnType<typeof setTimeout> | undefined;
  // `turn2`'s split: a hold begun by a split release waits for the server's ACTIVITY_END for what went up.
  let splitTimer: ReturnType<typeof setTimeout> | undefined;
  let awaitingEnd = false;
  let quietFrom = 0;
  let maxQuiet = 0;

  function sendEntry(e: Entry, from?: HoldRecord): void {
    if (e.kind === 'audio') {
      d.ws.send(audioFrame(e.pcm));
      sent.push({ pos: e.pos, ms: e.ms, at: d.run.now(), held: from !== undefined, hold: from?.n });
      return;
    }
    d.ws.send(e.data);
    d.run.log('out', e.label, { pos: Math.round(e.pos), deferredMs: Math.round(Math.max(0, d.streamPos() - e.pos)) });
    // Push-to-talk: a voiced activityEnd is this client's own turn close.
    if (e.label === 'activityEnd' && o.manual && o.policy !== 'none') begin('activity_end_sent');
  }

  function sendBurst(entries: Array<Extract<Entry, { kind: 'audio' }>>, from: HoldRecord): void {
    const pcm = concat(...entries.map((e) => e.pcm));
    d.ws.send(audioFrame(pcm));
    const at = d.run.now();
    for (const e of entries) sent.push({ pos: e.pos, ms: e.ms, at, held: true, hold: from.n });
    d.run.log('out', 'audio.burst', { hold: from.n, frames: entries.length, ms: Math.round(entries.reduce((n, e) => n + e.ms, 0)), bytes: pcm.length * 2, fromMs: Math.round(entries[0].pos) });
  }

  function push(e: Entry): void {
    if (current || draining || queue.length) {
      queue.push(e);
      if (e.kind === 'frame') d.run.log('note', 'hold.defer', { label: e.label, pos: Math.round(e.pos) });
      return;
    }
    sendEntry(e);
  }

  /** The plan's cap (choice 6), re-armed at the begin and at each model part. */
  function armPlanCap(): void {
    const h = current;
    if (!h) return;
    clearTimeout(capTimer);
    const now = d.run.now();
    const idle = turnFirstAudio === undefined;
    const delay = idle ? h.t + PLAN_IDLE_MS - now : turnFirstAudio! + turnAudioMs + PLAN_CAP_MARGIN_MS - now;
    capTimer = setTimeout(() => {
      d.run.log('note', 'hold.cap', { n: h.n, rule: 'plan', idle, streamMs: Math.round(d.streamPos()) });
      release(idle ? 'idle' : 'cap');
    }, Math.max(0, delay));
  }

  function begin(cause: string): void {
    if (current) return;
    const pos = d.streamPos();
    current = { n: holds.length + 1, cause, t: d.run.now(), pos: Math.round(pos), where: d.where(pos) };
    holds.push(current);
    heldThisTurn = true;
    quietFrom = current.t;
    maxQuiet = 0;
    d.run.log('note', 'hold.begin', { n: current.n, cause, streamMs: current.pos, where: current.where });
    if (capRule === 'plan') {
      armPlanCap();
      return;
    }
    const n = current.n;
    capTimer = setTimeout(() => {
      d.run.log('note', 'hold.cap', { n, maxMs: o.maxMs, streamMs: Math.round(d.streamPos()) });
      release('cap');
    }, o.maxMs);
  }

  /**
   * `turn2`'s split point: the queue index of the first held entry after the
   * first pause of at least `splitMs` that follows speech (10 ms frames at the
   * probe's 24 kHz, speech above a tenth of the held audio's loudest frame);
   * the queue's end when the held audio ends in such a pause; none otherwise.
   */
  function splitAt(): number | undefined {
    const need = o.splitMs ?? SPLIT_MS;
    const frames: Array<{ i: number; rms: number }> = [];
    let peak = 0;
    queue.forEach((e, i) => {
      if (e.kind !== 'audio') return;
      for (let k = 0; k + 240 <= e.pcm.length; k += 240) {
        let s = 0;
        for (let j = k; j < k + 240; j++) s += e.pcm[j] * e.pcm[j];
        const rms = Math.sqrt(s / 240);
        peak = Math.max(peak, rms);
        frames.push({ i, rms });
      }
    });
    if (!peak) return undefined;
    let speech = false;
    let quiet = 0;
    for (const f of frames) {
      if (f.rms > peak / 10) {
        if (speech && quiet >= need) return f.i;
        speech = true;
        quiet = 0;
      } else quiet += 10;
    }
    return speech && quiet >= need ? queue.length : undefined;
  }

  function release(reason: string, playbackEnd = turnFirstAudio === undefined ? undefined : turnFirstAudio + turnAudioMs): void {
    const h = current;
    if (!h) return;
    clearTimeout(capTimer);
    clearTimeout(minTimer);
    clearTimeout(splitTimer);
    capTimer = undefined;
    minTimer = undefined;
    splitTimer = undefined;
    awaitingEnd = false;
    current = null;
    const now = d.run.now();
    const audio = queue.filter((e) => e.kind === 'audio');
    Object.assign(h, {
      released: now,
      releasedPos: Math.round(d.streamPos()),
      reason,
      heldMs: now - h.t,
      audioMs: Math.round(audio.reduce((n, e) => n + (e.kind === 'audio' ? e.ms : 0), 0)),
      entries: queue.length,
      actions: queue.length - audio.length,
      maxQuietMs: Math.round(Math.max(maxQuiet, now - quietFrom)),
      playbackEndMs: playbackEnd === undefined ? null : Math.round(playbackEnd - h.t),
    });
    d.run.log('note', 'hold.release', {
      n: h.n, reason, heldMs: h.heldMs, audioMs: h.audioMs, entries: h.entries, actions: h.actions,
      maxQuietMs: h.maxQuietMs, playbackEndMs: h.playbackEndMs, release: o.release, streamMs: h.releasedPos,
    });
    // `turn2` (iii): one utterance per release — what follows its pause stays held, and the leg holds on for its close.
    const split = o.policy === 'turn2' && !['voice_activity_start', 'split_timeout', 'cap', 'idle'].includes(reason) ? splitAt() : undefined;
    if (split === undefined) {
      void drain(h);
      return;
    }
    const kept = queue.splice(split);
    const keptMs = kept.reduce((n, e) => n + (e.kind === 'audio' ? e.ms : 0), 0);
    d.run.log('note', 'hold.split', { n: h.n, sentMs: Math.round((h.audioMs ?? 0) - keptMs), keptMs: Math.round(keptMs), keptFromMs: kept[0] ? Math.round(kept[0].pos) : null });
    // A burst drains synchronously (turn2 always releases as one burst), so the kept entries go back at the front.
    void drain(h);
    queue.splice(0, 0, ...kept);
    begin('split');
    awaitingEnd = true;
    const n = current!.n;
    splitTimer = setTimeout(() => {
      if (!current || current.n !== n || !awaitingEnd) return;
      d.run.log('note', 'hold.split_timeout', { n, waitMs: o.splitWaitMs ?? SPLIT_WAIT_MS });
      release('split_timeout');
    }, o.splitWaitMs ?? SPLIT_WAIT_MS);
  }

  /** Sends what was held — one message, back-to-back frames, or frames at `pace`× real time — until the queue is empty or a new hold begins. */
  async function drain(h: HoldRecord): Promise<void> {
    if (draining) return;
    draining = true;
    const t0 = d.run.now();
    let messages = 0;
    while (queue.length && !current && !d.closed()) {
      if (o.release === 'burst' && queue[0].kind === 'audio') {
        let n = 0;
        while (n < queue.length && queue[n].kind === 'audio') n += 1;
        sendBurst(queue.splice(0, n) as Array<Extract<Entry, { kind: 'audio' }>>, h);
        messages += 1;
        continue;
      }
      const e = queue.shift()!;
      sendEntry(e, h);
      messages += 1;
      if (e.kind === 'audio' && o.release === 'paced') await sleep(e.ms / o.pace);
    }
    draining = false;
    h.sendMs = d.run.now() - t0;
    d.run.log('note', 'hold.sent', { n: h.n, sendMs: h.sendMs, messages, bufferedBytes: d.ws.bufferedAmount, left: queue.length });
  }

  function skip(kind: Signal, why: string): void {
    d.run.log('note', 'hold.skip', { signal: kind, why, streamMs: Math.round(d.streamPos()) });
  }

  /** A begin signal. Only a model turn's first output counts as `output`. */
  function signal(kind: Signal): void {
    if (kind === 'output') {
      if (outputSeen) return;
      outputSeen = true;
    }
    if (o.policy === 'none' || o.manual || current) return;
    if (rules === 'plan') {
      // Choice 2: ACTIVITY_END always; the fallbacks never while the user speaks, one per model turn, and the input
      // transcription only on a session that has heard no voice activity.
      if (kind === 'activity_end') return begin(kind);
      if (vaOpen) return skip(kind, 'voice activity is open: the user is still speaking');
      if (heldThisTurn) return skip(kind, 'a hold already began in this model turn');
      if (kind === 'input' && heardVa) return skip(kind, 'this session has heard voice activity: the input fallback is off');
      return begin(kind);
    }
    if (!CASCADE[o.begin].includes(kind)) return;
    // A transcription piece or an output while the user still speaks is not the turn's close.
    if (kind !== 'activity_end' && vaOpen) return skip(kind, 'voice activity is open: the user is still speaking');
    // A late transcription after this answer's generation must not start a hold that waits for a generation already done.
    if (kind !== 'activity_end' && genDone) return skip(kind, 'this model turn has already finished generating');
    begin(kind);
  }

  /** A model-turn end flag, fed in its semantic order (generation, interrupt, turn). */
  function end(flag: EndFlag): void {
    const playbackEnd = turnFirstAudio === undefined ? undefined : turnFirstAudio + turnAudioMs;
    if (flag === 'generationComplete') genDone = true;
    if (flag === 'interrupted' || flag === 'turnComplete') {
      genDone = false;
      outputSeen = false;
      heldThisTurn = false;
      turnFirstAudio = undefined;
      turnAudioMs = 0;
    }
    if (!current || o.policy === 'none' || !RELEASED_BY[o.policy].includes(flag)) return;
    const early = o.minMs - (d.run.now() - current.t);
    if (early > 0) {
      if (!minTimer) {
        const why = `${flag}+hold-min`;
        minTimer = setTimeout(() => release(why, playbackEnd), early);
        d.run.log('note', 'hold.min', { flag, waitMs: Math.round(early) });
      }
      return;
    }
    release(flag, playbackEnd);
  }

  return {
    holds,
    sent,
    get holding() { return current !== null; },
    push,
    signal,
    end,
    /** Any server message: the quiet-stretch tally. */
    message(t: number): void {
      if (!current) return;
      maxQuiet = Math.max(maxQuiet, t - quietFrom);
      quietFrom = t;
    },
    /** A model audio part: the model turn's computed playback end, and the plan's cap re-armed on it. */
    audio(t: number, ms: number): void {
      if (turnFirstAudio === undefined) turnFirstAudio = t;
      turnAudioMs += ms;
      if (capRule === 'plan') armPlanCap();
    },
    voiceActivity(type: string | undefined): void {
      heardVa = true;
      if (type === 'ACTIVITY_START') {
        vaOpen = true;
        // `turn2` (ii): the server hears speech that went up before this hold, and must hear its end. Not a split's
        // own hold: the START of the utterance the split just let go is expected, and its ACTIVITY_END is awaited.
        if (current && o.policy === 'turn2' && current.cause !== 'split') {
          d.run.log('note', 'hold.start_release', { n: current.n, streamMs: Math.round(d.streamPos()) });
          release('voice_activity_start');
        }
      }
      if (type === 'ACTIVITY_END') {
        vaOpen = false;
        if (current && awaitingEnd) {
          // The split's utterance is closed: the hold now runs to its answer's turnComplete.
          awaitingEnd = false;
          clearTimeout(splitTimer);
          splitTimer = undefined;
          d.run.log('note', 'hold.split_closed', { n: current.n, streamMs: Math.round(d.streamPos()) });
          return;
        }
        signal('activity_end');
      }
    },
    /** After the stream: waits for a hold to release (the cap bounds it) and its queue to drain. */
    async settle(): Promise<void> {
      const until = Date.now() + (capRule === 'plan' ? PLAN_IDLE_MS + 30000 : o.maxMs) + o.minMs + 2000;
      while ((current || draining || queue.length) && !d.closed() && Date.now() < until) await sleep(50);
    },
    stop(): void {
      clearTimeout(capTimer);
      clearTimeout(minTimer);
      clearTimeout(splitTimer);
    },
  };
}

// ---------- the report ----------

interface ReportTurn {
  index: number;
  text: string;
  events: Array<{ t: number; kind: 'audio' | 'text'; samples?: number }>;
  rate: number;
  end?: string;
}
export interface HoldReportInput {
  o: HoldOptions;
  utterances: readonly Utterance[];
  /** Run time the capture stream began. */
  streamT0: number;
  holds: readonly HoldRecord[];
  sent: readonly SentAudio[];
  inputs: ReadonlyArray<{ t: number; text: string; vaOpen: boolean }>;
  turns: readonly ReportTurn[];
  /** Every end flag, in arrival order, and whether a model turn with output was open. */
  ends: ReadonlyArray<{ t: number; flag: string; open: boolean }>;
  va: ReadonlyArray<{ t: number; type?: string; offsetMs?: number }>;
}

/** The clip's two sentences, heard (Japanese) and translated (English): the probe's existing regex pair. */
const HALVES = { heard: [/ようこそ/g, /手伝い/g], said: [/welcome/gi, /conversation/gi] } as const;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const sec = (ms: number | undefined) => (ms === undefined ? '-' : `${(ms / 1000).toFixed(2)} s`);

/**
 * A model turn's cut: `true` when `interrupted` came with no
 * `generationComplete` before it in the same turn (the answer was cut while
 * it was still being generated), `simulated` when it came after (only the
 * server's simulated playback was cut), `none` with no `interrupted`.
 */
export function cutClass(ends: HoldReportInput['ends'], interruptedAt: number): 'true' | 'simulated' {
  const before = ends.filter((e) => e.t <= interruptedAt);
  const lastTurnEnd = [...before].reverse().find((e) => e.flag === 'turnComplete')?.t ?? -Infinity;
  return before.some((e) => e.flag === 'generationComplete' && e.t > lastTurnEnd) ? 'simulated' : 'true';
}

export function holdReport(r: HoldReportInput): string {
  const { o, utterances: us } = r;
  const lines: string[] = [];
  const reps = us[0].reps;

  // Holds.
  lines.push(`**Hold** — policy \`${o.policy}\`${o.policy === 'none' ? '' : `, begin \`${o.begin}\`, release \`${o.release}\`${o.release === 'paced' ? ` (${o.pace}×)` : ''}, hold-min ${o.minMs} ms, cap ${o.maxMs} ms`}${o.manual ? ', push-to-talk' : ''}; gap ${o.gapMs} ms; clip ${o.clip}`);
  lines.push('');
  lines.push(`- utterances (stream position): ${us.map((u) => `U${u.k} audio ${sec(u.start)}–${sec(u.stop)}, speech ${sec(u.onset)}–${sec(u.end)}`).join('; ')}`);
  if (!r.holds.length) lines.push(`- holds: none${o.policy === 'none' ? ' (policy none)' : ''}`);
  r.holds.forEach((h, i) => {
    lines.push(`- hold ${i + 1}: began at stream ${sec(h.pos)} on \`${h.cause}\` (${h.where}) → ${h.released === undefined ? 'never released' : `released at stream ${sec(h.released - r.streamT0)} on \`${h.reason}\``}; held ${sec(h.heldMs)} wall, ${sec(h.audioMs)} of audio in ${h.entries ?? 0} entries (${h.actions ?? 0} activity marks); sent in ${h.sendMs ?? '-'} ms; longest quiet ${h.maxQuietMs ?? '-'} ms`);
  });

  // Cuts, per model turn with output, then any interrupt with no output in flight.
  lines.push('');
  lines.push('**Cuts** (true: `interrupted` before `generationComplete`; simulated: after it; run clock)');
  lines.push('');
  const interrupts = r.ends.filter((e) => e.flag === 'interrupted');
  const turnWindow = (tr: ReportTurn) => {
    const first = tr.events[0]?.t ?? Infinity;
    const next = r.turns[r.turns.indexOf(tr) + 1]?.events[0]?.t ?? Infinity;
    return { first, next };
  };
  let trueCuts = 0;
  for (const tr of r.turns) {
    const w = turnWindow(tr);
    const i = interrupts.find((e) => e.t >= w.first && e.t < w.next && e.open);
    const gen = r.ends.find((e) => e.flag === 'generationComplete' && e.t >= w.first && e.t < w.next);
    const cls = i ? cutClass(r.ends, i.t) : 'none';
    if (cls === 'true') trueCuts += 1;
    lines.push(`- turn ${tr.index}: **${cls}**${i ? ` — interrupted ${sec(i.t)}` : ''}${gen ? `, generationComplete ${sec(gen.t)}` : ', no generationComplete'} — “${tr.text.trim()}”`);
  }
  for (const i of interrupts.filter((e) => !e.open)) {
    const cls = cutClass(r.ends, i.t);
    if (cls === 'true') trueCuts += 1;
    lines.push(`- an interrupt with no model output in flight at ${sec(i.t)}: **${cls}**${cls === 'true' ? ' (an answer cut before its first output)' : ''}`);
  }

  // Attribution: a transcription piece while the user speaks belongs to the utterance being sent; a turn-final one to
  // the last utterance whose speech had all gone out; an answer to the utterance of the last piece before it.
  const sendAt = (pos: number): number | undefined => {
    const e = r.sent.find((s) => pos >= s.pos && pos < s.pos + s.ms);
    return e ? e.at + (e.held ? 0 : pos - e.pos) : undefined;
  };
  const firstSent = us.map((u) => r.sent.find((s) => s.pos >= u.start - 1e-6)?.at);
  const endSent = us.map((u) => sendAt(u.end - 1));
  const uttOfInput = (p: { t: number; vaOpen: boolean }): number => {
    const marks = p.vaOpen ? firstSent : endSent;
    let k = 1;
    marks.forEach((m, i) => { if (m !== undefined && m <= p.t) k = i + 1; });
    return k;
  };
  const inputUtt = r.inputs.map((p) => ({ ...p, k: uttOfInput(p) }));
  const answerUtt = r.turns.map((tr) => {
    const first = tr.events[0]?.t ?? Infinity;
    const before = inputUtt.filter((p) => p.t < first);
    return { tr, k: before.length ? before[before.length - 1].k : 1 };
  });

  // Merged: one user turn held both utterances — a transcription piece, or the only answer, carries a sentence more often than one utterance does.
  const over = (text: string, res: readonly RegExp[]) => res.some((re) => count(text, re) > reps);
  const merged = r.inputs.some((p) => over(p.text, HALVES.heard)) || (r.turns.length < us.length && r.turns.some((tr) => over(tr.text, HALVES.said)));
  const verdict = (c: number[]) => (c.every((n) => n >= reps) ? 'whole' : c.some((n) => n > 0) ? 'partial' : 'none');

  lines.push('');
  lines.push(`**Utterances** (a whole one has each sentence ×${reps})`);
  lines.push('');
  const perUtt = us.map((u) => {
    const heard = inputUtt.filter((p) => p.k === u.k).map((p) => p.text).join('');
    const answers = answerUtt.filter((a) => a.k === u.k).map((a) => a.tr);
    const said = answers.map((a) => a.text).join(' ');
    const h = HALVES.heard.map((re) => count(heard, re));
    const s = HALVES.said.map((re) => count(said, re));
    lines.push(`- U${u.k}: heard ${verdict(h)} (first ×${h[0]}, second ×${h[1]}) “${heard.trim()}”; translated ${verdict(s)} (first ×${s[0]}, second ×${s[1]}) in turn(s) ${answers.map((a) => a.index).join(', ') || '-'} “${said.trim()}”`);
    return { u, h: verdict(h), s: verdict(s), answers, sCounts: s };
  });
  lines.push(`- turns merged: ${merged ? '**yes** (one user turn heard both utterances)' : 'no'}; model turns with output: ${r.turns.length}`);

  // Latency.
  const firstAudio = (tr: ReportTurn | undefined) => tr?.events.find((e) => e.kind === 'audio')?.t;
  const audioMs = (tr: ReportTurn) => (1000 * tr.events.reduce((n, e) => n + (e.kind === 'audio' ? e.samples ?? 0 : 0), 0)) / tr.rate;
  const a1 = perUtt[0].answers[0];
  const a2 = perUtt[1].answers[0];
  const clipEnd = (k: number) => r.streamT0 + us[k - 1].stop;
  const f1 = firstAudio(a1);
  const f2 = firstAudio(a2);
  const lat2 = f2 === undefined ? undefined : f2 - clipEnd(2);
  const a1PlayEnd = a1 && f1 !== undefined ? f1 + audioMs(a1) : undefined;
  lines.push('');
  lines.push(`**Latency**: clip-1 end → answer 1's first audio ${sec(f1 === undefined ? undefined : f1 - clipEnd(1))}; clip-2 end → answer 2's first audio **${sec(lat2)}**${a1PlayEnd !== undefined && f2 !== undefined ? `; audible gap between the answers, answer 1 played in real time from its first chunk and answer 2 queued behind it: ${sec(Math.max(0, f2 - a1PlayEnd))}` : ''}`);

  // P5: does voiceActivity's audioOffset read audio time (samples received) or wall time (arrival)? The two differ only
  // for a boundary a hold delayed. The server's own onset/end convention differs from this file's by a constant, taken
  // from the first unheld boundary of the same type (U1's) and subtracted before the comparison.
  const first = r.sent[0];
  const audioTime = (pos: number) => r.sent.filter((s) => s.pos < pos).reduce((n, s) => n + Math.min(s.ms, pos - s.pos), 0);
  const baseline = new Map<string, number>();
  const vaLines = r.va.filter((v) => v.offsetMs !== undefined && v.type).map((v) => {
    const off = v.offsetMs!;
    const boundary = (u: Utterance) => (v.type === 'ACTIVITY_START' ? u.onset : u.end);
    const c = us.map((u) => {
      const b = boundary(u);
      const audio = audioTime(b);
      const at = sendAt(b);
      const wall = at === undefined || !first ? undefined : at - first.at;
      const d = Math.min(Math.abs(off - audio), wall === undefined ? Infinity : Math.abs(off - wall));
      return { u, audio, wall, d };
    }).sort((x, y) => x.d - y.d)[0];
    const which = v.type === 'ACTIVITY_START' ? 'onset' : 'speech end';
    const shifted = c.wall !== undefined && Math.abs(c.wall - c.audio) >= 300;
    if (!shifted && !baseline.has(v.type!)) baseline.set(v.type!, off - c.audio);
    const adj = off - (baseline.get(v.type!) ?? 0);
    const reads = !shifted
      ? 'not held, so no test'
      : Math.abs(adj - c.audio) < Math.abs(adj - c.wall!)
        ? '**audio time** (samples received: the held time is inside the offset)'
        : '**wall time** (arrival: the hold delay is added to the offset)';
    return `- ${v.type} audioOffset ${sec(off)} (arrived ${sec(v.t)}) ↔ U${c.u.k} ${which}: audio time ${sec(c.audio)} (Δ ${Math.round(off - c.audio)} ms), wall ${sec(c.wall)}${c.wall === undefined ? '' : ` (Δ ${Math.round(off - c.wall)} ms)`}${shifted ? `; less the ${Math.round(off - adj)} ms convention offset` : ''} → ${reads}`;
  });
  lines.push('');
  lines.push('**voiceActivity audioOffset** (P5)');
  lines.push('');
  lines.push(...(vaLines.length ? vaLines : ['- no voiceActivity with an audioOffset']));

  // P3.
  const heardWhole = perUtt.every((p) => p.h === 'whole');
  const saidWhole = perUtt.every((p) => p.s === 'whole');
  const repeat = !merged && r.turns.some((tr) => over(tr.text, HALVES.said));
  const why = [
    heardWhole ? '' : `heard ${perUtt.map((p) => `U${p.u.k} ${p.h}`).join(', ')}`,
    saidWhole ? '' : `translated ${perUtt.map((p) => `U${p.u.k} ${p.s}`).join(', ')}`,
    trueCuts ? `${trueCuts} true cut(s)` : '',
    repeat ? 'an answer repeats a sentence' : '',
  ].filter(Boolean);
  const verdictB = merged ? 'MERGED' : why.length ? 'FAIL' : 'PASS';
  lines.push('');
  lines.push(`**Variant B (P3): ${verdictB}** — heard whole: ${heardWhole ? 'yes' : 'no'}; translated whole: ${saidWhole ? 'yes' : 'no'}; true cuts: ${trueCuts}; answer repeats: ${repeat ? 'yes' : 'no'}; clip-2 end → answer 2 first audio ${sec(lat2)}${merged ? ' (turns merged: the gap is under the server\'s end-of-speech silence, not a hold question)' : why.length ? ` — ${why.join('; ')}` : ''}`);
  return lines.join('\n');
}
