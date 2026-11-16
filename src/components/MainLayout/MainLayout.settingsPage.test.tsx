import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../MainPanel/MainPanel', () => ({ default: () => <div data-testid="main-panel" /> }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => null }));
vi.mock('../VbCable/VbCableIntro', () => ({ default: () => null }));
vi.mock('../Region/RegionRecommendation', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleTakeover', () => ({ SubtitleTakeover: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => <div data-testid="panel-resizer" /> }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../SettingsPage/SettingsPage', () => ({ SettingsPage: () => <div data-testid="settings-page" />, default: () => <div data-testid="settings-page" /> }));
vi.mock('../TitleBar/TitleBar', () => ({ default: () => <div data-testid="title-bar" /> }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: () => null }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
const state = vi.hoisted(() => ({ extension: false, showSettings: true, target: null as string | null, setShowSettings: vi.fn() }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => false, isExtension: () => state.extension, isKizunaAIEnabled: () => false,
}));
vi.mock('../../stores/settingsStore', () => ({
  useLiveNotesSetting: () => false, useNotesAfterSession: () => false,
  useSettingsNavigationTarget: () => state.target, useSubtitleModeActive: () => false, useDiagnosticLogs: () => false,
}));
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => true, useSetupComplete: () => true }));
vi.mock('../../stores/layoutStore', () => ({
  useShowSettings: () => state.showSettings, useSetShowSettings: () => state.setShowSettings,
  useSetupWizardOpen: () => false, useHistoryOpen: () => false, useSetHistoryOpen: () => vi.fn(), useSetSetupWizardOpen: () => vi.fn(),
}));

import MainLayout from './MainLayout';

beforeEach(() => {
  cleanup();
  state.extension = false; state.showSettings = true; state.target = null; state.setShowSettings.mockClear();
});

describe('where the settings page opens', () => {
  it('takes the place of the conversation on the desktop and keeps it mounted', () => {
    const { container } = render(<MainLayout />);
    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    expect(screen.getByTestId('main-panel')).toBeInTheDocument();
    expect((container.querySelector('.main-content') as HTMLElement).style.display).toBe('none');
    expect(container.querySelector('.settings-panel-container')?.contains(screen.getByTestId('settings-page'))).toBeFalsy();
    expect(screen.queryByTestId('panel-resizer')).toBeNull();
  });

  it('in the extension the page sits in the side panel next to the conversation', () => {
    state.extension = true;
    const { container } = render(<MainLayout />);
    expect(container.querySelector('.settings-panel-container')?.contains(screen.getByTestId('settings-page'))).toBe(true);
    expect((container.querySelector('.main-content') as HTMLElement).style.display).not.toBe('none');
  });

  it('a navigation target opens the page', () => {
    state.showSettings = false; state.target = 'speech';
    render(<MainLayout />);
    expect(state.setShowSettings).toHaveBeenCalledWith(true);
  });
});
