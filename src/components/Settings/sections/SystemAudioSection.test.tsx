/**
 * Participant audio section, including the per-application source picker
 * (issue #335).
 *
 * Regression guard: the picker was first added to AudioDeviceSection, which the
 * settings views render TWICE (once for the microphone, once for the speaker).
 * Because it sat outside both `showMicrophone`/`showSpeaker` guards it appeared
 * in both instances, giving the user two "Participant audio" sections whose
 * lock state disagreed - each instance receives a different isLocked prop.
 * The picker belongs here, in the one real participant section.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SystemAudioSection from './SystemAudioSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

const env = { electron: true, extension: false };
vi.mock('../../../utils/environment', () => ({
  isElectron: () => env.electron,
  isExtension: () => env.extension,
}));

const store = {
  muted: false,
  sources: [] as Array<{ deviceId: string; label: string }>,
  selected: null as { deviceId: string; label: string } | null,
  select: vi.fn(),
  setMuted: vi.fn(),
  refresh: vi.fn(),
};

vi.mock('../../../stores/audioStore', () => ({
  useIsParticipantMuted: () => store.muted,
  useSetParticipantMuted: () => store.setMuted,
  useParticipantSources: () => store.sources,
  useSelectedParticipantSource: () => store.selected,
  useSelectParticipantSource: () => store.select,
  useRefreshDevices: () => store.refresh,
  useIsAudioLoading: () => false,
}));

vi.mock('../../../stores/settingsStore', () => ({
  useProvider: () => 'openai',
}));

const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
const CHROMIUM = { deviceId: 'app:pid:205', label: 'Chromium' };

beforeEach(() => {
  env.electron = true;
  env.extension = false;
  store.muted = false;
  store.sources = [SYSTEM, CHROMIUM];
  store.selected = SYSTEM;
  store.select.mockReset();
  store.setMuted.mockReset();
  store.refresh.mockReset();
});

const mount = (props: Record<string, unknown> = {}) =>
  render(<SystemAudioSection isSessionActive={false} {...props} />);

describe('SystemAudioSection', () => {
  it('renders exactly one participant section', () => {
    const { container } = mount();
    expect(container.querySelectorAll('#participant-section')).toHaveLength(1);
  });

  it('lists the available participant sources', () => {
    mount();
    expect(screen.getByText('Chromium')).toBeInTheDocument();
    expect(screen.getByText('System Audio (All Applications)')).toBeInTheDocument();
  });

  it('selecting an application calls the store action', () => {
    mount();
    fireEvent.click(screen.getByText('Chromium'));
    expect(store.select).toHaveBeenCalledWith(CHROMIUM);
  });

  it('does not switch source while the session is active', () => {
    mount({ isSessionActive: true });
    fireEvent.click(screen.getByText('Chromium'));
    // Re-linking mid-session would tear down the live capture.
    expect(store.select).not.toHaveBeenCalled();
  });

  it('offers a refresh, since the application list goes stale as apps come and go', () => {
    mount();
    fireEvent.click(screen.getByTitle('audioPanel.refreshDevices'));
    expect(store.refresh).toHaveBeenCalled();
  });

  it('hides the picker when the participant channel is off', () => {
    // Nothing to scope while the channel is muted.
    store.muted = true;
    const { container } = mount();
    expect(container.querySelector('.participant-source-picker')).toBeNull();
  });

  it('hides the picker when only whole-system capture is available', () => {
    // No per-application helper on this platform or OS version.
    store.sources = [SYSTEM];
    const { container } = mount();
    expect(container.querySelector('.participant-source-picker')).toBeNull();
  });

  it('hides the picker in the browser extension', () => {
    // Tab capture is already scoped to one tab; there is nothing to pick.
    env.electron = false;
    env.extension = true;
    const { container } = mount();
    expect(container.querySelector('.participant-source-picker')).toBeNull();
  });
});
