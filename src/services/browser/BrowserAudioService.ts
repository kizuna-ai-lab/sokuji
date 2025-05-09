import { IAudioService, AudioDevices, AudioOperationResult } from '../interfaces/IAudioService';
import { WavStreamPlayer } from '../../lib/wavtools/index.js';

// Declare chrome namespace for extension messaging
declare const chrome: any;

// Install @types/chrome for better TypeScript support with Chrome extension APIs: npm install --save-dev @types/chrome

/**
 * Browser implementation of the Audio Service
 * This implementation uses Web Audio API for audio processing
 * in browser extensions where we don't have access to system audio devices
 */
export class BrowserAudioService implements IAudioService {
  private audioContext: AudioContext | null = null;
  private externalAudioContext: AudioContext | null = null; // To store the context from WavStreamPlayer
  private pcmCaptureIntervalId: number | null = null; // For PCM capture interval
  private isPcmCapturing: boolean = false; // Flag to indicate PCM capture status
  private virtualOutputDevice: MediaDeviceInfo | null = null; // Holds the conceptual virtual device info
  private isVirtualOutputSetup: boolean = false;

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
   * Setup virtual audio output using the provided WavStreamPlayer's AudioContext.
   * This method creates a virtual microphone that outputs the audio being played by the WavStreamPlayer.
   * @param wavStreamPlayer The WavStreamPlayer instance whose audio context will be used.
   * @returns Promise resolving to true if virtual output was successfully set up, false otherwise.
   */
  async setupVirtualAudioOutput(wavStreamPlayer: WavStreamPlayer): Promise<boolean> {
    if (!wavStreamPlayer || !wavStreamPlayer.context) {
      console.warn('Cannot setup virtual audio output: WavStreamPlayer or its context is not available.');
      return false;
    }

    const audioContext = wavStreamPlayer.context;

    try {
      // Store the external AudioContext for later use in connectMonitoringDevice and disconnectMonitoringDevices
      this.externalAudioContext = audioContext;

      // In browser extensions, we use {type:'none'} for setSinkId
      // This tells the browser not to connect to any physical output device
      const ctxWithSink = audioContext as AudioContext & {
        setSinkId?: (options: string | { type: string }) => Promise<void>;
      };

      if (ctxWithSink && typeof ctxWithSink.setSinkId === "function") {
        try {
          // Use {type:'none'} to prevent audio from being sent to physical speakers
          await ctxWithSink.setSinkId({ type: "none" });
          console.log("AudioContext output device set to virtual (none type)");
        } catch (err) {
          console.error("Failed to set output device:", err);
          return false;
        }
      } else {
        console.warn("AudioContext.setSinkId is not supported in this browser");
        return false;
      }

      // PCM Data Capture from wavStreamPlayer.analyser
      if (wavStreamPlayer.analyser) {
        this.startPcmCapture(wavStreamPlayer.analyser);
      } else {
        console.warn('WavStreamPlayer.analyser is not available. Cannot start PCM capture.');
      }

      this.setVirtualOutputSetupStatus(true);

      return true;
    } catch (e) {
      console.error('Failed to set up virtual audio output:', e);
      return false;
    }
  }

  /**
   * Starts capturing PCM data from the provided AnalyserNode.
   * @param analyserNode The AnalyserNode to capture data from.
   */
  private startPcmCapture(analyserNode: AnalyserNode): void {
    if (this.isPcmCapturing) {
      console.log('PCM capture is already active.');
      return;
    }

    const bufferSize = analyserNode.fftSize;
    const pcmDataArray = new Float32Array(bufferSize);
    this.isPcmCapturing = true;
    console.log('Starting PCM data capture...');

    this.pcmCaptureIntervalId = window.setInterval(() => { // Explicitly use window.setInterval
      if (!this.isPcmCapturing || !analyserNode) {
        this.stopPcmCapture();
        return;
      }
      analyserNode.getFloatTimeDomainData(pcmDataArray);

      // Construct audioData object
      const sampleRate = analyserNode.context.sampleRate;
      const numberOfChannels = 1; // getFloatTimeDomainData returns a single channel (mono or mixed-down)
      const currentChannelData = Array.from(pcmDataArray); // Convert Float32Array to regular array for serialization

      const audioData = {
        numberOfChannels,
        duration: pcmDataArray.length / sampleRate, // Duration of this chunk
        sampleRate,
        channelData: [currentChannelData] // Array of channels
      };

      // Check if there's any actual audio data to send
      const hasNonZeroValues = currentChannelData.some(value => value !== 0);

      // Send PCM data to the active tab's content script
      if (chrome && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
          if (chrome.runtime.lastError) {
            // Handle error, e.g., if no active tab or other issue
            // console.warn('Error querying tabs:', chrome.runtime.lastError.message);
            // Potentially stop capture if tabs cannot be queried consistently, or just log and continue
            // For now, we'll just log if there's an error and not send.
            // If running outside an extension context, chrome.tabs will be undefined.
            return;
          }
          const activeTab = tabs && tabs.length > 0 ? tabs[0] : null;
          if (activeTab && activeTab.id !== undefined) {
            console.log('Sending audio data to tab:', activeTab.id, hasNonZeroValues ? 'with audio' : 'silent chunk');
            chrome.tabs.sendMessage(activeTab.id, { type: 'AUDIO_CHUNK', data: audioData }, (response: any) => {
              if (chrome.runtime.lastError) {
                // console.warn('Error sending message to tab:', activeTab.id, chrome.runtime.lastError.message);
              }
              // You can handle responses from the content script here if needed
            });
          } else {
            // console.warn('No active tab found to send PCM data.');
          }
        });
      } else {
        // console.warn('chrome.tabs.query not available. PCM data not sent. Ensure this runs in an extension context.');
      }
    }, 100); // Adjust interval as needed (e.g., 100ms for 10fps-like updates)
  }

  /**
   * Stops capturing PCM data.
   */
  public stopPcmCapture(): void {
    if (this.pcmCaptureIntervalId !== null) {
      window.clearInterval(this.pcmCaptureIntervalId); // Explicitly use window.clearInterval
      this.pcmCaptureIntervalId = null;
    }
    this.isPcmCapturing = false;
    console.log('PCM data capture stopped.');
  }

  /**
   * Gets the current virtual audio output device information.
   * For browser extensions, this might be a conceptual device as true virtual devices are not supported.
   */
  getVirtualAudioOutputDevice(): MediaDeviceInfo | null {
    // In a browser extension, a true virtual device isn't created at the OS level.
    // This might return a conceptual device representation if one is created/managed internally.
    // For example, if setupVirtualAudioOutput successfully configures a virtual sink concept:
    if (this.isVirtualOutputSetup && this.externalAudioContext) { 
        this.virtualOutputDevice = {
            deviceId: 'sokuji-browser-virtual-output',
            kind: 'audioinput', // Seen as an input by other apps/tabs
            label: `Sokuji Virtual Output (Browser - ${this.externalAudioContext.sampleRate} Hz)`,
            groupId: 'sokuji-virtual-devices',
            toJSON: function() { return {...this}; } // Ensure it can be serialized if needed
        };
        return this.virtualOutputDevice;
    }
    return null; 
  }

  private setVirtualOutputSetupStatus(status: boolean): void {
    this.isVirtualOutputSetup = status;
  }

  // Placeholder for saving transcription, to be implemented
  async saveTranscription(format: 'txt' | 'srt', content: string): Promise<void> {
    // Implement logic to save transcription
  }
}
