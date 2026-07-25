import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SubtitleBar from './SubtitleBar';

// i18n: return the default string passed to t(key, default).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

// The fullscreen flag + setter come from settingsStore.
const setSubtitleFullscreen = vi.fn(async () => {});
let fullscreenValue = false;
vi.mock('../../stores/settingsStore', () => ({
  __esModule: true,
  default: { getState: () => ({}) },
  useExitSubtitleMode: () => vi.fn(),
  useSubtitleFullscreen: () => fullscreenValue,
  useSetSubtitleFullscreen: () => setSubtitleFullscreen,
}));

// subtitleStore: provide the settings object + the action hooks SubtitleBar uses.
vi.mock('../../stores/subtitleStore', () => ({
  useSubtitleSettings: () => ({
    fontSize: 24, compactMode: false, positionLocked: false, alwaysOnTop: false,
  }),
  useSetSubtitleFontSize: () => vi.fn(),
  useSetSubtitleCompactMode: () => vi.fn(),
  useToggleSubtitleAlwaysOnTop: () => vi.fn(),
  useToggleSubtitlePositionLocked: () => vi.fn(),
  useSubtitleSpeakerDisplayMode: () => 'both',
  useSubtitleParticipantDisplayMode: () => 'both',
  useSetSubtitleSpeakerDisplayMode: () => vi.fn(),
  useSetSubtitleParticipantDisplayMode: () => vi.fn(),
  FONT_SIZE_MIN: 12,
  FONT_SIZE_MAX: 64,
}));

// Drag/resize hook is irrelevant here.
vi.mock('./useOverlayDragResize', () => ({
  useOverlayDragResize: () => ({ dragHandleProps: {}, resizeHandleProps: {} }),
}));

// Stub the child components so we only assert SubtitleBar's own controls and
// don't pull conversationDisplayStore / ServiceFactory transitively.
vi.mock('../MainPanel/DisplayModeButton', () => ({ default: () => null }));
vi.mock('../MainPanel/ExportButton', () => ({
  default: () => require('react').createElement('div', { 'data-testid': 'export-button' }),
}));
vi.mock('../Display/DisplaySettingsPopover', () => ({ default: () => null }));

const baseProps = {
  sessionElapsedMs: 0,
  sourceLanguageCode: 'EN',
  targetLanguageCode: 'ZH',
  onClearConversation: vi.fn(),
  speakerActive: false,
  participantActive: false,
  exportProps: {} as any,
};

beforeEach(() => {
  cleanup();
  setSubtitleFullscreen.mockClear();
  fullscreenValue = false;
});

describe('SubtitleBar fullscreen button', () => {
  it('renders the fullscreen button on the electron surface', () => {
    render(<SubtitleBar {...baseProps} surface="electron" />);
    expect(screen.getByLabelText('Fullscreen')).toBeInTheDocument();
  });

  it('does NOT render the fullscreen button on the extension-overlay surface', () => {
    render(<SubtitleBar {...baseProps} surface="extension-overlay" />);
    expect(screen.queryByLabelText('Fullscreen')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Exit fullscreen')).not.toBeInTheDocument();
  });

  it('clicking the button enters fullscreen when currently windowed', () => {
    fullscreenValue = false;
    render(<SubtitleBar {...baseProps} surface="electron" />);
    fireEvent.click(screen.getByLabelText('Fullscreen'));
    expect(setSubtitleFullscreen).toHaveBeenCalledWith(true);
  });

  it('shows the exit-fullscreen affordance and exits when already fullscreen', () => {
    fullscreenValue = true;
    render(<SubtitleBar {...baseProps} surface="electron" />);
    const btn = screen.getByLabelText('Exit fullscreen');
    expect(btn.classList.contains('active')).toBe(true);
    fireEvent.click(btn);
    expect(setSubtitleFullscreen).toHaveBeenCalledWith(false);
  });
});

describe('SubtitleBar export button', () => {
  // In the extension overlay the forwarded items are windowed to the recent
  // tail, so export there would silently omit older messages. Export is only
  // offered on the Electron surface, where the overlay shares the full store.
  it('renders the export button on the electron surface', () => {
    render(<SubtitleBar {...baseProps} surface="electron" />);
    expect(screen.getByTestId('export-button')).toBeInTheDocument();
  });

  it('does NOT render the export button on the extension-overlay surface', () => {
    render(<SubtitleBar {...baseProps} surface="extension-overlay" />);
    expect(screen.queryByTestId('export-button')).not.toBeInTheDocument();
  });
});

describe('SubtitleBar session pill', () => {
  // Shaped by hand rather than derived from the component's props type — this
  // test file does not import React.
  interface SessionControl {
    isSessionActive: boolean;
    isInitializing: boolean;
    canStart: boolean;
    onStart: ReturnType<typeof vi.fn>;
    onStop: ReturnType<typeof vi.fn>;
  }
  const control = (over: Partial<SessionControl> = {}): SessionControl => ({
    isSessionActive: false,
    isInitializing: false,
    canStart: true,
    onStart: vi.fn(),
    onStop: vi.fn(),
    ...over,
  });

  it('renders a start pill when idle and ready', () => {
    const c = control();
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    const btn = screen.getByLabelText('Start session');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(c.onStart).toHaveBeenCalledTimes(1);
  });

  it('disables the start pill when the session cannot start', () => {
    const c = control({ canStart: false });
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    expect(screen.getByLabelText('Start session')).toBeDisabled();
  });

  it('renders a stop pill during a session', () => {
    const c = control({ isSessionActive: true });
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    const btn = screen.getByLabelText('Stop session');
    fireEvent.click(btn);
    expect(c.onStop).toHaveBeenCalledTimes(1);
  });

  it('disables the pill while initializing', () => {
    const c = control({ isInitializing: true });
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    expect(screen.getByLabelText('Start session')).toBeDisabled();
  });

  // Regression: the disabled expression used to be
  // `isInitializing || (!isSessionActive && !canStart)`, which read as
  // disabled whenever isInitializing was true regardless of session state.
  // Stop must always be clickable during a session — pin that invariant
  // directly rather than relying on MainPanel never setting isInitializing
  // true while isSessionActive is also true.
  it('keeps the stop pill enabled during a session even if isInitializing/canStart say otherwise', () => {
    const c = control({ isSessionActive: true, isInitializing: true, canStart: false });
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    expect(screen.getByLabelText('Stop session')).toBeEnabled();
  });

  // Start/stop from the overlay is out of scope: the side panel is always
  // visible there and owns session control.
  it('does NOT render the pill on the extension-overlay surface', () => {
    render(<SubtitleBar {...baseProps} surface="extension-overlay" sessionControl={control()} />);
    expect(screen.queryByLabelText('Start session')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stop session')).not.toBeInTheDocument();
  });

  it('renders nothing when no session control is supplied', () => {
    render(<SubtitleBar {...baseProps} surface="electron" />);
    expect(screen.queryByLabelText('Start session')).not.toBeInTheDocument();
  });
});
