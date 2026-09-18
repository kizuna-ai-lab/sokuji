/**
 * Local Native's half of the custom-voice preview: synthesize one sentence
 * through the Electron sidecar's local TTS engine, on a connection this
 * module owns end to end.
 *
 * Deliberately its OWN `NativeTtsClient` / sidecar connection, never
 * `nativeModelStore`'s module-level client. That singleton is the long-lived
 * model-management channel (downloads, catalog probing, the session's own
 * engine); re-purposing or closing it here would break model management for
 * an unrelated feature. `NativeTtsClient`'s constructor already defaults to a
 * fresh `SidecarConnection()`, so `new NativeTtsClient()` IS the dedicated
 * connection this task needs -- see `NativeTtsProto.tsx` for the existing
 * precedent of a component owning one.
 *
 * No diagnostics reporting here (`reportWarning`/`reportError`). A rejection
 * from `synthesize()` is either the recovered-once `_not_owner_error` case
 * (silently retried -- never surfaced) or a genuine failure the CALLER must
 * decide how to react to: Task 7's panel falls back to replaying the
 * reference clip on any rejection, which is itself the user-facing story --
 * reporting a warning here as well would describe a failure the user never
 * sees as one.
 */
import { NativeTtsClient } from './NativeTtsClient';

/** The subset of `NativeTtsClient` this module drives. Narrowed from the
 *  concrete class (rather than depending on `NativeTtsClient` itself) so a
 *  test double can be a plain object -- `NativeTtsClient`'s private fields
 *  make it structurally unsatisfiable by anything but a real instance (or a
 *  cast), and a `Pick` of its public methods sidesteps that without weakening
 *  what production code actually passes (`new NativeTtsClient()` satisfies
 *  this type for free, being a strict superset). */
export type NativeTtsClientLike = Pick<NativeTtsClient, 'init' | 'setVoice' | 'setReferenceVoice' | 'generate' | 'cancel' | 'dispose'>;

/** The voice to preview with: a built-in voice selected by name, or a cloned
 *  voice built from a reference clip -- mirrors `NativeTtsClient.setVoice` /
 *  `setReferenceVoice`. */
export type PreviewVoice =
  | { kind: 'name'; name: string }
  | { kind: 'clip'; audio: Float32Array; sampleRate: number; refText?: string };

export interface PreviewTtsHandle {
  /** Synthesize one sentence with the given voice, reusing the warm engine
   *  when both `modelId` AND `language` match what is already loaded
   *  (re-`init`ing when either changes). `language` is not decorative: the
   *  sidecar stores it on the engine at init (`set_language`) and every
   *  subsequent synth reuses it, so a stale language would silently
   *  mispronounce the next preview's sentence under the OLD language's
   *  phonology. Rejects on failure -- including a persistent
   *  `_not_owner_error` after one recovery attempt -- rather than returning a
   *  sentinel; the caller decides the fallback. */
  synthesize(args: {
    modelId: string;
    language: string;
    text: string;
    speed: number;
    voice: PreviewVoice;
    /** Abort from the caller (a newer preview superseded this one, the
     *  popover closed, the component unmounted). Used to tell the SIDECAR to
     *  stop, not merely to discard the result: without it the abandoned
     *  synthesis ran to completion and every later preview queued behind it,
     *  for up to the request budget. Partial by design — `tts_cancel` stops
     *  STREAMING generation, so this shortens the wait for a streaming family
     *  and is inert for a one-shot one, whose cancellation needs a sidecar
     *  contract change (PR #542 review). */
    signal?: AbortSignal;
  }): Promise<{ audio: Float32Array; sampleRate: number }>;
  /** Tear down the dedicated connection and drop the client. The GB-scale
   *  resident model is released sidecar-side; the next `synthesize()` opens a
   *  fresh connection and re-`init`s. */
  close(): void;
}

/** A rejection means "this connection is not the sidecar's recorded owner of
 *  the TTS engine" -- see the module doc and the task brief for why that is
 *  recoverable exactly once rather than a hard failure. */
function isNotOwnerError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('_not_owner_error');
}

async function applyVoice(client: NativeTtsClientLike, voice: PreviewVoice): Promise<void> {
  if (voice.kind === 'name') await client.setVoice(voice.name);
  else await client.setReferenceVoice(voice.audio, voice.sampleRate, voice.refText);
}

/**
 * One synthesis, whichever protocol the loaded family speaks.
 *
 * `onChunk` is passed ALWAYS, never conditionally on a streaming flag, and
 * that is the whole fix for the bug this function exists to prevent: the
 * SIDECAR decides the protocol, from the loaded engine's own `streaming`
 * alone (`tts_engine.py`), and for a streaming family it emits chunks and
 * never sends a `tts_generate_result`. A caller that omitted `onChunk` had
 * its one-shot request resolved by the first `tts_chunk` instead — and a
 * chunk message carries no `sampleRate`, so the preview came back
 * "successful" with one chunk of audio at rate `undefined`. `createBuffer`
 * then threw on the NaN rate and the picker's catch swallowed it: supertonic
 * presets previewed as silence while supertonic SESSIONS were fine, because
 * the session path reads the flag and passes `onChunk` (reported
 * 2026-09-18).
 *
 * Passing it unconditionally is safe for a non-streaming family: the client's
 * own `this.streaming && onChunk` guard keeps that on the one-shot path,
 * which returns the whole buffer and never calls back.
 */
async function synthesizeOnce(
  client: NativeTtsClientLike, text: string, speed: number, signal?: AbortSignal,
): Promise<{ audio: Float32Array; sampleRate: number }> {
  const chunks: Float32Array[] = [];
  // Already abandoned before any work started — `synthesize` awaits `init`
  // and `applyVoice` first, so an abort can easily land before this point.
  // Starting the synthesis just to cancel it would spend the sidecar's time
  // for a result nobody will read. Both callers map an aborted signal to
  // null, so throwing here is the quiet path, not an error path.
  if (signal?.aborted) throw new DOMException('Preview aborted', 'AbortError');
  // Abandoning the RESULT is not abandoning the WORK: the sidecar keeps
  // synthesising, and the next request queues behind it. Ask it to stop.
  const onAbort = () => { client.cancel(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await collect(client, chunks, text, speed);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

async function collect(
  client: NativeTtsClientLike, chunks: Float32Array[], text: string, speed: number,
): Promise<{ audio: Float32Array; sampleRate: number }> {
  const result = await client.generate(text, speed, (pcm) => { chunks.push(pcm); });
  // The streaming branch hands every sample to `onChunk` and returns an EMPTY
  // `samples` carrying the engine's rate; the one-shot branch returns the
  // whole buffer. Preferring the accumulated chunks whenever there are any
  // covers both without this module having to know which one ran.
  if (chunks.length === 0) return { audio: result.samples, sampleRate: result.sampleRate };
  let total = 0;
  for (const c of chunks) total += c.length;
  const audio = new Float32Array(total);
  let at = 0;
  for (const c of chunks) { audio.set(c, at); at += c.length; }
  return { audio, sampleRate: result.sampleRate };
}

/**
 * @param make Factory for the underlying client, called lazily on the first
 *   `synthesize()` (never at creation -- constructing eagerly would pay the
 *   sidecar connection and, indirectly via the first `init()`, the multi-
 *   second load cost before the panel has anything to preview). Defaults to
 *   a real `NativeTtsClient` on its own connection; overridable for tests.
 */
export function createPreviewTts(make: () => NativeTtsClientLike = () => new NativeTtsClient()): PreviewTtsHandle {
  let client: NativeTtsClientLike | null = null;
  let loadedModelId: string | null = null;
  // Second half of the "what is this engine initialised for" key -- see
  // PreviewTtsHandle.synthesize's doc comment. Read alongside loadedModelId,
  // never alone: a model-only check would keep serving an engine initialised
  // for a language the caller no longer wants.
  let loadedLanguage: string | null = null;

  async function initFor(modelId: string, language: string): Promise<void> {
    const c = client!;
    // device/variant deliberately omitted -- see module doc / task brief:
    // the sidecar picks its own default, and a preview auditions the VOICE,
    // not the compute placement. Threading the session's pinned variant here
    // would make this panel depend on session state it does not otherwise
    // read, for a difference nobody can hear.
    await c.init(modelId, undefined, language);
    loadedModelId = modelId;
    loadedLanguage = language;
  }

  return {
    async synthesize({ modelId, language, text, speed, voice, signal }) {
      if (!client) client = make();
      if (loadedModelId !== modelId || loadedLanguage !== language) await initFor(modelId, language);
      await applyVoice(client, voice);

      try {
        return await synthesizeOnce(client, text, speed, signal);
      } catch (err) {
        if (!isNotOwnerError(err)) throw err;
        // Recover exactly once: the sidecar may still record a just-closed
        // session's connection as owner. Re-init, reapply the voice (a fresh
        // init has no voice selected), and retry once -- a second failure
        // (including a second _not_owner_error) propagates: a persistent
        // conflict means something else genuinely holds the engine, and
        // looping would hang the caller instead of surfacing that.
        await initFor(modelId, language);
        await applyVoice(client, voice);
        return await synthesizeOnce(client, text, speed, signal);
      }
    },

    close() {
      client?.dispose();
      client = null;
      loadedModelId = null;
      loadedLanguage = null;
    },
  };
}
