import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MainLayout from './MainLayout';

vi.mock('../MainPanel/MainPanel', () => ({ default: () => <div data-testid="main-panel" /> }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => <div data-testid="tour-overlay" /> }));
vi.mock('../Subtitle/SubtitleApp', () => ({ default: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => null }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../Settings', () => ({ Settings: () => null }));
vi.mock('../TitleBar/TitleBar', () => ({ default: () => <div data-testid="title-bar" /> }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: ({ variant }: { variant: string }) => <div data-testid={`wizard-${variant}`} /> }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: false }) }));
// Both halves of the tour's render gate are mutable: only Electron reshapes
// its window for subtitle mode, so the takeover needs the pair to be true.
// vi.hoisted, not a plain `let`: ProviderConfigFactory's static initializer
// calls isElectron() while this module is still evaluating, which a `let`
// would answer from its temporal dead zone.
const flags = vi.hoisted(() => ({ electron: false, subtitleActive: false }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => flags.electron, isKizunaAIEnabled: () => false,
}));
vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => 'openai', useUIMode: () => 'basic', useSetProvider: () => vi.fn(),
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => flags.subtitleActive,
}));
let loaded = true; let complete = true; let wizardOpen = false;
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => loaded, useSetupComplete: () => complete }));
vi.mock('../../stores/layoutStore', () => ({
  useShowSettings: () => false, useSetShowSettings: () => vi.fn(),
  useSetupWizardOpen: () => wizardOpen, useSetSetupWizardOpen: () => vi.fn(),
}));

beforeEach(() => { cleanup(); loaded = true; complete = true; wizardOpen = false; flags.electron = false; flags.subtitleActive = false; });

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

  it('mounts the tour overlay with the layout', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('tour-overlay')).toBeInTheDocument();
  });

  it('drops the tour overlay during an Electron subtitle takeover', () => {
    // The window is reshaped into a tiny bar and every anchor the tour points
    // at is gone; TourOverlay portals to document.body, so the takeover's
    // display:none would not have hidden it.
    flags.electron = true; flags.subtitleActive = true;
    render(<MainLayout />);
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(screen.queryByTestId('title-bar')).toBeNull();
  });
});
