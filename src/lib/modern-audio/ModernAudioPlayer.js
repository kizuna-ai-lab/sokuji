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
    
    // Sequence tracking for ordering
    this.lastSequenceNumbers = new Map(); // trackId -> last processed sequence number
    this.outOfOrderBuffers = new Map(); // trackId -> Map of sequence -> buffer data
    this.sequenceGapTimeout = new Map(); // trackId -> timeout for missing sequences
    
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
    
    // Playback status tracking
    this.currentPlayingItemId = null;
    this.onPlaybackStatusChange = null;
    
    // Track cumulative played time for smooth progress across chunks
    this.cumulativePlayedTime = new Map(); // itemId -> total seconds played
    this.lastChunkAudioId = new Map(); // itemId -> last audio element ID to detect chunk transitions // Callback for playback status changes
  }

  /**
   * Initialize the audio player
   */
  async connect() {
    // Make this method idempotent - only create context if it doesn't exist
    if (this.context) {
      console.debug('[ModernAudioPlayer] AudioContext already initialized');
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
   * @param {ArrayBuffer|Int16Array} audioData - Audio data to add
   * @param {string} trackId - Track identifier
   * @param {number} volume - Volume level
   * @param {Object} metadata - Optional metadata (e.g., itemId, sequenceNumber)
   */
  addStreamingAudio(audioData, trackId = 'default', volume = 1.0, metadata = {}) {
    if (this.interruptedTracks.has(trackId)) {
      return new Int16Array(0);
    }

    const buffer = this.normalizeAudioData(audioData);
    
    // Handle sequence ordering if sequence number is provided
    if (metadata.sequenceNumber !== undefined) {
      return this.handleSequencedAudio(buffer, trackId, volume, metadata);
    }
    
    this.accumulateChunk(trackId, buffer, volume, metadata);
    this.checkAndTriggerPlayback(trackId);
    
    return buffer;
  }
  
  /**
   * Handle audio with sequence numbers for proper ordering
   */
  handleSequencedAudio(buffer, trackId, volume, metadata) {
    const sequence = metadata.sequenceNumber;
    const lastSequence = this.lastSequenceNumbers.get(trackId) || 0;
    
    console.log('[AudioSequence] Processing chunk:', {
      trackId,
      sequence,
      lastSequence,
      isInOrder: sequence === lastSequence + 1,
      bufferSize: buffer.length
    });
    
    // If this is the next expected sequence, process immediately
    if (sequence === lastSequence + 1) {
      this.lastSequenceNumbers.set(trackId, sequence);
      this.accumulateChunk(trackId, buffer, volume, metadata);
      this.checkAndTriggerPlayback(trackId);
      
      // Check if we can now process any buffered out-of-order chunks
      this.processBufferedSequences(trackId, volume);
      
      return buffer;
    }
    
    // If this is out of order, buffer it
    if (sequence > lastSequence + 1) {
      console.warn('[AudioSequence] Out of order chunk detected:', {
        trackId,
        sequence,
        expected: lastSequence + 1,
        gap: sequence - lastSequence - 1
      });
      
      // Store out-of-order buffer
      if (!this.outOfOrderBuffers.has(trackId)) {
        this.outOfOrderBuffers.set(trackId, new Map());
      }
      this.outOfOrderBuffers.get(trackId).set(sequence, { buffer, volume, metadata });
      
      // Set timeout to process anyway if gap isn't filled
      this.setSequenceGapTimeout(trackId, volume);
      
      return buffer;
    }
    
    // If this is a duplicate or old sequence, skip it
    console.warn('[AudioSequence] Duplicate or old sequence, skipping:', {
      trackId,
      sequence,
      lastSequence
    });
    
    return buffer;
  }
  
  /**
   * Process any buffered sequences that are now in order
   */
  processBufferedSequences(trackId, volume) {
    const outOfOrderMap = this.outOfOrderBuffers.get(trackId);
    if (!outOfOrderMap || outOfOrderMap.size === 0) return;
    
    let lastSequence = this.lastSequenceNumbers.get(trackId) || 0;
    let processed = [];
    
    // Process sequences in order
    while (outOfOrderMap.has(lastSequence + 1)) {
      const nextSequence = lastSequence + 1;
      const { buffer, volume: origVolume, metadata } = outOfOrderMap.get(nextSequence);
      
      console.log('[AudioSequence] Processing buffered sequence:', nextSequence);
      
      this.accumulateChunk(trackId, buffer, origVolume || volume, metadata);
      this.checkAndTriggerPlayback(trackId);
      
      outOfOrderMap.delete(nextSequence);
      processed.push(nextSequence);
      lastSequence = nextSequence;
    }
    
    if (processed.length > 0) {
      this.lastSequenceNumbers.set(trackId, lastSequence);
      console.log('[AudioSequence] Processed buffered sequences:', processed);
    }
  }
  
  /**
   * Set timeout to process buffered audio even if gap isn't filled
   */
  setSequenceGapTimeout(trackId, volume) {
    // Clear existing timeout
    if (this.sequenceGapTimeout.has(trackId)) {
      clearTimeout(this.sequenceGapTimeout.get(trackId));
    }
    
    // Set new timeout - wait 100ms for missing sequences
    const timeoutId = setTimeout(() => {
      console.warn('[AudioSequence] Gap timeout reached, processing buffered audio anyway');
      this.forceProcessBufferedSequences(trackId, volume);
    }, 100);
    
    this.sequenceGapTimeout.set(trackId, timeoutId);
  }
  
  /**
   * Force process buffered sequences even with gaps
   */
  forceProcessBufferedSequences(trackId, volume) {
    const outOfOrderMap = this.outOfOrderBuffers.get(trackId);
    if (!outOfOrderMap || outOfOrderMap.size === 0) return;
    
    // Get all sequences and sort them
    const sequences = Array.from(outOfOrderMap.keys()).sort((a, b) => a - b);
    
    console.warn('[AudioSequence] Force processing sequences with gaps:', sequences);
    
    for (const sequence of sequences) {
      const { buffer, volume: origVolume, metadata } = outOfOrderMap.get(sequence);
      this.accumulateChunk(trackId, buffer, origVolume || volume, metadata);
      this.checkAndTriggerPlayback(trackId);
      outOfOrderMap.delete(sequence);
    }
    
    // Update last sequence to highest processed
    if (sequences.length > 0) {
      this.lastSequenceNumbers.set(trackId, sequences[sequences.length - 1]);
    }
  }

  /**
   * Add complete audio for immediate playback (used by manual play buttons)
   * @param {ArrayBuffer|Int16Array} audioData - Audio data to add
   * @param {string} trackId - Track identifier
   * @param {number} volume - Volume level
   * @param {Object} metadata - Optional metadata (e.g., itemId)
   */
  add16BitPCM(audioData, trackId = 'default', volume = 1.0, metadata = {}) {
    if (this.interruptedTracks.has(trackId)) {
      return new Int16Array(0);
    }

    const buffer = this.normalizeAudioData(audioData);
    this.queueAudio(trackId, buffer, volume, metadata);
    this.processQueue(trackId);
    
    return buffer;
  }

  /**
   * Add audio to passthrough buffer - with optional delay for echo cancellation
   */
  addToPassthroughBuffer(audioData, volume = 1.0, delay = 50) {
    // Performance: Early return if muted
    if (this.globalVolumeMultiplier === 0) {
      return;
    }
    
    const trackId = 'passthrough';
    const effectiveVolume = volume * this.globalVolumeMultiplier;
    
    // Performance: Skip processing if effective volume is too low
    if (effectiveVolume < 0.01) {
      return;
    }
    
    const buffer = this.normalizeAudioData(audioData);
    
    if (delay > 0) {
      // Delayed playback for echo cancellation safety
      setTimeout(() => {
        // Check again in case volume was muted during delay
        if (this.globalVolumeMultiplier > 0) {
          this.queueAudio(trackId, buffer, effectiveVolume);
          this.processQueue(trackId);
        }
      }, delay);
    } else {
      // Immediate playback
      this.queueAudio(trackId, buffer, effectiveVolume);
      this.processQueue(trackId);
    }
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
  accumulateChunk(trackId, buffer, volume, metadata = {}) {
    if (!this.streamingBuffers.has(trackId)) {
      this.streamingBuffers.set(trackId, {
        buffer: new Int16Array(0),
        volume: volume,
        chunks: [], // Performance: Store chunks separately to avoid constant reallocation
        metadata: metadata // Store metadata for this stream
      });
    }

    const streamData = this.streamingBuffers.get(trackId);
    
    // Performance optimization: Store chunks separately instead of concatenating
    streamData.chunks = streamData.chunks || [];
    streamData.chunks.push(buffer);
    
    // Update metadata if provided
    if (metadata.itemId) {
      streamData.metadata = metadata;
    }
    
    // Calculate total length for threshold checking
    const totalLength = streamData.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    streamData.totalLength = totalLength;
  }

  /**
   * Check if accumulated buffer is ready for playback
   */
  checkAndTriggerPlayback(trackId) {
    const streamData = this.streamingBuffers.get(trackId);
    if (!streamData) return;

    const minBufferSize = this.sampleRate * 0.02; // Reduced to 0.02 seconds (20ms) for faster response
    const totalLength = streamData.totalLength || 0;
    
    if (totalLength >= minBufferSize) {
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
    if (!streamData || (!streamData.chunks || streamData.chunks.length === 0)) return;

    // Performance: Combine chunks efficiently
    const chunks = streamData.chunks || [];
    if (chunks.length > 0) {
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedBuffer = new Int16Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        combinedBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Move to queue with metadata
      this.queueAudio(trackId, combinedBuffer, streamData.volume, streamData.metadata);
      
      // Clear streaming buffer
      streamData.chunks = [];
      streamData.totalLength = 0;
      // Keep metadata for next chunks of the same stream
      // streamData.metadata is preserved
    }
    
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
    }, 20); // Reduced to 20ms for faster flushing
    
    this.streamingTimeouts.set(trackId, timeoutId);
  }

  /**
   * Add audio to queue with metadata
   */
  queueAudio(trackId, buffer, volume, metadata = {}) {
    if (!this.trackQueues.has(trackId)) {
      this.trackQueues.set(trackId, []);
    }
    
    // Performance optimization: Only copy if necessary (when buffer might be reused)
    // In most cases, the buffer is not reused, so we can avoid the copy
    const isSharedBuffer = buffer.buffer && buffer.buffer.byteLength > buffer.byteLength;
    
    this.trackQueues.get(trackId).push({
      buffer: isSharedBuffer ? new Int16Array(buffer) : buffer,
      volume: volume,
      metadata: metadata // Store metadata with queue item
    });
  }

  /**
   * Process queue for a track
   */
  processQueue(trackId) {
    const queue = this.trackQueues.get(trackId);
    if (!queue || queue.length === 0) return;

    const item = queue.shift();
    this.playAudio(trackId, item.buffer, item.volume, item.metadata);
    
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
   * Play audio buffer with metadata tracking
   */
  playAudio(trackId, buffer, volume = 1.0, metadata = {}) {
    try {
      // Update current playing item ID
      if (metadata.itemId) {
        // If this is a different item, reset cumulative time
        if (this.currentPlayingItemId !== metadata.itemId) {
          this.cumulativePlayedTime.delete(this.currentPlayingItemId);
          this.lastChunkAudioId.delete(this.currentPlayingItemId);
          // Initialize for new item
          this.cumulativePlayedTime.set(metadata.itemId, 0);
        }
        
        this.currentPlayingItemId = metadata.itemId;
        // Notify status change
        if (this.onPlaybackStatusChange) {
          this.onPlaybackStatusChange({
            itemId: metadata.itemId,
            status: 'playing',
            trackId: trackId
          });
        }
      }
      
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
        startTime: Date.now(),
        metadata: metadata // Store metadata with audio element
      });

      // Connect to analyser BEFORE playing
      this.connectToAnalyser(audio);
      
      // Note: Output device is set on AudioContext level, not on individual audio elements

      // Setup event handlers with queue processing
      audio.onended = () => {
        // Track cumulative played time for this chunk
        if (metadata.itemId) {
          const currentCumulative = this.cumulativePlayedTime.get(metadata.itemId) || 0;
          const chunkDuration = audio.duration || 0;
          this.cumulativePlayedTime.set(metadata.itemId, currentCumulative + chunkDuration);
        }
        
        // Check if this was the last item for this itemId
        const queue = this.trackQueues.get(trackId);
        const hasMoreForItem = queue && queue.some(item => 
          item.metadata && item.metadata.itemId === metadata.itemId
        );
        
        if (!hasMoreForItem && metadata.itemId === this.currentPlayingItemId) {
          // This was the last chunk for this item - clear cumulative time
          this.cumulativePlayedTime.delete(metadata.itemId);
          this.lastChunkAudioId.delete(metadata.itemId);
          
          if (this.onPlaybackStatusChange) {
            this.onPlaybackStatusChange({
              itemId: metadata.itemId,
              status: 'ended',
              trackId: trackId
            });
          }
          this.currentPlayingItemId = null;
        }
        
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
    
    console.debug(`[ModernAudioPlayer] Global volume set to: ${this.globalVolumeMultiplier}`);
  }

  /**
   * Set audio output device
   */
  async setSinkId(deviceId) {
    console.debug('[ModernAudioPlayer] setSinkId called with:', deviceId, 'current state:', {
      hasContext: !!this.context,
      isSettingDevice: this.isSettingDevice,
      currentDeviceId: this.outputDeviceId
    });
    
    // Check if device is already set
    if (this.outputDeviceId === deviceId) {
      console.debug('[ModernAudioPlayer] Device already set to:', deviceId);
      return true;
    }
    
    // If there's an ongoing device change, wait for it if it's the same device
    if (this.deviceChangePromise && this.pendingDeviceId === deviceId) {
      console.debug('[ModernAudioPlayer] Waiting for ongoing device change to same device');
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
        console.info('[ModernAudioPlayer] Successfully set AudioContext output device to:', deviceId);
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
    
    // Clear sequence tracking
    this.lastSequenceNumbers.delete(trackId);
    this.outOfOrderBuffers.delete(trackId);
    if (this.sequenceGapTimeout.has(trackId)) {
      clearTimeout(this.sequenceGapTimeout.get(trackId));
      this.sequenceGapTimeout.delete(trackId);
    }
  }
  
  /**
   * Set playback status callback
   */
  setPlaybackStatusCallback(callback) {
    this.onPlaybackStatusChange = callback;
  }
  
  /**
   * Get current playback status
   */
  getCurrentPlaybackStatus() {
    if (!this.currentPlayingItemId) return null;
    
    // Find the currently playing audio element
    let currentAudio = null;
    let currentAudioInfo = null;
    let currentAudioId = null;
    
    for (const [audioId, audioInfo] of this.audioElements) {
      if (audioInfo.metadata && audioInfo.metadata.itemId === this.currentPlayingItemId) {
        const audio = audioInfo.element;
        if (!audio.paused && !audio.ended) {
          currentAudio = audio;
          currentAudioInfo = audioInfo;
          currentAudioId = audioId;
          break;
        }
      }
    }
    
    if (!currentAudio) return null;
    
    // Get cumulative played time for smooth progress
    const cumulativeTime = this.cumulativePlayedTime.get(this.currentPlayingItemId) || 0;
    
    // Check if we've moved to a new chunk
    const lastAudioId = this.lastChunkAudioId.get(this.currentPlayingItemId);
    this.lastChunkAudioId.set(this.currentPlayingItemId, currentAudioId);
    
    // Calculate total progress: cumulative time + current chunk progress
    const totalBufferedTime = this.getBufferedDuration(this.currentPlayingItemId);
    const totalCurrentTime = cumulativeTime + currentAudio.currentTime;
    
    // For display, use the total buffered time as duration
    const effectiveDuration = totalBufferedTime > 0 ? totalBufferedTime : currentAudio.duration;
    
    const status = {
      itemId: this.currentPlayingItemId,
      trackId: currentAudioInfo.trackId.replace('-stream', ''),
      currentTime: totalCurrentTime,
      duration: effectiveDuration,
      isPlaying: !currentAudio.paused && !currentAudio.ended,
      bufferedTime: totalBufferedTime
    };
    
    return status;
  }
  
  /**
   * Get buffered duration for an item
   */
  getBufferedDuration(itemId) {
    let totalDuration = 0;
    let queueCount = 0;
    let streamCount = 0;
    
    // Check all queues for items with this itemId
    for (const [trackId, queue] of this.trackQueues) {
      for (const item of queue) {
        if (item.metadata && item.metadata.itemId === itemId) {
          // Estimate duration: samples / sample rate
          totalDuration += item.buffer.length / this.sampleRate;
          queueCount++;
        }
      }
    }
    
    // Also check streaming buffers
    for (const [trackId, streamData] of this.streamingBuffers) {
      if (streamData.metadata && streamData.metadata.itemId === itemId) {
        const totalLength = streamData.totalLength || 0;
        streamCount++;
        totalDuration += totalLength / this.sampleRate;
      }
    }
    
    return totalDuration;
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
   * Get diagnostic information for audio sequencing
   */
  getSequenceDiagnostics() {
    const diagnostics = {
      tracks: {},
      outOfOrderCount: 0,
      totalBuffered: 0,
      gaps: []
    };
    
    for (const [trackId, lastSeq] of this.lastSequenceNumbers) {
      const outOfOrder = this.outOfOrderBuffers.get(trackId);
      const outOfOrderSeqs = outOfOrder ? Array.from(outOfOrder.keys()).sort((a, b) => a - b) : [];
      
      diagnostics.tracks[trackId] = {
        lastSequence: lastSeq,
        outOfOrderSequences: outOfOrderSeqs,
        gaps: this.findSequenceGaps(lastSeq, outOfOrderSeqs),
        queueLength: this.trackQueues.get(trackId)?.length || 0
      };
      
      diagnostics.outOfOrderCount += outOfOrderSeqs.length;
      
      if (diagnostics.tracks[trackId].gaps.length > 0) {
        diagnostics.gaps.push(...diagnostics.tracks[trackId].gaps.map(g => ({
          trackId,
          ...g
        })));
      }
    }
    
    return diagnostics;
  }
  
  /**
   * Find gaps in sequence numbers
   */
  findSequenceGaps(lastSeq, outOfOrderSeqs) {
    const gaps = [];
    
    if (outOfOrderSeqs.length === 0) return gaps;
    
    // Check gap between last processed and first buffered
    if (outOfOrderSeqs[0] > lastSeq + 1) {
      gaps.push({
        from: lastSeq + 1,
        to: outOfOrderSeqs[0] - 1,
        size: outOfOrderSeqs[0] - lastSeq - 1
      });
    }
    
    // Check gaps between buffered sequences
    for (let i = 1; i < outOfOrderSeqs.length; i++) {
      if (outOfOrderSeqs[i] > outOfOrderSeqs[i - 1] + 1) {
        gaps.push({
          from: outOfOrderSeqs[i - 1] + 1,
          to: outOfOrderSeqs[i] - 1,
          size: outOfOrderSeqs[i] - outOfOrderSeqs[i - 1] - 1
        });
      }
    }
    
    return gaps;
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
    
    // Clear sequence gap timeouts
    for (const timeoutId of this.sequenceGapTimeout.values()) {
      clearTimeout(timeoutId);
    }
    this.sequenceGapTimeout.clear();
    
    // Clear all data
    this.streamingBuffers.clear();
    this.trackQueues.clear();
    this.interruptedTracks.clear();
    this.lastSequenceNumbers.clear();
    this.outOfOrderBuffers.clear();
    
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(console.error);
    }
  }
}

// Make available globally for compatibility
globalThis.ModernAudioPlayer = ModernAudioPlayer;