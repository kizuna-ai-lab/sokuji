import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useMemo } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';
import { IAudioService, AudioOperationResult } from '../services/interfaces/IAudioService';

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
  setIsLoading: (loading: boolean) => void;
  
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
    audioService: null,
    
    // Basic setters
    setAudioService: (service) => set({ audioService: service }),
    setInputDevices: (devices) => set({ audioInputDevices: devices }),
    setMonitorDevices: (devices) => set({ audioMonitorDevices: devices }),
    selectInputDevice: (device) => set({ selectedInputDevice: device }),
    selectMonitorDevice: (device) => {
      console.info(`[Sokuji] [AudioStore] Selected monitor device: ${device.label} (${device.deviceId})`);
      set({ selectedMonitorDevice: device });
      
      // Connect to the selected monitor device
      const { audioService } = get();
      if (audioService && device) {
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
      set((state) => ({ isInputDeviceOn: !state.isInputDeviceOn }));
    },
    
    toggleMonitorDeviceState: () => {
      console.info('[Sokuji] [AudioStore] Toggling monitor device state');
      set((state) => {
        const newState = !state.isMonitorDeviceOn;
        
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
      console.info('[Sokuji] [AudioStore] Toggling real voice passthrough');
      set((state) => ({ isRealVoicePassthroughEnabled: !state.isRealVoicePassthroughEnabled }));
    },
    
    setRealVoicePassthroughVolume: (volume) => {
      // Clamp volume between 0 and 0.6 (60%)
      const clampedVolume = Math.max(0, Math.min(0.6, volume));
      console.info('[Sokuji] [AudioStore] Setting real voice passthrough volume:', clampedVolume);
      set({ realVoicePassthroughVolume: clampedVolume });
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
        
        // Select first non-virtual input device if not already selected
        const currentInputDevice = get().selectedInputDevice;
        if (devices.inputs.length > 0 && (!currentInputDevice || !devices.inputs.some(d => d.deviceId === currentInputDevice?.deviceId))) {
          const nonVirtualInputs = devices.inputs.filter(device => !device.isVirtual);
          if (nonVirtualInputs.length > 0) {
            set({ selectedInputDevice: nonVirtualInputs[0] });
          } else if (devices.inputs.length > 0) {
            set({ selectedInputDevice: devices.inputs[0] });
          }
        }
        
        // Select first non-virtual monitor device if not already selected
        let defaultMonitorDevice = null;
        const currentMonitorDevice = get().selectedMonitorDevice;
        if (devices.outputs.length > 0 && (!currentMonitorDevice || !devices.outputs.some(d => d.deviceId === currentMonitorDevice?.deviceId))) {
          const nonVirtualOutputs = devices.outputs.filter(device => !device.isVirtual);
          if (nonVirtualOutputs.length > 0) {
            defaultMonitorDevice = nonVirtualOutputs[0];
            set({ selectedMonitorDevice: defaultMonitorDevice });
          } else if (devices.outputs.length > 0) {
            defaultMonitorDevice = devices.outputs[0];
            set({ selectedMonitorDevice: defaultMonitorDevice });
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

// Export individual action selectors to avoid recreating objects
export const useSelectInputDevice = () => useAudioStore((state) => state.selectInputDevice);
export const useSelectMonitorDevice = () => useAudioStore((state) => state.selectMonitorDevice);
export const useToggleInputDeviceState = () => useAudioStore((state) => state.toggleInputDeviceState);
export const useToggleMonitorDeviceState = () => useAudioStore((state) => state.toggleMonitorDeviceState);
export const useToggleRealVoicePassthrough = () => useAudioStore((state) => state.toggleRealVoicePassthrough);
export const useSetRealVoicePassthroughVolume = () => useAudioStore((state) => state.setRealVoicePassthroughVolume);
export const useRefreshDevices = () => useAudioStore((state) => state.refreshDevices);
export const useInitializeAudioService = () => useAudioStore((state) => state.initializeAudioService);

// Export actions with memoization to prevent recreating objects
export const useAudioActions = () => {
  const selectInputDevice = useSelectInputDevice();
  const selectMonitorDevice = useSelectMonitorDevice();
  const toggleInputDeviceState = useToggleInputDeviceState();
  const toggleMonitorDeviceState = useToggleMonitorDeviceState();
  const toggleRealVoicePassthrough = useToggleRealVoicePassthrough();
  const setRealVoicePassthroughVolume = useSetRealVoicePassthroughVolume();
  const refreshDevices = useRefreshDevices();
  const initializeAudioService = useInitializeAudioService();
  
  return useMemo(
    () => ({
      selectInputDevice,
      selectMonitorDevice,
      toggleInputDeviceState,
      toggleMonitorDeviceState,
      toggleRealVoicePassthrough,
      setRealVoicePassthroughVolume,
      refreshDevices,
      initializeAudioService,
    }),
    [
      selectInputDevice,
      selectMonitorDevice,
      toggleInputDeviceState,
      toggleMonitorDeviceState,
      toggleRealVoicePassthrough,
      setRealVoicePassthroughVolume,
      refreshDevices,
      initializeAudioService,
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
      actions,
    ]
  );
};

export default useAudioStore;