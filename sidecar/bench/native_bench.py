"""RTF bench for the native ASR path (spec §9.6): warm-up, N timed runs, median RTF, the
transcript's head. Compare against the numbers recorded in the design (§2: Parakeet-v3
0.064 CPU / 0.005 Vulkan; whisper-large-v3-turbo 0.346 / 0.013; Cohere 0.190 / 0.009 on the
GB10, 58 s clip, Q8_0) and against a new upstream pin before bumping it.

    python sidecar/bench/native_bench.py --model handy-computer/whisper-tiny-gguf/whisper-tiny-Q8_0.gguf \
        --wav native/build/cpu/_deps/transcribe-src/samples/jfk.wav --device cpu
    python sidecar/bench/native_bench.py --model handy-computer/moonshine-streaming-tiny-gguf/moonshine-streaming-tiny-Q8_0.gguf \
        --wav <clip>.wav --stream --chunk-ms 500

`--model` is an HF artifact "org/repo/file.gguf" (downloaded into the HF cache) or a path.
Vulkan figures need a Vulkan-lane wheel (the CI linux-arm64 artifact on the GB10).
"""
import argparse
import os
import statistics
import sys
import time
import wave

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))   # sokuji_sidecar importable from the repo
from sokuji_sidecar import native  # noqa: E402
from sokuji_sidecar.catalog import split_artifact  # noqa: E402


def read_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, "16 kHz mono 16-bit WAV"
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def resolve_model(ref: str) -> str:
    if os.path.exists(ref):
        return ref
    from huggingface_hub import hf_hub_download
    repo, fname = split_artifact(ref)
    return hf_hub_download(repo, fname)


def run_once(model, pcm, stream: bool, chunk: int) -> tuple[float, str]:
    t0 = time.perf_counter()
    if stream:
        st = model.open_stream("en")
        for off in range(0, len(pcm), chunk):
            st.feed(pcm[off:off + chunk])
        text = st.finalize()
    else:
        text = model.run(pcm, "en")
    return time.perf_counter() - t0, text


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True)
    p.add_argument("--wav", required=True)
    p.add_argument("--device", default="cpu", choices=["cpu", "vulkan", "metal"])
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--stream", action="store_true")
    p.add_argument("--chunk-ms", type=int, default=500)
    a = p.parse_args(argv)

    pcm = read_wav(a.wav)
    clip_s = len(pcm) / 16000
    mod = native.module()
    model = mod.asr_load(resolve_model(a.model), native.device_for(a.device))
    caps = model.capabilities
    if a.stream and not caps.supports_streaming:
        print(f"{a.model}: no streaming support (arch={caps.arch})", file=sys.stderr)
        return 2
    chunk = a.chunk_ms * 16
    warm, _ = run_once(model, pcm, a.stream, chunk)              # cold: shader compile + graph build
    times, text = [], ""
    for _ in range(a.runs):
        t, text = run_once(model, pcm, a.stream, chunk)
        times.append(t)
    rtf = [t / clip_s for t in times]
    print(f"model={a.model} device={a.device} arch={caps.arch} mode={'stream' if a.stream else 'batch'}")
    print(f"clip_s={clip_s:.1f} warmup_s={warm:.2f} rtf_median={statistics.median(rtf):.4f} rtf_runs={[round(r, 4) for r in rtf]}")
    print(f"transcript_head={text[:120]!r}")
    model.unload()
    return 0


if __name__ == "__main__":
    sys.exit(main())
