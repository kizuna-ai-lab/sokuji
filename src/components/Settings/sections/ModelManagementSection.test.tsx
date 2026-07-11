import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  useModelDownloads: () => ({}),
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
});

describe('ModelManagementSection (self-reads store)', () => {
  it('renders without settings/update props', async () => {
    render(<ModelManagementSection isSessionActive={false} />);
    await waitFor(() =>
      expect(screen.getByText('ASR (Speech Recognition)')).toBeInTheDocument(),
    );
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
