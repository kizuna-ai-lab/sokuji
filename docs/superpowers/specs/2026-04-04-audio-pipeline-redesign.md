# Audio Pipeline Redesign: AudioWorklet Ring Buffer Player

**Date:** 2026-04-04
**Issue:** [#172](https://github.com/kizuna-ai-lab/sokuji/issues/172) — Audio artifacts and crackling in TTS playback
**Branch:** `worktree-audio-pipeline-redesign`

## Problem

The current `ModernAudioPlayer` creates a **new HTMLAudioElement per audio chunk** (~20ms each):

```
PCM chunk → createWavBlob() → URL.createObjectURL() → new Audio() → play()
  → onended → next chunk → new Audio() → play() → ...
```

This causes:
1. **Inter-chunk gaps**: Each HTMLAudioElement has its own media pipeline setup time. Even 1-2ms gaps between elements produce audible clicks/pops that compound into crackling.
2. **GC pressure**: Dozens of Audio elements, blob URLs, and WAV buffers created per second.
3. **Independent resampling**: Each small 24kHz chunk is resampled independently by the browser, introducing artifacts at boundaries.

The previous fix attempt (increasing buffer threshold to 200ms, commit 09d53da) was reverted because the added latency was unacceptable for real-time translation.

## Constraints

1. **AEC compatibility**: The final audio output must go through HTMLAudioElement so Chromium's echo cancellation can use it as a reference signal. This works in both Chrome (ChromeWideEchoCancellation) and Electron 40 (Chromium 134).
2. **Low latency**: Real-time simultaneous translation requires minimal playback delay.
3. **Virtual microphone path unchanged**: The extension's `sendPcmDataToTabs()` → content script → `MediaStreamTrackGenerator` path is unaffected. The crackling bug only manifests in local speaker playback.
4. **Preserved API surface**: `ModernAudioPlayer`'s public API (addStreamingAudio, stopTrack, setGlobalVolume, etc.) must remain compatible with `ModernBrowserAudioService`.

## Design

### Architecture

Replace the per-chunk HTMLAudioElement playback with a continuous AudioWorklet ring buffer that feeds a single persistent HTMLAudioElement via MediaStream:

```
PCM chunks
  → postMessage to AudioWorkletNode
    → Ring buffer (continuous pull, 128 samples per process() call)
      → GainNode (volume control)
        → AnalyserNode (visualization)
          → MediaStreamDestinationNode
            → Single persistent HTMLAudioElement.srcObject
              → Speakers (AEC-visible)
```

### Component 1: PlaybackRingWorkletProcessor (new file)

**File:** `src/lib/modern-audio/worklets/playback-ring-processor.js`

An AudioWorkletProcessor that maintains a circular buffer and outputs audio continuously.

```
Ring Buffer (capacity: 2s = sampleRate * 2 samples)
  ├── writeIndex: where new data is written
  ├── readIndex: where process() reads from
  └── available(): writeIndex - readIndex (modular)
```

**Messages received via port.onmessage:**
- `{ type: 'write', samples: Float32Array }` — append PCM to ring buffer
- `{ type: 'clear' }` — reset ring buffer (on track interruption)
- `{ type: 'setPlaying', playing: boolean }` — pause/resume output

**Messages sent via port.postMessage:**
- `{ type: 'stateChange', state: 'playing' | 'starving' | 'stopped' }` — buffer state transitions
- `{ type: 'readPosition', readIndex: number }` — periodic position report for progress tracking

**process() behavior:**
- If buffer has data → copy 128 samples to output, advance readIndex
- If buffer empty → output silence (zeros). No click, no pop.
- State transitions: `playing` when data available, `starving` when buffer runs empty after having had data

### Component 2: Redesigned ModernAudioPlayer

**File:** `src/lib/modern-audio/ModernAudioPlayer.js` (rewrite)

#### Initialization

```javascript
async init() {
  this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
  
  // Load worklet
  await this.audioContext.audioWorklet.addModule(workletUrl);
  this.workletNode = new AudioWorkletNode(this.audioContext, 'playback-ring-processor');
  
  // Build audio graph
  this.gainNode = this.audioContext.createGain();
  this.analyserNode = this.audioContext.createAnalyser();
  this.destinationNode = this.audioContext.createMediaStreamDestination();
  
  this.workletNode.connect(this.gainNode);
  this.gainNode.connect(this.analyserNode);
  this.analyserNode.connect(this.destinationNode);
  
  // Single persistent HTMLAudioElement
  this.audioElement = new Audio();
  this.audioElement.srcObject = this.destinationNode.stream;
  this.audioElement.play();
}
```

#### addStreamingAudio(data, trackId, volume, metadata)

Same sequence-ordering logic as current implementation:
1. Handle out-of-order chunks (reorder by sequenceNumber)
2. Accumulate in streamingBuffers
3. On flush: convert Int16Array → Float32Array, post to worklet

```javascript
flushStreamingBuffer(trackId) {
  const chunks = this.streamingBuffers.get(trackId);
  const combined = combineChunks(chunks);
  
  // Convert Int16 → Float32
  const float32 = new Float32Array(combined.length);
  for (let i = 0; i < combined.length; i++) {
    float32[i] = combined[i] / 32768;
  }
  
  // Write to ring buffer
  this.workletNode.port.postMessage({ type: 'write', samples: float32 });
  
  // Track metadata for progress reporting
  this.trackBufferedDuration(trackId, combined.length, metadata);
}
```

#### Volume Control

Two levels of volume, same as current code:
- **Per-track volume** (e.g. passthrough at 30%): applied to PCM data before writing to ring buffer (`applyVolume()`, same as current)
- **Global volume multiplier** (monitor on/off): controlled via GainNode

```javascript
setGlobalVolume(multiplier) {
  this.globalVolumeMultiplier = multiplier;
  this.gainNode.gain.setValueAtTime(multiplier, this.audioContext.currentTime);
}
```

#### Track Interruption (stopTrack / stopAll)

```javascript
stopTrack(trackId) {
  // Clear pending buffers
  this.streamingBuffers.delete(trackId);
  this.trackQueues.delete(trackId);
  
  // Clear ring buffer immediately
  this.workletNode.port.postMessage({ type: 'clear' });
  
  // Reset progress tracking
  this.resetTrackMetadata(trackId);
}
```

#### Output Device Switching

```javascript
async setOutputDevice(deviceId) {
  if (this.audioElement && typeof this.audioElement.setSinkId === 'function') {
    await this.audioElement.setSinkId(deviceId);
  }
  this.outputDeviceId = deviceId;
}
```

#### Playback Progress Tracking

Current code tracks progress via `audio.onended` and `audio.duration`. New approach:

- On each `write` to ring buffer, accumulate `totalBufferedDuration` per itemId
- Worklet periodically reports `readPosition` via postMessage
- Calculate `cumulativePlayedTime = readPosition / sampleRate`
- `onPlaybackStatusChange` fires on worklet state transitions (`playing` / `starving` → map to `playing` / `ended`)

```javascript
this.workletNode.port.onmessage = (e) => {
  if (e.data.type === 'stateChange') {
    if (e.data.state === 'starving' && this.currentPlayingItemId) {
      // Buffer ran out — might be end of speech or network stall
      // Defer 'ended' notification (same 2s timeout as current code)
      this.scheduleEndNotification(this.currentPlayingItemId);
    } else if (e.data.state === 'playing') {
      this.cancelEndNotification();
    }
  }
  if (e.data.type === 'readPosition') {
    this.updatePlaybackProgress(e.data.readIndex);
  }
};
```

### Component 3: Passthrough Audio

Current passthrough uses a separate delayed playback path. In the new design:

- Passthrough audio still accumulates separately (different trackId)
- Written to the same ring buffer (mixed in the worklet), OR uses a separate worklet instance at lower volume
- **Recommended: separate worklet instance** to allow independent volume control and the 50ms delay

### What's NOT Changing

- `ModernAudioRecorder` — unchanged
- `ModernBrowserAudioService.addAudioData()` — unchanged (calls same `addStreamingAudio` API)
- `ModernBrowserAudioService.sendPcmDataToTabs()` — unchanged (PCM message passing)
- `virtual-microphone.js` — unchanged
- All AI client audio emission — unchanged
- Sequence ordering / out-of-order handling — same algorithm, different output target
- `MainPanel` integration — unchanged (same callbacks)

### Buffer Sizing

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Ring buffer capacity | 2 seconds (48,000 samples at 24kHz) | Large enough to absorb network jitter without overflow |
| No pre-buffering | 0ms | Start playback immediately when first data arrives. The ring buffer outputs silence when empty (no pop), so there's no need to pre-buffer. |
| Worklet process() frame | 128 samples (~5.3ms at 24kHz) | Web Audio API standard quantum size |
| Flush threshold | 20ms (480 samples) — same as current | Unchanged; controls when accumulated chunks get written to ring buffer |

### Error Handling

- **AudioContext suspended**: Resume on user interaction (same as current)
- **Worklet load failure**: Fall back to current HTMLAudioElement approach
- **Ring buffer overflow** (writer faster than reader — shouldn't happen in real-time): Drop oldest samples, log warning
- **Ring buffer underrun** (reader faster than writer — normal during gaps): Output silence, report `starving` state

### Migration Strategy

1. New `PlaybackRingWorkletProcessor` worklet file — no conflict with existing code
2. Rewrite `ModernAudioPlayer.js` — replace playback engine while preserving public API
3. Keep old `createWavBlob` / HTMLAudioElement code path as fallback (behind a flag or try/catch on worklet load)
4. No changes needed to any consumer (`ModernBrowserAudioService`, `MainPanel`, clients)

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/modern-audio/worklets/playback-ring-processor.js` | **Create** | AudioWorklet ring buffer processor |
| `src/lib/modern-audio/ModernAudioPlayer.js` | **Rewrite** | Replace per-chunk HTMLAudioElement with AudioWorklet + single HTMLAudioElement |
| `vite.config.ts` | **Possibly modify** | Ensure worklet file is served correctly (may already work via existing worklet config) |

## Testing Plan

- [ ] Verify gapless playback with Gemini provider (long responses, 10+ words)
- [ ] Verify no crackling/artifacts across multiple consecutive responses
- [ ] Verify AEC works in Electron (speak while TTS plays, confirm no echo feedback)
- [ ] Verify AEC works in Chrome extension side panel
- [ ] Verify virtual microphone injection still works (audio reaches content script)
- [ ] Verify volume control (global mute, volume slider)
- [ ] Verify output device switching (setSinkId)
- [ ] Verify track interruption (stop mid-playback, start new response)
- [ ] Verify visualization (AnalyserNode waveform still renders)
- [ ] Verify playback progress callbacks (itemId status: playing/ended)
- [ ] Verify passthrough audio works
- [ ] Verify fallback to old approach if AudioWorklet fails to load
- [ ] Test with OpenAI, Gemini, Palabra, KizunaAI providers
- [ ] Test with poor network conditions (irregular chunk timing)
