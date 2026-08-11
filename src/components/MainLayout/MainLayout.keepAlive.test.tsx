import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import MainLayout from './MainLayout';

const CounterStub = ({ label }: { label: string }) => {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount((c) => c + 1)}>{`${label}:${count}`}</button>
  );
};

vi.mock('../MainPanel/MainPanel', () => ({ default: () => null }));
vi.mock('../Onboarding/Onboarding', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleApp', () => ({ default: () => null }));
vi.mock('../UserTypeSelection/UserTypeSelection', () => ({ default: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => null }));
vi.mock('../TitleBar/TitleBar', () => ({ default: () => null }));

vi.mock('../LogsPanel/LogsPanel', () => ({
  default: () => <CounterStub label="logs" />,
}));
vi.mock('../Settings', () => ({
  Settings: () => <CounterStub label="settings" />,
}));

vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: false }) }));
vi.mock('../../contexts/OnboardingContext', () => ({
  useOnboarding: () => ({ userTypeSelected: true, setUserType: vi.fn() }),
}));
vi.mock('../../utils/environment', () => ({
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
  });

  it('preserves settings state across session toggle', () => {
    render(<MainLayout />);

    fireEvent.click(screen.getByLabelText('Settings'));
    const settings = screen.getByText(/^settings:/);
    fireEvent.click(settings);
    fireEvent.click(settings);
    expect(settings).toHaveTextContent('settings:2');

    // Back to session (toggle settings off), then reopen.
    fireEvent.click(screen.getByLabelText('Settings'));
    expect(screen.getByText(/^settings:/)).not.toBeVisible();

    fireEvent.click(screen.getByLabelText('Settings'));
    expect(screen.getByText(/^settings:/)).toBeVisible();
    expect(screen.getByText(/^settings:/)).toHaveTextContent('settings:2');
  });

  it('preserves logs drawer state across close and reopen', () => {
    render(<MainLayout />);

    fireEvent.click(screen.getByLabelText('Logs'));
    const logs = screen.getByText(/^logs:/);
    fireEvent.click(logs);
    expect(logs).toHaveTextContent('logs:1');

    fireEvent.click(screen.getByLabelText('Logs'));
    expect(screen.getByText(/^logs:/)).not.toBeVisible();

    fireEvent.click(screen.getByLabelText('Logs'));
    expect(screen.getByText(/^logs:/)).toBeVisible();
    expect(screen.getByText(/^logs:/)).toHaveTextContent('logs:1');
  });

  it('keeps settings alive while logs drawer overlays', () => {
    render(<MainLayout />);

    fireEvent.click(screen.getByLabelText('Settings'));
    fireEvent.click(screen.getByText(/^settings:/));
    expect(screen.getByText(/^settings:/)).toHaveTextContent('settings:1');

    fireEvent.click(screen.getByLabelText('Logs'));
    expect(screen.getByText(/^logs:/)).toBeVisible();
    // Settings remains the active main view under the drawer overlay.
    expect(screen.getByText(/^settings:/)).toHaveTextContent('settings:1');
  });

  it('shows session initially with settings/logs hidden', () => {
    render(<MainLayout />);
    expect(screen.getByText(/^settings:/)).not.toBeVisible();
    expect(screen.getByText(/^logs:/)).not.toBeVisible();
  });
});
