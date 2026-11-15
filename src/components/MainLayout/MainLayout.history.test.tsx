// History takes the place of the conversation on the desktop; the conversation stays mounted under it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

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
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true, isExtension: () => false, isKizunaAIEnabled: () => false,
}));
vi.mock('../../stores/settingsStore', () => ({
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => false, useDiagnosticLogs: () => false,
}));
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => true, useSetupComplete: () => true }));

import MainLayout from './MainLayout';
import { useLayoutStore } from '../../stores/layoutStore';

beforeEach(() => useLayoutStore.setState({ historyOpen: false, showSettings: false }));
afterEach(() => cleanup());

describe('the History page in the layout', () => {
  it('takes the place of the conversation and keeps it mounted', () => {
    useLayoutStore.setState({ historyOpen: true });
    const { container } = render(<MainLayout />);
    expect(screen.getByTestId('history-page')).toBeInTheDocument();
    expect(screen.getByTestId('main-panel')).toBeInTheDocument();
    expect((container.querySelector('.main-content') as HTMLElement).style.display).toBe('none');
    expect(screen.queryByTestId('panel-resizer')).toBeNull();
  });

  it('is not there while closed', () => {
    const { container } = render(<MainLayout />);
    expect(screen.queryByTestId('history-page')).toBeNull();
    expect((container.querySelector('.main-content') as HTMLElement).style.display).toBe('');
  });

  it('Escape on the list leaves History', () => {
    useLayoutStore.setState({ historyOpen: true });
    render(<MainLayout />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useLayoutStore.getState().historyOpen).toBe(false);
  });
});
