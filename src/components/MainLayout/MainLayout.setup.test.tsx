import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MainLayout from './MainLayout';

vi.mock('../MainPanel/MainPanel', () => ({ default: () => <div data-testid="main-panel" /> }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleApp', () => ({ default: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => null }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../Settings', () => ({ Settings: () => null }));
vi.mock('../TitleBar/TitleBar', () => ({ default: () => <div data-testid="title-bar" /> }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: ({ variant }: { variant: string }) => <div data-testid={`wizard-${variant}`} /> }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: false }) }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => false, isKizunaAIEnabled: () => false,
}));
vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => 'openai', useUIMode: () => 'basic', useSetProvider: () => vi.fn(),
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => false,
}));
let loaded = true; let complete = true; let wizardOpen = false;
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => loaded, useSetupComplete: () => complete }));
vi.mock('../../stores/layoutStore', () => ({
  useShowSettings: () => false, useSetShowSettings: () => vi.fn(),
  useSetupWizardOpen: () => wizardOpen, useSetSetupWizardOpen: () => vi.fn(),
}));

beforeEach(() => { cleanup(); loaded = true; complete = true; wizardOpen = false; });

describe('MainLayout first-run gating (spec §1.1)', () => {
  it('renders nothing until setup state has loaded — no wizard flash for migrated users', () => {
    loaded = false; complete = false;
    render(<MainLayout />);
    expect(screen.queryByTestId('wizard-first-run')).toBeNull();
    expect(screen.queryByTestId('title-bar')).toBeNull();
  });

  it('shows the first-run wizard instead of the layout on a fresh install', () => {
    complete = false;
    render(<MainLayout />);
    expect(screen.getByTestId('wizard-first-run')).toBeInTheDocument();
    expect(screen.queryByTestId('title-bar')).toBeNull();
  });

  it('shows the layout once setup is complete', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('title-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('wizard-first-run')).toBeNull();
  });

  it('overlays the rerun wizard over the layout when Help asked for it', () => {
    wizardOpen = true;
    render(<MainLayout />);
    expect(screen.getByTestId('title-bar')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-rerun')).toBeInTheDocument();
  });
});
