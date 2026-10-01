// src/components/Subtitle/SubtitleEnterButton.integration.test.tsx
//
// Regression coverage for the class of bug where SubtitleEnterButton's
// `canEnter` gating and settingsStore.enterSubtitleMode's guard drifted:
// the button became enabled on Electron with no active session (issue
// #324), but the store still refused to enter because it hadn't been
// updated to match. Unlike SubtitleEnterButton.test.tsx (which mocks the
// whole settings store), this file exercises the REAL store action so a
// future drift between the two gates fails a test instead of shipping a
// dead click.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
  };
});

vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: any) => d,
      setSetting: async () => undefined,
    }),
  },
}));

let isElectronFlag = true;
vi.mock('../../utils/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/environment')>();
  return {
    ...actual,
    isElectron: () => isElectronFlag,
    isExtension: () => !isElectronFlag,
  };
});

// The button's own read of the run phase (`useRunPhase`, via `getAppSession()`)
// pulls the whole root module graph — mocked here so this file stays scoped
// to settingsStore.enterSubtitleMode. `registerRunPhase` below wires the SAME
// variable into that store's guard (the non-React leaf, src/app/runPhase.ts),
// so the two gates this file exists to keep in sync read one fact.
let phase: 'idle' | 'starting' | 'running' | 'stopping' = 'idle';
vi.mock('../../app/useRun', () => ({
  useRunPhase: () => phase,
}));

beforeEach(() => {
  (window as any).electron = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'subtitle:enter') {
        return { ok: true, bounds: { x: 0, y: 0, width: 800, height: 200 } };
      }
      return { ok: true };
    }),
    receive: () => {},
    removeListener: () => {},
    removeAllListeners: () => {},
    send: () => {},
  };
});

// Import after mocking so settingsStore picks up the mocked environment and
// ServiceFactory.
const { default: SubtitleEnterButton } = await import('./SubtitleEnterButton');
const { default: useSettingsStore } = await import('../../stores/settingsStore');
const { registerRunPhase } = await import('../../app/runPhase');

describe('SubtitleEnterButton wired to the real settingsStore', () => {
  beforeEach(() => {
    cleanup();
    isElectronFlag = true;
    phase = 'idle';
    useSettingsStore.setState({ subtitleModeActive: false, subtitleFullscreen: false });
    // Feeds enterSubtitleMode's guard from the same `phase` the mocked
    // useRunPhase above hands the button, so a test that flips one flips both.
    registerRunPhase(() => phase);
  });

  it('a click on Electron with no session actually enters subtitle mode', async () => {
    render(<SubtitleEnterButton />);
    const btn = screen.getByRole('button');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => {
      expect(useSettingsStore.getState().subtitleModeActive).toBe(true);
    });
  });

  it('stays disabled and inert on the extension with no session', async () => {
    isElectronFlag = false;
    render(<SubtitleEnterButton />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
  });
});
