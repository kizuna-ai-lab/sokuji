import { describe, it, expect } from 'vitest';
import { wasmCandidates } from './candidates.wasm';
import { getManifestByType } from '../modelManifest';

const allDownloaded = () => {
  const out: Record<string, 'downloaded'> = {};
  for (const t of ['asr', 'asr-stream', 'translation', 'tts'] as const) {
    for (const m of getManifestByType(t)) out[m.id] = 'downloaded';
  }
  return out;
};

const ctx = () => ({
  modelStatuses: allDownloaded(),
  webgpuAvailable: true,
  deviceFeatures: [] as string[],
});

describe('wasmCandidates', () => {
  it('puts both asr and asr-stream models in the ASR pool', () => {
    const ids = wasmCandidates(ctx()).pool('asr', 'ja', 'en').map((c) => c.id);
    const streamIds = getManifestByType('asr-stream').map((m) => m.id);
    expect(ids.some((id) => streamIds.includes(id))).toBe(true);
  });

  it('filters ASR by SOURCE language', () => {
    const s = wasmCandidates(ctx());
    const ja = s.pool('asr', 'ja', 'en').map((c) => c.id);
    const ko = s.pool('asr', 'ko', 'en').map((c) => c.id);
    expect(ja).not.toEqual(ko);
  });

  it('filters TTS by TARGET language — the mirror of ASR', () => {
    const s = wasmCandidates(ctx());
    const toEn = s.pool('tts', 'ja', 'en').map((c) => c.id);
    const toJa = s.pool('tts', 'en', 'ja').map((c) => c.id);
    expect(toEn).not.toEqual(toJa);
  });

  it('excludes a directional translation model from the reverse direction', () => {
    const s = wasmCandidates(ctx());
    const fwd = s.pool('translation', 'ja', 'en').map((c) => c.id);
    const rev = s.pool('translation', 'en', 'ja').map((c) => c.id);
    const onlyForward = fwd.filter((id) => !rev.includes(id));
    expect(onlyForward.length).toBeGreaterThan(0);
  });

  it('keeps has() language-agnostic, so a wrong-direction model is preserved not pruned', () => {
    const s = wasmCandidates(ctx());
    const fwd = s.pool('translation', 'ja', 'en').map((c) => c.id);
    const rev = s.pool('translation', 'en', 'ja').map((c) => c.id);
    const onlyForward = fwd.find((id) => !rev.includes(id))!;
    expect(s.has('translation', onlyForward)).toBe(true);
  });

  it('reports has() false for an id no longer in the manifest', () => {
    expect(wasmCandidates(ctx()).has('asr', 'retired-model-xyz')).toBe(false);
  });

  it('marks un-downloaded models not ready', () => {
    const s = wasmCandidates({ ...ctx(), modelStatuses: {} });
    const local = s.pool('asr', 'ja', 'en').filter((c) => !c.needsKey);
    expect(local.every((c) => !c.ready)).toBe(true);
  });

  it('treats cloud models as ready regardless of download status', () => {
    const s = wasmCandidates({ ...ctx(), modelStatuses: {} });
    const cloud = s.pool('tts', 'ja', 'en').filter((c) =>
      getManifestByType('tts').find((m) => m.id === c.id)?.isCloudModel);
    expect(cloud.length).toBeGreaterThan(0);
    expect(cloud.every((c) => c.ready)).toBe(true);
  });

  it('marks WebGPU-only models hardware-gated when WebGPU is absent', () => {
    const s = wasmCandidates({ ...ctx(), webgpuAvailable: false });
    const gated = s.pool('translation', 'ja', 'en').filter((c) => !c.hardwareOk);
    expect(gated.length).toBeGreaterThan(0);
  });

  it('supportsVariant rejects a variant this device cannot run, accepts one it can, and always accepts undefined (no pin)', () => {
    // qwen3-0.6b-translation: 'q4' has no requiredFeatures, 'q4f16' requires
    // shader-f16 — see modelManifest.ts. Machine without the feature.
    const noFeature = wasmCandidates({ ...ctx(), deviceFeatures: [] });
    const c = noFeature.pool('translation', 'ja', 'en').find((x) => x.id === 'qwen3-0.6b-translation')!;
    expect(c.supportsVariant(undefined)).toBe(true);
    expect(c.supportsVariant('q4')).toBe(true);
    expect(c.supportsVariant('q4f16')).toBe(false);

    // Same entry, machine WITH the feature — the pin becomes honourable.
    const withFeature = wasmCandidates({ ...ctx(), deviceFeatures: ['shader-f16'] });
    const c2 = withFeature.pool('translation', 'ja', 'en').find((x) => x.id === 'qwen3-0.6b-translation')!;
    expect(c2.supportsVariant('q4f16')).toBe(true);
  });

  it('adds AST-capable ASR entries to the translation pool as explicit-only', () => {
    const s = wasmCandidates(ctx());
    const ast = s.pool('translation', 'ja', 'en').filter((c) => c.autoEligible === false);
    expect(ast.length).toBeGreaterThan(0);
    for (const c of ast) {
      expect(getManifestByType('translation').some((m) => m.id === c.id)).toBe(false);
    }
  });

  it('has(translation, id) accepts an AST-capable ASR id but rejects a plain (non-AST) ASR id', () => {
    const s = wasmCandidates(ctx());
    // granite-speech: astLanguages present — a legitimate translation-stage
    // pick (the AST short-circuit), so its id must stay in the catalog.
    expect(s.has('translation', 'granite-speech')).toBe(true);
    // sensevoice-int8: a plain ASR entry with no astLanguages. It was never a
    // valid translation-stage candidate, so an id like this stored under the
    // translation stage is not revivable — it must prune, not linger as
    // 'lang-incompatible'.
    const plainAsr = getManifestByType('asr').find((m) => !m.astLanguages);
    expect(plainAsr).toBeDefined();
    expect(s.has('translation', plainAsr!.id)).toBe(false);
  });
});
