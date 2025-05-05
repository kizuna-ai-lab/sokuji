import { IAudioService, AudioDevices, AudioOperationResult } from '../interfaces/IAudioService';

/**
 * Electron implementation of the Audio Service
 * This implementation uses Web Audio API for device enumeration and Electron IPC
 * for system-level operations like virtual device creation
 */
export class ElectronAudioService implements IAudioService {
  /**
   * Initialize the audio service
   */
  async initialize(): Promise<void> {
    // Nothing special needed for initialization in Electron
  }

  /**
   * Get available audio input and output devices using Web Audio API
   * This matches the browser implementation for consistency
   */
  async getDevices(): Promise<AudioDevices> {
    try {
      // Request permission to access media devices
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const inputs = devices
        .filter(device => device.kind === 'audioinput')
        .filter(device => device.deviceId !== 'default')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.substring(0, 5)}...`,
          isVirtual: device.label.toLowerCase().includes('sokuji') || device.label.toLowerCase().includes('virtual')
        }));
      
      const outputs = devices
        .filter(device => device.kind === 'audiooutput')
        .filter(device => device.deviceId !== 'default')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Speaker ${device.deviceId.substring(0, 5)}...`,
          isVirtual: device.label.toLowerCase().includes('sokuji') || device.label.toLowerCase().includes('virtual')
        }));
      
      return { inputs, outputs };
    } catch (error) {
      console.error('Failed to get audio devices:', error);
      return { inputs: [], outputs: [] };
    }
  }

  /**
   * Select an input device - in Electron this involves system integration
   */
  async selectInputDevice(deviceId: string): Promise<AudioOperationResult> {
    // In Electron version this is handled by the WebAudio API in the renderer process
    // not through IPC, so we just return success
    return {
      success: true,
      message: 'Input device selected'
    };
  }

  /**
   * Connect the virtual speaker to the specified monitoring device
   * This uses PulseAudio through Electron IPC
   */
  async connectMonitoringDevice(deviceId: string, label: string): Promise<AudioOperationResult> {
    try {
      const result = await (window as any).electron.invoke('connect-virtual-speaker-to-output', {
        deviceId,
        label
      });
      
      return {
        success: result.success,
        message: result.message,
        error: result.error
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to connect monitoring device'
      };
    }
  }

  /**
   * Disconnect the virtual speaker from all monitoring devices
   * This uses PulseAudio through Electron IPC
   */
  async disconnectMonitoringDevices(): Promise<AudioOperationResult> {
    try {
      const result = await (window as any).electron.invoke('disconnect-virtual-speaker-outputs');
      
      return {
        success: result.success,
        message: result.message,
        error: result.error
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to disconnect monitoring devices'
      };
    }
  }

  /**
   * Create virtual audio devices using PulseAudio through Electron IPC
   */
  async createVirtualDevices(): Promise<AudioOperationResult> {
    try {
      const result = await (window as any).electron.invoke('create-virtual-speaker');
      
      return {
        success: result.success,
        message: result.message,
        error: result.error
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create virtual devices'
      };
    }
  }

  /**
   * Electron version supports virtual audio devices through PulseAudio
   */
  supportsVirtualDevices(): boolean {
    return true;
  }
  
  /**
   * Setup virtual audio output with the provided AudioContext
   * In Electron, this finds and configures the sokuji_virtual_speaker device
   * @param audioContext The AudioContext to configure for virtual output
   * @returns Promise resolving to true if virtual output was successfully set up, false otherwise
   */
  async setupVirtualAudioOutput(audioContext: AudioContext | null): Promise<boolean> {
    if (!audioContext) {
      console.error('Cannot setup virtual audio output: AudioContext is null');
      return false;
    }
    
    try {
      // Get all audio output devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // Find sokuji_virtual_speaker
      const virtualSpeaker = devices.find(device => 
        device.kind === 'audiooutput' && 
        device.label.toLowerCase().includes('sokuji_virtual_speaker')
      );
      
      // If virtual speaker is found, set it as the output device
      if (virtualSpeaker && virtualSpeaker.deviceId) {
        const ctxWithSink = audioContext as AudioContext & { 
          setSinkId?: (options: string | { deviceId: string }) => Promise<void> 
        };
        
        if (ctxWithSink && typeof ctxWithSink.setSinkId === 'function') {
          try {
            // According to MDN documentation, use object format with deviceId
            await ctxWithSink.setSinkId(virtualSpeaker.deviceId);
            console.log('AudioContext output device set to sokuji_virtual_speaker:', virtualSpeaker.deviceId);
            return true;
          } catch (err) {
            console.error('Failed to set output device with both methods:', err);
            return false;          }
        }
      }
      
      console.log('Virtual output device not found. Using default output device.');
      return false;
    } catch (e) {
      console.error('Failed to set up virtual audio output:', e);
      return false;
    }
  }
}
