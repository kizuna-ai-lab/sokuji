/**
 * AudioWorklet processor with SharedArrayBuffer ring buffer for gapless playback.
 *
 * Two ring buffers are mixed additively every render quantum:
 *   1. Main ring buffer  — TTS / streamed AI audio (FIFO, may buffer ahead)
 *   2. Passthrough ring buffer — real-time mic passthrough (low-latency, small)
 *
 * SharedArrayBuffer layout (same for both buffers):
 *   Int32[0] = writeIndex (main thread writes, worklet reads — monotonically increasing)
 *   Int32[1] = readIndex  (worklet writes, main thread reads — monotonically increasing)
 *   Int32[2] = capacity
 *   Int32[3] = flags      (reserved)
 *   Float32[offset 16...] = audio data (capacity floats)
 *
 * SPSC (Single Producer Single Consumer) lock-free pattern:
 *   - Main thread is the sole writer of writeIndex and audio data
 *   - Worklet is the sole writer of readIndex
 *   - Both use Atomics for index access to ensure visibility across threads
 *   - Data array needs no atomics (SPSC guarantees no concurrent access to same region)
 */
class PlaybackRingWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Main ring buffer views (set on 'init' message)
    this._indices = null;  // Int32Array over SAB[0..15]
    this._data = null;     // Float32Array over SAB[16..]
    this._capacity = 0;
    this._ready = false;
    this._playing = true;

    // Passthrough ring buffer views (set on 'init' message)
    this._ptIndices = null;
    this._ptData = null;
    this._ptCapacity = 0;

    // State tracking
    this._state = 'stopped'; // 'stopped' | 'playing' | 'starving'
    this._samplesPlayed = 0;
    this._lastPositionReport = 0;
    this._positionReportInterval = Math.floor(sampleRate * 0.05); // ~50ms

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'init') {
        // Main ring buffer
        this._indices = new Int32Array(msg.sab, 0, 4);
        this._data = new Float32Array(msg.sab, 16);
        this._capacity = Atomics.load(this._indices, 2);

        // Passthrough ring buffer (optional — backwards compatible)
        if (msg.ptSab) {
          this._ptIndices = new Int32Array(msg.ptSab, 0, 4);
          this._ptData = new Float32Array(msg.ptSab, 16);
          this._ptCapacity = Atomics.load(this._ptIndices, 2);
        }

        this._ready = true;
      } else if (msg.type === 'clear') {
        this._clear();
      } else if (msg.type === 'setPlaying') {
        this._playing = msg.playing;
      }
    };
  }

  _clear() {
    // SPSC-safe: consumer (worklet) only resets its own internal state.
    // The producer (main thread) handles index reset by setting writeIdx = readIdx.
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

    if (!this._ready || !this._playing) {
      channel.fill(0);
      return true;
    }

    // --- Read from main ring buffer ---
    const writeIdx = Atomics.load(this._indices, 0);
    const readIdx = Atomics.load(this._indices, 1);
    const available = writeIdx - readIdx;

    let mainSamples = 0;
    if (available > 0) {
      mainSamples = Math.min(frameSize, available);
      const cap = this._capacity;
      for (let i = 0; i < mainSamples; i++) {
        channel[i] = this._data[(readIdx + i) % cap];
      }
      Atomics.store(this._indices, 1, readIdx + mainSamples);
    }

    // Zero-fill any remainder not covered by main buffer
    if (mainSamples < frameSize) {
      channel.fill(0, mainSamples);
    }

    // --- Mix in passthrough ring buffer (additive) ---
    if (this._ptIndices) {
      const ptWriteIdx = Atomics.load(this._ptIndices, 0);
      const ptReadIdx = Atomics.load(this._ptIndices, 1);
      const ptAvailable = ptWriteIdx - ptReadIdx;

      if (ptAvailable > 0) {
        const ptSamples = Math.min(frameSize, ptAvailable);
        const ptCap = this._ptCapacity;
        for (let i = 0; i < ptSamples; i++) {
          channel[i] += this._ptData[(ptReadIdx + i) % ptCap];
        }
        Atomics.store(this._ptIndices, 1, ptReadIdx + ptSamples);
      }
    }

    // --- State tracking (based on main buffer only — passthrough is ambient) ---
    const hasMainAudio = mainSamples > 0;

    if (hasMainAudio) {
      if (this._state !== 'playing') {
        this._setState('playing');
      }
      this._samplesPlayed += mainSamples;
    } else if (this._state === 'playing') {
      this._setState('starving');
    }

    // Periodic position report (low frequency — for UI progress tracking)
    if (this._samplesPlayed - this._lastPositionReport >= this._positionReportInterval) {
      this._lastPositionReport = this._samplesPlayed;
      this.port.postMessage({ type: 'readPosition', samplesPlayed: this._samplesPlayed });
    }

    return true;
  }
}

registerProcessor('playback-ring-processor', PlaybackRingWorkletProcessor);
