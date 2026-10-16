/**
 * Tests for AudioDeviceSection's `lockedReason` — the explanation rendered when
 * a channel section is locked (issue #314).
 *
 * A locked section needs a statement of *why* it's locked, or a greyed
 * control reads as broken. The reason is also wired to
 * the device list via aria-describedby, so the `aria-disabled` options carry
 * their justification for screen readers rather than just going quiet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioDeviceSection from './AudioDeviceSection';

const echo = vi.hoisted(() => ({ mode: 'all' as 'app' | 'all', set: vi.fn(), os: 'macos', electron: true }));

vi.mock('../../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/environment')>()),
  isLinux: () => echo.os === 'linux',
  isElectron: () => echo.electron,
}));

// Resolve to the inline default when the call site has one, else echo the key —
// these tests assert on `lockedReason`, which is passed in as a plain string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

const devices = [
  { deviceId: 'mic-1', label: 'Built-in Microphone' },
  { deviceId: 'loop-1', label: 'Stereo Mix (Realtek High Definition Audio)' },
];

vi.mock('../../../stores/audioStore', () => ({
  useNoiseSuppressionMode: () => 'off',
  useSetNoiseSuppressionMode: () => vi.fn(),
  useEchoCancellationMode: () => echo.mode,
  useSetEchoCancellationMode: () => echo.set,
  useAudioContext: () => ({
    audioInputDevices: devices,
    selectedInputDevice: devices[0],
    isMicMuted: false,
    isLoading: false,
    selectInputDevice: vi.fn(),
    setMicMuted: vi.fn(),
    refreshDevices: vi.fn(),
  }),
}));

const REASON = 'The microphone is not used in this mode.';

const renderMic = (props: Record<string, unknown> = {}) =>
  render(<AudioDeviceSection isSessionActive={false} {...props} />);

describe('AudioDeviceSection lockedReason', () => {
  it('renders the reason when the section is locked', () => {
    renderMic({ isLocked: true, lockedReason: REASON });
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });

  it('omits the reason when the section is unlocked', () => {
    renderMic({ isLocked: false, lockedReason: REASON });
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
  });

  it('renders nothing extra when locked without a reason', () => {
    const { container } = renderMic({ isLocked: true });
    expect(container.querySelector('.section-locked-reason')).toBeNull();
  });

  it('describes the locked device list with the reason', () => {
    renderMic({ isLocked: true, lockedReason: REASON });
    const list = screen.getByRole('listbox');
    const describedBy = list.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(REASON);
  });

  it('leaves an unlocked device list undescribed', () => {
    renderMic({ isLocked: false, lockedReason: REASON });
    expect(screen.getByRole('listbox')).not.toHaveAttribute('aria-describedby');
  });

  // Every option drops to tabIndex -1 while disabled, so unless the listbox
  // itself takes focus there is nothing in the widget to land on — and an
  // aria-describedby that never gets announced is decoration. Keeping a
  // disabled control focusable is what lets a keyboard user discover why it
  // won't respond.
  it('keeps the locked list reachable by keyboard so the reason is announced', () => {
    renderMic({ isLocked: true, lockedReason: REASON });
    const list = screen.getByRole('listbox');
    expect(list).toHaveAttribute('tabindex', '0');
    expect(list).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the unlocked list out of the tab order — its options carry it', () => {
    renderMic({ isLocked: false });
    const list = screen.getByRole('listbox');
    expect(list).not.toHaveAttribute('tabindex');
    expect(list).not.toHaveAttribute('aria-disabled');
  });
});

// The panel lives inside an <Activity> boundary (MainLayout): hiding runs
// effect cleanups while state normally persists. The warning modal must NOT
// persist — a hidden-but-open dialog would reappear on reveal and swallow
// the visible panel's Escape key (PanelBar's dialog guard).
describe('AudioDeviceSection warning modal under Activity hide', () => {
  it('closes the warning modal when the panel hides', async () => {
    const { Activity } = await import('react');
    const { fireEvent } = await import('@testing-library/react');
    const ui = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <AudioDeviceSection isSessionActive={false} />
      </Activity>
    );
    const { rerender } = render(ui('visible'));

    // Picking a loopback-style input opens the warning modal.
    fireEvent.click(screen.getByText('Stereo Mix (Realtek High Definition Audio)'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    rerender(ui('hidden'));
    rerender(ui('visible'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// Regression guard (issue #335): participant UI belongs in SystemAudioSection;
// the microphone section must not render any of it.
describe('AudioDeviceSection renders no participant UI', () => {
  it('renders nothing participant-related', () => {
    const { container } = render(<AudioDeviceSection isSessionActive={false} />);
    expect(container.querySelector('#participant-section')).toBeNull();
    expect(container.querySelector('#participant-source-section')).toBeNull();
    expect(container.querySelector('.participant-source-picker')).toBeNull();
  });
});

// 'all' cancels every sound the system plays, which silences a loopback
// microphone such as BlackHole; the user can ask for what this app plays only.
// Chromium on Linux has no 'all', so there is nothing to choose there.
describe('AudioDeviceSection echo cancellation', () => {
  beforeEach(() => {
    echo.mode = 'all';
    echo.set.mockReset();
    echo.os = 'macos';
    echo.electron = true;
  });

  const options = () => screen.getAllByRole('button').filter((b) => b.textContent?.startsWith('settings.echoCancellationMode.'));

  it('offers this app or all sounds on the desktop, below noise suppression', () => {
    const { container } = renderMic();
    expect(screen.getByText('settings.echoCancellation')).toBeInTheDocument();
    expect(options().map((b) => b.textContent)).toEqual(['settings.echoCancellationMode.app', 'settings.echoCancellationMode.all']);
    const labels = [...container.querySelectorAll('.noise-suppression-label')].map((l) => l.textContent);
    expect(labels).toEqual(['settings.noiseSuppression', 'settings.echoCancellation']);
  });

  it('names the browser instead of Sokuji outside the desktop app', () => {
    echo.electron = false;
    echo.os = 'windows';
    renderMic();
    expect(options().map((b) => b.textContent)).toEqual(['settings.echoCancellationMode.browser', 'settings.echoCancellationMode.all']);
  });

  it('is not shown on Linux', () => {
    echo.os = 'linux';
    renderMic();
    expect(screen.queryByText('settings.echoCancellation')).not.toBeInTheDocument();
  });

  it('marks the chosen mode, to the eye and to assistive technology, and stores a new choice', () => {
    echo.mode = 'app';
    renderMic();
    const [app, all] = options();
    expect(app).toHaveClass('active');
    expect(all).not.toHaveClass('active');
    expect(app).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(all);
    expect(echo.set).toHaveBeenCalledWith('all');
  });

  it('tells assistive technology which noise suppression mode is on, as it does for echo cancellation', () => {
    renderMic();
    const pressed = screen.getAllByRole('button', { pressed: true }).map((b) => b.textContent);
    expect(pressed).toEqual(['settings.noiseSuppressionMode.off', 'settings.echoCancellationMode.all']);
  });
});
