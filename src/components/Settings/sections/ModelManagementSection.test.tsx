import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { languageLabel } from '../../../lib/language/label';
import { ModelManagementSection } from './ModelManagementSection';
import { getManifestByType, getManifestEntry, type ModelStatus } from '../../../lib/local-inference/modelManifest';
import { resolveDirection } from '../../../lib/local-inference/selection/resolveStage';
import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
import { directionKey, type Selections } from '../../../lib/local-inference/selection/types';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from '../../../providers/localInference/settings';

const defaultSettings = {
  sourceLanguage: 'en', targetLanguage: 'en',
  ttsSpeed: 1, voices: {} as LocalInferenceSettings['voices'],
  selections: {} as Selections,
};
const mockSettings = { ...defaultSettings };
const mockUpdate = vi.fn();
/** The props every mount passes (Stage 2 deletion, ruling 3), read off this
 *  file's mutable fixture at render time. */
const slice = () => ({
  settings: mockSettings as unknown as LocalInferenceSettings,
  update: mockUpdate,
  pair: { source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage },
});

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
  Object.assign(mockSettings, defaultSettings, { selections: {}, voices: {} });
  for (const k of Object.keys(mockStatuses)) delete mockStatuses[k];
  for (const k of Object.keys(mockDownloads)) delete mockDownloads[k];
});

describe('ModelManagementSection (prop-driven, LocalInference Engine)', () => {
  it("writes through the given `update` and reads `selections` from the given `settings`", () => {
    // This file's shared fixture carries an unrelated direction — proof that a
    // write is built from the given settings (empty) alone.
    mockSettings.selections = {
      'zh→fr': { asr: { modelId: 'ghost-model' }, translation: { modelId: '' }, tts: { modelId: '' } },
    };
    mockStatuses['moonshine-tiny-ja-quant'] = 'downloaded';
    const propUpdate = vi.fn();

    render(
      <ModelManagementSection
        isSessionActive={false}
        stageFilter="asr"
        direction="ja→en"
        settings={LOCAL_INFERENCE_DEFAULTS}
        update={propUpdate}
        pair={{ source: 'en', target: 'ja' }}
      />,
    );

    fireEvent.click(screen.getByTestId('model-card-moonshine-tiny-ja-quant'));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(propUpdate).toHaveBeenCalled();
    const written = propUpdate.mock.calls[propUpdate.mock.calls.length - 1][0].selections;
    expect(written['ja→en'].asr.modelId).toBe('moonshine-tiny-ja-quant');
    expect(written['zh→fr']).toBeUndefined();
  });
});

describe('ModelManagementSection — import affordance', () => {
  it('offers Import on incompatible model cards too (blocked-CDN workaround)', async () => {
    // moonshine-tiny-ja-quant supports only 'ja', so it's incompatible with an
    // 'en' source and lives in the "show all" list. It still allows Download, so
    // it must also allow Import — else censored-network users can't import it.
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';

    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
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

    render(<ModelManagementSection isSessionActive={false} {...slice()} />);

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

    render(<ModelManagementSection isSessionActive={false} {...slice()} />);

    const card = await waitFor(() => screen.getByTestId('model-card-supertonic-3'));
    // VoiceLibrarySection (Supertonic dropdown) renders a "Voice" label in the body.
    expect(within(card).queryByText('Voice')).toBeTruthy();
    // The voice control renders only in the selected TTS card, nowhere else.
    expect(screen.getAllByText('Voice')).toHaveLength(1);
  });

  it("deleting an imported Supertonic voice resets every direction that spoke in it, not only this one, and leaves the same speaker id on another model alone (Review Focus 4)", async () => {
    const storage = await import('../../../lib/local-inference/voiceStorage');
    vi.mocked(storage.listVoices).mockResolvedValueOnce([{ id: 2, name: 'Mine' } as never]);
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.selections = {
      [directionKey('en', 'ja')]: { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'supertonic-3' } },
      [directionKey('ja', 'en')]: { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'supertonic-3' } },
      [directionKey('ko', 'ja')]: { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'edge-tts' } },
    };
    // Sid 12 is imported voice #2 (`importedSidFromDbKey`); the reverse direction speaks in it too.
    // ko→ja's 12 is a speaker of another model (Edge here), not the deleted voice.
    mockSettings.voices = { 'en→ja': { speaker: 12 }, 'ja→en': { speaker: 12, edge: 'en-US-AriaNeural' }, 'zh→ja': { speaker: 3 }, 'ko→ja': { speaker: 12 } };
    mockStatuses['supertonic-3'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="tts" direction="en→ja" />);
    const card = await screen.findByTestId('model-card-supertonic-3');
    await within(card).findByText('Mine');
    // VoiceLibrarySection's delete for a custom row: open the picker, press the row's Delete, then confirm in the modal (VoiceLibrarySection.test.tsx).
    fireEvent.click(within(card).getByRole('button', { expanded: false }));
    fireEvent.click(within(screen.getByRole('grid')).getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: /delete voice/i })).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({
      voices: { 'en→ja': { speaker: 7 }, 'ja→en': { speaker: 7, edge: 'en-US-AriaNeural' }, 'zh→ja': { speaker: 3 }, 'ko→ja': { speaker: 12 } },
    }));
  });

  it('tells Supertonic users Voice Builder is gone instead of linking to it', async () => {
    // Supertone (HYBE) resolved to dissolve on 2026-07-15 and shut Voice
    // Builder on 2026-08-31 — supertonic.supertone.ai is a 404. The card must
    // say so and must not send anyone to the dead service; already-downloaded
    // voice_style.json files still import fine, and that is what the notice
    // should leave the user with.
    mockSettings.selections = {
      [directionKey('en', 'en')]: {
        asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'supertonic-3' },
      },
    };
    mockStatuses['supertonic-3'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} {...slice()} />);

    const card = await waitFor(() => screen.getByTestId('model-card-supertonic-3'));
    expect(within(card).getByText(/Voice Builder/)).toHaveTextContent(/closed/i);
    expect(within(card).getByText(/Voice Builder/)).toHaveTextContent(/can still be imported/i);
    expect(card.querySelector('a[href*="supertone.ai"]')).toBeNull();
    expect(within(card).queryByText('Need a custom voice?')).toBeNull();
  });
});

describe('ModelManagementSection — selected state comes from resolve(), not settings writes (Task 11)', () => {
  it('marks the resolved model selected without writing it to settings', async () => {
    mockStatuses['sensevoice-int8'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} {...slice()} />);

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

    render(<ModelManagementSection isSessionActive={false} {...slice()} />);

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

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" />);
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

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" direction="ja→en" />);

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

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" />);
    fireEvent.click(await screen.findByRole('button', { name: /Show all ASR models/ }));

    const card = await screen.findByTestId('model-card-moonshine-tiny-ja-quant');
    expect(within(card).getByTitle('Download')).toBeInTheDocument();

    // ModelCard's own isCompatible guard blocks selection on click. Assert
    // on selection writes specifically: an unrelated async settings write
    // (the Edge-TTS default-voice effect posts the direction's voice for a 'ja'
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

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" />);
    fireEvent.click(await screen.findByRole('button', { name: /Show all ASR models/ }));
    await screen.findByTestId('model-card-moonshine-tiny-ja-quant');

    const line = screen.getByText(/Available when your language is/);
    expect(line).toHaveTextContent(languageLabel('ja', 'en'));
  });
});

// C1 folded finding: Storage (StoragePage) owns Clear-all now — the bottom
// ModelStorageFooter duplicate must not render on the Library push
// (stageFilter set), only on the standalone (prop-less) Settings-page render,
// since the two differ in gating (StoragePage now carries isSessionActive;
// this footer's own `disabled` prop is unrelated to that surface).
describe('ModelManagementSection — ModelStorageFooter only on the standalone render (C1)', () => {
  it('a Library-view (stageFilter set) render has no ModelStorageFooter', async () => {
    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="asr" />);
    // Bare mode has no stage title — anchor on the rendered list instead.
    await screen.findByRole('button', { name: /Show all ASR models/ });
    expect(document.querySelector('.model-management__storage')).not.toBeInTheDocument();
  });

  it('the standalone (prop-less stageFilter) render keeps the footer', async () => {
    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
    await screen.findByText('ASR (Speech Recognition)');
    expect(document.querySelector('.model-management__storage')).toBeInTheDocument();
  });
});

// Freeze bug (2026-08-23): two writers of ONE shared voice field — the Library
// against its slot's target, SettingsInitializer against the forward target —
// ping-ponged it forever. Since #619 each direction owns its entry, and both
// writers compute the same first voice for the same target, so they agree.
describe('ModelManagementSection — voices per direction (#619)', () => {
  const voiceWrites = () => mockUpdate.mock.calls.filter(([p]) => p && 'voices' in p).map(([p]) => p.voices);

  it("a reversed-direction Library fixes that direction's Edge voice only, against its own target", async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'ja-JP-NanamiNeural' } };

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="tts" direction="ja→en" />);

    await waitFor(() => expect(voiceWrites()).toHaveLength(1));
    expect(voiceWrites()[0]).toEqual({ 'en→ja': { edge: 'ja-JP-NanamiNeural' }, 'ja→en': { edge: 'en-US-AriaNeural' } });
  });

  it("a reversed-direction Library opened from the translation slot writes no voice", async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'ja-JP-NanamiNeural' } };

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="translation" direction="ja→en" />);
    await new Promise((r) => setTimeout(r, 0));
    if (mockGetEdgeTtsVoices.mock.calls.length > 0) await mockGetEdgeTtsVoices.mock.results[0].value;
    await new Promise((r) => setTimeout(r, 0));
    expect(voiceWrites()).toEqual([]);
  });

  it("a reversed-direction TTS Library edits that direction's voice", async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'ja-JP-NanamiNeural' }, 'ja→en': { edge: 'en-US-AriaNeural' } };

    render(<ModelManagementSection isSessionActive={false} {...slice()} stageFilter="tts" direction="ja→en" />);
    const select = await screen.findByDisplayValue(/Aria/);
    expect(select).toBeInTheDocument();
    expect(within(select).queryByText(/Nanami/)).toBeNull();
  });

  it('the forward render fixes an invalid voice once, and not again on a re-render with unchanged inputs', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'en-US-AriaNeural' } }; // wrong language for target ja

    const { rerender } = render(<ModelManagementSection isSessionActive={false} {...slice()} />);
    await waitFor(() => expect(voiceWrites()).toHaveLength(1));
    expect(voiceWrites()[0]).toEqual({ 'en→ja': { edge: 'ja-JP-NanamiNeural' } });

    rerender(<ModelManagementSection isSessionActive={false} {...slice()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(voiceWrites()).toHaveLength(1);
  });

  it('writes nothing when the direction already has a voice of its target', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockSettings.voices = { 'en→ja': { edge: 'ja-JP-NanamiNeural' } };

    render(<ModelManagementSection isSessionActive={false} {...slice()} />);
    await waitFor(() => expect(mockGetEdgeTtsVoices).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(voiceWrites()).toEqual([]);
  });
});
