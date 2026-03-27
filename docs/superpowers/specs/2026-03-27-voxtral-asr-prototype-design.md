# Voxtral Mini 4B Realtime ASR Prototype Design

**Date:** 2026-03-27
**Issue:** [#125](https://github.com/kizuna-ai-lab/sokuji/issues/125)
**Scope:** Feasibility prototype — ASR only, main thread, no pipeline integration

## Summary

Add a standalone prototype component to validate Voxtral Mini 4B Realtime as a WebGPU streaming ASR engine. The prototype uses `@huggingface/transformers` v4.0.0-next.7 APIs directly on the main thread, following the existing Proto component pattern (Ctrl+Shift keyboard shortcuts).

## Model Details

| Spec | Value |
|------|-------|
| Model | `onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX` |
| Quantization | q4f16 (audio_encoder, embed_tokens, decoder_model_merged) |
| Download size | ~2GB |
| Input | 16kHz mono Float32 audio |
| Languages | 13 (ar, de, en, es, fr, hi, it, nl, pt, zh, ja, ko, ru) |
| Architecture | Causal audio encoder + sliding window attention |

## Architecture

### Data Flow

```
Mic (16kHz mono) → AudioWorklet (CaptureProcessor)
                        ↓
              Float32Array buffer (accumulating in ref)
                        ↓
        VoxtralRealtimeProcessor → mel spectrogram chunks
                        ↓
    VoxtralRealtimeForConditionalGeneration.generate()
        ├── async inputFeaturesGenerator (yields chunks as audio accumulates)
        └── BaseStreamer subclass (decodes tokens progressively)
                        ↓
                  Real-time transcript in UI
```

### Key APIs from transformers.js v4

- `VoxtralRealtimeForConditionalGeneration.from_pretrained(modelId, { dtype, device: "webgpu" })` — loads ONNX model with WebGPU backend
- `VoxtralRealtimeProcessor.from_pretrained(modelId)` — tokenizer + feature extractor
- `model.generate({ input_ids, input_features: asyncGenerator, streamer })` — streaming inference with async audio chunk feeding
- `BaseStreamer` subclass — receives decoded token batches for progressive text display

### Audio Capture

Inline AudioWorklet (blob URL) captures mic at 16kHz, posts Float32Array chunks to main thread. Samples accumulate in a ref buffer. The generate pipeline consumes from this buffer via an async generator that yields mel spectrogram chunks as audio becomes available.

### Streaming Mechanism

The processor defines chunk sizes:
- `num_samples_first_audio_chunk` — initial audio needed before first inference
- `num_samples_per_audio_chunk` — subsequent chunk size
- `audio_length_per_tok` * `hop_length` — samples per output token

The async `inputFeaturesGenerator` polls the audio buffer, yielding input_features when enough samples accumulate. It batches multiple token-worth of audio when available to reduce overhead.

## Component: VoxtralAsrProto.tsx

Location: `src/lib/local-inference/VoxtralAsrProto.tsx`

### States

| State | Type | Description |
|-------|------|-------------|
| status | `'idle' \| 'loading' \| 'ready' \| 'recording' \| 'error'` | Component lifecycle |
| loadingProgress | number | Model download 0-100% |
| loadingMessage | string | Current loading step |
| transcript | string | Accumulated transcription text |
| error | string \| null | Error message |

### UI Elements

1. **Idle state**: "Load Model" button with WebGPU check
2. **Loading state**: Progress bar with percentage and status message
3. **Ready state**: "Start Recording" button
4. **Recording state**: Real-time transcript display with blinking cursor, "Stop" button
5. **Error state**: Error message with retry option

### Lifecycle

1. User clicks "Load Model" → downloads ONNX weights via WebGPU, loads processor
2. User clicks "Start Recording" → requests mic permission, starts AudioWorklet, begins `model.generate()` with streaming input
3. Tokens stream in via `BaseStreamer.put()` → decoded and appended to transcript
4. User clicks "Stop" → sets stop flag, generator breaks, audio cleanup
5. "Reset" clears transcript, returns to ready state

## Keyboard Shortcut

Register `Ctrl+Shift+V` in `App.tsx` via a `useEffect` keydown listener. When toggled, render `VoxtralAsrProto` as a full-screen overlay instead of the normal router content. Previous Proto components have been removed from the codebase, so this is a fresh implementation.

## Dependency Change

Bump `@huggingface/transformers` from `4.0.0-next.5` to `4.0.0-next.7` to get `VoxtralRealtimeForConditionalGeneration` and `VoxtralRealtimeProcessor` exports.

## Out of Scope

- Web Worker offloading (main thread only for prototype)
- Translation/TTS pipeline integration
- Model manifest / IndexedDB model management
- Session/conversation system integration
- Production UI/UX

## Success Criteria

- [ ] Model loads via WebGPU with progress indication
- [ ] Mic audio streams in and partial transcription appears in real-time
- [ ] Transcription latency feels sub-second after initial model load
- [ ] Stop/reset cleanly halts the pipeline without errors
- [ ] WebGPU unavailability is detected and shown to the user

## Reference

- [HF WebGPU demo source](https://huggingface.co/spaces/mistralai/Voxtral-Realtime-WebGPU) — `VoxtralProvider.tsx` is the primary reference for the streaming generate pattern
- [ONNX model](https://huggingface.co/onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX)
