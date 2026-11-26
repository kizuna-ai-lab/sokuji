// @vitest-environment node
/**
 * Model status from the hub cache (ported from sidecar/tests/test_native_models.py). Python fakes hf_hub_download and
 * snapshot_download; here every case builds the real cache layout under a fresh HF_HOME.
 */
import '../test/env';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TTS_STAGING_DIRNAME, ttsModel } from '../catalog';
import { cacheArtifact, cacheFile, cacheRepo, freshHfHome, hub } from '../test/hfFixture';
import { modelStatus } from './status';

const ttsArtifact = (id: string, ct: string) => ttsModel(id)!.deployments.find((d) => d.computeType === ct)!.artifact;
const POCKET_EN_ALBA = 'audio-cpp/audio.cpp-gguf/PocketTTS-GGUF/english/embeddings/alba.safetensors';

let cleanup: () => void;
beforeEach(() => {
  cleanup = freshHfHome();
});
afterEach(() => cleanup());

describe('model status', () => {
  it('an interrupted download reads absent; a stale leftover beside its finished blob does not', () => {
    const repo = 'csukuangfj/vits-piper-en_US-amy-low';                       // a whole-repo spec
    const { blobs } = cacheRepo(repo);
    fs.writeFileSync(path.join(blobs, 'abc123'), 'a finalized blob');
    expect(modelStatus(repo)).toBe('ready');
    fs.writeFileSync(path.join(blobs, 'def456.a1b2c3.incomplete'), 'half-fetched');
    expect(modelStatus(repo)).toBe('absent');
    fs.writeFileSync(path.join(blobs, 'def456'), 'now finalized');
    expect(modelStatus(repo)).toBe('ready');
  });

  it('a whole-repo override is checked against that repo', () => {
    expect(modelStatus('hy-mt2-1.8b', 'tencent/Hy-MT2-1.8B-FP8')).toBe('absent');
    cacheRepo('tencent/Hy-MT2-1.8B-FP8');
    expect(modelStatus('hy-mt2-1.8b', 'tencent/Hy-MT2-1.8B-FP8')).toBe('ready');
    expect(modelStatus('hy-mt2-1.8b')).toBe('absent');                          // the card's own default is not cached
  });

  it('a GGUF card with nothing cached is absent, not an error', () => {
    expect(modelStatus('qwen2.5-0.5b')).toBe('absent');
  });

  it('a multi-quant card is ready when any rung is cached', () => {
    expect(modelStatus('fun-asr-mlt-nano')).toBe('absent');
    cacheArtifact('handy-computer/Fun-ASR-MLT-Nano-2512-gguf/Fun-ASR-MLT-Nano-2512-Q8_0.gguf');   // not the Q6_K default
    expect(modelStatus('fun-asr-mlt-nano')).toBe('ready');
  });

  it('a named variant must itself be cached', () => {
    cacheArtifact('handy-computer/Fun-ASR-MLT-Nano-2512-gguf/Fun-ASR-MLT-Nano-2512-Q8_0.gguf');
    expect(modelStatus('fun-asr-mlt-nano', 'handy-computer/Fun-ASR-MLT-Nano-2512-gguf/Fun-ASR-MLT-Nano-2512-Q6_K.gguf')).toBe('absent');
    expect(modelStatus('fun-asr-mlt-nano', 'handy-computer/Fun-ASR-MLT-Nano-2512-gguf/Fun-ASR-MLT-Nano-2512-Q8_0.gguf')).toBe('ready');
  });

  it('a TTS card is ready when any rung is cached', () => {
    cacheArtifact(ttsArtifact('moss-tts-nano', 'bf16'));                       // not the q8_0 default
    expect(modelStatus('moss-tts-nano')).toBe('ready');
  });

  it("a TTS card's preset is required on the bare path", () => {
    cacheArtifact(ttsArtifact('pocket-tts-en', 'q8_0'));
    expect(modelStatus('pocket-tts-en')).toBe('absent');
    cacheArtifact(POCKET_EN_ALBA);
    expect(modelStatus('pocket-tts-en')).toBe('ready');
  });

  it('a named TTS variant must itself be cached', () => {
    cacheArtifact(ttsArtifact('moss-tts-nano', 'bf16'));
    expect(modelStatus('moss-tts-nano', ttsArtifact('moss-tts-nano', 'q8_0'))).toBe('absent');
    expect(modelStatus('moss-tts-nano', ttsArtifact('moss-tts-nano', 'bf16'))).toBe('ready');
  });

  it("a named TTS variant needs the card's preset too", () => {
    const q8 = ttsArtifact('pocket-tts-en', 'q8_0');
    cacheArtifact(q8);
    expect(modelStatus('pocket-tts-en', q8)).toBe('absent');
    cacheArtifact(POCKET_EN_ALBA);
    expect(modelStatus('pocket-tts-en', q8)).toBe('ready');
  });

  it('the TTS staging tree does not change a status', () => {
    cacheArtifact(ttsArtifact('moss-tts-nano', 'q8_0'));
    expect(modelStatus('moss-tts-nano')).toBe('ready');
    const staged = path.join(hub(), TTS_STAGING_DIRNAME, 'audio-cpp--audio.cpp-gguf__rev1', 'MOSS-TTS-Nano-100M-GGUF');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'moss-tts-nano-100m-q8_0.gguf'), 'x');
    expect(modelStatus('moss-tts-nano')).toBe('ready');
    expect(modelStatus('moss-tts-nano', ttsArtifact('moss-tts-nano', 'bf16'))).toBe('absent');   // a staged file is not a cached one
  });

  it('a dangling snapshot link is not cached', () => {
    const { blob } = cacheFile('handy-computer/whisper-base-gguf', 'whisper-base-Q8_0.gguf');
    expect(modelStatus('whisper-base', 'handy-computer/whisper-base-gguf/whisper-base-Q8_0.gguf')).toBe('ready');
    fs.rmSync(blob);
    expect(modelStatus('whisper-base', 'handy-computer/whisper-base-gguf/whisper-base-Q8_0.gguf')).toBe('absent');
  });
});

/** The Python engine's statuses against one real cache: run export_goldens.py with --hf-cache, point both here. */
const goldenCache = process.env.SOKUJI_GOLDEN_HF_CACHE;
const goldenStatus = process.env.SOKUJI_GOLDEN_STATUS ?? path.join(__dirname, '..', 'test', 'golden', 'status.json');
describe.skipIf(!goldenCache || !fs.existsSync(goldenStatus))('against a real cache', () => {
  it('agrees with the Python engine on every card', () => {
    process.env.HF_HOME = goldenCache;
    const cases = (JSON.parse(fs.readFileSync(goldenStatus, 'utf8')) as { cases: Array<{ id: string; model_status: string }> }).cases;
    expect(cases.length).toBeGreaterThan(80);
    const mismatched = cases.filter((c) => modelStatus(c.id) !== c.model_status).map((c) => c.id);
    expect(mismatched).toEqual([]);
  });
});

describe.skipIf(!process.env.SOKUJI_RUN_ASR_MODEL)('the real cache', () => {
  it('a downloaded repo is ready, a bogus one absent', () => {
    process.env.HF_HOME = process.env.SOKUJI_REAL_HF_HOME ?? path.join(process.env.HOME ?? '', '.cache', 'huggingface');
    expect(modelStatus('FunAudioLLM/SenseVoiceSmall')).toBe('ready');
    expect(modelStatus('csukuangfj/this-repo-does-not-exist-xyz')).toBe('absent');
  });
});
