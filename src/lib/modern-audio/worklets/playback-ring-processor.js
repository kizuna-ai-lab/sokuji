/**
 * AudioWorklet processor with SharedArrayBuffer ring buffer for gapless playback.
 *
 * SharedArrayBuffer layout:
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

    // Shared memory views (set on 'init' message)
    this._indices = null;  // Int32Array over SAB[0..15]
    this._data = null;     // Float32Array over SAB[16..]
    this._capacity = 0;
    this._ready = false;
    this._playing = true;

    // State tracking
    this._state = 'stopped'; // 'stopped' | 'playing' | 'starving'
    this._samplesPlayed = 0;
    this._lastPositionReport = 0;
    this._positionReportInterval = Math.floor(sampleRate * 0.05); // ~50ms

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'init') {
        // Receive SharedArrayBuffer and create views
        this._indices = new Int32Array(msg.sab, 0, 4);
        this._data = new Float32Array(msg.sab, 16);
        this._capacity = Atomics.load(this._indices, 2);
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

    // Read writeIndex (written by main thread)
    const writeIdx = Atomics.load(this._indices, 0);
    const readIdx = Atomics.load(this._indices, 1);
    const available = writeIdx - readIdx; // always >= 0 in SPSC with monotonic indices

    if (available <= 0) {
      channel.fill(0);
      if (this._state === 'playing') {
        this._setState('starving');
      }
      return true;
    }

    if (this._state !== 'playing') {
      this._setState('playing');
    }

    const samplesToRead = Math.min(frameSize, available);
    const cap = this._capacity;

    // Read from ring buffer with wrap-around
    for (let i = 0; i < samplesToRead; i++) {
      channel[i] = this._data[(readIdx + i) % cap];
    }

    // Zero-fill remainder
    if (samplesToRead < frameSize) {
      channel.fill(0, samplesToRead);
    }

    // Update readIndex (only this thread writes it)
    Atomics.store(this._indices, 1, readIdx + samplesToRead);

    this._samplesPlayed += samplesToRead;

    // Periodic position report (low frequency — for UI progress tracking)
    if (this._samplesPlayed - this._lastPositionReport >= this._positionReportInterval) {
      this._lastPositionReport = this._samplesPlayed;
      this.port.postMessage({ type: 'readPosition', samplesPlayed: this._samplesPlayed });
    }

    return true;
  }
}

registerProcessor('playback-ring-processor', PlaybackRingWorkletProcessor);
