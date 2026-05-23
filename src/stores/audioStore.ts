import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useMemo } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';
import { IAudioService, AudioOperationResult } from '../services/interfaces/IAudioService';

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
  isLoading: boolean;
  isRealVoicePassthroughEnabled: boolean;
  realVoicePassthroughVolume: number;
  noiseSuppressionMode: NoiseSuppressionMode;

  // Symmetric mode + per-channel mute flags
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
  toggleRealVoicePassthrough: () => void;
  setRealVoicePassthroughVolume: (volume: number) => void;
  setNoiseSuppressionMode: (mode: NoiseSuppressionMode) => void;
  setIsLoading: (loading: boolean) => void;

  // Mode + mute setters
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
    isLoading: true,
    isRealVoicePassthroughEnabled: false,
    realVoicePassthroughVolume: 0.2,
    noiseSuppressionMode: 'enhanced' as NoiseSuppressionMode,

    // Mode + per-channel mute flags
    mode: 'speaker' as AudioMode,
    isMicMuted: false,      // default: mic unmuted
    isMonitorMuted: true,   // default: monitor off (opt-in audio)
    isParticipantMuted: false, // default: participant unmuted

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

    // Mode + per-channel mute setters

    setMode: (target) => {
      const settingsService = ServiceFactory.getSettingsService();
      set((state) => {
        const prev = state.mode;
        const prevSpeakerInScope = prev === 'speaker' || prev === 'both';
        const prevParticipantInScope = prev === 'participant' || prev === 'both';
        const nextSpeakerInScope = target === 'speaker' || target === 'both';
        const nextParticipantInScope = target === 'participant' || target === 'both';

        const patch: Partial<AudioStore> = { mode: target };

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

        settingsService.setSetting(STORAGE_KEYS.MODE, target)
          .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist mode:', error));
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
      set({ isMicMuted: muted });
    },

    setMonitorMuted: (muted) => {
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_MUTED, muted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMonitorMuted:', error));
      set((state) => {
        const { audioService } = state;
        if (audioService) audioService.setMonitorVolume(!muted);
        return { isMonitorMuted: muted };
      });
    },

    setParticipantMuted: (muted) => {
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.IS_PARTICIPANT_MUTED, muted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isParticipantMuted:', error));
      set({ isParticipantMuted: muted });
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
          // and (b) leaving them as null preserves rollback recoverability.
          // The storage key constants are retained here for the null-out to
          // compile; they will be removed in a future release once the
          // adoption window has closed.
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
          const derivedMicMuted = savedInputDeviceOn === false;
          set({ isMicMuted: derivedMicMuted });
          settingsService.setSetting(STORAGE_KEYS.IS_MIC_MUTED, derivedMicMuted)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist derived isMicMuted:', error));
        }

        const savedIsMonitorMuted = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_MONITOR_MUTED, null);
        if (typeof savedIsMonitorMuted === 'boolean') {
          set({ isMonitorMuted: savedIsMonitorMuted });
        } else {
          const derivedMonitorMuted = savedMonitorDeviceOn !== true;
          set({ isMonitorMuted: derivedMonitorMuted });
          settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_MUTED, derivedMonitorMuted)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist derived isMonitorMuted:', error));
        }

        const savedIsParticipantMuted = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_PARTICIPANT_MUTED, null);
        if (typeof savedIsParticipantMuted === 'boolean') {
          set({ isParticipantMuted: savedIsParticipantMuted });
        } else {
          const derivedParticipantMuted = savedSystemAudioCaptureEnabled === false;
          set({ isParticipantMuted: derivedParticipantMuted });
          settingsService.setSetting(STORAGE_KEYS.IS_PARTICIPANT_MUTED, derivedParticipantMuted)
            .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist derived isParticipantMuted:', error));
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
        const { isMonitorMuted } = get();
        audioService.setMonitorVolume(!isMonitorMuted);
        console.info(`[Sokuji] [AudioStore] Set initial monitor volume: ${isMonitorMuted ? '0.0' : '1.0'}`);
        
        // Refresh devices after initialization
        const devices = await get().refreshDevices();
        
        // Connect monitor device if available
        const deviceToConnect = get().selectedMonitorDevice || devices?.defaultMonitorDevice;
        if (deviceToConnect) {
          console.info('[Sokuji] [AudioStore] Initialization complete, connecting monitor device:', deviceToConnect.deviceId);
          await get().connectMonitorDevice(deviceToConnect.deviceId, deviceToConnect.label);
        }

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

// Export individual action selectors to avoid recreating objects
export const useSelectInputDevice = () => useAudioStore((state) => state.selectInputDevice);
export const useSelectMonitorDevice = () => useAudioStore((state) => state.selectMonitorDevice);
export const useToggleRealVoicePassthrough = () => useAudioStore((state) => state.toggleRealVoicePassthrough);
export const useSetRealVoicePassthroughVolume = () => useAudioStore((state) => state.setRealVoicePassthroughVolume);
export const useRefreshDevices = () => useAudioStore((state) => state.refreshDevices);
export const useInitializeAudioService = () => useAudioStore((state) => state.initializeAudioService);

// Mode + per-channel mute flag selectors
export const useMode = () => useAudioStore((state) => state.mode);
export const useIsMicMuted = () => useAudioStore((state) => state.isMicMuted);
export const useIsMonitorMuted = () => useAudioStore((state) => state.isMonitorMuted);
export const useIsParticipantMuted = () => useAudioStore((state) => state.isParticipantMuted);
export const useSetMode = () => useAudioStore((state) => state.setMode);
export const useSetMicMuted = () => useAudioStore((state) => state.setMicMuted);
export const useSetMonitorMuted = () => useAudioStore((state) => state.setMonitorMuted);
export const useSetParticipantMuted = () => useAudioStore((state) => state.setParticipantMuted);

// Scope-derivation selectors: pure derivations from mode.
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
  const setMicMuted = useSetMicMuted();
  // Monitor
  const selectMonitorDevice = useSelectMonitorDevice();
  const setMonitorMuted = useSetMonitorMuted();
  // Participant
  const setParticipantMuted = useSetParticipantMuted();
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
      selectInputDevice, setMicMuted,
      // Monitor
      selectMonitorDevice, setMonitorMuted,
      // Participant
      setParticipantMuted,
      // Ancillary
      toggleRealVoicePassthrough, setRealVoicePassthroughVolume, setNoiseSuppressionMode,
      // Mode
      setMode,
      // Globals
      refreshDevices, initializeAudioService,
    }),
    [
      selectInputDevice, setMicMuted,
      selectMonitorDevice, setMonitorMuted,
      setParticipantMuted,
      toggleRealVoicePassthrough, setRealVoicePassthroughVolume, setNoiseSuppressionMode,
      setMode,
      refreshDevices, initializeAudioService,
    ]
  );
};

// Compound hook returning every audio-store field consumers need —
// kept flat for backwards compatibility with existing destructures.
// Grouped logically: 4 channels (mic, monitor, participant source,
// extension passthrough) + ancillary streams + globals.
export const useAudioContext = () => {
  // --- Channel: Mic ---
  const audioInputDevices = useAudioInputDevices();
  const selectedInputDevice = useSelectedInputDevice();
  const isMicMuted = useIsMicMuted();

  // --- Channel: Monitor ---
  const audioMonitorDevices = useAudioMonitorDevices();
  const selectedMonitorDevice = useSelectedMonitorDevice();
  const isMonitorMuted = useIsMonitorMuted();

  // --- Channel: Participant ---
  const isParticipantMuted = useIsParticipantMuted();

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
      audioInputDevices, selectedInputDevice, isMicMuted,
      // Monitor
      audioMonitorDevices, selectedMonitorDevice, isMonitorMuted,
      // Participant
      isParticipantMuted,
      // Mode
      mode,
      // Ancillary
      isRealVoicePassthroughEnabled, realVoicePassthroughVolume, noiseSuppressionMode,
      // Globals
      isLoading,
      // All actions (mic / monitor / participant / ancillary / mode)
      ...actions,
    }),
    [
      audioInputDevices, selectedInputDevice, isMicMuted,
      audioMonitorDevices, selectedMonitorDevice, isMonitorMuted,
      isParticipantMuted,
      mode,
      isRealVoicePassthroughEnabled, realVoicePassthroughVolume, noiseSuppressionMode,
      isLoading,
      actions,
    ]
  );
};

export default useAudioStore;