/**
 * Modern Audio Player using SharedArrayBuffer ring buffer for gapless playback.
 * Output routes through a single persistent HTMLAudioElement for AEC compatibility.
 *
 * Architecture:
 *   PCM chunks → SharedArrayBuffer (lock-free SPSC ring buffer) → AudioWorkletNode
 *     → GainNode → AnalyserNode → MediaStreamDestinationNode
 *       → HTMLAudioElement.srcObject → Speakers (AEC-visible)
 *
 * The main thread writes directly to shared memory. The worklet reads directly.
 * No postMessage for audio data — only for low-frequency control signals.
 * Overflow is handled by a main-thread queue that drains as the worklet consumes.
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

    // Streaming buffer accumulation
    this.streamingBuffers = new Map();
    this.streamingTimeouts = new Map();
    this.trackQueues = new Map();
    this.interruptedTracks = new Set();

    // Sequence tracking for ordering
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

    // SharedArrayBuffer ring buffer
    this._sab = null;
    this._indices = null;  // Int32Array view [writeIndex, readIndex, capacity, flags]
    this._data = null;     // Float32Array view (audio samples)
    this._ringCapacity = Math.floor(sampleRate * 120); // 120 seconds (~11.5MB)

    // Main-thread overflow queue — holds data that doesn't fit in ring buffer
    this._pendingWrites = []; // Array of Float32Array chunks
    this._drainTimer = null;
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

    // Create SharedArrayBuffer: 16 bytes header (4x Int32) + capacity * 4 bytes (Float32)
    // Note: in current Chrome (extension side panel), SharedArrayBuffer is usable
    // and can be cross-agent-transferred via postMessage even without manifest
    // cross_origin_*_policy. We deliberately do NOT declare COOP/COEP in
    // extension/manifest.json because doing so makes the side panel
    // crossOriginIsolated, which causes Chrome to reject MediaStream consumption
    // from chrome.tabCapture and breaks the participant audio client (issue #184).
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('[ModernAudioPlayer] SharedArrayBuffer not available in this environment');
    }
    const sabSize = 16 + this._ringCapacity * 4;
    this._sab = new SharedArrayBuffer(sabSize);
    this._indices = new Int32Array(this._sab, 0, 4);
    this._data = new Float32Array(this._sab, 16);

    // Initialize header
    Atomics.store(this._indices, 0, 0); // writeIndex
    Atomics.store(this._indices, 1, 0); // readIndex
    Atomics.store(this._indices, 2, this._ringCapacity); // capacity
    Atomics.store(this._indices, 3, 0); // flags

    // Load worklet — use chrome.runtime.getURL in extension context (CSP blocks data: URLs)
    const workletUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('worklets/playback-ring-processor.js')
      : new URL('./worklets/playback-ring-processor.js', import.meta.url).href;
    await this.context.audioWorklet.addModule(workletUrl);
    this.workletNode = new AudioWorkletNode(this.context, 'playback-ring-processor');
    this._workletReady = true;

    // Send SharedArrayBuffer to worklet
    this.workletNode.port.postMessage({ type: 'init', sab: this._sab });

    // Listen for worklet messages (state changes + position reports only)
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

    if (this.context.sampleRate !== this.sampleRate) {
      console.error('[ModernAudioPlayer] SAMPLE RATE MISMATCH! context:', this.context.sampleRate, 'expected:', this.sampleRate);
    }

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
      // Worklet consumed data — try to drain pending writes
      if (this._pendingWrites.length > 0) {
        this._drainPendingWrites();
      }
    }
  }

  // =========================================================================
  // SharedArrayBuffer Ring Buffer Write
  // =========================================================================

  /**
   * Get free space in the ring buffer by reading indices atomically.
   */
  _getFreeSpace() {
    const writeIdx = Atomics.load(this._indices, 0);
    const readIdx = Atomics.load(this._indices, 1);
    const used = writeIdx - readIdx;
    return this._ringCapacity - used;
  }

  _writeToSAB(float32, offset, count) {
    const writeIdx = Atomics.load(this._indices, 0);
    const cap = this._ringCapacity;

    for (let i = 0; i < count; i++) {
      this._data[(writeIdx + i) % cap] = float32[offset + i];
    }

    Atomics.store(this._indices, 0, writeIdx + count);
    return count;
  }

  _writeToRingBuffer(int16Buffer, volume, metadata) {
    if (!this._workletReady || !this._indices) return;

    if (metadata && metadata.itemId) {
      if (this.currentPlayingItemId !== metadata.itemId) {
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

    const float32 = new Float32Array(int16Buffer.length);
    const scale = (volume !== 1.0) ? volume / 32768 : 1 / 32768;
    for (let i = 0; i < int16Buffer.length; i++) {
      float32[i] = int16Buffer[i] * scale;
    }

    // CRITICAL: if pending queue is non-empty, ALL new data must go to queue
    // to preserve FIFO ordering. Direct SAB writes would skip ahead of queued data.
    if (this._pendingWrites.length > 0) {
      this._pendingWrites.push(float32);
      this._scheduleDrain();
      return;
    }

    // Queue is empty — safe to write directly to SAB
    const freeSpace = this._getFreeSpace();
    const immediate = Math.min(float32.length, freeSpace);

    if (immediate > 0) {
      this._writeToSAB(float32, 0, immediate);
    }

    if (immediate < float32.length) {
      this._pendingWrites.push(float32.subarray(immediate));
      this._scheduleDrain();
    }
  }

  _drainPendingWrites() {
    if (this._pendingWrites.length === 0) {
      this._cancelDrain();
      return;
    }

    let freeSpace = this._getFreeSpace();

    while (this._pendingWrites.length > 0 && freeSpace > 0) {
      const chunk = this._pendingWrites[0];
      const toWrite = Math.min(chunk.length, freeSpace);

      this._writeToSAB(chunk, 0, toWrite);
      freeSpace -= toWrite;

      if (toWrite < chunk.length) {
        this._pendingWrites[0] = chunk.subarray(toWrite);
        break;
      } else {
        this._pendingWrites.shift();
      }
    }

    if (this._pendingWrites.length > 0) {
      this._scheduleDrain();
    } else {
      this._cancelDrain();
    }
  }

  _scheduleDrain() {
    if (this._drainTimer !== null) return;
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      this._drainPendingWrites();
    }, 50);
  }

  _cancelDrain() {
    if (this._drainTimer !== null) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
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
    // Only check per-track volume — GainNode handles globalVolumeMultiplier
    if (volume < 0.01) return;

    const buffer = this._normalizeAudioData(audioData);

    if (delay > 0) {
      setTimeout(() => {
        if (this.globalVolumeMultiplier > 0) {
          this._writeToRingBuffer(buffer, volume, {});
        }
      }, delay);
    } else {
      this._writeToRingBuffer(buffer, volume, {});
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
  // Chunk Accumulation
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

    // Write to ring buffer (with overflow queue)
    this._writeToRingBuffer(combined, streamData.volume, streamData.metadata);

    // Reset accumulator
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
      if (this.audioElement && typeof this.audioElement.setSinkId === 'function') {
        await this.audioElement.setSinkId(deviceId);
      }
      if (this.context && typeof this.context.setSinkId === 'function') {
        await this.context.setSinkId(deviceId).catch(() => {});
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

    // Clear ring buffer + pending writes
    this._clearRingBuffer();

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

    this.lastSequenceNumbers.delete(trackId);
    this.outOfOrderBuffers.delete(trackId);
    if (this.sequenceGapTimeout.has(trackId)) {
      clearTimeout(this.sequenceGapTimeout.get(trackId));
      this.sequenceGapTimeout.delete(trackId);
    }

    this._clearRingBuffer();
  }

  /**
   * Clear the ring buffer — resets SAB indices and flushes pending writes.
   */
  _clearRingBuffer() {
    // Clear pending writes queue
    this._pendingWrites = [];
    this._cancelDrain();

    // SPSC-safe clear: producer (main thread) only modifies writeIndex.
    // Set writeIdx = readIdx to mark buffer as empty without touching readIndex.
    if (this._indices) {
      const readIdx = Atomics.load(this._indices, 1);
      Atomics.store(this._indices, 0, readIdx);
    }

    // Tell worklet to reset its internal state (samplesPlayed etc.)
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
    this._clearRingBuffer();

    for (const timeoutId of this.streamingTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.streamingTimeouts.clear();
    this.streamingBuffers.clear();
    this.trackQueues.clear();

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

    for (const timeoutId of this.sequenceGapTimeout.values()) {
      clearTimeout(timeoutId);
    }
    this.sequenceGapTimeout.clear();

    this.interruptedTracks.clear();
    this.lastSequenceNumbers.clear();
    this.outOfOrderBuffers.clear();

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

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }

    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(console.error);
      this.context = null;
    }

    this._sab = null;
    this._indices = null;
    this._data = null;
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
    const writeIdx = this._indices ? Atomics.load(this._indices, 0) : 0;
    const readIdx = this._indices ? Atomics.load(this._indices, 1) : 0;

    const diagnostics = {
      tracks: {},
      outOfOrderCount: 0,
      totalBuffered: 0,
      gaps: [],
      workletState: this._workletState,
      totalPlayedSamples: this.totalPlayedSamples,
      ringBufferUsed: writeIdx - readIdx,
      ringBufferCapacity: this._ringCapacity,
      pendingWriteChunks: this._pendingWrites.length
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
