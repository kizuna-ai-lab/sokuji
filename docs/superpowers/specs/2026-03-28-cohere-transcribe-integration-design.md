# Cohere Transcribe WebGPU ASR Integration

**Date**: 2026-03-28
**Issue**: #153
**Status**: Design approved

## Summary

Add Cohere Transcribe (2B param Conformer encoder + Transformer decoder) as a WebGPU-based local ASR engine, registered as `asr-stream` type. Uses transformers.js v4 `pipeline()` API with VAD-chunked input and TextStreamer token-level output streaming.

## Model Details

- **HF Model**: `onnx-community/cohere-transcribe-03-2026-ONNX`
- **Architecture**: Conformer encoder + lightweight Transformer decoder, trained from scratch on 500K hours
- **Performance**: #1 on Open ASR Leaderboard (5.42% avg WER)
- **License**: Apache 2.0
- **Languages (14)**: en, de, fr, it, es, pt, el, nl, pl, ar, vi, zh, ja, ko
- **Limitations**: No auto language detection, no timestamps, no speaker diarization

### Quantization Variants

| Variant | Encoder | Decoder | Total | Requirement |
|---------|---------|---------|-------|-------------|
| q4f16 | ~1.44 GB | ~98 MB | ~1.54 GB | `shader-f16` GPU feature |
| q4 | ~2.02 GB | ~109 MB | ~2.13 GB | Universal fallback |

### ONNX Files Per Variant

Shared across variants:
- `config.json`, `generation_config.json`, `preprocessor_config.json`, `processor_config.json`, `tokenizer.json`, `tokenizer_config.json`

Per variant (e.g., q4):
- `onnx/encoder_model_q4.onnx` + `onnx/encoder_model_q4.onnx_data`
- `onnx/decoder_model_merged_q4.onnx` + `onnx/decoder_model_merged_q4.onnx_data`

## Architecture

### Registration

- **Manifest ID**: `cohere-transcribe-webgpu`
- **Type**: `asr-stream`
- **Worker type**: `cohere-transcribe-webgpu`
- **Engine**: `cohere-transcribe`
- **Required device**: `webgpu`

### Worker: `cohere-transcribe-webgpu.worker.ts`

Module worker with VAD-chunked batch inference and token streaming output.

**Components**:

1. **Silero VAD v5** (identical to Voxtral pattern)
   - ONNX InferenceSession + FrameProcessor from `@ricky0123/vad-web`
   - Resample 24kHz Int16 -> 16kHz Float32
   - Thresholds: positive 0.3, negative 0.25, redemption 1400ms, pre-speech padding 800ms
   - Max speech duration: ~20 seconds

2. **Model loading** via `pipeline()` API
   - `pipeline('automatic-speech-recognition', hfModelId, { dtype, device: 'webgpu' })`
   - IndexedDB blob URL cache bridge (`createBlobUrlCache` pattern)
   - `allowRemoteModels=false`, `useCustomCache=true`

3. **Inference flow** (batch, not continuous streaming)
   - VAD accumulates audio buffer during speech
   - On `SpeechEnd`: run `pipeline(audio, { max_new_tokens: 1024, language, streamer })`
   - `TextStreamer` with `skip_prompt: true, skip_special_tokens: true` -> partial results via postMessage
   - Pipeline completion -> final result via postMessage
   - On `SpeechStart`: notify main thread

**Message protocol**:
- Inbound: `init`, `audio`, `flush`, `dispose`
- Outbound: `ready`, `status`, `error`, `speech-start`, `partial`, `result`

### Init Message Shape

```typescript
interface CohereTranscribeAsrInitMessage {
  type: 'init';
  fileUrls: Record<string, string>;
  hfModelId: string;
  language?: string;
  dtype: string | Record<string, string>;
  vadModelUrl: string;
  ortWasmBaseUrl?: string;
}
```

### Engine & Client Integration

**StreamingAsrEngine.ts**: Add `case 'cohere-transcribe-webgpu'` to worker creation switch (module worker). Init message follows the same Voxtral path.

**LocalInferenceClient.ts**: No changes. Already dispatches to StreamingAsrEngine for `asr-stream` type.

**ModelManager.ts**: No changes. Already handles hfModelId-based models.

**modelStore.ts**: No changes. Generic model tracking.

**ModelManagementSection.tsx**: No changes. New model auto-appears via manifest.

## Edge Cases

1. **No language auto-detection**: Pass user's selected source language to pipeline. Fall back to `'en'` if unset.
2. **Long audio**: Model auto-chunks at ~35s internally. Combined with 20s VAD cap, no issue.
3. **Silence hallucination**: VAD pre-filtering prevents feeding non-speech to the model.
4. **WebGPU gating**: `requiredDevice: 'webgpu'` hides model on unsupported browsers.
5. **shader-f16 detection**: Existing `selectVariant()` handles feature detection and fallback.
6. **Flush (PTT)**: Force-finalize accumulated speech audio and run inference immediately.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/local-inference/modelManifest.ts` | New manifest entry |
| `src/lib/local-inference/types.ts` | New `CohereTranscribeAsrInitMessage` type |
| `src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts` | **New file** — worker implementation |
| `src/lib/local-inference/engine/StreamingAsrEngine.ts` | Add case to worker switch (~3 lines) |
