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
