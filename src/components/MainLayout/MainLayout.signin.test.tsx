import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import MainLayout from './MainLayout';
import { useProviderStore } from '../../stores/providerStore';
import { useLineUpStore } from '../../stores/lineUpStore';

vi.mock('../MainPanel/MainPanel', () => ({ default: () => <div data-testid="main-panel" /> }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => null }));
vi.mock('../VbCable/VbCableIntro', () => ({ default: () => null }));
vi.mock('../Region/RegionRecommendation', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleTakeover', () => ({ SubtitleTakeover: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => null }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../SettingsPage/SettingsPage', () => ({ SettingsPage: () => null }));
vi.mock('../TitleBar/TitleBar', () => ({ default: () => <div data-testid="title-bar" /> }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: () => null }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
const auth = vi.hoisted(() => ({ isSignedIn: false }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: auth.isSignedIn, error: null }) }));
// Kizuna AI offered, the Quick layout stored: the conditions under which signing in used to switch the provider.
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => false, isKizunaAIEnabled: () => true,
}));
vi.mock('../../stores/settingsStore', () => ({
  useLiveNotesSetting: () => false, useNotesAfterSession: () => false,
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => false,
  useDiagnosticLogs: () => false,
}));
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => true, useSetupComplete: () => true }));
vi.mock('../../stores/layoutStore', () => ({
  useShowSettings: () => false, useSetShowSettings: () => vi.fn(),
  useSetupWizardOpen: () => false, useHistoryOpen: () => false, useSetHistoryOpen: () => vi.fn(), useSetSetupWizardOpen: () => vi.fn(),
}));

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };

beforeEach(() => {
  cleanup();
  auth.isSignedIn = false;
  useProviderStore.setState({ selected: 'soniox', selectionLocked: false });
  useLineUpStore.setState({ lineUp: soniox, stored: true });
});

describe('signing in', () => {
  it('changes neither the line-up nor the selected provider', () => {
    const { rerender } = render(<MainLayout />);
    auth.isSignedIn = true;
    rerender(<MainLayout />);
    expect(useProviderStore.getState().selected).toBe('soniox');
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
  });
});
