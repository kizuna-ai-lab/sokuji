import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useMemo } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';
import { IAudioService, AudioOperationResult } from '../services/interfaces/IAudioService';
import { isElectron, isExtension, isLoopbackPlatform } from '../utils/environment';

export type NoiseSuppressionMode = 'off' | 'standard' | 'enhanced';
export type AudioMode = 'speaker' | 'participant' | 'both';

// Storage keys for persisting audio device preferences
const STORAGE_KEYS = {
  SELECTED_INPUT_DEVICE_ID: 'audio.selectedInputDeviceId',
  SELECTED_MONITOR_DEVICE_ID: 'audio.selectedMonitorDeviceId',
  IS_INPUT_DEVICE_ON: 'audio.isInputDeviceOn',
  IS_MONITOR_DEVICE_ON: 'audio.isMonitorDeviceOn',
  IS_NOISE_SUPPRESS_ENABLED: 'audio.isNoiseSuppressEnabled',
  NOISE_SUPPRESSION_MODE: 'audio.noiseSuppressionMode',
  IS_REAL_VOICE_PASSTHROUGH_ENABLED: 'audio.isRealVoicePassthroughEnabled',
  REAL_VOICE_PASSTHROUGH_VOLUME: 'audio.realVoicePassthroughVolume',
  IS_SYSTEM_AUDIO_CAPTURE_ENABLED: 'audio.isSystemAudioCaptureEnabled',
  SELECTED_SYSTEM_AUDIO_SOURCE_ID: 'audio.selectedSystemAudioSourceId',
  SELECTED_PARTICIPANT_AUDIO_OUTPUT_DEVICE_ID: 'audio.selectedParticipantAudioOutputDeviceId',
  // New fields (Phase 2 additions)
  MODE: 'audio.mode',
  IS_MIC_MUTED: 'audio.isMicMuted',
  IS_MONITOR_MUTED: 'audio.isMonitorMuted',
  IS_PARTICIPANT_MUTED: 'audio.isParticipantMuted',
};

export interface AudioDevice {
  deviceId: string;
  label: string;
  isVirtual?: boolean;
}

interface AudioStore {
  // State
  audioInputDevices: AudioDevice[];
  audioMonitorDevices: AudioDevice[];
  selectedInputDevice: AudioDevice | null;
  selectedMonitorDevice: AudioDevice | null;
  isInputDeviceOn: boolean;
  isMonitorDeviceOn: boolean;
  isLoading: boolean;
  isRealVoicePassthroughEnabled: boolean;
  realVoicePassthroughVolume: number;
  noiseSuppressionMode: NoiseSuppressionMode;

  // System audio capture state (for translating other participants)
  systemAudioSources: AudioDevice[];
  selectedParticipantSource: AudioDevice | null;
  isSystemAudioCaptureEnabled: boolean;
  isSystemAudioCaptureActive: boolean;
  isSystemAudioSourceReady: boolean;
  selectedParticipantOutput: AudioDevice | null; // Output device for participant audio (Extension only)

  // New fields (Phase 2): symmetric mode + per-channel mute flags
  // Bridge invariants (maintained by all setters):
  //   isMicMuted       === !isInputDeviceOn
  //   isMonitorMuted   === !isMonitorDeviceOn
  //   isParticipantMuted === !isSystemAudioCaptureEnabled
  mode: AudioMode;
  isMicMuted: boolean;
  isMonitorMuted: boolean;
  isParticipantMuted: boolean;

  // Audio service reference
  audioService: IAudioService | null;

  // Actions
  setAudioService: (service: IAudioService) => void;
  setInputDevices: (devices: AudioDevice[]) => void;
  setMonitorDevices: (devices: AudioDevice[]) => void;
  selectInputDevice: (device: AudioDevice) => void;
  selectMonitorDevice: (device: AudioDevice) => void;
  toggleInputDeviceState: () => void;
  setInputDeviceOn: (on: boolean) => void;
  toggleMonitorDeviceState: () => void;
  setMonitorDeviceOn: (on: boolean) => void;
  toggleRealVoicePassthrough: () => void;
  setRealVoicePassthroughVolume: (volume: number) => void;
  setNoiseSuppressionMode: (mode: NoiseSuppressionMode) => void;
  setIsLoading: (loading: boolean) => void;

  // System audio capture actions
  setSystemAudioSources: (sources: AudioDevice[]) => void;
  selectSystemAudioSource: (source: AudioDevice | null) => void;
  toggleSystemAudioCapture: () => void;
  setSystemAudioCaptureEnabled: (enabled: boolean) => void;
  setSystemAudioCaptureActive: (active: boolean) => void;
  setSystemAudioSourceReady: (ready: boolean) => void;
  refreshSystemAudioSources: () => Promise<void>;
  selectParticipantOutput: (device: AudioDevice | null) => void;

  // New actions (Phase 2): mode + mute setters
  setMode: (mode: AudioMode) => void;
  setMicMuted: (muted: boolean) => void;
  setMonitorMuted: (muted: boolean) => void;
  setParticipantMuted: (muted: boolean) => void;

  // Complex actions
  refreshDevices: () => Promise<{ defaultInputDevice: AudioDevice | null; defaultMonitorDevice: AudioDevice | null }>;
  connectMonitorDevice: (deviceId: string, label: string) => Promise<AudioOperationResult>;
  initializeAudioService: () => Promise<void>;
}

const useAudioStore = create<AudioStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    audioInputDevices: [],
    audioMonitorDevices: [],
    selectedInputDevice: null,
    selectedMonitorDevice: null,
    isInputDeviceOn: true,
    isMonitorDeviceOn: false,
    isLoading: true,
    isRealVoicePassthroughEnabled: false,
    realVoicePassthroughVolume: 0.2,
    noiseSuppressionMode: 'enhanced' as NoiseSuppressionMode,

    // System audio capture state
    systemAudioSources: [],
    selectedParticipantSource: null,
    isSystemAudioCaptureEnabled: false,
    isSystemAudioCaptureActive: false,
    isSystemAudioSourceReady: false,
    selectedParticipantOutput: null,

    // New state (Phase 2): mode + per-channel mute flags
    mode: 'speaker' as AudioMode,
    isMicMuted: false,      // bridges with isInputDeviceOn (isMicMuted === !isInputDeviceOn)
    isMonitorMuted: true,   // bridges with isMonitorDeviceOn; default true = monitor off by default
    isParticipantMuted: false, // bridges with isSystemAudioCaptureEnabled

    audioService: null,
    
    // Basic setters
    setAudioService: (service) => set({ audioService: service }),
    setInputDevices: (devices) => set({ audioInputDevices: devices }),
    setMonitorDevices: (devices) => set({ audioMonitorDevices: devices }),
    selectInputDevice: (device) => {
      console.info(`[Sokuji] [AudioStore] Selected input device: ${device.label} (${device.deviceId})`);
      set({ selectedInputDevice: device });

      // Persist the selected device ID
      const service = ServiceFactory.getSettingsService();
      service.setSetting(STORAGE_KEYS.SELECTED_INPUT_DEVICE_ID, device.deviceId)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save input device preference:', error));
    },
    selectMonitorDevice: (device) => {
      console.info(`[Sokuji] [AudioStore] Selected monitor device: ${device.label} (${device.deviceId})`);
      set({ selectedMonitorDevice: device });

      // Persist the selected device ID
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.SELECTED_MONITOR_DEVICE_ID, device.deviceId)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save monitor device preference:', error));

      // Connect to the selected monitor device
      const { audioService } = get();
      if (audioService) {
        audioService.connectMonitoringDevice(device.deviceId, device.label)
          .then((result: AudioOperationResult) => {
            if (result.success) {
              console.info('[Sokuji] [AudioStore] Connected to monitor device:', device.label);
            } else {
              console.error('[Sokuji] [AudioStore] Failed to connect to monitor device:', result.error);
            }
          })
          .catch(error => {
            console.error('[Sokuji] [AudioStore] Error connecting to monitor device:', error);
          });
      }
    },
    setIsLoading: (loading) => set({ isLoading: loading }),
    
    // Toggle functions with callbacks
    toggleInputDeviceState: () => {
      // Delegate to setInputDeviceOn so bridge logic lives in one place.
      get().setInputDeviceOn(!get().isInputDeviceOn);
    },

    setInputDeviceOn: (on) => {
      // Persist the state (mirrors toggleInputDeviceState so callers can use
      // either action interchangeably without losing persistence).
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.IS_INPUT_DEVICE_ON, on)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save input device on state:', error));
      // Bridge: keep isMicMuted in sync.
      settingsService.setSetting(STORAGE_KEYS.IS_MIC_MUTED, !on)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMicMuted:', error));
      set({ isInputDeviceOn: on, isMicMuted: !on });
    },

    toggleMonitorDeviceState: () => {
      const next = !get().isMonitorDeviceOn;
      console.info('[Sokuji] [AudioStore] Toggling monitor device state to', next);
      get().setMonitorDeviceOn(next);
    },

    setMonitorDeviceOn: (on) => {
      // Persist + audio service side effect + auto-mutex with participant
      // (feedback risk). All call paths funnel through here so the toggle
      // wrapper is just a thin convenience.
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_DEVICE_ON, on)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save monitor device on state:', error));
      // Bridge: keep isMonitorMuted in sync.
      settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_MUTED, !on)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMonitorMuted:', error));
      set((state) => {
        const { audioService } = get();
        if (audioService) {
          audioService.setMonitorVolume(on);
          console.info(`[Sokuji] [AudioStore] Monitor state changed to: ${on ? 'ON' : 'OFF'}`);
        }
        const patch: Partial<AudioStore> = { isMonitorDeviceOn: on, isMonitorMuted: !on };
        if (on && state.isSystemAudioCaptureEnabled) {
          console.info('[Sokuji] [AudioStore] Mutex: auto-disabling participant capture');
          settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, false)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to save system audio capture state:', error));
          settingsService.setSetting(STORAGE_KEYS.IS_PARTICIPANT_MUTED, true)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isParticipantMuted:', error));
          patch.isSystemAudioCaptureEnabled = false;
          patch.isParticipantMuted = true;
        }
        return patch;
      });
    },
    
    toggleRealVoicePassthrough: () => {
      set((state) => {
        const newState = !state.isRealVoicePassthroughEnabled;
        console.info('[Sokuji] [AudioStore] Toggling real voice passthrough:', newState);
        const settingsService = ServiceFactory.getSettingsService();
        settingsService.setSetting(STORAGE_KEYS.IS_REAL_VOICE_PASSTHROUGH_ENABLED, newState)
          .catch(error => console.error('[Sokuji] [AudioStore] Failed to save real voice passthrough state:', error));
        return { isRealVoicePassthroughEnabled: newState };
      });
    },

    setRealVoicePassthroughVolume: (volume) => {
      // Clamp volume between 0 and 0.6 (60%)
      const clampedVolume = Math.max(0, Math.min(0.6, volume));
      console.info('[Sokuji] [AudioStore] Setting real voice passthrough volume:', clampedVolume);
      set({ realVoicePassthroughVolume: clampedVolume });
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.REAL_VOICE_PASSTHROUGH_VOLUME, clampedVolume)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save real voice passthrough volume:', error));
    },

    setNoiseSuppressionMode: (mode) => {
      console.info('[Sokuji] [AudioStore] Setting noise suppression mode:', mode);
      set({ noiseSuppressionMode: mode });
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.NOISE_SUPPRESSION_MODE, mode)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save noise suppression mode:', error));
    },

    // System audio capture actions
    setSystemAudioSources: (sources) => set({ systemAudioSources: sources }),

    selectSystemAudioSource: (source) => {
      console.info('[Sokuji] [AudioStore] Selected system audio source:', source?.label || 'None');
      set({ selectedParticipantSource: source });
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.SELECTED_SYSTEM_AUDIO_SOURCE_ID, source?.deviceId || '')
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save system audio source preference:', error));
    },

    toggleSystemAudioCapture: () => {
      // Delegate to setSystemAudioCaptureEnabled so bridge logic lives in one place.
      get().setSystemAudioCaptureEnabled(!get().isSystemAudioCaptureEnabled);
    },

    setSystemAudioCaptureEnabled: (enabled) => {
      // Persist the state (mirrors toggleSystemAudioCapture so callers can use
      // either action interchangeably without losing persistence).
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, enabled)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save system audio capture state:', error));
      // Bridge: keep isParticipantMuted in sync.
      settingsService.setSetting(STORAGE_KEYS.IS_PARTICIPANT_MUTED, !enabled)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isParticipantMuted:', error));
      // Mutex: auto-disable monitor if enabling participant capture.
      set((state) => {
        const patch: Partial<AudioStore> = { isSystemAudioCaptureEnabled: enabled, isParticipantMuted: !enabled };
        if (enabled && state.isMonitorDeviceOn) {
          console.info('[Sokuji] [AudioStore] Mutex: auto-disabling monitor (setSystemAudioCaptureEnabled)');
          settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_DEVICE_ON, false)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to save monitor device on state:', error));
          settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_MUTED, true)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMonitorMuted:', error));
          const { audioService } = get();
          if (audioService) audioService.setMonitorVolume(false);
          patch.isMonitorDeviceOn = false;
          patch.isMonitorMuted = true;
        }
        return patch;
      });
    },

    setSystemAudioCaptureActive: (active) => {
      console.info('[Sokuji] [AudioStore] Setting system audio capture active:', active);
      set({ isSystemAudioCaptureActive: active });
    },

    setSystemAudioSourceReady: (ready) => {
      console.info('[Sokuji] [AudioStore] Setting system audio source ready:', ready);
      set({ isSystemAudioSourceReady: ready });
    },

    refreshSystemAudioSources: async () => {
      try {
        const { audioService } = get();
        if (!audioService) return;

        // Get system audio sources from the audio service
        const sources = await audioService.getSystemAudioSources?.();
        if (sources) {
          set({ systemAudioSources: sources });
          console.info('[Sokuji] [AudioStore] Refreshed system audio sources:', sources.length);

          // Select saved or first source if none selected
          const currentSource = get().selectedParticipantSource;
          let restoredSource: AudioDevice | null = null;
          if (!currentSource && sources.length > 0) {
            const settingsService = ServiceFactory.getSettingsService();
            const savedSourceId = await settingsService.getSetting<string>(STORAGE_KEYS.SELECTED_SYSTEM_AUDIO_SOURCE_ID, '');
            if (savedSourceId) {
              const savedSource = sources.find(s => s.deviceId === savedSourceId);
              if (savedSource) {
                console.info('[Sokuji] [AudioStore] Restored saved system audio source:', savedSource.label);
                set({ selectedParticipantSource: savedSource });
                restoredSource = savedSource;
              } else {
                set({ selectedParticipantSource: sources[0] });
              }
            } else {
              set({ selectedParticipantSource: sources[0] });
            }
          }

          // Re-establish system audio connection if capture was enabled and a source is available
          const selectedSource = restoredSource || get().selectedParticipantSource;
          if (get().isSystemAudioCaptureEnabled && selectedSource) {
            try {
              if (isElectron() && !isExtension() && isLoopbackPlatform()) {
                const permissionGranted = await audioService.requestLoopbackAudioStream();
                if (!permissionGranted) {
                  console.warn('[Sokuji] [AudioStore] Loopback permission lost, disabling system audio capture');
                  set({ isSystemAudioCaptureEnabled: false });
                  const settingsService = ServiceFactory.getSettingsService();
                  settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, false).catch(() => {});
                  return;
                }
              }
              await audioService.connectSystemAudioSource(selectedSource.deviceId);
              set({ isSystemAudioSourceReady: true });
              console.info('[Sokuji] [AudioStore] Re-established system audio connection for:', selectedSource.label);
            } catch (error) {
              console.error('[Sokuji] [AudioStore] Failed to re-establish system audio connection:', error);
              set({ isSystemAudioCaptureEnabled: false });
              const settingsService = ServiceFactory.getSettingsService();
              settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, false).catch(() => {});
            }
          }
        }
      } catch (error) {
        console.error('[Sokuji] [AudioStore] Error refreshing system audio sources:', error);
      }
    },

    selectParticipantOutput: (device) => {
      console.info('[Sokuji] [AudioStore] Selected participant audio output device:', device?.label || 'None');
      set({ selectedParticipantOutput: device });
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.SELECTED_PARTICIPANT_AUDIO_OUTPUT_DEVICE_ID, device?.deviceId || '')
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save participant audio output device:', error));
    },

    // New actions (Phase 2): mode + per-channel mute setters

    setMode: (target) => {
      const settingsService = ServiceFactory.getSettingsService();
      set((state) => {
        const prev = state.mode;
        const prevSpeakerInScope = prev === 'speaker' || prev === 'both';
        const prevParticipantInScope = prev === 'participant' || prev === 'both';
        const nextSpeakerInScope = target === 'speaker' || target === 'both';
        const nextParticipantInScope = target === 'participant' || target === 'both';

        const patch: Partial<AudioStore> = { mode: target };

        // Bridge to legacy fields.
        patch.isInputDeviceOn = nextSpeakerInScope;
        patch.isSystemAudioCaptureEnabled = nextParticipantInScope;
        // isMonitorDeviceOn unchanged — monitor is a sub-preference of speaker.

        // Reset mute flags for newly-in-scope channels (monitor is sticky).
        // The plan's "Mode-Switch Behavior" section narrows the spec's
        // "reset all three" rule: only channels newly coming into scope
        // reset their mute flag. Monitor stays sticky because its default
        // is muted and historical behavior is opt-in audio — auto-unmuting
        // it on every mode change would blast users.
        if (nextSpeakerInScope && !prevSpeakerInScope) {
          patch.isMicMuted = false;
        }
        if (nextParticipantInScope && !prevParticipantInScope) {
          patch.isParticipantMuted = false;
        }

        // Auto-pick first device for channels newly in scope without a selection.
        if (nextSpeakerInScope && !state.selectedInputDevice && state.audioInputDevices.length > 0) {
          patch.selectedInputDevice = state.audioInputDevices[0];
        }
        if (nextParticipantInScope && !isExtension()
            && !state.selectedParticipantSource && state.systemAudioSources.length > 0) {
          patch.selectedParticipantSource = state.systemAudioSources[0];
        }

        settingsService.setSetting(STORAGE_KEYS.MODE, target)
          .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist mode:', error));
        settingsService.setSetting(STORAGE_KEYS.IS_INPUT_DEVICE_ON, nextSpeakerInScope)
          .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isInputDeviceOn:', error));
        settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, nextParticipantInScope)
          .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isSystemAudioCaptureEnabled:', error));
        if ('isMicMuted' in patch) {
          settingsService.setSetting(STORAGE_KEYS.IS_MIC_MUTED, patch.isMicMuted)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMicMuted:', error));
        }
        if ('isParticipantMuted' in patch) {
          settingsService.setSetting(STORAGE_KEYS.IS_PARTICIPANT_MUTED, patch.isParticipantMuted)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isParticipantMuted:', error));
        }

        return patch;
      });
    },

    setMicMuted: (muted) => {
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.IS_MIC_MUTED, muted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMicMuted:', error));
      settingsService.setSetting(STORAGE_KEYS.IS_INPUT_DEVICE_ON, !muted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isInputDeviceOn:', error));
      set({ isMicMuted: muted, isInputDeviceOn: !muted });
    },

    setMonitorMuted: (muted) => {
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_MUTED, muted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMonitorMuted:', error));
      settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_DEVICE_ON, !muted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMonitorDeviceOn:', error));
      set((state) => {
        const { audioService } = state;
        if (audioService) audioService.setMonitorVolume(!muted);
        return { isMonitorMuted: muted, isMonitorDeviceOn: !muted };
      });
    },

    setParticipantMuted: (muted) => {
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.IS_PARTICIPANT_MUTED, muted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isParticipantMuted:', error));
      settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, !muted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isSystemAudioCaptureEnabled:', error));
      set({ isParticipantMuted: muted, isSystemAudioCaptureEnabled: !muted });
    },

    // Complex actions
    refreshDevices: async () => {
      set({ isLoading: true });

      try {
        const { audioService } = get();
        if (!audioService) {
          const service = ServiceFactory.getAudioService();
          set({ audioService: service });
        }

        const service = get().audioService;
        if (!service) {
          throw new Error('Audio service not initialized');
        }

        const devices = await service.getDevices();

        set({
          audioInputDevices: devices.inputs,
          audioMonitorDevices: devices.outputs
        });

        // Load saved device preferences and on/off states
        const settingsService = ServiceFactory.getSettingsService();
        const savedInputDeviceId = await settingsService.getSetting<string>(STORAGE_KEYS.SELECTED_INPUT_DEVICE_ID, '');
        const savedMonitorDeviceId = await settingsService.getSetting<string>(STORAGE_KEYS.SELECTED_MONITOR_DEVICE_ID, '');
        const savedInputDeviceOn = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_INPUT_DEVICE_ON, null);
        const savedMonitorDeviceOn = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_MONITOR_DEVICE_ON, null);
        const savedPassthroughEnabled = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_REAL_VOICE_PASSTHROUGH_ENABLED, null);
        const savedPassthroughVolume = await settingsService.getSetting<number | null>(STORAGE_KEYS.REAL_VOICE_PASSTHROUGH_VOLUME, null);
        const savedSystemAudioCaptureEnabled = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, null);

        // Restore noise suppression mode (with migration from old boolean)
        const savedMode = await settingsService.getSetting<string | null>(STORAGE_KEYS.NOISE_SUPPRESSION_MODE, null);
        if (savedMode !== null && (savedMode === 'off' || savedMode === 'standard' || savedMode === 'enhanced')) {
          console.info('[Sokuji] [AudioStore] Restored noise suppression mode:', savedMode);
          set({ noiseSuppressionMode: savedMode as NoiseSuppressionMode });
        } else {
          // Migrate from old boolean setting
          const oldEnabled = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_NOISE_SUPPRESS_ENABLED, null);
          if (oldEnabled !== null) {
            const migratedMode: NoiseSuppressionMode = oldEnabled ? 'standard' : 'off';
            console.info('[Sokuji] [AudioStore] Migrated noise suppression:', oldEnabled, '→', migratedMode);
            set({ noiseSuppressionMode: migratedMode });
            settingsService.setSetting(STORAGE_KEYS.NOISE_SUPPRESSION_MODE, migratedMode).catch(() => {});
          }
        }

        // Restore real voice passthrough state if saved
        if (savedPassthroughEnabled !== null) {
          console.info('[Sokuji] [AudioStore] Restored real voice passthrough state:', savedPassthroughEnabled);
          set({ isRealVoicePassthroughEnabled: savedPassthroughEnabled });
        }

        // Restore real voice passthrough volume if saved
        if (savedPassthroughVolume !== null) {
          console.info('[Sokuji] [AudioStore] Restored real voice passthrough volume:', savedPassthroughVolume);
          set({ realVoicePassthroughVolume: savedPassthroughVolume });
        }

        // Restore system audio capture state if saved
        if (savedSystemAudioCaptureEnabled !== null) {
          console.info('[Sokuji] [AudioStore] Restored system audio capture state:', savedSystemAudioCaptureEnabled);
          set({ isSystemAudioCaptureEnabled: savedSystemAudioCaptureEnabled });
        }

        // Restore participant audio output device if saved
        const savedParticipantOutputId = await settingsService.getSetting<string>(STORAGE_KEYS.SELECTED_PARTICIPANT_AUDIO_OUTPUT_DEVICE_ID, '');
        if (savedParticipantOutputId) {
          const savedDevice = devices.outputs.find(d => d.deviceId === savedParticipantOutputId);
          if (savedDevice) {
            console.info('[Sokuji] [AudioStore] Restored participant audio output device:', savedDevice.label);
            set({ selectedParticipantOutput: savedDevice });
          }
        }

        // Restore input device on/off state if saved
        if (savedInputDeviceOn !== null) {
          console.info('[Sokuji] [AudioStore] Restored input device on state:', savedInputDeviceOn);
          set({ isInputDeviceOn: savedInputDeviceOn });
        }

        // Restore monitor device on/off state if saved
        if (savedMonitorDeviceOn !== null) {
          console.info('[Sokuji] [AudioStore] Restored monitor device on state:', savedMonitorDeviceOn);
          set({ isMonitorDeviceOn: savedMonitorDeviceOn });

          // Sync audioService volume to match restored state
          const { audioService } = get();
          if (audioService) {
            audioService.setMonitorVolume(savedMonitorDeviceOn);
          }
        }

        // Migration: derive new mode + mute fields from legacy flags (Phase 2).
        // If the new keys were already persisted, use them directly; otherwise
        // derive them from the legacy flags so upgrades are seamless.
        const savedAudioMode = await settingsService.getSetting<AudioMode | null>(STORAGE_KEYS.MODE, null);
        if (savedAudioMode === 'speaker' || savedAudioMode === 'participant' || savedAudioMode === 'both') {
          set({ mode: savedAudioMode });
        } else {
          const micOn = savedInputDeviceOn === true;
          const partOn = savedSystemAudioCaptureEnabled === true;
          const derived: AudioMode =
            micOn && partOn ? 'both' :
            partOn ? 'participant' :
            'speaker'; // includes "all off" — default to speaker per spec
          set({ mode: derived });
          settingsService.setSetting(STORAGE_KEYS.MODE, derived)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist initial mode:', error));

          // Once new keys are written, set the legacy on-disk keys to null
          // so a future cleanup pass can grep for residue. We don't delete
          // them now because (a) ISettingsService has no removeSetting method,
          // and (b) leaving them as null preserves rollback recoverability
          // if the new model is ever reverted. Final deletion happens in
          // Task 10 of the uniform-mute-semantics plan.
          settingsService.setSetting(STORAGE_KEYS.IS_INPUT_DEVICE_ON, null)
            .catch(error => console.warn('[Sokuji] [AudioStore] Failed to null legacy isInputDeviceOn key:', error));
          settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_DEVICE_ON, null)
            .catch(error => console.warn('[Sokuji] [AudioStore] Failed to null legacy isMonitorDeviceOn key:', error));
          settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, null)
            .catch(error => console.warn('[Sokuji] [AudioStore] Failed to null legacy isSystemAudioCaptureEnabled key:', error));
        }

        const savedIsMicMuted = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_MIC_MUTED, null);
        if (typeof savedIsMicMuted === 'boolean') {
          set({ isMicMuted: savedIsMicMuted });
        } else {
          set({ isMicMuted: savedInputDeviceOn === false });
        }

        const savedIsMonitorMuted = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_MONITOR_MUTED, null);
        if (typeof savedIsMonitorMuted === 'boolean') {
          set({ isMonitorMuted: savedIsMonitorMuted });
        } else {
          set({ isMonitorMuted: savedMonitorDeviceOn !== true });
        }

        const savedIsParticipantMuted = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_PARTICIPANT_MUTED, null);
        if (typeof savedIsParticipantMuted === 'boolean') {
          set({ isParticipantMuted: savedIsParticipantMuted });
        } else {
          set({ isParticipantMuted: savedSystemAudioCaptureEnabled === false });
        }

        // Try to restore saved input device, or select default
        const currentInputDevice = get().selectedInputDevice;
        if (!currentInputDevice || !devices.inputs.some(d => d.deviceId === currentInputDevice?.deviceId)) {
          if (savedInputDeviceId) {
            // Try to restore saved input device
            const savedInputDevice = devices.inputs.find(d => d.deviceId === savedInputDeviceId);
            if (savedInputDevice) {
              console.info('[Sokuji] [AudioStore] Restored saved input device:', savedInputDevice.label);
              set({ selectedInputDevice: savedInputDevice });
            } else if (devices.inputs.length > 0) {
              // Saved device not found, fall back to first non-virtual input device
              const nonVirtualInputs = devices.inputs.filter(device => !device.isVirtual);
              if (nonVirtualInputs.length > 0) {
                set({ selectedInputDevice: nonVirtualInputs[0] });
              } else {
                set({ selectedInputDevice: devices.inputs[0] });
              }
            }
          } else if (devices.inputs.length > 0) {
            // No saved preference, select first non-virtual input device
            const nonVirtualInputs = devices.inputs.filter(device => !device.isVirtual);
            if (nonVirtualInputs.length > 0) {
              set({ selectedInputDevice: nonVirtualInputs[0] });
            } else {
              set({ selectedInputDevice: devices.inputs[0] });
            }
          }
        }

        // Try to restore saved monitor device, or select default
        let defaultMonitorDevice = null;
        const currentMonitorDevice = get().selectedMonitorDevice;
        if (!currentMonitorDevice || !devices.outputs.some(d => d.deviceId === currentMonitorDevice?.deviceId)) {
          if (savedMonitorDeviceId) {
            // Try to restore saved monitor device
            const savedMonitorDevice = devices.outputs.find(d => d.deviceId === savedMonitorDeviceId);
            if (savedMonitorDevice) {
              console.info('[Sokuji] [AudioStore] Restored saved monitor device:', savedMonitorDevice.label);
              defaultMonitorDevice = savedMonitorDevice;
              set({ selectedMonitorDevice: defaultMonitorDevice });
            } else if (devices.outputs.length > 0) {
              // Saved device not found, fall back to first non-virtual output device
              const nonVirtualOutputs = devices.outputs.filter(device => !device.isVirtual);
              if (nonVirtualOutputs.length > 0) {
                defaultMonitorDevice = nonVirtualOutputs[0];
                set({ selectedMonitorDevice: defaultMonitorDevice });
              } else {
                defaultMonitorDevice = devices.outputs[0];
                set({ selectedMonitorDevice: defaultMonitorDevice });
              }
            }
          } else if (devices.outputs.length > 0) {
            // No saved preference, select first non-virtual output device
            const nonVirtualOutputs = devices.outputs.filter(device => !device.isVirtual);
            if (nonVirtualOutputs.length > 0) {
              defaultMonitorDevice = nonVirtualOutputs[0];
              set({ selectedMonitorDevice: defaultMonitorDevice });
            } else {
              defaultMonitorDevice = devices.outputs[0];
              set({ selectedMonitorDevice: defaultMonitorDevice });
            }
          }
        }
        
        // Check if virtual audio device support
        if (devices.outputs.some(device => device.isVirtual)) {
          console.info('[Sokuji] [AudioStore] Virtual audio device detected');
        } else if (service.supportsVirtualDevices()) {
          console.info('[Sokuji] [AudioStore] Creating virtual audio devices...');
          const result = await service.createVirtualDevices?.();
          if (result && result.success) {
            console.info('[Sokuji] [AudioStore] Successfully created virtual audio devices:', result.message);
            
            // Get updated device list
            const updatedDevices = await service.getDevices();
            set({ 
              audioInputDevices: updatedDevices.inputs,
              audioMonitorDevices: updatedDevices.outputs 
            });
            
            // Update selected devices if needed
            if (updatedDevices.outputs.length > 0 && !get().selectedMonitorDevice) {
              const nonVirtualOutputs = updatedDevices.outputs.filter(device => !device.isVirtual);
              if (nonVirtualOutputs.length > 0) {
                defaultMonitorDevice = nonVirtualOutputs[0];
                set({ selectedMonitorDevice: defaultMonitorDevice });
              }
            }
          } else {
            console.error('[Sokuji] [AudioStore] Failed to create virtual audio devices:', result?.error);
          }
        }
        
        return { defaultInputDevice: null, defaultMonitorDevice };
      } catch (error) {
        console.error('[Sokuji] [AudioStore] Error refreshing audio devices:', error);
        return { defaultInputDevice: null, defaultMonitorDevice: null };
      } finally {
        set({ isLoading: false });
      }
    },
    
    connectMonitorDevice: async (deviceId: string, label: string) => {
      const { audioService } = get();
      if (!audioService) {
        return { success: false, error: 'Audio service not initialized' };
      }
      
      return audioService.connectMonitoringDevice(deviceId, label);
    },
    
    initializeAudioService: async () => {
      try {
        let { audioService } = get();
        if (!audioService) {
          audioService = ServiceFactory.getAudioService();
          set({ audioService });
        }
        
        await audioService.initialize();
        
        // Set initial monitor volume based on current state
        const { isMonitorDeviceOn } = get();
        audioService.setMonitorVolume(isMonitorDeviceOn);
        console.info(`[Sokuji] [AudioStore] Set initial monitor volume: ${isMonitorDeviceOn ? '1.0' : '0.0'}`);
        
        // Refresh devices after initialization
        const devices = await get().refreshDevices();
        
        // Connect monitor device if available
        const deviceToConnect = get().selectedMonitorDevice || devices?.defaultMonitorDevice;
        if (deviceToConnect) {
          console.info('[Sokuji] [AudioStore] Initialization complete, connecting monitor device:', deviceToConnect.deviceId);
          await get().connectMonitorDevice(deviceToConnect.deviceId, deviceToConnect.label);
        }

        // Load system audio sources and re-establish connection if previously enabled
        // This must run during initialization (not just when UI mounts) so participant
        // audio works even if the user starts a session without opening Settings first
        await get().refreshSystemAudioSources();
      } catch (error) {
        console.error('[Sokuji] [AudioStore] Error initializing audio service:', error);
      }
    },
  }))
);

// Export individual selectors for optimized subscriptions
export const useAudioInputDevices = () => useAudioStore((state) => state.audioInputDevices);
export const useAudioMonitorDevices = () => useAudioStore((state) => state.audioMonitorDevices);
export const useSelectedInputDevice = () => useAudioStore((state) => state.selectedInputDevice);
export const useSelectedMonitorDevice = () => useAudioStore((state) => state.selectedMonitorDevice);
export const useIsInputDeviceOn = () => useAudioStore((state) => state.isInputDeviceOn);
export const useIsMonitorDeviceOn = () => useAudioStore((state) => state.isMonitorDeviceOn);
export const useIsAudioLoading = () => useAudioStore((state) => state.isLoading);
export const useIsRealVoicePassthroughEnabled = () => useAudioStore((state) => state.isRealVoicePassthroughEnabled);
export const useRealVoicePassthroughVolume = () => useAudioStore((state) => state.realVoicePassthroughVolume);
export const useNoiseSuppressionMode = () => useAudioStore((state) => state.noiseSuppressionMode);
export const useSetNoiseSuppressionMode = () => useAudioStore((state) => state.setNoiseSuppressionMode);

// Backward-compatible wrappers
export const useIsNoiseSuppressEnabled = () => useAudioStore((state) => state.noiseSuppressionMode !== 'off');
export const useToggleNoiseSuppression = () => {
  const mode = useAudioStore((state) => state.noiseSuppressionMode);
  const setMode = useAudioStore((state) => state.setNoiseSuppressionMode);
  return () => setMode(mode === 'off' ? 'standard' : 'off');
};

// System audio capture selectors
export const useSystemAudioSources = () => useAudioStore((state) => state.systemAudioSources);
export const useSelectedParticipantSource = () => useAudioStore((state) => state.selectedParticipantSource);
export const useIsSystemAudioCaptureEnabled = () => useAudioStore((state) => state.isSystemAudioCaptureEnabled);
export const useIsSystemAudioCaptureActive = () => useAudioStore((state) => state.isSystemAudioCaptureActive);
export const useIsSystemAudioSourceReady = () => useAudioStore((state) => state.isSystemAudioSourceReady);
export const useSelectedParticipantOutput = () => useAudioStore((state) => state.selectedParticipantOutput);

// Export individual action selectors to avoid recreating objects
export const useSelectInputDevice = () => useAudioStore((state) => state.selectInputDevice);
export const useSelectMonitorDevice = () => useAudioStore((state) => state.selectMonitorDevice);
export const useToggleInputDeviceState = () => useAudioStore((state) => state.toggleInputDeviceState);
export const useSetInputDeviceOn = () => useAudioStore((state) => state.setInputDeviceOn);
export const useToggleMonitorDeviceState = () => useAudioStore((state) => state.toggleMonitorDeviceState);
export const useSetMonitorDeviceOn = () => useAudioStore((state) => state.setMonitorDeviceOn);
export const useToggleRealVoicePassthrough = () => useAudioStore((state) => state.toggleRealVoicePassthrough);
export const useSetRealVoicePassthroughVolume = () => useAudioStore((state) => state.setRealVoicePassthroughVolume);
export const useRefreshDevices = () => useAudioStore((state) => state.refreshDevices);
export const useInitializeAudioService = () => useAudioStore((state) => state.initializeAudioService);

// System audio capture action selectors
export const useSelectSystemAudioSource = () => useAudioStore((state) => state.selectSystemAudioSource);
export const useToggleSystemAudioCapture = () => useAudioStore((state) => state.toggleSystemAudioCapture);
export const useSetSystemAudioCaptureEnabled = () => useAudioStore((state) => state.setSystemAudioCaptureEnabled);
export const useSetSystemAudioCaptureActive = () => useAudioStore((state) => state.setSystemAudioCaptureActive);
export const useSetSystemAudioSourceReady = () => useAudioStore((state) => state.setSystemAudioSourceReady);
export const useRefreshSystemAudioSources = () => useAudioStore((state) => state.refreshSystemAudioSources);
export const useSelectParticipantOutput = () => useAudioStore((state) => state.selectParticipantOutput);

// New selectors (Phase 2): mode + per-channel mute flags
export const useMode = () => useAudioStore((state) => state.mode);
export const useIsMicMuted = () => useAudioStore((state) => state.isMicMuted);
export const useIsMonitorMuted = () => useAudioStore((state) => state.isMonitorMuted);
export const useIsParticipantMuted = () => useAudioStore((state) => state.isParticipantMuted);
export const useSetMode = () => useAudioStore((state) => state.setMode);
export const useSetMicMuted = () => useAudioStore((state) => state.setMicMuted);
export const useSetMonitorMuted = () => useAudioStore((state) => state.setMonitorMuted);
export const useSetParticipantMuted = () => useAudioStore((state) => state.setParticipantMuted);

// Scope-derivation selectors (Task 9): pure derivations from mode.
// "In scope" means the channel is active for the current AudioMode.
export const useIsParticipantChannelInScope = () =>
  useAudioStore((state) => state.mode === 'participant' || state.mode === 'both');
export const useIsSpeakerChannelInScope = () =>
  useAudioStore((state) => state.mode === 'speaker' || state.mode === 'both');
// Monitor channel is in scope only in pure 'speaker' mode.
// In 'both' mode it's mutex-excluded from participant to prevent
// audio feedback (the popover hides the monitor row entirely).
// This is intentional asymmetry with useIsSpeakerChannelInScope.
export const useIsMonitorChannelInScope = () =>
  useAudioStore((state) => state.mode === 'speaker');

// Export actions with memoization to prevent recreating objects.
// Grouped by channel (matches useAudioContext ordering).
export const useAudioActions = () => {
  // Mic
  const selectInputDevice = useSelectInputDevice();
  const toggleInputDeviceState = useToggleInputDeviceState();
  const setInputDeviceOn = useSetInputDeviceOn();
  const setMicMuted = useSetMicMuted();
  // Monitor
  const selectMonitorDevice = useSelectMonitorDevice();
  const toggleMonitorDeviceState = useToggleMonitorDeviceState();
  const setMonitorDeviceOn = useSetMonitorDeviceOn();
  const setMonitorMuted = useSetMonitorMuted();
  // Participant source
  const selectSystemAudioSource = useSelectSystemAudioSource();
  const toggleSystemAudioCapture = useToggleSystemAudioCapture();
  const setSystemAudioCaptureEnabled = useSetSystemAudioCaptureEnabled();
  const setSystemAudioCaptureActive = useSetSystemAudioCaptureActive();
  const setSystemAudioSourceReady = useSetSystemAudioSourceReady();
  const refreshSystemAudioSources = useRefreshSystemAudioSources();
  const setParticipantMuted = useSetParticipantMuted();
  // Extension passthrough
  const selectParticipantOutput = useSelectParticipantOutput();
  // Ancillary
  const toggleRealVoicePassthrough = useToggleRealVoicePassthrough();
  const setRealVoicePassthroughVolume = useSetRealVoicePassthroughVolume();
  const setNoiseSuppressionMode = useSetNoiseSuppressionMode();
  // Mode
  const setMode = useSetMode();
  // Globals
  const refreshDevices = useRefreshDevices();
  const initializeAudioService = useInitializeAudioService();

  return useMemo(
    () => ({
      // Mic
      selectInputDevice, toggleInputDeviceState, setInputDeviceOn, setMicMuted,
      // Monitor
      selectMonitorDevice, toggleMonitorDeviceState, setMonitorDeviceOn, setMonitorMuted,
      // Participant source
      selectSystemAudioSource, toggleSystemAudioCapture, setSystemAudioCaptureEnabled,
      setSystemAudioCaptureActive, setSystemAudioSourceReady, refreshSystemAudioSources,
      setParticipantMuted,
      // Extension passthrough
      selectParticipantOutput,
      // Ancillary
      toggleRealVoicePassthrough, setRealVoicePassthroughVolume, setNoiseSuppressionMode,
      // Mode
      setMode,
      // Globals
      refreshDevices, initializeAudioService,
    }),
    [
      selectInputDevice, toggleInputDeviceState, setInputDeviceOn, setMicMuted,
      selectMonitorDevice, toggleMonitorDeviceState, setMonitorDeviceOn, setMonitorMuted,
      selectSystemAudioSource, toggleSystemAudioCapture, setSystemAudioCaptureEnabled,
      setSystemAudioCaptureActive, setSystemAudioSourceReady, refreshSystemAudioSources,
      setParticipantMuted,
      selectParticipantOutput,
      toggleRealVoicePassthrough, setRealVoicePassthroughVolume, setNoiseSuppressionMode,
      setMode,
      refreshDevices, initializeAudioService,
    ]
  );
};

// Compound hook returning every audio-store field consumers need —
// kept flat for backwards compatibility with existing destructures.
// Grouped logically below: 4 channels (mic, monitor, participant source,
// extension passthrough) each expose (devices list)? + selected + on/off?
// + actions. Then ancillary streams (voice passthrough, noise suppression)
// and globals.
export const useAudioContext = () => {
  // --- Channel: Mic ---
  const audioInputDevices = useAudioInputDevices();
  const selectedInputDevice = useSelectedInputDevice();
  const isInputDeviceOn = useIsInputDeviceOn();
  const isMicMuted = useIsMicMuted();

  // --- Channel: Monitor ---
  const audioMonitorDevices = useAudioMonitorDevices();
  const selectedMonitorDevice = useSelectedMonitorDevice();
  const isMonitorDeviceOn = useIsMonitorDeviceOn();
  const isMonitorMuted = useIsMonitorMuted();

  // --- Channel: Participant source (system / tab audio) ---
  const systemAudioSources = useSystemAudioSources();
  const selectedParticipantSource = useSelectedParticipantSource();
  const isSystemAudioCaptureEnabled = useIsSystemAudioCaptureEnabled();
  const isSystemAudioCaptureActive = useIsSystemAudioCaptureActive();
  const isSystemAudioSourceReady = useIsSystemAudioSourceReady();
  const isParticipantMuted = useIsParticipantMuted();

  // --- Channel: Extension passthrough (no on/off; null = use default) ---
  const selectedParticipantOutput = useSelectedParticipantOutput();

  // --- Mode ---
  const mode = useMode();

  // --- Ancillary: real-voice passthrough + noise suppression ---
  const isRealVoicePassthroughEnabled = useIsRealVoicePassthroughEnabled();
  const realVoicePassthroughVolume = useRealVoicePassthroughVolume();
  const noiseSuppressionMode = useNoiseSuppressionMode();

  // --- Globals ---
  const isLoading = useIsAudioLoading();

  // Actions bundle (memoized in useAudioActions; spread below)
  const actions = useAudioActions();

  return useMemo(
    () => ({
      // Mic
      audioInputDevices, selectedInputDevice, isInputDeviceOn, isMicMuted,
      // Monitor
      audioMonitorDevices, selectedMonitorDevice, isMonitorDeviceOn, isMonitorMuted,
      // Participant source
      systemAudioSources, selectedParticipantSource,
      isSystemAudioCaptureEnabled, isSystemAudioCaptureActive, isSystemAudioSourceReady,
      isParticipantMuted,
      // Extension passthrough
      selectedParticipantOutput,
      // Mode
      mode,
      // Ancillary
      isRealVoicePassthroughEnabled, realVoicePassthroughVolume, noiseSuppressionMode,
      // Globals
      isLoading,
      // All actions (mic / monitor / participant / passthrough / ancillary / mode)
      ...actions,
    }),
    [
      audioInputDevices, selectedInputDevice, isInputDeviceOn, isMicMuted,
      audioMonitorDevices, selectedMonitorDevice, isMonitorDeviceOn, isMonitorMuted,
      systemAudioSources, selectedParticipantSource,
      isSystemAudioCaptureEnabled, isSystemAudioCaptureActive, isSystemAudioSourceReady,
      isParticipantMuted,
      selectedParticipantOutput,
      mode,
      isRealVoicePassthroughEnabled, realVoicePassthroughVolume, noiseSuppressionMode,
      isLoading,
      actions,
    ]
  );
};

export default useAudioStore;