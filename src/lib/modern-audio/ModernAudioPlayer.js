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

    // Passthrough diagnostics counters (issue #246: observe clock-drift buildup)
    this._ptSamplesWritten = 0;
    this._ptSamplesDropped = 0;
    this._ptDropEvents = 0;
    this._ptSamplesSkippedSilent = 0;
    this._lastPtDropLogTs = 0;
    // Silence threshold for producer-side skip (issue #246).
    // Mean absolute amplitude normalized to [0,1]. 0.003 ≈ -50 dBFS, below
    // typical room noise but well below normal speech (-25 to -35 dBFS).
    // Skipping silent chunks lets the ring drain naturally during quiet
    // moments, bounding backlog without an audible drop.
    this._ptSilenceThreshold = 0.003;

    // Issue #246: pending auto-resume timer for when the player AudioContext
    // gets stuck in 'suspended' (e.g. Bluetooth hiccup, WebAudio render error).
    this._autoResumeTimer = null;
    // Issue #246: deadline timer that fires if resume() doesn't restore the
    // ctx in time — Chrome's "AudioContext encountered an error" state is
    // unrecoverable via resume(), so we have to close and rebuild from
    // scratch.
    this._recreateDeadlineTimer = null;
    this._recreatingContext = false;
    this._recreateAttempts = 0;
    this._ptSamplesTrimmedByWorklet = 0;
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

    // Issue #246: track AudioContext state transitions, and auto-recover when
    // the ctx gets stuck in 'suspended'. setSinkId-induced suspends self-
    // resolve in ~5-20ms; longer suspends (BT disconnect, WebAudio renderer
    // error) leave the worklet stuck — calling resume() is the only path
    // back, otherwise the entire player is silently dead even though the
    // producer keeps queueing audio.
    this.context.addEventListener('statechange', () => {
      const state = this.context && this.context.state;
      const ts = (typeof performance !== 'undefined' ? performance.now() : Date.now()).toFixed(0);
      console.warn(`[Sokuji] [PtDiag] player AudioContext.state -> ${state} (t=${ts}ms)`);

      if (state === 'suspended') {
        if (this._autoResumeTimer) clearTimeout(this._autoResumeTimer);
        // 250ms is well past the normal setSinkId-induced suspend window
        // (4-21ms observed in repro). If we're still suspended after that,
        // the suspend is "stuck" and we try to resume.
        this._autoResumeTimer = setTimeout(() => {
          this._autoResumeTimer = null;
          if (!this.context || this.context.state !== 'suspended') return;
          console.warn('[Sokuji] [PtDiag] ctx still suspended after 250ms — attempting auto-resume');
          this.context.resume()
            .then(() => console.info('[Sokuji] [PtDiag] ctx auto-resume OK'))
            .catch((e) => console.error('[Sokuji] [PtDiag] ctx auto-resume failed:', (e && (e.message || e.name)) || e));
          // Recreate deadline: if state didn't go back to running by then,
          // resume() is silently stuck and we need to rebuild the context.
          if (this._recreateDeadlineTimer) clearTimeout(this._recreateDeadlineTimer);
          this._recreateDeadlineTimer = setTimeout(() => {
            this._recreateDeadlineTimer = null;
            if (!this.context || this.context.state === 'running' || this.context.state === 'closed') return;
            console.warn('[Sokuji] [PtDiag] resume() did not restore ctx after 1500ms — recreating context');
            this._recreateContext().catch((err) => {
              console.error('[Sokuji] [PtDiag] recreate threw:', (err && err.message) || err);
            });
          }, 1500);
        }, 250);
      } else if (state === 'running') {
        // Self-recovered (e.g. Chrome auto-resumed after setSinkId) or
        // resume() finally took effect. Clear both pending timers.
        if (this._autoResumeTimer) {
          clearTimeout(this._autoResumeTimer);
          this._autoResumeTimer = null;
        }
        if (this._recreateDeadlineTimer) {
          clearTimeout(this._recreateDeadlineTimer);
          this._recreateDeadlineTimer = null;
        }
        // Reset retry counter once we're running — a future failure should
        // be treated as a fresh incident.
        this._recreateAttempts = 0;
      }
    });

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

    // Issue #246: HTMLAudioElement-side events. These fire on the sink that
    // setSinkId points to (e.g., Bluetooth headphones). A `stalled` /
    // `waiting` / `pause` burst correlated with a pt-buffer jump is the
    // signature of the "consumer stall ratchet" hypothesis.
    const logElemEvent = (kind) => {
      const ts = (typeof performance !== 'undefined' ? performance.now() : Date.now()).toFixed(0);
      const ptUsed = this._ptIndices
        ? (Atomics.load(this._ptIndices, 0) - Atomics.load(this._ptIndices, 1))
        : 'n/a';
      const ptMs = (typeof ptUsed === 'number')
        ? ((ptUsed / this.sampleRate * 1000) | 0)
        : 'n/a';
      console.warn(
        `[Sokuji] [PtDiag] audioElement event=${kind} ` +
        `paused=${this.audioElement && this.audioElement.paused} ` +
        `readyState=${this.audioElement && this.audioElement.readyState} ` +
        `pt=${ptUsed}(${ptMs}ms) t=${ts}ms`
      );
    };
    ['stalled', 'waiting', 'pause', 'playing', 'suspend', 'error', 'ended', 'emptied'].forEach((evt) => {
      this.audioElement.addEventListener(evt, () => logElemEvent(evt));
    });

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
    } else if (msg.type === 'ptTrim') {
      // Issue #246: worklet trimmed passthrough backlog after a stall.
      this._ptSamplesTrimmedByWorklet += msg.skipped;
      const ms = (msg.skipped / this.sampleRate * 1000) | 0;
      console.warn(
        `[Sokuji] [PtDiag] passthrough trim: skipped=${msg.skipped} samples (${ms}ms) ` +
        `totalTrimmed=${this._ptSamplesTrimmedByWorklet}`
      );
    } else if (msg.type === 'ptAdaptive') {
      // Issue #246: worklet is in adaptive catch-up zone (250–800ms backlog).
      // Throttled to ≤1/sec from the worklet side. Info level — useful for
      // verifying the soft catch-up is engaged.
      console.info(
        `[Sokuji] [PtDiag] passthrough adaptive: ratio=${msg.ratio.toFixed(3)}x ` +
        `backlog=${msg.backlogMs}ms`
      );
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

    // Issue #246: silence skip. Mean absolute amplitude (cheap; close to RMS
    // for typical audio). Early-exit once a single loud sample is seen.
    // Skipping silent chunks lets the ring drain during quiet moments, so
    // backlog can't ratchet up unbounded without ever hitting the worklet's
    // adaptive/trim path.
    if (count > 0) {
      const threshold16 = this._ptSilenceThreshold * 32768;
      let sumAbs = 0;
      let isSilent = true;
      for (let i = 0; i < count; i++) {
        const s = int16Buffer[i];
        const a = s < 0 ? -s : s;
        sumAbs += a;
        // Cheap short-circuit: if any single sample is far above threshold,
        // the chunk is definitely not silent.
        if (a > threshold16 * 4) {
          isSilent = false;
          break;
        }
      }
      if (isSilent && (sumAbs / count) < threshold16) {
        this._ptSamplesSkippedSilent += count;
        return;
      }
    }

    const cap = this._ptCapacity;

    const writeIdx = Atomics.load(this._ptIndices, 0);
    const readIdx = Atomics.load(this._ptIndices, 1);
    const used = writeIdx - readIdx;
    const free = cap - used;

    // Drop chunk if ring is full — passthrough is expendable
    if (free < count) {
      // Diagnostic (issue #246): track drops + throttled warn so we can see
      // when clock-drift buildup hits the buffer ceiling and chunks start
      // being dropped (the audible "choppy" symptom).
      this._ptSamplesDropped += count;
      this._ptDropEvents += 1;
      const now = Date.now();
      if (now - this._lastPtDropLogTs >= 5000) {
        this._lastPtDropLogTs = now;
        const usedMs = (used / this.sampleRate * 1000) | 0;
        const capMs = (cap / this.sampleRate * 1000) | 0;
        console.warn(
          `[Sokuji] [PtDiag] passthrough ring FULL — dropping chunks. ` +
          `used=${used}/${cap} (${usedMs}/${capMs}ms) ` +
          `totalDropped=${this._ptSamplesDropped}samples in ${this._ptDropEvents} events`
        );
      }
      return;
    }

    // Convert Int16 → Float32 with volume and write with wrap-around
    const scale = (volume !== 1.0) ? volume / 32768 : 1 / 32768;
    for (let i = 0; i < count; i++) {
      this._ptData[(writeIdx + i) % cap] = int16Buffer[i] * scale;
    }
    Atomics.store(this._ptIndices, 0, writeIdx + count);
    this._ptSamplesWritten += count;
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

  /**
   * Issue #246: tear down a wedged AudioContext and rebuild from scratch.
   *
   * Once Chrome's WebAudio renderer hits an "AudioContext encountered an
   * error" state (typically triggered by the output sink disappearing —
   * Bluetooth disconnect, USB unplug), the ctx is permanently stuck in
   * 'suspended'. resume() returns a Promise that never settles, setSinkId
   * to a working device reports ok but the ctx stays suspended, and the
   * worklet never runs again. The only way out is to close() and rebuild.
   */
  async _recreateContext() {
    if (this._recreatingContext) {
      console.debug('[Sokuji] [PtDiag] recreate already in flight — skipping');
      return;
    }
    if (this._recreateAttempts >= 3) {
      console.error(`[Sokuji] [PtDiag] recreate aborted — already attempted ${this._recreateAttempts} times, giving up to avoid loop`);
      return;
    }
    this._recreatingContext = true;
    this._recreateAttempts += 1;
    const attempt = this._recreateAttempts;
    console.warn(`[Sokuji] [PtDiag] recreating player AudioContext (attempt ${attempt}/3)`);

    // Preserve user-visible state across rebuild
    const savedSinkId = this.outputDeviceId;
    const savedVolume = this.globalVolumeMultiplier;
    const oldContext = this.context;

    // Tear down everything pinned to the dead context. Use defensive
    // disconnect/null guards — any of these may already be in a half-broken
    // state, and we don't want a single failure to abort the rebuild.
    try {
      if (this.workletNode) {
        try { this.workletNode.port.onmessage = null; } catch (e) { /* ignore */ }
        try { this.workletNode.disconnect(); } catch (e) { /* ignore */ }
      }
      if (this.gainNode) { try { this.gainNode.disconnect(); } catch (e) { /* ignore */ } }
      if (this.analyser) { try { this.analyser.disconnect(); } catch (e) { /* ignore */ } }
      if (this.destinationNode) { try { this.destinationNode.disconnect(); } catch (e) { /* ignore */ } }
      if (this.audioElement) {
        try { this.audioElement.pause(); } catch (e) { /* ignore */ }
        try { this.audioElement.srcObject = null; } catch (e) { /* ignore */ }
      }
      if (oldContext && oldContext.state !== 'closed') {
        try { await oldContext.close(); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn('[Sokuji] [PtDiag] teardown during recreate threw:', (e && e.message) || e);
    }

    // Null out every ref so connect() builds fresh state.
    this.context = null;
    this.workletNode = null;
    this.gainNode = null;
    this.analyser = null;
    this.destinationNode = null;
    this.audioElement = null;
    this._sab = null;
    this._indices = null;
    this._data = null;
    this._ptSab = null;
    this._ptIndices = null;
    this._ptData = null;
    this._workletReady = false;
    this._workletState = 'stopped';
    // Old playback queue is unrecoverable.
    this.itemQueue = [];
    this._audibleItemId = null;
    this._totalSamplesEnqueued = 0;
    this.totalPlayedSamples = 0;
    this._pendingWrites = [];
    this._cancelDrain();
    // Preserve fields connect() reads to restore previous output device.
    this.outputDeviceId = savedSinkId;
    this.globalVolumeMultiplier = savedVolume;

    try {
      await this.connect();
      // connect() applies setSinkId on the HTMLAudioElement via outputDeviceId.
      // Also re-apply on the AudioContext to restore the consumer clock domain.
      if (savedSinkId && this.context && typeof this.context.setSinkId === 'function') {
        try {
          await this.context.setSinkId(savedSinkId);
        } catch (e) {
          console.warn('[Sokuji] [PtDiag] post-recreate ctx.setSinkId failed:', (e && (e.message || e.name)) || e);
        }
      }
      console.info(`[Sokuji] [PtDiag] context recreated successfully (attempt ${attempt})`);
    } catch (e) {
      console.error('[Sokuji] [PtDiag] connect() during recreate failed:', (e && e.message) || e);
    } finally {
      this._recreatingContext = false;
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
      // Issue #246: surface setSinkId results for both the HTMLAudioElement and
      // the AudioContext. Whether `context.setSinkId` succeeds determines which
      // physical device drives the consumer-side clock of the passthrough ring.
      let elemSinkOk = '(not-attempted)';
      if (this.audioElement && typeof this.audioElement.setSinkId === 'function') {
        try {
          await this.audioElement.setSinkId(deviceId);
          elemSinkOk = 'ok';
        } catch (e) {
          elemSinkOk = `error:${e?.name || e?.message || e}`;
          throw e;
        }
      } else {
        elemSinkOk = '(unsupported)';
      }

      let ctxSinkOk = '(not-attempted)';
      if (this.context && typeof this.context.setSinkId === 'function') {
        try {
          await this.context.setSinkId(deviceId);
          ctxSinkOk = 'ok';
        } catch (e) {
          // Do not propagate — historical behavior swallows ctx setSinkId failures.
          ctxSinkOk = `error:${e?.name || e?.message || e}`;
        }
      } else {
        ctxSinkOk = '(unsupported)';
      }

      const resolvedCtxSink = (this.context && typeof this.context.sinkId !== 'undefined')
        ? (this.context.sinkId || '(default)')
        : '(unsupported)';
      const resolvedElemSink = (this.audioElement && typeof this.audioElement.sinkId !== 'undefined')
        ? (this.audioElement.sinkId || '(default)')
        : '(unsupported)';
      console.info(
        `[Sokuji] [PtDiag] setSinkId requested deviceId=${deviceId} | ` +
        `elemSetSinkId=${elemSinkOk} ctxSetSinkId=${ctxSinkOk} | ` +
        `resolved playerElemSink=${resolvedElemSink} playerCtxSink=${resolvedCtxSink}`
      );

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
   * Safety-net 'ended' notification, armed when the worklet enters 'starving'.
   *
   * Under normal operation the worklet also flushes a final readPosition on
   * the same transition (see playback-ring-processor.js), which makes
   * _checkAudibleItemChange evict the entry and fire 'ended' immediately —
   * by the time this 2s timer runs, _audibleItemId is already null and the
   * inner conditional becomes a no-op. We keep the timer as a fallback in
   * case the flush is ever lost or the playhead never quite crosses the
   * entry boundary.
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

    if (this._autoResumeTimer) {
      clearTimeout(this._autoResumeTimer);
      this._autoResumeTimer = null;
    }
    if (this._recreateDeadlineTimer) {
      clearTimeout(this._recreateDeadlineTimer);
      this._recreateDeadlineTimer = null;
    }

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
   * Get passthrough-buffer diagnostic snapshot (issue #246).
   *
   * Purpose: observe whether passthrough samples accumulate over time (clock
   * drift between recorder AudioContext and player AudioContext) and whether
   * the buffer is dropping chunks.
   */
  getPassthroughDiagnostics() {
    if (!this._ptIndices) return null;
    const w = Atomics.load(this._ptIndices, 0);
    const r = Atomics.load(this._ptIndices, 1);
    const used = w - r;
    const ctxSinkId = (this.context && typeof this.context.sinkId !== 'undefined')
      ? (this.context.sinkId || '(default)')
      : '(unsupported)';
    const elemSinkId = (this.audioElement && typeof this.audioElement.sinkId !== 'undefined')
      ? (this.audioElement.sinkId || '(default)')
      : '(unsupported)';
    return {
      sampleRate: this.sampleRate,
      ptCapacity: this._ptCapacity,
      ptCapacityMs: (this._ptCapacity / this.sampleRate * 1000) | 0,
      ptUsed: used,
      ptUsedMs: (used / this.sampleRate * 1000) | 0,
      ptWriteIdx: w,
      ptReadIdx: r,
      ptSamplesWritten: this._ptSamplesWritten,
      ptSamplesDropped: this._ptSamplesDropped,
      ptDropEvents: this._ptDropEvents,
      ptSamplesSkippedSilent: this._ptSamplesSkippedSilent,
      workletState: this._workletState,
      contextState: this.context ? this.context.state : '(no-context)',
      contextSinkId: ctxSinkId,
      audioElementSinkId: elemSinkId,
      configuredOutputDeviceId: this.outputDeviceId || '(none)',
    };
  }

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
