import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import MainLayout from './MainLayout';
import { useLayoutStore } from '../../stores/layoutStore';

// Stateful stub: proves whether a panel's component state survives
// panel switches. Pre-keep-alive, switching panels unmounted the
// component and reset the counter.
const CounterStub = ({ label }: { label: string }) => {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount((c) => c + 1)}>{`${label}:${count}`}</button>
  );
};

vi.mock('../MainPanel/MainPanel', () => ({ default: () => null }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleApp', () => ({ default: () => null }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => null }));

vi.mock('../LogsPanel/LogsPanel', () => ({
  default: () => <CounterStub label="logs" />,
}));
vi.mock('../Settings', () => ({
  Settings: () => <CounterStub label="settings" />,
}));

// TitleBar: just the two toggle buttons MainLayout wires up.
vi.mock('../TitleBar/TitleBar', () => ({
  default: ({ onToggleSettings, onToggleLogs }: {
    onToggleSettings: () => void; onToggleLogs: () => void;
  }) => (
    <div>
      <button onClick={onToggleSettings}>toggle-settings</button>
      <button onClick={onToggleLogs}>toggle-logs</button>
    </div>
  ),
}));

vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: false }) }));
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => true, useSetupComplete: () => true }));
vi.mock('../../stores/layoutStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/layoutStore')>()),
  useSetupWizardOpen: () => false,
  useSetSetupWizardOpen: () => vi.fn(),
}));
// Spread the real module rather than enumerating exports: MainLayout pulls in
// ProviderConfigFactory, whose static initializer reads every feature flag, so
// a hand-listed mock goes stale the moment a new provider flag is added.
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => false,
  isKizunaAIEnabled: () => false,
}));
vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => 'openai',
  useUIMode: () => 'advanced',
  useSetProvider: () => vi.fn(),
  useSetUIMode: () => vi.fn(),
  useSettingsNavigationTarget: () => null,
  useSubtitleModeActive: () => false,
}));

describe('MainLayout panel keep-alive', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useLayoutStore.setState({ showSettings: false });
  });

  it('preserves panel state across settings -> logs -> settings', () => {
    render(<MainLayout />);

    fireEvent.click(screen.getByText('toggle-settings'));
    const settings = screen.getByText(/^settings:/);
    fireEvent.click(settings);
    fireEvent.click(settings);
    expect(settings).toHaveTextContent('settings:2');

    fireEvent.click(screen.getByText('toggle-logs'));
    expect(screen.getByText(/^settings:/)).not.toBeVisible();
    expect(screen.getByText(/^logs:/)).toBeVisible();

    fireEvent.click(screen.getByText('toggle-settings'));
    expect(screen.getByText(/^settings:/)).toBeVisible();
    expect(screen.getByText(/^settings:/)).toHaveTextContent('settings:2');
  });

  it('preserves panel state across close and reopen', () => {
    render(<MainLayout />);

    fireEvent.click(screen.getByText('toggle-settings'));
    fireEvent.click(screen.getByText(/^settings:/));
    expect(screen.getByText(/^settings:/)).toHaveTextContent('settings:1');

    // Close the panel entirely, then reopen it.
    fireEvent.click(screen.getByText('toggle-settings'));
    expect(screen.getByText(/^settings:/)).not.toBeVisible();
    fireEvent.click(screen.getByText('toggle-settings'));
    expect(screen.getByText(/^settings:/)).toHaveTextContent('settings:1');
  });

  it('shows no panel initially and keeps hidden panels out of the visible layout', () => {
    render(<MainLayout />);
    expect(screen.getByText(/^settings:/)).not.toBeVisible();
    expect(screen.getByText(/^logs:/)).not.toBeVisible();
  });
});
