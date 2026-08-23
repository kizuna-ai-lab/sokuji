import { describe, it, expect } from 'vitest';
import { nativeCandidates } from './candidates.native';
import type { NativeModelInfo } from '../native/nativeProtocol';

const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
           recommended = false, extra: Partial<NativeModelInfo> = {}): NativeModelInfo =>
  ({ id, name: id, languages, recommended, tiers: [{ tier: 'cpu', backend: 'ct2', available: true }],
     order, repo: id, kind, ...extra });

const CATALOG: Record<string, NativeModelInfo> = {
  'sense-voice': M('sense-voice', 'asr', ['zh', 'en', 'ja', 'ko'], 1, true),
  'whisper-base': M('whisper-base', 'asr', ['multi'], 3),
  'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true, { sizeBytes: 480_000_000 }),
  'opus-mt-ja-en': M('opus-mt-ja-en', 'translate', ['ja', 'en'], 21, false, { sizeBytes: 78_000_000 }),
  'piper-en': M('piper-en', 'tts', ['en'], 1, true),
};

const ready = Object.fromEntries(Object.keys(CATALOG).map((id) => [id, 'ready' as const]));
const ctx = (over: Partial<{ statuses: Record<string, 'ready' | 'absent' | 'downloading'> }> = {}) =>
  ({ catalog: CATALOG, statuses: ready, ...over });

describe('nativeCandidates', () => {
  it('filters ASR by source language', () => {
    const s = nativeCandidates(ctx());
    expect(s.pool('asr', 'ja', 'en').map((c) => c.id)).toContain('sense-voice');
    expect(s.pool('asr', 'de', 'en').map((c) => c.id)).not.toContain('sense-voice');
  });

  it("treats 'multi' as a wildcard", () => {
    expect(nativeCandidates(ctx()).pool('asr', 'de', 'en').map((c) => c.id)).toContain('whisper-base');
  });

  it('shows a directional translate model only in its own direction', () => {
    const s = nativeCandidates(ctx());
    expect(s.pool('translation', 'ja', 'en').map((c) => c.id)).toContain('opus-mt-ja-en');
    expect(s.pool('translation', 'en', 'ja').map((c) => c.id)).not.toContain('opus-mt-ja-en');
  });

  it('keeps has() language-agnostic so the reverse direction preserves the pick', () => {
    expect(nativeCandidates(ctx()).has('translation', 'opus-mt-ja-en')).toBe(true);
  });

  it('reports has() false for an unknown id', () => {
    expect(nativeCandidates(ctx()).has('translation', 'gone')).toBe(false);
  });

  it("does not confuse kinds: an ASR id is not 'in' the tts stage", () => {
    expect(nativeCandidates(ctx()).has('tts', 'sense-voice')).toBe(false);
  });

  it('marks an absent model not ready', () => {
    const s = nativeCandidates(ctx({ statuses: { ...ready, 'sense-voice': 'absent' } }));
    expect(s.pool('asr', 'ja', 'en').find((c) => c.id === 'sense-voice')?.ready).toBe(false);
  });

  it('marks a downloading model not ready', () => {
    const s = nativeCandidates(ctx({ statuses: { ...ready, 'sense-voice': 'downloading' } }));
    expect(s.pool('asr', 'ja', 'en').find((c) => c.id === 'sense-voice')?.ready).toBe(false);
  });

  it('carries recommended, order and size through for ranking', () => {
    const c = nativeCandidates(ctx()).pool('translation', 'ja', 'en').find((x) => x.id === 'qwen2.5-0.5b')!;
    expect(c.recommended).toBe(true);
    expect(c.sortOrder).toBe(1);
    expect(c.sizeBytes).toBe(480_000_000);
  });

  it('reports sizeBytes 0 when the catalog omits it', () => {
    const c = nativeCandidates(ctx()).pool('asr', 'ja', 'en').find((x) => x.id === 'sense-voice')!;
    expect(c.sizeBytes).toBe(0);
  });

  it('marks every native candidate auto-eligible — AST is a WASM-only concept', () => {
    const s = nativeCandidates(ctx());
    expect(s.pool('translation', 'ja', 'en').every((c) => c.autoEligible)).toBe(true);
  });

  it('accepts a variant the catalog still offers and rejects one it does not', () => {
    const withVariants = {
      ...CATALOG,
      'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true, {
        variants: [{ id: 'int8', sizeBytes: 1, needBytes: 1, repo: 'r', supported: true, recommended: true }],
      }),
    };
    const c = nativeCandidates({ catalog: withVariants, statuses: ready })
      .pool('translation', 'ja', 'en').find((x) => x.id === 'qwen2.5-0.5b')!;
    expect(c.supportsVariant(undefined)).toBe(true);
    expect(c.supportsVariant('int8')).toBe(true);
    expect(c.supportsVariant('bf16')).toBe(false);
  });

  it('rejects a variant the catalog still lists but marks machine-unsupported (insufficient VRAM etc.)', () => {
    // The sidecar computes `supported` per variant (machine-aware) — a
    // variant present on the card but flagged unsupported must fall back to
    // auto exactly like a missing one does, not be honoured as a pin.
    const withVariants = {
      ...CATALOG,
      'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true, {
        variants: [
          { id: 'int8', sizeBytes: 1, needBytes: 1, repo: 'r', supported: true, recommended: true },
          { id: 'bf16', sizeBytes: 2, needBytes: 2, repo: 'r2', supported: false, recommended: false },
        ],
      }),
    };
    const c = nativeCandidates({ catalog: withVariants, statuses: ready })
      .pool('translation', 'ja', 'en').find((x) => x.id === 'qwen2.5-0.5b')!;
    expect(c.supportsVariant('int8')).toBe(true);
    expect(c.supportsVariant('bf16')).toBe(false);
  });
});
