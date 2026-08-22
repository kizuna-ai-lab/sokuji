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
  // Interpolating, mirroring StoragePage.test.tsx — needed so a
  // compatibilitySplit group header's {{lang}} actually resolves to the
  // language NAME the component passed in, not the raw placeholder (I5/I3).
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

// I3 (final-review carry-over): the Library surface (stageFilter +
// compatibilitySplit) had zero dedicated tests — everything above exercises
// the standalone (Settings-page) render. These four cover the spec's own
// checklist for that surface.
describe('ModelManagementSection — compatibilitySplit / Library surface (I3)', () => {
  it('renders every model of the filtered stage, split into a compatible group and a collapsed "Other languages" group (regression guard against quietly reintroducing a language filter)', async () => {
    // moonshine-tiny-ja-quant supports only 'ja' — incompatible with an 'en'
    // source, so it lands in the "Other languages" group.
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';

    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" compatibilitySplit />);
    await screen.findByText('ASR (Speech Recognition)');

    // Collapsed by default: the incompatible model is in the manifest but
    // absent from the DOM until its group is expanded.
    expect(screen.queryByTestId('model-card-moonshine-tiny-ja-quant')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Other languages'));
    expect(await screen.findByTestId('model-card-moonshine-tiny-ja-quant')).toBeInTheDocument();

    // Every ASR model in the manifest renders SOMEWHERE across the two groups
    // — nothing is silently dropped by the split.
    const allAsr = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    for (const m of allAsr) {
      expect(screen.getByTestId(`model-card-${m.id}`)).toBeInTheDocument();
    }
  });

  it('the group header wording keys on the right language axis: ASR reads the source language, TTS reads the target — the two differ for one direction', async () => {
    mockSettings.sourceLanguage = 'ja';
    mockSettings.targetLanguage = 'en';

    render(<ModelManagementSection isSessionActive={false} compatibilitySplit />);
    await screen.findByText('ASR (Speech Recognition)');

    // Scoped to each stage's own ModelGroup, and to the INNER (nested,
    // compatibilitySplit) "Supports X" title specifically — the outer
    // ModelGroup carries the stage's plain name ("ASR (Speech Recognition)"),
    // and the translation group's inner header ALSO reads "Supports
    // {{lang}}", but its {{lang}} is the full pair sentence ("Supports
    // 日本語 → English"), which would falsely satisfy a looser "any header
    // contains the source name" check.
    const findSupportsHeader = (sectionId: string) =>
      Array.from(document.querySelectorAll(`#${sectionId}-section .model-group__title`))
        .find((el) => el.textContent?.startsWith('Supports '));
    const asrHeader = findSupportsHeader('model-asr');
    const ttsHeader = findSupportsHeader('model-tts');

    // Resolved NAMES (languageNameFor), not the raw 'ja'/'en' codes — and the
    // two axes must differ, or a copy-paste bug (both reading source, say)
    // would pass unnoticed.
    expect(asrHeader).toHaveTextContent('Supports 日本語');
    expect(ttsHeader).toHaveTextContent('Supports English');
    expect(asrHeader?.textContent).not.toBe(ttsHeader?.textContent);
  });

  it('an incompatible model offers Download but clicking it (the "Use" affordance) does not write a selection', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';

    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" compatibilitySplit />);
    fireEvent.click(screen.getByText('Other languages'));

    const card = await screen.findByTestId('model-card-moonshine-tiny-ja-quant');
    expect(within(card).getByTitle('Download')).toBeInTheDocument();

    // ModelCard's own isCompatible guard blocks selection on click.
    fireEvent.click(card);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a downloaded incompatible model shows the "available when your language is" line, naming the language', async () => {
    mockSettings.sourceLanguage = 'en';
    mockSettings.targetLanguage = 'ja';
    mockStatuses['moonshine-tiny-ja-quant'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} stageFilter="asr" compatibilitySplit />);
    fireEvent.click(screen.getByText('Other languages'));
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
    await screen.findByText('ASR (Speech Recognition)');
    expect(document.querySelector('.model-management__storage')).not.toBeInTheDocument();
  });

  it('the standalone (prop-less stageFilter) render keeps the footer', async () => {
    render(<ModelManagementSection isSessionActive={false} />);
    await screen.findByText('ASR (Speech Recognition)');
    expect(document.querySelector('.model-management__storage')).toBeInTheDocument();
  });
});
