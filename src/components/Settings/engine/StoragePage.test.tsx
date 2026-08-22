import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Partial mock (not a full replacement, unlike SlotRow.test.tsx): StoragePage
// renders against the REAL settingsStore, which statically imports
// `src/locales` (`import i18n from '../locales'`) to call
// `.use(initReactI18next)` — a full react-i18next replacement drops that
// export and the module blows up on import. Keep everything real except
// `useTranslation`, whose interpolation this file's assertions rely on.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (_k: string, d?: any, opts?: any) =>
      typeof d === 'string'
        ? d.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? ''))
        : _k,
    }),
  };
});

// StoragePage statically imports settingsStore (localInference/localNative)
// and modelStore, which drag in the real ServiceFactory import chain —
// audioStore -> ServiceFactory -> ModernBrowserAudioService -> ModernAudioRecorder
// -> the @sapphi-red/web-noise-suppressor worklet's `?url` import, which this
// sandboxed Vite test transform denies outright. Mock ServiceFactory (same
// fix modelStore.test.ts / settingsStore.test.ts / ensureSelectionReady.test.ts
// / useWasmEngineAdapter.test.ts already use) so that chain never loads;
// settingsStore's own persistence goes through this mock instead.
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

const { StoragePage } = await import('./StoragePage');
const { useModelStore } = await import('../../../stores/modelStore');
const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { getManifestByType, isTranslationModelCompatible, getModelSizeMb } =
  await import('../../../lib/local-inference/modelManifest');

// Real-manifest ids that can serve ja→en, mirroring ensureSelectionReady.test.ts.
const asrId = () => getManifestByType('asr')
  .find(m => (m.multilingual || m.languages.includes('ja')) && !m.isCloudModel)!.id;

// Ranked (byRank-equivalent) ja→en-compatible, non-cloud translation models.
// NOT raw manifest array order: two direction-pinned Opus-MT entries
// (opus-mt-ja-en / opus-mt-en-jap) sit adjacent in the manifest, but only
// the former is actually ja→en compatible — isTranslationModelCompatible
// requires an exact sourceLang/targetLang match for a non-multilingual
// model — so a naive index [0]/[1] pick from the raw array doesn't
// reproduce what the resolver actually prefers. Sorting these candidates by
// the resolver's own byRank criteria (recommended desc, sortOrder asc, size
// asc) gives trIds()[0] as today's auto pick and trIds()[1] as the model the
// resolver falls back to once trIds()[0] is masked "not downloaded" —
// exactly what the two delete-preview tests below need.
const trIds = () => getManifestByType('translation')
  .filter(m => !m.isCloudModel && isTranslationModelCompatible(m, 'ja', 'en'))
  .sort((a, b) =>
    Number(Boolean(b.recommended)) - Number(Boolean(a.recommended))
    || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || getModelSizeMb(a, []) - getModelSizeMb(b, []))
  .map(m => m.id);

describe('StoragePage (wasm)', () => {
  beforeEach(async () => {
    await useSettingsStore.getState().updateLocalInference({
      sourceLanguage: 'ja', targetLanguage: 'en', selections: {},
    });
  });

  it('lists downloaded models with an in-use badge on resolved ones', () => {
    useModelStore.setState({
      modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" />);
    const row = screen.getByTestId(`storage-row-${asrId()}`);
    expect(row).toHaveTextContent('In use'); // resolved ASR for ja→en
  });

  it('delete confirm previews the fallback via the resolver', () => {
    const [tr1, tr2] = trIds();
    useModelStore.setState({
      modelStatuses: { [asrId()]: 'downloaded', [tr1]: 'downloaded', [tr2]: 'downloaded' },
      webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" />);
    fireEvent.click(screen.getByTestId(`storage-delete-${tr1}`));
    // With a second translation model downloaded, the preview names a fallback,
    // not a dead end.
    expect(screen.getByTestId('storage-confirm').textContent).toMatch(/falls back to/);
  });

  // The dead-end case has to live on the ASR stage, not translation: the
  // manifest's translation pool always has Bing Translator (isCloudModel,
  // always "ready" once the pair is Bing-supported — ja/en is) as a
  // fallback, so deleting even the last LOCAL translation model still
  // "falls back to Bing Translator" rather than leaving nothing. ASR has no
  // cloud entry in the manifest at all, so it's the stage that can genuinely
  // run out of candidates.
  it('deleting the only ASR model warns sessions cannot start', () => {
    const id = asrId();
    useModelStore.setState({
      modelStatuses: { [id]: 'downloaded' }, webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" />);
    fireEvent.click(screen.getByTestId(`storage-delete-${id}`));
    expect(screen.getByTestId('storage-confirm').textContent).toMatch(/sessions cannot start/);
  });

  it('Clear all says selections are remembered — and does not touch them', async () => {
    await useSettingsStore.getState().updateLocalInference({
      selections: { 'ja→en': { asr: { modelId: asrId() }, translation: { modelId: '' }, tts: { modelId: '' } } },
    });
    useModelStore.setState({ modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true });
    render(<StoragePage provider="wasm" />);
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(screen.getByTestId('storage-confirm').textContent)
      .toMatch(/selections are remembered/i);
    expect(useSettingsStore.getState().localInference.selections['ja→en'].asr.modelId).toBe(asrId());
  });

  it('Import is present for wasm and absent for native', () => {
    const { unmount } = render(<StoragePage provider="wasm" />);
    expect(screen.getByRole('button', { name: /Import/ })).toBeInTheDocument();
    unmount();
    render(<StoragePage provider="native" />);
    expect(screen.queryByRole('button', { name: /Import/ })).not.toBeInTheDocument();
  });
});
