import { IAudioService, AudioDevices, AudioOperationResult, AudioRecordingCallback } from '../../services/interfaces/IAudioService';
import { ModernAudioRecorder } from './ModernAudioRecorder';
import { ModernAudioPlayer } from './ModernAudioPlayer';
import { ServiceFactory } from '../../services/ServiceFactory';
import { AudioDevice } from '../../stores/audioStore';

// Declare chrome namespace for extension messaging
declare const chrome: any;

// Declare electron window interface
declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, data?: any) => Promise<any>;
    };
  }
}

/**
 * Modern Browser Audio Service using standard APIs for better echo cancellation
 * Replaces the old wavtools-based implementation
 */
export class ModernBrowserAudioService implements IAudioService {
  private recorder: ModernAudioRecorder;
  private player: ModernAudioPlayer;
  private virtualSpeakerPlayer: ModernAudioPlayer | null;
  private targetTabId: number | null = null;
  private interruptedTrackIds: { [key: string]: boolean } = {};
  private initialized: boolean = false;
  private recordingCallback: AudioRecordingCallback | null = null;
  private currentRecordingDeviceId: string | undefined = undefined;
  private diagnosticsInterval: NodeJS.Timeout | null = null;

  // System audio capture state
  // Connection state (switched via pw-link when user selects device)
  private systemAudioSourceConnected: boolean = false;
  private currentSystemAudioSinkId: string | undefined = undefined; // The sink being captured
  // Recording state (started when session starts)
  private systemAudioRecorder: ModernAudioRecorder | null = null;
  private systemAudioCallback: AudioRecordingCallback | null = null;
  private systemAudioRecordingActive: boolean = false;

  constructor() {
    // Initialize modern audio components
    this.recorder = new ModernAudioRecorder({ 
      sampleRate: 24000, 
      enablePassthrough: true
    });
    
    this.player = new ModernAudioPlayer({ 
      sampleRate: 24000 
    });
    
    // Initialize virtual speaker player only in Electron
    this.virtualSpeakerPlayer = null;
    if (ServiceFactory.isElectron()) {
      console.info('[Sokuji] [ModernBrowserAudio] Initializing virtual speaker player for Electron');
      this.virtualSpeakerPlayer = new ModernAudioPlayer({ 
        sampleRate: 24000 
      });
    }
  }

  /**
   * Initialize the modern audio service
   */
  async initialize(): Promise<void> {
    // Make initialization idempotent
    if (this.initialized) {
      console.info('[Sokuji] [ModernBrowserAudio] Audio service already initialized');
      return;
    }

    // Connect the player
    await this.player.connect();

    // Connect virtual speaker player if available
    if (this.virtualSpeakerPlayer) {
      await this.virtualSpeakerPlayer.connect();
      // Auto-detect and configure virtual speaker device
      await this.detectAndSetVirtualSpeaker();
    }
    
    // Initialize passthrough settings (will be configured later via setupPassthrough)
    this.recorder.setupPassthrough(false, 0.3);

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

    this.initialized = true;
    console.info('[Sokuji] [ModernBrowserAudio] Audio service initialized');
    
    // Start diagnostics monitoring in development
    this.startDiagnosticsMonitoring();
  }
  
  /**
   * Start periodic diagnostics monitoring
   */
  private startDiagnosticsMonitoring(): void {
    // Clear any existing interval
    if (this.diagnosticsInterval) {
      clearInterval(this.diagnosticsInterval);
    }
    
    // Log diagnostics every 5 seconds
    this.diagnosticsInterval = setInterval(() => {
      const diagnostics = (this.player as any).getSequenceDiagnostics?.();
      if (diagnostics && (diagnostics.outOfOrderCount > 0 || diagnostics.gaps.length > 0)) {
        console.warn('[AudioSequence] Diagnostics:', diagnostics);
      }
    }, 5000);
  }


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
        .filter(device => device.deviceId !== 'communications')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.substring(0, 5)}...`,
          isVirtual: device.label ? device.label.includes('CABLE') : false
        }));

      const outputs = devices
        .filter(device => device.kind === 'audiooutput')
        .filter(device => device.deviceId !== 'default')
        .filter(device => device.deviceId !== 'communications')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Speaker ${device.deviceId.substring(0, 5)}...`,
          isVirtual: device.label ? device.label.includes('CABLE') : false
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
   * Detect and configure virtual speaker device for Electron
   * @private
   */
  private async detectAndSetVirtualSpeaker(): Promise<void> {
    try {
      const devices = await this.getDevices();

      // First priority: Look for Sokuji_Virtual_Speaker (Linux)
      let virtualSpeaker = devices.outputs.find(device =>
        device.label.includes('Sokuji_Virtual_Speaker')
      );

      // Second priority: Look for SokujiVirtualAudio (Mac)
      if (!virtualSpeaker) {
        virtualSpeaker = devices.outputs.find(device =>
          device.label.includes('SokujiVirtualAudio')
        );
      }

      // Third priority: Look for VB-CABLE devices (Windows)
      if (!virtualSpeaker) {
        virtualSpeaker = devices.outputs.find(device =>
          device.label.toUpperCase().includes('CABLE')
        );
      }

      if (virtualSpeaker && this.virtualSpeakerPlayer) {
        await this.virtualSpeakerPlayer.setSinkId(virtualSpeaker.deviceId);
        console.info('[Sokuji] [ModernBrowserAudio] Virtual speaker detected and configured:', virtualSpeaker.label);
      } else if (this.virtualSpeakerPlayer) {
        console.warn('[Sokuji] [ModernBrowserAudio] Virtual speaker device not found (neither Sokuji_Virtual_Speaker, SokujiVirtualAudio, nor VB-CABLE)');
      }
    } catch (error) {
      console.error('[Sokuji] [ModernBrowserAudio] Error detecting virtual speaker:', error);
    }
  }

  /**
   * Connect to a monitoring device
   */
  async connectMonitoringDevice(deviceId: string, label: string): Promise<AudioOperationResult> {
    try {
      console.debug(`[Sokuji] [ModernBrowserAudio] Connecting monitoring device: ${label} (${deviceId})`);
      
      const success = await this.player.setSinkId(deviceId);
      
      if (success) {
        // Re-detect virtual speaker when output device changes
        if (this.virtualSpeakerPlayer) {
          await this.detectAndSetVirtualSpeaker();
        }
        
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
   * Set monitor volume (0 to mute, 1 for normal)
   * @param enabled Whether monitor is enabled
   */
  public setMonitorVolume(enabled: boolean): void {
    const volume = enabled ? 1.0 : 0.0;
    this.player.setGlobalVolume(volume);
    console.debug(`[Sokuji] [ModernBrowserAudio] Monitor volume set to: ${volume}`);
    
    // Virtual speaker always plays at full volume (not affected by monitor toggle)
    if (this.virtualSpeakerPlayer) {
      this.virtualSpeakerPlayer.setGlobalVolume(1.0);
    }
  }

  /**
   * Add audio data for playback and virtual microphone
   * @param data The audio data to add
   * @param trackId Optional track ID
   * @param shouldPlay Whether to play the audio (not used, kept for compatibility)
   * @param metadata Optional metadata (e.g., itemId for tracking)
   */
  public addAudioData(data: Int16Array, trackId?: string, shouldPlay?: boolean, metadata?: any): void {
    let result = data;
    
    // Always add audio to player - let global volume control handle muting
    // Use streaming audio for real-time playback to avoid audio fragments
    // Pass metadata to the player for tracking
    result = this.player.addStreamingAudio(result, trackId, 1.0, metadata);
    
    // Also add to virtual speaker player if available (Electron only)
    if (this.virtualSpeakerPlayer) {
      this.virtualSpeakerPlayer.addStreamingAudio(data, trackId, 1.0, metadata);
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
      console.debug('[Sokuji] [ModernBrowserAudio] Attempted to send empty audio data');
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
      chrome.tabs.sendMessage(tabId, message, (_response: any) => {
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
        
        chrome.tabs.sendMessage(tab.id, message, (_response: any) => {
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
    
    // Also interrupt virtual speaker player
    if (this.virtualSpeakerPlayer) {
      await this.virtualSpeakerPlayer.interrupt();
    }
    
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
    
    // Also clear from virtual speaker player
    if (this.virtualSpeakerPlayer) {
      this.virtualSpeakerPlayer.clearStreamingTrack(trackId);
    }
  }

  /**
   * Clear interrupted tracks
   */
  public clearInterruptedTracks(): void {
    this.interruptedTrackIds = {};
    // Also clear interrupted tracks in the player
    this.player.clearInterruptedTracks();
    
    // Also clear from virtual speaker player
    if (this.virtualSpeakerPlayer) {
      this.virtualSpeakerPlayer.clearInterruptedTracks();
    }
    
    console.debug('[Sokuji] [ModernBrowserAudio] Cleared interrupted tracks');
  }

  /**
   * Start recording audio from the specified device
   */
  public async startRecording(deviceId: string | undefined, callback: AudioRecordingCallback): Promise<void> {
    this.recordingCallback = callback;

    console.debug(`[Sokuji] [ModernBrowserAudio] Starting recording from device: ${deviceId}`);
    
    // Check if we need to switch devices
    const recorderStatus = this.recorder.getStatus();
    const needsDeviceSwitch = this.currentRecordingDeviceId !== deviceId && recorderStatus !== 'ended';
    
    if (needsDeviceSwitch) {
      console.info(`[Sokuji] [ModernBrowserAudio] Switching recording device from ${this.currentRecordingDeviceId} to ${deviceId}`);
      // Need to end current recording session to switch devices
      await this.recorder.end();
    }
    
    // Check if recorder needs to be connected
    if (this.recorder.getStatus() === 'ended') {
      // Connect with the (potentially new) device
      await this.recorder.begin(deviceId);
      this.currentRecordingDeviceId = deviceId;
    }
    
    // Start recording with callback that handles both AI and passthrough
    await this.recorder.record((data) => {
      // Forward to the external callback (MainPanel will send to AI)
      if (this.recordingCallback) {
        this.recordingCallback(data);
      }
      
      // Handle passthrough internally if enabled
      // Check the data object for passthrough info (as set by ModernAudioRecorder)
      if (data.isPassthrough && data.mono) {
        this.handlePassthroughAudio(data.mono, data.passthroughVolume || 0.3);
      }
    });
  }

  /**
   * Stop recording and clean up resources
   */
  public async stopRecording(): Promise<void> {
    await this.recorder.end();
    this.recordingCallback = null;
    this.currentRecordingDeviceId = undefined;
  }

  /**
   * Pause recording (keeps resources allocated)
   */
  public async pauseRecording(): Promise<void> {
    await this.recorder.pause();
  }

  /**
   * Switch recording device while maintaining session
   * @param deviceId The new device ID to switch to
   */
  public async switchRecordingDevice(deviceId: string | undefined): Promise<void> {
    if (this.currentRecordingDeviceId === deviceId) {
      console.debug(`[Sokuji] [ModernBrowserAudio] Already using device: ${deviceId}`);
      return;
    }

    console.info(`[Sokuji] [ModernBrowserAudio] Switching recording device from ${this.currentRecordingDeviceId} to ${deviceId}`);
    
    // Save the current recording state
    const wasRecording = this.recorder.getStatus() === 'recording';
    const savedCallback = this.recordingCallback;
    
    // End current recording session
    if (this.recorder.getStatus() !== 'ended') {
      await this.recorder.end();
    }
    
    // Begin with new device
    await this.recorder.begin(deviceId);
    this.currentRecordingDeviceId = deviceId;
    
    // Resume recording if it was active
    if (wasRecording && savedCallback) {
      await this.recorder.record((data) => {
        if (savedCallback) {
          savedCallback(data);
        }
        
        if (data.isPassthrough && data.mono) {
          this.handlePassthroughAudio(data.mono, data.passthroughVolume || 0.3);
        }
      });
    }
  }

  /**
   * Get the recorder instance
   */
  public getRecorder(): ModernAudioRecorder {
    return this.recorder;
  }

  /**
   * Setup passthrough settings
   */
  public setupPassthrough(enabled: boolean, volume: number): void {
    this.recorder.setupPassthrough(enabled, volume);
  }

  /**
   * Handle passthrough audio routing to outputs
   */
  public handlePassthroughAudio(audioData: Int16Array, volume: number): void {
    const delay = 150; // ms delay for echo cancellation
    
    // Send to monitor output
    this.player.addToPassthroughBuffer(audioData, volume, delay);
    
    // Send to virtual speaker if available
    if (this.virtualSpeakerPlayer) {
      this.virtualSpeakerPlayer.addToPassthroughBuffer(audioData, volume, delay);
    }

    // Apply volume before sending to virtual microphone (for extension environment)
    const volumeAdjustedData = this.applyPassthroughVolume(audioData, volume);
    this.sendPcmDataToTabs(volumeAdjustedData, 'passthrough');
  }

  /**
   * Apply volume to passthrough audio data
   * @private
   */
  private applyPassthroughVolume(buffer: Int16Array, volume: number): Int16Array {
    if (volume === 1.0) return buffer;

    const result = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      result[i] = Math.round(buffer[i] * volume);
    }
    return result;
  }

  // ============================================
  // System Audio Capture Methods
  // ============================================

  /**
   * Check if system audio capture is supported
   * Currently only supported on Linux with Electron
   */
  public supportsSystemAudioCapture(): boolean {
    // Check if we're in Electron and on Linux
    if (ServiceFactory.isElectron() && window.electron) {
      // The actual platform check is done in the main process
      return true;
    }
    return false;
  }

  /**
   * Get available system audio sources (audio outputs that can be captured)
   */
  public async getSystemAudioSources(): Promise<AudioDevice[]> {
    if (!ServiceFactory.isElectron() || !window.electron) {
      return [];
    }

    try {
      // Check if platform supports system audio capture
      const supported = await window.electron.invoke('supports-system-audio-capture');
      if (!supported) {
        console.info('[Sokuji] [ModernBrowserAudio] System audio capture not supported on this platform');
        return [];
      }

      // Get list of audio sinks from the main process
      const sources = await window.electron.invoke('list-system-audio-sources');
      console.info('[Sokuji] [ModernBrowserAudio] Found system audio sources:', sources?.length || 0);
      return sources || [];
    } catch (error) {
      console.error('[Sokuji] [ModernBrowserAudio] Error getting system audio sources:', error);
      return [];
    }
  }

  /**
   * Connect a system audio source to the virtual mic
   * Called when user selects a system audio device
   * Only switches pw-link connections, does not recreate modules
   * @param sourceDeviceId The sink name to capture audio from
   */
  public async connectSystemAudioSource(sourceDeviceId: string): Promise<void> {
    if (!ServiceFactory.isElectron() || !window.electron) {
      throw new Error('System audio capture is only supported in Electron');
    }

    try {
      console.info(`[Sokuji] [ModernBrowserAudio] Connecting system audio source: ${sourceDeviceId}`);

      // Switch connection in the main process
      const result = await window.electron.invoke('connect-system-audio-source', sourceDeviceId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to connect system audio source');
      }

      // Store the connection info
      this.systemAudioSourceConnected = true;
      this.currentSystemAudioSinkId = sourceDeviceId;

      console.info(`[Sokuji] [ModernBrowserAudio] System audio source connected: ${sourceDeviceId}`);
    } catch (error) {
      console.error('[Sokuji] [ModernBrowserAudio] Failed to connect system audio source:', error);
      // Reset state on failure
      this.systemAudioSourceConnected = false;
      this.currentSystemAudioSinkId = undefined;
      throw error;
    }
  }

  /**
   * Disconnect the current system audio source
   * Called when user deselects the system audio device
   */
  public async disconnectSystemAudioSource(): Promise<void> {
    console.info('[Sokuji] [ModernBrowserAudio] Disconnecting system audio source');

    // Stop recording first if active
    if (this.systemAudioRecordingActive) {
      await this.stopSystemAudioRecording();
    }

    // Disconnect in the main process
    if (ServiceFactory.isElectron() && window.electron) {
      try {
        await window.electron.invoke('disconnect-system-audio-source');
      } catch (error) {
        console.warn('[Sokuji] [ModernBrowserAudio] Error disconnecting system audio source:', error);
      }
    }

    this.systemAudioSourceConnected = false;
    this.currentSystemAudioSinkId = undefined;
    console.info('[Sokuji] [ModernBrowserAudio] System audio source disconnected');
  }

  /**
   * Check if a system audio source is currently connected
   */
  public isSystemAudioSourceConnected(): boolean {
    return this.systemAudioSourceConnected;
  }

  /**
   * Start recording from the system audio virtual mic
   * Called when session starts
   * @param callback Function to receive audio data chunks
   */
  public async startSystemAudioRecording(callback: AudioRecordingCallback): Promise<void> {
    if (!this.systemAudioSourceConnected) {
      throw new Error('System audio source not connected. Connect a source first.');
    }

    // Stop any existing recording
    if (this.systemAudioRecordingActive) {
      await this.stopSystemAudioRecording();
    }

    try {
      console.info('[Sokuji] [ModernBrowserAudio] Starting system audio recording');

      // Find the browser deviceId for our system audio mic by label
      // The browser uses UUIDs as deviceIds, not PulseAudio source names
      const devices = await navigator.mediaDevices.enumerateDevices();
      const systemAudioDevice = devices.find(
        d => d.kind === 'audioinput' && d.label.includes('Sokuji_System_Audio')
      );

      if (!systemAudioDevice) {
        throw new Error('System audio device not found. Virtual devices may not have been created at startup.');
      }

      console.info(`[Sokuji] [ModernBrowserAudio] Found system audio device: ${systemAudioDevice.label} (${systemAudioDevice.deviceId})`);

      // Create a new recorder for system audio with disabled echo cancellation
      this.systemAudioRecorder = new ModernAudioRecorder({
        sampleRate: 24000,
        enablePassthrough: false // No passthrough for system audio
      });

      // Store the callback
      this.systemAudioCallback = callback;

      // Start recording using the browser's deviceId
      await this.systemAudioRecorder.begin(systemAudioDevice.deviceId);
      await this.systemAudioRecorder.record((data) => {
        if (this.systemAudioCallback) {
          this.systemAudioCallback(data);
        }
      });

      this.systemAudioRecordingActive = true;
      console.info('[Sokuji] [ModernBrowserAudio] System audio recording started successfully');
    } catch (error) {
      console.error('[Sokuji] [ModernBrowserAudio] Failed to start system audio recording:', error);
      // Clean up on failure
      await this.stopSystemAudioRecording();
      throw error;
    }
  }

  /**
   * Stop recording from system audio (but keep connection)
   * Called when session ends
   */
  public async stopSystemAudioRecording(): Promise<void> {
    console.info('[Sokuji] [ModernBrowserAudio] Stopping system audio recording');

    // Stop the system audio recorder
    if (this.systemAudioRecorder) {
      try {
        await this.systemAudioRecorder.end();
      } catch (error) {
        console.warn('[Sokuji] [ModernBrowserAudio] Error ending system audio recorder:', error);
      }
      this.systemAudioRecorder = null;
    }

    this.systemAudioCallback = null;
    this.systemAudioRecordingActive = false;
    console.info('[Sokuji] [ModernBrowserAudio] System audio recording stopped (loopback still active)');
  }

  /**
   * Check if system audio recording is currently active
   */
  public isSystemAudioRecordingActive(): boolean {
    return this.systemAudioRecordingActive;
  }
}