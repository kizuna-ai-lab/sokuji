// A link from History into Settings leaves History — the two pages never show at once.
// The real layout store; the pages themselves stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('../MainPanel/MainPanel', () => ({ default: () => <div data-testid="main-panel" /> }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => null }));
vi.mock('../VbCable/VbCableIntro', () => ({ default: () => null }));
vi.mock('../Region/RegionRecommendation', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleTakeover', () => ({ SubtitleTakeover: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => null }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../SettingsPage/SettingsPage', () => ({ SettingsPage: () => <div data-testid="settings-page" />, default: () => <div data-testid="settings-page" /> }));
vi.mock('../History/HistoryPage', () => ({ HistoryPage: () => <div data-testid="history-page" /> }));
vi.mock('../TitleBar/TitleBar', () => ({ default: () => <div data-testid="title-bar" /> }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: () => null }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true, isExtension: () => false, isKizunaAIEnabled: () => false,
}));
const nav = vi.hoisted(() => ({ target: null as string | null }));
vi.mock('../../stores/settingsStore', () => ({
  useLiveNotesSetting: () => false, useNotesAfterSession: () => false,
  useSettingsNavigationTarget: () => nav.target, useSubtitleModeActive: () => false, useDiagnosticLogs: () => false,
}));
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => true, useSetupComplete: () => true }));

import MainLayout from './MainLayout';
import { useLayoutStore } from '../../stores/layoutStore';

beforeEach(() => { nav.target = null; sessionStorage.clear(); useLayoutStore.setState({ historyOpen: true, showSettings: false }); });
afterEach(() => cleanup());

describe('from History into Settings, one page at a time', () => {
  for (const target of ['provider', 'lineup']) {
    it(`a navigation target (${target}) set from History closes History and shows the settings page`, () => {
      const view = render(<MainLayout />);
      expect(screen.getByTestId('history-page')).toBeInTheDocument();
      nav.target = target;
      act(() => { view.rerender(<MainLayout />); });
      expect(useLayoutStore.getState()).toMatchObject({ showSettings: true, historyOpen: false });
      expect(screen.queryByTestId('history-page')).toBeNull();
      const page = view.container.querySelector('.settings-page-container') as HTMLElement;
      expect(page).toContainElement(screen.getByTestId('settings-page'));
      expect(page.style.display).not.toBe('none');
    });
  }
});
