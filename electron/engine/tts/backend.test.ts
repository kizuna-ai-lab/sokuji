// @vitest-environment node
/**
 * The TTS backend (ported from sidecar/tests/test_tts_backend.py) over the fake addon, its files in a real hub-cache
 * layout under a temp HF_HOME: loading and staging, capabilities, one-shot and streaming synthesis, voices, the
 * voice-required families, the pocket_tts default preset, the GPU warm-up, and cancellation / unload.
 */
import '../test/env';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restoreSeams, seams } from '../accel/seams';
import { BackendLoadError, makeBackend } from '../backends';
import { VOICE_REQUIRED_FAMILIES } from '../catalog';
import { setNativeForTests } from '../native';
import { makeFakeNative, type FakeNative, type FakeTts, type FakeTtsOptions } from '../test/fakeNative';
import { cacheFile, freshHfHome } from '../test/hfFixture';
import { NativeTtsBackend, ttsTimings, type TtsConfig } from './backend';
import { restoreStagingSeams, stagingSeams } from './staging';

const REPO = 'acme/pocket-tts-en-gguf';
const REF = `${REPO}/pocket_tts-en/model.gguf`;
const ones = (n: number, v = 1) => new Array(n).fill(v);

let cleanup: () => void;
let fake: FakeNative;
let logs: string[];
let source: string;
const opts: FakeTtsOptions = {};
const useFake = (o: FakeTtsOptions = {}) => {
  for (const k of Object.keys(opts)) delete (opts as Record<string, unknown>)[k];
  Object.assign(opts, o);
  fake = makeFakeNative({ devices: [{ kind: 'vulkan' }, { kind: 'cpu' }, { kind: 'metal' }], tts: opts });
  setNativeForTests(fake);
};
const cfg = (ttsFamily: string, extra: Partial<TtsConfig> = {}): TtsConfig => ({ ttsFamily, ttsLanguage: '', ttsExtraFiles: [], ...extra });
const backend = () => makeBackend('native_tts') as NativeTtsBackend;
const loaded = async (family: string, device = 'cpu', o?: FakeTtsOptions, extra?: Partial<TtsConfig>) => {
  if (o) useFake(o);
  const b = backend();
  await b.load(REF, device, 'q8_0', cfg(family, extra));
  return { b, model: fake.ttsModels.at(-1)! };
};
const synths = (m: FakeTts) => m.log.filter((e) => (e as unknown[])[0] === 'synth');

beforeEach(() => {
  cleanup = freshHfHome();
  source = cacheFile(REPO, 'pocket_tts-en/model.gguf', 15).link;
  cacheFile('acme/flat-repo', 'model.gguf', 15);
  logs = [];
  seams.log = (_level, m) => { logs.push(m); };
  useFake();
});
afterEach(() => {
  ttsTimings.unloadDeadlineMs = 10_000;
  restoreSeams();
  restoreStagingSeams();
  setNativeForTests(null);
  cleanup();
});

describe('loading', () => {
  it('the registry has native_tts, with the class defaults', () => {
    const b = backend();
    expect([NativeTtsBackend.NAME, b.STREAMING, b.CLONES, b.sampleRate, b.isLoaded]).toEqual(['native_tts', false, false, 24000, false]);
  });

  it('stages the GGUF from the cached snapshot before loading it', async () => {
    const { b, model } = await loaded('pocket_tts');
    expect(model.path).not.toBe(source);
    expect(model.path.endsWith(path.join('pocket_tts-en', 'model.gguf'))).toBe(true);
    expect(fs.statSync(model.path).ino).toBe(fs.statSync(source).ino);
    expect(b.isLoaded).toBe(true);
  });

  it('a GGUF at the repo root stages too', async () => {
    const b = backend();
    await b.load('acme/flat-repo/model.gguf', 'cpu', 'q8_0', cfg('moss_tts_nano'));
    expect(fake.ttsModels[0].path.endsWith(`${path.sep}model.gguf`)).toBe(true);
    expect(fs.existsSync(fake.ttsModels[0].path)).toBe(true);
  });

  it('passes the family, the explicit device and the language', async () => {
    const { model } = await loaded('pocket_tts', 'vulkan', undefined, { ttsLanguage: 'english' });
    expect([model.loadOptions, model.deviceIndex]).toEqual([{ family: 'pocket_tts', language: 'english' }, 0]);
  });

  it('a CPU plan passes the explicit CPU device, never none', async () => {
    expect((await loaded('pocket_tts', 'cpu')).model.deviceIndex).toBe(1);
  });

  it('needs a family, an org/repo/dir/file artifact, a known device, and the file cached', async () => {
    await expect(backend().load(REF, 'cpu', 'q8_0', cfg(''))).rejects.toBeInstanceOf(BackendLoadError);
    await expect(backend().load(REF, 'cpu', 'q8_0')).rejects.toBeInstanceOf(BackendLoadError);
    await expect(backend().load('acme/bare-repo', 'cpu', 'q8_0', cfg('moss_tts_nano'))).rejects.toBeInstanceOf(BackendLoadError);
    const b = backend();
    await expect(b.load(REF, 'nope', 'q8_0', cfg('pocket_tts'))).rejects.toBeInstanceOf(BackendLoadError);
    expect(b.isLoaded).toBe(false);
    await expect(backend().load('acme/missing/dir/model.gguf', 'cpu', 'q8_0', cfg('moss_tts_nano'))).rejects.toThrow(/not in the model cache/);
  });

  it('a library load failure is a BackendLoadError with its words', async () => {
    useFake({ loadError: 'sk_tts_load: unknown family' });
    await expect(backend().load(REF, 'cpu', 'q8_0', cfg('bogus_family'))).rejects.toThrow(/unknown family/);
  });

  it('the capabilities become the instance\'s own', async () => {
    const { b } = await loaded('supertonic', 'cpu', { caps: { streaming: true, clones: true, sampleRate: 44100 } });
    expect([b.STREAMING, b.CLONES, b.sampleRate]).toEqual([true, true, 44100]);
    const b2 = backend();
    expect([b2.STREAMING, b2.CLONES, b2.sampleRate]).toEqual([false, false, 24000]);
  });

  it('a reload unloads the previous model first', async () => {
    const { b, model: first } = await loaded('moss_tts_nano');
    await b.load(REF, 'cpu', 'q8_0', cfg('moss_tts_nano'));
    expect(first.unloaded).toBe(true);
    expect(fake.ttsModels.at(-1)).not.toBe(first);
  });

  it("stages a card's preset assets beside the GGUF", async () => {
    const extra = cacheFile(REPO, 'pocket_tts-en/embeddings/alba.safetensors', 5).link;
    const { model } = await loaded('pocket_tts', 'cpu', undefined, { ttsLanguage: 'english', ttsExtraFiles: [['embeddings/alba.safetensors', 999]] });
    const staged = path.join(path.dirname(model.path), 'embeddings', 'alba.safetensors');
    expect(fs.statSync(staged).ino).toBe(fs.statSync(extra).ino);
  });

  it('stages once across repeated loads, and again after the staging tree was wiped', async () => {
    const first = (await loaded('pocket_tts')).model.path;
    const firstIno = fs.statSync(first).ino;
    const second = (await loaded('pocket_tts')).model.path;
    expect([second, fs.statSync(second).ino]).toEqual([first, firstIno]);
    fs.rmSync(first);
    const third = (await loaded('pocket_tts')).model.path;
    expect([third, fs.existsSync(third)]).toEqual([first, true]);
  });

  it('copies when a hard link is impossible', async () => {
    stagingSeams.link = async () => { throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); };
    const { b, model } = await loaded('pocket_tts');
    expect(b.isLoaded).toBe(true);
    expect(fs.readFileSync(model.path).length).toBe(15);
  });
});

describe('synthesis', () => {
  it('one-shot: every chunk joined, the rate, the time; speed and language reach the synth', async () => {
    const { b, model } = await loaded('moss_tts_nano', 'cpu', { chunks: [{ pcm: ones(50) }, { pcm: ones(50) }] });
    b.setLanguage('ja');
    const [samples, rate, ms, channels] = await b.generate('hello', 1.5);
    expect([samples.length, rate, ms >= 0, channels]).toEqual([100, 24000, true, 1]);
    expect(synths(model).at(-1)).toEqual(['synth', 'hello', 'ja', 1.5]);
  });

  it('one-shot keeps the rate the synth actually returned, and its channels', async () => {
    const { b } = await loaded('moss_tts_nano', 'cpu', { chunks: [{ pcm: ones(10), rate: 16000, channels: 2 }] });
    const [samples, rate, , channels] = await b.generate('hello');
    expect([samples.length, rate, channels]).toEqual([10, 16000, 2]);
  });

  it('streaming: every chunk, each with its own rate and channels', async () => {
    const { b } = await loaded('omnivoice', 'cpu', { caps: { streaming: true }, chunks: [{ pcm: ones(10) }, { pcm: ones(10), rate: 16000 }, { pcm: ones(10), channels: 2 }] });
    await b.setVoice(new Float32Array(10), 24000, 'hi');
    const got: unknown[] = [];
    await b.generateStream('hello', 1, undefined, (pcm, sr, ch) => got.push([pcm.length, sr, ch]));
    expect(got).toEqual([[10, 24000, 1], [10, 16000, 1], [10, 24000, 2]]);
    expect(b.inFlight).toBe(0);
  });

  it('a real streaming failure is thrown after the chunks before it', async () => {
    const { b } = await loaded('omnivoice', 'cpu', { caps: { streaming: true }, chunks: [{ pcm: ones(10) }, { pcm: ones(10) }], failAfterFirst: 'decoder blew up' });
    await b.setVoice(new Float32Array(10), 24000, 'hi');
    let n = 0;
    await expect(b.generateStream('hello', 1, undefined, () => { n++; })).rejects.toThrow(/decoder blew up/);
    expect(n).toBe(1);
  });

  it('a voice clip: its length, rate and reference text; an empty text is none', async () => {
    const { b, model } = await loaded('qwen3_tts');
    await b.setVoice(new Float32Array(2400), 24000, 'hello there');
    expect(model.voice).toEqual([2400, 24000, 'hello there']);
    await b.setVoice(new Float32Array(2400), 24000);
    expect(model.voice).toEqual([2400, 24000, null]);
  });

  it('a built-in voice is a preset; the presets are the voices', async () => {
    const { b, model } = await loaded('supertonic');
    await b.setBuiltinVoice('Robert');
    expect(model.preset).toBe('Robert');
    expect(await b.listBuiltinVoices()).toEqual(['Alba', 'Bella']);
  });

  it('every call is a BackendLoadError before a load', async () => {
    const b = backend();
    await expect(b.generate('hi')).rejects.toBeInstanceOf(BackendLoadError);
    await expect(b.generateStream('hi', 1, undefined, () => {})).rejects.toBeInstanceOf(BackendLoadError);
    await expect(b.setVoice(new Float32Array(10), 24000)).rejects.toBeInstanceOf(BackendLoadError);
    await expect(b.setBuiltinVoice('x')).rejects.toBeInstanceOf(BackendLoadError);
    await expect(b.listBuiltinVoices()).rejects.toBeInstanceOf(BackendLoadError);
  });

  it('the fake refuses everything once unloaded, as the addon does', async () => {
    const { b, model } = await loaded('moss_tts_nano');
    await b.unload();
    expect(model.unloaded).toBe(true);
    expect(b.isLoaded).toBe(false);
    expect(() => model.synth('hi', null, 1, { onAudio: () => {} })).toThrow(/unloaded/);
    await expect(model.setVoice(new Float32Array(1), 24000, null)).rejects.toThrow(/unloaded/);
    await expect(model.setPreset('x')).rejects.toThrow(/unloaded/);
    await expect(model.presets()).rejects.toThrow(/unloaded/);
  });
});

describe('the voice-required families', () => {
  it.each([...VOICE_REQUIRED_FAMILIES].sort())('%s refuses a bare synth before the library, and synthesizes once a voice is set', async (family) => {
    const { b, model } = await loaded(family, 'cpu', { caps: { streaming: true } });
    await expect(b.generate('hello')).rejects.toThrow(new RegExp(family));
    await expect(b.generateStream('hello', 1, undefined, () => {})).rejects.toThrow(new RegExp(family));
    expect([synths(model), b.inFlight]).toEqual([[], 0]);
    await b.setVoice(new Float32Array(2400), 24000, 'hello there');
    expect((await b.generate('hello'))[0]).toBeInstanceOf(Float32Array);
    let n = 0;
    await b.generateStream('hello', 1, undefined, () => { n++; });
    expect(n).toBe(1);
  });

  it.each(['voxcpm1', 'voxcpm2', 'irodori_tts', 'moss_tts_nano'])('%s synthesizes with no voice set', async (family) => {
    expect(VOICE_REQUIRED_FAMILIES.has(family)).toBe(false);
    const { b } = await loaded(family);
    expect((await b.generate('hello'))[0]).toBeInstanceOf(Float32Array);
  });
});

describe('default voices and the warm-up', () => {
  const pocket: FakeTtsOptions = { needsVoice: true, presets: ['alba'] };

  it('pocket_tts on CPU takes its first preset as the default voice, with no warm-up', async () => {
    const { b, model } = await loaded('pocket_tts', 'cpu', pocket);
    expect([model.preset, b.voiceSet, synths(model)]).toEqual(['alba', true, []]);
    expect((await b.generate('hello'))[0]).toBeInstanceOf(Float32Array);
  });

  it('pocket_tts on a GPU takes the preset, then warms up for real', async () => {
    const { b, model } = await loaded('pocket_tts', 'vulkan', pocket);
    expect([model.preset, b.voiceSet, b.inFlight]).toEqual(['alba', true, 0]);
    expect(synths(model)).toEqual([['synth', 'Warm-up.', null, 1]]);
    expect(logs.some((l) => l.includes("warm-up synth for family='pocket_tts'"))).toBe(true);
    expect(logs.some((l) => l.includes('warm-up synth failed'))).toBe(false);
  });

  it('a GPU load warms up once and discards it, Metal too; CPU does not', async () => {
    expect(synths((await loaded('moss_tts_nano', 'vulkan')).model)).toEqual([['synth', 'Warm-up.', null, 1]]);
    expect(logs.some((l) => l.toLowerCase().includes('warm-up') && l.includes('moss_tts_nano'))).toBe(true);
    expect(synths((await loaded('moss_tts_nano', 'metal')).model)).toEqual([['synth', 'Warm-up.', null, 1]]);
    expect(synths((await loaded('moss_tts_nano', 'cpu')).model)).toEqual([]);
  });

  it('supertonic gets no default preset, and on a GPU warms up bare', async () => {
    const gpu = await loaded('supertonic', 'vulkan');
    expect([gpu.model.preset, gpu.b.voiceSet, synths(gpu.model)]).toEqual([null, false, [['synth', 'Warm-up.', null, 1]]]);
    const cpu = await loaded('supertonic', 'cpu');
    expect([cpu.model.preset, cpu.b.voiceSet, synths(cpu.model)]).toEqual([null, false, []]);
  });

  it.each(['qwen3_tts', 'omnivoice'])('%s on a GPU skips the warm-up (it cannot synthesize bare)', async (family) => {
    const { b, model } = await loaded(family, 'vulkan');
    expect([b.isLoaded, synths(model), b.voiceSet]).toEqual([true, [], false]);
  });

  it('a failed warm-up does not fail the load, and says so', async () => {
    const { b } = await loaded('moss_tts_nano', 'vulkan', { synthError: 'gpu pipeline compile wedged' });
    expect([b.isLoaded, b.inFlight]).toEqual([true, 0]);
    expect(logs.some((l) => l.toLowerCase().includes('warm-up') && l.includes('gpu pipeline compile wedged'))).toBe(true);
  });
});

describe('cancellation and unload', () => {
  const streaming = (o: FakeTtsOptions) => ({ caps: { streaming: true }, chunks: [{ pcm: ones(10) }, { pcm: ones(10) }, { pcm: ones(10) }], ...o });
  const withVoice = async (o: FakeTtsOptions) => {
    const r = await loaded('omnivoice', 'cpu', streaming(o));
    await r.b.setVoice(new Float32Array(10), 24000, 'hi');
    return r;
  };

  it('cancel() stops a stream before its next chunk', async () => {
    const { b, model } = await withVoice({ gateAfterFirst: true });
    let n = 0;
    const run = b.generateStream('hello', 1, undefined, () => { n++; if (n === 1) b.cancel(); });
    await model.started;
    model.release();
    await run;                                                          // quietly: a cancel is not a failure
    expect(n).toBe(1);
  });

  it('a cancel before the first chunk leaves none', async () => {
    const { b, model } = await withVoice({ gateBefore: true });
    let n = 0;
    const run = b.generateStream('hello', 1, undefined, () => { n++; });
    await model.started;
    b.cancel();
    model.release();
    await run;
    expect(n).toBe(0);
  });

  it("the caller's signal stops its stream", async () => {
    const { b, model } = await withVoice({ gateAfterFirst: true });
    const controller = new AbortController();
    let n = 0;
    const run = b.generateStream('hello', 1, controller.signal, () => { n++; });
    await model.started;
    controller.abort();
    model.release();
    await run;
    expect([n, model.signals[0]?.aborted]).toEqual([1, true]);
  });

  it('cancel with nothing running is a no-op; finished calls leave nothing behind', async () => {
    const { b } = await loaded('moss_tts_nano');
    b.cancel();
    await b.generate('hello');
    expect(b.inFlight).toBe(0);
  });

  it('a one-shot synth can be cancelled too', async () => {
    const { b, model } = await loaded('moss_tts_nano', 'cpu', { gateBefore: true });
    const run = b.generate('hello');
    await model.started;
    b.cancel();
    model.release();
    await expect(run).rejects.toThrow(/cancelled/);
    expect(b.inFlight).toBe(0);
  });

  it('unload during a stream waits for it before freeing the model', async () => {
    const { b, model } = await withVoice({ gateAfterFirst: true });
    let n = 0;
    const run = b.generateStream('hello', 1, undefined, () => { n++; });
    await model.started;
    let done = false;
    const unload = b.unload().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false);
    expect(model.log.some((e) => String((e as unknown[])[0]).startsWith('unload'))).toBe(false);
    model.release();
    await unload;
    await run;
    expect([n, model.log.at(-1), b.isLoaded]).toEqual([1, ['unload'], false]);
  });

  it('unload waits for every synth, a superseded one included', async () => {
    const { b, model } = await withVoice({ gateAfterFirst: true });
    const first = b.generateStream('first', 1, undefined, () => {});
    await model.started;
    b.cancel();
    const second = b.generateStream('second', 1, undefined, () => {});
    await new Promise((r) => setImmediate(r));
    expect(model.active).toBe(2);
    const unload = b.unload();
    await new Promise((r) => setTimeout(r, 50));
    expect(model.log.some((e) => String((e as unknown[])[0]).startsWith('unload'))).toBe(false);
    model.release();
    await unload;
    await Promise.all([first, second]);
    expect([model.active, model.maxActive >= 2, model.log.at(-1)]).toEqual([0, true, ['unload']]);
  });

  it('unload during a one-shot synth waits for it', async () => {
    const { b, model } = await loaded('moss_tts_nano', 'cpu', { gateBefore: true });
    const run = b.generate('hello').catch((e) => e);
    await model.started;
    const unload = b.unload();
    await new Promise((r) => setTimeout(r, 50));
    expect(model.log.some((e) => String((e as unknown[])[0]).startsWith('unload'))).toBe(false);
    model.release();
    await unload;
    expect(await run).toBeInstanceOf(Error);                            // aborted by the unload
    expect([model.log.at(-1), b.isLoaded]).toEqual([['unload'], false]);
  });

  it('unload waits out its deadline when a synth never ends, and lets go of the model', async () => {
    ttsTimings.unloadDeadlineMs = 300;
    const { b, model } = await loaded('moss_tts_nano', 'cpu', { wedged: true });
    void b.generate('hello').catch(() => {});
    await model.started;
    const t0 = Date.now();
    await b.unload();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3000);
    expect(b.isLoaded).toBe(false);
  });

  it('an unload racing a load waits for its warm-up before freeing the model', async () => {
    useFake({ gateBefore: true });
    const b = backend();
    const load = b.load(REF, 'vulkan', 'q8_0', cfg('moss_tts_nano'));
    await new Promise<void>((r) => { const t = setInterval(() => { if (fake.ttsModels.length > 0) { clearInterval(t); r(); } }, 5); });
    const model = fake.ttsModels[0];
    await model.started;                                                // inside the warm-up
    const unload = b.unload();
    await new Promise((r) => setTimeout(r, 50));
    expect(model.log.some((e) => String((e as unknown[])[0]).startsWith('unload'))).toBe(false);
    model.release();
    await unload;
    await load;
    expect([model.log.at(-1), b.isLoaded]).toEqual([['unload'], false]);
  });
});
