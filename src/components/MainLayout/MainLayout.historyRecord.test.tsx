// The record the live notes open History at is for that one opening: History closed any other way opens at its list.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// MainLayout hands MainPanel the live notes to draw in the conversation's area.
vi.mock('../MainPanel/MainPanel', () => ({ default: (p: { liveNotes?: ReactNode }) => <div data-testid="main-panel">{p.liveNotes}</div> }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => null }));
vi.mock('../VbCable/VbCableIntro', () => ({ default: () => null }));
vi.mock('../Region/RegionRecommendation', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleTakeover', () => ({ SubtitleTakeover: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => <div data-testid="panel-resizer" /> }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../SettingsPage/SettingsPage', () => ({ SettingsPage: () => <div data-testid="settings-page" />, default: () => <div data-testid="settings-page" /> }));
vi.mock('../TitleBar/TitleBar', () => ({
  default: (p: { onToggleLogs: () => void; showLogs: boolean }) => (
    <div data-testid="title-bar">
      <button type="button" onClick={p.onToggleLogs}>Logs</button>
      <span data-testid="logs-active">{String(p.showLogs)}</span>
    </div>
  ),
}));
const logs = vi.hoisted(() => ({ on: false }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: () => null }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true, isExtension: () => false, isKizunaAIEnabled: () => false,
}));
vi.mock('../../stores/settingsStore', () => ({
  useLiveNotesSetting: () => false, useNotesAfterSession: () => false,
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => false, useDiagnosticLogs: () => logs.on,
}));
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => true, useSetupComplete: () => true }));

vi.mock('../History/HistoryPage', () => ({
  HistoryPage: (p: { recordId: string | null }) => <div data-testid="history-page">{p.recordId ?? 'list'}</div>,
}));
vi.mock('../LiveNotes/LiveNotesPanel', () => ({
  default: (p: { onOpenHistory(id: string): void }) => <button type="button" onClick={() => p.onOpenHistory('rec1')}>Open History</button>,
}));

import MainLayout from './MainLayout';
import { useLayoutStore } from '../../stores/layoutStore';

beforeEach(() => { logs.on = false; sessionStorage.clear(); useLayoutStore.setState({ historyOpen: false, showSettings: false }); });
afterEach(() => cleanup());

describe('History opened from the live notes', () => {
  it('opens at the record, and at the list after it was left for the settings', () => {
    render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Open History' }));
    expect(screen.getByTestId('history-page').textContent).toBe('rec1');
    act(() => { useLayoutStore.getState().setShowSettings(true); });
    act(() => { useLayoutStore.getState().setHistoryOpen(true); });
    expect(screen.getByTestId('history-page').textContent).toBe('list');
  });

  it('opens at the list after it was left for the logs', () => {
    logs.on = true;
    render(<MainLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Open History' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    act(() => { useLayoutStore.getState().setHistoryOpen(true); });
    expect(screen.getByTestId('history-page').textContent).toBe('list');
  });
});
