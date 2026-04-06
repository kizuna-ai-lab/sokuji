# GTCRN Noise Suppression Design

**Issue:** #178
**Date:** 2026-04-07

## Summary

Add GTCRN (Gated Temporal Convolutional Recurrent Network) as a higher-quality noise suppression option alongside the existing RNNoise implementation. Users choose between three modes: Off, Standard (RNNoise), Enhanced (GTCRN).

## Architecture & Data Flow

Three noise suppression modes through a unified interface in `ModernAudioRecorder`:

```
Mode: Off
  Mic → AudioWorklet (Float32→Int16 48kHz) → Downsample → onAudioData

Mode: Standard (RNNoise)
  Mic → RnnoiseWorkletNode → AudioWorklet → Downsample → onAudioData
  (unchanged from current implementation — operates in Web Audio graph at 48kHz)

Mode: Enhanced (GTCRN)
  Mic → AudioWorklet (capture raw Int16 48kHz)
       → postMessage to GTCRN Worker
       → Worker: buffer 20ms frame → STFT → GTCRN(ORT) → ISTFT → postMessage back
       → Main thread receives denoised Int16 48kHz
       → Downsample → onAudioData
```

Key decisions:
- RNNoise path is untouched — stays as an AudioNode in the Web Audio graph
- GTCRN processes post-capture via Web Worker with ONNX Runtime Web
- Analyser node connects post-suppression for frequency visualization
- Switching modes during active recording is supported

## GTCRN Worker

New ES module worker at `src/lib/modern-audio/gtcrn/gtcrn-worker.ts`.

### Initialization
- Loads ONNX Runtime Web from bundled WASM at `./wasm/ort/`
- Loads bundled GTCRN ONNX model (~2MB, bundled with the app)
- Extracts model metadata: `n_fft`, `hop_length`, `window_length`, `sample_rate` (16kHz)
- Creates initial RNN hidden states (zero tensors for `conv_cache`, `tra_cache`, `inter_cache`)
- Pre-computes Hann window for STFT/ISTFT

### Audio Processing (per message)
1. Receive `Int16Array` chunk (48kHz) from main thread
2. Convert Int16 → Float32, resample 48kHz → 16kHz (GTCRN's native rate)
3. Append to internal ring buffer
4. While buffer has enough samples for one hop:
   - Extract frame, apply window, compute FFT (real-valued → complex spectrum)
   - Run GTCRN inference: input spectrum + RNN states → enhanced spectrum + new states
   - Overlap-add ISTFT to output buffer
5. Resample output 16kHz → 48kHz
6. Convert Float32 → Int16, postMessage back

### FFT
Bundled radix-2 FFT implementation (~100 lines). The model's `n_fft` is 512 (32ms at 16kHz), power-of-2 friendly.

### State Management
- RNN states persist across `Run()` calls for continuous streaming
- On `reset` message: reinitialize states to zeros (when recording restarts)

### Message Protocol

```typescript
// Main → Worker
{ type: 'init' }                         // Load model
{ type: 'process', audio: Int16Array }   // Process chunk
{ type: 'reset' }                        // Reset RNN states
{ type: 'dispose' }                      // Cleanup

// Worker → Main
{ type: 'ready' }                        // Model loaded
{ type: 'audio', audio: Int16Array }     // Denoised chunk
{ type: 'error', message: string }       // Error
```

## Integration in ModernAudioRecorder

### Property Changes
- New: `noiseSuppressionMode: 'off' | 'standard' | 'enhanced'`
- Replaces the boolean `_noiseSuppressEnabled`

### Method Changes
- New: `setNoiseSuppressionMode(mode: 'off' | 'standard' | 'enhanced')`
  - `'off'` → remove RNNoise node if present, disconnect GTCRN worker if present
  - `'standard'` → disconnect GTCRN worker if present, insert RNNoise node (existing logic)
  - `'enhanced'` → remove RNNoise node if present, initialize and connect GTCRN worker
- Keep: `setNoiseSuppressionEnabled(boolean)` as thin wrapper (`true → 'standard'`, `false → 'off'`) for backward compatibility

### GTCRN Worker Lifecycle
- Created lazily on first `'enhanced'` selection
- Kept alive across mode switches (paused/resumed) to avoid reload cost
- Disposed on `quit()`

### Audio Routing When GTCRN Active
- AudioWorklet's `onmessage` callback intercepted — chunks forwarded to GTCRN worker instead of direct downsample path
- Worker's `onmessage` delivers denoised Int16, which continues through normal downsample → onAudioData path
- No changes to BaseAudioRecorder or the AudioWorklet processor itself

## UI & Settings

### Settings Store (`audioStore.ts`)
- New field: `noiseSuppressionMode: 'off' | 'standard' | 'enhanced'` (persisted)
- Default: `'off'`
- Migration: existing `noiseSuppression: true → 'standard'`, `false → 'off'`

### AudioDeviceSection UI
Replace current toggle with three-option segmented control:

```
Noise Suppression: [Off] [Standard] [Enhanced]
```

Single tooltip on the control explaining all three modes:
- **Off** — Browser's built-in noise handling only
- **Standard (RNNoise)** — Lightweight AI noise suppression, low latency
- **Enhanced (GTCRN)** — High-quality AI noise suppression, best for complex noise environments

Changes take effect immediately during active sessions.

### i18n
Add keys for all 35+ locales:
- Mode labels: `settings.noiseSuppression.off`, `.standard`, `.enhanced`
- Tooltip descriptions for each mode
- Update existing noise suppression tooltip content

### Analytics (`analytics.ts`)
- Track noise suppression mode selection
- Track mode switches during active sessions

## Error Handling

### Fallback Chain
```
Enhanced (GTCRN) → Standard (RNNoise) → Off
```
Automatic fallback, never the reverse. Audio must never be silenced.

### GTCRN Worker Failures
- If worker fails to initialize (ORT WASM load failure): fall back to `'standard'`, update store and UI, log the error
- If worker stops responding during recording: disconnect and fall back to `'standard'`
- If RNNoise also fails: fall back to `'off'` (direct passthrough)

### WASM SIMD
ONNX Runtime Web handles SIMD detection internally. No extra work needed.

## Model Delivery
GTCRN ONNX model bundled with the app at `public/models/gtcrn/gtcrn_simple.onnx`. No download step required.

**Model source:** `gtcrn_simple.onnx` from https://github.com/Xiaobin-Rong/gtcrn/tree/main/stream/onnx_models — this is the simplified ONNX export optimized for inference (same model used by sherpa-onnx).

**Model parameters:** 48.2K params, 33.0 MMACs/s, RTF 0.07 on Intel i5-12400. Trained on DNS3 dataset.

## Files to Create
- `src/lib/modern-audio/gtcrn/gtcrn-worker.ts` — GTCRN Worker with ORT inference
- `src/lib/modern-audio/gtcrn/fft.ts` — Radix-2 FFT/IFFT implementation
- `src/lib/modern-audio/gtcrn/audio-utils.ts` — Resample, windowing, STFT/ISTFT helpers
- `public/models/gtcrn/gtcrn_simple.onnx` — Bundled GTCRN model from upstream repo

## Files to Modify
- `src/lib/modern-audio/ModernAudioRecorder.ts` — New mode property, `setNoiseSuppressionMode()`, GTCRN worker lifecycle and audio routing
- `src/lib/modern-audio/ModernBrowserAudioService.ts` — Expose new mode method
- `src/stores/audioStore.ts` — New `noiseSuppressionMode` field with migration
- `src/components/Settings/sections/AudioDeviceSection.tsx` — Replace toggle with segmented control, update tooltip
- `src/lib/analytics.ts` — Track mode selection
- `src/locales/*/translation.json` — New i18n keys (35+ files)
- `src/components/MainPanel/MainPanel.tsx` — Wire new mode to recorder (if needed)
