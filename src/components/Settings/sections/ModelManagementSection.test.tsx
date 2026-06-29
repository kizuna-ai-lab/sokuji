import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ModelManagementSection } from './ModelManagementSection';

const mockSettings = {
  sourceLanguage: 'en', targetLanguage: 'en',
  asrModel: '', translationModel: '', ttsModel: '',
  ttsSpeakerId: 0, ttsSpeed: 1, edgeTtsVoice: '',
};
const mockUpdate = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));
vi.mock('../../../stores/settingsStore', () => ({
  useLocalInferenceSettings: () => mockSettings,
  useUpdateLocalInference: () => mockUpdate,
}));

// modelStore surface used by the component — all no-ops/empty so it renders.
const mockStoreState = {
  initialize: vi.fn(),
  downloadModel: vi.fn(),
  cancelDownload: vi.fn(),
  deleteModel: vi.fn(),
  deleteAllModels: vi.fn(),
  rememberModels: vi.fn(),
};
vi.mock('../../../stores/modelStore', () => ({
  useModelStatuses: () => ({}),
  useModelDownloads: () => ({}),
  useDownloadErrors: () => ({}),
  useStorageUsedMb: () => 0,
  useModelInitialized: () => true,
  useWebGPUAvailable: () => true,
  useDeviceFeatures: () => [],
  useModelVariants: () => ({}),
  useModelStore: Object.assign(
    (sel?: (s: typeof mockStoreState) => unknown) =>
      sel ? sel(mockStoreState) : mockStoreState,
    { getState: () => mockStoreState },
  ),
}));

beforeEach(() => { mockUpdate.mockReset(); });

describe('ModelManagementSection (self-reads store)', () => {
  it('renders without settings/update props', async () => {
    render(<ModelManagementSection isSessionActive={false} />);
    await waitFor(() =>
      expect(screen.getByText('ASR (Speech Recognition)')).toBeInTheDocument(),
    );
  });
});
