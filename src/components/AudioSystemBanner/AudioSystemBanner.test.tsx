import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioSystemBanner from './AudioSystemBanner';
import useAudioSystemStore from '../../stores/audioSystemStore';

// The suites load no i18next catalog, so t(key) renders the key itself: these
// assertions pin which keys the banner uses, not their English copy.

const unavailable = (reason: string, extra: Record<string, unknown> = {}) =>
  useAudioSystemStore.setState({
    status: 'unavailable',
    platform: reason === 'mac-driver-not-loaded' ? 'darwin' : 'linux',
    reason: reason as never,
    message: null,
    dismissed: false,
    retrying: false,
    repairing: false,
    repairFailed: false,
    ...extra,
  });

describe('AudioSystemBanner', () => {
  beforeEach(() => {
    useAudioSystemStore.setState({ retry: vi.fn(async () => {}), repair: vi.fn(async () => {}) });
  });

  it('offers a repair, not a retry, for a macOS driver that was never loaded', () => {
    unavailable('mac-driver-not-loaded');
    render(<AudioSystemBanner />);
    expect(screen.getByText('audioSystem.macDriverNotLoadedBody')).toBeTruthy();
    expect(screen.queryByText('audioSystem.retry')).toBeNull();
    fireEvent.click(screen.getByText('audioSystem.repair'));
    expect(useAudioSystemStore.getState().repair).toHaveBeenCalledWith('audioSystem.macRepairPrompt');
  });

  it('says so when the repair did not bring the device back', () => {
    unavailable('mac-driver-not-loaded', { repairFailed: true });
    render(<AudioSystemBanner />);
    expect(screen.getByText('audioSystem.macRepairFailedBody')).toBeTruthy();
  });

  it('disables the button while the repair runs', () => {
    unavailable('mac-driver-not-loaded', { repairing: true });
    render(<AudioSystemBanner />);
    expect((screen.getByText('audioSystem.repairing').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the retry for the other reasons', () => {
    unavailable('pulseaudio-unavailable');
    render(<AudioSystemBanner />);
    expect(screen.getByText('audioSystem.unavailableBody')).toBeTruthy();
    fireEvent.click(screen.getByText('audioSystem.retry'));
    expect(useAudioSystemStore.getState().retry).toHaveBeenCalled();
    expect(screen.queryByText('audioSystem.repair')).toBeNull();
  });
});
