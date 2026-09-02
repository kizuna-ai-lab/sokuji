"""Compare two PCM signals: max absolute difference and SNR (dB) of b against a.

Used by the audio.cpp parity gate (spec §9.2): CPU runs must be sample-exact, Vulkan runs
must reach SNR >= 60 dB. Standalone CLI:
    python compare_pcm.py ref.wav got.wav --exact
    python compare_pcm.py ref.wav got.wav --min-snr 60
"""
from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Result:
    max_abs: float
    snr_db: float
    n: int


def compare(a: np.ndarray, b: np.ndarray) -> Result:
    # Shapes are compared as given — (frames,) or (frames, channels) — never flattened or
    # downmixed: a stereo output with swapped channels must not look identical to its
    # reference, and a mono file must not compare equal to a stereo one.
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    if a.shape != b.shape:
        raise ValueError(f"shape mismatch: {a.shape} vs {b.shape}")
    diff = a - b
    max_abs = float(np.max(np.abs(diff))) if a.size else 0.0
    noise = float(np.sum(diff * diff))
    signal = float(np.sum(a * a))
    snr = math.inf if noise == 0.0 else (10.0 * math.log10(signal / noise) if signal > 0 else -math.inf)
    return Result(max_abs=max_abs, snr_db=snr, n=int(a.size))


def verdict(r: Result, exact: bool = False, min_snr: float | None = None) -> bool:
    if exact:
        return r.max_abs == 0.0
    if min_snr is not None:
        return r.snr_db >= min_snr
    raise ValueError("choose exact=True or min_snr=<dB>")


def _read_wav(path: str) -> tuple[np.ndarray, int]:
    """(samples, sample_rate); samples are (frames,) for mono, (frames, channels) otherwise."""
    import soundfile as sf
    data, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    return data, int(sample_rate)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("ref")
    p.add_argument("got")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--exact", action="store_true")
    g.add_argument("--min-snr", type=float)
    args = p.parse_args(argv)
    ref, ref_rate = _read_wav(args.ref)
    got, got_rate = _read_wav(args.got)
    if ref_rate != got_rate:
        raise ValueError(f"sample-rate mismatch: {ref_rate} vs {got_rate}")
    r = compare(ref, got)
    ok = verdict(r, exact=args.exact, min_snr=args.min_snr)
    print(f"n={r.n} max_abs={r.max_abs:.3e} snr={r.snr_db:.2f} dB -> {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
