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
  private externalAudioContext: AudioContext | null = null; // To store the context from WavStreamPlayer
  private pcmCaptureIntervalId: number | null = null; // For PCM capture interval
  private isPcmCapturing: boolean = false; // Flag to indicate PCM capture status
  private wavStreamPlayer: WavStreamPlayer = new WavStreamPlayer({ sampleRate: 24000 }); // WavStreamPlayer instance for audio output
  private interruptedTrackIds: { [key: string]: boolean } = {}; // Track IDs that have been interrupted

  /**
   * Initialize the Web Audio API components
   */
  async initialize(): Promise<void> {
    // WavStreamPlayer is already instantiated in the class definition
    // Any additional initialization can be done here if needed
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
   * Setup virtual audio output using the WavStreamPlayer's AudioContext.
   * This method creates a virtual microphone that outputs the audio being played by the WavStreamPlayer.
   * @param externalWavStreamPlayer Optional external WavStreamPlayer instance to use instead of the internal one
   * @returns Promise resolving to true if virtual output was successfully set up, false otherwise.
   */
  async setupVirtualAudioOutput(externalWavStreamPlayer?: WavStreamPlayer): Promise<boolean> {
    // Use provided external WavStreamPlayer or fall back to internal one
    const wavStreamPlayer = externalWavStreamPlayer || this.wavStreamPlayer;
    
    // Make sure the WavStreamPlayer is connected and has a valid context
    if (!wavStreamPlayer.context) {
      try {
        // Connect the WavStreamPlayer if it's not already connected
        await wavStreamPlayer.connect();
      } catch (error) {
        console.error('Failed to connect WavStreamPlayer:', error);
        return false;
      }
      
      // Check again after connecting
      if (!wavStreamPlayer.context) {
        console.warn('Cannot setup virtual audio output: WavStreamPlayer context is not available after connecting.');
        return false;
      }
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
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
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
   * Gets the current WavStreamPlayer instance
   */
  public getWavStreamPlayer(): WavStreamPlayer {
    return this.wavStreamPlayer;
  }

  /**
   * Connects the WavStreamPlayer to the audio context
   */
  public async connectWavStreamPlayer(): Promise<boolean> {
    try {
      await this.wavStreamPlayer.connect();
      return true;
    } catch (error) {
      console.error('Failed to connect WavStreamPlayer:', error);
      return false;
    }
  }

  /**
   * Adds 16-bit PCM audio data to the WavStreamPlayer
   * @param data The audio data to add
   * @param trackId Optional track ID to associate with this audio
   */
  public addAudioData(data: Int16Array, trackId?: string): void {
    this.wavStreamPlayer.add16BitPCM(data, trackId);
  }

  /**
   * Interrupts the currently playing audio
   * @returns Object containing trackId and offset if audio was interrupted
   */
  public async interruptAudio(): Promise<{ trackId: string; offset: number } | null> {
    const rawResult = await this.wavStreamPlayer.interrupt();
    
    // If no result or trackId is null, return null
    if (!rawResult || rawResult.trackId === null) {
      return null;
    }
    
    // Track interrupted track IDs
    this.interruptedTrackIds[rawResult.trackId] = true;
    
    // Return only the properties we need in the correct format
    return {
      trackId: rawResult.trackId,
      offset: rawResult.offset
    };
  }

  /**
   * Checks if a track has been interrupted
   * @param trackId The track ID to check
   * @returns True if the track has been interrupted, false otherwise
   */
  public isTrackInterrupted(trackId: string): boolean {
    return !!this.interruptedTrackIds[trackId];
  }

  /**
   * Clears the list of interrupted track IDs
   */
  public clearInterruptedTracks(): void {
    this.interruptedTrackIds = {};
    
    // Also clear the interrupted tracks in the WavStreamPlayer
    try {
      // Using any type to bypass TypeScript's type checking for accessing a private property
      const player = this.wavStreamPlayer as any;
      if (player && typeof player.interruptedTrackIds === 'object') {
        console.log('WavStreamPlayer previous interruptedTrackIds:', player.interruptedTrackIds);
        player.interruptedTrackIds = {};
        console.log('Cleared WavStreamPlayer interruptedTrackIds');
      }
    } catch (error) {
      console.error('Error clearing WavStreamPlayer interruptedTrackIds:', error);
    }
  }
}
