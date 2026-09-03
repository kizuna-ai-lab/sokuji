import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { NativeModelInfo } from '../../../lib/local-inference/native/nativeProtocol';

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
const { useNativeModelStore } = await import('../../../stores/nativeModelStore');
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

  // C1: StoragePage had no isSessionActive gating at all — its delete /
  // Clear-all / Import controls were gated in their previous homes (the two
  // ModelManagementSection variants) but lost that gate on relocation here,
  // and the stores themselves have no backstop against deleting the model a
  // running session is actually using.
  it('isSessionActive disables per-row delete, Clear all, and Import', () => {
    useModelStore.setState({
      modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" isSessionActive />);

    expect(screen.getByTestId(`storage-delete-${asrId()}`)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Clear all/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Import/ })).toBeDisabled();
  });

  // I4: the delete confirm used to render only the (possibly empty) fallback
  // notes — a model whose delete touches neither live direction (downloaded
  // but not in use) showed a confirm box with NO question at all.
  it("a downloaded-but-not-in-use row's confirm shows the lead question", () => {
    // opus-mt-es-fr (es -> fr) is real, non-multilingual, non-cloud, and
    // unrelated to the ja<->en directions this suite's beforeEach sets up —
    // downloading it can never resolve as "in use" for either direction.
    useModelStore.setState({
      modelStatuses: { 'opus-mt-es-fr': 'downloaded' }, webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" />);
    const row = screen.getByTestId('storage-row-opus-mt-es-fr');
    expect(row).not.toHaveTextContent('In use');

    fireEvent.click(screen.getByTestId('storage-delete-opus-mt-es-fr'));
    const confirm = screen.getByTestId('storage-confirm');
    expect(confirm.textContent).toMatch(/Delete .*\?/);
  });
});

// Task 7's review carry-over: StoragePage's native half (real hooks, real
// resolver) was implemented but never exercised by a test — only the "Import
// is absent for native" case above touched it, and that needs no catalog at
// all. These two mirror the wasm suite's in-use-badge and delete-preview
// cases against a hand-built native fixture catalog (native has no static
// manifest; the M() idiom is candidates.native.test.ts's).
describe('StoragePage (native)', () => {
  const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
             recommended = false, extra: Partial<NativeModelInfo> = {}): NativeModelInfo =>
    ({ id, name: id, languages, recommended, tiers: [{ tier: 'cpu', backend: 'ct2', available: true }],
       order, repo: id, kind, ...extra });

  const CATALOG: Record<string, NativeModelInfo> = {
    'sense-voice': M('sense-voice', 'asr', ['ja', 'en'], 1, true),
    'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true),
    'opus-mt-ja-en': M('opus-mt-ja-en', 'translate', ['ja', 'en'], 2, false),
    'piper-en': M('piper-en', 'tts', ['en'], 1, true),
  };

  beforeEach(async () => {
    await useSettingsStore.getState().updateLocalNative({
      sourceLanguage: 'ja', targetLanguage: 'en', selections: {},
    });
    useNativeModelStore.setState({ catalog: {}, statuses: {} });
  });

  it('lists ready models with an in-use badge on the resolved one', () => {
    useNativeModelStore.setState({ catalog: CATALOG, statuses: { 'sense-voice': 'ready' } });
    render(<StoragePage provider="native" />);
    const row = screen.getByTestId('storage-row-sense-voice');
    expect(row).toHaveTextContent('In use'); // resolved (auto) ASR for ja→en
  });

  it('delete confirm previews the fallback via the resolver', () => {
    // Both ready: qwen2.5-0.5b (recommended) auto-wins translation over
    // opus-mt-ja-en — deleting it must preview a fallback, not a dead end.
    useNativeModelStore.setState({
      catalog: CATALOG,
      statuses: { 'qwen2.5-0.5b': 'ready', 'opus-mt-ja-en': 'ready' },
    });
    render(<StoragePage provider="native" />);
    fireEvent.click(screen.getByTestId('storage-delete-qwen2.5-0.5b'));
    expect(screen.getByTestId('storage-confirm').textContent).toMatch(/falls back to/);
  });

  // Task (design amendment): the engine's ready-state "on disk · Remove
  // engine" row moved out of EngineSection's card and onto this page (the
  // card renders nothing once the sidecar is healthy — see EngineSection.tsx).
  it('native storage fetches the engine\'s on-disk size when a ready bundle has none yet, and only then', () => {
    const fetchBundleEntry = vi.fn(async () => {});
    useNativeModelStore.setState({
      catalog: CATALOG, statuses: {},
      bundleStatus: 'ready', bundleVersion: '0.2.0', bundleDevVenv: false,
      bundleInstalledSize: null, fetchBundleEntry,
    } as never);
    const first = render(<StoragePage provider="native" />);
    expect(fetchBundleEntry).toHaveBeenCalledTimes(1);
    first.unmount();
    useNativeModelStore.setState({ bundleInstalledSize: 5 * 1024 ** 3 } as never);
    render(<StoragePage provider="native" />);
    expect(fetchBundleEntry).toHaveBeenCalledTimes(1);
  });

  it('native storage shows engine size and remove', () => {
    const removeBundle = vi.fn(async () => {});
    useNativeModelStore.setState({
      catalog: CATALOG, statuses: {},
      bundleStatus: 'ready', bundleVersion: '0.2.0', bundleDevVenv: false,
      bundleInstalledSize: 5 * 1024 ** 3, removeBundle,
    } as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<StoragePage provider="native" />);
    const engineRow = screen.getByTestId('storage-engine-row');
    expect(engineRow).toHaveTextContent('Engine 0.2.0');
    expect(engineRow).toHaveTextContent('5.0 GB on disk');
    fireEvent.click(screen.getByRole('button', { name: /Remove engine/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(removeBundle).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('isSessionActive disables the engine remove button', () => {
    const removeBundle = vi.fn(async () => {});
    useNativeModelStore.setState({
      catalog: CATALOG, statuses: {},
      bundleStatus: 'ready', bundleVersion: '0.2.0', bundleDevVenv: false,
      bundleInstalledSize: 5 * 1024 ** 3, removeBundle,
    } as never);
    render(<StoragePage provider="native" isSessionActive />);
    const btn = screen.getByRole('button', { name: /Remove engine/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(removeBundle).not.toHaveBeenCalled();
  });

  it('no engine row for wasm storage, or when the native engine is not ready', () => {
    useNativeModelStore.setState({
      catalog: CATALOG, statuses: {}, bundleStatus: 'absent', bundleVersion: null,
    } as never);
    const { rerender } = render(<StoragePage provider="native" />);
    expect(screen.queryByTestId('storage-engine-row')).toBeNull();

    useNativeModelStore.setState({ bundleStatus: 'ready', bundleVersion: '0.2.0' } as never);
    rerender(<StoragePage provider="wasm" />);
    expect(screen.queryByTestId('storage-engine-row')).toBeNull();
  });
});
