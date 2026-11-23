/**
 * One session of Local Native's voice as a unit that only speaks: the sidecar's TTS socket behind the speech contract.
 * It is handed stretches of a row's translation and reads them one at a time, in the order they came, sentence by
 * sentence (`speakNative`), each entry counted in the row's shared count and ranged in the row's whole translation
 * (#578 ruling 24). Which text is read, by which leg's voice, and where the audio goes are the caller's.
 *
 * The voice never ends the session it serves: a voice that does not load, a clone-only model with no clip, or a socket
 * that goes away is said once (`tts_degraded`) and nothing more is read (#578 ruling 10). It loads one language, the
 * leg's target: a stretch in another is not read.
 */
import type { Ref, TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from '../../lib/contract/speech';
import type { LegName } from '../../lib/conversation/types';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { NativeHost } from '../../lib/local-inference/native/nativeModels';
import { ttsMissing, type TtsUnavailableCode } from '../../lib/local-inference/sessions/speech';
import type { LocalNativeConfig } from './config';
import type { NativeTtsLike, NativeTtsReady } from './engines';
import { speakNative } from './speech';
import { applyVoice, voiceClipMissing } from './voice';

/** The leg's voice: the whole session's TTS config, with the host its session asks. */
export type NativeVoiceConfig = NonNullable<LocalNativeConfig['tts']> & { host: NativeHost };
/** A leg built silent; with `unavailable`, the leg should speak and no voice speaks its target, said once when it opens. */
export interface NativeSpeechOff { off: true; unavailable?: TtsUnavailableCode }
export type NativeSpeechConfig = NativeVoiceConfig | NativeSpeechOff;

const isOff = (config: NativeSpeechConfig): config is NativeSpeechOff => 'off' in config;

/** One stretch of a row's translation waiting to be read. */
interface Job { ref: Ref; text: string; span: TextRange; language: string; home?: LegName }

const shift = (range: TextRange, by: number): TextRange => [range[0] + by, range[1] + by];

/** A leg with no voice: what it lacks is said once when it opens, and nothing else ever happens. */
function silentSession(request: SpeechStartRequest<NativeSpeechConfig, unknown>, unavailable: TtsUnavailableCode | undefined, events: SpeechEvents): SpeechSession {
  let said = false;
  let closed = false;
  return {
    open: async () => {
      if (said || closed || !unavailable) return;
      said = true;
      const { target } = request.context.direction;
      events.degraded({ code: unavailable, message: ttsMissing(unavailable, target), params: { target } });
    },
    speak() {},
    endUtterance() {},
    setOn() {},
    close() { closed = true; },
  };
}

/** Starts the voice over one socket from `makeTts`, made on the request's clock (#578 ruling 23). Text handed over before the voice has loaded waits for it. */
export function startNativeSpeech(
  makeTts: (clock: Clock) => NativeTtsLike,
  request: SpeechStartRequest<NativeSpeechConfig, unknown>,
  events: SpeechEvents,
): SpeechSession {
  const { config, clock, counts } = request;
  if (isOff(config)) return silentSession(request, config.unavailable, events);
  const { target } = request.context.direction;
  const tts = makeTts(clock);
  let opening: Promise<void> | null = null;
  let ready: NativeTtsReady | null = null;
  let voiceLabel = config.voice;
  let on = true;
  let closed = false;
  /** The voice did not load, or its socket went away: said once, and nothing more is read. */
  let gone = false;
  let disposed = false;
  /** Moves each time speech is switched off: what was being read before the switch is not heard after it. */
  let epoch = 0;
  let queue: Job[] = [];
  let reading = false;
  /** Settles when the session closes or its voice is gone: nothing guarantees the sidecar settles what it was synthesizing. */
  let settleOver: () => void = () => {};
  const over = new Promise<void>((resolve) => { settleOver = resolve; });

  const frame = (direction: 'in' | 'out', type: string, payload: Record<string, unknown>) => {
    events.frame({ direction, type, payload: framePayload(payload) as Record<string, unknown> });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    tts.dispose();
  };
  const lost = (message: string, cause?: unknown) => {
    if (closed || gone) return;
    gone = true;
    queue = [];
    settleOver();
    dispose();
    events.degraded({ code: 'tts_degraded', message, ...(cause === undefined ? {} : { cause }) });
  };

  /** Reads one stretch. Resolves when its last sentence has settled, or at once when the session is over. */
  const read = async ({ ref, text, span, language, home }: Job): Promise<void> => {
    if (language !== target) {
      frame('out', 'local.native.tts.skipped', { language, target, reason: 'The voice loads one language: the leg\'s target.' });
      return;
    }
    const mine = epoch;
    const stale = () => closed || gone || epoch !== mine;
    const spoken = speakNative(
      tts,
      text,
      language,
      { modelId: config.modelId, voice: voiceLabel, speed: config.speed, streaming: ready?.streaming ?? false },
      {
        audio: (pcm, range) => {
          // The entry is counted before it is said: its place among the row's audio is the count before it.
          const index = counts.get(ref) ?? 0;
          if (stale()) return index;
          counts.set(ref, index + 1);
          events.audio({ pcm, ref, ...(range ? { range: shift(range, span[0]) } : {}), ...(home ? { home } : {}) });
          return index;
        },
        ranges: (entries) => {
          if (!stale()) events.speechRanges({ ref, ranges: entries.map((e) => ({ index: e.index, range: shift(e.range, span[0]) })), ...(home ? { home } : {}) });
        },
        degraded: (message, cause) => {
          if (!stale()) events.degraded({ code: 'tts_degraded', message, ...(cause === undefined ? {} : { cause }) });
        },
        frame: (direction, type, payload) => { if (!stale()) frame(direction, type, payload); },
      },
      stale,
      clock,
    );
    // A failure after the session is over is nobody's news.
    spoken.catch(() => {});
    await Promise.race([spoken, over]);
  };

  /** One stretch at a time, in order: the sidecar takes one synthesis at a time. */
  const drain = async (): Promise<void> => {
    if (reading || !ready) return;
    reading = true;
    try {
      while (queue.length > 0 && !closed && !gone) {
        try {
          await read(queue.shift()!);
        } catch (error) {
          if (!closed && !gone) frame('in', 'local.native.tts.error', { error: describeCause(error) });
        }
      }
    } finally {
      reading = false;
    }
  };

  const open = async (): Promise<void> => {
    if (await voiceClipMissing(config, config.host)) {
      if (closed) return;
      lost(`TTS unavailable, continuing without it: "${config.modelId}" needs a voice clip — record or import one in Settings first`);
      return;
    }
    if (closed) return;
    frame('out', 'local.native.init.tts.start', { model: config.modelId, device: config.device });
    const startedAt = clock.now();
    let loaded: NativeTtsReady;
    try {
      loaded = await tts.init({ modelId: config.modelId, device: config.device, language: target, variant: config.variant });
    } catch (error) {
      if (closed) return;
      const message = describeCause(error);
      frame('in', 'local.native.init.tts.error', { model: config.modelId, error: message });
      lost(`TTS unavailable, continuing without it: ${message}`, error);
      return;
    }
    if (closed) return;
    frame('in', 'local.native.init.tts.ready', { model: config.modelId, loadTimeMs: loaded.loadTimeMs ?? clock.now() - startedAt, device: loaded.device });
    config.host.plan('tts', { ...loaded, model: config.modelId, device: loaded.device ?? 'cpu' });
    const applied = await applyVoice(tts, config, target, loaded, config.host);
    if (closed) return;
    voiceLabel = applied.voice;
    if (applied.substituted) {
      events.degraded({
        code: 'voice_fallback',
        message: `Configured voice ${applied.substituted.from} is no longer usable with this model (deleted, or missing a required transcript); substituted voice ${applied.substituted.to}. Update the selection in settings.`,
      });
    }
    tts.onError = (message) => { if (!closed && !gone) events.degraded({ code: 'tts_degraded', message }); };
    tts.onClosed = (message) => lost(`Speech synthesis stopped: ${message}`);
    ready = loaded;
    void drain();
  };

  return {
    // Never rejects: whatever goes wrong while the voice opens is speech lost, said as such.
    open: () => (opening ??= open().catch((error: unknown) => lost(`TTS unavailable, continuing without it: ${describeCause(error)}`, error))),
    speak(ref, text, span, language, home) {
      if (closed || gone || !on) return;
      queue.push({ ref, text, span, language, ...(home ? { home } : {}) });
      void drain();
    },
    // A row's stretches are read as they come and nothing is held back for its end.
    endUtterance() {},
    setOn(next) {
      on = next;
      if (next) return;
      queue = [];
      epoch++;
    },
    close() {
      if (closed) return;
      closed = true;
      queue = [];
      settleOver();
      dispose();
    },
  };
}
