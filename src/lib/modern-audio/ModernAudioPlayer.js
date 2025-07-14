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
    
    // Queue system for sequential playback
    this.trackQueues = new Map(); // Queue system for each trackId
    this.streamingBuffers = new Map(); // Accumulate chunks before queuing
    this.streamingTimeouts = new Map(); // Timeout management
    this.interruptedTracks = new Set(); // Track interrupted trackIds
  }

  /**
   * Initialize the audio player
   */
  async connect() {
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
   * Schedule processing of next queue item
   */
  scheduleNextPlayback(trackId) {
    const checkInterval = setInterval(() => {
      if (!this.isTrackPlaying(trackId)) {
        clearInterval(checkInterval);
        this.processQueue(trackId);
      }
    }, 10);
  }

  /**
   * Play audio buffer
   */
  playAudio(trackId, buffer, volume = 1.0) {
    try {
      // Apply volume if needed
      const processedBuffer = this.applyVolume(buffer, volume);
      
      // Create and play audio
      const wavBlob = this.createWavBlob(processedBuffer);
      const audioUrl = URL.createObjectURL(wavBlob);
      const audio = new Audio(audioUrl);
      
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.crossOrigin = 'anonymous';
      
      // Apply output device if set
      if (this.outputDeviceId && audio.setSinkId) {
        audio.setSinkId(this.outputDeviceId);
      }

      const audioId = ++this.currentAudioId;
      this.audioElements.set(audioId, {
        element: audio,
        url: audioUrl,
        trackId: `${trackId}-stream`,
        startTime: Date.now()
      });

      // Setup event handlers
      audio.onended = () => this.cleanupAudio(audioId);
      audio.onerror = () => this.cleanupAudio(audioId);
      
      // Connect to analyser for visualization
      audio.onplay = () => this.connectToAnalyser(audio);

      audio.play().catch(error => {
        console.error('[ModernAudioPlayer] Playback failed:', error);
        this.cleanupAudio(audioId);
      });

    } catch (error) {
      console.error('[ModernAudioPlayer] Error playing audio:', error);
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
      const source = this.context.createMediaElementSource(audio);
      source.connect(this.analyser);
      source.connect(this.context.destination);
    } catch (error) {
      // Ignore if already connected
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
  getFrequencies(analysisType = 'frequency') {
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
   * Set audio output device
   */
  async setSinkId(deviceId) {
    try {
      // Apply to all current audio elements
      const promises = [];
      for (const [, audioInfo] of this.audioElements) {
        if (audioInfo.element.setSinkId) {
          promises.push(audioInfo.element.setSinkId(deviceId));
        }
      }
      
      await Promise.all(promises);
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
   * Clear timeout for a track
   */
  clearTimeout(trackId) {
    if (this.streamingTimeouts.has(trackId)) {
      clearTimeout(this.streamingTimeouts.get(trackId));
      this.streamingTimeouts.delete(trackId);
    }
  }

  /**
   * Cleanup audio element
   */
  cleanupAudio(audioId) {
    const audioInfo = this.audioElements.get(audioId);
    if (audioInfo) {
      URL.revokeObjectURL(audioInfo.url);
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