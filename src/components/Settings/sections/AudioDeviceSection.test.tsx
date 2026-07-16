/**
 * Tests for AudioDeviceSection's `lockedReason` — the explanation rendered when
 * a channel section is locked (issue #314).
 *
 * The Speaker section greys out whenever the translation mode isn't 'You'
 * (monitor is mutually exclusive with participant capture, to prevent an echo
 * loop). The lock is intentional; what was missing is any statement of *why*
 * it's locked or *how* to re-enable it — so a user who once switched to
 * 'Others'/'Both' saw a permanently dead control. The reason is also wired to
 * the device list via aria-describedby, so the `aria-disabled` options carry
 * their justification for screen readers rather than just going quiet.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AudioDeviceSection from './AudioDeviceSection';

// Resolve to the inline default when the call site has one, else echo the key —
// these tests assert on `lockedReason`, which is passed in as a plain string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

const devices = [{ deviceId: 'spk-1', label: 'Headphones' }];

vi.mock('../../../stores/audioStore', () => ({
  useIsMonitorChannelInScope: () => false,
  useNoiseSuppressionMode: () => 'off',
  useSetNoiseSuppressionMode: () => vi.fn(),
  useAudioContext: () => ({
    audioInputDevices: [],
    audioMonitorDevices: devices,
    selectedInputDevice: null,
    selectedMonitorDevice: devices[0],
    isMicMuted: false,
    isMonitorMuted: false,
    isLoading: false,
    selectInputDevice: vi.fn(),
    selectMonitorDevice: vi.fn(),
    setMicMuted: vi.fn(),
    setMonitorMuted: vi.fn(),
    refreshDevices: vi.fn(),
  }),
}));

const REASON = 'Speaker monitoring is only available in "You" mode.';

const renderSpeaker = (props: Record<string, unknown> = {}) =>
  render(
    <AudioDeviceSection
      isSessionActive={false}
      showMicrophone={false}
      showSpeaker={true}
      {...props}
    />
  );

describe('AudioDeviceSection lockedReason', () => {
  it('renders the reason when the section is locked', () => {
    renderSpeaker({ isLocked: true, lockedReason: REASON });
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });

  it('omits the reason when the section is unlocked', () => {
    renderSpeaker({ isLocked: false, lockedReason: REASON });
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
  });

  it('renders nothing extra when locked without a reason', () => {
    const { container } = renderSpeaker({ isLocked: true });
    expect(container.querySelector('.section-locked-reason')).toBeNull();
  });

  it('describes the locked device list with the reason', () => {
    renderSpeaker({ isLocked: true, lockedReason: REASON });
    const list = screen.getByRole('listbox');
    const describedBy = list.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(REASON);
  });

  it('leaves an unlocked device list undescribed', () => {
    renderSpeaker({ isLocked: false, lockedReason: REASON });
    expect(screen.getByRole('listbox')).not.toHaveAttribute('aria-describedby');
  });

  // Every option drops to tabIndex -1 while disabled, so unless the listbox
  // itself takes focus there is nothing in the widget to land on — and an
  // aria-describedby that never gets announced is decoration. Keeping a
  // disabled control focusable is what lets a keyboard user discover why it
  // won't respond.
  it('keeps the locked list reachable by keyboard so the reason is announced', () => {
    renderSpeaker({ isLocked: true, lockedReason: REASON });
    const list = screen.getByRole('listbox');
    expect(list).toHaveAttribute('tabindex', '0');
    expect(list).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the unlocked list out of the tab order — its options carry it', () => {
    renderSpeaker({ isLocked: false });
    const list = screen.getByRole('listbox');
    expect(list).not.toHaveAttribute('tabindex');
    expect(list).not.toHaveAttribute('aria-disabled');
  });
});
