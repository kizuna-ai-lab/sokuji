import type { SonioxRegion } from '@shared/lib/soniox/regions';

/** A backend or Soniox answer other than success, with the backend's wait when it gave one. */
export class PreviewHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterMs?: number) {
    super(`preview ${status}`);
  }
}

/** Why a preview did not play, each with its own words on screen. */
export type PreviewFailure = 'balance' | 'busy' | 'capacity' | 'rate' | 'sign_in' | 'timeout' | 'failed';

export type PreviewState =
  | { status: 'idle' }
  | { status: 'requesting'; voice: string }
  | { status: 'playing'; voice: string }
  | { status: 'failed'; voice: string; reason: PreviewFailure };

export interface PreviewDeps {
  /** A single-use TTS key from the backend (`POST /soniox/session-key`, mode voice_preview). */
  mintKey(signal: AbortSignal): Promise<{ apiKey: string; region: SonioxRegion }>;
  /** `POST /soniox/preview-done`: bills the preview and frees the account for the next one or a session. */
  done(): Promise<void>;
  synthesize(o: { apiKey: string; region: SonioxRegion; voice: string; language: string; text: string; speed: number; signal: AbortSignal }): Promise<Int16Array>;
  /** Starts the clip; calls onEnded when it has played out; returns its stop. */
  play(pcm: Int16Array, onEnded: () => void): () => void;
  wait(ms: number): Promise<void>;
  onChange(state: PreviewState): void;
}

function reasonOf(err: unknown): PreviewFailure {
  if (err instanceof PreviewHttpError) {
    if (err.status === 402) return 'balance';
    if (err.status === 409) return 'busy';
    if (err.status === 503) return 'capacity';
    if (err.status === 429) return 'rate';
    if (err.status === 401) return 'sign_in';
    return 'failed';
  }
  return err instanceof Error && /timeout/i.test(err.message) ? 'timeout' : 'failed';
}

/**
 * Plays a voice saying a short sample, the desktop's managed preview on the
 * phone. One at a time: a new preview, or stop(), ends the one before. Each
 * key that was minted is followed by `done()`, whatever happens after, or the
 * account would stay held (up to about 45 s) and the next Start would wait.
 * A clip is kept for the app's life, by voice, language, speed and text, so
 * hearing it again costs nothing.
 */
export function createVoicePreview(deps: PreviewDeps) {
  const cache = new Map<string, Int16Array>();
  let state: PreviewState = { status: 'idle' };
  // The current preview's number: stop() and each new preview move it on, and
  // whatever an older one finishes with is dropped.
  let current = 0;
  let abort: AbortController | null = null;
  let stopClip: (() => void) | null = null;
  // The last request, its done() included: the backend holds one preview per
  // account, so a new one starts only once the one before has settled.
  let inflight: Promise<unknown> = Promise.resolve();

  const set = (next: PreviewState) => {
    state = next;
    deps.onChange(next);
  };

  function halt() {
    current += 1;
    abort?.abort();
    abort = null;
    stopClip?.();
    stopClip = null;
  }

  async function clip(voice: string, sample: { language: string; text: string }, speed: number, signal: AbortSignal): Promise<Int16Array> {
    let grant: { apiKey: string; region: SonioxRegion };
    try {
      grant = await deps.mintKey(signal);
    } catch (err) {
      // The account is briefly held (a preview just ended, or one is still settling): wait as told, once.
      if (!(err instanceof PreviewHttpError && err.status === 409 && err.retryAfterMs !== undefined)) throw err;
      await deps.wait(err.retryAfterMs);
      if (signal.aborted) throw new Error('aborted');
      grant = await deps.mintKey(signal);
    }
    try {
      if (signal.aborted) throw new Error('aborted');
      return await deps.synthesize({ ...grant, voice, language: sample.language, text: sample.text, speed, signal });
    } finally {
      await deps.done().catch(() => {});
    }
  }

  return {
    state: () => state,

    async play(voice: string, sample: { language: string; text: string }, speed: number): Promise<void> {
      halt();
      const mine = current;
      const key = [voice, sample.language, speed, sample.text].join('|');
      let pcm = cache.get(key);
      if (!pcm) {
        set({ status: 'requesting', voice });
        const controller = new AbortController();
        abort = controller;
        const previous = inflight;
        const fetching = (async () => {
          await previous;
          if (mine !== current) throw new Error('aborted');
          return clip(voice, sample, speed, controller.signal);
        })();
        inflight = fetching.catch(() => {});
        try {
          pcm = await fetching;
        } catch (err) {
          if (mine === current) set({ status: 'failed', voice, reason: reasonOf(err) });
          return;
        }
        if (mine !== current) return;
        cache.set(key, pcm);
        abort = null;
      }
      set({ status: 'playing', voice });
      try {
        stopClip = deps.play(pcm, () => {
          if (mine !== current) return;
          stopClip = null;
          set({ status: 'idle' });
        });
      } catch (err) {
        // The audio could not start (the audio session, a context): a failure, not a clip that never ends.
        console.warn(`preview play: ${err instanceof Error ? err.message : String(err)}`);
        if (mine === current) set({ status: 'failed', voice, reason: 'failed' });
      }
    },

    /** Stops what is playing or being fetched (leaving the screen, a session starting). */
    stop() {
      halt();
      if (state.status !== 'idle') set({ status: 'idle' });
    },
  };
}
