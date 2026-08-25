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
let signedIn = false;
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: signedIn }) }));
// The sign-in auto-switch needs a managed provider to switch TO, and the real
// factory registers none under this file's feature flags.
const setProvider = vi.hoisted(() => vi.fn());
vi.mock('../../services/providers/ProviderConfigFactory', () => ({
  ProviderConfigFactory: { getDefaultManagedProvider: () => 'kizunaai_soniox' },
}));
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
  useProvider: () => 'openai', useUIMode: () => 'basic', useSetProvider: () => setProvider,
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => flags.subtitleActive,
}));
let loaded = true; let complete = true; let wizardOpen = false;
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => loaded, useSetupComplete: () => complete }));
vi.mock('../../stores/layoutStore', () => ({
  useShowSettings: () => false, useSetShowSettings: () => vi.fn(),
  useSetupWizardOpen: () => wizardOpen, useSetSetupWizardOpen: () => vi.fn(),
}));

beforeEach(() => {
  cleanup();
  loaded = true; complete = true; wizardOpen = false; signedIn = false;
  flags.electron = false; flags.subtitleActive = false;
  setProvider.mockClear();
});

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

describe('sign-in auto-switch vs the setup wizard', () => {
  it('switches a Basic-mode user to the managed provider on sign-in', () => {
    const { rerender } = render(<MainLayout />);
    signedIn = true;
    rerender(<MainLayout />);
    expect(setProvider).toHaveBeenCalledWith('kizunaai_soniox');
  });

  it('leaves the provider alone while first-run setup is still on screen', () => {
    // Reviewers on #444 (Codex P2, CodeRabbit major): setupWizardOpen is the
    // RERUN overlay's flag, so it is false while MainLayout is rendering the
    // first-run wizard in place of the layout. Signing in from that wizard's
    // account step used to write the provider behind a draft the user had not
    // committed — against the wizard's own "nothing is written until Finish".
    complete = false;
    const { rerender } = render(<MainLayout />);
    signedIn = true;
    rerender(<MainLayout />);
    expect(setProvider).not.toHaveBeenCalled();

    // Once Finish writes the record, a later sign-in switches normally.
    complete = true;
    signedIn = false;
    rerender(<MainLayout />);
    signedIn = true;
    rerender(<MainLayout />);
    expect(setProvider).toHaveBeenCalledWith('kizunaai_soniox');
  });

  it('leaves the provider alone while the rerun wizard is open, and after it closes', () => {
    // Backing out of the wizard must touch nothing (spec §1.1); Finish writes
    // the provider itself on the managed path, so nothing is lost by skipping.
    wizardOpen = true;
    const { rerender } = render(<MainLayout />);
    signedIn = true;
    rerender(<MainLayout />);
    expect(setProvider).not.toHaveBeenCalled();

    // And the skipped switch must not fire late once the overlay goes away.
    wizardOpen = false;
    rerender(<MainLayout />);
    expect(setProvider).not.toHaveBeenCalled();
  });
});
