"""Speaker-encoder log-mel spectrogram.

Numpy port of the Rust reference `mel_spectrogram` (`.superpowers/qwen3-ref/audio_mel.rs`)
from the Qwen3-TTS-ONNX-Rust project. Faithfully reproduces:

- reflect-pad by ``(n_fft - hop) // 2`` (HiFi-GAN-style pad, not librosa's center n_fft/2)
- a Hann window of ``win_size``, divided by N (not N-1), center-padded to ``n_fft``
- per-frame FFT in float64, magnitude ``sqrt(re^2 + im^2 + 1e-9)``
- a Slaney mel filterbank with Slaney normalization (matches librosa's default
  ``htk=False`` scale, verified against the Rust's own ``hz_to_mel``/``mel_to_hz``)
- ``log(max(mel, 1e-5))`` cast to float32

Frame loop is vectorized with a sliding-window view + batched ``np.fft.rfft`` instead
of the Rust's explicit per-frame loop, but the arithmetic path (float64 through FFT,
magnitude and filterbank dot product) matches exactly.
"""

import numpy as np


def _hz_to_mel_slaney(freqs: np.ndarray) -> np.ndarray:
    """Slaney (htk=False) Hz→mel: linear below 1 kHz, log-spaced above."""
    freqs = np.asanyarray(freqs, dtype=np.float64)
    f_sp = 200.0 / 3
    mels = freqs / f_sp
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    return np.where(freqs >= min_log_hz,
                    min_log_mel + np.log(np.maximum(freqs, min_log_hz) / min_log_hz) / logstep,
                    mels)


def _mel_to_hz_slaney(mels: np.ndarray) -> np.ndarray:
    """Slaney mel→Hz, inverse of _hz_to_mel_slaney."""
    mels = np.asanyarray(mels, dtype=np.float64)
    f_sp = 200.0 / 3
    freqs = mels * f_sp
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    return np.where(mels >= min_log_mel,
                    min_log_hz * np.exp(logstep * (mels - min_log_mel)),
                    freqs)


def mel_filterbank(sr: int, n_fft: int, n_mels: int, fmin: float, fmax: float) -> np.ndarray:
    """Slaney-scale, slaney-normalized triangular mel filterbank — a numpy
    re-implementation of ``librosa.filters.mel(htk=False, norm='slaney')``
    (verified bit-for-bit in tests), so the sidecar doesn't carry librosa's
    numba/llvmlite dependency chain. Returns (n_mels, 1 + n_fft // 2) float64."""
    fftfreqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    mel_pts = _mel_to_hz_slaney(np.linspace(_hz_to_mel_slaney(fmin), _hz_to_mel_slaney(fmax),
                                            n_mels + 2))
    fdiff = np.diff(mel_pts)
    ramps = mel_pts[:, None] - fftfreqs[None, :]
    lower = -ramps[:-2] / fdiff[:-1, None]
    upper = ramps[2:] / fdiff[1:, None]
    weights = np.maximum(0.0, np.minimum(lower, upper))
    # Slaney normalization: each triangle integrates to ~constant energy per band.
    enorm = 2.0 / (mel_pts[2:n_mels + 2] - mel_pts[:n_mels])
    return weights * enorm[:, None]


def _reflect_pad(samples: np.ndarray, pad: int) -> np.ndarray:
    """Reflect-pad a 1D signal by `pad` samples on each side.

    Mirrors the Rust `reflect_pad`: for signals of length 1, pad with copies of the
    single sample (numpy's own reflect mode would fail on length-1 arrays).
    """
    if pad == 0 or samples.size == 0:
        return samples
    if samples.size == 1:
        return np.concatenate([np.full(pad, samples[0]), samples, np.full(pad, samples[0])])
    # np.pad with mode="reflect" matches the Rust logic: for i in 0..pad, left sample
    # is signal[pad - i] and right sample is signal[len - 2 - i].
    return np.pad(samples, (pad, pad), mode="reflect")


def _hann_window(size: int) -> np.ndarray:
    """Hann window matching the Rust formula: 0.5 - 0.5*cos(2*pi*n/N) (divides by N)."""
    if size == 0:
        return np.zeros(0, dtype=np.float64)
    n = np.arange(size, dtype=np.float64)
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * n / size)


def _pad_center(window: np.ndarray, size: int) -> np.ndarray:
    """Center-pad (or truncate) a window to `size` samples, matching the Rust helper."""
    if window.size >= size:
        return window[:size]
    out = np.zeros(size, dtype=window.dtype)
    left = (size - window.size) // 2
    out[left:left + window.size] = window
    return out


def log_mel(samples: np.ndarray, cfg) -> np.ndarray:
    """Compute the speaker-encoder log-mel spectrogram.

    Args:
        samples: float32 1D waveform.
        cfg: `speaker_encoder` namespace with sample_rate/n_fft/hop_size/win_size/
            num_mels/fmin/fmax (see qwen3_tts.config).

    Returns:
        float32 array of shape (num_mels, frames).
    """
    n_fft = cfg.n_fft
    hop = cfg.hop_size

    if samples.size == 0 or n_fft == 0 or cfg.win_size == 0:
        return np.zeros((cfg.num_mels, 0), dtype=np.float32)

    padding = max(n_fft - hop, 0) // 2
    padded = _reflect_pad(np.asarray(samples, dtype=np.float64), padding)

    frame_count = 0 if padded.size < n_fft else 1 + (padded.size - n_fft) // hop
    if frame_count == 0:
        return np.zeros((cfg.num_mels, 0), dtype=np.float32)

    window = _pad_center(_hann_window(cfg.win_size), n_fft)

    # Build (frame_count, n_fft) view of overlapping frames without copying, then
    # trim to the exact number of frames the Rust loop would produce.
    frames = np.lib.stride_tricks.sliding_window_view(padded, n_fft)[::hop, :][:frame_count]
    windowed = frames * window  # float64, broadcasts over frame_count rows

    # rfft keeps float64 through the transform; magnitude uses the same epsilon-inside-sqrt.
    spectrum = np.fft.rfft(windowed, n=n_fft, axis=1)
    magnitude = np.sqrt(spectrum.real ** 2 + spectrum.imag ** 2 + 1e-9)  # (frame_count, freq_bins)

    mel_basis = mel_filterbank(
        cfg.sample_rate, n_fft, cfg.num_mels, cfg.fmin, cfg.fmax)  # (num_mels, freq_bins), float64

    mel = mel_basis @ magnitude.T  # (num_mels, frame_count), float64 accumulation
    return np.log(np.maximum(mel, 1e-5)).astype(np.float32)
