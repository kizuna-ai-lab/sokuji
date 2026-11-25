// @vitest-environment node
/**
 * Download specs and sizes (ported from sidecar/tests/test_native_models.py), and the Python engine's own specs and
 * sizes for every card (test/golden/specs.json).
 */
import '../test/env';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import golden from '../test/golden/specs.json';
import { GGUF_SOURCES, splitArtifact, ttsModel } from '../catalog';
import { resetProbeForTests } from '../accel/probe';
import { restoreSeams, seams } from '../accel/seams';
import { FakeHub } from '../test/fakeHub';
import { downloadSpecs, ignored, modelSize, modelSizeAsync, resetSizeCacheForTests, sizeSeams } from './specs';

const gguf = (mid: string, quant: string) => GGUF_SOURCES[`${mid}|${quant}`].join('/');
const fileSpec = (mid: string, quant: string) => [splitArtifact(gguf(mid, quant))];

let hub: FakeHub;
beforeAll(async () => {
  hub = await FakeHub.start();
});
afterAll(() => hub.close());
afterEach(() => {
  resetSizeCacheForTests();
  restoreSeams();
  resetProbeForTests();
});

describe('download specs', () => {
  it('maps the catalog ids, the empty default, and a bare repo id', () => {
    const expected = fileSpec('qwen2.5-0.5b', 'q8_0');
    expect(downloadSpecs('').files).toEqual(expected);
    expect(downloadSpecs('qwen2.5-0.5b').files).toEqual(expected);
    expect(downloadSpecs('qwen').repos).toEqual(['qwen']);                     // the dropped alias is a bare repo id now
    expect(downloadSpecs('whisper-base').files).toEqual([['handy-computer/whisper-base-gguf', 'whisper-base-Q8_0.gguf']]);
    expect(downloadSpecs('csukuangfj/vits-piper-en_US-amy-low').repos).toEqual(['csukuangfj/vits-piper-en_US-amy-low']);
    const sv = downloadSpecs('sense-voice');
    expect(sv.files).toEqual([['handy-computer/SenseVoiceSmall-gguf', 'SenseVoiceSmall-Q8_0.gguf']]);
    expect(sv.urls).toEqual([]);
    expect(downloadSpecs('granite-speech-4.1-2b').files).toEqual([['handy-computer/granite-speech-4.1-2b-gguf', 'granite-speech-4.1-2b-Q4_K_M.gguf']]);
    expect(downloadSpecs('qwen3-asr-1.7b').files).toEqual([['handy-computer/Qwen3-ASR-1.7B-gguf', 'Qwen3-ASR-1.7B-Q4_K_M.gguf']]);
  });

  it('cohere is one pinned GGUF and no urls', () => {
    expect(downloadSpecs('cohere-transcribe-03-2026')).toEqual({ repos: [], urls: [], files: [['handy-computer/cohere-transcribe-03-2026-gguf', 'cohere-transcribe-03-2026-Q4_K_M.gguf']] });
  });

  it('no model has urls (silero ships in the native library)', () => {
    for (const id of ['sense-voice', 'fun-asr-mlt-nano', 'whisper-base', 'qwen3-asr-1.7b', 'voxtral-mini-4b-realtime', 'granite-speech-4.1-2b']) expect(downloadSpecs(id).urls).toEqual([]);
    for (const id of ['', 'qwen', 'translategemma-4b', 'csukuangfj/vits-piper-en_US-amy-low']) expect(downloadSpecs(id).urls).toEqual([]);
    expect('ignore' in downloadSpecs('voxtral-mini-4b-realtime')).toBe(false);
  });

  it('translation specs ignore SOKUJI_TRANSLATE_MODEL', () => {
    const prev = process.env.SOKUJI_TRANSLATE_MODEL;
    process.env.SOKUJI_TRANSLATE_MODEL = 'acme/custom-translate';
    try {
      expect(downloadSpecs('').files).toEqual(fileSpec('qwen2.5-0.5b', 'q8_0'));
      expect(downloadSpecs('qwen2.5-0.5b').files).toEqual(fileSpec('qwen2.5-0.5b', 'q8_0'));
    } finally {
      if (prev === undefined) delete process.env.SOKUJI_TRANSLATE_MODEL;
      else process.env.SOKUJI_TRANSLATE_MODEL = prev;
    }
  });

  it('voxtral is a single GGUF', () => {
    const spec = downloadSpecs('voxtral-mini-4b-realtime');
    expect(spec.files).toEqual([['handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf', 'Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf']]);
    expect(spec.urls).toEqual([]);
  });

  it('no spec carries an ignore key', () => {
    for (const id of ['cohere-transcribe-03-2026', 'qwen3-asr-1.7b', 'hy-mt2-1.8b', 'hy-mt2-7b', 'moss-tts-nano']) expect('ignore' in downloadSpecs(id)).toBe(false);
  });

  it('fun-asr-mlt-nano', () => {
    const spec = downloadSpecs('fun-asr-mlt-nano');
    expect(spec.files).toEqual([['handy-computer/Fun-ASR-MLT-Nano-2512-gguf', 'Fun-ASR-MLT-Nano-2512-Q6_K.gguf']]);
    expect(spec.urls).toEqual([]);
  });

  it('the Qwen translation cards', () => {
    expect(downloadSpecs('qwen2.5-0.5b').files).toEqual(fileSpec('qwen2.5-0.5b', 'q8_0'));
    expect(downloadSpecs('qwen3-0.6b').files).toEqual(fileSpec('qwen3-0.6b', 'q8_0'));
    expect(downloadSpecs('qwen3.5-0.8b').files).toEqual(fileSpec('qwen3.5-0.8b', 'q4_k_m'));
    expect(downloadSpecs('qwen3.5-2b').files).toEqual(fileSpec('qwen3.5-2b', 'q4_k_m'));
  });

  it('TranslateGemma and HY-MT2', () => {
    expect(downloadSpecs('translategemma-4b').files).toEqual(fileSpec('translategemma-4b', 'q4_k_m'));
    expect(downloadSpecs('hy-mt2-1.8b').files).toEqual(fileSpec('hy-mt2-1.8b', 'q4_k_m'));
    expect(downloadSpecs('hy-mt2-7b').files).toEqual(fileSpec('hy-mt2-7b', 'q4_k_m'));
  });

  it('HY-MT1.5, and its FP8 override as a bare repo', () => {
    expect(downloadSpecs('hy-mt15-1.8b').files).toEqual(fileSpec('hy-mt15-1.8b', 'q4_k_m'));
    expect(downloadSpecs('hy-mt15-7b').files).toEqual(fileSpec('hy-mt15-7b', 'q4_k_m'));
    expect(downloadSpecs('hy-mt15-7b', 'tencent/HY-MT1.5-7B-FP8').repos).toEqual(['tencent/HY-MT1.5-7B-FP8']);
  });

  it('a bare two-segment override keeps the whole-repo shape', () => {
    expect(downloadSpecs('hy-mt2-7b', 'tencent/Hy-MT2-7B-FP8').repos).toEqual(['tencent/Hy-MT2-7B-FP8']);
  });

  it('an artifact override is that one file', () => {
    const alt = gguf('hy-mt2-7b', 'q8_0');
    expect(downloadSpecs('hy-mt2-7b', alt)).toEqual({ repos: [], urls: [], files: [splitArtifact(alt)] });
  });

  it('moss-tts-nano is a single file with no extras', () => {
    expect(downloadSpecs('moss-tts-nano')).toEqual({ repos: [], urls: [], files: [['audio-cpp/audio.cpp-gguf', 'MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf']] });
  });

  it('pocket-tts-en carries its embeddings preset', () => {
    expect(downloadSpecs('pocket-tts-en').files).toEqual([
      ['audio-cpp/audio.cpp-gguf', 'PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf'],
      ['audio-cpp/audio.cpp-gguf', 'PocketTTS-GGUF/english/embeddings/alba.safetensors'],
    ]);
  });

  it('pocket-tts-de has no preset', () => {
    expect(downloadSpecs('pocket-tts-de').files).toEqual([['audio-cpp/audio.cpp-gguf', 'PocketTTS-GGUF/german/pocket-tts-german-q8_0.gguf']]);
  });

  it("a TTS variant override keeps the card's preset", () => {
    const bf16 = ttsModel('pocket-tts-en')!.deployments.find((d) => d.computeType === 'bf16')!.artifact;
    expect(downloadSpecs('pocket-tts-en', bf16).files).toEqual([
      ['audio-cpp/audio.cpp-gguf', 'PocketTTS-GGUF/english/pocket-tts-english-bf16.gguf'],
      ['audio-cpp/audio.cpp-gguf', 'PocketTTS-GGUF/english/embeddings/alba.safetensors'],
    ]);
  });

  it('a TTS spec never probes the hardware, on any platform', () => {
    resetProbeForTests();
    seams.nativeDevices = () => { throw new Error('probe() must not run for a download spec'); };
    seams.nativeProfiles = () => { throw new Error('probe() must not run for a download spec'); };
    for (const sys of ['Linux', 'Windows', 'Darwin']) {
      seams.system = () => sys;
      expect(downloadSpecs('moss-tts-nano').files?.length).toBeGreaterThan(0);
    }
  });

  it('translation specs come from the catalog; an override still wins', () => {
    expect(downloadSpecs('translategemma-4b').files).toEqual(fileSpec('translategemma-4b', 'q4_k_m'));
    const artifact = gguf('hy-mt2-7b', 'q8_0');
    expect(downloadSpecs('hy-mt2-7b', artifact).files).toEqual([splitArtifact(artifact)]);
  });

  it("equal the Python engine's, with its sizes, for every card", () => {
    const cases = golden.cases as Array<{ id: string; download_specs: unknown; model_size: number }>;
    expect(cases.length).toBeGreaterThan(80);
    for (const c of cases) {
      expect([c.id, downloadSpecs(c.id)]).toEqual([c.id, c.download_specs]);
      expect([c.id, modelSize(c.id)]).toEqual([c.id, c.model_size]);
    }
  });
});

describe('the ignore filter', () => {
  it('globs span directories; an exact name matches only itself', () => {
    expect(ignored('train/deepspeed/train.py', ['train/*', 'imgs/*'])).toBe(true);
    expect(ignored('imgs/overview.png', ['train/*', 'imgs/*'])).toBe(true);
    expect(ignored('model.safetensors', ['train/*', 'imgs/*'])).toBe(false);
    expect(ignored('tf_model.h5', ['tf_model.h5', 'rust_model.ot'])).toBe(true);
    expect(ignored('pytorch_model.bin', ['tf_model.h5', 'rust_model.ot'])).toBe(false);
  });
});

describe('model sizes', () => {
  it("a catalog card's size comes from the catalog, without the network", async () => {
    const before = hub.requests.length;
    expect(await modelSizeAsync('sense-voice', { endpoint: hub.url })).toBe(252684608);
    expect(await modelSizeAsync('hy-mt2-1.8b', { endpoint: hub.url })).toBe(1133080448);
    expect(await modelSizeAsync('moss-tts-nano', { endpoint: hub.url })).toBe(193337984);
    expect(hub.requests.length).toBe(before);
  });

  it('an artifact looks up that one file', async () => {
    hub.addFile('unsloth/Qwen3.5-0.8B-GGUF', 'Qwen3.5-0.8B-Q8_0.gguf', 'x', { size: 811843840 });
    hub.addFile('unsloth/Qwen3.5-0.8B-GGUF', 'other.gguf', 'y', { size: 5 });
    expect(await modelSizeAsync('unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf', { endpoint: hub.url })).toBe(811843840);
    expect(modelSize('unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf')).toBe(811843840);   // cached for the sync readers
  });

  it("a bare repo id sums the repo's files; an unreachable one is 0", async () => {
    hub.addFile('acme/sized', 'model.safetensors', 'm', { size: 8_000_000_000 });
    hub.addFile('acme/sized', 'config.json', '{}', { lfs: false, size: 1000 });
    expect(await modelSizeAsync('acme/sized', { endpoint: hub.url })).toBe(8_000_001_000);
    expect(await modelSizeAsync('acme/missing', { endpoint: hub.url })).toBe(0);
    expect(modelSize('not-cached-anywhere')).toBeNull();
  });

  it("a repo's size leaves out the ignored files", async () => {
    hub.addFile('acme/ignoring', 'model.safetensors', 'm', { size: 8_000_000_000 });
    hub.addFile('acme/ignoring', 'consolidated.safetensors', 'c', { size: 8_000_000_000 });
    hub.addFile('acme/ignoring', 'config.json', '{}', { lfs: false, size: 1000 });
    sizeSeams.downloadSpecs = () => ({ repos: ['acme/ignoring'], urls: [], ignore: ['consolidated.safetensors'] });
    expect(await modelSizeAsync('not-a-catalog-model', { endpoint: hub.url })).toBe(8_000_001_000);
  });

  it.skipIf(!process.env.SOKUJI_RUN_ASR_MODEL)('the real sense-voice size', async () => {
    expect(await modelSizeAsync('sense-voice')).toBeGreaterThan(100_000_000);
  });
});
