// @vitest-environment node
/**
 * The model catalog (ported from sidecar/tests/test_catalog.py): every card equals the Python catalog's
 * (catalog.json), and the facts the Python suite pins about the roster hold here too. Three Python tests need what
 * later tasks port and move with them: test_llm_vulkan_tier_ranks_above_cpu (planner, Task 5),
 * test_all_translate_backends_installed_names (accel, Task 6) and the backend half of
 * test_voice_required_families_is_the_single_source_of_truth (tts, Task 10); the addon-load half of
 * test_asr_graph_family_matches_native_arch runs in Task 11.
 */
import '../test/env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import golden from '../test/golden/catalog.json';
import { GGML_TYPE_NAMES, readHeader } from '../ggufHeader';
import {
  ALL_PLATFORMS, GGUF_SOURCES, RUNG_FALLBACK_DTYPES, TRANSLATE_MODELS, TTS_TIERS, TTS_TIER_OVERRIDES,
  VOICE_REQUIRED_FAMILIES, WEIGHT_CAPABLE_DTYPES, asrModel, asrModels, deployment, licenseDict, resolveTtsCard,
  splitArtifact, tcRow, translateModel, translateModels, ttsModel, ttsModels, voiceCapability, type ModelBase,
} from './index';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE = path.join(os.homedir(), '.cache', 'sokuji-native-tests');
const allCards = (): ModelBase[] => [...asrModels(), ...translateModels(), ...ttsModels()];
const must = <T>(v: T | null): T => {
  if (v === null) throw new Error('missing card');
  return v;
};
const ctRank = (m: ModelBase) => Object.fromEntries(m.deployments.map((d) => [d.computeType, d.rank]));
const tiersOf = (m: ModelBase) => new Set(m.deployments.map((d) => d.tier));
const quantsOf = (m: ModelBase) => new Set(m.deployments.map((d) => d.computeType));

/** A card as the Python exporter wrote it: snake_case keys, nulls for None, lists for tuples. */
function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (value instanceof Set) return [...value].map(snake);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), snake(v)]));
  }
  return value;
}

describe('the catalog equals the Python catalog', () => {
  const byKind = { asr: asrModels(), translate: translateModels(), tts: ttsModels() } as const;
  it.each(golden.cases.map((c) => [`${c.kind}:${c.id}`, c] as const))('%s', (_label, c) => {
    const card = byKind[c.kind as keyof typeof byKind].find((m) => m.id === c.id);
    expect(card, c.id).toBeDefined();
    expect(snake(card)).toEqual(c.card);
    expect(c.split_artifact.map((s) => ({ artifact: s.artifact, result: splitArtifact(s.artifact) }))).toEqual(c.split_artifact);
    if (c.kind === 'tts') {
      const tts = card as ReturnType<typeof ttsModels>[number];
      expect(voiceCapability(tts)).toEqual(c.voice_capability);
      expect(licenseDict(tts)).toEqual(c.license_dict);
    }
  });

  it('holds every card in the order asrModels/translateModels/ttsModels give them', () => {
    const order = golden.cases.map((c) => `${c.kind}:${c.id}`);
    expect([...asrModels().map((m) => `asr:${m.id}`), ...translateModels().map((m) => `translate:${m.id}`), ...ttsModels().map((m) => `tts:${m.id}`)]).toEqual(order);
  });
});

describe('ASR cards', () => {
  it('have deployments and languages, on the native ASR backends and the three tiers', () => {
    for (const m of asrModels()) {
      expect(m.deployments.length, m.id).toBeGreaterThan(0);
      expect(m.languages.length, m.id).toBeGreaterThan(0);
      for (const d of m.deployments) {
        expect(['native_asr', 'native_asr_stream']).toContain(d.backend);
        expect(['gpu-vulkan', 'gpu-metal', 'cpu']).toContain(d.tier);
      }
    }
  });

  it('the system has a CPU floor', () => {
    expect(asrModels().some((m) => m.deployments.some((d) => d.tier === 'cpu'))).toBe(true);
  });

  it('ids are unique', () => {
    const ids = asrModels().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('looks up a known id and answers null for an unknown one', () => {
    expect(must(asrModel('sense-voice')).name).toBe('SenseVoice');
    expect(asrModel('does-not-exist')).toBeNull();
  });

  it('language fixtures never silently regress', () => {
    expect(must(asrModel('sense-voice')).languages).toEqual(['zh', 'en', 'ja', 'ko', 'yue']);
    expect(must(asrModel('whisper-large-v3')).languages).toEqual(['multi']);
  });

  it('every row is a native ASR GGUF from handy-computer', () => {
    for (const m of asrModels()) {
      for (const d of m.deployments) {
        expect(['native_asr', 'native_asr_stream']).toContain(d.backend);
        const [repo, fname] = splitArtifact(d.artifact);
        expect(repo.startsWith('handy-computer/') && (fname ?? '').endsWith('.gguf'), d.artifact).toBe(true);
      }
    }
  });

  it('sense-voice: q8_0 default first, the full ladder after it', () => {
    const m = must(asrModel('sense-voice'));
    expect(m.recommended).toBe(false);
    expect(m.sortOrder).toBe(130);
    expect(m.deployments[0].computeType).toBe('q8_0');
    expect(m.deployments[0].rank).toBe(2.0);
    expect(m.deployments[0].artifact).toBe('handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf');
    expect(ctRank(m)).toEqual({ q8_0: 2.0, f16: 0.5, q6_k: 1.0, q5_k_m: 0.5, q4_k_m: 1.0 });
  });

  it('granite language fixtures', () => {
    expect(must(asrModel('granite-speech-4.1-2b')).languages).toEqual(['en', 'fr', 'de', 'es', 'pt', 'ja']);
    expect(must(asrModel('granite-speech-4.1-2b-plus')).languages).toEqual(['en', 'fr', 'de', 'es', 'pt']);
  });

  it('qwen3-asr-1.7b', () => {
    const m = must(asrModel('qwen3-asr-1.7b'));
    expect(m.languages).toEqual(['zh', 'en', 'ja', 'ko', 'yue', 'ar', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'th', 'vi', 'hi', 'id']);
    expect(m.recommended).toBe(true);
    expect(m.sortOrder).toBe(40);
    const d = m.deployments[0];
    expect([d.backend, d.tier, d.computeType, d.artifact]).toEqual(['native_asr', 'gpu-vulkan', 'q4_k_m', 'handy-computer/Qwen3-ASR-1.7B-gguf/Qwen3-ASR-1.7B-Q4_K_M.gguf']);
  });

  it('granite speech 5.0 TurboCTC, and not its -nc sibling', () => {
    const m = must(asrModel('granite-speech-5.0-470m-turboctc'));
    expect(m.name).toBe('Granite Speech 5.0 TurboCTC (470M)');
    expect(m.languages).toEqual(['en']);
    expect(m.recommended).toBe(false);
    expect(m.sortOrder).toBe(22);
    expect(m.graphFamily).toBe('granite_speech5_ctc');
    expect(m.sizeBytes).toBe(505606496);
    const d = m.deployments[0];
    expect([d.backend, d.computeType, d.artifact]).toEqual(['native_asr', 'q8_0', 'handy-computer/granite-speech-5.0-470m-turboctc-gguf/granite-speech-5.0-470m-turboctc-Q8_0.gguf']);
    expect(asrModel('granite-speech-5.0-470m-turboctc-nc')).toBeNull();
  });

  it('cohere transcribe', () => {
    const m = must(asrModel('cohere-transcribe-03-2026'));
    expect(m.name).toBe('Cohere Transcribe');
    expect(m.languages).toEqual(['en', 'de', 'fr', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'ar', 'vi', 'zh', 'ja', 'ko']);
    expect(m.recommended).toBe(true);
    expect(m.sortOrder).toBe(10);
    expect(m.deployments[0].computeType).toBe('q4_k_m');
    expect(m.deployments[0].rank).toBe(2.0);
    expect(m.deployments[0].artifact).toBe('handy-computer/cohere-transcribe-03-2026-gguf/cohere-transcribe-03-2026-Q4_K_M.gguf');
    expect(ctRank(m)).toEqual({ q4_k_m: 2.0, f16: 0.5, q8_0: 1.0, q6_k: 1.0, q5_k_m: 0.5 });
    expect(m.sizeBytes).toBe(1558162944);
  });

  it('the roster is WER-ranked', () => {
    const ids = asrModels().map((m) => m.id);
    expect(ids[0]).toBe('cohere-transcribe-03-2026');
    expect(ids).toHaveLength(67);
    const orders = asrModels().map((m) => m.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(asrModels().filter((m) => m.recommended)).toHaveLength(7);
  });

  it('parakeet primeline', () => {
    const m = must(asrModel('parakeet-primeline'));
    expect(m.name).toBe('Parakeet Primeline (de)');
    expect(m.languages).toEqual(must(asrModel('parakeet-tdt-0.6b-v3')).languages);
    expect(m.recommended).toBe(false);
    expect(m.sortOrder).toBe(81);
    expect(m.deployments[0].backend).toBe('native_asr');
    expect(m.deployments[0].computeType).toBe('q8_0');
    expect(m.deployments[0].artifact).toBe('handy-computer/parakeet-primeline-gguf/parakeet-primeline-Q8_0.gguf');
    expect(m.sizeBytes).toBe(739508640);
  });

  it('moss transcribe diarize', () => {
    const m = must(asrModel('moss-transcribe-diarize'));
    expect(m.name).toBe('MOSS Transcribe (0.9B)');
    expect(m.languages).toEqual(['en', 'zh']);
    expect(m.recommended).toBe(false);
    expect(m.sortOrder).toBe(85);
    expect(m.deployments[0].backend).toBe('native_asr');
    expect(m.deployments[0].computeType).toBe('q8_0');
    expect(m.deployments[0].artifact).toBe('handy-computer/moss-transcribe-diarize-gguf/MOSS-Transcribe-Diarize-Q8_0.gguf');
    expect(m.sizeBytes).toBe(986899616);
    expect(ctRank(m)).toEqual({ q8_0: 2.0, f16: 0.5, q6_k: 1.0, q5_k_m: 0.5, q4_k_m: 1.0 });
  });

  it('multitalker parakeet streaming: the root GGUF, not the bundle one', () => {
    const m = must(asrModel('multitalker-parakeet-streaming-0.6b-v1'));
    expect(m.name).toBe('Parakeet Multitalker Streaming 0.6B (en)');
    expect(m.languages).toEqual(['en']);
    expect(m.recommended).toBe(false);
    expect(m.sortOrder).toBe(114);
    const d = m.deployments[0];
    expect(d.backend).toBe('native_asr_stream');
    expect(d.computeType).toBe('q8_0');
    expect(d.artifact).toBe('handy-computer/multitalker-parakeet-streaming-0.6b-v1-gguf/multitalker-parakeet-streaming-0.6b-v1-Q8_0.gguf');
    expect(m.sizeBytes).toBe(734123712);
  });

  it("whisper-large-v3-turbo's sizes match the 2026-07-21 re-upload", () => {
    const m = must(asrModel('whisper-large-v3-turbo'));
    expect(Object.fromEntries(m.deployments.map((d) => [d.computeType, d.estBytes]))).toEqual({
      q8_0: 886381760, f16: 1625935520, q6_k: 692536928, q5_k_m: 619628128, q4_k_m: 536069728,
    });
    expect(m.sizeBytes).toBe(886381760);
  });

  it('voxtral realtime: the streaming twin', () => {
    const m = must(asrModel('voxtral-mini-4b-realtime'));
    expect(m.name).toBe('Voxtral Mini 4B Realtime');
    expect(m.languages).toEqual(['en', 'fr', 'es', 'de', 'ru', 'zh', 'ja', 'it', 'pt', 'nl', 'ar', 'hi', 'ko']);
    expect(m.recommended).toBe(true);
    expect(m.sortOrder).toBe(100);
    const d = m.deployments[0];
    expect([d.backend, d.tier, d.computeType, d.artifact]).toEqual(['native_asr_stream', 'gpu-vulkan', 'q4_k_m', 'handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf/Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf']);
  });

  it('fun-asr-mlt-nano: q6_k default', () => {
    const m = must(asrModel('fun-asr-mlt-nano'));
    expect(m.name).toBe('Fun-ASR MLT Nano');
    expect(m.recommended).toBe(true);
    expect(m.languages).toHaveLength(31);
    expect(m.languages.slice(0, 6)).toEqual(['zh', 'en', 'yue', 'ja', 'ko', 'vi']);
    expect(m.deployments[0].computeType).toBe('q6_k');
    expect(m.deployments[0].rank).toBe(2.0);
    expect(m.deployments[0].artifact).toBe('handy-computer/Fun-ASR-MLT-Nano-2512-gguf/Fun-ASR-MLT-Nano-2512-Q6_K.gguf');
    expect(quantsOf(m)).toEqual(new Set(['q6_k', 'f16', 'q8_0', 'q5_k_m', 'q4_k_m']));
  });
});

const TTS_CARD_IDS = ['moss-tts-nano', 'supertonic-3', 'qwen3-tts-0.6b', 'qwen3-tts-1.7b', 'omnivoice-0.6b', 'pocket-tts-en', 'pocket-tts-de', 'pocket-tts-es',
  'pocket-tts-it', 'pocket-tts-pt', 'voxcpm1-0.5b', 'voxcpm2', 'irodori-tts-v4-small', 'index-tts2.5'];
const NEW_2026_09_03_TTS_CARD_IDS = ['voxcpm1-0.5b', 'voxcpm2', 'irodori-tts-v4-small', 'index-tts2.5'];
const EVERY_TIER = new Set(['cpu', 'gpu-vulkan', 'gpu-metal']);

describe('TTS cards', () => {
  it('are the fourteen native TTS cards', () => {
    const ids = ttsModels().map((m) => m.id);
    expect(new Set(ids)).toEqual(new Set(TTS_CARD_IDS));
    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
  });

  it('have deployments, languages and a family, on native_tts and the three tiers', () => {
    for (const m of ttsModels()) {
      expect(m.deployments.length, m.id).toBeGreaterThan(0);
      expect(m.languages.length, m.id).toBeGreaterThan(0);
      expect(m.family, m.id).toBeTruthy();
      for (const d of m.deployments) {
        expect(d.backend).toBe('native_tts');
        expect(EVERY_TIER.has(d.tier)).toBe(true);
      }
    }
  });

  it('artifacts are audio.cpp GGUF files', () => {
    for (const m of ttsModels()) {
      for (const d of m.deployments) {
        expect(d.artifact.startsWith('audio-cpp/audio.cpp-gguf/'), d.artifact).toBe(true);
        expect(d.artifact.endsWith('.gguf'), d.artifact).toBe(true);
      }
    }
  });

  it('have a CPU floor and unique ids', () => {
    const ids = ttsModels().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of ttsModels()) expect(m.deployments.some((d) => d.tier === 'cpu'), m.id).toBe(true);
  });

  it('every quant carries every tier; the default is rank 2.0, any other 1.0', () => {
    for (const m of ttsModels()) {
      const byCt = new Map<string, Set<string>>();
      for (const d of m.deployments) byCt.set(d.computeType, (byCt.get(d.computeType) ?? new Set()).add(d.tier));
      for (const [ct, tiers] of byCt) expect(tiers, `${m.id} ${ct}`).toEqual(EVERY_TIER);
      const ranks = Object.values(ctRank(m));
      expect(Math.max(...ranks), m.id).toBe(2.0);
      expect(ranks.every((r) => r === 1.0 || r === 2.0), m.id).toBe(true);
    }
  });

  it('pocket TTS has gpu-vulkan (R29)', () => {
    for (const mid of ['pocket-tts-en', 'pocket-tts-de', 'pocket-tts-es', 'pocket-tts-it', 'pocket-tts-pt']) {
      const m = must(ttsModel(mid));
      expect(m.family).toBe('pocket_tts');
      expect(tiersOf(m), mid).toEqual(EVERY_TIER);
    }
  });

  it('a family with no override is CPU only', () => {
    expect(TTS_TIER_OVERRIDES.some_future_unvalidated_family ?? TTS_TIERS).toEqual(['cpu']);
    expect('some_future_unvalidated_family' in TTS_TIER_OVERRIDES).toBe(false);
  });

  it('omnivoice', () => {
    const m = must(ttsModel('omnivoice-0.6b'));
    expect(m.family).toBe('omnivoice');
    expect(m.languages).toEqual(['multi']);
    expect(m.clones).toBe(true);
    expect(m.transcriptRequired).toBe(true);
    expect(m.namedVoices).toBe(false);
    expect(m.streaming).toBe(true);
    expect(m.sampleRate).toBe(24000);
    expect(quantsOf(m)).toEqual(new Set(['q8_0', 'bf16']));
    const def = must(m.deployments.find((d) => d.rank === 2.0) ?? null);
    expect(def.computeType).toBe('q8_0');
    expect(def.artifact).toBe('audio-cpp/audio.cpp-gguf/OmniVoice-GGUF/omnivoice-q8_0.gguf');
    expect(m.sizeBytes).toBe(1_350_288_416);
  });

  it("omnivoice's licence, and none elsewhere", () => {
    const m = must(ttsModel('omnivoice-0.6b'));
    const lic = must(m.license);
    expect(lic.spdx).toBe('CC-BY-NC-4.0');
    expect(lic.nonCommercial).toBe(true);
    expect(lic.sourceRepo).toBe('audio-cpp/audio.cpp-gguf');
    expect(lic.attribution).toBe('k2-fsa/OmniVoice');
    expect(lic.requiresConsent).toBe(true);
    expect(licenseDict(m)).toEqual({
      spdx: 'CC-BY-NC-4.0',
      name: 'Creative Commons Attribution-NonCommercial 4.0 International',
      url: 'https://creativecommons.org/licenses/by-nc/4.0/',
      nonCommercial: true,
      requiresConsent: true,
      sourceRepo: 'audio-cpp/audio.cpp-gguf',
      attribution: 'k2-fsa/OmniVoice',
    });
    expect(must(ttsModel('moss-tts-nano')).license).toBeNull();
    expect(licenseDict(must(ttsModel('moss-tts-nano')))).toBeNull();
  });

  it('the 2026-09-03 cards carry every tier', () => {
    for (const mid of NEW_2026_09_03_TTS_CARD_IDS) {
      const m = must(ttsModel(mid));
      expect(TTS_TIER_OVERRIDES[m.family], mid).toEqual(['gpu-vulkan', 'gpu-metal', 'cpu']);
      expect(tiersOf(m), mid).toEqual(EVERY_TIER);
    }
  });

  it('the VoxCPM cards', () => {
    const v1 = must(ttsModel('voxcpm1-0.5b'));
    expect(v1.family).toBe('voxcpm1');
    expect(v1.languages).toEqual(['zh', 'en', 'ja', 'ko']);
    expect(v1.streaming && v1.clones).toBe(true);
    expect(v1.transcriptRequired || v1.namedVoices).toBe(false);
    expect(v1.sampleRate).toBe(16000);
    expect(v1.recommended).toBe(false);
    expect(quantsOf(v1)).toEqual(new Set(['q8_0']));
    expect(v1.sizeBytes).toBe(847_888_032);
    const v2 = must(ttsModel('voxcpm2'));
    expect(v2.family).toBe('voxcpm2');
    expect(v2.languages).toHaveLength(30);
    expect(v2.languages.includes('ja') && v2.languages.includes('zh')).toBe(true);
    expect(v2.languages.every((code) => !code.includes(' '))).toBe(true);
    expect(v2.streaming && v2.clones).toBe(true);
    expect(v2.transcriptRequired || v2.namedVoices).toBe(false);
    expect(v2.sampleRate).toBe(48000);
    expect(quantsOf(v2)).toEqual(new Set(['q8_0', 'bf16']));
    expect(must(v2.deployments.find((d) => d.rank === 2.0) ?? null).computeType).toBe('q8_0');
    expect(v2.sizeBytes).toBe(2_955_000_480);
  });

  it('irodori is Japanese only and offline', () => {
    const m = must(ttsModel('irodori-tts-v4-small'));
    expect(m.family).toBe('irodori_tts');
    expect(m.languages).toEqual(['ja']);
    expect(m.streaming).toBe(false);
    expect(m.clones).toBe(true);
    expect(m.transcriptRequired).toBe(false);
    expect(m.namedVoices).toBe(false);
    expect(m.sampleRate).toBe(48000);
    expect(quantsOf(m)).toEqual(new Set(['q8_0', 'f16']));
    expect(m.sizeBytes).toBe(1_368_991_360);
  });

  it('IndexTTS 2.5 and its licence', () => {
    const m = must(ttsModel('index-tts2.5'));
    expect(m.family).toBe('index_tts2');
    expect(m.languages).toEqual(['zh', 'en', 'ja', 'es', 'ar']);
    expect(m.streaming).toBe(false);
    expect(m.clones).toBe(true);
    expect(m.transcriptRequired).toBe(false);
    expect(m.namedVoices).toBe(false);
    expect(m.sampleRate).toBe(22050);
    expect(m.sizeBytes).toBe(3_502_955_328);
    const lic = must(m.license);
    expect(lic.spdx).toBe('LicenseRef-bilibili-Model-Use-License');
    expect(lic.nonCommercial).toBe(false);
    expect(lic.requiresConsent).toBe(true);
    expect(must(licenseDict(m)).requiresConsent).toBe(true);
    expect(must(licenseDict(m)).nonCommercial).toBe(false);
  });

  it('IndexTTS 2.5 is the only 2026-09-03 card with a licence', () => {
    for (const mid of ['voxcpm1-0.5b', 'voxcpm2', 'irodori-tts-v4-small']) {
      const m = must(ttsModel(mid));
      expect(m.license, mid).toBeNull();
      expect(licenseDict(m), mid).toBeNull();
    }
  });

  it('MOSS-TTS-Nano is offline and clones', () => {
    const m = must(ttsModel('moss-tts-nano'));
    expect(m.family).toBe('moss_tts_nano');
    expect(m.streaming).toBe(false);
    expect(m.clones).toBe(true);
    expect(m.namedVoices).toBe(false);
    expect(m.recommended).toBe(true);
    expect(m.sampleRate).toBe(48000);
  });

  it('an unknown TTS id is null', () => {
    expect(ttsModel('does-not-exist')).toBeNull();
  });

  it('resolveTtsCard returns the catalog row for a static id', () => {
    expect(resolveTtsCard('moss-tts-nano')).toBe(ttsModel('moss-tts-nano'));
  });

  it('resolveTtsCard answers null for an unknown id', () => {
    expect(resolveTtsCard('csukuangfj/vits-piper-xx-yy')).toBeNull();
    expect(resolveTtsCard('totally-unknown-xyz')).toBeNull();
  });

  it('pocket TTS cards carry their load language; only English has presets', () => {
    const langs: Record<string, string> = { 'pocket-tts-en': 'english', 'pocket-tts-de': 'german', 'pocket-tts-es': 'spanish', 'pocket-tts-it': 'italian', 'pocket-tts-pt': 'portuguese' };
    for (const [mid, loadLanguage] of Object.entries(langs)) {
      const m = must(ttsModel(mid));
      expect(m.family).toBe('pocket_tts');
      expect(m.loadLanguage).toBe(loadLanguage);
      expect(m.clones).toBe(true);
      expect(m.streaming).toBe(false);
      if (mid === 'pocket-tts-en') {
        expect(m.namedVoices).toBe(true);
        expect(m.extraFiles).toEqual([['embeddings/alba.safetensors', 6194424]]);
      } else {
        expect(m.namedVoices).toBe(false);
        expect(m.extraFiles).toEqual([]);
      }
    }
  });

  it("the languages cover the renderer's set", () => {
    const langs = new Set(ttsModels().flatMap((m) => m.languages));
    for (const l of ['en', 'de', 'es', 'fr', 'it', 'ru', 'zh']) expect(langs.has(l), l).toBe(true);
  });

  it('voice capability map', () => {
    const cap = (id: string) => voiceCapability(must(ttsModel(id)));
    expect(cap('moss-tts-nano')).toEqual({ builtin: 'none', custom: 'clip', required: false });
    expect(cap('supertonic-3')).toEqual({ builtin: 'named', custom: 'none', required: false });
    expect(cap('pocket-tts-en')).toEqual({ builtin: 'named', custom: 'clip', required: false });
    expect(cap('pocket-tts-de')).toEqual({ builtin: 'none', custom: 'clip', required: false });
    expect(cap('omnivoice-0.6b')).toEqual({ builtin: 'none', custom: 'clip', required: true, transcriptRequired: true });
  });

  it('`required` is its own axis, not inferred from the shape', () => {
    const cap = (id: string) => voiceCapability(must(ttsModel(id)));
    for (const mid of ['moss-tts-nano', 'voxcpm1-0.5b', 'voxcpm2', 'irodori-tts-v4-small', 'omnivoice-0.6b', 'index-tts2.5']) {
      const c = cap(mid);
      expect([c.builtin, c.custom], mid).toEqual(['none', 'clip']);
    }
    for (const mid of ['moss-tts-nano', 'voxcpm1-0.5b', 'voxcpm2', 'irodori-tts-v4-small', 'supertonic-3', 'pocket-tts-en', 'pocket-tts-de']) expect(cap(mid).required, mid).toBe(false);
    for (const mid of ['qwen3-tts-0.6b', 'qwen3-tts-1.7b', 'omnivoice-0.6b', 'index-tts2.5']) expect(cap(mid).required, mid).toBe(true);
    for (const m of ttsModels()) expect('required' in voiceCapability(m), m.id).toBe(true);
  });

  it('VOICE_REQUIRED_FAMILIES is what `required` reads', () => {
    expect(VOICE_REQUIRED_FAMILIES).toEqual(new Set(['qwen3_tts', 'omnivoice', 'index_tts2']));
    for (const m of ttsModels()) expect(voiceCapability(m).required, m.id).toBe(VOICE_REQUIRED_FAMILIES.has(m.family));
  });

  it('supertonic', () => {
    const m = must(ttsModel('supertonic-3'));
    expect(m.sampleRate).toBe(44100);
    expect(m.clones).toBe(false);
    expect(m.namedVoices).toBe(true);
    expect(m.family).toBe('supertonic');
    expect(new Set(m.deployments.map((d) => d.backend))).toEqual(new Set(['native_tts']));
    expect(tiersOf(m)).toEqual(EVERY_TIER);
    expect(quantsOf(m)).toEqual(new Set(['f16']));
  });

  it('the Qwen3 rows and their capability', () => {
    for (const mid of ['qwen3-tts-0.6b', 'qwen3-tts-1.7b']) {
      const m = must(ttsModel(mid));
      expect(m.clones && !m.streaming && m.sampleRate === 24000, mid).toBe(true);
      expect(m.transcriptRequired).toBe(true);
      expect(m.recommended).toBe(false);
      expect(new Set(m.deployments.map((d) => d.backend))).toEqual(new Set(['native_tts']));
      expect(voiceCapability(m)).toEqual({ builtin: 'none', custom: 'clip', required: true, transcriptRequired: true });
    }
    expect(must(ttsModel('moss-tts-nano')).recommended).toBe(true);
    expect(must(ttsModel('supertonic-3')).recommended).toBe(true);
  });
});

describe('translation cards', () => {
  it('only TranslateGemma uses the gemma prompt family', () => {
    expect(new Set(TRANSLATE_MODELS.filter((m) => m.promptFamily === 'gemma').map((m) => m.id))).toEqual(new Set(['translategemma-4b']));
  });

  it('the LLM rows: two quants, three tiers each, one artifact per quant', () => {
    const m = must(translateModel('translategemma-4b'));
    const quants = quantsOf(m);
    expect(quants).toEqual(new Set(['q4_k_m', 'q8_0']));
    const tiers = new Set(m.deployments.map((d) => `${d.computeType}|${d.tier}`));
    for (const q of quants) for (const t of ['gpu-metal', 'gpu-vulkan', 'cpu']) expect(tiers.has(`${q}|${t}`)).toBe(true);
    expect(m.deployments.some((d) => d.tier === 'gpu-cuda')).toBe(false);
    const def = m.deployments.reduce((a, b) => (b.rank > a.rank ? b : a));
    expect(def.computeType).toBe('q4_k_m');
    expect(m.deployments.every((d) => d.backend === 'native_translate')).toBe(true);
    expect(m.promptFamily).toBe('gemma');
    for (const q of quants) expect(new Set(m.deployments.filter((d) => d.computeType === q).map((d) => d.artifact)).size).toBe(1);
  });

  it('the small Qwens default to q8_0', () => {
    for (const mid of ['qwen2.5-0.5b', 'qwen3-0.6b']) {
      const m = must(translateModel(mid));
      expect(m.deployments.reduce((a, b) => (b.rank > a.rank ? b : a)).computeType, mid).toBe('q8_0');
      expect(m.deployments.every((d) => d.backend === 'native_translate')).toBe(true);
      expect(m.promptFamily).toBe('qwen');
    }
  });

  it('Hunyuan: native_translate, no fp8', () => {
    for (const mid of ['hy-mt2-1.8b', 'hy-mt2-7b', 'hy-mt15-1.8b', 'hy-mt15-7b']) {
      const m = must(translateModel(mid));
      expect(m.deployments.every((d) => d.backend === 'native_translate')).toBe(true);
      expect(m.deployments.every((d) => d.computeType === 'q4_k_m' || d.computeType === 'q8_0')).toBe(true);
      expect(m.promptFamily).toBe('hunyuan');
    }
  });

  it("GGUF artifact naming keeps upstream's case quirks", () => {
    const artifact = (mid: string, quant: string) => GGUF_SOURCES[`${mid}|${quant}`].join('/');
    expect(artifact('qwen3.5-2b', 'q4_k_m')).toBe('unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf');
    expect(artifact('hy-mt2-7b', 'q8_0')).toBe('tencent/Hy-MT2-7B-GGUF/HY-MT2-7B-Q8_0.gguf');
    expect(artifact('hy-mt2-7b', 'q4_k_m')).toBe('tencent/Hy-MT2-7B-GGUF/Hy-MT2-7B-Q4_K_M.gguf');
  });

  it('splitArtifact', () => {
    expect(splitArtifact('mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf')).toEqual(['mradermacher/translategemma-4b-it-GGUF', 'translategemma-4b-it.Q4_K_M.gguf']);
    expect(splitArtifact('Qwen/Qwen3-0.6B-GGUF')).toEqual(['Qwen/Qwen3-0.6B-GGUF', null]);
    expect(splitArtifact('org/repo/onnx/model.onnx')).toEqual(['org/repo', 'onnx/model.onnx']);
  });

  it('eleven rows, all native_translate, no Opus-MT', () => {
    const models = translateModels();
    expect(models).toHaveLength(11);
    expect(models.every((m) => m.deployments.every((d) => d.backend === 'native_translate'))).toBe(true);
    expect(translateModel('opus-mt-ja-en')).toBeNull();
  });

  it("the prompt family is not the graph family", () => {
    const fams = Object.fromEntries(translateModels().map((m) => [m.id, m.promptFamily]));
    expect([fams['qwen3.5-4b'], fams['eurollm-1.7b'], fams['hy-mt2-7b']]).toEqual(['qwen', 'qwen', 'hunyuan']);
    const graph = Object.fromEntries(translateModels().map((m) => [m.id, m.graphFamily]));
    expect([graph['eurollm-1.7b'], graph['qwen3-0.6b'], graph['translategemma-4b']]).toEqual(['llama', 'qwen3', 'gemma3']);
    expect(graph['qwen3.5-4b']).not.toBe('qwen');
  });
});

describe('every card', () => {
  it('exposes a numeric sizeBytes', () => {
    for (const m of allCards()) expect(Number.isInteger(m.sizeBytes), m.id).toBe(true);
  });

  it('size regression values', () => {
    expect(must(asrModel('sense-voice')).sizeBytes).toBe(252684608);
    expect(must(ttsModel('moss-tts-nano')).sizeBytes).toBe(193337984);
    expect(must(ttsModel('supertonic-3')).sizeBytes).toBe(312784196);
    expect(must(ttsModel('pocket-tts-en')).sizeBytes).toBe(127856704 + 6194424);
    expect(must(ttsModel('pocket-tts-de')).sizeBytes).toBe(127857184);
  });

  it('a deployment is for every platform by default', () => {
    const d = deployment('be', 'cpu', 'int8', 'repo', 1.0);
    expect(d.platforms).toEqual(['linux', 'windows', 'macos']);
    expect('requiresAppleSilicon' in d).toBe(false);
  });

  it('every shipped deployment is for every platform', () => {
    for (const m of allCards()) for (const d of m.deployments) expect(d.platforms, `${m.id} ${d.tier}`).toEqual(ALL_PLATFORMS);
  });

  it('has a graph family', () => {
    for (const m of allCards()) expect(m.graphFamily, m.id).toBeTruthy();
  });

  it("a TTS card's graph family is its audio.cpp family", () => {
    for (const m of ttsModels()) expect(m.graphFamily).toBe(m.family);
  });

  it('every TTS family has an op recording', () => {
    for (const m of ttsModels()) expect(fs.existsSync(path.join(REPO_ROOT, 'native', 'src', 'ops', `tts-${m.graphFamily}.ops`)), m.id).toBe(true);
  });

  it.skipIf(!fs.existsSync(path.join(CACHE, 'Qwen3-0.6B-Q8_0.gguf')))('a translation card\'s graph family is its GGUF header\'s architecture', async () => {
    expect((await readHeader(path.join(CACHE, 'Qwen3-0.6B-Q8_0.gguf'))).architecture).toBe(must(translateModel('qwen3-0.6b')).graphFamily);
  });

  it.each([
    ['whisper-tiny-Q8_0.gguf', 'whisper-tiny'],
    ['moonshine-streaming-tiny-Q8_0.gguf', 'moonshine-streaming-tiny'],
    ['cohere-transcribe-03-2026-Q4_K_M.gguf', 'cohere-transcribe-03-2026'],
    ['granite-speech-4.1-2b-nar-Q4_K_M.gguf', 'granite-speech-4.1-2b-nar'],
    ['granite-speech-5.0-470m-turboctc-Q8_0.gguf', 'granite-speech-5.0-470m-turboctc'],
  ])("an ASR card's graph family is its GGUF's architecture: %s", async (gguf, cardId) => {
    const p = path.join(CACHE, gguf);
    if (!fs.existsSync(p)) return;                       // cached model absent
    expect((await readHeader(p)).architecture).toBe(must(asrModel(cardId)).graphFamily);
  });

  it('the rung fallback sets cover the cached GGUFs, once integer tables are filtered out', async () => {
    if (!fs.existsSync(CACHE)) return;                   // no cached models
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.gguf')) files.push(p);
      }
    };
    walk(CACHE);
    let checked = 0;
    for (const p of files) {
      const name = path.basename(p).toLowerCase().replaceAll('-', '_');
      const rung = ['q4_k_m', 'q5_k_m', 'q6_k', 'q8_0', 'bf16', 'f16'].find((r) => name.includes(r));
      if (!rung) continue;
      const weights = [...(await readHeader(p)).tensorDtypes].filter((t) => WEIGHT_CAPABLE_DTYPES.has(t));
      expect(weights.length, p).toBeGreaterThan(0);
      expect(weights.filter((w) => !RUNG_FALLBACK_DTYPES[rung].has(w)), p).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  it('the weight-capable dtypes exclude every integer type', () => {
    for (const t of ['i8', 'i16', 'i32', 'i64', 'f64']) expect(WEIGHT_CAPABLE_DTYPES.has(t), t).toBe(false);
    for (const t of ['f32', 'f16', 'bf16', 'q4_K', 'q8_0', 'q6_K', 'mxfp4', 'iq4_nl', 'tq1_0']) expect(WEIGHT_CAPABLE_DTYPES.has(t), t).toBe(true);
    const known = new Set(Object.values(GGML_TYPE_NAMES));
    for (const t of ['i8', 'i16', 'i32', 'i64', 'f64']) known.delete(t);
    expect(WEIGHT_CAPABLE_DTYPES).toEqual(known);
    for (const [rung, dts] of Object.entries(RUNG_FALLBACK_DTYPES)) expect([...dts].filter((d) => !WEIGHT_CAPABLE_DTYPES.has(d)), rung).toEqual([]);
  });

  it("the widest fallback matches gen_ops_data.py's WIDEST_FALLBACK", () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'native', 'cmake', 'gen_ops_data.py'), 'utf8');
    const m = /WIDEST_FALLBACK\s*=\s*(\d+)/.exec(text);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(RUNG_FALLBACK_DTYPES.q4_k_m.size);
  });

  it('tcRow refuses a quant key outside the ladder', () => {
    const row = tcRow('x', 'X', ['en'], 'handy-computer/x-gguf', 'x', 99, { Q8_0: 10, Q4_K_M: 5 }, { default: 'Q8_0' });
    expect(row.sizeBytes).toBe(10);
    expect(quantsOf(row)).toEqual(new Set(['q8_0', 'q4_k_m']));
    expect(() => tcRow('x', 'X', ['en'], 'handy-computer/x-gguf', 'x', 99, { BF16: 10, Q8_0: 10 }, { default: 'Q8_0' })).toThrow(/BF16/);
    expect(() => tcRow('x', 'X', ['en'], 'handy-computer/x-gguf', 'x', 99, { q8_0: 10 }, { default: 'q8_0' })).toThrow(/q8_0/);
    expect(() => tcRow('x', 'X', ['en'], 'handy-computer/x-gguf', 'x', 99, { Q8_0: 10 }, { default: 'Q4_K_M' })).toThrow(/include default 'Q4_K_M'; unknown=\[\]/);
  });

  it('every shipped rung has a fallback dtype set', () => {
    const rungs = new Set(allCards().flatMap((m) => m.deployments.map((d) => d.computeType)));
    expect([...rungs].filter((r) => !(r in RUNG_FALLBACK_DTYPES)).sort()).toEqual([]);
  });

  it('the divergent arch names are pinned to Arch::name', () => {
    const expected: Record<string, string> = {
      'cohere-transcribe-03-2026': 'cohere_asr',
      'granite-speech-4.1-2b': 'granite_speech',
      'granite-speech-4.1-2b-plus': 'granite_speech',
      'granite-4.0-1b-speech': 'granite_speech',
      'granite-speech-4.1-2b-nar': 'granite_speech_nar',
    };
    expect(Object.fromEntries(Object.keys(expected).map((mid) => [mid, must(asrModel(mid)).graphFamily]))).toEqual(expected);
    expect(asrModels().filter((m) => ['cohere', 'granite', 'granite_nar'].includes(m.graphFamily)).map((m) => m.id)).toEqual([]);
  });
});
