import { IAudioService, AudioDevices, AudioOperationResult } from '../../services/interfaces/IAudioService';
import { ModernAudioRecorder } from './ModernAudioRecorder';
import { ModernAudioPlayer } from './ModernAudioPlayer';
import { ModernPassthrough } from './ModernPassthrough';

// Declare chrome namespace for extension messaging
declare const chrome: any;

/**
 * Modern Browser Audio Service using standard APIs for better echo cancellation
 * Replaces the old wavtools-based implementation
 */
export class ModernBrowserAudioService implements IAudioService {
  private recorder: ModernAudioRecorder;
  private player: ModernAudioPlayer;
  private passthrough: ModernPassthrough;
  private targetTabId: number | null = null;
  private interruptedTrackIds: { [key: string]: boolean } = {};

  constructor() {
    // Initialize modern audio components
    this.recorder = new ModernAudioRecorder({ 
      sampleRate: 24000, 
      enablePassthrough: true,
      debug: false 
    });
    
    this.player = new ModernAudioPlayer({ 
      sampleRate: 24000 
    });
    
    this.passthrough = new ModernPassthrough({
      bufferDelay: 50, // 50ms delay to prevent immediate echo
      maxBufferSize: 10
    });
  }

  /**
   * Initialize the modern audio service
   */
  async initialize(): Promise<void> {
    // Connect the player
    await this.player.connect();
    
    // Initialize passthrough with the player
    this.passthrough.initialize(this.player);
    
    // Setup passthrough in recorder
    this.recorder.setupPassthrough(this.passthrough, false, 0.2);
    
    // Setup audio data handling
    this.recorder.onAudioData = (data) => {
      // Forward to passthrough system
      this.passthrough.addToPassthroughBuffer(data.mono);
      
      // Forward to external handler if set
      if (this.onRecordingData) {
        this.onRecordingData(data);
      }
    };

    // Get tabId from URL parameters if available
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tabIdParam = urlParams.get('tabId');
      
      if (tabIdParam) {
        this.targetTabId = parseInt(tabIdParam, 10);
        console.info(`[Sokuji] [ModernBrowserAudio] Initialized with target tabId: ${this.targetTabId}`);
      }
      
    } catch (error) {
      console.error('[Sokuji] [ModernBrowserAudio] Error parsing URL parameters:', error);
    }

    console.info('[Sokuji] [ModernBrowserAudio] Modern audio service initialized');
  }

  /**
   * External handler for recording data (used by passthrough system)
   */
  public onRecordingData: ((data: { mono: Int16Array; raw: Int16Array }) => void) | null = null;

  /**
   * Get available audio input and output devices
   */
  async getDevices(): Promise<AudioDevices> {
    try {
      // Request permission to access media devices
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (permissionError: any) {
        console.error('[Sokuji] [ModernBrowserAudio] Microphone permission denied:', permissionError);
        
        // Show user-friendly error message
        this.showPermissionError(permissionError);
        
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
      console.error('[Sokuji] [ModernBrowserAudio] Failed to get audio devices:', error);
      return { inputs: [], outputs: [] };
    }
  }

  /**
   * Show permission error to user
   * @private
   */
  private showPermissionError(permissionError: any): void {
    const errorType = permissionError.name || 'Error';
    let errorMessage = 'Unable to access your microphone. ';
    
    if (errorType === 'NotAllowedError' || errorType === 'PermissionDeniedError') {
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
      this.displayErrorNotification(errorMessage);
    }
  }

  /**
   * Display error notification
   * @private
   */
  private displayErrorNotification(errorMessage: string): void {
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

  /**
   * Connect to a monitoring device
   */
  async connectMonitoringDevice(deviceId: string, label: string): Promise<AudioOperationResult> {
    try {
      console.info(`[Sokuji] [ModernBrowserAudio] Connecting monitoring device: ${label} (${deviceId})`);
      
      const success = await this.player.setSinkId(deviceId);
      
      if (success) {
        return {
          success: true,
          message: `Connected to monitoring device: ${label}`
        };
      } else {
        return {
          success: false,
          error: 'Failed to set output device'
        };
      }
    } catch (error: any) {
      console.error('[Sokuji] [ModernBrowserAudio] Error connecting monitoring device:', error);
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
      // Reset to default output
      await this.player.setSinkId('');
      
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
   * Create virtual devices (not applicable for browser extensions)
   */
  async createVirtualDevices(): Promise<AudioOperationResult> {
    return {
      success: true,
      message: 'Using modern browser audio APIs with echo cancellation support'
    };
  }

  /**
   * Check if the platform supports virtual devices
   */
  supportsVirtualDevices(): boolean {
    return false; // Browser extensions use virtual microphone through messaging
  }

  /**
   * Setup virtual audio output
   */
  async setupVirtualAudioOutput(): Promise<boolean> {
    // Modern implementation doesn't need special virtual output setup
    // HTMLAudioElement handles echo cancellation automatically
    console.info('[Sokuji] [ModernBrowserAudio] Virtual audio output ready with modern implementation');
    return true;
  }

  /**
   * Get the modern audio player (compatibility method)
   */
  public getWavStreamPlayer(): ModernAudioPlayer {
    return this.player;
  }

  /**
   * Add audio data for playback and virtual microphone
   * @param data The audio data to add
   * @param trackId Optional track ID
   * @param shouldPlay Whether to play the audio (defaults to true for backward compatibility)
   */
  public addAudioData(data: Int16Array, trackId?: string, shouldPlay: boolean = true): void {
    let result = data;
    
    // Only play through modern player if shouldPlay is true
    if (shouldPlay) {
      // Use streaming audio for real-time playback to avoid audio fragments
      result = this.player.addStreamingAudio(result, trackId);
    }
    
    // Always send to virtual microphone (maintain compatibility)
    this.sendPcmDataToTabs(result, trackId);
  }

  /**
   * Send PCM data to tabs for virtual microphone
   * Maintains full compatibility with existing implementation
   */
  public sendPcmDataToTabs(data: Int16Array, trackId?: string): void {
    // Skip empty data
    if (!data || data.length === 0) {
      console.info('[Sokuji] [ModernBrowserAudio] Attempted to send empty audio data');
      return;
    }
    
    // Get sample rate from player
    const sampleRate = this.player?.sampleRate || 24000;
    
    // Use an appropriate chunk size based on the data size
    const isLargeFile = data.length > 48000; // > 2 seconds at 24kHz
    const chunkSize = isLargeFile ? 4800 : 9600; // 200ms or 400ms chunks
    
    // Calculate the total number of chunks needed
    const totalChunks = Math.ceil(data.length / chunkSize);
    
    if (isLargeFile) {
      console.info(`[Sokuji] [ModernBrowserAudio] Sending audio data (${data.length} samples, ~${(data.length / sampleRate).toFixed(2)}s) in ${totalChunks} chunks`);
    }
    
    // Process chunks recursively
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
   * Send message to tabs
   * @private
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
   * Send message to specific tab
   * @private
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
          console.warn(`[Sokuji] [ModernBrowserAudio] Error sending to tab ${tabId}: ${chrome.runtime.lastError.message}`);
        }
      });
    });
  }

  /**
   * Send message to all tabs
   * @private
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
            console.debug(`[Sokuji] [ModernBrowserAudio] Tab ${tab.id} not ready: ${chrome.runtime.lastError.message}`);
          }
        });
      }
    });
  }

  /**
   * Interrupt currently playing audio
   */
  public async interruptAudio(): Promise<{ trackId: string; offset: number } | null> {
    const rawResult = await this.player.interrupt();
    
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
   * Clear streaming audio data for a specific track
   * @param trackId The track ID to clear
   */
  public clearStreamingTrack(trackId: string): void {
    this.player.clearStreamingTrack(trackId);
  }

  /**
   * Clear interrupted tracks
   */
  public clearInterruptedTracks(): void {
    this.interruptedTrackIds = {};
    console.debug('[Sokuji] [ModernBrowserAudio] Cleared interrupted tracks');
  }
}