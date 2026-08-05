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

  it('selecting an application calls the store action and switches the channel on', () => {
    mount();
    fireEvent.click(screen.getByText('Chromium'));
    expect(store.select).toHaveBeenCalledWith(CHROMIUM);
    // Picking a source is also how the channel is turned back on.
    expect(store.setMuted).toHaveBeenCalledWith(false);
  });

  it('replaces the on/off toggle with the list Off row on Electron', () => {
    const { container } = mount();
    // The list carries its own Off row, so a separate switch is redundant.
    expect(container.querySelector('.toggle-switch-component')).toBeNull();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('turning the channel off goes through the list Off row', () => {
    mount();
    fireEvent.click(screen.getByText('Off'));
    expect(store.setMuted).toHaveBeenCalledWith(true);
  });

  it('keeps the list rendered while the channel is off, so it can be turned back on', () => {
    // Hiding the list when muted would strand the user with no control at all.
    store.muted = true;
    const { container } = mount();
    expect(container.querySelector('.device-list, [role="listbox"]')).not.toBeNull();
    expect(screen.getByText('Chromium')).toBeInTheDocument();
  });

  it('still renders the list when whole-system capture is the only source', () => {
    // Otherwise a machine with no per-app helper would have no on/off control.
    store.sources = [SYSTEM];
    mount();
    expect(screen.getByText('System Audio (All Applications)')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('switches source while the session is active', () => {
    // Live switching is supported - MainPanel rebuilds the capture around the
    // new source - so an active session must not block the picker.
    mount({ isSessionActive: true });
    fireEvent.click(screen.getByText('Chromium'));
    expect(store.select).toHaveBeenCalled();
  });

  it('still blocks selection when the caller locks it by mode scope', () => {
    mount({ isSessionActive: true, isLocked: true });
    fireEvent.click(screen.getByText('Chromium'));
    expect(store.select).not.toHaveBeenCalled();
  });

  it('offers a refresh, since the application list goes stale as apps come and go', () => {
    mount();
    fireEvent.click(screen.getByTitle('audioPanel.refreshDevices'));
    expect(store.refresh).toHaveBeenCalled();
  });

  it('keeps the plain toggle in the browser extension', () => {
    // Tab capture is already scoped to one tab; there is nothing to pick, so
    // the list would have no purpose and the toggle remains the control.
    env.electron = false;
    env.extension = true;
    store.sources = [];
    const { container } = mount();
    expect(screen.queryByText('Chromium')).toBeNull();
    expect(container.querySelector('.toggle-switch-component')).not.toBeNull();
  });
});
