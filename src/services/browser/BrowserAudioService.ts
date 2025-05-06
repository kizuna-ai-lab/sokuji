import { IAudioService, AudioDevices, AudioOperationResult } from '../interfaces/IAudioService';

/**
 * Browser implementation of the Audio Service
 * This implementation uses Web Audio API for audio processing
 * in browser extensions where we don't have access to system audio devices
 */
export class BrowserAudioService implements IAudioService {
  private externalAudioContext: AudioContext | null = null; // Store external AudioContext from wavStreamPlayer

  /**
   * Initialize the Web Audio API components
   */
  async initialize(): Promise<void> {
  }

  /**
   * Get available audio input and output devices using Web Audio API
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
          isVirtual: false
        }));
      
      const outputs = devices
        .filter(device => device.kind === 'audiooutput')
        .filter(device => device.deviceId !== 'default')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Speaker ${device.deviceId.substring(0, 5)}...`,
          isVirtual: false
        }));
      
      return { inputs, outputs };
    } catch (error) {
      console.error('Failed to get audio devices:', error);
      return { inputs: [], outputs: [] };
    }
  }

  /**
   * Select an input device using the Web Audio API
   */
  async selectInputDevice(deviceId: string): Promise<AudioOperationResult> {
    try {
      console.log(`[Browser Audio] Selecting input device: ${deviceId}`);
      
      // Here we would normally do something with the input device
      // but in browser extensions this is handled at stream creation time
      
      return {
        success: true,
        message: 'Input device selected'
      };
    } catch (error: any) {
      console.error('Error selecting input device:', error);
      return {
        success: false,
        error: error.message || 'Failed to select input device'
      };
    }
  }

  /**
   * Connect to a monitoring device
   * In browsers, we're limited by what the Web Audio API allows
   */
  async connectMonitoringDevice(deviceId: string, label: string): Promise<AudioOperationResult> {
    console.log(`[Browser Audio] Connecting monitoring device: ${label} (${deviceId})`);
    try {
      if (!this.externalAudioContext) {
        console.error('Cannot connect monitoring device: No external AudioContext available');
        return {
          success: false,
          error: 'No audio context available'
        };
      }
      
      console.log(`[Browser Audio] Connecting monitoring device: ${label} (${deviceId})`);
      
      // Type assertion to access setSinkId method
      const ctxWithSink = this.externalAudioContext as AudioContext & { 
        setSinkId?: (options: string | { type: string }) => Promise<void>
      };
      
      if (ctxWithSink && typeof ctxWithSink.setSinkId === 'function') {
        try {
          // Use the device ID for setSinkId to route audio to the selected device
          await ctxWithSink.setSinkId(deviceId);
          
          console.log(`AudioContext output device set to: ${label}`);
          return {
            success: true,
            message: `Connected to monitoring device: ${label}`
          };
        } catch (err: any) {
          console.error('Failed to set output device:', err);
          return {
            success: false,
            error: err.message || 'Failed to set output device'
          };
        }
      } else {
        console.warn('AudioContext.setSinkId is not supported in this browser');
        return {
          success: false,
          error: 'setSinkId not supported in this browser'
        };
      }
    } catch (error: any) {
      console.error('Error connecting monitoring device:', error);
      return {
        success: false,
        error: error.message || 'Failed to connect monitoring device'
      };
    }
  }

  /**
   * Disconnect from all monitoring devices
   */
  async disconnectMonitoringDevices(): Promise<AudioOperationResult> {
    try {
      // If we have an external AudioContext, set it back to 'none' to stop audio output
      if (this.externalAudioContext) {
        // Type assertion to access setSinkId method
        const ctxWithSink = this.externalAudioContext as AudioContext & { 
          setSinkId?: (options: string | { type: string }) => Promise<void>
        };
        
        if (ctxWithSink && typeof ctxWithSink.setSinkId === 'function') {
          try {
            // Use {type:'none'} to prevent audio from being sent to physical speakers
            await ctxWithSink.setSinkId({type: 'none'});
            console.log('AudioContext output device set back to virtual (none type)');
          } catch (err) {
            console.error('Failed to reset output device:', err);
            return {
              success: false,
              error: 'Failed to reset output device'
            };
          }
        }
      }
      
      return {
        success: true,
        message: 'Disconnected from all monitoring devices'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to disconnect monitoring devices'
      };
    }
  }

  /**
   * Browser extensions cannot create true virtual audio devices
   * but we can create an audio processing pipeline using Web Audio API
   */
  async createVirtualDevices(): Promise<AudioOperationResult> {
    return {
      success: true,
      message: 'Created virtual audio processing pipeline using Web Audio API'
    };
  }

  /**
   * Check if the platform supports real virtual audio devices
   * Browser extensions do not have this capability
   */
  supportsVirtualDevices(): boolean {
    return false;
  }
  
  /**
   * Setup virtual audio output with the provided AudioContext
   * In browser extensions, we capture audio data and send it to the parent page
   * for the virtual device to use
   * @param audioContext The AudioContext to configure for virtual output
   * @returns Promise resolving to true if virtual output was successfully set up, false otherwise
   */
  async setupVirtualAudioOutput(audioContext: AudioContext | null): Promise<boolean> {
    if (!audioContext) {
      console.error('Cannot setup virtual audio output: AudioContext is null');
      return false;
    }
    
    try {
      // Store the external AudioContext for later use in connectMonitoringDevice and disconnectMonitoringDevices
      this.externalAudioContext = audioContext;
      
      // In browser extensions, we use {type:'none'} for setSinkId
      // This tells the browser not to connect to any physical output device
      const ctxWithSink = audioContext as AudioContext & { 
        setSinkId?: (options: string | { type: string }) => Promise<void>
      };
      
      if (ctxWithSink && typeof ctxWithSink.setSinkId === 'function') {
        try {
          // Use {type:'none'} to prevent audio from being sent to physical speakers
          await ctxWithSink.setSinkId({type: 'none'});
          console.log('AudioContext output device set to virtual (none type)');
          return true;
        } catch (err) {
          console.error('Failed to set output device:', err);
          return false;
        }
      } else {
        console.warn('AudioContext.setSinkId is not supported in this browser');
        return false;
      }
    } catch (e) {
      console.error('Failed to set up virtual audio output:', e);
      return false;
    }
  }
}
