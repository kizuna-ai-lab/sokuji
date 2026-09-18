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
  cancels: number;
} {
  let generateCalls = 0;
  const client = {
    initCalls: 0,
    closed: false,
    cancels: 0,
    cancel(): void { client.cancels++; },
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

  it('recovers from _not_owner_error by re-initialising once and retrying, reapplying the voice', async () => {
    // Right after a session ends the engine may still record the session's
    // (now closed) connection as owner. The panel cannot observe another
    // connection's ownership, so recovering is the only correct answer --
    // treating it as a failure would show an error for a preview that works
    // on the very next click.
    // Catches: an implementation that lets the first generate() rejection
    // propagate straight to the caller without attempting recovery at all.
    const client = fakeTtsClient({ failFirstGenerateWith: '_not_owner_error' });
    const setReferenceVoice = vi.spyOn(client, 'setReferenceVoice');
    const h = createPreviewTts(() => client);
    const audio = new Float32Array([0.1, 0.2]);
    const out = await h.synthesize({
      modelId: 'm', language: 'ja', text: 'a', speed: 1,
      voice: { kind: 'clip', audio, sampleRate: 16000, refText: 'hi' },
    });
    expect(client.initCalls).toBe(2);
    expect(out.audio.length).toBeGreaterThan(0);
    // A fresh init() has no voice selected -- an implementation that re-inits
    // on recovery but forgets to reapply the voice would still pass on
    // initCalls/output alone, and would silently preview the model's DEFAULT
    // voice instead of the clone: the whole feature failing while looking
    // like it works. Catches exactly that regression.
    expect(setReferenceVoice).toHaveBeenCalledTimes(2);
    expect(setReferenceVoice).toHaveBeenNthCalledWith(1, audio, 16000, 'hi');
    expect(setReferenceVoice).toHaveBeenNthCalledWith(2, audio, 16000, 'hi');
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
    // The third argument is the chunk sink, now passed unconditionally so a
    // streaming family's audio is not dropped — see synthesizeOnce.
    expect(generate).toHaveBeenCalledWith('hello there', 1.5, expect.any(Function));
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

/**
 * A double of the STREAMING protocol, which the fake above cannot express:
 * its `generate()` takes no parameters, so it can never receive an `onChunk`
 * and every existing case runs the one-shot path. That is why supertonic's
 * silent previews (reported 2026-09-18) were invisible here.
 *
 * Mirrors `NativeTtsClient.generate`'s streaming branch exactly: every sample
 * is handed to `onChunk`, and the returned `samples` is EMPTY with the
 * engine's own rate. A caller that reads only `result.samples` therefore gets
 * a successful, playable-looking, silent buffer.
 */
function fakeStreamingTtsClient(chunks: Float32Array[]): NativeTtsClientLike & { sawOnChunk: boolean; cancels: number } {
  const client = {
    sawOnChunk: false,
    cancels: 0,
    cancel(): void { client.cancels++; },
    async init(): Promise<TtsReady> {
      return { sampleRate: 24000, loadTimeMs: 1, streaming: true, clones: false };
    },
    async setVoice(): Promise<void> {},
    async setReferenceVoice(): Promise<void> {},
    async generate(
      _text: string, _speed?: number, onChunk?: (pcm: Float32Array, seq: number) => void,
    ): Promise<NativeTtsResult> {
      client.sawOnChunk = !!onChunk;
      chunks.forEach((c, i) => onChunk?.(c, i));
      return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 5 };
    },
    dispose(): void {},
  };
  return client as unknown as NativeTtsClientLike & { sawOnChunk: boolean; cancels: number };
}

describe('a streaming TTS family', () => {
  // supertonic-3 is the only catalog card that both streams and has named
  // presets, which is why it was the only model whose PRESET preview was
  // silent: the other streaming families are clone-only, and a clone preview
  // falls back to replaying the reference clip, so their silence was masked.
  it('assembles the chunks instead of returning the empty one-shot buffer', async () => {
    // Values float32 represents EXACTLY, so `toEqual` stays meaningful —
    // 0.1 round-trips as 0.10000000149011612 and would fail on precision
    // rather than on behaviour.
    const client = fakeStreamingTtsClient([new Float32Array([0.25, 0.5]), new Float32Array([0.75])]);
    const handle = createPreviewTts(() => client);
    const out = await handle.synthesize({
      modelId: 'supertonic-3', language: 'en', text: 'hi', speed: 1,
      voice: { kind: 'name', name: 'F4' },
    });
    expect(Array.from(out.audio)).toEqual([0.25, 0.5, 0.75]);
    expect(out.sampleRate).toBe(24000);
  });

  // The fix must not depend on knowing which protocol will run: `onChunk` is
  // passed unconditionally, and the client's own `this.streaming && onChunk`
  // guard keeps a non-streaming family on the one-shot path.
  it('passes onChunk unconditionally, leaving a non-streaming family unaffected', async () => {
    const streaming = fakeStreamingTtsClient([new Float32Array([0.5])]);
    await createPreviewTts(() => streaming).synthesize({
      modelId: 'm', language: 'en', text: 'hi', speed: 1, voice: { kind: 'name', name: 'F1' },
    });
    expect(streaming.sawOnChunk).toBe(true);

    const oneShot = fakeTtsClient();
    const out = await createPreviewTts(() => oneShot).synthesize({
      modelId: 'moss-tts-nano', language: 'en', text: 'hi', speed: 1,
      voice: { kind: 'name', name: 'x' },
    });
    expect(Array.from(out.audio)).toEqual([0.25]);
    expect(out.sampleRate).toBe(24000);
  });
});

describe('an abandoned preview', () => {
  // Review finding (PR #542): discarding the RESULT left the sidecar
  // synthesising, and later previews queued behind the abandoned work for up
  // to the request budget. The signal now reaches the client.
  it('cancels the sidecar synthesis when the caller aborts mid-flight', async () => {
    // Deterministic, not timing-based: the fake announces that generate() has
    // STARTED, and only then does the test abort. Aborting earlier would take
    // the pre-start path below instead, and an earlier version of this test
    // did exactly that and deadlocked — which is how the missing pre-start
    // handling was found.
    let started!: () => void;
    const hasStarted = new Promise<void>((r) => { started = r; });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const client = {
      cancels: 0,
      cancel(): void { client.cancels++; release(); },
      async init(): Promise<TtsReady> {
        return { sampleRate: 24000, loadTimeMs: 1, streaming: true, clones: false };
      },
      async setVoice(): Promise<void> {},
      async setReferenceVoice(): Promise<void> {},
      async generate(): Promise<NativeTtsResult> {
        started();
        await gate;   // still "synthesising" until cancel() lands
        return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 1 };
      },
      dispose(): void {},
    } as unknown as NativeTtsClientLike & { cancels: number };

    const controller = new AbortController();
    const p = createPreviewTts(() => client).synthesize({
      modelId: 'supertonic-3', language: 'en', text: 'hi', speed: 1,
      voice: { kind: 'name', name: 'F4' }, signal: controller.signal,
    });
    await hasStarted;
    controller.abort();
    await p;
    expect(client.cancels).toBe(1);
  });

  // `synthesize` awaits init and applyVoice before any synthesis, so an abort
  // routinely lands before there is anything to cancel. Spending the
  // sidecar's time on a result nobody will read is the waste this avoids.
  it('never starts the synthesis when the signal is already aborted', async () => {
    const client = fakeTtsClient();
    const generate = vi.spyOn(client, 'generate');
    const controller = new AbortController();
    controller.abort();
    await expect(createPreviewTts(() => client).synthesize({
      modelId: 'm', language: 'en', text: 'hi', speed: 1,
      voice: { kind: 'name', name: 'x' }, signal: controller.signal,
    })).rejects.toThrow(/aborted/i);
    expect(generate).not.toHaveBeenCalled();
  });

  // The listener must not outlive the call: a handle is reused across many
  // previews, and a leaked listener would cancel a LATER synthesis when an
  // older, already-settled signal aborts.
  it('stops listening once the synthesis settles', async () => {
    const client = fakeTtsClient();
    const controller = new AbortController();
    await createPreviewTts(() => client).synthesize({
      modelId: 'm', language: 'en', text: 'hi', speed: 1,
      voice: { kind: 'name', name: 'x' }, signal: controller.signal,
    });
    controller.abort();
    expect(client.cancels).toBe(0);
  });
});
