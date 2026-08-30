# native_bench.py

Measures real-time factor (RTF) for the native ASR path: one warm-up run (shader compile +
graph build), then `--runs` timed runs, reporting the median. Run from the repo root with the
sidecar venv (needs `sokuji_native` installed and, for streaming, an HF cache or local GGUF):

    python sidecar/bench/native_bench.py --model handy-computer/whisper-tiny-gguf/whisper-tiny-Q8_0.gguf \
        --wav native/build/cpu/_deps/transcribe-src/samples/jfk.wav --device cpu
    python sidecar/bench/native_bench.py --model handy-computer/moonshine-streaming-tiny-gguf/moonshine-streaming-tiny-Q8_0.gguf \
        --wav <clip>.wav --stream --chunk-ms 500

Reference numbers (design §2, GB10, 58 s clip, Q8_0 — CPU / Vulkan RTF):

| Model                  | CPU   | Vulkan |
|------------------------|-------|--------|
| Parakeet-v3             | 0.064 | 0.005  |
| whisper-large-v3-turbo  | 0.346 | 0.013  |
| Cohere Transcribe       | 0.190 | 0.009  |
