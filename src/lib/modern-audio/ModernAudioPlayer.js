/**
 * Modern Audio Player using HTMLAudioElement for echo cancellation compatibility
 * Simplified version focused on chunk queuing and sequential playback
 */
export class ModernAudioPlayer {
  constructor({ sampleRate = 24000 } = {}) {
    this.sampleRate = sampleRate;
    this.context = null;
    this.analyser = null;
    
    // Audio playback management
    this.audioElements = new Map(); // Track active audio elements
    this.currentAudioId = 0;
    this.outputDeviceId = null;
    
    // No pooling - create new audio elements each time to avoid connection issues
    
    // Queue system for sequential playback
    this.trackQueues = new Map(); // Queue system for each trackId
    this.streamingBuffers = new Map(); // Accumulate chunks before queuing
    this.streamingTimeouts = new Map(); // Timeout management
    this.interruptedTracks = new Set(); // Track interrupted trackIds
    
    // Global volume control for monitor on/off
    // Default to 0 (muted) since isMonitorDeviceOn defaults to false in AudioContext
    this.globalVolumeMultiplier = 0.0;
    
    // Device switching state
    this.isSettingDevice = false;
    this.pendingDeviceId = null;
    this.deviceChangePromise = null;
    
    // Store gain nodes for volume control
    this.audioGainNodes = new WeakMap();
    
    // Store source nodes for proper cleanup
    this.audioSourceNodes = new WeakMap();
  }

  /**
   * Initialize the audio player
   */
  async connect() {
    // Make this method idempotent - only create context if it doesn't exist
    if (this.context) {
      console.log('[ModernAudioPlayer] AudioContext already initialized');
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }
      return true;
    }
    
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    // Create analyser for frequency analysis
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0.1;

    return true;
  }

  /**
   * Add streaming audio chunks - core method for queue-based playback
   */
  addStreamingAudio(audioData, trackId = 'default', volume = 1.0) {
    if (this.interruptedTracks.has(trackId)) {
      return new Int16Array(0);
    }

    const buffer = this.normalizeAudioData(audioData);
    this.accumulateChunk(trackId, buffer, volume);
    this.checkAndTriggerPlayback(trackId);
    
    return buffer;
  }

  /**
   * Add complete audio for immediate playback (used by manual play buttons)
   */
  add16BitPCM(audioData, trackId = 'default', volume = 1.0) {
    if (this.interruptedTracks.has(trackId)) {
      return new Int16Array(0);
    }

    const buffer = this.normalizeAudioData(audioData);
    this.queueAudio(trackId, buffer, volume);
    this.processQueue(trackId);
    
    return buffer;
  }

  /**
   * Add audio to passthrough buffer - immediate playback for monitoring
   */
  addToPassthroughBuffer(audioData, volume = 1.0) {
    if (this.globalVolumeMultiplier === 0) {
      return;
    }

    // Use immediate playback for passthrough audio
    const buffer = this.normalizeAudioData(audioData);
    const trackId = 'passthrough';
    
    // Queue and immediately process for low-latency monitoring
    this.queueAudio(trackId, buffer, volume * this.globalVolumeMultiplier);
    this.processQueue(trackId);
  }

  /**
   * Normalize audio data to Int16Array
   */
  normalizeAudioData(audioData) {
    if (audioData instanceof Int16Array) {
      return audioData;
    } else if (audioData instanceof ArrayBuffer) {
      return new Int16Array(audioData);
    } else {
      throw new Error('Audio data must be Int16Array or ArrayBuffer');
    }
  }

  /**
   * Accumulate streaming chunks until buffer is large enough
   */
  accumulateChunk(trackId, buffer, volume) {
    if (!this.streamingBuffers.has(trackId)) {
      this.streamingBuffers.set(trackId, {
        buffer: new Int16Array(0),
        volume: volume
      });
    }

    const streamData = this.streamingBuffers.get(trackId);
    const newBuffer = new Int16Array(streamData.buffer.length + buffer.length);
    newBuffer.set(streamData.buffer, 0);
    newBuffer.set(buffer, streamData.buffer.length);
    streamData.buffer = newBuffer;
  }

  /**
   * Check if accumulated buffer is ready for playback
   */
  checkAndTriggerPlayback(trackId) {
    const streamData = this.streamingBuffers.get(trackId);
    if (!streamData) return;

    const minBufferSize = this.sampleRate * 0.1; // 0.1 seconds
    
    if (streamData.buffer.length >= minBufferSize) {
      this.flushStreamingBuffer(trackId);
    } else {
      this.scheduleFlush(trackId);
    }
  }

  /**
   * Move accumulated buffer to queue and start playback if needed
   */
  flushStreamingBuffer(trackId) {
    const streamData = this.streamingBuffers.get(trackId);
    if (!streamData || streamData.buffer.length === 0) return;

    // Move to queue
    this.queueAudio(trackId, streamData.buffer, streamData.volume);
    
    // Clear streaming buffer
    streamData.buffer = new Int16Array(0);
    this.clearTimeout(trackId);
    
    // Process queue if nothing is playing
    if (!this.isTrackPlaying(trackId)) {
      this.processQueue(trackId);
    }
  }

  /**
   * Schedule flush for remaining data
   */
  scheduleFlush(trackId) {
    if (this.streamingTimeouts.has(trackId)) return; // Already scheduled

    const timeoutId = setTimeout(() => {
      this.flushStreamingBuffer(trackId);
    }, 100);
    
    this.streamingTimeouts.set(trackId, timeoutId);
  }

  /**
   * Add audio to queue
   */
  queueAudio(trackId, buffer, volume) {
    if (!this.trackQueues.has(trackId)) {
      this.trackQueues.set(trackId, []);
    }
    
    this.trackQueues.get(trackId).push({
      buffer: new Int16Array(buffer), // Copy to avoid reference issues
      volume: volume
    });
  }

  /**
   * Process queue for a track
   */
  processQueue(trackId) {
    const queue = this.trackQueues.get(trackId);
    if (!queue || queue.length === 0) return;

    const item = queue.shift();
    this.playAudio(trackId, item.buffer, item.volume);
    
    // Schedule next item
    this.scheduleNextPlayback(trackId);
  }

  /**
   * Schedule processing of next queue item using event-driven approach
   */
  scheduleNextPlayback(trackId) {
    // Use event-driven approach instead of polling
    // The next queue item will be processed when current audio ends
    // This is handled in the audio.onended callback in playAudio()
  }

  /**
   * Create new audio element
   */
  createAudioElement() {
    return new Audio();
  }

  /**
   * Cleanup audio element
   */
  cleanupAudioElement(audio) {
    // Disconnect source node if exists
    const sourceNode = this.audioSourceNodes.get(audio);
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
      this.audioSourceNodes.delete(audio);
    }
    
    // Clean up gain node
    const gainNode = this.audioGainNodes.get(audio);
    if (gainNode) {
      try {
        gainNode.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
      this.audioGainNodes.delete(audio);
    }
    
    // Reset audio element state
    audio.pause();
    audio.currentTime = 0;
    audio.src = '';
    audio.onended = null;
    audio.onerror = null;
    audio.onplay = null;
  }

  /**
   * Play audio buffer
   */
  playAudio(trackId, buffer, volume = 1.0) {
    try {
      // Apply volume if needed
      const processedBuffer = this.applyVolume(buffer, volume);
      
      // Create WAV blob
      const wavBlob = this.createWavBlob(processedBuffer);
      const audioUrl = URL.createObjectURL(wavBlob);
      
      // Create new audio element
      const audio = this.createAudioElement();
      audio.src = audioUrl;
      // Keep audio element volume at max to ensure data flows to analyser
      // Volume control will be done via GainNode in Web Audio API
      audio.volume = volume; // Only apply the track volume, not global multiplier
      audio.crossOrigin = 'anonymous';

      const audioId = ++this.currentAudioId;
      this.audioElements.set(audioId, {
        element: audio,
        url: audioUrl,
        trackId: `${trackId}-stream`,
        startTime: Date.now()
      });

      // Connect to analyser BEFORE playing
      this.connectToAnalyser(audio);
      
      // Note: Output device is set on AudioContext level, not on individual audio elements

      // Setup event handlers with queue processing
      audio.onended = () => {
        this.cleanupAudio(audioId);
        // Process next item in queue when current audio ends
        setTimeout(() => this.processQueue(trackId), 0);
      };
      audio.onerror = () => {
        this.cleanupAudio(audioId);
        // Process next item even on error to prevent queue stalling
        setTimeout(() => this.processQueue(trackId), 0);
      };

      audio.play().catch(error => {
        console.error('[ModernAudioPlayer] Playback failed:', error);
        this.cleanupAudio(audioId);
        // Process next item even on play error to prevent queue stalling
        setTimeout(() => this.processQueue(trackId), 0);
      });

    } catch (error) {
      console.error('[ModernAudioPlayer] Error playing audio:', error);
      // Process next item even on error to prevent queue stalling
      setTimeout(() => this.processQueue(trackId), 0);
    }
  }

  /**
   * Apply volume to buffer
   */
  applyVolume(buffer, volume) {
    if (volume === 1.0) return buffer;
    
    const result = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      result[i] = Math.round(buffer[i] * volume);
    }
    return result;
  }

  /**
   * Connect audio to analyser for visualization
   */
  connectToAnalyser(audio) {
    if (!this.context || !this.analyser) return;
    
    
    try {
      // Create MediaElementSource (can only be done once per audio element)
      const source = this.context.createMediaElementSource(audio);
      
      // Create a gain node for volume control
      const gainNode = this.context.createGain();
      gainNode.gain.value = this.globalVolumeMultiplier;
      
      // Connect: source -> analyser (for visualization)
      //          source -> gainNode -> destination (for playback with volume control)
      source.connect(this.analyser);
      source.connect(gainNode);
      gainNode.connect(this.context.destination);
      
      // Store the nodes for this audio element
      this.audioGainNodes.set(audio, gainNode);
      this.audioSourceNodes.set(audio, source);
      
    } catch (error) {
      // This might happen if the audio element was already connected elsewhere
      console.warn('[ModernAudioPlayer] Could not connect audio to analyser:', error.message);
    }
  }

  /**
   * Check if track is currently playing
   */
  isTrackPlaying(trackId) {
    for (const [, audioInfo] of this.audioElements) {
      if (audioInfo.trackId.startsWith(`${trackId}-stream`)) {
        const audio = audioInfo.element;
        if (!audio.paused && !audio.ended) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Create WAV blob from PCM data
   */
  createWavBlob(pcmData) {
    const arrayBuffer = pcmData.buffer.slice(pcmData.byteOffset, pcmData.byteOffset + pcmData.byteLength);
    const wavHeader = this.createWavHeader(arrayBuffer.byteLength);
    const wavArray = new Uint8Array(44 + arrayBuffer.byteLength);
    
    wavArray.set(wavHeader, 0);
    wavArray.set(new Uint8Array(arrayBuffer), 44);
    
    return new Blob([wavArray], { type: 'audio/wav' });
  }

  /**
   * Create WAV file header
   */
  createWavHeader(dataSize) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = this.sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    
    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, dataSize + 36, true); // file size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"
    
    // fmt chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);
    
    return new Uint8Array(header);
  }

  /**
   * Get frequency data for visualization
   */
  getFrequencies() {
    if (!this.context || !this.analyser) {
      return {
        values: new Float32Array(1024),
        peaks: []
      };
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    
    
    const result = new Float32Array(bufferLength);
    for (let i = 0; i < bufferLength; i++) {
      result[i] = dataArray[i] / 255.0;
    }
    
    return {
      values: result,
      peaks: []
    };
  }

  /**
   * Set global volume multiplier (for monitor on/off)
   * @param {number} volume - Volume from 0 to 1
   */
  setGlobalVolume(volume) {
    this.globalVolumeMultiplier = Math.max(0, Math.min(1, volume));
    
    // Apply to all gain nodes of currently playing audio elements
    for (const [, audioInfo] of this.audioElements) {
      const gainNode = this.audioGainNodes.get(audioInfo.element);
      if (gainNode) {
        // Use setValueAtTime for immediate change without clicks
        gainNode.gain.setValueAtTime(this.globalVolumeMultiplier, this.context.currentTime);
      }
    }
    
    console.log(`[ModernAudioPlayer] Global volume set to: ${this.globalVolumeMultiplier}`);
  }

  /**
   * Set audio output device
   */
  async setSinkId(deviceId) {
    console.log('[ModernAudioPlayer] setSinkId called with:', deviceId, 'current state:', {
      hasContext: !!this.context,
      isSettingDevice: this.isSettingDevice,
      currentDeviceId: this.outputDeviceId
    });
    
    // Check if device is already set
    if (this.outputDeviceId === deviceId) {
      console.log('[ModernAudioPlayer] Device already set to:', deviceId);
      return true;
    }
    
    // If there's an ongoing device change, wait for it if it's the same device
    if (this.deviceChangePromise && this.pendingDeviceId === deviceId) {
      console.log('[ModernAudioPlayer] Waiting for ongoing device change to same device');
      return this.deviceChangePromise;
    }
    
    // Create a new promise for this device change
    this.pendingDeviceId = deviceId;
    this.deviceChangePromise = this._performDeviceChange(deviceId);
    
    try {
      return await this.deviceChangePromise;
    } finally {
      // Clear the promise when done
      if (this.pendingDeviceId === deviceId) {
        this.deviceChangePromise = null;
        this.pendingDeviceId = null;
      }
    }
  }
  
  /**
   * Internal method to perform the actual device change
   */
  async _performDeviceChange(deviceId) {
    // Ensure audio context is initialized
    if (!this.context) {
      console.warn('[ModernAudioPlayer] AudioContext not initialized, initializing now...');
      try {
        await this.connect();
      } catch (error) {
        console.error('[ModernAudioPlayer] Failed to initialize AudioContext:', error);
        return false;
      }
    }
    
    try {
      // Set output device on AudioContext instead of individual audio elements
      if (this.context && this.context.setSinkId) {
        await this.context.setSinkId(deviceId);
        console.log('[ModernAudioPlayer] Successfully set AudioContext output device to:', deviceId);
      } else {
        console.warn('[ModernAudioPlayer] AudioContext.setSinkId not supported in this browser');
      }
      
      this.outputDeviceId = deviceId;
      return true;
    } catch (error) {
      console.error('[ModernAudioPlayer] Failed to set sink ID:', error);
      return false;
    }
  }

  /**
   * Interrupt audio playback
   */
  async interrupt() {
    let latestTrack = null;
    let latestTime = 0;

    for (const [, audioInfo] of this.audioElements) {
      if (audioInfo.startTime > latestTime) {
        latestTime = audioInfo.startTime;
        latestTrack = audioInfo;
      }
    }

    if (!latestTrack) {
      return { trackId: null, offset: 0, currentTime: 0 };
    }

    const audio = latestTrack.element;
    const estimatedOffset = Math.floor(audio.currentTime * this.sampleRate);
    
    // Extract original trackId (remove -stream suffix)
    const originalTrackId = latestTrack.trackId.replace('-stream', '');
    this.interruptedTracks.add(originalTrackId);
    
    audio.pause();

    return {
      trackId: originalTrackId,
      offset: estimatedOffset,
      currentTime: audio.currentTime
    };
  }

  /**
   * Clear streaming data for a track
   */
  clearStreamingTrack(trackId) {
    // Clear streaming buffer
    this.streamingBuffers.delete(trackId);
    
    // Clear timeout
    this.clearTimeout(trackId);
    
    // Clear queue
    this.trackQueues.delete(trackId);
    
    // Remove from interrupted tracks
    this.interruptedTracks.delete(trackId);
  }
  
  /**
   * Clear all interrupted tracks
   */
  clearInterruptedTracks() {
    this.interruptedTracks.clear();
    console.debug('[ModernAudioPlayer] Cleared all interrupted tracks');
  }

  /**
   * Clear timeout for a track
   */
  clearTimeout(trackId) {
    if (this.streamingTimeouts.has(trackId)) {
      clearTimeout(this.streamingTimeouts.get(trackId));
      this.streamingTimeouts.delete(trackId);
    }
  }

  /**

   * Cleanup audio element and resources
   */
  cleanupAudio(audioId) {
    const audioInfo = this.audioElements.get(audioId);
    if (audioInfo) {
      URL.revokeObjectURL(audioInfo.url);
      this.cleanupAudioElement(audioInfo.element);
      this.audioElements.delete(audioId);
    }
  }

  /**
   * Stop all audio playback
   */
  stopAll() {
    for (const [audioId, audioInfo] of this.audioElements) {
      audioInfo.element.pause();
      this.cleanupAudio(audioId);
    }
    this.audioElements.clear();
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopAll();
    
    // Clear all timeouts
    for (const timeoutId of this.streamingTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.streamingTimeouts.clear();
    
    // Clear all data
    this.streamingBuffers.clear();
    this.trackQueues.clear();
    this.interruptedTracks.clear();
    
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(console.error);
    }
  }
}

// Make available globally for compatibility
globalThis.ModernAudioPlayer = ModernAudioPlayer;