import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { ModelManagementSection } from './ModelManagementSection';
import { getManifestByType, getManifestEntry, type ModelStatus } from '../../../lib/local-inference/modelManifest';
import { resolveDirection } from '../../../lib/local-inference/selection/resolveStage';
import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
import { directionKey, type Selections } from '../../../lib/local-inference/selection/types';

const defaultSettings = {
  sourceLanguage: 'en', targetLanguage: 'en',
  ttsSpeakerId: 0, ttsSpeed: 1, edgeTtsVoice: '',
  selections: {} as Selections,
};
const mockSettings = { ...defaultSettings };
const mockUpdate = vi.fn();

vi.mock('react-i18next', () => ({
  // Interpolating, mirroring StoragePage.test.tsx — needed so {{lang}} in
  // the availableWhenLang line actually resolves to the language NAME the
  // component passed in, not the raw placeholder (I5/I3).
  useTranslation: () => ({
    t: (_k: string, fb?: string, opts?: Record<string, any>) =>
      typeof fb === 'string'
        ? fb.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? ''))
        : _k,
  }),
}));
vi.mock('../../../stores/settingsStore', () => ({
  useLocalInferenceSettings: () => mockSettings,
  useUpdateLocalInference: () => mockUpdate,
}));

// Edge TTS voice list — two disjoint locales so the forward/reversed targets
// disagree about which voice is "valid" (the freeze-bug precondition). The
// real filterVoicesByLanguage/getVoiceDisplayName stay in play.
const mockVoice = (ShortName: string, Locale: string) => ({
  Name: ShortName, ShortName, Gender: 'Female', Locale,
  SuggestedCodec: '', FriendlyName: ShortName, Status: 'GA',
  VoiceTag: { ContentCategories: [], VoicePersonalities: [] },
});
const mockGetEdgeTtsVoices = vi.fn(async () => [
  mockVoice('ja-JP-NanamiNeural', 'ja-JP'),
  mockVoice('en-US-AriaNeural', 'en-US'),
]);
vi.mock('../../../lib/edge-tts/voiceList', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEdgeTtsVoices: () => mockGetEdgeTtsVoices(),
}));

// Voice storage (Supertonic imported voices) — keep deterministic / IndexedDB-free.
vi.mock('../../../lib/local-inference/voiceStorage', () => ({
  listVoices: vi.fn(async () => []),
  addVoice: vi.fn(async () => undefined),
  renameVoice: vi.fn(async () => undefined),
  deleteVoice: vi.fn(async () => undefined),
  VoiceImportError: class VoiceImportError extends Error {},
}));

// modelStore surface used by the component — all no-ops/empty so it renders.
const mockStatuses: Record<string, ModelStatus> = {};
const mockDownloads: Record<string, any> = {};
// mockWebgpuAvailable starts with "mock" so vitest hoists it alongside the
// vi.mock factories below; mutated per test to exercise the hardware gate.
let mockWebgpuAvailable = true;
const mockStoreState = {
  initialize: vi.fn(),
  downloadModel: vi.fn(),
  cancelDownload: vi.fn(),
  deleteModel: vi.fn(),
  deleteAllModels: vi.fn(),
  // Real resolver + real WASM candidate projection, fed by this file's own
  // mutable mockStatuses/mockWebgpuAvailable — not a stub, so the component's
  // selected-state derivation is exercised for real (deviceReady gate included).
  resolve: (src: string, tgt: string, selections: Selections) =>
    resolveDirection(
      directionKey(src, tgt),
      selections,
      wasmCandidates({ modelStatuses: mockStatuses, webgpuAvailable: mockWebgpuAvailable, deviceFeatures: [] }),
    ),
};
vi.mock('../../../stores/modelStore', () => ({
  useModelStatuses: () => mockStatuses,
  useModelDownloads: () => mockDownloads,
  useDownloadErrors: () => ({}),
  useStorageUsedMb: () => 0,
  useModelInitialized: () => true,
  useModelInitError: () => null,
  useWebGPUAvailable: () => mockWebgpuAvailable,
  useWebGPUSoftwareOnly: () => false,
  useDeviceFeatures: () => [],
  useModelVariants: () => ({}),
  useModelStore: Object.assign(
    (sel?: (s: typeof mockStoreState) => unknown) =>
      sel ? sel(mockStoreState) : mockStoreState,
    { getState: () => mockStoreState },
  ),
}));

beforeEach(() => {
  mockUpdate.mockReset();
  mockWebgpuAvailable = true;
  Object.assign(mockSettings, defaultSettings, { selections: {} });
  for (const k of Object.keys(mockStatuses)) delete mockStatuses[k];
  for (const k of Object.keys(mockDownloads)) delete mockDownloads[k];
});

describe('ModelManagementSection (self-reads store)', () => {
  it('renders without settings/update props', async () => {
    render(<ModelManagementSection isSessionActive={false} />);
    await waitFor(() =>
      expect(screen.getByText('ASR (Speech Recognition)')).toBeInTheDocument(),
    );
  });
});

describe('ModelManagementSection — import affordance', () => {
  it('offers Import on incompatible model cards too (blocked-CDN workaround)', async () => {
    // moonshine-tiny-ja-quant supports only 'ja', so it's incompatible with an
    // 'en' source and lives in the "show all" list. It still allows Download, so
    // it must also allow Import — else censored-network users can't import it.
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';

    render(<ModelManagementSection isSessionActive={false} />);
    const showAll = await screen.findByText(/Show all ASR models/);
    fireEvent.click(showAll);

    const card = await screen.findByTestId('model-card-moonshine-tiny-ja-quant');
    expect(within(card).getByTitle('Import model')).toBeInTheDocument();
  });

  it('hides the cancel button while a model is importing (import is not cancelable)', async () => {
    // A network download shows Cancel; an import cannot be cancelled, so its
    // progress row must not render a dead Cancel button.
    mockStatuses['sensevoice-int8'] = 'downloading';
    mockDownloads['sensevoice-int8'] = {
      downloadedBytes: 1, totalBytes: 2, currentFile: 'config.json', percent: 50, isImport: true,
    };

    render(<ModelManagementSection isSessionActive={false} />);

    const card = await screen.findByTestId('model-card-sensevoice-int8');
    expect(within(card).queryByTitle('Cancel')).toBeNull();
  });
});

describe('ModelManagementSection — embedded voice', () => {
  it('renders the voice control inside the selected TTS card (and nowhere else)', async () => {
    // supertonic-3 is a real, en-compatible TTS model with a voice library.
    // Edge TTS is always "ready" (cloud) and recommended with sortOrder 0, so
    // it would win auto-resolution outright — an EXPLICIT selection is what
    // makes supertonic-3 "the resolved model" here, not just its download
    // status. Selected state now flows through `selections` + resolve(),
    // not the flat `ttsModel` field this test used to set directly.
    mockSettings.selections = {
      [directionKey('en', 'en')]: {
        asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'supertonic-3' },
      },
    };
    mockStatuses['supertonic-3'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} />);

    const card = await waitFor(() => screen.getByTestId('model-card-supertonic-3'));
    // VoiceLibrarySection (Supertonic dropdown) renders a "Voice" label in the body.
    expect(within(card).queryByText('Voice')).toBeTruthy();
    // The voice control renders only in the selected TTS card, nowhere else.
    expect(screen.getAllByText('Voice')).toHaveLength(1);
  });
});

describe('ModelManagementSection — selected state comes from resolve(), not settings writes (Task 11)', () => {
  it('marks the resolved model selected without writing it to settings', async () => {
    mockStatuses['sensevoice-int8'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} />);

    // No role="radio" in this markup — a selected card shows the "Active"
    // status label and carries the --selected modifier class (see ModelCard).
    const card = await screen.findByTestId('model-card-sensevoice-int8');
    expect(card.className).toContain('model-card--selected');
    expect(within(card).getByText('Active')).toBeInTheDocument();

    // The whole point: displaying an auto result must not persist it.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSettings.selections).toEqual({});
  });

  it('never selects a WebGPU-only model when WebGPU is unavailable', async () => {
    // Every ASR/translation/TTS model "downloaded" — if the deviceReady gate
    // is honored, resolve() can still never land on one of the many
    // requiredDevice:'webgpu' entries in the manifest while webgpuAvailable
    // is false. This is the ProviderSpecificSettings bypass this task
    // deletes, re-created as a check on THIS component's own derivation
    // (ModelManagementSection never trusted that copy's writes in the first
    // place — it now trusts nothing but resolve()).
    mockWebgpuAvailable = false;
    for (const m of [
      ...getManifestByType('asr'), ...getManifestByType('asr-stream'),
      ...getManifestByType('translation'), ...getManifestByType('tts'),
    ]) {
      // Cloud models (isCloudModel) are always "ready" and carry no variants
      // to download — marking them 'downloaded' is meaningless and trips
      // getVariantHint's selectVariant() (no variant to select). Skip them;
      // they aren't hardware-gated anyway, so they don't affect this assertion.
      if (m.isCloudModel) continue;
      mockStatuses[m.id] = 'downloaded';
    }

    render(<ModelManagementSection isSessionActive={false} />);

    const selectedLabels = await screen.findAllByText('Active');
    expect(selectedLabels.length).toBeGreaterThan(0);
    for (const label of selectedLabels) {
      const card = label.closest('[data-testid^="model-card-"]') as HTMLElement | null;
      expect(card).not.toBeNull();
      const id = card!.getAttribute('data-testid')!.replace('model-card-', '');
      expect(getManifestEntry(id)?.requiredDevice).not.toBe('webgpu');
    }
  });
});

// I3 (final-review carry-over, amended 2026-08-22): the Library surface
// (stageFilter) keeps the ORIGINAL main-branch model group list — the
// Recommended/Others subgroups plus the "Show all N models" collapse for
// incompatible ones — per the user's post-render decision (see the spec's
// Amendment note). These cover that surface's own checklist.
describe('ModelManagementSection — Library surface keeps the original group list (I3)', () => {
  it('renders header-less, with the original Recommended subgroup and every model of the filtered stage reachable via the show-all toggle', async () => {
    // moonshine-tiny-ja-quant supports only 'ja' — incompatible with an 'en'
    // source, so it sits behind the show-all toggle.
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';

    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" />);
    await screen.findByRole('button', { name: /Show all ASR models \(\d+\)/ });

    // Bare mode: the stage's collapsible group header would duplicate the
    // Library page title, so it must not render on this surface.
    expect(document.querySelector('.model-group__header')).not.toBeInTheDocument();

    // The original Recommended/Others subgroup structure is intact.
    expect(document.querySelector('.model-subgroup__label')).toHaveTextContent('Recommended');

    // Incompatible models are in the manifest but absent from the DOM until
    // the show-all toggle expands them.
    expect(screen.queryByTestId('model-card-moonshine-tiny-ja-quant')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show all ASR models/ }));
    expect(await screen.findByTestId('model-card-moonshine-tiny-ja-quant')).toBeInTheDocument();

    // Every ASR model in the manifest now renders SOMEWHERE — nothing is
    // silently dropped by the Library view.
    const allAsr = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    for (const m of allAsr) {
      expect(screen.getByTestId(`model-card-${m.id}`)).toBeInTheDocument();
    }
  });

  it('a Library opened from the REVERSE direction reads and writes THAT direction (Codex X1)', () => {
    // Forward pair en→ja. The participant slot's Library passes
    // direction="ja→en": ja-only moonshine must now be COMPATIBLE (visible
    // without the show-all toggle), and selecting it must write the ja→en
    // entry — not the forward en→ja one.
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockStatuses['moonshine-tiny-ja-quant'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" direction="ja→en" />);

    const card = screen.getByTestId('model-card-moonshine-tiny-ja-quant');
    // Compatible under the slot's direction: no show-all toggle needed, and
    // the card is selectable (not marked incompatible).
    expect(card.className).not.toContain('model-card--incompatible');
    fireEvent.click(card);

    expect(mockUpdate).toHaveBeenCalled();
    const written = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0].selections;
    expect(written['ja→en'].asr.modelId).toBe('moonshine-tiny-ja-quant');
    expect(written['en→ja']).toBeUndefined();
  });

  it('an incompatible model offers Download but clicking it (the "Use" affordance) does not write a selection', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';

    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" />);
    fireEvent.click(await screen.findByRole('button', { name: /Show all ASR models/ }));

    const card = await screen.findByTestId('model-card-moonshine-tiny-ja-quant');
    expect(within(card).getByTitle('Download')).toBeInTheDocument();

    // ModelCard's own isCompatible guard blocks selection on click. Assert
    // on selection writes specifically: an unrelated async settings write
    // (the Edge-TTS default-voice effect posts {edgeTtsVoice} for a 'ja'
    // target) can land between the awaits above, so "zero calls at all"
    // is a race, not the invariant.
    fireEvent.click(card);
    const selectionWrites = mockUpdate.mock.calls.filter(([patch]) => patch && 'selections' in patch);
    expect(selectionWrites).toHaveLength(0);
  });

  it('a downloaded incompatible model shows the "available when your language is" line, naming the language', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockStatuses['moonshine-tiny-ja-quant'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" />);
    fireEvent.click(await screen.findByRole('button', { name: /Show all ASR models/ }));
    await screen.findByTestId('model-card-moonshine-tiny-ja-quant');

    const line = screen.getByText(/Available when your language is/);
    expect(line).toHaveTextContent('日本語');
  });
});

// C1 folded finding: Storage (StoragePage) owns Clear-all now — the bottom
// ModelStorageFooter duplicate must not render on the Library push
// (stageFilter set), only on the standalone (prop-less) Settings-page render,
// since the two differ in gating (StoragePage now carries isSessionActive;
// this footer's own `disabled` prop is unrelated to that surface).
describe('ModelManagementSection — ModelStorageFooter only on the standalone render (C1)', () => {
  it('a Library-view (stageFilter set) render has no ModelStorageFooter', async () => {
    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" />);
    // Bare mode has no stage title — anchor on the rendered list instead.
    await screen.findByRole('button', { name: /Show all ASR models/ });
    expect(document.querySelector('.model-management__storage')).not.toBeInTheDocument();
  });

  it('the standalone (prop-less stageFilter) render keeps the footer', async () => {
    render(<ModelManagementSection isSessionActive={false} />);
    await screen.findByText('ASR (Speech Recognition)');
    expect(document.querySelector('.model-management__storage')).toBeInTheDocument();
  });
});

// Freeze bug (2026-08-23): the Library pushed for a REVERSED direction used
// to run the Edge-TTS default-voice effect against the slot's (reversed)
// target while the always-mounted SettingsInitializer ran the same check
// against the FORWARD target. With disjoint voice lists the two writers
// ping-pong `edgeTtsVoice` forever — a sync re-render loop that froze the
// whole app. The voice field belongs to the forward pair only, so a
// non-forward Library render must never write it.
describe('ModelManagementSection — edgeTtsVoice ownership (freeze bug)', () => {
  it('a reversed-direction Library render never writes edgeTtsVoice', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    // Valid for the FORWARD target (ja) — invalid for the reversed leg's (en).
    mockSettings.edgeTtsVoice = 'ja-JP-NanamiNeural';

    render(<ModelManagementSection isSessionActive={false} stageFilter="translation" direction="ja→en" />);

    await waitFor(() => expect(mockGetEdgeTtsVoices).toHaveBeenCalled());
    // One extra macrotask so the auto-select effect (if it ran) has flushed.
    await new Promise((r) => setTimeout(r, 0));

    const voiceWrites = mockUpdate.mock.calls.filter(([p]) => p && 'edgeTtsVoice' in p);
    expect(voiceWrites).toHaveLength(0);
  });

  it('a reversed-direction TTS Library hides voice editing entirely (CodeRabbit R3)', async () => {
    // Unreachable via today's engine page (reverse legs expose no TTS slot),
    // but nothing structural prevented it: the voice section edits
    // forward-shared fields (edgeTtsVoice, ttsSpeakerId), so a non-forward
    // render must not offer it at all.
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';

    render(<ModelManagementSection isSessionActive={false} stageFilter="tts" direction="ja→en" />);
    await screen.findByTestId('model-card-edge-tts');
    expect(screen.queryByText('Voice')).not.toBeInTheDocument();
  });

  it('the forward-direction TTS Library keeps voice editing', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';

    render(<ModelManagementSection isSessionActive={false} stageFilter="tts" direction="en→ja" />);
    await screen.findByTestId('model-card-edge-tts');
    expect(await screen.findByText('Voice')).toBeInTheDocument();
  });

  it('the forward render still auto-fixes an invalid voice', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.edgeTtsVoice = 'en-US-AriaNeural'; // wrong language for target ja

    render(<ModelManagementSection isSessionActive={false} />);

    await waitFor(() => {
      const voiceWrites = mockUpdate.mock.calls.filter(([p]) => p && 'edgeTtsVoice' in p);
      expect(voiceWrites.length).toBeGreaterThan(0);
      expect(voiceWrites[0][0].edgeTtsVoice).toBe('ja-JP-NanamiNeural');
    });
  });
});
