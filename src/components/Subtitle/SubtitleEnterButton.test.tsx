import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SubtitleEnterButton from './SubtitleEnterButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

let sessionActive = false;
vi.mock('../../stores/sessionStore', () => ({
  useIsSessionActive: () => sessionActive,
}));

const enterSubtitleMode = vi.fn(async () => {});
let subtitleActive = false;
vi.mock('../../stores/settingsStore', () => ({
  useEnterSubtitleMode: () => enterSubtitleMode,
  useExitSubtitleMode: () => vi.fn(async () => {}),
  useSubtitleModeActive: () => subtitleActive,
}));

vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

let electron = true;
vi.mock('../../utils/environment', () => ({
  isElectron: () => electron,
  isExtension: () => !electron,
}));

beforeEach(() => {
  cleanup();
  enterSubtitleMode.mockClear();
  sessionActive = false;
  subtitleActive = false;
  electron = true;
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
    sessionActive = true;
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
    sessionActive = true;
    render(<SubtitleEnterButton />);
    expect(screen.getByRole('button')).toBeEnabled();
  });
});
