import { describe, it, expect, beforeEach } from 'vitest';
import useAudioStore from './audioStore';

describe('audioStore — set-style actions', () => {
  beforeEach(() => {
    useAudioStore.setState({
      isInputDeviceOn: false,
      isSystemAudioCaptureEnabled: false,
    } as any);
  });

  it('setInputDeviceOn(true) sets isInputDeviceOn to true', () => {
    useAudioStore.getState().setInputDeviceOn(true);
    expect(useAudioStore.getState().isInputDeviceOn).toBe(true);
  });

  it('setInputDeviceOn(false) sets isInputDeviceOn to false', () => {
    useAudioStore.setState({ isInputDeviceOn: true } as any);
    useAudioStore.getState().setInputDeviceOn(false);
    expect(useAudioStore.getState().isInputDeviceOn).toBe(false);
  });

  it('setSystemAudioCaptureEnabled(true) sets isSystemAudioCaptureEnabled to true', () => {
    useAudioStore.getState().setSystemAudioCaptureEnabled(true);
    expect(useAudioStore.getState().isSystemAudioCaptureEnabled).toBe(true);
  });

  it('setSystemAudioCaptureEnabled(false) sets isSystemAudioCaptureEnabled to false', () => {
    useAudioStore.setState({ isSystemAudioCaptureEnabled: true } as any);
    useAudioStore.getState().setSystemAudioCaptureEnabled(false);
    expect(useAudioStore.getState().isSystemAudioCaptureEnabled).toBe(false);
  });
});
