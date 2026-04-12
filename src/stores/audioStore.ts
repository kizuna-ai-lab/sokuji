import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useMemo } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';
import { IAudioService, AudioOperationResult } from '../services/interfaces/IAudioService';
import { isElectron, isExtension, isLoopbackPlatform } from '../utils/environment';

export type NoiseSuppressionMode = 'off' | 'standard' | 'enhanced';

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
  selectedSystemAudioSource: AudioDevice | null;
  isSystemAudioCaptureEnabled: boolean;
  isSystemAudioCaptureActive: boolean;
  isSystemAudioSourceReady: boolean;
  participantAudioOutputDevice: AudioDevice | null; // Output device for participant audio (Extension only)

  // Audio service reference
  audioService: IAudioService | null;

  // Actions
  setAudioService: (service: IAudioService) => void;
  setInputDevices: (devices: AudioDevice[]) => void;
  setMonitorDevices: (devices: AudioDevice[]) => void;
  selectInputDevice: (device: AudioDevice) => void;
  selectMonitorDevice: (device: AudioDevice) => void;
  toggleInputDeviceState: () => void;
  toggleMonitorDeviceState: () => void;
  toggleRealVoicePassthrough: () => void;
  setRealVoicePassthroughVolume: (volume: number) => void;
  setNoiseSuppressionMode: (mode: NoiseSuppressionMode) => void;
  setIsLoading: (loading: boolean) => void;

  // System audio capture actions
  setSystemAudioSources: (sources: AudioDevice[]) => void;
  selectSystemAudioSource: (source: AudioDevice | null) => void;
  toggleSystemAudioCapture: () => void;
  setSystemAudioCaptureActive: (active: boolean) => void;
  setSystemAudioSourceReady: (ready: boolean) => void;
  refreshSystemAudioSources: () => Promise<void>;
  selectParticipantAudioOutputDevice: (device: AudioDevice | null) => void;

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
    selectedSystemAudioSource: null,
    isSystemAudioCaptureEnabled: false,
    isSystemAudioCaptureActive: false,
    isSystemAudioSourceReady: false,
    participantAudioOutputDevice: null,

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
      set((state) => {
        const newState = !state.isInputDeviceOn;
        // Persist the state
        const settingsService = ServiceFactory.getSettingsService();
        settingsService.setSetting(STORAGE_KEYS.IS_INPUT_DEVICE_ON, newState)
          .catch(error => console.error('[Sokuji] [AudioStore] Failed to save input device on state:', error));
        return { isInputDeviceOn: newState };
      });
    },
    
    toggleMonitorDeviceState: () => {
      console.info('[Sokuji] [AudioStore] Toggling monitor device state');
      set((state) => {
        const newState = !state.isMonitorDeviceOn;

        // Persist the state
        const settingsService = ServiceFactory.getSettingsService();
        settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_DEVICE_ON, newState)
          .catch(error => console.error('[Sokuji] [AudioStore] Failed to save monitor device on state:', error));

        // Set monitor volume based on state
        const { audioService } = get();
        if (audioService) {
          audioService.setMonitorVolume(newState);
          console.info(`[Sokuji] [AudioStore] Monitor state changed to: ${newState ? 'ON' : 'OFF'}`);
        }

        return { isMonitorDeviceOn: newState };
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
      set({ selectedSystemAudioSource: source });
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.SELECTED_SYSTEM_AUDIO_SOURCE_ID, source?.deviceId || '')
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save system audio source preference:', error));
    },

    toggleSystemAudioCapture: () => {
      set((state) => {
        const newState = !state.isSystemAudioCaptureEnabled;
        console.info('[Sokuji] [AudioStore] Toggling system audio capture:', newState);
        const settingsService = ServiceFactory.getSettingsService();
        settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, newState)
          .catch(error => console.error('[Sokuji] [AudioStore] Failed to save system audio capture state:', error));
        return { isSystemAudioCaptureEnabled: newState };
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
          const currentSource = get().selectedSystemAudioSource;
          if (!currentSource && sources.length > 0) {
            const settingsService = ServiceFactory.getSettingsService();
            const savedSourceId = await settingsService.getSetting<string>(STORAGE_KEYS.SELECTED_SYSTEM_AUDIO_SOURCE_ID, '');
            if (savedSourceId) {
              const savedSource = sources.find(s => s.deviceId === savedSourceId);
              if (savedSource) {
                console.info('[Sokuji] [AudioStore] Restored saved system audio source:', savedSource.label);
                set({ selectedSystemAudioSource: savedSource });
              } else {
                set({ selectedSystemAudioSource: sources[0] });
              }
            } else {
              set({ selectedSystemAudioSource: sources[0] });
            }
          }

          // Re-establish system audio connection if capture was enabled and a source is selected
          // Use selectedSystemAudioSource (includes both restored and auto-selected sources)
          const selectedSource = get().selectedSystemAudioSource;
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

    selectParticipantAudioOutputDevice: (device) => {
      console.info('[Sokuji] [AudioStore] Selected participant audio output device:', device?.label || 'None');
      set({ participantAudioOutputDevice: device });
      const settingsService = ServiceFactory.getSettingsService();
      settingsService.setSetting(STORAGE_KEYS.SELECTED_PARTICIPANT_AUDIO_OUTPUT_DEVICE_ID, device?.deviceId || '')
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to save participant audio output device:', error));
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
            set({ participantAudioOutputDevice: savedDevice });
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
export const useSelectedSystemAudioSource = () => useAudioStore((state) => state.selectedSystemAudioSource);
export const useIsSystemAudioCaptureEnabled = () => useAudioStore((state) => state.isSystemAudioCaptureEnabled);
export const useIsSystemAudioCaptureActive = () => useAudioStore((state) => state.isSystemAudioCaptureActive);
export const useIsSystemAudioSourceReady = () => useAudioStore((state) => state.isSystemAudioSourceReady);
export const useParticipantAudioOutputDevice = () => useAudioStore((state) => state.participantAudioOutputDevice);

// Export individual action selectors to avoid recreating objects
export const useSelectInputDevice = () => useAudioStore((state) => state.selectInputDevice);
export const useSelectMonitorDevice = () => useAudioStore((state) => state.selectMonitorDevice);
export const useToggleInputDeviceState = () => useAudioStore((state) => state.toggleInputDeviceState);
export const useToggleMonitorDeviceState = () => useAudioStore((state) => state.toggleMonitorDeviceState);
export const useToggleRealVoicePassthrough = () => useAudioStore((state) => state.toggleRealVoicePassthrough);
export const useSetRealVoicePassthroughVolume = () => useAudioStore((state) => state.setRealVoicePassthroughVolume);
export const useRefreshDevices = () => useAudioStore((state) => state.refreshDevices);
export const useInitializeAudioService = () => useAudioStore((state) => state.initializeAudioService);

// System audio capture action selectors
export const useSelectSystemAudioSource = () => useAudioStore((state) => state.selectSystemAudioSource);
export const useToggleSystemAudioCapture = () => useAudioStore((state) => state.toggleSystemAudioCapture);
export const useSetSystemAudioCaptureActive = () => useAudioStore((state) => state.setSystemAudioCaptureActive);
export const useSetSystemAudioSourceReady = () => useAudioStore((state) => state.setSystemAudioSourceReady);
export const useRefreshSystemAudioSources = () => useAudioStore((state) => state.refreshSystemAudioSources);
export const useSelectParticipantAudioOutputDevice = () => useAudioStore((state) => state.selectParticipantAudioOutputDevice);

// Export actions with memoization to prevent recreating objects
export const useAudioActions = () => {
  const selectInputDevice = useSelectInputDevice();
  const selectMonitorDevice = useSelectMonitorDevice();
  const toggleInputDeviceState = useToggleInputDeviceState();
  const toggleMonitorDeviceState = useToggleMonitorDeviceState();
  const toggleRealVoicePassthrough = useToggleRealVoicePassthrough();
  const setRealVoicePassthroughVolume = useSetRealVoicePassthroughVolume();
  const setNoiseSuppressionMode = useSetNoiseSuppressionMode();
  const refreshDevices = useRefreshDevices();
  const initializeAudioService = useInitializeAudioService();
  const selectSystemAudioSource = useSelectSystemAudioSource();
  const toggleSystemAudioCapture = useToggleSystemAudioCapture();
  const setSystemAudioCaptureActive = useSetSystemAudioCaptureActive();
  const setSystemAudioSourceReady = useSetSystemAudioSourceReady();
  const refreshSystemAudioSources = useRefreshSystemAudioSources();
  const selectParticipantAudioOutputDevice = useSelectParticipantAudioOutputDevice();

  return useMemo(
    () => ({
      selectInputDevice,
      selectMonitorDevice,
      toggleInputDeviceState,
      toggleMonitorDeviceState,
      toggleRealVoicePassthrough,
      setRealVoicePassthroughVolume,
      setNoiseSuppressionMode,
      refreshDevices,
      initializeAudioService,
      selectSystemAudioSource,
      toggleSystemAudioCapture,
      setSystemAudioCaptureActive,
      setSystemAudioSourceReady,
      refreshSystemAudioSources,
      selectParticipantAudioOutputDevice,
    }),
    [
      selectInputDevice,
      selectMonitorDevice,
      toggleInputDeviceState,
      toggleMonitorDeviceState,
      toggleRealVoicePassthrough,
      setRealVoicePassthroughVolume,
      setNoiseSuppressionMode,
      refreshDevices,
      initializeAudioService,
      selectSystemAudioSource,
      toggleSystemAudioCapture,
      setSystemAudioCaptureActive,
      setSystemAudioSourceReady,
      refreshSystemAudioSources,
      selectParticipantAudioOutputDevice,
    ]
  );
};

// For backward compatibility with useAudioContext hook
export const useAudioContext = () => {
  const audioInputDevices = useAudioInputDevices();
  const audioMonitorDevices = useAudioMonitorDevices();
  const selectedInputDevice = useSelectedInputDevice();
  const selectedMonitorDevice = useSelectedMonitorDevice();
  const isInputDeviceOn = useIsInputDeviceOn();
  const isMonitorDeviceOn = useIsMonitorDeviceOn();
  const isLoading = useIsAudioLoading();
  const isRealVoicePassthroughEnabled = useIsRealVoicePassthroughEnabled();
  const realVoicePassthroughVolume = useRealVoicePassthroughVolume();
  const noiseSuppressionMode = useNoiseSuppressionMode();
  const systemAudioSources = useSystemAudioSources();
  const selectedSystemAudioSource = useSelectedSystemAudioSource();
  const isSystemAudioCaptureEnabled = useIsSystemAudioCaptureEnabled();
  const isSystemAudioCaptureActive = useIsSystemAudioCaptureActive();
  const isSystemAudioSourceReady = useIsSystemAudioSourceReady();
  const participantAudioOutputDevice = useParticipantAudioOutputDevice();
  const actions = useAudioActions();

  return useMemo(
    () => ({
      audioInputDevices,
      audioMonitorDevices,
      selectedInputDevice,
      selectedMonitorDevice,
      isInputDeviceOn,
      isMonitorDeviceOn,
      isLoading,
      isRealVoicePassthroughEnabled,
      realVoicePassthroughVolume,
      noiseSuppressionMode,
      systemAudioSources,
      selectedSystemAudioSource,
      isSystemAudioCaptureEnabled,
      isSystemAudioCaptureActive,
      isSystemAudioSourceReady,
      participantAudioOutputDevice,
      ...actions,
    }),
    [
      audioInputDevices,
      audioMonitorDevices,
      selectedInputDevice,
      selectedMonitorDevice,
      isInputDeviceOn,
      isMonitorDeviceOn,
      isLoading,
      isRealVoicePassthroughEnabled,
      realVoicePassthroughVolume,
      noiseSuppressionMode,
      systemAudioSources,
      selectedSystemAudioSource,
      isSystemAudioCaptureEnabled,
      isSystemAudioCaptureActive,
      isSystemAudioSourceReady,
      participantAudioOutputDevice,
      actions,
    ]
  );
};

export default useAudioStore;