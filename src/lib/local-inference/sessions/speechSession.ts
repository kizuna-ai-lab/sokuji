/**
 * One session of the local provider's voice as a unit that only speaks:
 * Edge, or a speech model on this machine, behind the speech contract. It is
 * handed stretches of a row's translation and reads them one at a time, in
 * the order they came, a clip per sentence (`speakTranslation`), each clip
 * with the characters it speaks counted in the row's whole translation.
 * Which text is read, by which leg's voice, and where the audio goes are the
 * caller's.
 *
 * The voice never ends the session it serves: an engine that does not load,
 * or dies later, is said once (`tts_degraded`) and nothing more is read.
 */
import type { Ref, TextRange } from '../../contract/adapter';
import { framePayload } from '../../contract/framePayload';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from '../../contract/speech';
import type { LegName } from '../../conversation/types';
import { describeCause } from '../../diagnostics/describeCause';
import type { TtsLike } from './engines';
import { speakTranslation, type LocalTtsConfig, type TtsUnavailableCode, ttsLoadFailed, ttsMissing, ttsStopped, voiceFallback } from './speech';

/**
 * The config of a leg that has no voice to start, which names no speech model; with `unavailable`, the leg should
 * speak and no speech model speaks its target (#619), said once when the session opens.
 */
export interface LocalSpeechOff { off: true; unavailable?: TtsUnavailableCode }

/** The unit's config: the leg's voice, or `LocalSpeechOff` for a leg built silent. */
export type LocalSpeechConfig = LocalTtsConfig | LocalSpeechOff;

export const isOff = (config: LocalSpeechConfig): config is LocalSpeechOff => 'off' in config;

/** One stretch of a row's translation waiting to be read. */
interface Job { ref: Ref; text: string; span: TextRange; language: string; home?: LegName }

/** A leg with no voice: what it lacks is said once when it opens, and nothing else ever happens. */
function silentSession(request: SpeechStartRequest<LocalSpeechConfig, unknown>, unavailable: TtsUnavailableCode | undefined, events: SpeechEvents): SpeechSession {
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

/**
 * Starts the voice over one engine from `makeTts`, which lives as long as the session. `open()` loads the model.
 * Text handed over before the model has loaded waits for it.
 */
export function startLocalSpeech(makeTts: () => TtsLike, request: SpeechStartRequest<LocalSpeechConfig, unknown>, events: SpeechEvents): SpeechSession {
  const { config, clock, counts } = request;
  if (isOff(config)) return silentSession(request, config.unavailable, events);

  const tts = makeTts();
  let opening: Promise<void> | null = null;
  let loaded = false;
  let on = true;
  let closed = false;
  /** The engine did not load, or died: said once, and nothing more is read. */
  let gone = false;
  let disposed = false;
  /** Moves each time speech is switched off: what was being read before the switch is not heard after it. */
  let epoch = 0;
  let queue: Job[] = [];
  let reading = false;
  /** Settles when the session closes or its engine is gone: nothing guarantees an engine settles what it was synthesizing. */
  let settleOver: () => void = () => {};
  const over = new Promise<void>((resolve) => { settleOver = resolve; });

  const frame = (direction: 'in' | 'out', type: string, payload: Record<string, unknown>) => {
    events.frame({ direction, type, payload: framePayload(payload) });
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
    const mine = epoch;
    // Checked before every sentence and again when one settles: a clip that arrives after the switch is dropped.
    const stale = () => closed || gone || epoch !== mine;
    const spoken = speakTranslation(
      tts,
      text,
      language,
      config,
      {
        audio: (pcm, range) => {
          if (stale()) return;
          // The entry is counted before it is said: its place among the row's audio is the count before it.
          counts.set(ref, (counts.get(ref) ?? 0) + 1);
          // A sentence's range is counted in the stretch; the row's whole translation starts `span[0]` earlier.
          events.audio({ pcm, ref, ...(range ? { range: [range[0] + span[0], range[1] + span[0]] as TextRange } : {}), ...(home ? { home } : {}) });
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

  /**
   * One stretch at a time, in order. A stretch dropped by the switch is still waited for: the engine takes one
   * request at a time, so the next stretch starts only when the sentence being synthesized has settled.
   */
  const drain = async (): Promise<void> => {
    if (reading || !loaded) return;
    reading = true;
    try {
      while (queue.length > 0 && !closed && !gone) {
        try {
          await read(queue.shift()!);
        } catch (error) {
          // A listener that throws, or a splitter that does: this stretch is left out and the next is read.
          if (!closed && !gone) frame('in', 'local.tts.error', { error: describeCause(error) });
        }
      }
    } finally {
      reading = false;
    }
  };

  const open = async (): Promise<void> => {
    frame('out', 'local.init.tts.start', { model: config.modelId });
    const startedAt = clock.now();
    let ready: Awaited<ReturnType<TtsLike['init']>>;
    try {
      ready = await tts.init(config.modelId);
    } catch (error) {
      if (closed) return;
      const message = describeCause(error);
      frame('out', 'local.init.tts.error', { model: config.modelId, error: message });
      lost(ttsLoadFailed(message), error);
      return;
    }
    // Closed while the model loaded: the engine is already let go.
    if (closed) return;
    frame('out', 'local.init.tts.ready', { model: config.modelId, initDurationMs: clock.now() - startedAt });
    tts.onFatal = (error) => lost(ttsStopped(error));
    // The worker substitutes its default voice at generate time, so speech still works.
    const { voices } = ready;
    if (voices && voices.length > 0 && !voices.some((v) => v.sid === config.speakerId)) {
      events.degraded({ code: 'voice_fallback', message: voiceFallback(config.speakerId) });
    }
    loaded = true;
    void drain();
  };

  return {
    // Never rejects: whatever goes wrong while the voice opens is speech lost, said as such.
    open: () => (opening ??= open().catch((error: unknown) => lost(ttsLoadFailed(describeCause(error)), error))),
    speak(ref, text, span, language, home) {
      if (closed || gone || !on) return;
      queue.push({ ref, text, span, language, ...(home ? { home } : {}) });
      void drain();
    },
    // A row's stretches are read as they come and nothing is held back for its end: what is still queued for the row is read.
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
