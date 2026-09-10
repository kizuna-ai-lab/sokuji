// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createPreviewTts, type NativeTtsClientLike } from './nativePreviewTts';
import type { NativeTtsResult, TtsReady } from './NativeTtsClient';

/**
 * A lightweight double of `NativeTtsClient` at the METHOD level (not the wire
 * level `NativeTtsClient.test.ts`'s `FakeSidecarConnection` operates at) --
 * `nativePreviewTts` only ever calls `init`/`setVoice`/`setReferenceVoice`/
 * `generate`/`dispose` on the client it is handed, so faking those five
 * methods is enough to pin its orchestration without a socket.
 *
 * Deviation from the brief's Step 1 snippet, noted in the task report: the
 * brief's fixture exposes `close()`; the real `NativeTtsClient` has no such
 * method, only `dispose()` (`SidecarConnection`'s client-driven teardown).
 * `close` was folded into `dispose` here so the fixture is a truthful double
 * of the class it stands in for.
 */
function fakeTtsClient(opts: { failFirstGenerateWith?: string; failEveryGenerateWith?: string } = {}): NativeTtsClientLike & {
  initCalls: number;
  closed: boolean;
} {
  let generateCalls = 0;
  const client = {
    initCalls: 0,
    closed: false,
    async init(): Promise<TtsReady> {
      client.initCalls++;
      return { sampleRate: 24000, loadTimeMs: 1, streaming: false, clones: false };
    },
    async setVoice(): Promise<void> {},
    async setReferenceVoice(): Promise<void> {},
    async generate(): Promise<NativeTtsResult> {
      generateCalls++;
      if (opts.failEveryGenerateWith) throw new Error(opts.failEveryGenerateWith);
      if (opts.failFirstGenerateWith && generateCalls === 1) throw new Error(opts.failFirstGenerateWith);
      return { samples: new Float32Array([0.25]), sampleRate: 24000, generationTimeMs: 3 };
    },
    dispose(): void {
      client.closed = true;
    },
  };
  return client;
}

describe('createPreviewTts', () => {
  it('initialises once and reuses the client for a second preview', async () => {
    // Catches: an implementation that calls init() on every synthesize()
    // regardless of whether the model already loaded -- which would defeat
    // the whole point (staying warm for record -> listen -> re-record ->
    // listen again) and make every preview pay the multi-second tts_init cost.
    const client = fakeTtsClient();
    const h = createPreviewTts(() => client);
    await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'alba' } });
    await h.synthesize({ modelId: 'm', language: 'ja', text: 'b', speed: 1, voice: { kind: 'name', name: 'alba' } });
    expect(client.initCalls).toBe(1);
  });

  it('re-initialises when the model changes', async () => {
    // Catches: an implementation that caches "already initialised" as a bare
    // boolean instead of tracking WHICH model id is loaded -- which would
    // keep serving the first model's engine after the user picks a second one.
    const client = fakeTtsClient();
    const h = createPreviewTts(() => client);
    await h.synthesize({ modelId: 'm1', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
    await h.synthesize({ modelId: 'm2', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
    expect(client.initCalls).toBe(2);
  });

  it('re-initialises when the language changes, even with the same model', async () => {
    // The sidecar stores `language` on the engine at init (`set_language`)
    // and every subsequent synth reuses it -- it is not decorative. Tracking
    // only `loadedModelId` would let a target-language change (translation
    // target ja -> en, same TTS card) silently keep synthesizing under the
    // OLD language's phonology. Catches: an implementation that gates re-init
    // on modelId alone.
    const client = fakeTtsClient();
    const h = createPreviewTts(() => client);
    await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
    await h.synthesize({ modelId: 'm', language: 'en', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
    expect(client.initCalls).toBe(2);
  });

  it('recovers from _not_owner_error by re-initialising once and retrying', async () => {
    // Right after a session ends the engine may still record the session's
    // (now closed) connection as owner. The panel cannot observe another
    // connection's ownership, so recovering is the only correct answer --
    // treating it as a failure would show an error for a preview that works
    // on the very next click.
    // Catches: an implementation that lets the first generate() rejection
    // propagate straight to the caller without attempting recovery at all.
    const client = fakeTtsClient({ failFirstGenerateWith: '_not_owner_error' });
    const h = createPreviewTts(() => client);
    const out = await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
    expect(client.initCalls).toBe(2);
    expect(out.audio.length).toBeGreaterThan(0);
  });

  it('does not retry a second _not_owner_error', async () => {
    // One recovery, not a loop: a persistent ownership conflict means
    // something else holds the engine and retrying forever would hang the
    // button.
    // Catches: an implementation that loops re-init+retry until success
    // (or forever) instead of surfacing the second failure.
    const client = fakeTtsClient({ failEveryGenerateWith: '_not_owner_error' });
    const h = createPreviewTts(() => client);
    await expect(h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } }))
      .rejects.toThrow(/_not_owner_error/);
    expect(client.initCalls).toBe(2);
  });

  it('close() closes the connection and the next synthesize starts a new one', async () => {
    // Catches: a close() that only drops the reference without calling
    // dispose() on the underlying client (leaking the sidecar connection), or
    // one that fails to reset loadedModelId so a later synthesize() on a
    // fresh client skips its required init().
    const clients = [fakeTtsClient(), fakeTtsClient()];
    let i = 0;
    const h = createPreviewTts(() => clients[i++]);
    await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
    h.close();
    expect(clients[0].closed).toBe(true);
    await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
    expect(clients[1].initCalls).toBe(1);
  });

  it('applies a named voice via setVoice and a clip voice via setReferenceVoice', async () => {
    // Catches: an implementation that ignores `voice.kind` and always calls
    // one of the two methods, which would silently preview the wrong voice.
    const client = fakeTtsClient();
    const setVoice = vi.spyOn(client, 'setVoice');
    const setReferenceVoice = vi.spyOn(client, 'setReferenceVoice');
    const h = createPreviewTts(() => client);

    await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'alba' } });
    expect(setVoice).toHaveBeenCalledWith('alba');
    expect(setReferenceVoice).not.toHaveBeenCalled();

    const audio = new Float32Array([0.1, 0.2]);
    await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'clip', audio, sampleRate: 16000, refText: 'hi' } });
    expect(setReferenceVoice).toHaveBeenCalledWith(audio, 16000, 'hi');
  });

  it('never touches init/setVoice/generate before synthesize() is called (no eager work at creation)', () => {
    // Catches: an implementation that eagerly constructs and initialises a
    // client from createPreviewTts() itself, spending the multi-second
    // tts_init cost before the panel has anything to preview.
    const make = vi.fn(() => fakeTtsClient());
    createPreviewTts(make);
    expect(make).not.toHaveBeenCalled();
  });

  it('passes text and speed through to generate() unmodified', async () => {
    // Catches: an implementation that drops or hardcodes speed (e.g. always
    // 1.0) instead of forwarding the caller's value.
    const client = fakeTtsClient();
    const generate = vi.spyOn(client, 'generate');
    const h = createPreviewTts(() => client);
    await h.synthesize({ modelId: 'm', language: 'ja', text: 'hello there', speed: 1.5, voice: { kind: 'name', name: 'x' } });
    expect(generate).toHaveBeenCalledWith('hello there', 1.5);
  });

  it('returns the samples and sample rate from generate() as audio/sampleRate', async () => {
    // Catches: an implementation that returns the raw NativeTtsResult shape
    // (samples/sampleRate/generationTimeMs) instead of the handle's own
    // {audio, sampleRate} contract.
    const client = fakeTtsClient();
    const h = createPreviewTts(() => client);
    const out = await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
    expect(out).toEqual({ audio: new Float32Array([0.25]), sampleRate: 24000 });
  });
});
