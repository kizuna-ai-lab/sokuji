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
