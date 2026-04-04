/**
 * Modern Audio Player using AudioWorklet ring buffer for gapless playback.
 * Output routes through a single persistent HTMLAudioElement for AEC compatibility.
 *
 * Architecture:
 *   PCM chunks → postMessage → AudioWorkletNode (ring buffer)
 *     → GainNode → AnalyserNode → MediaStreamDestinationNode
 *       → HTMLAudioElement.srcObject → Speakers (AEC-visible)
 */
export class ModernAudioPlayer {
  constructor({ sampleRate = 24000 } = {}) {
    this.sampleRate = sampleRate;

    // AudioContext graph nodes (initialized in connect())
    this.context = null;
    this.workletNode = null;
    this.gainNode = null;
    this.analyser = null;
    this.destinationNode = null;
    this.audioElement = null;

    // Output device
    this.outputDeviceId = null;
    this.isSettingDevice = false;
    this.pendingDeviceId = null;
    this.deviceChangePromise = null;

    // Streaming buffer accumulation (same as before)
    this.streamingBuffers = new Map();
    this.streamingTimeouts = new Map();
    this.trackQueues = new Map();
    this.interruptedTracks = new Set();

    // Sequence tracking for ordering (same as before)
    this.lastSequenceNumbers = new Map();
    this.outOfOrderBuffers = new Map();
    this.sequenceGapTimeout = new Map();

    // Global volume control (default muted — monitor off)
    this.globalVolumeMultiplier = 0.0;

    // Playback status tracking
    this.currentPlayingItemId = null;
    this.onPlaybackStatusChange = null;
    this.totalBufferedDuration = new Map(); // itemId -> total seconds buffered
    this.totalPlayedSamples = 0; // from worklet readPosition reports
    this.itemStartSample = 0; // sample count when current item started
    this.itemEndTimeout = null;

    // Worklet state
    this._workletReady = false;
    this._workletState = 'stopped'; // 'stopped' | 'playing' | 'starving'

    // Send queue for drip-feeding large audio into the ring buffer.
    // The worklet ring buffer is 2s; writes larger than ~1s are chunked
    // and fed gradually so nothing is dropped.
    this._sendQueue = []; // Array of Float32Array chunks
    this._drainTimer = null;
    this._totalSentSamples = 0; // samples posted to worklet
    this._ringBufferCapacity = this.sampleRate * 2; // must match worklet
  }

  /**
   * Initialize the audio player — creates AudioContext, loads worklet, builds audio graph.
   */
  async connect() {
    if (this.context) {
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }
      return true;
    }

    this.context = new AudioContext({ sampleRate: this.sampleRate });
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    // Load worklet
    const workletUrl = new URL('./worklets/playback-ring-processor.js', import.meta.url).href;
    await this.context.audioWorklet.addModule(workletUrl);
    this.workletNode = new AudioWorkletNode(this.context, 'playback-ring-processor');
    this._workletReady = true;

    // Listen for worklet messages
    this.workletNode.port.onmessage = (e) => this._handleWorkletMessage(e.data);

    // Build audio graph
    this.gainNode = this.context.createGain();
    this.gainNode.gain.setValueAtTime(this.globalVolumeMultiplier, this.context.currentTime);

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0.1;

    this.destinationNode = this.context.createMediaStreamDestination();

    // Connect: worklet → gain → analyser → mediaStreamDestination
    this.workletNode.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.destinationNode);

    // Single persistent HTMLAudioElement for AEC-visible output
    this.audioElement = new Audio();
    this.audioElement.srcObject = this.destinationNode.stream;

    // Apply output device if previously set
    if (this.outputDeviceId && typeof this.audioElement.setSinkId === 'function') {
      try {
        await this.audioElement.setSinkId(this.outputDeviceId);
      } catch (e) {
        console.warn('[ModernAudioPlayer] Failed to set initial output device:', e.message);
      }
    }

    await this.audioElement.play().catch((e) => {
      console.warn('[ModernAudioPlayer] Initial play() blocked (will retry on user gesture):', e.message);
    });

    return true;
  }

  /**
   * Handle messages from the playback ring worklet.
   */
  _handleWorkletMessage(msg) {
    if (msg.type === 'stateChange') {
      const prevState = this._workletState;
      this._workletState = msg.state;

      if (msg.state === 'playing' && prevState !== 'playing') {
        this._cancelEndNotification();
        if (this.currentPlayingItemId && this.onPlaybackStatusChange) {
          this.onPlaybackStatusChange({
            itemId: this.currentPlayingItemId,
            status: 'playing',
            trackId: ''
          });
        }
      } else if (msg.state === 'starving' && prevState === 'playing') {
        if (this.currentPlayingItemId) {
          this._scheduleEndNotification(this.currentPlayingItemId);
        }
      }
    } else if (msg.type === 'readPosition') {
      this.totalPlayedSamples = msg.samplesPlayed;
    }
  }

  // =========================================================================
  // Streaming Input
  // =========================================================================

  /**
   * Add streaming audio chunks — core method for queue-based playback.
   * @param {ArrayBuffer|Int16Array} audioData - Audio data to add
   * @param {string} trackId - Track identifier
   * @param {number} volume - Volume level (0-1) applied to PCM before ring buffer
   * @param {Object} metadata - Optional metadata (e.g., itemId, sequenceNumber)
   */
  addStreamingAudio(audioData, trackId = 'default', volume = 1.0, metadata = {}) {
    if (this.interruptedTracks.has(trackId)) {
      return new Int16Array(0);
    }

    const buffer = this._normalizeAudioData(audioData);

    if (metadata.sequenceNumber !== undefined) {
      return this._handleSequencedAudio(buffer, trackId, volume, metadata);
    }

    this._accumulateChunk(trackId, buffer, volume, metadata);
    this._checkAndTriggerPlayback(trackId);

    return buffer;
  }

  /**
   * Add complete audio for immediate playback (used by manual play buttons).
   */
  add16BitPCM(audioData, trackId = 'default', volume = 1.0, metadata = {}) {
    if (this.interruptedTracks.has(trackId)) {
      return new Int16Array(0);
    }

    const buffer = this._normalizeAudioData(audioData);
    this._writeToRingBuffer(buffer, volume, metadata);
    return buffer;
  }

  /**
   * Add audio to passthrough buffer — with optional delay for echo cancellation.
   */
  addToPassthroughBuffer(audioData, volume = 1.0, delay = 50) {
    if (this.globalVolumeMultiplier === 0) return;

    const effectiveVolume = volume * this.globalVolumeMultiplier;
    if (effectiveVolume < 0.01) return;

    const buffer = this._normalizeAudioData(audioData);

    if (delay > 0) {
      setTimeout(() => {
        if (this.globalVolumeMultiplier > 0) {
          this._writeToRingBuffer(buffer, effectiveVolume, {});
        }
      }, delay);
    } else {
      this._writeToRingBuffer(buffer, effectiveVolume, {});
    }
  }

  // =========================================================================
  // Sequence Ordering (unchanged logic, private methods)
  // =========================================================================

  _handleSequencedAudio(buffer, trackId, volume, metadata) {
    const sequence = metadata.sequenceNumber;
    const lastSequence = this.lastSequenceNumbers.get(trackId) || 0;

    if (sequence === lastSequence + 1) {
      this.lastSequenceNumbers.set(trackId, sequence);
      this._accumulateChunk(trackId, buffer, volume, metadata);
      this._checkAndTriggerPlayback(trackId);
      this._processBufferedSequences(trackId, volume);
      return buffer;
    }

    if (sequence > lastSequence + 1) {
      if (!this.outOfOrderBuffers.has(trackId)) {
        this.outOfOrderBuffers.set(trackId, new Map());
      }
      this.outOfOrderBuffers.get(trackId).set(sequence, { buffer, volume, metadata });
      this._setSequenceGapTimeout(trackId, volume);
      return buffer;
    }

    // Duplicate or old sequence — skip
    return buffer;
  }

  _processBufferedSequences(trackId, volume) {
    const outOfOrderMap = this.outOfOrderBuffers.get(trackId);
    if (!outOfOrderMap || outOfOrderMap.size === 0) return;

    let lastSequence = this.lastSequenceNumbers.get(trackId) || 0;

    while (outOfOrderMap.has(lastSequence + 1)) {
      const nextSequence = lastSequence + 1;
      const { buffer, volume: origVolume, metadata } = outOfOrderMap.get(nextSequence);
      this._accumulateChunk(trackId, buffer, origVolume || volume, metadata);
      this._checkAndTriggerPlayback(trackId);
      outOfOrderMap.delete(nextSequence);
      lastSequence = nextSequence;
    }

    this.lastSequenceNumbers.set(trackId, lastSequence);
  }

  _setSequenceGapTimeout(trackId, volume) {
    if (this.sequenceGapTimeout.has(trackId)) {
      clearTimeout(this.sequenceGapTimeout.get(trackId));
    }

    const timeoutId = setTimeout(() => {
      this._forceProcessBufferedSequences(trackId, volume);
    }, 100);

    this.sequenceGapTimeout.set(trackId, timeoutId);
  }

  _forceProcessBufferedSequences(trackId, volume) {
    const outOfOrderMap = this.outOfOrderBuffers.get(trackId);
    if (!outOfOrderMap || outOfOrderMap.size === 0) return;

    const sequences = Array.from(outOfOrderMap.keys()).sort((a, b) => a - b);

    for (const sequence of sequences) {
      const { buffer, volume: origVolume, metadata } = outOfOrderMap.get(sequence);
      this._accumulateChunk(trackId, buffer, origVolume || volume, metadata);
      this._checkAndTriggerPlayback(trackId);
      outOfOrderMap.delete(sequence);
    }

    if (sequences.length > 0) {
      this.lastSequenceNumbers.set(trackId, sequences[sequences.length - 1]);
    }
  }

  // =========================================================================
  // Chunk Accumulation & Ring Buffer Write
  // =========================================================================

  _accumulateChunk(trackId, buffer, volume, metadata = {}) {
    if (!this.streamingBuffers.has(trackId)) {
      this.streamingBuffers.set(trackId, {
        volume,
        chunks: [],
        totalLength: 0,
        metadata
      });
    }

    const streamData = this.streamingBuffers.get(trackId);
    streamData.chunks.push(buffer);
    streamData.totalLength += buffer.length;

    if (metadata.itemId) {
      streamData.metadata = metadata;
    }
  }

  _checkAndTriggerPlayback(trackId) {
    const streamData = this.streamingBuffers.get(trackId);
    if (!streamData) return;

    const minBufferSize = this.sampleRate * 0.02; // 20ms

    if (streamData.totalLength >= minBufferSize) {
      this._flushStreamingBuffer(trackId);
    } else {
      this._scheduleFlush(trackId);
    }
  }

  _flushStreamingBuffer(trackId) {
    const streamData = this.streamingBuffers.get(trackId);
    if (!streamData || streamData.chunks.length === 0) return;

    // Combine chunks into single Int16Array
    const combined = new Int16Array(streamData.totalLength);
    let offset = 0;
    for (const chunk of streamData.chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Write to ring buffer
    this._writeToRingBuffer(combined, streamData.volume, streamData.metadata);

    // Reset accumulator (keep metadata for next chunks of same stream)
    streamData.chunks = [];
    streamData.totalLength = 0;

    this._clearStreamingTimeout(trackId);
  }

  _scheduleFlush(trackId) {
    if (this.streamingTimeouts.has(trackId)) return;

    const timeoutId = setTimeout(() => {
      this.streamingTimeouts.delete(trackId);
      this._flushStreamingBuffer(trackId);
    }, 20);

    this.streamingTimeouts.set(trackId, timeoutId);
  }

  /**
   * Convert Int16 PCM to Float32, apply per-track volume, and enqueue for worklet.
   * Small writes (≤1s) are posted directly; larger writes are drip-fed via _sendQueue
   * to avoid overflowing the worklet's 2-second ring buffer.
   */
  _writeToRingBuffer(int16Buffer, volume, metadata) {
    if (!this._workletReady || !this.workletNode) return;

    // Track item and buffered duration
    if (metadata && metadata.itemId) {
      if (this.currentPlayingItemId !== metadata.itemId) {
        // New item — clean up old state
        if (this.currentPlayingItemId !== null) {
          this.totalBufferedDuration.delete(this.currentPlayingItemId);
        }
        this.currentPlayingItemId = metadata.itemId;
        this.totalBufferedDuration.set(metadata.itemId, 0);
        this.itemStartSample = this.totalPlayedSamples;
      }

      const bufferDuration = int16Buffer.length / this.sampleRate;
      const prev = this.totalBufferedDuration.get(metadata.itemId) || 0;
      this.totalBufferedDuration.set(metadata.itemId, prev + bufferDuration);
    }

    // Convert Int16 → Float32 with volume
    const float32 = new Float32Array(int16Buffer.length);
    const scale = (volume !== 1.0) ? volume / 32768 : 1 / 32768;
    for (let i = 0; i < int16Buffer.length; i++) {
      float32[i] = int16Buffer[i] * scale;
    }

    // Fast path: small writes go directly to worklet (covers streaming case)
    const maxDirectWrite = this.sampleRate; // 1 second
    if (float32.length <= maxDirectWrite && this._sendQueue.length === 0) {
      this._postToWorklet(float32);
      return;
    }

    // Large write or queue already active: chunk into ~0.5s pieces and drip-feed
    const chunkSize = Math.floor(this.sampleRate * 0.5); // 0.5 second chunks
    for (let offset = 0; offset < float32.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, float32.length);
      this._sendQueue.push(float32.slice(offset, end));
    }

    this._startDraining();
  }

  /**
   * Post a Float32Array to the worklet ring buffer (zero-copy via transfer).
   */
  _postToWorklet(float32) {
    if (!this.workletNode) return;
    this._totalSentSamples += float32.length;
    this.workletNode.port.postMessage(
      { type: 'write', samples: float32 },
      [float32.buffer]
    );
  }

  /**
   * Start the drain timer that feeds queued audio to the worklet.
   */
  _startDraining() {
    if (this._drainTimer !== null) return;
    // Drain immediately, then every 100ms
    this._drainQueue();
    this._drainTimer = setInterval(() => this._drainQueue(), 100);
  }

  /**
   * Feed the next chunk from _sendQueue to the worklet, if there's room.
   */
  _drainQueue() {
    if (this._sendQueue.length === 0) {
      if (this._drainTimer !== null) {
        clearInterval(this._drainTimer);
        this._drainTimer = null;
      }
      return;
    }

    // Estimate how much audio is currently buffered in the worklet ring buffer
    const bufferedInWorklet = this._totalSentSamples - this.totalPlayedSamples;
    const headroom = this._ringBufferCapacity - bufferedInWorklet;

    // Only send if there's at least 0.25s of headroom
    const minHeadroom = Math.floor(this.sampleRate * 0.25);
    if (headroom < minHeadroom) return;

    // Send the next chunk
    const chunk = this._sendQueue.shift();
    this._postToWorklet(chunk);
  }

  /**
   * Clear the send queue (used on stop/interrupt).
   */
  _clearSendQueue() {
    this._sendQueue.length = 0;
    if (this._drainTimer !== null) {
      clearInterval(this._drainTimer);
      this._drainTimer = null;
    }
  }

  _normalizeAudioData(audioData) {
    if (audioData instanceof Int16Array) return audioData;
    if (audioData instanceof ArrayBuffer) return new Int16Array(audioData);
    throw new Error('Audio data must be Int16Array or ArrayBuffer');
  }

  _clearStreamingTimeout(trackId) {
    if (this.streamingTimeouts.has(trackId)) {
      clearTimeout(this.streamingTimeouts.get(trackId));
      this.streamingTimeouts.delete(trackId);
    }
  }

  // =========================================================================
  // Volume Control
  // =========================================================================

  /**
   * Set global volume multiplier (for monitor on/off).
   * @param {number} volume - Volume from 0 to 1
   */
  setGlobalVolume(volume) {
    this.globalVolumeMultiplier = Math.max(0, Math.min(1, volume));

    if (this.gainNode && this.context) {
      this.gainNode.gain.setValueAtTime(this.globalVolumeMultiplier, this.context.currentTime);
    }
  }

  // =========================================================================
  // Output Device Switching
  // =========================================================================

  /**
   * Set audio output device.
   */
  async setSinkId(deviceId) {
    if (this.outputDeviceId === deviceId) return true;

    if (this.deviceChangePromise && this.pendingDeviceId === deviceId) {
      return this.deviceChangePromise;
    }

    this.pendingDeviceId = deviceId;
    this.deviceChangePromise = this._performDeviceChange(deviceId);

    try {
      return await this.deviceChangePromise;
    } finally {
      if (this.pendingDeviceId === deviceId) {
        this.deviceChangePromise = null;
        this.pendingDeviceId = null;
      }
    }
  }

  async _performDeviceChange(deviceId) {
    if (!this.context) {
      try {
        await this.connect();
      } catch (error) {
        console.error('[ModernAudioPlayer] Failed to initialize AudioContext:', error);
        return false;
      }
    }

    try {
      // Set on HTMLAudioElement (preferred — routes through OS audio path for AEC)
      if (this.audioElement && typeof this.audioElement.setSinkId === 'function') {
        await this.audioElement.setSinkId(deviceId);
      }
      // Also set on AudioContext if supported (for future-proofing)
      if (this.context && typeof this.context.setSinkId === 'function') {
        await this.context.setSinkId(deviceId).catch(() => {
          // AudioContext.setSinkId may not be available everywhere
        });
      }

      this.outputDeviceId = deviceId;
      return true;
    } catch (error) {
      console.error('[ModernAudioPlayer] Failed to set sink ID:', error);
      return false;
    }
  }

  // =========================================================================
  // Visualization
  // =========================================================================

  /**
   * Get frequency data for visualization.
   */
  getFrequencies() {
    if (!this.context || !this.analyser) {
      return { values: new Float32Array(1024), peaks: [] };
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const result = new Float32Array(bufferLength);
    for (let i = 0; i < bufferLength; i++) {
      result[i] = dataArray[i] / 255.0;
    }

    return { values: result, peaks: [] };
  }

  // =========================================================================
  // Playback Status Tracking
  // =========================================================================

  /**
   * Set playback status callback.
   */
  setPlaybackStatusCallback(callback) {
    this.onPlaybackStatusChange = callback;
  }

  /**
   * Get current playback status.
   */
  getCurrentPlaybackStatus() {
    if (!this.currentPlayingItemId) return null;

    const totalBufferedTime = this.getBufferedDuration(this.currentPlayingItemId);

    // Calculate played time from worklet's sample counter
    const samplesPlayedForItem = this.totalPlayedSamples - this.itemStartSample;
    const currentTime = Math.max(0, samplesPlayedForItem / this.sampleRate);

    return {
      itemId: this.currentPlayingItemId,
      trackId: '',
      currentTime: Math.min(currentTime, totalBufferedTime),
      duration: totalBufferedTime,
      isPlaying: this._workletState === 'playing',
      bufferedTime: totalBufferedTime
    };
  }

  /**
   * Get buffered duration for an item.
   */
  getBufferedDuration(itemId) {
    return this.totalBufferedDuration.get(itemId) || 0;
  }

  /**
   * Schedule an 'ended' notification after buffer goes empty.
   * Defers by 2s in case more audio is still being generated by the AI.
   */
  _scheduleEndNotification(itemId) {
    this._cancelEndNotification();

    this.itemEndTimeout = setTimeout(() => {
      if (this.currentPlayingItemId === itemId && this._workletState !== 'playing') {
        this.totalBufferedDuration.delete(itemId);

        if (this.onPlaybackStatusChange) {
          this.onPlaybackStatusChange({
            itemId,
            status: 'ended',
            trackId: ''
          });
        }
        this.currentPlayingItemId = null;
      }
      this.itemEndTimeout = null;
    }, 2000);
  }

  _cancelEndNotification() {
    if (this.itemEndTimeout) {
      clearTimeout(this.itemEndTimeout);
      this.itemEndTimeout = null;
    }
  }

  // =========================================================================
  // Interruption & Track Management
  // =========================================================================

  /**
   * Interrupt audio playback — returns estimated position.
   */
  async interrupt() {
    if (!this.currentPlayingItemId) {
      return { trackId: null, offset: 0, currentTime: 0 };
    }

    const samplesPlayedForItem = this.totalPlayedSamples - this.itemStartSample;
    const currentTime = samplesPlayedForItem / this.sampleRate;
    const estimatedOffset = Math.floor(samplesPlayedForItem);

    // Clear send queue and ring buffer immediately
    this._clearSendQueue();
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'clear' });
    }

    // Mark all active tracks as interrupted
    const trackId = 'default';
    this.interruptedTracks.add(trackId);

    return { trackId, offset: estimatedOffset, currentTime };
  }

  /**
   * Clear streaming data for a track.
   */
  clearStreamingTrack(trackId) {
    this.streamingBuffers.delete(trackId);
    this._clearStreamingTimeout(trackId);
    this.trackQueues.delete(trackId);
    this.interruptedTracks.delete(trackId);

    // Clear sequence tracking
    this.lastSequenceNumbers.delete(trackId);
    this.outOfOrderBuffers.delete(trackId);
    if (this.sequenceGapTimeout.has(trackId)) {
      clearTimeout(this.sequenceGapTimeout.get(trackId));
      this.sequenceGapTimeout.delete(trackId);
    }

    // Clear send queue and ring buffer
    this._clearSendQueue();
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'clear' });
    }
  }

  /**
   * Clear all interrupted tracks.
   */
  clearInterruptedTracks() {
    this.interruptedTracks.clear();
  }

  /**
   * Check if track is currently playing.
   */
  isTrackPlaying(_trackId) {
    return this._workletState === 'playing';
  }

  // =========================================================================
  // Stop & Cleanup
  // =========================================================================

  /**
   * Stop all audio playback.
   */
  stopAll() {
    this._cancelEndNotification();

    // Clear send queue and ring buffer
    this._clearSendQueue();
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'clear' });
    }
    this._totalSentSamples = 0;

    // Clear all accumulation and queue state
    for (const timeoutId of this.streamingTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.streamingTimeouts.clear();
    this.streamingBuffers.clear();
    this.trackQueues.clear();

    // Clear tracking
    this.totalBufferedDuration.clear();
    this.currentPlayingItemId = null;
    this.totalPlayedSamples = 0;
    this.itemStartSample = 0;
  }

  /**
   * Cleanup all resources.
   */
  cleanup() {
    this._cancelEndNotification();
    this.stopAll();

    // Clear sequence gap timeouts
    for (const timeoutId of this.sequenceGapTimeout.values()) {
      clearTimeout(timeoutId);
    }
    this.sequenceGapTimeout.clear();

    // Clear all data
    this.interruptedTracks.clear();
    this.lastSequenceNumbers.clear();
    this.outOfOrderBuffers.clear();

    // Disconnect audio graph
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (e) { /* ignore */ }
      this.workletNode = null;
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch (e) { /* ignore */ }
      this.gainNode = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch (e) { /* ignore */ }
      this.analyser = null;
    }
    if (this.destinationNode) {
      try { this.destinationNode.disconnect(); } catch (e) { /* ignore */ }
      this.destinationNode = null;
    }

    // Stop and release HTMLAudioElement
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }

    // Close AudioContext
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(console.error);
      this.context = null;
    }

    this._workletReady = false;
    this._workletState = 'stopped';
  }

  // =========================================================================
  // Diagnostics
  // =========================================================================

  /**
   * Get diagnostic information for audio sequencing.
   */
  getSequenceDiagnostics() {
    const diagnostics = {
      tracks: {},
      outOfOrderCount: 0,
      totalBuffered: 0,
      gaps: [],
      workletState: this._workletState,
      totalPlayedSamples: this.totalPlayedSamples
    };

    for (const [trackId, lastSeq] of this.lastSequenceNumbers) {
      const outOfOrder = this.outOfOrderBuffers.get(trackId);
      const outOfOrderSeqs = outOfOrder
        ? Array.from(outOfOrder.keys()).sort((a, b) => a - b)
        : [];

      diagnostics.tracks[trackId] = {
        lastSequence: lastSeq,
        outOfOrderSequences: outOfOrderSeqs,
        gaps: this._findSequenceGaps(lastSeq, outOfOrderSeqs),
        queueLength: this.trackQueues.get(trackId)?.length || 0
      };

      diagnostics.outOfOrderCount += outOfOrderSeqs.length;

      if (diagnostics.tracks[trackId].gaps.length > 0) {
        diagnostics.gaps.push(
          ...diagnostics.tracks[trackId].gaps.map((g) => ({ trackId, ...g }))
        );
      }
    }

    return diagnostics;
  }

  _findSequenceGaps(lastSeq, outOfOrderSeqs) {
    const gaps = [];
    if (outOfOrderSeqs.length === 0) return gaps;

    if (outOfOrderSeqs[0] > lastSeq + 1) {
      gaps.push({
        from: lastSeq + 1,
        to: outOfOrderSeqs[0] - 1,
        size: outOfOrderSeqs[0] - lastSeq - 1
      });
    }

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
}

// Make available globally for compatibility
globalThis.ModernAudioPlayer = ModernAudioPlayer;
