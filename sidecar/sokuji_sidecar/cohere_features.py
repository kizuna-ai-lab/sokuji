"""Numpy port of transformers' CohereAsrFeatureExtractor (NeMo
FilterbankFeatures) — the torch-free front end of the Cohere Transcribe ORT
backend. Verified against the reference extractor in tests (golden parity).

Reference semantics (single clip, dither disabled for determinism):
  1. preemphasis 0.97: y[0]=x[0], y[t]=x[t]-0.97*x[t-1]
  2. torch.stft(n_fft=512, hop=160, win=400, hann(400, periodic=False),
     center=True, pad_mode="constant") — the 400-tap window is zero-padded
     centered to 512; the signal is zero-padded by 256 on both sides
  3. power spectrum -> librosa-style Slaney mel (128 mels, fmin 0, fmax 8000,
     norm="slaney", FLOAT32 filterbank like the reference)
  4. log(mel + 2**-24)
  5. per-feature normalization over valid frames: (x - mean) / (std + 1e-5),
     variance with (n-1) divisor, then padded frames zeroed
"""
import numpy as np

from .qwen3_tts.mel import mel_filterbank

_SR = 16000
_N_FFT = 512
_WIN = 400
_HOP = 160
_N_MELS = 128
_PREEMPH = 0.97
_LOG_GUARD = 2.0 ** -24        # 5.96e-08, transformers' LOG_ZERO_GUARD_VALUE
_EPS = 1e-5

_MEL_F32 = None  # lazy (n_mels, n_fft//2+1) float32 filterbank


def _mel_filters() -> np.ndarray:
    global _MEL_F32
    if _MEL_F32 is None:
        # The reference builds its filterbank with librosa (float32); matching
        # that dtype matters for bit-level closeness.
        _MEL_F32 = mel_filterbank(_SR, _N_FFT, _N_MELS, 0.0, _SR / 2).astype(np.float32)
    return _MEL_F32


def _hann_periodic_false(size: int) -> np.ndarray:
    # torch.hann_window(periodic=False) == symmetric Hann (numpy.hanning)
    n = np.arange(size, dtype=np.float64)
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * n / (size - 1))


def cohere_log_mel(samples: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(float32 samples @16k) -> (features (frames, 128) float32, valid-frame
    mask (frames,) bool). Frame count matches torch.stft(center=True):
    1 + floor(len/hop); the valid count is floor(len/hop) (the reference's
    features_lengths), the tail frame is zeroed by the mask."""
    x = np.asarray(samples, dtype=np.float32)
    if x.ndim != 1:
        x = x.reshape(-1)
    n = x.size

    # 1. preemphasis
    y = np.empty_like(x)
    if n > 0:
        y[0] = x[0]
        y[1:] = x[1:] - _PREEMPH * x[:-1]

    # 2. STFT, torch semantics: center pad n_fft//2 zeros both sides, window
    # zero-padded centered 400 -> 512
    pad = _N_FFT // 2
    padded = np.concatenate([np.zeros(pad, np.float32), y, np.zeros(pad, np.float32)])
    win = _hann_periodic_false(_WIN)
    wpad = np.zeros(_N_FFT, dtype=np.float64)
    left = (_N_FFT - _WIN) // 2
    wpad[left:left + _WIN] = win

    n_frames = 1 + (padded.size - _N_FFT) // _HOP
    frames = np.lib.stride_tricks.sliding_window_view(padded, _N_FFT)[::_HOP][:n_frames]
    spec = np.fft.rfft(frames.astype(np.float64) * wpad, n=_N_FFT, axis=1)
    power = (spec.real ** 2 + spec.imag ** 2).astype(np.float32)  # (frames, bins)

    # 3-4. mel + log
    mel = power @ _mel_filters().T                        # (frames, 128)
    logmel = np.log(mel + _LOG_GUARD)

    # 5. per-feature normalize over the valid frames
    valid = (n + 2 * pad - _N_FFT) // _HOP                # reference features_lengths
    mask = np.arange(n_frames) < valid
    v = logmel[:valid]
    mean = v.mean(axis=0)
    std = np.sqrt(((v - mean) ** 2).sum(axis=0) / max(valid - 1, 1))
    out = (logmel - mean) / (std + _EPS)
    out[~mask] = 0.0
    return out.astype(np.float32), mask
