# Audio Pipeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-chunk HTMLAudioElement playback with an AudioWorklet ring buffer feeding a single persistent HTMLAudioElement, eliminating inter-chunk gaps that cause crackling (issue #172).

**Architecture:** A `PlaybackRingWorkletProcessor` AudioWorklet maintains a circular buffer and outputs audio continuously. The main thread writes PCM chunks into it via `postMessage`. The worklet output connects through GainNode → AnalyserNode → MediaStreamDestinationNode → a single persistent HTMLAudioElement (preserving AEC compatibility).

**Tech Stack:** Web Audio API (AudioWorklet, AudioContext, GainNode, AnalyserNode, MediaStreamDestinationNode), HTMLAudioElement

---

### Task 1: Create PlaybackRingWorkletProcessor

**Files:**
- Create: `src/lib/modern-audio/worklets/playback-ring-processor.js`

- [ ] **Step 1: Create the worklet processor file**

```javascript
// src/lib/modern-audio/worklets/playback-ring-processor.js

/**
 * AudioWorklet processor that maintains a circular buffer for gapless audio playback.
 * Receives PCM samples via postMessage, outputs continuously via process().
 * When buffer is empty, outputs silence (no clicks or pops).
 */
class PlaybackRingWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Ring buffer: 2 seconds capacity at whatever sample rate the context uses
    // sampleRate is a global in AudioWorkletGlobalScope
    this._capacity = Math.floor(sampleRate * 2);
    this._buffer = new Float32Array(this._capacity);
    this._writeIndex = 0;
    this._readIndex = 0;
    this._playing = true;

    // State tracking for notifications
    this._state = 'stopped'; // 'stopped' | 'playing' | 'starving'
    this._samplesPlayed = 0;
    this._lastPositionReport = 0;
    // Report position every ~50ms worth of samples
    this._positionReportInterval = Math.floor(sampleRate * 0.05);

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'write') {
        this._write(msg.samples);
      } else if (msg.type === 'clear') {
        this._clear();
      } else if (msg.type === 'setPlaying') {
        this._playing = msg.playing;
      }
    };
  }

  _available() {
    const avail = this._writeIndex - this._readIndex;
    return avail >= 0 ? avail : avail + this._capacity;
  }

  _write(samples) {
    const len = samples.length;

    // Check for overflow — if writing would exceed capacity, drop oldest
    if (len > this._capacity) {
      // Extremely large write — only keep the last _capacity samples
      const offset = len - this._capacity;
      this._buffer.set(samples.subarray(offset), 0);
      this._writeIndex = this._capacity;
      this._readIndex = 0;
      return;
    }

    const available = this._available();
    const freeSpace = this._capacity - available;

    if (len > freeSpace) {
      // Overflow: advance readIndex to make room
      const overflow = len - freeSpace;
      this._readIndex = (this._readIndex + overflow) % this._capacity;
    }

    // Write samples into ring buffer (handle wrap-around)
    const writePos = this._writeIndex % this._capacity;
    const firstPart = Math.min(len, this._capacity - writePos);
    this._buffer.set(samples.subarray(0, firstPart), writePos);

    if (firstPart < len) {
      this._buffer.set(samples.subarray(firstPart), 0);
    }

    this._writeIndex = (writePos + len) % this._capacity;
  }

  _clear() {
    this._readIndex = 0;
    this._writeIndex = 0;
    this._samplesPlayed = 0;
    this._lastPositionReport = 0;
    this._setState('stopped');
  }

  _setState(newState) {
    if (this._state !== newState) {
      this._state = newState;
      this.port.postMessage({ type: 'stateChange', state: newState });
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    const frameSize = channel.length; // typically 128

    if (!this._playing) {
      // Output silence when paused
      channel.fill(0);
      return true;
    }

    const available = this._available();

    if (available === 0) {
      // Buffer empty — output silence
      channel.fill(0);
      if (this._state === 'playing') {
        this._setState('starving');
      }
      return true;
    }

    // We have data — read from ring buffer
    if (this._state !== 'playing') {
      this._setState('playing');
    }

    const samplesToRead = Math.min(frameSize, available);
    const readPos = this._readIndex % this._capacity;
    const firstPart = Math.min(samplesToRead, this._capacity - readPos);

    // Copy first part
    channel.set(this._buffer.subarray(readPos, readPos + firstPart));

    if (firstPart < samplesToRead) {
      // Wrap around
      channel.set(this._buffer.subarray(0, samplesToRead - firstPart), firstPart);
    }

    // Zero-fill remainder if buffer didn't have enough for full frame
    if (samplesToRead < frameSize) {
      channel.fill(0, samplesToRead);
    }

    this._readIndex = (readPos + samplesToRead) % this._capacity;
    this._samplesPlayed += samplesToRead;

    // Periodic position report
    if (this._samplesPlayed - this._lastPositionReport >= this._positionReportInterval) {
      this._lastPositionReport = this._samplesPlayed;
      this.port.postMessage({ type: 'readPosition', samplesPlayed: this._samplesPlayed });
    }

    return true;
  }
}

registerProcessor('playback-ring-processor', PlaybackRingWorkletProcessor);
```

- [ ] **Step 2: Verify file is in place**

Run: `ls -la src/lib/modern-audio/worklets/playback-ring-processor.js`
Expected: File exists

- [ ] **Step 3: Commit**

```bash
git add src/lib/modern-audio/worklets/playback-ring-processor.js
git commit -m "feat(audio): add PlaybackRingWorkletProcessor for gapless playback"
```

---

### Task 2: Rewrite ModernAudioPlayer — constructor and initialization

**Files:**
- Modify: `src/lib/modern-audio/ModernAudioPlayer.js` (full rewrite)

This task replaces the entire file. The constructor and `connect()` method set up the AudioContext → worklet → audio graph → single HTMLAudioElement pipeline.

- [ ] **Step 1: Replace the file with the new constructor and connect()**

Replace the entire contents of `src/lib/modern-audio/ModernAudioPlayer.js` with:

```javascript
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
        // Audio started or resumed — cancel any pending end notification
        this._cancelEndNotification();
        if (this.currentPlayingItemId && this.onPlaybackStatusChange) {
          this.onPlaybackStatusChange({
            itemId: this.currentPlayingItemId,
            status: 'playing',
            trackId: ''
          });
        }
      } else if (msg.state === 'starving' && prevState === 'playing') {
        // Buffer ran dry — might be end of speech or network stall
        if (this.currentPlayingItemId) {
          this._scheduleEndNotification(this.currentPlayingItemId);
        }
      }
    } else if (msg.type === 'readPosition') {
      this.totalPlayedSamples = msg.samplesPlayed;
    }
  }

  // --- remaining methods will be added in subsequent tasks ---
}

// Make available globally for compatibility
globalThis.ModernAudioPlayer = ModernAudioPlayer;
```

- [ ] **Step 2: Verify file parses correctly**

Run: `node -e "import('./src/lib/modern-audio/ModernAudioPlayer.js').then(() => console.log('OK')).catch(e => console.error(e.message))" --input-type=module`

If this fails due to `import.meta.url`, that's expected in Node — just verify no syntax errors:

Run: `node --check src/lib/modern-audio/ModernAudioPlayer.js 2>&1 || echo "Module syntax - checking with parse..." && node -e "const fs=require('fs'); const code=fs.readFileSync('src/lib/modern-audio/ModernAudioPlayer.js','utf8'); try{new Function(code)}catch(e){if(!e.message.includes('import')){console.error(e.message);process.exit(1)}}; console.log('Syntax OK')"`

- [ ] **Step 3: Commit**

```bash
git add src/lib/modern-audio/ModernAudioPlayer.js
git commit -m "feat(audio): rewrite ModernAudioPlayer core with AudioWorklet ring buffer

Replaces per-chunk HTMLAudioElement with AudioWorklet → MediaStream →
single persistent HTMLAudioElement pipeline. This task adds constructor
and connect() only; remaining methods follow in subsequent commits."
```

---

### Task 3: Add streaming input methods

**Files:**
- Modify: `src/lib/modern-audio/ModernAudioPlayer.js` (add methods after `_handleWorkletMessage`)

These methods handle PCM chunk input, sequence ordering, accumulation, and flushing to the ring buffer worklet.

- [ ] **Step 1: Add all streaming input methods**

Insert the following methods into `ModernAudioPlayer` class, replacing the `// --- remaining methods will be added in subsequent tasks ---` comment:

```javascript
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
   * Convert Int16 PCM to Float32, apply per-track volume, and post to worklet.
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

    // Post to worklet — transfer the buffer for zero-copy
    this.workletNode.port.postMessage(
      { type: 'write', samples: float32 },
      [float32.buffer]
    );
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

  // --- volume, status, cleanup methods added in next tasks ---
```

- [ ] **Step 2: Verify no syntax errors**

Run: `npx acorn --ecma2022 --module src/lib/modern-audio/ModernAudioPlayer.js > /dev/null 2>&1 && echo "Syntax OK" || echo "Syntax error"`

If acorn isn't available:
Run: `npx -y acorn --ecma2022 --module src/lib/modern-audio/ModernAudioPlayer.js > /dev/null 2>&1 && echo "Syntax OK" || node -e "require('fs').readFileSync('src/lib/modern-audio/ModernAudioPlayer.js','utf8')" && echo "File readable"`

- [ ] **Step 3: Commit**

```bash
git add src/lib/modern-audio/ModernAudioPlayer.js
git commit -m "feat(audio): add streaming input, sequence ordering, and ring buffer write

Ports addStreamingAudio, add16BitPCM, addToPassthroughBuffer, and all
sequence ordering logic. Chunks are accumulated, combined, converted
to Float32, and posted to the ring buffer worklet via transferable."
```

---

### Task 4: Add volume, device switching, and visualization methods

**Files:**
- Modify: `src/lib/modern-audio/ModernAudioPlayer.js` (add methods, replace placeholder comment)

- [ ] **Step 1: Add volume, device, and visualization methods**

Replace the `// --- volume, status, cleanup methods added in next tasks ---` comment with:

```javascript
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

  // --- playback status, interruption, cleanup methods added in next tasks ---
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/modern-audio/ModernAudioPlayer.js
git commit -m "feat(audio): add volume control, device switching, and visualization"
```

---

### Task 5: Add playback status tracking

**Files:**
- Modify: `src/lib/modern-audio/ModernAudioPlayer.js` (add methods, replace placeholder comment)

- [ ] **Step 1: Add playback status methods**

Replace the `// --- playback status, interruption, cleanup methods added in next tasks ---` comment with:

```javascript
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
      // Only fire if still the same item and still starving
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

  // --- interruption and cleanup methods added in next task ---
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/modern-audio/ModernAudioPlayer.js
git commit -m "feat(audio): add playback status tracking with worklet sample counter"
```

---

### Task 6: Add interruption, cleanup, and diagnostics

**Files:**
- Modify: `src/lib/modern-audio/ModernAudioPlayer.js` (add final methods, replace placeholder comment)

- [ ] **Step 1: Add remaining methods**

Replace the `// --- interruption and cleanup methods added in next task ---` comment with:

```javascript
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

    // Clear the ring buffer immediately
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

    // Clear ring buffer
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

    // Clear ring buffer
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'clear' });
    }

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
```

**Important:** This code replaces only the placeholder comment. The class closing `}` and `globalThis.ModernAudioPlayer = ModernAudioPlayer;` line already exist in the file from Task 2 — do NOT duplicate them.

- [ ] **Step 2: Verify complete file has no syntax issues**

Run: `wc -l src/lib/modern-audio/ModernAudioPlayer.js` — should be ~500-550 lines.

Run: `grep -c 'class ModernAudioPlayer' src/lib/modern-audio/ModernAudioPlayer.js` — should be `1`.

Run: `grep -c 'globalThis.ModernAudioPlayer' src/lib/modern-audio/ModernAudioPlayer.js` — should be `1` (at end of file, not inside class).

- [ ] **Step 3: Commit**

```bash
git add src/lib/modern-audio/ModernAudioPlayer.js
git commit -m "feat(audio): add interruption, cleanup, diagnostics — complete rewrite

ModernAudioPlayer rewrite is now complete. All public methods preserved:
addStreamingAudio, add16BitPCM, addToPassthroughBuffer, connect,
setSinkId, setGlobalVolume, getFrequencies, interrupt, clearStreamingTrack,
clearInterruptedTracks, stopAll, cleanup, setPlaybackStatusCallback,
getCurrentPlaybackStatus, getBufferedDuration, getSequenceDiagnostics."
```

---

### Task 7: Verify build and remove dead code

**Files:**
- Modify: `src/lib/modern-audio/ModernAudioPlayer.js` (if build errors)

- [ ] **Step 1: Run the development build**

Run: `npm run build 2>&1 | head -50`

Expected: Build succeeds. The worklet file at `src/lib/modern-audio/worklets/playback-ring-processor.js` should be handled by Vite's `new URL(..., import.meta.url)` pattern (same as other worklets in the project).

- [ ] **Step 2: Verify no TypeScript errors from consumers**

Run: `npx tsc --noEmit 2>&1 | grep -i "ModernAudioPlayer\|modern-audio" | head -20`

Fix any type errors. Common issues:
- `ModernBrowserAudioService.ts` may reference removed properties (e.g., `player.audioElements`, `player.context`) — these should still exist in the new code. Check if any direct property access needs updating.

- [ ] **Step 3: Check for any references to removed methods/properties**

Run: `grep -rn "createWavBlob\|createWavHeader\|connectToAnalyser\|createAudioElement\|cleanupAudioElement\|cleanupAudio\|processQueue\|queueAudio\|scheduleNextPlayback\|applyVolume\|audioGainNodes\|audioSourceNodes\|cumulativePlayedTime\|lastChunkAudioId\|audioElements" src/ --include="*.ts" --include="*.tsx" --include="*.js" | grep -v "ModernAudioPlayer.js" | grep -v node_modules`

If any external references to removed internals are found, fix them:
- `player.context` → still exists, OK
- `player.analyser` → still exists, OK
- `player.audioElements` → removed. If referenced externally, replace with `player.isTrackPlaying(trackId)` check

- [ ] **Step 4: Run tests**

Run: `npm run test 2>&1 | tail -20`

Expected: Existing tests pass. There are no unit tests for `ModernAudioPlayer` itself (AudioWorklet can't run in jsdom), so test failures would indicate breakage in other modules.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(audio): resolve build errors from audio pipeline rewrite"
```

---

### Task 8: Manual integration testing

No code changes — this task is a manual verification checklist.

- [ ] **Step 1: Test basic playback (Electron)**

1. Run `npm run electron:dev`
2. Connect to Gemini provider with audio output enabled
3. Send a message that produces a long response (10+ words)
4. **Verify:** Audio plays smoothly with no crackling or gaps
5. **Verify:** Audio continues playing without artifacts for the full response

- [ ] **Step 2: Test AEC (Electron)**

1. With speakers (no headphones), start a translation session
2. Speak while TTS is playing back
3. **Verify:** The AI does not echo back its own TTS output (AEC is working)

- [ ] **Step 3: Test volume control**

1. Toggle monitor on/off in the UI
2. **Verify:** Audio mutes and unmutes without glitches
3. Adjust volume slider
4. **Verify:** Volume changes take effect immediately

- [ ] **Step 4: Test track interruption**

1. Start a long TTS response
2. Interrupt mid-playback (e.g., press stop or send new input)
3. **Verify:** Audio stops immediately, no residual sound
4. Start a new response
5. **Verify:** New audio plays cleanly

- [ ] **Step 5: Test output device switching**

1. Change the output device in settings while audio is playing
2. **Verify:** Audio switches to new device

- [ ] **Step 6: Test visualization**

1. During playback, observe the waveform visualization
2. **Verify:** Waveform renders and moves with the audio

- [ ] **Step 7: Test browser extension**

1. Load the extension in Chrome
2. Open a supported platform (e.g., Google Meet)
3. Start a translation session
4. **Verify:** Audio plays in side panel without crackling
5. **Verify:** Virtual microphone receives audio (other participants can hear translation)

- [ ] **Step 8: Test multiple providers**

Test with: OpenAI, Gemini, Palabra AI, Kizuna AI
**Verify:** All providers play audio without crackling
