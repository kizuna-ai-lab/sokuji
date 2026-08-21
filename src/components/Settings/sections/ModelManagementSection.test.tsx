import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { ModelManagementSection } from './ModelManagementSection';
import { getManifestByType, getManifestEntry, type ModelStatus } from '../../../lib/local-inference/modelManifest';
import { resolveDirection } from '../../../lib/local-inference/selection/resolveStage';
import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
import { directionKey, type Selections } from '../../../lib/local-inference/selection/types';

const defaultSettings = {
  sourceLanguage: 'en', targetLanguage: 'en',
  asrModel: '', translationModel: '', ttsModel: '',
  ttsSpeakerId: 0, ttsSpeed: 1, edgeTtsVoice: '',
  selections: {} as Selections,
};
const mockSettings = { ...defaultSettings };
const mockUpdate = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
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
  rememberModels: vi.fn(),
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
  mockStoreState.rememberModels.mockReset();
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
