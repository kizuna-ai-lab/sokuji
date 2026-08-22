import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getManifestByType } from '../lib/local-inference/modelManifest';

// ensureSelectionReady() reaches settingsStore via a dynamic import, which
// drags in its real static import graph — including
// audioStore -> ServiceFactory -> ModernBrowserAudioService -> ModernAudioRecorder
// -> the @sapphi-red/web-noise-suppressor worklet's `?url` import, which this
// sandboxed Vite test transform denies outright. Mock ServiceFactory (same
// fix modelStore.test.ts and nativeModelStore.test.ts already use) so that
// chain never loads; settingsStore's own persistence goes through this mock
// instead of a real settings backend.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

const { useModelStore } = await import('./modelStore');
const { default: useSettingsStore } = await import('./settingsStore');

const downloadOnly = (ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, 'downloaded' as const]));

/** Ids that can serve ja→en for each stage in the real manifest. */
const pickIds = (stage: 'asr' | 'translation' | 'tts') => {
  if (stage === 'asr') {
    return [...getManifestByType('asr'), ...getManifestByType('asr-stream')]
      .filter((m) => m.multilingual || m.languages.includes('ja')).map((m) => m.id);
  }
  if (stage === 'tts') {
    return getManifestByType('tts')
      .filter((m) => m.multilingual || m.languages.includes('en')).map((m) => m.id);
  }
  return getManifestByType('translation').map((m) => m.id);
};

describe('ensureSelectionReady — what blocks Start', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      textOnly: false,
      localInference: {
        ...useSettingsStore.getState().localInference,
        selections: {}, sourceLanguage: 'ja', targetLanguage: 'en',
      },
    } as never);
    // Skip the IndexedDB scan — readiness logic is what these tests exercise,
    // same bypass modelStore.test.ts's ensureSelectionReady coverage uses.
    useModelStore.setState({ initialized: true, webgpuAvailable: true, modelStatuses: {} });
  });

  it('blocks when ASR cannot resolve, and the note names the stage', async () => {
    useModelStore.setState({ modelStatuses: downloadOnly(pickIds('translation')) });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(false);
    expect(r.notes.some((n) => n.stage === 'asr' && n.reason === 'no-candidate')).toBe(true);
  });

  it('blocks when translation cannot resolve', async () => {
    // Target 'bo' (Tibetan) rather than 'en': the manifest carries a cloud
    // translation fallback (bing-translator) that is always "ready" —
    // ja→en would resolve through it even with nothing downloaded, which
    // would make this test pass for the wrong reason. Bing doesn't support
    // 'bo', and the one local model that does (Hunyuan MT) isn't downloaded
    // here, so translation genuinely has no ready candidate for ja→bo.
    useSettingsStore.setState({
      localInference: { ...useSettingsStore.getState().localInference, targetLanguage: 'bo' },
    });
    useModelStore.setState({ modelStatuses: downloadOnly(pickIds('asr')) });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(false);
    expect(r.notes.some((n) => n.stage === 'translation' && n.reason === 'no-candidate')).toBe(true);
  });

  it('does NOT block when only TTS cannot resolve — sessions degrade to subtitles', async () => {
    useModelStore.setState({
      modelStatuses: downloadOnly([...pickIds('asr'), ...pickIds('translation')]),
    });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(true);
  });

  it('does NOT block when the participant direction cannot resolve', async () => {
    // Only a ja-capable ASR is present, so en→ja has no ASR at all.
    const jaOnly = [...getManifestByType('asr')]
      .filter((m) => !m.multilingual && m.languages.includes('ja') && !m.languages.includes('en'))
      .map((m) => m.id);
    useModelStore.setState({
      modelStatuses: downloadOnly([...jaOnly, ...pickIds('translation'), ...pickIds('tts')]),
    });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(true);
  });

  it('applies prunes found while checking, so a dead id is cleaned up once', async () => {
    useSettingsStore.setState({
      localInference: {
        ...useSettingsStore.getState().localInference,
        selections: {
          'ja→en': { asr: { modelId: 'retired-xyz' }, translation: { modelId: '' }, tts: { modelId: '' } },
        },
      },
    });
    useModelStore.setState({
      modelStatuses: downloadOnly([...pickIds('asr'), ...pickIds('translation')]),
    });
    await useModelStore.getState().ensureSelectionReady();
    expect(useSettingsStore.getState().localInference.selections['ja→en']).toBeUndefined();
  });

  it('does not resolve TTS at all under textOnly — no tts notes, still ready', async () => {
    useSettingsStore.setState({ textOnly: true } as never);
    // Downloaded: ASR + translation for ja→en, NO tts anywhere.
    useModelStore.setState({
      modelStatuses: downloadOnly([...pickIds('asr'), ...pickIds('translation')]),
    });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(true);
    expect(r.notes.some((n) => n.stage === 'tts')).toBe(false);
  });
});
