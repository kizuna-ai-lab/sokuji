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

// Import after mocking so settingsStore/sessionStore pick up the mocked
// environment and ServiceFactory.
const { default: SubtitleEnterButton } = await import('./SubtitleEnterButton');
const { default: useSettingsStore } = await import('../../stores/settingsStore');
const { default: useSessionStore } = await import('../../stores/sessionStore');

describe('SubtitleEnterButton wired to the real settingsStore', () => {
  beforeEach(() => {
    cleanup();
    isElectronFlag = true;
    useSettingsStore.setState({ subtitleModeActive: false, subtitleFullscreen: false });
    useSessionStore.setState({ isSessionActive: false } as any);
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
