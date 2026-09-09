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
import { NativeTtsClient, type NativeTtsResult } from './NativeTtsClient';

/** The subset of `NativeTtsClient` this module drives. Narrowed from the
 *  concrete class (rather than depending on `NativeTtsClient` itself) so a
 *  test double can be a plain object -- `NativeTtsClient`'s private fields
 *  make it structurally unsatisfiable by anything but a real instance (or a
 *  cast), and a `Pick` of its public methods sidesteps that without weakening
 *  what production code actually passes (`new NativeTtsClient()` satisfies
 *  this type for free, being a strict superset). */
export type NativeTtsClientLike = Pick<NativeTtsClient, 'init' | 'setVoice' | 'setReferenceVoice' | 'generate' | 'dispose'>;

/** The voice to preview with: a built-in voice selected by name, or a cloned
 *  voice built from a reference clip -- mirrors `NativeTtsClient.setVoice` /
 *  `setReferenceVoice`. */
export type PreviewVoice =
  | { kind: 'name'; name: string }
  | { kind: 'clip'; audio: Float32Array; sampleRate: number; refText?: string };

export interface PreviewTtsHandle {
  /** Synthesize one sentence with the given voice, reusing the warm engine
   *  when `modelId` matches what is already loaded (re-`init`ing only when it
   *  changes). Rejects on failure -- including a persistent
   *  `_not_owner_error` after one recovery attempt -- rather than returning a
   *  sentinel; the caller decides the fallback. */
  synthesize(args: {
    modelId: string;
    language: string;
    text: string;
    speed: number;
    voice: PreviewVoice;
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

function toHandleResult(result: NativeTtsResult): { audio: Float32Array; sampleRate: number } {
  return { audio: result.samples, sampleRate: result.sampleRate };
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

  async function initFor(modelId: string, language: string): Promise<void> {
    const c = client!;
    // device/variant deliberately omitted -- see module doc / task brief:
    // the sidecar picks its own default, and a preview auditions the VOICE,
    // not the compute placement. Threading the session's pinned variant here
    // would make this panel depend on session state it does not otherwise
    // read, for a difference nobody can hear.
    await c.init(modelId, undefined, language);
    loadedModelId = modelId;
  }

  return {
    async synthesize({ modelId, language, text, speed, voice }) {
      if (!client) client = make();
      if (loadedModelId !== modelId) await initFor(modelId, language);
      await applyVoice(client, voice);

      try {
        return toHandleResult(await client.generate(text, speed));
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
        return toHandleResult(await client.generate(text, speed));
      }
    },

    close() {
      client?.dispose();
      client = null;
      loadedModelId = null;
    },
  };
}
