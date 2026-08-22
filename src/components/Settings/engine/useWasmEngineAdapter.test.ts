import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// useWasmEngineAdapter statically imports settingsStore, which drags in its
// real static import graph — including
// audioStore -> ServiceFactory -> ModernBrowserAudioService -> ModernAudioRecorder
// -> the @sapphi-red/web-noise-suppressor worklet's `?url` import, which this
// sandboxed Vite test transform denies outright. Mock ServiceFactory (same
// fix modelStore.test.ts / settingsStore.test.ts / ensureSelectionReady.test.ts
// already use) so that chain never loads; settingsStore's own persistence
// goes through this mock instead of a real settings backend.
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

const { useWasmEngineAdapter } = await import('./useWasmEngineAdapter');
const { useModelStore } = await import('../../../stores/modelStore');
const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { getManifestByType } = await import('../../../lib/local-inference/modelManifest');
const { wasmCandidates } = await import('../../../lib/local-inference/selection/candidates.wasm');

const jaAsr = () => getManifestByType('asr').filter(m => m.multilingual || m.languages.includes('ja'));

describe('useWasmEngineAdapter', () => {
  beforeEach(async () => {
    await useSettingsStore.getState().updateLocalInference({
      sourceLanguage: 'ja', targetLanguage: 'en', selections: {},
    });
    useModelStore.setState({ modelStatuses: {}, webgpuAvailable: true });
  });

  it('directions are speaker-first ja→en then en→ja', () => {
    const { result } = renderHook(() => useWasmEngineAdapter());
    expect(result.current.directions.map(d => d.dir)).toEqual(['ja→en', 'en→ja']);
  });

  it('readyCandidates lists only downloaded/usable implementations', () => {
    const first = jaAsr()[0];
    useModelStore.setState({ modelStatuses: { [first.id]: 'downloaded' } });
    const { result } = renderHook(() => useWasmEngineAdapter());
    const ids = result.current.readyCandidates({ dir: 'ja→en', stage: 'asr' }).map(c => c.id);
    expect(ids).toContain(first.id);
    // an un-downloaded ja-capable ASR is absent
    const notDownloaded = jaAsr().find(m => m.id !== first.id && !m.isCloudModel);
    if (notDownloaded) expect(ids).not.toContain(notDownloaded.id);
  });

  // AST-capable ASR entries (autoEligible: false in the translation pool)
  // must stay out of this quick picker even once downloaded: picking one
  // whose id != the currently-resolved ASR is immediately masked by
  // guardAstCrossStage (falls back to auto + a note) — a click that
  // visibly does the opposite of what it says. They're reachable through
  // the Library's full card flow, never this picker.
  it('excludes AST-capable (autoEligible: false) ASR entries from the translation quick picker, even when downloaded', () => {
    const pool = wasmCandidates({ modelStatuses: {}, webgpuAvailable: true, deviceFeatures: [] })
      .pool('translation', 'ja', 'en');
    const astCandidate = pool.find((c) => !c.autoEligible);
    const normalCandidate = pool.find((c) => c.autoEligible);
    // Manifest fixture assumption: at least one AST-capable ASR entry and one
    // normal translation model are ja→en compatible today (granite-speech /
    // opus-mt-ja-en). If the manifest ever drops the AST entry entirely this
    // assumption — not the filter under test — needs revisiting.
    expect(astCandidate).toBeDefined();
    expect(normalCandidate).toBeDefined();
    useModelStore.setState({
      modelStatuses: { [astCandidate!.id]: 'downloaded', [normalCandidate!.id]: 'downloaded' },
      webgpuAvailable: true,
    });
    const { result } = renderHook(() => useWasmEngineAdapter());
    const ids = result.current.readyCandidates({ dir: 'ja→en', stage: 'translation' }).map(c => c.id);
    expect(ids).not.toContain(astCandidate!.id);
    expect(ids).toContain(normalCandidate!.id);
  });

  it('select writes an explicit pick preserving sibling stages, and "" restores auto', async () => {
    const { result } = renderHook(() => useWasmEngineAdapter());
    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
    const sel = useSettingsStore.getState().localInference.selections['en→ja'];
    expect(sel.translation.modelId).toBe('some-model');
    expect(sel.asr.modelId).toBe('');
    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, ''));
    expect(useSettingsStore.getState().localInference.selections['en→ja']).toBeUndefined();
  });

  it('participant direction renders asr+translation only', () => {
    const { result } = renderHook(() => useWasmEngineAdapter());
    expect(result.current.stagesFor('en→ja', false)).toEqual(['asr', 'translation']);
    expect(result.current.stagesFor('ja→en', true)).toEqual(['asr', 'translation', 'tts']);
  });
});
