// @vitest-environment node
/**
 * The native ASR backends (ported from sidecar/tests/test_asr_backend.py) over a fake addon; the GGUF sits in a real
 * hub-cache layout under a temp HF_HOME. A real-model smoke runs with SOKUJI_RUN_NATIVE_ASR=1 and SOKUJI_NATIVE_DIR.
 */
import '../test/env';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackendLoadError, makeBackend } from '../backends';
import { loadNative, setNativeForTests, useNative } from '../native';
import { makeFakeNative, type FakeAsrOptions, type FakeNative } from '../test/fakeNative';
import { cacheArtifact, freshHfHome } from '../test/hfFixture';
import { NativeAsrBackend, NativeAsrStreamBackend } from './backend';

const REF = 'handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf';
const VOXTRAL = 'handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf/Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf';

let cleanup: () => void;
let fake: FakeNative;
const asrOpts: FakeAsrOptions = {};
const useFake = (opts: FakeAsrOptions = {}) => {
  Object.assign(asrOpts, opts);
  fake = makeFakeNative({ devices: [{ kind: 'vulkan' }, { kind: 'cpu' }], asr: asrOpts });
  setNativeForTests(fake);
};
const model = () => fake.asrModels.at(-1)!;
const batch = () => makeBackend('native_asr') as NativeAsrBackend;
const streamBackend = async () => {
  asrOpts.supportsStreaming = true;
  const b = makeBackend('native_asr_stream') as NativeAsrStreamBackend;
  await b.load(VOXTRAL, 'vulkan', 'q4_k_m');
  return b;
};

beforeEach(() => {
  cleanup = freshHfHome();
  for (const k of Object.keys(asrOpts)) delete (asrOpts as Record<string, unknown>)[k];
  cacheArtifact(REF);
  cacheArtifact(VOXTRAL);
  useFake();
});
afterEach(() => {
  setNativeForTests(null);
  cleanup();
});

describe('native_asr', () => {
  it('maps the plan device to the addon device', async () => {
    const b = batch();
    await b.load(REF, 'vulkan', 'q8_0');
    expect(b.isLoaded).toBe(true);
    expect(model().deviceIndex).toBe(0);
    await b.load(REF, 'cpu', 'q8_0');
    expect(model().deviceIndex).toBe(1);
    expect(fake.asrModels[0].unloaded).toBe(true);      // a reload frees the previous model
  });

  it('a device kind this process lacks is a BackendLoadError', async () => {
    await expect(batch().load(REF, 'metal', 'q8_0')).rejects.toBeInstanceOf(BackendLoadError);
  });

  it('passes the language and strips the text', async () => {
    const b = batch();
    await b.load(REF, 'cpu', 'q8_0');
    const r = await b.transcribe(new Float32Array(16000), 'zh');
    expect([r.text, r.language]).toEqual(['hello world', 'zh']);
    expect(model().runs[0].language).toBe('zh');
    await b.transcribe(new Float32Array(160), '');
    expect(model().runs[1].language).toBeNull();          // empty → autodetect
  });

  it('transcribing before a load is a BackendLoadError', async () => {
    await expect(batch().transcribe(new Float32Array(1600), 'en')).rejects.toBeInstanceOf(BackendLoadError);
  });

  it('empty audio short-circuits', async () => {
    const b = batch();
    await b.load(REF, 'cpu', 'q8_0');
    expect((await b.transcribe(new Float32Array(0), 'en')).text).toBe('');
    expect(model().runs).toEqual([]);
  });

  it('unload unloads the model', async () => {
    const b = batch();
    await b.load(REF, 'cpu', 'q8_0');
    const m = model();
    await b.unload();
    expect([b.isLoaded, m.unloaded]).toEqual([false, true]);
  });

  it('a bare repo id is not an artifact', async () => {
    await expect(batch().load('just-a-repo-id', 'cpu', 'q8_0')).rejects.toBeInstanceOf(BackendLoadError);
  });

  it('a GGUF missing from the cache is a BackendLoadError', async () => {
    await expect(batch().load('handy-computer/whisper-base-gguf/whisper-base-Q8_0.gguf', 'cpu', 'q8_0')).rejects.toThrow(/not in the model cache/);
  });

  it("a NativeError becomes a BackendLoadError keeping the library's words", async () => {
    useFake({ loadError: 'sk_asr_load: out of memory (status -6)' });
    const e = await batch().load(REF, 'vulkan', 'q8_0').catch((x) => x);
    expect(e).toBeInstanceOf(BackendLoadError);
    expect(e.reason).toContain('out of memory');            // the loader's OOM fallback keys on this
  });

  it('no addon is a BackendLoadError', async () => {
    setNativeForTests(null);
    await expect(batch().load(REF, 'cpu', 'q8_0')).rejects.toBeInstanceOf(BackendLoadError);
  });

  it("maps a language onto the model's tag set for batch runs too", async () => {
    useFake({ languages: ['en-US', 'zh-CN'] });
    const b = await streamBackend();
    await b.transcribe(new Float32Array(1600), 'zh');
    expect(model().runs.at(-1)!.language).toBe('zh-CN');
  });
});

describe('native_asr_stream', () => {
  it('is streaming and opens a stream', async () => {
    const b = await streamBackend();
    expect([b.STREAMING, b.isLoaded]).toEqual([true, true]);
    expect(b.openStream()).toBeTruthy();
    expect(new NativeAsrBackend().STREAMING).toBe(false);
  });

  it('passes the language when opening', async () => {
    const b = await streamBackend();
    b.openStream('ja');
    expect(model().streams.at(-1)!.language).toBe('ja');
    b.openStream('');
    expect(model().streams.at(-1)!.language).toBeNull();
    b.openStream();
    expect(model().streams.at(-1)!.language).toBeNull();
  });

  it("maps a language onto the model's tag set", async () => {
    useFake({ languages: ['en-US', 'zh-CN', 'ja-JP'] });             // nemotron's shape
    const b = await streamBackend();
    b.openStream('zh');
    expect(model().streams.at(-1)!.language).toBe('zh-CN');
    b.openStream('ko');
    expect(model().streams.at(-1)!.language).toBeNull();               // unknown → autodetect
    model().capabilities.languages = ['en', 'zh', 'ja'];               // whisper/voxtral's shape
    b.openStream('zh');
    expect(model().streams.at(-1)!.language).toBe('zh');
  });

  it('drain hands out committed deltas only', async () => {
    const b = await streamBackend();
    const st = b.openStream();
    const raw = model().streams.at(-1)!;
    await st.feed(new Float32Array(1600));
    expect(st.drain()).toEqual([]);
    raw.committed = 'The tribal';
    await st.feed(new Float32Array(1600));                              // the view refreshes on feed
    expect(st.drain()).toEqual(['The tribal']);
    raw.committed = 'The tribal chief called';
    await st.feed(new Float32Array(1600));
    expect(st.drain()).toEqual([' chief called']);
    expect(st.drain()).toEqual([]);
  });

  it('end finalizes and returns the full text', async () => {
    const b = await streamBackend();
    const st = b.openStream();
    const raw = model().streams.at(-1)!;
    raw.committed = 'hello world';
    expect(await st.end()).toBe('hello world FINAL');
    expect(raw.closed).toBe(true);
  });

  it('reopens on the same model after an end', async () => {
    const b = await streamBackend();
    await b.openStream().end();
    expect(b.openStream()).toBeTruthy();
    expect(model().streams).toHaveLength(2);
  });

  it('abort closes without finalizing', async () => {
    const b = await streamBackend();
    const st = b.openStream();
    st.abort();
    const raw = model().streams.at(-1)!;
    expect([raw.closed, raw.finalized]).toEqual([true, false]);
  });

  it('a model that cannot stream is refused', async () => {
    asrOpts.supportsStreaming = false;
    const b = makeBackend('native_asr_stream') as NativeAsrStreamBackend;
    await expect(b.load(VOXTRAL, 'cpu', 'q4_k_m')).rejects.toBeInstanceOf(BackendLoadError);
    expect(b.isLoaded).toBe(false);
  });

  it('a feed the library refuses aborts and closes the stream, freeing its slot', async () => {
    const b = await streamBackend();
    const st = b.openStream();
    const raw = model().streams.at(-1)!;
    raw.feedError = 'sk_asr_stream_open: unsupported (status -1)';
    await st.feed(new Float32Array(1600));
    expect([st.aborted, raw.closed]).toEqual([true, true]);
    await st.feed(new Float32Array(1600));                              // a dead stream takes nothing more
    expect(model().log.filter((e) => (e as unknown[])[0] === 'feed')).toHaveLength(1);
  });
});

describe.skipIf(!process.env.SOKUJI_RUN_NATIVE_ASR || !process.env.SOKUJI_NATIVE_DIR)('a real model', () => {
  it('SenseVoice transcribes the test clip', async () => {
    cleanup();
    cleanup = () => {};
    process.env.HF_HOME = process.env.SOKUJI_REAL_HF_HOME ?? `${process.env.HOME}/.cache/huggingface`;
    useNative(loadNative(process.env.SOKUJI_NATIVE_DIR!), process.env.SOKUJI_NATIVE_DIR!);
    const { snapshotPath } = await import('../models/hfCache');
    const fs = await import('node:fs');
    const dir = snapshotPath('csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')!;
    const wav = fs.readFileSync(`${dir}/test_wavs/en.wav`);
    const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.byteLength - 44) / 2);
    const audio = Float32Array.from(pcm, (v) => v / 32768);
    const b = batch();
    await b.load(REF, 'cpu', 'q8_0');
    expect((await b.transcribe(audio, 'en')).text.toLowerCase()).toContain('tribal');
    await b.unload();
  });
});
