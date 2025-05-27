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
  private wavStreamPlayer: WavStreamPlayer = new WavStreamPlayer({ sampleRate: 24000 }); // WavStreamPlayer instance for audio output
  private interruptedTrackIds: { [key: string]: boolean } = {}; // Track IDs that have been interrupted
  private targetTabId: number | null = null; // Target tab ID from URL parameter

  /**
   * Initialize the Web Audio API components
   */
  async initialize(): Promise<void> {
    // WavStreamPlayer is already instantiated in the class definition
    
    // Get tabId from URL parameters if available
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tabIdParam = urlParams.get('tabId');
      
      if (tabIdParam) {
        this.targetTabId = parseInt(tabIdParam, 10);
        console.info(`[Sokuji] [BrowserAudio] BrowserAudioService initialized with target tabId: ${this.targetTabId}`);
      }
      
    } catch (error) {
      console.error('[Sokuji] [BrowserAudio] Error parsing URL parameters:', error);
    }
  }

  /**
   * Get available audio input and output devices using Web Audio API
   */
  async getDevices(): Promise<AudioDevices> {
    try {
      // Request permission to access media devices
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (permissionError: any) {
        console.error('[Sokuji] [BrowserAudio] Microphone permission denied:', permissionError);
        
        // Show user-friendly error message
        const errorType = permissionError.name || 'Error';
        let errorMessage = 'Unable to access your microphone. ';
        
        if (errorType === 'NotAllowedError' || errorType === 'PermissionDeniedError') {
          // Get the URL to permission.html
          let permissionUrl = '';
          if (chrome && chrome.runtime && chrome.runtime.getURL) {
            permissionUrl = chrome.runtime.getURL('permission.html');
          }
          
          errorMessage += 'Please allow microphone access to use this extension. ';
          
          if (permissionUrl) {
            errorMessage += `<a href="${permissionUrl}" target="_blank" style="color: white; text-decoration: underline; font-weight: bold;">Click here</a> to grant microphone permission, or `;
          }
          
          errorMessage += 'click the camera/microphone icon in your browser address bar and grant permission.';
        } else if (errorType === 'NotFoundError') {
          errorMessage += 'No microphone was found on your device.';
        } else if (errorType === 'NotReadableError') {
          errorMessage += 'Your microphone is already in use by another application.';
        } else {
          errorMessage += `Error details: ${permissionError.message || errorType}`;
        }
        
        // Display error message to user
        if (typeof window !== 'undefined') {
          // Create or update error notification element
          let notification = document.getElementById('sokuji-mic-error');
          if (!notification) {
            notification = document.createElement('div');
            notification.id = 'sokuji-mic-error';
            notification.style.cssText = 'position:fixed; top:10px; left:50%; transform:translateX(-50%); '
              + 'background:#f44336; color:white; padding:12px 24px; border-radius:4px; z-index:9999; '
              + 'max-width:80%; text-align:center; box-shadow:0 2px 5px rgba(0,0,0,0.3); font-family:sans-serif;';
            
            // Add close button
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '&times;';
            closeBtn.style.cssText = 'background:none; border:none; color:white; font-size:20px; '
              + 'position:absolute; right:5px; top:5px; cursor:pointer; padding:0 5px;';
            closeBtn.onclick = () => notification?.remove();
            notification.appendChild(closeBtn);
            
            document.body.appendChild(notification);
          }
          
          // Add message content
          notification.innerHTML = `<div>${errorMessage}</div>`;
          
          // Auto-hide after 15 seconds
          setTimeout(() => notification?.remove(), 15000);
        }
        
        // Return empty device lists
        return { inputs: [], outputs: [] };
      }
      
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
      console.error('[Sokuji] [BrowserAudio] Failed to get audio devices:', error);
      return { inputs: [], outputs: [] };
    }
  }

  /**
   * Select an input device using the Web Audio API
   */
  async selectInputDevice(deviceId: string): Promise<AudioOperationResult> {
    try {
      console.info(`[Sokuji] [BrowserAudio] Selecting input device: ${deviceId}`);
      
      // Here we would normally do something with the input device
      // but in browser extensions this is handled at stream creation time
      
      return {
        success: true,
        message: 'Input device selected'
      };
    } catch (error: any) {
      console.error('[Sokuji] [BrowserAudio] Error selecting input device:', error);
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
    console.info(`[Sokuji] [BrowserAudio] Connecting monitoring device: ${label} (${deviceId})`);
    try {
      if (!this.externalAudioContext) {
        console.error('[Sokuji] [BrowserAudio] Cannot connect monitoring device: No external AudioContext available');
        return {
          success: false,
          error: 'No audio context available'
        };
      }
      
      console.info(`[Sokuji] [BrowserAudio] Connecting monitoring device: ${label} (${deviceId})`);
      
      // Type assertion to access setSinkId method
      const ctxWithSink = this.externalAudioContext as AudioContext & { 
        setSinkId?: (options: string | { type: string }) => Promise<void>
      };
      
      if (ctxWithSink && typeof ctxWithSink.setSinkId === 'function') {
        try {
          // Use the device ID for setSinkId to route audio to the selected device
          await ctxWithSink.setSinkId(deviceId);
          
          console.info(`[Sokuji] [BrowserAudio] AudioContext output device set to: ${label}`);
          return {
            success: true,
            message: `Connected to monitoring device: ${label}`
          };
        } catch (err: any) {
          console.error('[Sokuji] [BrowserAudio] Failed to set output device:', err);
          return {
            success: false,
            error: err.message || 'Failed to set output device'
          };
        }
      } else {
        console.warn('[Sokuji] [BrowserAudio] AudioContext.setSinkId is not supported in this browser');
        return {
          success: false,
          error: 'setSinkId not supported in this browser'
        };
      }
    } catch (error: any) {
      console.error('[Sokuji] [BrowserAudio] Error connecting monitoring device:', error);
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
            console.info('[Sokuji] [BrowserAudio] AudioContext output device set back to virtual (none type)');
          } catch (err) {
            console.error('[Sokuji] [BrowserAudio] Failed to reset output device:', err);
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
        console.error('[Sokuji] [BrowserAudio] Failed to connect WavStreamPlayer:', error);
        return false;
      }
      
      // Check again after connecting
      if (!wavStreamPlayer.context) {
        console.warn('[Sokuji] [BrowserAudio] Cannot setup virtual audio output: WavStreamPlayer context is not available after connecting.');
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
          console.info("[Sokuji] [BrowserAudio] AudioContext output device set to virtual (none type)");
        } catch (err) {
          console.error("[Sokuji] [BrowserAudio] Failed to set output device:", err);
          return false;
        }
      } else {
        console.warn("[Sokuji] [BrowserAudio] AudioContext.setSinkId is not supported in this browser");
        return false;
      }

      console.info('[Sokuji] [BrowserAudio] Virtual audio output setup complete. Audio data will be sent directly from addAudioData.');
      return true;
    } catch (e) {
      console.error('[Sokuji] [BrowserAudio] Failed to set up virtual audio output:', e);
      return false;
    }
  }

  /**
   * Gets the current WavStreamPlayer instance
   */
  public getWavStreamPlayer(): WavStreamPlayer {
    return this.wavStreamPlayer;
  }

  /**
   * Adds 16-bit PCM audio data to the WavStreamPlayer and sends it to virtual microphone
   * @param data The audio data to add
   * @param trackId Optional track ID to associate with this audio
   */
  public addAudioData(data: Int16Array, trackId?: string): void {
    // First add to WavStreamPlayer for monitoring/playback
    this.wavStreamPlayer.add16BitPCM(data, trackId);
    
    // Then send to virtual microphone in tabs
    this.sendPcmDataToTabs(data, 'default');
  }
  
  /**
   * Sends PCM data directly to tabs for virtual microphone
   * This method chunks large audio data and sends it to all tabs with appropriate metadata
   * Format is compatible with the virtual-microphone.js implementation
   * @param data The Int16Array PCM data to send
   * @param trackId Optional track ID to associate with this audio
   */
  private sendPcmDataToTabs(data: Int16Array, trackId?: string): void {
    // Skip empty data
    if (!data || data.length === 0) {
      console.warn('[Sokuji] [BrowserAudio] Attempted to send empty audio data');
      return;
    }
    
    // Get sample rate from WavStreamPlayer
    const sampleRate = this.wavStreamPlayer?.sampleRate || 24000;
    
    // Use an appropriate chunk size based on the data size
    // For large files, use smaller chunks to prevent overwhelming the receiver
    const isLargeFile = data.length > 48000; // > 2 seconds at 24kHz
    const chunkSize = isLargeFile ? 4800 : 9600; // 200ms or 400ms chunks
    
    // Calculate the total number of chunks needed
    const totalChunks = Math.ceil(data.length / chunkSize);
    
    if (isLargeFile) {
      console.info(`[Sokuji] [BrowserAudio] Sending audio data (${data.length} samples, ~${(data.length / sampleRate).toFixed(2)}s) in ${totalChunks} chunks`);
    }
    
    // Process chunks recursively with slight delays for large files
    const processChunk = (chunkIndex: number): void => {
      // Calculate start and end positions for this chunk
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      
      // Create a slice of data for this chunk
      const chunkData = data.slice(start, end);
      
      // Create a message object with all necessary metadata - using PCM_DATA format
      const message = {
        type: 'PCM_DATA',
        pcmData: Array.from(chunkData), // Convert to regular array for serialization
        chunkIndex: chunkIndex,
        totalChunks: totalChunks,
        sampleRate: sampleRate,
        trackId: trackId || 'default',
        timestamp: Date.now()
      };
      
      // Send the message to the appropriate tabs
      this.sendMessageToTabs(message);
      
      // Process the next chunk if not done
      if (chunkIndex < totalChunks - 1) {
        processChunk(chunkIndex + 1);
      }
    };
    
    // Start processing with the first chunk
    processChunk(0);
  }
  
  /**
   * Sends audio data message to all relevant tabs
   * @param message The message to send
   */
  private sendMessageToTabs(message: any): void {
    // Only proceed if Chrome extension API is available
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      return; // Silent fail in non-extension context
    }
    
    // If we have a specific target tab ID from URL, use it directly
    if (this.targetTabId !== null) {
      this.sendMessageToTab(this.targetTabId, message);
      return;
    }
    
    // Otherwise send to all tabs
    this.sendToAllTabs(message);
  }
  
  /**
   * Sends a message to a specific tab by ID
   * @param tabId The tab ID to send to
   * @param message The message to send
   */
  private sendMessageToTab(tabId: number, message: any): void {
    // Check if the tab still exists
    chrome.tabs.get(tabId, (tab: any) => {
      if (chrome.runtime.lastError) {
        // Fall back to sending to all tabs
        this.sendToAllTabs(message);
        return;
      }
      
      if (!tab) {
        this.sendToAllTabs(message);
        return;
      }
      
      // Tab exists, send the message
      chrome.tabs.sendMessage(tabId, message, (response: any) => {
        if (chrome.runtime.lastError) {
          console.warn(`[Sokuji] [BrowserAudio] Error sending to tab ${tabId}: ${chrome.runtime.lastError.message}`);
        }
      });
    });
  }
  
  /**
   * Sends message to all tabs
   * @param message The message to send
   */
  private sendToAllTabs(message: any): void {
    chrome.tabs.query({}, (tabs: any[]) => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        return;
      }
      
      // Send to all tabs (excluding extension pages)
      for (const tab of tabs) {
        // Skip chrome:// pages and extension pages
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
          continue;
        }
        
        chrome.tabs.sendMessage(tab.id, message, (response: any) => {
          // Ignore errors, as not all tabs will have our content script
          if (chrome.runtime.lastError) {
            console.debug(`[Sokuji] [BrowserAudio] Tab ${tab.id} not ready: ${chrome.runtime.lastError.message}`);
          }
        });
      }
    });
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
        player.interruptedTrackIds = {};
        console.debug('[Sokuji] [BrowserAudio] Cleared WavStreamPlayer interruptedTrackIds');
      }
    } catch (error) {
      console.error('[Sokuji] [BrowserAudio] Error clearing WavStreamPlayer interruptedTrackIds:', error);
    }
  }
}
