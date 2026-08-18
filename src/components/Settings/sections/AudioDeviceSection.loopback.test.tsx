/**
 * Manual selection of an OS loopback-style input ("Stereo Mix", a PulseAudio
 * sink monitor, VoiceMeeter) must warn: such an input re-captures what the
 * machine is playing, which during a session includes Sokuji's own TTS.
 *
 * Unlike Sokuji's own virtual devices the selection is NOT blocked — loopback
 * routing can be a deliberate setup (VoiceMeeter users), so the device is
 * selected and the modal explains the echo risk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioDeviceSection from './AudioDeviceSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

const inputDevices = [
  { deviceId: 'real-1', label: 'Built-in Microphone' },
  { deviceId: 'loop-1', label: 'Stereo Mix (Realtek High Definition Audio)' },
];

const selectInputDevice = vi.fn();

vi.mock('../../../stores/audioStore', () => ({
  useIsMonitorChannelInScope: () => true,
  useNoiseSuppressionMode: () => 'off',
  useSetNoiseSuppressionMode: () => vi.fn(),
  useAudioContext: () => ({
    audioInputDevices: inputDevices,
    audioMonitorDevices: [],
    selectedInputDevice: null,
    selectedMonitorDevice: null,
    isMicMuted: false,
    isMonitorMuted: false,
    isLoading: false,
    selectInputDevice,
    selectMonitorDevice: vi.fn(),
    setMicMuted: vi.fn(),
    setMonitorMuted: vi.fn(),
    refreshDevices: vi.fn(),
  }),
}));

const renderMic = () =>
  render(
    <AudioDeviceSection
      isSessionActive={false}
      showMicrophone={true}
      showSpeaker={false}
    />
  );

beforeEach(() => {
  selectInputDevice.mockClear();
});

describe('AudioDeviceSection loopback input warning', () => {
  it('warns when a loopback-style input is picked, but still selects it', () => {
    renderMic();
    fireEvent.click(screen.getByText('Stereo Mix (Realtek High Definition Audio)'));

    expect(screen.getByText(/re-captures what this computer is playing/i)).toBeInTheDocument();
    expect(selectInputDevice).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'loop-1' })
    );
  });

  it('selects a real microphone without any warning', () => {
    renderMic();
    fireEvent.click(screen.getByText('Built-in Microphone'));

    expect(screen.queryByText(/re-captures what this computer is playing/i)).not.toBeInTheDocument();
    expect(selectInputDevice).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'real-1' })
    );
  });
});
