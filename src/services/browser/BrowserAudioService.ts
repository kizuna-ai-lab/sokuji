import { IAudioService, AudioDevices, AudioOperationResult } from '../interfaces/IAudioService';

/**
 * Browser implementation of the Audio Service
 * This implementation uses Web Audio API for audio processing
 * in browser extensions where we don't have access to system audio devices
 */
export class BrowserAudioService implements IAudioService {
  private audioContext: AudioContext | null = null;
  private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private outputDestination: AudioDestinationNode | null = null;
  private gainNode: GainNode | null = null;
  
  /**
   * Initialize the Web Audio API components
   */
  async initialize(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.outputDestination = this.audioContext.destination;
      
      // Create a gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0;
      this.gainNode.connect(this.outputDestination);
      
      // Create a MediaStreamDestination for capturing output
      this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
      this.gainNode.connect(this.mediaStreamDestination);
    }
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
      
      // Add a virtual output device for the browser extension
      // This is to maintain API compatibility with the Electron version
      outputs.push({
        deviceId: 'virtual-output',
        label: 'Sokuji Virtual Output (Browser Extension)',
        isVirtual: true
      });
      
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
    try {
      if (!this.audioContext || !this.gainNode) {
        await this.initialize();
      }
      
      // In browsers, we can't actually route to specific output devices through JavaScript
      // unless the browser supports AudioContext.setSinkId() which is still experimental
      // Instead, we simulate the functionality
      
      console.log(`[Browser Audio] Connecting to monitoring device: ${label} (${deviceId})`);
      
      // If the browser supports setSinkId (Chrome 110+), we could use it
      let result: AudioOperationResult;
      
      if ((this.audioContext?.destination as any).setSinkId) {
        try {
          await (this.audioContext?.destination as any).setSinkId(deviceId);
          result = {
            success: true,
            message: `Connected to ${label} using setSinkId`
          };
        } catch (e) {
          console.warn('setSinkId failed:', e);
          result = {
            success: true,
            message: `Browser extensions have limited monitoring device selection. Audio should play through system default output.`
          };
        }
      } else {
        // Since most browsers don't support routing to specific devices,
        // we just return success but note the limitation
        result = {
          success: true,
          message: `Browser extensions have limited monitoring device selection. Audio should play through system default output.`
        };
      }
      
      return result;
    } catch (error: any) {
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
      if (this.gainNode) {
        // Disconnect from all outputs
        this.gainNode.disconnect();
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
    try {
      await this.initialize();
      
      return {
        success: true,
        message: 'Created virtual audio processing pipeline using Web Audio API'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create virtual audio pipeline'
      };
    }
  }

  /**
   * Check if the platform supports real virtual audio devices
   * Browser extensions do not have this capability
   */
  supportsVirtualDevices(): boolean {
    return false;
  }
}
