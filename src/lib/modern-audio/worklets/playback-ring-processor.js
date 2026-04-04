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
