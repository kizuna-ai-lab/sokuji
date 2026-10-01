import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import MainLayout from './MainLayout';

vi.mock('../MainPanel/MainPanel', () => ({ default: () => <div data-testid="main-panel" /> }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => <div data-testid="tour-overlay" /> }));
vi.mock('../Subtitle/SubtitleTakeover', () => ({ SubtitleTakeover: () => <div data-testid="subtitle-takeover" /> }));
vi.mock('./PanelResizer', () => ({ default: () => null }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../Settings', () => ({ Settings: () => null }));
vi.mock('../TitleBar/TitleBar', () => ({
  default: ({ showLogsButton }: { showLogsButton: boolean }) => (
    <div data-testid="title-bar" data-logs-button={String(showLogsButton)} />
  ),
}));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: ({ variant }: { variant: string }) => <div data-testid={`wizard-${variant}`} /> }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: false }) }));
// The switch itself lives in its own hook (useSignInProviderSwitch.test.tsx);
// a spy here pins only what MainLayout passes it — the wizard wiring below.
const switchSpy = vi.hoisted(() => vi.fn());
vi.mock('./useSignInProviderSwitch', () => ({ useSignInProviderSwitch: switchSpy }));
// Both halves of the tour's render gate are mutable: only Electron reshapes
// its window for subtitle mode, so the takeover needs the pair to be true.
// vi.hoisted: the mocks' factories below read it.
const flags = vi.hoisted(() => ({ electron: false, subtitleActive: false, diagnosticLogs: false }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => flags.electron, isKizunaAIEnabled: () => false,
}));
// Only what MainLayout itself reads: no provider, no UI mode, no provider
// setter. The sign-in switch reads uiMode too, but it lives in its own hook
// (useSignInProviderSwitch, mocked above as a spy), so this file mocks
// settingsStore whole rather than growing this list to cover it.
vi.mock('../../stores/settingsStore', () => ({
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => flags.subtitleActive,
  useDiagnosticLogs: () => flags.diagnosticLogs,
}));
let loaded = true; let complete = true; let wizardOpen = false;
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => loaded, useSetupComplete: () => complete }));
vi.mock('../../stores/layoutStore', () => ({
  useShowSettings: () => false, useSetShowSettings: () => vi.fn(),
  useSetupWizardOpen: () => wizardOpen, useSetSetupWizardOpen: () => vi.fn(),
}));

beforeEach(() => {
  cleanup();
  loaded = true; complete = true; wizardOpen = false;
  flags.electron = false; flags.subtitleActive = false; flags.diagnosticLogs = false;
  switchSpy.mockClear();
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
    // The app session's takeover in the layout's place.
    expect(screen.getByTestId('subtitle-takeover')).toBeInTheDocument();
  });
});

// The sign-in switch itself lives in useSignInProviderSwitch, mocked above as
// a spy: what matters here is only the one boolean MainLayout computes and
// hands it — the #444 bug (Codex P2, CodeRabbit major) was dropping the
// `|| !setupComplete` half of this expression, which nothing here pinned
// once the switch moved into its own hook and the mock swallowed the call.
describe('wires the sign-in switch to both wizards (spec history, #444)', () => {
  it('passes true while the first-run wizard is on screen', () => {
    complete = false;
    render(<MainLayout />);
    expect(switchSpy).toHaveBeenLastCalledWith(true);
  });

  it('passes true while the rerun wizard is open', () => {
    wizardOpen = true;
    render(<MainLayout />);
    expect(switchSpy).toHaveBeenLastCalledWith(true);
  });

  it('passes false once setup is complete and neither wizard is open', () => {
    render(<MainLayout />);
    expect(switchSpy).toHaveBeenLastCalledWith(false);
  });
});

// Diagnostic logs are opt-in (Help), and the logs button follows that switch
// alone. This file renders in Basic mode, where the button used never to
// exist: a user asked for logs must not have to find Advanced mode first.
describe('logs button follows the diagnostic logs switch', () => {
  it('offers the logs button in Basic mode once diagnostic logs are on', () => {
    flags.diagnosticLogs = true;
    render(<MainLayout />);
    expect(screen.getByTestId('title-bar').dataset.logsButton).toBe('true');
  });

  it('offers no logs button while diagnostic logs are off', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('title-bar').dataset.logsButton).toBe('false');
  });
});
