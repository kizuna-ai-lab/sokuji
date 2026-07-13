import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { ModelManagementSection } from './ModelManagementSection';

const defaultSettings = {
  sourceLanguage: 'en', targetLanguage: 'en',
  asrModel: '', translationModel: '', ttsModel: '',
  ttsSpeakerId: 0, ttsSpeed: 1, edgeTtsVoice: '',
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
const mockStatuses: Record<string, string> = {};
const mockDownloads: Record<string, any> = {};
const mockStoreState = {
  initialize: vi.fn(),
  downloadModel: vi.fn(),
  cancelDownload: vi.fn(),
  deleteModel: vi.fn(),
  deleteAllModels: vi.fn(),
  rememberModels: vi.fn(),
};
vi.mock('../../../stores/modelStore', () => ({
  useModelStatuses: () => mockStatuses,
  useModelDownloads: () => mockDownloads,
  useDownloadErrors: () => ({}),
  useStorageUsedMb: () => 0,
  useModelInitialized: () => true,
  useModelInitError: () => null,
  useWebGPUAvailable: () => true,
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
  Object.assign(mockSettings, defaultSettings);
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
    // supertonic-3 is a real, multilingual-enough (en) TTS model with a voice library.
    mockSettings.ttsModel = 'supertonic-3';
    mockStatuses['supertonic-3'] = 'downloaded';

    render(<ModelManagementSection isSessionActive={false} />);

    const card = await waitFor(() => screen.getByTestId('model-card-supertonic-3'));
    // VoiceLibrarySection (Supertonic dropdown) renders a "Voice" label in the body.
    expect(within(card).queryByText('Voice')).toBeTruthy();
    // The voice control renders only in the selected TTS card, nowhere else.
    expect(screen.getAllByText('Voice')).toHaveLength(1);
  });
});
