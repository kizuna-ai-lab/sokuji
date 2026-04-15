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
    //
    // Each entry in itemQueue represents one item's presence in the stream:
    //   { itemId, startSample, totalSamples }
    //     startSample: cumulative enqueue position (samples) when the item's
    //                  first chunk was accepted
    //     totalSamples: running sum of this item's chunk sample counts
    //                   (i.e., the item's own audio duration)
    //
    // `_audibleItemId` tracks what the worklet is actually emitting right now
    // (derived from totalPlayedSamples ↔ item startSample crossings), which
    // is *different* from the most-recently-written item while the ring
    // buffer still contains audio from a prior item.
    this.itemQueue = [];
    this._audibleItemId = null;
    this._totalSamplesEnqueued = 0; // monotonic count of all samples passed to _writeToRingBuffer
    this.onPlaybackStatusChange = null;
    this.totalPlayedSamples = 0; // from worklet readPosition reports
    this.itemEndTimeout = null;

    // Worklet state
    this._workletReady = false;
    this._workletState = 'stopped'; // 'stopped' | 'playing' | 'starving'

    // SharedArrayBuffer ring buffer (main — TTS / streamed audio)
    this._sab = null;
    this._indices = null;  // Int32Array view [writeIndex, readIndex, capacity, flags]
    this._data = null;     // Float32Array view (audio samples)
    this._ringCapacity = Math.floor(sampleRate * 120); // 120 seconds (~11.5MB)

    // Main-thread overflow queue — holds data that doesn't fit in ring buffer
    this._pendingWrites = []; // Array of Float32Array chunks
    this._drainTimer = null;

    // Passthrough ring buffer — separate from main so passthrough audio is
    // mixed with (not queued behind) TTS audio in the worklet.  (#177)
    this._ptSab = null;
    this._ptIndices = null;
    this._ptData = null;
    this._ptCapacity = Math.floor(sampleRate * 10); // 10 seconds for passthrough
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

    // Passthrough ring buffer (smaller — only needs a few seconds of buffering)
    const ptSabSize = 16 + this._ptCapacity * 4;
    this._ptSab = new SharedArrayBuffer(ptSabSize);
    this._ptIndices = new Int32Array(this._ptSab, 0, 4);
    this._ptData = new Float32Array(this._ptSab, 16);
    Atomics.store(this._ptIndices, 0, 0);
    Atomics.store(this._ptIndices, 1, 0);
    Atomics.store(this._ptIndices, 2, this._ptCapacity);
    Atomics.store(this._ptIndices, 3, 0);

    // Send both ring buffers to worklet
    this.workletNode.port.postMessage({ type: 'init', sab: this._sab, ptSab: this._ptSab });

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
        // Re-evaluate audible item against current read position — this
        // covers the initial stopped→playing transition for the very first
        // item in the stream.
        this._checkAudibleItemChange();
      } else if (msg.state === 'starving' && prevState === 'playing') {
        if (this._audibleItemId) {
          this._scheduleEndNotification(this._audibleItemId);
        }
      }
    } else if (msg.type === 'readPosition') {
      this.totalPlayedSamples = msg.samplesPlayed;
      // Did the read head just cross into a new item? If so, fire ended/playing.
      this._checkAudibleItemChange();
      // Worklet consumed data — try to drain pending writes
      if (this._pendingWrites.length > 0) {
        this._drainPendingWrites();
      }
    }
  }

  /**
   * Detect whether the audible item has changed based on the latest
   * totalPlayedSamples and dispatch ended/playing events accordingly.
   *
   * Eviction is based on the entry's end sample, not its itemId, so it
   * behaves correctly even when the queue contains multiple entries with
   * the same itemId (e.g., a passthrough gap between two chunks of the
   * same AI item) and still drops fully-past entries when we cross into
   * a passthrough region where no item is audible.
   */
  _checkAudibleItemChange() {
    // Evict every entry at the front of the queue that is entirely behind
    // the current read head. We do this regardless of whether a new item
    // is audible, so stale entries don't accumulate during passthrough
    // gaps when `_findAudibleItemEntry` returns null.
    while (this.itemQueue.length > 0) {
      const head = this.itemQueue[0];
      const headEnd = head.startSample + head.totalSamples;
      if (headEnd > this.totalPlayedSamples) break;
      this.itemQueue.shift();
    }

    const entry = this._findAudibleItemEntry();
    const newId = entry ? entry.itemId : null;
    if (newId === this._audibleItemId) return;

    const prevId = this._audibleItemId;
    this._audibleItemId = newId;

    if (this.onPlaybackStatusChange) {
      if (prevId) {
        this.onPlaybackStatusChange({
          itemId: prevId,
          status: 'ended',
          trackId: ''
        });
      }
      if (newId) {
        this.onPlaybackStatusChange({
          itemId: newId,
          status: 'playing',
          trackId: ''
        });
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
      // Append this chunk to the item's range in the stream. Only extend the
      // tail entry if it's for the same item AND its sample range is still
      // contiguous with the current write head — otherwise a non-item write
      // (e.g., addToPassthroughBuffer) has inserted a gap, and the gap has
      // to stay represented so audible detection won't treat passthrough
      // samples as part of the item. We also never mutate any prior entry
      // that is already behind the current write head, because the data is
      // needed to report playback status for still-audible older items.
      const last = this.itemQueue.length > 0
        ? this.itemQueue[this.itemQueue.length - 1]
        : null;
      const contiguousWithLast =
        last &&
        last.itemId === metadata.itemId &&
        last.startSample + last.totalSamples === this._totalSamplesEnqueued;
      if (contiguousWithLast) {
        last.totalSamples += int16Buffer.length;
      } else {
        this.itemQueue.push({
          itemId: metadata.itemId,
          startSample: this._totalSamplesEnqueued,
          totalSamples: int16Buffer.length,
        });
      }
    }

    // Track total samples accepted into the stream (regardless of itemId —
    // passthrough counts too). This keeps startSample boundaries consistent
    // with what the worklet will eventually emit through totalPlayedSamples.
    this._totalSamplesEnqueued += int16Buffer.length;

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
    if (volume < 0.01) return;

    const buffer = this._normalizeAudioData(audioData);

    if (delay > 0) {
      // Copy the buffer — the caller's ArrayBuffer may be transferred to a
      // Worker (e.g. AsrEngine.feedAudio) before this timeout fires.  (#177)
      const copy = new Int16Array(buffer);
      setTimeout(() => {
        if (this.globalVolumeMultiplier > 0) {
          this._writeToPassthroughRing(copy, volume);
        }
      }, delay);
    } else {
      this._writeToPassthroughRing(buffer, volume);
    }
  }

  /**
   * Write audio to the dedicated passthrough ring buffer.
   * SPSC contract: main thread only writes writeIndex, worklet only writes
   * readIndex.  If the ring is full we drop the incoming chunk rather than
   * touching readIndex (passthrough is real-time — dropping a chunk is
   * inaudible, violating SPSC would be catastrophic).
   */
  _writeToPassthroughRing(int16Buffer, volume) {
    if (!this._ptIndices || !this._ptData) return;

    const count = int16Buffer.length;
    const cap = this._ptCapacity;

    const writeIdx = Atomics.load(this._ptIndices, 0);
    const readIdx = Atomics.load(this._ptIndices, 1);
    const used = writeIdx - readIdx;
    const free = cap - used;

    // Drop chunk if ring is full — passthrough is expendable
    if (free < count) return;

    // Convert Int16 → Float32 with volume and write with wrap-around
    const scale = (volume !== 1.0) ? volume / 32768 : 1 / 32768;
    for (let i = 0; i < count; i++) {
      this._ptData[(writeIdx + i) % cap] = int16Buffer[i] * scale;
    }
    Atomics.store(this._ptIndices, 0, writeIdx + count);
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
   * Get current playback status for the item the worklet is actually emitting
   * right now (the *audible* item), not the most-recently-written item.
   */
  getCurrentPlaybackStatus() {
    const audible = this._findAudibleItemEntry();
    if (!audible) return null;

    const totalBufferedTime = audible.totalSamples / this.sampleRate;

    // Inside the item's own duration, currentTime is simply how far past its
    // startSample the worklet has advanced.
    const samplesPlayedForItem = Math.max(0, this.totalPlayedSamples - audible.startSample);
    const currentTime = samplesPlayedForItem / this.sampleRate;

    return {
      itemId: audible.itemId,
      trackId: '',
      currentTime: Math.min(currentTime, totalBufferedTime),
      duration: totalBufferedTime,
      isPlaying: this._workletState === 'playing',
      bufferedTime: totalBufferedTime
    };
  }

  /**
   * Get buffered duration (seconds) for a given item, if it is still tracked.
   */
  getBufferedDuration(itemId) {
    for (const entry of this.itemQueue) {
      if (entry.itemId === itemId) {
        return entry.totalSamples / this.sampleRate;
      }
    }
    return 0;
  }

  /**
   * Find the itemQueue entry that is currently audible — the item whose
   * sample range strictly contains the worklet's read head. Returns null
   * when the read head is between items (e.g., in a passthrough-only
   * region, before the first item, or after the last item has finished).
   */
  _findAudibleItemEntry() {
    for (const entry of this.itemQueue) {
      const endSample = entry.startSample + entry.totalSamples;
      if (this.totalPlayedSamples < entry.startSample) {
        break; // queue is in insertion order; anything beyond is in the future
      }
      if (this.totalPlayedSamples < endSample) {
        return entry;
      }
      // totalPlayedSamples is past this entry's end — keep looking.
    }
    return null;
  }

  /**
   * Schedule an 'ended' notification after buffer goes empty.
   */
  _scheduleEndNotification(itemId) {
    this._cancelEndNotification();

    this.itemEndTimeout = setTimeout(() => {
      if (this._audibleItemId === itemId && this._workletState !== 'playing') {
        // The audible entry is always at the front of the queue (older
        // entries get evicted in _checkAudibleItemChange), so shifting the
        // head is enough — using findIndex by itemId would risk removing a
        // stale entry if the same id appears twice.
        if (this.itemQueue.length > 0 && this.itemQueue[0].itemId === itemId) {
          this.itemQueue.shift();
        }

        if (this.onPlaybackStatusChange) {
          this.onPlaybackStatusChange({
            itemId,
            status: 'ended',
            trackId: ''
          });
        }
        this._audibleItemId = null;
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
    const audible = this._findAudibleItemEntry();
    if (!audible) {
      // Preserve the no-op contract: ModernBrowserAudioService.interruptAudio()
      // returns null to callers when trackId is null, so we must not mark any
      // track as interrupted or clear preflush state here.
      return { trackId: null, offset: 0, currentTime: 0 };
    }

    const samplesPlayedForItem = Math.max(0, this.totalPlayedSamples - audible.startSample);
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

    // Also clear passthrough ring buffer
    if (this._ptIndices) {
      const ptReadIdx = Atomics.load(this._ptIndices, 1);
      Atomics.store(this._ptIndices, 0, ptReadIdx);
    }

    // Tell worklet to reset its internal state (samplesPlayed etc.)
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'clear' });
    }

    // Worklet will restart samplesPlayed from 0 on its next report; drop any
    // item tracking so startSample boundaries align with the fresh stream.
    this.itemQueue = [];
    this._audibleItemId = null;
    this._totalSamplesEnqueued = 0;
    this.totalPlayedSamples = 0;
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
    this._clearRingBuffer(); // already resets itemQueue/_audibleItemId/_totalSamplesEnqueued/totalPlayedSamples

    for (const timeoutId of this.streamingTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.streamingTimeouts.clear();
    this.streamingBuffers.clear();
    this.trackQueues.clear();
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
