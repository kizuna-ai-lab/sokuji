import { describe, it, expect, beforeEach } from 'vitest';
import useAudioStore from './audioStore';
import type { AudioMode } from './audioStore';

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

describe('audioStore — mode + mute flags', () => {
  beforeEach(() => {
    useAudioStore.setState({
      mode: 'speaker' as AudioMode,
      isMicMuted: false,
      isMonitorMuted: true,
      isParticipantMuted: false,
      isInputDeviceOn: true,
      isMonitorDeviceOn: false,
      isSystemAudioCaptureEnabled: false,
      audioInputDevices: [],
      systemAudioSources: [],
      selectedInputDevice: null,
      selectedParticipantSource: null,
    } as any);
  });

  it('defaults: mode=speaker, isMicMuted=false, isMonitorMuted=true, isParticipantMuted=false', () => {
    const s = useAudioStore.getState();
    expect(s.mode).toBe('speaker');
    expect(s.isMicMuted).toBe(false);
    expect(s.isMonitorMuted).toBe(true);
    expect(s.isParticipantMuted).toBe(false);
  });

  it('setMode("participant") updates mode and bridges legacy fields', () => {
    useAudioStore.getState().setMode('participant');
    const s = useAudioStore.getState();
    expect(s.mode).toBe('participant');
    expect(s.isInputDeviceOn).toBe(false);
    expect(s.isSystemAudioCaptureEnabled).toBe(true);
  });

  it('setMode resets newly-in-scope mute flags to false but leaves monitor sticky', () => {
    useAudioStore.setState({
      mode: 'speaker',
      isMicMuted: true,
      isMonitorMuted: true,
      isParticipantMuted: true,
    } as any);
    useAudioStore.getState().setMode('both');
    const s = useAudioStore.getState();
    expect(s.isParticipantMuted).toBe(false); // newly in scope
    expect(s.isMicMuted).toBe(true);          // was already in scope
    expect(s.isMonitorMuted).toBe(true);      // sticky
  });

  it('setMicMuted(true) bridges to isInputDeviceOn=false', () => {
    useAudioStore.getState().setMicMuted(true);
    const s = useAudioStore.getState();
    expect(s.isMicMuted).toBe(true);
    expect(s.isInputDeviceOn).toBe(false);
  });

  it('setInputDeviceOn(false) bridges to isMicMuted=true', () => {
    useAudioStore.getState().setInputDeviceOn(false);
    const s = useAudioStore.getState();
    expect(s.isInputDeviceOn).toBe(false);
    expect(s.isMicMuted).toBe(true);
  });

  it('setParticipantMuted(true) bridges to isSystemAudioCaptureEnabled=false', () => {
    useAudioStore.setState({ isSystemAudioCaptureEnabled: true } as any);
    useAudioStore.getState().setParticipantMuted(true);
    const s = useAudioStore.getState();
    expect(s.isParticipantMuted).toBe(true);
    expect(s.isSystemAudioCaptureEnabled).toBe(false);
  });

  it('setSystemAudioCaptureEnabled(false) bridges to isParticipantMuted=true', () => {
    useAudioStore.setState({ isSystemAudioCaptureEnabled: true } as any);
    useAudioStore.getState().setSystemAudioCaptureEnabled(false);
    const s = useAudioStore.getState();
    expect(s.isSystemAudioCaptureEnabled).toBe(false);
    expect(s.isParticipantMuted).toBe(true);
  });

  it('setMonitorMuted(false) bridges to isMonitorDeviceOn=true', () => {
    useAudioStore.setState({ isMonitorMuted: true, isMonitorDeviceOn: false } as any);
    useAudioStore.getState().setMonitorMuted(false);
    const s = useAudioStore.getState();
    expect(s.isMonitorMuted).toBe(false);
    expect(s.isMonitorDeviceOn).toBe(true);
  });

  it('setMonitorDeviceOn(true) bridges to isMonitorMuted=false', () => {
    useAudioStore.setState({ isMonitorMuted: true, isMonitorDeviceOn: false } as any);
    useAudioStore.getState().setMonitorDeviceOn(true);
    const s = useAudioStore.getState();
    expect(s.isMonitorDeviceOn).toBe(true);
    expect(s.isMonitorMuted).toBe(false);
  });
});
