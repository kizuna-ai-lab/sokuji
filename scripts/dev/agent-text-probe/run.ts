/**
 * One probe run: the app's own Soniox adapter in face-to-face (one shared
 * two_way STT socket, both voices speaking, as `buildSoniox` builds it), a
 * scripted conversation played into its microphone in real time, the
 * translations it speaks scheduled by the app's own clip queues, their echo
 * mixed back into the microphone, and agent text sent by one of the four
 * conditions (`agentText.ts`). The same code runs live (real clock, real
 * sockets) and dry (`fakeEnv`: a virtual clock and `FakeSoniox`).
 *
 * The microphone's timeline. The shared socket's mixer sends one 100-ms
 * frame per tick (`pcmMixer.ts`); the probe pushes the next microphone frame
 * right after each tick's send, so every tick finds exactly one frame and
 * the STT audio clock is the microphone's timeline, frame for frame (no
 * zero-fill, no backlog). Frame j holds microphone ms [100j, 100j + 100); it
 * is pushed at tick j − 1 and sent at tick j. For that push to be causal the
 * frame's audio must have been captured by then, so microphone ms τ was
 * captured at session time τ0 + τ with τ0 = (tick 0) − 200: a sample reaches
 * Soniox 100–200 ms after it was captured (the app: an 85-ms worklet chunk,
 * then up to a 100-ms mixer tick). A clip that plays at session time P is
 * heard by the microphone at P + delay, i.e. at microphone ms
 * P + delay − τ0, and its echo is added to the frame holding it before that
 * frame is pushed (a clip is scheduled ≥ 50 ms ahead, so it always is).
 */
import { createSonioxAdapter, type SonioxSession } from '../../../src/providers/soniox/adapter';
import { buildSoniox, type SonioxConfig } from '../../../src/providers/soniox/config';
import { SONIOX_DEFAULTS, type SonioxCredentials } from '../../../src/providers/soniox/settings';
import type { OpenSocket } from '../../../src/providers/soniox/socket';
import { LegSpeech } from '../../../src/providers/soniox/speech';
import { SAMPLE_RATE, type AdapterEvents, type SessionContext, type StartRequest, type TextRange } from '../../../src/lib/contract/adapter';
import { createVirtualClock, realClock, type Clock } from '../../../src/lib/contract/clock';
import { eventsFrom } from '../../../src/lib/contract/events';
import type { LegName } from '../../../src/lib/conversation/types';
import { makeRir, makeRng } from '../../../src/lib/modern-audio/echoSim';
import type { SharedSettings } from '../../../src/lib/provider/types';
import type { SonioxRegion } from '../../../src/lib/soniox/regions';
import { AgentTextPlanner, type Condition } from './agentText';
import { activeDbfs, dbToGain, EchoTrack, micFrame, Track } from './audio';
import { FakeSoniox } from './fakeSoniox';
import { SimPlayer } from './player';
import { PAIRS, type BuiltScript } from './script';
import { score, type LogLine, type Summary } from './score';

export interface ProbeOptions {
  pair: string;
  condition: Condition;
  /** Mix the echo into the microphone; off: the clean baseline (playback still simulated). */
  echo: boolean;
  echoDelayMs: number;
  /** The echo's level relative to the voices, dB: applied as `echoGainDb + voiceDbfs − ttsDbfs` on the played audio. */
  echoGainDb: number;
  /** The human voices' active level, dBFS (every clip is brought to it). */
  voiceDbfs: number;
  /** The TTS's active level the echo gain assumes, dBFS; the summary's `levels` reports the measured one. */
  ttsDbfs: number;
  /** A sparse room response (`echoSim.makeRir`); null: none. */
  rir: { rt60: number; drrDb: number; seed: number } | null;
  leadMs: number;
  closeSegments: boolean;
  region: SonioxRegion;
  /** After the script: at least this long, then until the speech has been quiet `quietMs`, at most `tailMaxMs`. */
  tailMinMs: number;
  quietMs: number;
  tailMaxMs: number;
}

export const DEFAULTS: Omit<ProbeOptions, 'pair' | 'condition'> = {
  echo: true,
  echoDelayMs: 120,
  echoGainDb: -6,
  voiceDbfs: -20,
  ttsDbfs: -20,
  rir: null,
  leadMs: 700,
  closeSegments: true,
  region: 'jp',
  tailMinMs: 8000,
  quietMs: 5000,
  tailMaxMs: 60_000,
};

export interface ProbeEnv {
  /** The session clock every timer reads: the adapter's, the player's, the planner's. */
  clock: Clock;
  openSocket: OpenSocket;
  credentials: SonioxCredentials;
  /** Lets `ms` pass on the clock. */
  wait(ms: number): Promise<void>;
  /** Dry run only: tells the stand-in server what echo the microphone now holds. */
  onEcho?(pcm: Int16Array, fromMs: number, toMs: number): void;
  /** What the log must never hold (the key). */
  secrets?: readonly string[];
  label: 'live' | 'fake';
}

export interface ProbeResult {
  lines: string[];
  /** What the microphone captured: the voices plus the echo, before the mixer's 0.5 gain. */
  mic: Int16Array;
  /** What was played, both voices, on the microphone's timeline (no delay). */
  out: Int16Array;
  summary: Summary;
}

interface SpeechInternals {
  o: { leg: LegName };
  closed: boolean;
  on: boolean;
}

/**
 * Watches `LegSpeech.speak` / `endUtterance` (every instance) without
 * changing them: the `speak` condition's hook, after the same on/closed
 * filters. Returns the undo.
 */
export function observeSpeech(o: {
  speak(voice: LegName, ref: number, text: string, span: TextRange, language: string): void;
  endUtterance(voice: LegName): void;
}): () => void {
  const proto = LegSpeech.prototype as unknown as Record<'speak' | 'endUtterance', (...args: unknown[]) => void>;
  const speak = proto.speak;
  const endUtterance = proto.endUtterance;
  proto.speak = function (this: SpeechInternals, ...args: unknown[]) {
    const [ref, text, span, language] = args as [number, string, TextRange, string];
    if (!this.closed && this.on) o.speak(this.o.leg, ref, text, span, language);
    return speak.apply(this, args);
  };
  proto.endUtterance = function (this: SpeechInternals, ...args: unknown[]) {
    if (!this.closed && this.on) o.endUtterance(this.o.leg);
    return endUtterance.apply(this, args);
  };
  return () => {
    proto.speak = speak;
    proto.endUtterance = endUtterance;
  };
}

const round = (x: number) => Math.round(x * 10) / 10;

/** A token, compact: [text, final, status, language, start, end, speaker, source language]. */
const compact = (t: Record<string, unknown>) => [t.text, t.is_final ? 1 : 0, typeof t.translation_status === 'string' ? t.translation_status[0] : null, t.language ?? null, t.start_ms ?? null, t.end_ms ?? null, t.speaker ?? null, t.source_language ?? null];
const KNOWN_TOKEN_KEYS = new Set(['text', 'is_final', 'translation_status', 'language', 'source_language', 'speaker', 'start_ms', 'end_ms', 'confidence']);

export async function runProbe(o: ProbeOptions, script: BuiltScript, env: ProbeEnv): Promise<ProbeResult> {
  const pair = PAIRS[o.pair];
  if (!pair) throw new Error(`pair one of: ${Object.keys(PAIRS).join(', ')}`);
  if (script.rate !== SAMPLE_RATE) throw new Error(`the script must be at ${SAMPLE_RATE} Hz`);
  const rate = SAMPLE_RATE;
  const frameSamples = rate / 10;
  const clock = env.clock;
  const t0 = clock.now();
  const now = () => clock.now() - t0;
  const lines: string[] = [];
  const secrets = (env.secrets ?? []).filter((s) => s.length >= 6);
  const log = (kind: string, d?: unknown) => {
    let line = JSON.stringify({ t: round(now()), kind, ...(d === undefined ? {} : { d }) });
    for (const s of secrets) line = line.split(s).join('<key>');
    lines.push(line);
  };

  // The app's face-to-face: A is the speaker leg (a → b), B the participant (b → a); both speak.
  const shared: SharedSettings = {
    pauses: { sourceSeconds: 1, translationSeconds: 1 },
    reversed: (d) => d.source === pair.b,
    segmentation: { mode: 'off', sentencesPerRow: 0 },
    faceToFace: true,
    models: [],
  };
  const contexts: Record<LegName, SessionContext> = {
    speaker: { direction: { source: pair.a, target: pair.b }, speech: true, turns: 'auto' },
    participant: { direction: { source: pair.b, target: pair.a }, speech: true, turns: 'auto' },
  };
  const settings = { ...SONIOX_DEFAULTS, region: o.region };
  const configFor = (leg: LegName): SonioxConfig => {
    const c = buildSoniox(contexts[leg], settings, shared);
    return o.condition === 'none' ? c : { ...c, stt: { ...c.stt, enableAgentTextInput: true } };
  };
  const controller = new AbortController();
  const request = (leg: LegName): StartRequest<SonioxConfig, SonioxCredentials> => ({ context: contexts[leg], config: configFor(leg), credentials: env.credentials, clock, signal: controller.signal });

  const gain = dbToGain(o.echoGainDb + o.voiceDbfs - o.ttsDbfs);
  const echo = new EchoTrack({ rate, delayMs: o.echoDelayMs, gain, rir: o.rir ? makeRir(o.rir.rt60, makeRng(o.rir.seed), o.rir.drrDb) : null }, script.pcm.length + 90 * rate);
  const played = new Track(script.pcm.length + 90 * rate);
  const ttsClips: Int16Array[] = [];

  log('run', {
    probe: 'agent-text', env: env.label, pair: o.pair, languages: { A: pair.a, B: pair.b }, condition: o.condition,
    echo: { on: o.echo, delayMs: o.echoDelayMs, gainDb: o.echoGainDb, gainLinear: Math.round(gain * 1e4) / 1e4, rir: o.rir },
    voiceDbfs: o.voiceDbfs, ttsDbfs: o.ttsDbfs, leadMs: o.leadMs, closeSegments: o.closeSegments, region: o.region,
    tail: { minMs: o.tailMinMs, quietMs: o.quietMs, maxMs: o.tailMaxMs },
    configs: { speaker: configFor('speaker'), participant: configFor('participant') },
  });
  log('script', { pair: script.pair, durationMs: round(script.durationMs), turns: script.turns, sourceDbfs: script.sourceDbfs });

  // A holder, not a `let`: assigned in a callback, read after awaits.
  const live: { sessions: Record<LegName, SonioxSession> | null; startError: unknown } = { sessions: null, startError: null };
  let framesPushed = 0;
  let framesSent = 0;
  let clipped = 0;
  let tau0: number | null = null;
  let ending = false;
  let finished = false;
  let broken = false;
  let humanEndT: number | null = null;
  let lastAudioT = 0;
  const micFrames: Int16Array[] = [];
  const sttSockets: WebSocket[] = [];
  const tokenKeys = new Set<string>();

  /** The microphone's next 100-ms frame: voices plus echo, clipped; then into the speaker leg (face-to-face's one microphone). */
  const pushFrame = () => {
    const sessions = live.sessions;
    if (!sessions) return;
    const from = framesPushed * frameSamples;
    framesPushed += 1;
    const human = new Int16Array(frameSamples);
    if (from < script.pcm.length) human.set(script.pcm.subarray(from, Math.min(script.pcm.length, from + frameSamples)));
    const { frame, clipped: c } = micFrame(human, o.echo ? echo.track.read(from, frameSamples) : null);
    clipped += c;
    micFrames.push(frame);
    if (humanEndT === null && from + frameSamples >= script.pcm.length) humanEndT = now();
    sessions.speaker.appendAudio(frame);
  };

  const openSocket: OpenSocket = (url, protocols) => {
    const ws = env.openSocket(url, protocols);
    const isStt = url.includes('/transcribe-websocket');
    const send = ws.send.bind(ws);
    log('socket', { host: new URL(url).host, stt: isStt });
    if (isStt) {
      sttSockets.push(ws);
      ws.send = (data: Parameters<WebSocket['send']>[0]) => {
        if (typeof data === 'string') {
          if (data === '') log('stt.end', { pos: framesSent * 100 });
          else {
            const m = JSON.parse(data) as Record<string, unknown>;
            if (m.model !== undefined) log('stt.config', m);
            else if (m.type !== 'agent_text') log('stt.out', m);
          }
          send(data);
          return;
        }
        // No audio after the end of the stream.
        if (ending) return;
        send(data);
        framesSent += 1;
        if (tau0 === null) {
          tau0 = now() - 200;
          log('tau0', { tau0: round(tau0) });
        }
        pushFrame();
      };
      ws.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        const m = JSON.parse(ev.data) as Record<string, unknown> & { tokens?: Array<Record<string, unknown>> };
        if (m.error_code != null) { log('stt.error', { code: m.error_code, message: m.error_message, pos: framesSent * 100 }); return; }
        const { tokens = [], ...rest } = m;
        for (const t of tokens) for (const k of Object.keys(t)) if (!KNOWN_TOKEN_KEYS.has(k) && !tokenKeys.has(k)) { tokenKeys.add(k); log('stt.tokenKey', { key: k, token: t }); }
        if (m.finished) {
          // The final message may carry the last tokens too.
          if (tokens.length) log('stt.msg', { tokens: tokens.map(compact) });
          finished = true;
          log('stt.final', rest);
          return;
        }
        if (tokens.length || Object.keys(rest).length) log('stt.msg', { ...rest, ...(tokens.length ? { tokens: tokens.map(compact) } : {}) });
      });
    } else {
      ws.send = (data: Parameters<WebSocket['send']>[0]) => {
        if (typeof data === 'string') {
          const m = JSON.parse(data) as Record<string, unknown>;
          if (!m.keep_alive) log('tts.out', { stream: m.stream_id, text: m.text, end: m.text_end, ...(m.voice !== undefined ? { voice: m.voice, language: m.language } : {}) });
        }
        send(data);
      };
      ws.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        const m = JSON.parse(ev.data) as Record<string, unknown>;
        const samples = typeof m.audio === 'string' ? Math.floor((m.audio.length * 3) / 4 / 2) : 0;
        log('tts.in', { stream: m.stream_id, samples, terminated: m.terminated, ...(m.error_code != null ? { error: m.error_code, message: m.error_message } : {}) });
      });
    }
    return ws;
  };

  const planner = new AgentTextPlanner({
    condition: o.condition,
    leadMs: o.leadMs,
    closeSegments: o.closeSegments,
    clock,
    t0,
    send: (s) => {
      const sent = live.sessions !== null && !ending && live.sessions.speaker.agentText(s.text, s.end);
      log('agent', { ...s, sent, pos: framesSent * 100 });
    },
  });
  const player = new SimPlayer({
    clock,
    t0,
    onIdle: (voice) => {
      log('idle', { voice });
      planner.idle(voice);
    },
  });
  const restoreSpeech = observeSpeech({
    speak: (voice, ref, text, span, language) => {
      log('speak', { voice, ref, text, span, language });
      planner.speak(voice, ref, text, span);
    },
    endUtterance: (voice) => {
      log('endUtterance', { voice });
      planner.endUtterance(voice);
    },
  });

  // Per translation row: its text as last stated, and each audio entry's voice and play time.
  const rowText = new Map<number, string>();
  const entries = new Map<number, Array<{ voice: LegName; at: number }>>();
  const legEvents = (leg: LegName): AdapterEvents => eventsFrom((e) => {
    switch (e.kind) {
      case 'segmentOpened':
        log('seg', { leg, event: 'opened', ...e.payload });
        break;
      case 'segmentText':
        rowText.set(e.payload.ref, e.payload.text);
        log('seg', { leg, event: 'text', ...e.payload });
        break;
      case 'segmentClosed':
        log('seg', { leg, event: 'closed', ...e.payload });
        break;
      case 'audio': {
        const { pcm, ref, range } = e.payload;
        const voice = e.payload.voice ?? leg;
        if (ref === undefined) { log('audio.unattributed', { leg, voice, samples: pcm.length }); break; }
        const list = entries.get(ref) ?? [];
        entries.set(ref, list);
        const index = list.length;
        const window = player.enqueue(voice, `${leg}:${ref}:${index}`, pcm);
        if (!window) break;
        list.push({ voice, at: window.atMs });
        const micAt = window.atMs - (tau0 ?? now() - 200);
        const placed = o.echo
          ? echo.place(pcm, rate, micAt)
          : { fromMs: micAt + o.echoDelayMs, toMs: micAt + o.echoDelayMs + (pcm.length * 1000) / rate };
        played.add(pcm, Math.round((micAt * rate) / 1000));
        ttsClips.push(pcm);
        if (o.echo) env.onEcho?.(pcm, placed.fromMs, placed.toMs);
        lastAudioT = now();
        log('audio', { leg, voice, ref, index, ...(range ? { range } : {}), samples: pcm.length, at: round(window.atMs), micFrom: round(placed.fromMs), micTo: round(placed.toMs) });
        planner.enqueue(voice, ref, rowText.get(ref) ?? '', range, window.atMs);
        break;
      }
      case 'speechRanges': {
        log('ranges', { leg, ...e.payload });
        const list = entries.get(e.payload.ref) ?? [];
        for (const { index, range } of e.payload.ranges) {
          const entry = list[index];
          if (entry) planner.fillIn(entry.voice, e.payload.ref, rowText.get(e.payload.ref) ?? '', range, entry.at);
        }
        break;
      }
      case 'frame': {
        if (e.payload.type === 'tts.audio') break;
        log('frame', { leg, dir: e.payload.direction, type: e.payload.type, ...(e.payload.payload === undefined ? {} : { payload: e.payload.payload }) });
        break;
      }
      case 'loading':
      case 'busy':
        break;
      default: {
        const payload = 'payload' in e && e.payload && typeof e.payload === 'object'
          ? Object.fromEntries(Object.entries(e.payload).map(([k, v]) => [k, k === 'cause' ? String(v) : v]))
          : undefined;
        log('event', { leg, kind: e.kind, ...(payload ? { payload } : {}), ...(ending ? { afterEnd: true } : {}) });
        if (!ending && (e.kind === 'failed' || e.kind === 'closed')) broken = true;
      }
    }
  });

  void createSonioxAdapter({ openSocket })
    .startBoth({ speaker: request('speaker'), participant: request('participant') }, { speaker: legEvents('speaker'), participant: legEvents('participant') })
    .then((s) => { live.sessions = s; }, (error: unknown) => { live.startError = error ?? new Error('start failed'); });
  for (let waited = 0; !live.sessions && !live.startError; waited += 10) {
    if (waited > 40_000) { controller.abort(new Error('start timed out')); break; }
    await env.wait(10);
  }
  const sessions = live.sessions;
  if (!sessions) {
    restoreSpeech();
    planner.stop();
    player.stop();
    log('start.failed', { message: String(live.startError) });
    throw new Error(`the session did not start: ${String(live.startError)}`);
  }
  log('started', {});
  pushFrame();

  const done = () => {
    if (broken) return true;
    if (humanEndT === null) return false;
    const since = now() - humanEndT;
    if (since >= o.tailMaxMs) return true;
    return since >= o.tailMinMs && now() - lastAudioT >= o.quietMs && player.pending('speaker') === 0 && player.pending('participant') === 0;
  };
  while (!done()) await env.wait(100);

  // The end: no more agent text, the stream's end frame, its final message awaited (≤ 5 s), then the session's stop.
  planner.stop();
  ending = true;
  const stt = sttSockets[sttSockets.length - 1];
  if (stt && stt.readyState === 1) {
    stt.send('');
    for (let waited = 0; !finished && stt.readyState === 1 && waited < 5000; waited += 50) await env.wait(50);
  }
  log('planner', planner.stats);
  await sessions.speaker.stop();
  await env.wait(50);
  player.stop();
  restoreSpeech();

  const mic = new Int16Array(micFrames.length * frameSamples);
  micFrames.forEach((f, i) => mic.set(f, i * frameSamples));
  const human = activeDbfs(script.pcm, rate);
  const ttsAll = new Int16Array(ttsClips.reduce((n, c) => n + c.length, 0));
  ttsClips.reduce((off, c) => { ttsAll.set(c, off); return off + c.length; }, 0);
  const ttsActive = activeDbfs(ttsAll, rate);
  const echoActive = o.echo ? activeDbfs(echo.track.read(0, echo.track.length), rate) : -Infinity;
  const db = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
  log('levels', {
    humanActiveDbfs: db(human), ttsActiveDbfs: db(ttsActive), echoActiveDbfs: db(echoActive),
    echoToVoiceDb: o.echo ? db(echoActive - human) : null, clippedSamples: clipped,
  });
  log('end', { framesPushed, framesSent, sttSockets: sttSockets.length, finalMessage: finished, broken });
  const parsed = lines.map((l) => JSON.parse(l) as LogLine);
  return { lines, mic, out: played.toInt16().pcm, summary: score(parsed) };
}

/** The live environment: the real clock and sockets (a global `WebSocket`: Node ≥ 22). */
export function liveEnv(key: string, region: SonioxRegion): ProbeEnv {
  const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) throw new Error('no global WebSocket: run on Node ≥ 22 (or NODE_OPTIONS=--experimental-websocket on Node 20)');
  return {
    label: 'live',
    clock: realClock,
    openSocket: (url, protocols) => new WS(url, protocols),
    credentials: { region, stt: key, tts: key },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    secrets: [key],
  };
}

/** The dry run's environment: a virtual clock moved 10 ms at a time, and `FakeSoniox`. */
export function fakeEnv(script: BuiltScript, o: Pick<ProbeOptions, 'region' | 'ttsDbfs'>): { env: ProbeEnv; fake: FakeSoniox } {
  const clock = createVirtualClock(0);
  const fake = new FakeSoniox({ clock, humans: script.turns.map((t) => ({ fromMs: t.fromMs, toMs: t.toMs, lang: t.lang, text: t.text, side: t.side })), ttsDbfs: o.ttsDbfs });
  const yieldOnce = typeof setImmediate === 'function'
    ? () => new Promise<void>((resolve) => setImmediate(resolve))
    : () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    fake,
    env: {
      label: 'fake',
      clock,
      openSocket: fake.openSocket,
      credentials: { region: o.region, stt: 'fake-key', tts: 'fake-key' },
      wait: async (ms) => {
        for (let left = ms; left > 0; left -= 10) {
          clock.advance(Math.min(10, left));
          await yieldOnce();
        }
      },
      onEcho: (pcm, fromMs, toMs) => fake.placeEcho(pcm, fromMs, toMs),
    },
  };
}
