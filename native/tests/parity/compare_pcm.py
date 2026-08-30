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
    a = np.asarray(a, dtype=np.float64).reshape(-1)
    b = np.asarray(b, dtype=np.float64).reshape(-1)
    if a.shape != b.shape:
        raise ValueError(f"length mismatch: {a.shape[0]} vs {b.shape[0]}")
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


def _read_wav(path: str) -> np.ndarray:
    import soundfile as sf
    data, _sr = sf.read(path, dtype="float32", always_2d=False)
    return data if data.ndim == 1 else data.mean(axis=1)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("ref"); p.add_argument("got")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--exact", action="store_true")
    g.add_argument("--min-snr", type=float)
    args = p.parse_args(argv)
    r = compare(_read_wav(args.ref), _read_wav(args.got))
    ok = verdict(r, exact=args.exact, min_snr=args.min_snr)
    print(f"n={r.n} max_abs={r.max_abs:.3e} snr={r.snr_db:.2f} dB -> {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
