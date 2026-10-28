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
  /**
   * A single-use TTS key from the backend (`POST /soniox/session-key`, mode
   * voice_preview). Not cancellable on purpose: once sent, the backend may
   * have minted the key and holds the account until `done()`, so its answer
   * is waited for even when the user has stopped (Codex review, PR #665).
   */
  mintKey(): Promise<{ apiKey: string; region: SonioxRegion }>;
  /** `POST /soniox/preview-done`: bills the preview and frees the account for the next one or a session. Rejects when it did not settle. */
  done(): Promise<void>;
  synthesize(o: { apiKey: string; region: SonioxRegion; voice: string; language: string; text: string; speed: number; signal: AbortSignal }): Promise<Int16Array>;
  /** Starts the clip; calls onEnded when it has played out; returns its stop. */
  play(pcm: Int16Array, onEnded: () => void): () => void;
  /** Resolves after `ms`, or at once when `signal` aborts. */
  wait(ms: number, signal: AbortSignal): Promise<void>;
  onChange(state: PreviewState): void;
  /** For testers counting requests: a miss before the request, then what came of it; or a cache hit. */
  log?(line: string): void;
}

/** A stop, not a failure: what this module (and previewNative) throws once the user has moved on. */
const isStop = (err: unknown) => err instanceof Error && err.message === 'aborted';

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
 * What every preview controller shares for the app's life. Each Listen screen
 * makes its own controller, so both live here, not in one:
 * - `cache`: the clips already paid for (owner, 2026-10-28: the same voice,
 *   language, speed and text is charged once while the app is open);
 * - `inflight`: the last request, its done() included. The backend holds one
 *   preview per account, so a preview on a screen opened again waits for a
 *   request the last screen left in flight (Adolf).
 */
export interface PreviewShared {
  cache: Map<string, Int16Array>;
  inflight: Promise<unknown>;
  /** The last preview-done failed: the account may still be held, so it is tried again before the next key. */
  unsettled: boolean;
}

export const newPreviewShared = (): PreviewShared => ({ cache: new Map(), inflight: Promise.resolve(), unsettled: false });

const appShared = newPreviewShared();

/**
 * Plays a voice saying a short sample, the desktop's managed preview on the
 * phone. One at a time: a new preview, or stop(), ends the one before. Each
 * key that was minted is followed by `done()`, whatever happens after, or the
 * account would stay held (up to about 45 s) and the next Start would wait.
 * A clip is kept for the app's life, by voice, language, speed and text, so
 * hearing it again costs nothing. `shared` is the app's by default.
 */
export function createVoicePreview(deps: PreviewDeps, shared: PreviewShared = appShared) {
  const { cache } = shared;
  let state: PreviewState = { status: 'idle' };
  // The current preview's number: stop() and each new preview move it on, and
  // whatever an older one finishes with is dropped.
  let current = 0;
  let abort: AbortController | null = null;
  let stopClip: (() => void) | null = null;

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

  // preview-done, remembering a failure: the account may then still be held, and the
  // next preview settles it first rather than asking for a key and meeting "busy".
  async function settle(): Promise<void> {
    try {
      await deps.done();
      shared.unsettled = false;
    } catch {
      shared.unsettled = true;
    }
  }

  async function mint(signal: AbortSignal): Promise<{ apiKey: string; region: SonioxRegion }> {
    if (shared.unsettled) await settle();
    try {
      return await deps.mintKey();
    } catch (err) {
      // The account is briefly held (a preview just ended, or one is still settling): wait as told, once.
      if (!(err instanceof PreviewHttpError && err.status === 409 && err.retryAfterMs !== undefined)) throw err;
      await deps.wait(err.retryAfterMs, signal);
      if (signal.aborted) throw new Error('aborted');
      return deps.mintKey();
    }
  }

  async function clip(voice: string, sample: { language: string; text: string }, speed: number, signal: AbortSignal): Promise<Int16Array> {
    let grant: { apiKey: string; region: SonioxRegion };
    try {
      grant = await mint(signal);
    } catch (err) {
      // A refusal (an HTTP answer) minted nothing. Anything else — no answer in time, a
      // dropped connection — may have minted a key the backend now holds: settle it
      // (preview-done answers 404 when there was nothing).
      if (!(err instanceof PreviewHttpError) && !isStop(err)) {
        await settle();
      }
      throw err;
    }
    try {
      if (signal.aborted) throw new Error('aborted');
      return await deps.synthesize({ ...grant, voice, language: sample.language, text: sample.text, speed, signal });
    } finally {
      await settle();
    }
  }

  return {
    state: () => state,

    async play(voice: string, sample: { language: string; text: string }, speed: number): Promise<void> {
      halt();
      const mine = current;
      const key = [voice, sample.language, speed, sample.text].join('|');
      let pcm = cache.get(key);
      const tag = `preview ${voice} ${sample.language} ${speed}`;
      // A miss is not a charge: the request can still be refused. "received" is the paid one.
      deps.log?.(`${tag}: ${pcm ? 'from cache' : 'not cached, requesting'}`);
      if (!pcm) {
        set({ status: 'requesting', voice });
        const controller = new AbortController();
        abort = controller;
        const previous = shared.inflight;
        const fetching = (async () => {
          await previous;
          // The request ahead may have paid for this very clip (Adolf: leave while it
          // settles, come back, preview the same voice): checked again after the wait.
          const ahead = cache.get(key);
          if (ahead) return { clip: ahead, fresh: false };
          if (mine !== current) throw new Error('aborted');
          const fresh = await clip(voice, sample, speed, controller.signal);
          // Kept before the queue moves on, and even if the user moved on meanwhile: it was paid.
          cache.set(key, fresh);
          return { clip: fresh, fresh: true };
        })();
        shared.inflight = fetching.catch(() => {});
        try {
          const got = await fetching;
          pcm = got.clip;
          deps.log?.(`${tag}: ${got.fresh ? 'received' : 'from cache (after waiting)'}`);
        } catch (err) {
          deps.log?.(`${tag}: ${isStop(err) ? 'stopped' : `failed (${reasonOf(err)})`}`);
          if (mine === current) set({ status: 'failed', voice, reason: reasonOf(err) });
          return;
        }
        if (mine !== current) return;
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
