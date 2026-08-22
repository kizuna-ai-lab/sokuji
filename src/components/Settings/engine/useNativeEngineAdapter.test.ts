import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { NativeModelInfo } from '../../../lib/local-inference/native/nativeProtocol';

// useNativeEngineAdapter statically imports settingsStore, which drags in its
// real static import graph — including
// audioStore -> ServiceFactory -> ModernBrowserAudioService -> ModernAudioRecorder
// -> the @sapphi-red/web-noise-suppressor worklet's `?url` import, which this
// sandboxed Vite test transform denies outright. Mock ServiceFactory (same
// fix modelStore.test.ts / settingsStore.test.ts / ensureSelectionReady.test.ts
// / useWasmEngineAdapter.test.ts already use) so that chain never loads;
// settingsStore's own persistence goes through this mock instead of a real
// settings backend.
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

const { useNativeEngineAdapter } = await import('./useNativeEngineAdapter');
const { useNativeModelStore } = await import('../../../stores/nativeModelStore');
const { default: useSettingsStore } = await import('../../../stores/settingsStore');

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
  beforeEach(async () => {
    await useSettingsStore.getState().updateLocalNative({
      sourceLanguage: 'ja', targetLanguage: 'en', selections: {},
    });
    useNativeModelStore.setState({ catalog: {}, statuses: {} });
  });

  it('directions are speaker-first ja→en then en→ja', () => {
    const { result } = renderHook(() => useNativeEngineAdapter());
    expect(result.current.directions.map(d => d.dir)).toEqual(['ja→en', 'en→ja']);
  });

  it('readyCandidates lists only ready implementations', () => {
    useNativeModelStore.setState({
      catalog: CATALOG,
      statuses: { 'sense-voice': 'ready' }, // whisper-base left absent
    });
    const { result } = renderHook(() => useNativeEngineAdapter());
    const ids = result.current.readyCandidates({ dir: 'ja→en', stage: 'asr' }).map(c => c.id);
    expect(ids).toContain('sense-voice');
    expect(ids).not.toContain('whisper-base');
  });

  it('select writes an explicit pick preserving sibling stages, and "" restores auto', async () => {
    useNativeModelStore.setState({ catalog: CATALOG, statuses: {} });
    const { result } = renderHook(() => useNativeEngineAdapter());
    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
    const sel = useSettingsStore.getState().localNative.selections['en→ja'];
    expect(sel.translation.modelId).toBe('some-model');
    expect(sel.asr.modelId).toBe('');
    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, ''));
    expect(useSettingsStore.getState().localNative.selections['en→ja']).toBeUndefined();
  });

  it('participant direction renders asr+translation only', () => {
    const { result } = renderHook(() => useNativeEngineAdapter());
    expect(result.current.stagesFor('en→ja', false)).toEqual(['asr', 'translation']);
    expect(result.current.stagesFor('ja→en', true)).toEqual(['asr', 'translation', 'tts']);
  });

  // Task 8 brief, verbatim (carried variant-preserving rule): a variant pin
  // survives a re-select of the SAME model, but is dropped the moment the
  // model changes — a pin is scoped to the specific model it was chosen for.
  it('select keeps the variant pin only when the modelId is unchanged', async () => {
    await useSettingsStore.getState().updateLocalNative({
      selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: 'qwen2.5-0.5b', variant: 'fp8' }, tts: { modelId: '' } } },
    });
    const { result } = renderHook(() => useNativeEngineAdapter());
    await act(() => result.current.select({ dir: 'ja→en', stage: 'translation' }, 'qwen2.5-0.5b'));
    expect(useSettingsStore.getState().localNative.selections['ja→en'].translation.variant).toBe('fp8');
    await act(() => result.current.select({ dir: 'ja→en', stage: 'translation' }, 'other-model'));
    expect(useSettingsStore.getState().localNative.selections['ja→en'].translation.variant).toBeUndefined();
  });
});
