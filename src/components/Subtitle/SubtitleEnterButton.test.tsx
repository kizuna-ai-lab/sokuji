import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SubtitleEnterButton from './SubtitleEnterButton';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { CONTENT_SCRIPT_UNAVAILABLE } from './surfaces/ExtensionContentScriptSubtitleSurface';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

let phase: 'idle' | 'starting' | 'running' | 'stopping' = 'idle';
vi.mock('../../app/useRun', () => ({
  useRunPhase: () => phase,
}));

const enterSubtitleMode = vi.fn(async () => {});
let subtitleActive = false;
vi.mock('../../stores/settingsStore', () => ({
  useEnterSubtitleMode: () => enterSubtitleMode,
  useExitSubtitleMode: () => vi.fn(async () => {}),
  useSubtitleModeActive: () => subtitleActive,
}));

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

let electron = true;
vi.mock('../../utils/environment', () => ({
  isElectron: () => electron,
  isExtension: () => !electron,
}));

beforeEach(() => {
  cleanup();
  enterSubtitleMode.mockClear();
  phase = 'idle';
  subtitleActive = false;
  electron = true;
  useSubtitleStore.setState({ entryHint: null });
});

describe('SubtitleEnterButton on Electron', () => {
  // Issue #324: the window is the place users size and position ahead of the
  // meeting, so it must open before a session exists.
  it('is enabled with no active session', () => {
    render(<SubtitleEnterButton />);
    const btn = screen.getByRole('button');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(enterSubtitleMode).toHaveBeenCalledTimes(1);
  });

  it('is enabled during a session', () => {
    phase = 'running';
    render(<SubtitleEnterButton />);
    expect(screen.getByRole('button')).toBeEnabled();
  });
});

describe('SubtitleEnterButton on the extension', () => {
  // Out of scope for #324: the side panel is always visible there and can
  // start the session itself, so the overlay stays session-gated.
  it('stays disabled without a session', () => {
    electron = false;
    render(<SubtitleEnterButton />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is enabled once a session is running', () => {
    electron = false;
    phase = 'running';
    render(<SubtitleEnterButton />);
    expect(screen.getByRole('button')).toBeEnabled();
  });

  // 'starting' and 'stopping' are a run in flight, not "running" — the
  // extension's overlay has no start/stop control of its own, so it must stay
  // gated until the run actually reaches 'running'.
  it.each(['starting', 'stopping'] as const)('stays disabled while %s', (p) => {
    electron = false;
    phase = p;
    render(<SubtitleEnterButton />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('SubtitleEnterButton refresh hint', () => {
  it('sets the refresh hint when the content script is unavailable', async () => {
    enterSubtitleMode.mockRejectedValueOnce(
      Object.assign(new Error('no receiver'), { code: CONTENT_SCRIPT_UNAVAILABLE }),
    );
    render(<SubtitleEnterButton />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(useSubtitleStore.getState().entryHint).toBe('refresh'));
  });

  it('clears the hint after a successful entry', async () => {
    useSubtitleStore.setState({ entryHint: 'refresh' });
    render(<SubtitleEnterButton />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(useSubtitleStore.getState().entryHint).toBeNull());
  });

  it('leaves the hint alone on an unrelated failure', async () => {
    enterSubtitleMode.mockRejectedValueOnce(new Error('other'));
    render(<SubtitleEnterButton />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(enterSubtitleMode).toHaveBeenCalled());
    expect(useSubtitleStore.getState().entryHint).toBeNull();
  });
});
