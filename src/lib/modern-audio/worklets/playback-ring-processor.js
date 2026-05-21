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

    // Passthrough latency control (issue #246).
    //   0 ............ 250ms  → 1.00x normal read (no pitch change)
    //   250ms ........ 800ms  → 1.01x..1.06x adaptive catch-up via fractional
    //                            read + linear interpolation. Slight pitch
    //                            rise (≤ 1 semitone) but no drops or gaps.
    //   > 800ms              → hard trim (drop oldest). Adaptive would take
    //                            >50s to recover a 10s backlog, unacceptable.
    this._ptAdaptiveStartSamples = Math.floor(sampleRate * 0.25); // 250ms
    this._ptMaxLatencySamples = Math.floor(sampleRate * 0.8);     // 800ms
    this._ptFracReadOffset = 0;  // sub-sample fractional position carry
    this._lastPtTrimReportedAt = 0;
    this._lastPtAdaptiveReportedAt = 0;

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
    this._lastPtTrimReportedAt = 0;
    this._lastPtAdaptiveReportedAt = 0;
    this._ptFracReadOffset = 0;
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
      let ptReadIdx = Atomics.load(this._ptIndices, 1);
      let ptAvailable = ptWriteIdx - ptReadIdx;

      // Hard trim above 800ms — adaptive catch-up (≤1.06x) would take
      // >50s to recover a 10s backlog after a hard stall. Worklet owns
      // readIdx, so jumping it forward is SPSC-safe.
      if (ptAvailable > this._ptMaxLatencySamples) {
        const skip = ptAvailable - this._ptMaxLatencySamples;
        ptReadIdx += skip;
        Atomics.store(this._ptIndices, 1, ptReadIdx);
        ptAvailable = this._ptMaxLatencySamples;
        this._ptFracReadOffset = 0;
        // Throttle reports to ≤1/sec — process() runs ~187x/sec at 24kHz.
        if (this._samplesPlayed - this._lastPtTrimReportedAt >= sampleRate) {
          this._lastPtTrimReportedAt = this._samplesPlayed;
          this.port.postMessage({ type: 'ptTrim', skipped: skip });
        }
      }

      if (ptAvailable > 0) {
        const ptCap = this._ptCapacity;

        // Map backlog [250ms..800ms] → ratio [1.00x..1.06x].
        // Below 250ms: 1.00x (no interpolation needed).
        // Above 800ms: hard trim already applied above, so backlog now caps
        // at 800ms and ratio caps at 1.06x.
        let ratio = 1.0;
        if (ptAvailable > this._ptAdaptiveStartSamples) {
          const adaptiveSpan = this._ptMaxLatencySamples - this._ptAdaptiveStartSamples;
          const overshoot = ptAvailable - this._ptAdaptiveStartSamples;
          const t = overshoot < adaptiveSpan ? overshoot / adaptiveSpan : 1;
          ratio = 1.0 + t * 0.06;
          // Throttled report (≤1/sec) so we can see when adaptive catch-up
          // kicks in. Same throttle as trim.
          if (this._samplesPlayed - this._lastPtAdaptiveReportedAt >= sampleRate) {
            this._lastPtAdaptiveReportedAt = this._samplesPlayed;
            this.port.postMessage({
              type: 'ptAdaptive',
              ratio,
              backlogMs: ((ptAvailable / sampleRate) * 1000) | 0,
            });
          }
        }

        if (ratio === 1.0) {
          // Fast path — integer step, no interpolation.
          const ptSamples = Math.min(frameSize, ptAvailable);
          for (let i = 0; i < ptSamples; i++) {
            channel[i] += this._ptData[(ptReadIdx + i) % ptCap];
          }
          Atomics.store(this._ptIndices, 1, ptReadIdx + ptSamples);
          this._ptFracReadOffset = 0;
        } else {
          // Adaptive — fractional step with linear interpolation between
          // adjacent ring samples. Produces frameSize output samples while
          // consuming frameSize*ratio input samples.
          // Need 1 extra sample for interpolating the last frame; otherwise
          // fall back to whatever we can read this quantum.
          const frac = this._ptFracReadOffset;
          const usable = ptAvailable - 1;
          const inputBudget = frameSize * ratio + frac;
          const ptSamples = inputBudget <= usable
            ? frameSize
            : Math.max(0, Math.floor((usable - frac) / ratio));

          for (let i = 0; i < ptSamples; i++) {
            const srcPos = frac + i * ratio;
            const srcIdx = srcPos | 0;
            const f = srcPos - srcIdx;
            const s0 = this._ptData[(ptReadIdx + srcIdx) % ptCap];
            const s1 = this._ptData[(ptReadIdx + srcIdx + 1) % ptCap];
            channel[i] += s0 + (s1 - s0) * f;
          }

          const totalAdvance = frac + ptSamples * ratio;
          const intAdvance = totalAdvance | 0;
          this._ptFracReadOffset = totalAdvance - intAdvance;
          Atomics.store(this._ptIndices, 1, ptReadIdx + intAdvance);
        }
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
      // Flush the final position now that the main buffer just emptied.
      // Periodic reports only fire when _samplesPlayed grows by an interval,
      // so without this flush the last partial interval (up to ~50ms) is
      // never delivered — leaving the main thread's totalPlayedSamples
      // short of the actual end, which (a) freezes the karaoke highlight
      // a character or two from the end and (b) prevents
      // _checkAudibleItemChange from observing the playhead cross the last
      // entry, forcing the 2s _scheduleEndNotification fallback path.
      this.port.postMessage({ type: 'readPosition', samplesPlayed: this._samplesPlayed });
      this._lastPositionReport = this._samplesPlayed;
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
