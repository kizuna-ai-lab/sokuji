import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { NativeModelInfo } from '../../../lib/local-inference/native/nativeProtocol';
import { useNativeEngineAdapter } from './useNativeEngineAdapter';
import { useNativeModelStore } from '../../../stores/nativeModelStore';

// The host's settings, its writer and its pair: Local Native's `Engine` hands
// the provider store's values in, the old shell its slice (#578).
const update = vi.fn();
const override = (selections = {}, pair = { source: 'ja', target: 'en' }) => ({
  settings: { selections, asrDevice: 'auto' as const, translationDevice: 'auto' as const, ttsDevice: 'auto' as const, ttsVoice: '' },
  update,
  pair,
});

// M() fixture-catalog idiom, mirrored verbatim from candidates.native.test.ts —
// native has no static manifest (the sidecar owns the catalog), so every
// native-facing test hand-builds a minimal one this way.
const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
           recommended = false, extra: Partial<NativeModelInfo> = {}): NativeModelInfo =>
  ({ id, name: id, languages, recommended, tiers: [{ tier: 'cpu', backend: 'ct2', available: true }],
     order, repo: id, kind, ...extra });

const CATALOG: Record<string, NativeModelInfo> = {
  'sense-voice': M('sense-voice', 'asr', ['ja', 'en', 'zh', 'ko'], 1, true),
  'whisper-base': M('whisper-base', 'asr', ['multi'], 3),
  'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true),
  'piper-en': M('piper-en', 'tts', ['en'], 1, true),
};

describe('useNativeEngineAdapter', () => {
  beforeEach(() => {
    update.mockClear();
    useNativeModelStore.setState({ catalog: {}, statuses: {} });
  });

  it('directions are speaker-first ja→en then en→ja', () => {
    const { result } = renderHook(() => useNativeEngineAdapter(false, override()));
    expect(result.current.directions.map(d => d.dir)).toEqual(['ja→en', 'en→ja']);
  });

  it("reads the host's pair and settings, and writes through its update (#578)", async () => {
    const { result } = renderHook(() => useNativeEngineAdapter(false, override({}, { source: 'zh', target: 'en' })));
    expect(result.current.directions.map((d) => d.dir)).toEqual(['zh→en', 'en→zh']);
    await act(async () => { await result.current.select({ dir: 'zh→en', stage: 'asr' }, 'sense-voice'); });
    expect(update).toHaveBeenCalledWith({ selections: { 'zh→en': { asr: { modelId: 'sense-voice' }, translation: { modelId: '' }, tts: { modelId: '' } } } });
  });

  it('readyCandidates lists only ready implementations', () => {
    useNativeModelStore.setState({
      catalog: CATALOG,
      statuses: { 'sense-voice': 'ready' }, // whisper-base left absent
    });
    const { result } = renderHook(() => useNativeEngineAdapter(false, override()));
    const ids = result.current.readyCandidates({ dir: 'ja→en', stage: 'asr' }).map(c => c.id);
    expect(ids).toContain('sense-voice');
    expect(ids).not.toContain('whisper-base');
  });

  it('select writes an explicit pick preserving sibling stages, and "" restores auto', async () => {
    useNativeModelStore.setState({ catalog: CATALOG, statuses: {} });
    const { result } = renderHook(() => useNativeEngineAdapter(false, override()));
    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
    expect(update).toHaveBeenLastCalledWith({
      selections: { 'en→ja': { asr: { modelId: '' }, translation: { modelId: 'some-model' }, tts: { modelId: '' } } },
    });
    // The host hands the pick back: clearing the only pick drops the direction.
    const picked = override({ 'en→ja': { asr: { modelId: '' }, translation: { modelId: 'some-model' }, tts: { modelId: '' } } });
    const again = renderHook(() => useNativeEngineAdapter(false, picked));
    await act(() => again.result.current.select({ dir: 'en→ja', stage: 'translation' }, ''));
    expect(update).toHaveBeenLastCalledWith({ selections: {} });
  });

  it('participant direction renders asr+translation only', () => {
    const { result } = renderHook(() => useNativeEngineAdapter(false, override()));
    expect(result.current.stagesFor('en→ja', false)).toEqual(['asr', 'translation']);
    expect(result.current.stagesFor('ja→en', true)).toEqual(['asr', 'translation', 'tts']);
  });

  // Task 8 brief, verbatim (carried variant-preserving rule): a variant pin
  // survives a re-select of the SAME model, but is dropped the moment the
  // model changes — a pin is scoped to the specific model it was chosen for.
  it('select keeps the variant pin only when the modelId is unchanged', async () => {
    const seeded = override({
      'ja→en': { asr: { modelId: '' }, translation: { modelId: 'qwen2.5-0.5b', variant: 'fp8' }, tts: { modelId: '' } },
    });
    const { result } = renderHook(() => useNativeEngineAdapter(false, seeded));
    await act(() => result.current.select({ dir: 'ja→en', stage: 'translation' }, 'qwen2.5-0.5b'));
    expect(update).toHaveBeenLastCalledWith({
      selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: 'qwen2.5-0.5b', variant: 'fp8' }, tts: { modelId: '' } } },
    });
    await act(() => result.current.select({ dir: 'ja→en', stage: 'translation' }, 'other-model'));
    expect(update).toHaveBeenLastCalledWith({
      selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: 'other-model' }, tts: { modelId: '' } } },
    });
  });

  // B'2 decision (2026-09-03): the per-slot compute-device control moved out
  // of the Engine page entirely — this adapter offers a read-only badge
  // instead, and no longer offers the old `stageExtras` control at all.
  it('offers a slotBadge (the read-only device badge) and no longer offers stageExtras', () => {
    const { result } = renderHook(() => useNativeEngineAdapter(false, override()));
    expect(result.current.slotBadge).toBeTypeOf('function');
    expect(result.current.slotBadge!({ dir: 'ja→en', stage: 'asr' }, 'badge-id')).toBeTruthy();
    expect((result.current as unknown as { stageExtras?: unknown }).stageExtras).toBeUndefined();
  });
});
