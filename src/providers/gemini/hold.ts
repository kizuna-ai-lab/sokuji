/**
 * A 3.x dialogue model's input, held while the model's turn runs (Gemini
 * hold, ruling 1). Such a model barges in (Gemini/AST2 follow-up, ruling 5),
 * and its turn lasts until its `turnComplete`, which the server paces to a
 * simulated real-time playback of the answer: its `generationComplete`
 * comes 3–4 s earlier. Input that reaches it inside that turn cuts the
 * answer, or is heard without its start (the owner's probes). So once the
 * user's turn has closed, what the leg would send — audio, a press's
 * activity marks, typed text — is held here, in order, and let go at the
 * model's `turnComplete`: each unbroken run of audio as one frame, each
 * held send in its place (choice 5).
 *
 * What begins a hold: under automatic turns the server's `voiceActivity`
 * ACTIVITY_END, or else a model turn's first model output — or its first
 * input transcription, on a session that has heard no voice activity —
 * while the server has not said the user is speaking (choice 2); under
 * manual turns the leg's own `activityEnd`, which the adapter reports
 * (choice 3). What ends it: `turnComplete` or `waitingForInput` (choice 4);
 * the cap — the model's computed playback end plus `HOLD_MARGIN_MS`, or
 * `HOLD_IDLE_MS` with no model audio at all — which lets go of what it
 * holds, never drops it (ruling 3; choice 6); a lost connection carries it
 * over — with at most `HOLD_CARRY_MS` of the gap's own audio under
 * automatic turns — and the next connection's setup lets it go (choice 10);
 * the session's end drops it, silently (choice 11). Under automatic turns
 * two more rules (Gemini hold, ruling 4): an ACTIVITY_START during a hold
 * lets it go at once, and a release lets one utterance go — up to the first
 * pause after speech a little longer than the session's own end-of-speech
 * silence — holding the rest until the server has closed that one and
 * answered it (choices 14, 15). Pure: a clock and three callbacks — the
 * adapter sends and frames.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';

/** Past the model's computed playback end, a hold whose `turnComplete` has not come lets go after this much more (Gemini hold, ruling 3). */
export const HOLD_MARGIN_MS = 2_000;
/** With no model audio since the hold began, it lets go this long after it began: a model that declines to answer, or a stall (Gemini hold, ruling 3). */
export const HOLD_IDLE_MS = 10_000;
/** Under automatic turns, at most this much of a reconnect gap's audio is carried: the gap's first; later gap audio is dropped, as outside a hold (choice 10). */
export const HOLD_CARRY_MS = 5_000;
/** Under automatic turns a release lets the held audio go up to the first pause after speech at least this much longer than the session's end-of-speech silence: one utterance (Gemini hold, ruling 4; choice 15). */
export const SPLIT_PAUSE_MARGIN_MS = 100;
/** …and never shorter than this, so that the gaps between words never split (choice 15). */
export const SPLIT_PAUSE_FLOOR_MS = 200;
/** The hold such a release begins waits at least this long for the server's ACTIVITY_END for what went up, then lets the rest go: that pause closed no turn (Gemini hold, ruling 4; choice 14). */
export const SPLIT_END_MS = 2_000;
/** The pause's gate reads the held audio in frames this long (choice 15). */
export const GATE_FRAME_MS = 10;
/** A frame is speech when its RMS is above the held audio's loudest frame's divided by this: 20 dB under it (choice 15). */
export const GATE_PEAK_DIVISOR = 10;
const CARRY_SAMPLES = (HOLD_CARRY_MS * SAMPLE_RATE) / 1000;
const GATE_FRAME = (GATE_FRAME_MS * SAMPLE_RATE) / 1000;

/** The split's pause for a session whose server closes a turn after `silenceMs` of silence: at the default 500, 600 (choice 15). */
export function splitPauseMs(silenceMs: number): number {
  return Math.max(SPLIT_PAUSE_FLOOR_MS, silenceMs + SPLIT_PAUSE_MARGIN_MS);
}

/**
 * What began a hold: the server's `voiceActivity` ACTIVITY_END, the first
 * input transcription or model output of a model turn (automatic turns),
 * the leg's own `activityEnd` (manual turns), or a release that let one
 * utterance go and holds the rest (`split`, automatic turns).
 */
export type HoldCause = 'voice_activity' | 'input_transcription' | 'model_output' | 'activity_end' | 'split';
/**
 * What ended it: the model's turn or its wait for input; the cap past the computed playback end, or with no model
 * audio; the next connection's setup, after a lost one; an ACTIVITY_START; a split's wait for its ACTIVITY_END run out.
 */
export type HoldEnd = 'turn_complete' | 'waiting_for_input' | 'cap' | 'idle' | 'reconnect' | 'voice_activity_start' | 'split_timeout';

/** What one hold did, for the Logs (`turn.hold_end`): what the live test reads the cap's constants by. */
export interface HoldSummary {
  reason: HoldEnd;
  /** From its begin to its end. */
  heldMs: number;
  /** The microphone audio it held when it let go: what went up as one frame per unbroken run, or kept by a split. */
  audioMs: number;
  /** The held sends — a press's marks, typed text — it held when it let go. */
  actions: number;
  /** Presses released without voice while their `activityStart` was still held: withdrawn, never sent (choice 7). */
  withdrawn: number;
  /** The model's computed playback end — its first audio's arrival plus all its audio — from the hold's begin; null with no model audio. */
  playbackEndMs: number | null;
  /** It was carried across a lost connection and let go on the next one (choice 10). */
  carried?: true;
  /** The gap's audio dropped past `HOLD_CARRY_MS` while carried, under automatic turns (choice 10); absent when none was. */
  droppedMs?: number;
  /** Of `audioMs`, what a split kept held, from the next utterance's onset: 0 when the held audio ended in the pause; absent when the release let all go (choice 14). */
  keptMs?: number;
}

/** A held send: run in its place when the hold lets go. The adapter may withdraw it while it is still held. */
export interface HeldAction {
  readonly run: () => void;
}

type HeldAudio = { readonly pcm: Int16Array };
type Entry = HeldAudio | HeldAction;

export type InputHoldOptions = {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  /** Sends one unbroken run of held audio up, as one frame. */
  send(pcm: Int16Array): void;
  began(cause: HoldCause): void;
  /** Before what it held goes up; never on `cancel`. */
  ended(summary: HoldSummary): void;
} & (
  /** Manual turns: only the leg's own `activityEnd` begins a hold; the server's signals begin none, and nothing splits (choices 3, 14). */
  | { manual: true }
  /** Automatic turns: the session's end-of-speech silence (`activity.silenceMs`), which the split's pause follows (choice 15). */
  | { manual: false; silenceMs: number }
);

interface Run {
  cause: HoldCause;
  beganAt: number;
  withdrawn: number;
  /** A lost connection carries it to the next one: no cap runs until that one is set up (choice 10). */
  carried: boolean;
  /** The gap's audio kept while carried, and dropped past `HOLD_CARRY_MS`, in samples (choice 10). */
  gapKept: number;
  gapDropped: number;
  stop: () => void;
  /** A split's hold waits for the server's ACTIVITY_END for what went up: this stops that wait. While it runs, a START is that utterance's own (choice 14). */
  awaiting: (() => void) | null;
  /** An ACTIVITY_START came between `interrupted` and the `turnComplete` that trails it: it lets go there, or at content before it (choices 4, 14). */
  startWaits: boolean;
}

/** A release: the entries a split kept held (none kept is an empty list), or null when it let all go; and how much audio it let go, in ms. */
type Release = { kept: Entry[] | null; sentMs: number };

/** Each unbroken run of audio as one frame (choice 5). */
function join(run: readonly HeldAudio[]): Int16Array {
  if (run.length === 1) return run[0].pcm;
  let length = 0;
  for (const e of run) length += e.pcm.length;
  const out = new Int16Array(length);
  let at = 0;
  for (const e of run) {
    out.set(e.pcm, at);
    at += e.pcm.length;
  }
  return out;
}

function samplesIn(entries: readonly Entry[]): number {
  let samples = 0;
  for (const e of entries) if ('pcm' in e) samples += e.pcm.length;
  return samples;
}

const ms = (samples: number) => Math.round((samples * 1000) / SAMPLE_RATE);

export class InputHold {
  private run: Run | null = null;
  private readonly queue: Entry[] = [];
  /** The server said the user is speaking: an ACTIVITY_START with no ACTIVITY_END yet. */
  private speaking = false;
  /**
   * The session has heard voice activity: its model marks the user's turns itself, so an input transcription is no
   * turn close — the 3.x models send it while the activity is still open, and one that comes later is late
   * (choice 2) — and a split has an ACTIVITY_END to wait for (choice 14). A property of the model, kept across a lost
   * connection.
   */
  private heard = false;
  /** A transcription or an output may begin a hold: none has begun since the model's last turn ended (choice 2). */
  private armed = true;
  /** This model turn's audio: when its first part arrived, and how long all of it plays (choice 6). */
  private firstAudioAt: number | null = null;
  private answerMs = 0;
  /** An `interrupted` has come, and neither the `turnComplete` that trails it nor any content since (choice 4). */
  private cut = false;
  /** The split's pause; null under manual turns, which never split (choice 15). */
  private readonly pauseMs: number | null;

  constructor(private readonly o: InputHoldOptions) {
    this.pauseMs = o.manual ? null : splitPauseMs(o.silenceMs);
  }

  get holding(): boolean {
    return this.run !== null;
  }

  /**
   * The server's voice activity. ACTIVITY_END is the user's turn closing (choice 2) — or, on a split's hold, the close
   * it waits for. Under automatic turns an ACTIVITY_START during a hold lets it go: nothing goes up while one is on,
   * so the server is hearing speech that went up before it, and must hear its end — unless it is a split's hold still
   * waiting for its END, whose own utterance's START is expected (choice 14).
   */
  voiceActivity(type: string | undefined): void {
    this.heard = true;
    const run = this.run;
    if (type === 'ACTIVITY_START') {
      this.speaking = true;
      if (!run || this.o.manual || run.awaiting) return;
      // Between `interrupted` and the `turnComplete` that trails it, a held send would split that end in two: it lets go there, or at content before it (choices 4, 14).
      if (this.cut) run.startWaits = true;
      else this.letGo(this.finish('voice_activity_start'));
      return;
    }
    if (type !== 'ACTIVITY_END') return;
    this.speaking = false;
    if (this.o.manual) return;
    if (run?.awaiting) {
      // What the split let go is closed: the hold now runs to its answer's `turnComplete`, as any hold does.
      run.awaiting();
      run.awaiting = null;
      return;
    }
    // A START that waited for an `interrupted`'s trailing `turnComplete` is closed by this END: the hold goes on for its answer, as any hold does (choice 14).
    if (run) run.startWaits = false;
    this.begin('voice_activity');
  }

  /** An input transcription with text: a turn close only on a session that has heard no voice activity (choice 2). */
  input(): void {
    this.contentCame();
    if (!this.heard) this.fallback('input_transcription');
  }

  /**
   * Model output — an output transcription, a model part — and how much of it is audio, in ms. `content` is false for
   * a part `GeminiTurns` takes as none — audio at a rate it does not play: the cap still counts that audio (choice 6),
   * but it neither ends an `interrupted`'s wait nor begins a hold (choices 2, 4).
   */
  output(audioMs = 0, content = true): void {
    if (content) this.contentCame();
    if (audioMs > 0) {
      if (this.firstAudioAt === null) this.firstAudioAt = this.o.clock.now();
      this.answerMs += audioMs;
      // Recomputed as the audio arrives (ruling 3; choice 6).
      if (this.run) this.arm();
    }
    if (content) this.fallback('model_output');
  }

  /** The model's turn was cut. A hold goes on to the `turnComplete` that trails it (choice 4). */
  interrupted(): void {
    this.cut = true;
    this.newTurn();
  }

  /** The model's turn ended: what is held goes up, after the adapter has ended the turn (choice 4). */
  turnComplete(): void {
    this.cut = false;
    const release = this.finish(this.run?.startWaits ? 'voice_activity_start' : 'turn_complete');
    this.newTurn();
    this.letGo(release);
  }

  /**
   * The model is not generating: it waits for the user, its turn over (choice 4). Not while a split's hold awaits its
   * END: that split was just released — by the `turnComplete` just before, say — its END is still to come, and its own
   * wait bounds it (choice 14). Nor between `interrupted` and the `turnComplete` that trails it: a held send let go
   * there would split that end in two; that `turnComplete`, content or the cap lets go (Gemini hold, choice 4).
   */
  waitingForInput(): void {
    if (this.run?.awaiting || this.cut) return;
    const release = this.finish('waiting_for_input');
    this.newTurn();
    this.letGo(release);
  }

  /** Begins a hold, unless one is on. The adapter's own `activityEnd` comes here (choice 3). */
  begin(cause: HoldCause): void {
    if (this.run) return;
    this.armed = false;
    this.run = {
      cause,
      beganAt: this.o.clock.now(),
      withdrawn: 0,
      carried: false,
      gapKept: 0,
      gapDropped: 0,
      stop: () => {},
      awaiting: null,
      startWaits: false,
    };
    this.arm();
    this.o.began(cause);
  }

  /**
   * Held, as a copy: the capture may reuse its buffer. Only while holding. Carried across a lost connection under
   * automatic turns, the gap's audio is kept up to `HOLD_CARRY_MS` — its first, the start of what is being said —
   * and dropped past it, as outside a hold; under manual turns the presses bound it (choice 10).
   */
  audio(pcm: Int16Array): void {
    const run = this.run;
    if (!run) return;
    let kept = pcm;
    if (run.carried && !this.o.manual) {
      const room = Math.max(0, CARRY_SAMPLES - run.gapKept);
      if (kept.length > room) kept = kept.subarray(0, room);
      run.gapKept += kept.length;
      run.gapDropped += pcm.length - kept.length;
      if (kept.length === 0) return;
    }
    this.queue.push({ pcm: kept.slice() });
  }

  /** A send held in its place. Only while holding. */
  defer(run: () => void): HeldAction {
    const action: HeldAction = { run };
    if (this.run) this.queue.push(action);
    return action;
  }

  /** The held send is still held: not yet gone out, nor withdrawn. */
  holds(action: HeldAction | null): boolean {
    return action !== null && this.queue.includes(action);
  }

  /**
   * A press released without voice while its `activityStart` is still held
   * never reached the server: that action goes, with every audio entry held
   * after it — the press's own, since audio comes only while a key is held —
   * and nothing of them is sent (choice 7). False when it has gone out.
   */
  withdraw(action: HeldAction): boolean {
    const at = this.queue.indexOf(action);
    if (at < 0) return false;
    const kept = this.queue.slice(at + 1).filter((e) => !('pcm' in e));
    this.queue.splice(at, this.queue.length - at, ...kept);
    if (this.run) this.run.withdrawn += 1;
    return true;
  }

  /**
   * A lost connection (choice 10): a hold goes on — it keeps what it held and what comes before the next connection
   * is set up — with no cap, since no model turn can end on a connection that is gone, and no split's wait, since no
   * ACTIVITY_END can come on it (choice 14). The server's speaking state and the model turn were the old session's.
   */
  carry(): void {
    this.speaking = false;
    this.cut = false;
    this.newTurn();
    const run = this.run;
    if (!run) return;
    run.stop();
    run.stop = () => {};
    run.awaiting?.();
    run.awaiting = null;
    run.startWaits = false;
    run.carried = true;
  }

  /** The next connection is set up: a carried hold lets go at once — no model turn is in flight on it (choice 10). */
  reconnected(): void {
    if (this.run?.carried) this.letGo(this.finish('reconnect'));
  }

  /** The session ends: nothing more goes up, nothing is said, no timer is left (choice 11). */
  cancel(): void {
    const run = this.run;
    this.run = null;
    run?.stop();
    run?.awaiting?.();
    this.queue.length = 0;
  }

  /**
   * Content: the `interrupted` is behind it, as `GeminiTurns` reads it (choice 4). A START that waited for that
   * `interrupted`'s trailing `turnComplete` lets the hold go now, at once, as a START does: that `turnComplete` may never
   * come (Gemini hold, choice 14). First on the call: the answer this content begins is not that hold's to count, and a
   * fallback after it may hold for that answer.
   */
  private contentCame(): void {
    this.cut = false;
    if (this.run?.startWaits) this.letGo(this.finish('voice_activity_start'));
  }

  private fallback(cause: HoldCause): void {
    if (this.o.manual || this.run || !this.armed || this.speaking) return;
    this.begin(cause);
  }

  private newTurn(): void {
    this.armed = true;
    this.firstAudioAt = null;
    this.answerMs = 0;
  }

  /**
   * The cap (ruling 3; choice 6): the model's computed playback end — its
   * first audio's arrival plus all the audio it sent — plus `HOLD_MARGIN_MS`;
   * `HOLD_IDLE_MS` from the begin while no model audio has come. Never
   * longer than the audio received plus the margin from now, so a wall
   * clock stepped back cannot stretch it.
   */
  private arm(): void {
    const run = this.run!;
    run.stop();
    const first = this.firstAudioAt;
    if (first === null) {
      run.stop = this.o.clock.setTimeout(() => this.letGo(this.finish('idle')), HOLD_IDLE_MS);
      return;
    }
    const most = this.answerMs + HOLD_MARGIN_MS;
    const delay = Math.max(0, Math.min(first + most - this.o.clock.now(), most));
    run.stop = this.o.clock.setTimeout(() => this.letGo(this.finish('cap')), delay);
  }

  /**
   * Ends the hold and says what it held; the caller lets it go. Under automatic turns, on a session that has heard
   * voice activity, a release at `turnComplete`, `waitingForInput` or a new connection lets one utterance go and keeps
   * the rest (choice 14); the cap, the idle cap, an ACTIVITY_START and a split's own wait let all go — each is there
   * so that nothing waits longer. Null when none was on.
   */
  private finish(reason: HoldEnd): Release | null {
    const run = this.run;
    if (!run) return null;
    this.run = null;
    run.stop();
    run.awaiting?.();
    let samples = 0;
    let actions = 0;
    for (const e of this.queue) {
      if ('pcm' in e) samples += e.pcm.length;
      else actions += 1;
    }
    const pauseMs = this.pauseMs;
    const splits = pauseMs !== null && this.heard && (reason === 'turn_complete' || reason === 'waiting_for_input' || reason === 'reconnect');
    const at = splits ? this.splitAt(pauseMs) : undefined;
    const kept = at === undefined ? null : this.queue.splice(at);
    const keptSamples = kept ? samplesIn(kept) : 0;
    this.o.ended({
      reason,
      heldMs: this.o.clock.now() - run.beganAt,
      audioMs: ms(samples),
      actions,
      withdrawn: run.withdrawn,
      playbackEndMs: this.firstAudioAt === null ? null : Math.round(this.firstAudioAt + this.answerMs - run.beganAt),
      ...(run.carried ? { carried: true as const } : {}),
      ...(run.gapDropped > 0 ? { droppedMs: ms(run.gapDropped) } : {}),
      ...(kept ? { keptMs: ms(keptSamples) } : {}),
    });
    return { kept, sentMs: ms(samples - keptSamples) };
  }

  /**
   * Where a release splits what is held (choice 14): at the first entry after a pause of at least `pauseMs`
   * that follows speech — the next utterance's audio, or a send held after the pause; the queue's end when the held
   * audio ends in such a pause; none without one. The gate (choice 15): `GATE_FRAME_MS` frames over the held audio as
   * one stream, whatever its chunks, each counted to the entry it begins in; speech above the loudest frame's RMS
   * divided by `GATE_PEAK_DIVISOR`. A held send breaks the stream.
   */
  private splitAt(pauseMs: number): number | undefined {
    const frames: Array<{ at: number; rms: number }> = [];
    let peak = 0;
    let sum = 0;
    let n = 0;
    let from = 0;
    this.queue.forEach((e, at) => {
      if (!('pcm' in e)) {
        frames.push({ at, rms: -1 });
        sum = 0;
        n = 0;
        return;
      }
      for (const s of e.pcm) {
        if (n === 0) from = at;
        sum += s * s;
        n += 1;
        if (n === GATE_FRAME) {
          const rms = Math.sqrt(sum / GATE_FRAME);
          peak = Math.max(peak, rms);
          frames.push({ at: from, rms });
          sum = 0;
          n = 0;
        }
      }
    });
    if (peak === 0) return undefined;
    let speech = false;
    let quiet = 0;
    for (const f of frames) {
      const paused = speech && quiet >= pauseMs;
      if (f.rms < 0) {
        if (paused) return f.at;
        continue;
      }
      if (f.rms > peak / GATE_PEAK_DIVISOR) {
        if (paused) return f.at;
        speech = true;
        quiet = 0;
      } else quiet += GATE_FRAME_MS;
    }
    return speech && quiet >= pauseMs ? this.queue.length : undefined;
  }

  /**
   * What a release let go goes up in order, until none is left or a held send begins a new hold, which keeps the rest
   * (choice 5). What a split kept stays held, in a hold of its own that waits for the server's ACTIVITY_END for what
   * went up: `SPLIT_END_MS`, or half as long as that audio plays when that is longer — the server reads a released
   * burst at about 2–4× real time, and its close comes later the more it has to read (choice 14).
   */
  private letGo(release: Release | null): void {
    if (!release) return;
    this.drain();
    if (!release.kept) return;
    this.queue.push(...release.kept);
    if (this.run) return;
    this.begin('split');
    const run = this.run!;
    run.awaiting = this.o.clock.setTimeout(() => {
      run.awaiting = null;
      this.letGo(this.finish('split_timeout'));
    }, Math.max(SPLIT_END_MS, Math.ceil(release.sentMs / 2)));
  }

  private drain(): void {
    while (this.queue.length > 0 && !this.run) {
      const head = this.queue[0];
      if ('pcm' in head) {
        let n = 1;
        while (n < this.queue.length && 'pcm' in this.queue[n]) n += 1;
        this.o.send(join(this.queue.splice(0, n) as HeldAudio[]));
        continue;
      }
      this.queue.shift();
      head.run();
    }
  }
}
