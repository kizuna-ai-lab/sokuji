# Apache License 2.0
"""Numpy feature extractors for CosyVoice3 (no librosa/torch).

Three front-ends, verified against the phase-1 spike reference outputs
(sidecar/tests/data/cosyvoice3_mel_goldens.npz):
  - whisper_log_mel_128: 16 kHz whisper-style 128-bin log10 mel for
    speech_tokenizer_v3 (center=True reflect, LAST FRAME DROPPED, clamp
    max-8, (x+4)/4).
  - kaldi_fbank_80_cmn: torchaudio.compliance.kaldi.fbank equivalent for
    campplus (snip_edges, DC removal, preemphasis 0.97 with replicate
    first sample, povey window, 512-pt rfft power spectrum, HTK mel
    1127*ln(1+f/700) over 20..8000 Hz, log clamp at float32 eps, CMN).
  - matcha_mel_80: 24 kHz HiFiGAN/matcha mel for the flow prompt
    (reflect pad (1920-480)//2, center=False, hann 1920, hop 480,
    sqrt(power+1e-9), Slaney mel fmin 0 fmax nyquist, log clamp 1e-5).
"""
import numpy as np

# ---- Slaney filterbank + window helpers, copied verbatim from
# sokuji_sidecar/qwen3_tts/mel.py — self-contained per backend-module
# convention. NOTE: unlike qwen3's _hann_window (which divides by N as
# part of its Rust-matching recipe), this module's _hann_window matches
# librosa's periodic hann (no /N division) — that's what the spike's
# librosa.stft(window="hann") goldens were generated with. ----


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
    so the sidecar doesn't carry librosa's numba/llvmlite dependency chain.
    Returns (n_mels, 1 + n_fft // 2) float64."""
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


def _hann_window(size: int) -> np.ndarray:
    """Periodic Hann window matching librosa/numpy's STFT convention (no
    division by N — that recipe belongs to qwen3_tts's Rust-matching port,
    not this librosa-derived one)."""
    if size == 0:
        return np.zeros(0, dtype=np.float64)
    n = np.arange(size, dtype=np.float64)
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * n / size)


def whisper_log_mel_128(audio16k: np.ndarray) -> np.ndarray:
    y = np.asarray(audio16k, dtype=np.float64)
    pad = 200                                   # n_fft // 2, center=True
    y = np.pad(y, (pad, pad), mode="reflect")
    win = _hann_window(400)                     # periodic hann
    n_frames = 1 + (len(y) - 400) // 160
    idx = np.arange(400)[None, :] + 160 * np.arange(n_frames)[:, None]
    frames = y[idx] * win
    spec = np.fft.rfft(frames, axis=1)          # [T, 201]
    power = (spec.real ** 2 + spec.imag ** 2)[:-1]   # whisper drops last frame
    fb = mel_filterbank(16000, 400, 128, 0.0, 8000.0)  # Slaney, [128, 201]
    m = power @ fb.T                            # [T-1, 128]
    log_spec = np.log10(np.maximum(m, 1e-10))
    log_spec = np.maximum(log_spec, log_spec.max() - 8.0)
    log_spec = (log_spec + 4.0) / 4.0
    return log_spec.T[np.newaxis, :, :].astype(np.float32)   # [1, 128, T]


def kaldi_fbank_80_cmn(audio16k: np.ndarray) -> np.ndarray:
    """Kaldi-compliant 80-bin log fbank + cepstral mean normalization for
    campplus, mirroring torchaudio.compliance.kaldi.fbank(num_mel_bins=80,
    dither=0, sample_frequency=16000) defaults: 25ms/10ms frames,
    snip_edges, DC removal, preemphasis 0.97, povey window, 512-pt FFT,
    power spectrum, HTK mel scale, low 20 Hz / high nyquist. [1, frames, 80]
    """
    frame_len, frame_shift, n_fft = 400, 160, 512
    audio16k = np.asarray(audio16k)
    num_frames = 1 + (len(audio16k) - frame_len) // frame_shift
    idx = np.arange(frame_len)[None, :] + frame_shift * np.arange(num_frames)[:, None]
    frames = audio16k[idx].astype(np.float64)
    frames = frames - frames.mean(axis=1, keepdims=True)              # remove_dc_offset
    frames = np.concatenate([frames[:, :1] - 0.97 * frames[:, :1],
                             frames[:, 1:] - 0.97 * frames[:, :-1]], axis=1)  # preemphasis
    n = np.arange(frame_len)
    povey = (0.5 - 0.5 * np.cos(2 * np.pi * n / (frame_len - 1))) ** 0.85
    frames *= povey
    power = np.abs(np.fft.rfft(frames, n=n_fft, axis=1)) ** 2         # [T, 257]

    def hz_to_mel(f):
        return 1127.0 * np.log(1.0 + f / 700.0)

    low_mel, high_mel = hz_to_mel(20.0), hz_to_mel(8000.0)
    mel_pts = np.linspace(low_mel, high_mel, 82)
    bin_freqs = np.fft.rfftfreq(n_fft, d=1.0 / 16000)
    bin_mels = hz_to_mel(bin_freqs)                                    # [257]
    banks = np.zeros((80, len(bin_freqs)))
    for m in range(80):
        left, center, right = mel_pts[m], mel_pts[m + 1], mel_pts[m + 2]
        up = (bin_mels - left) / (center - left)
        down = (right - bin_mels) / (right - center)
        banks[m] = np.maximum(0.0, np.minimum(up, down))
    mel_energies = power @ banks.T                                     # [T, 80]
    feat = np.log(np.maximum(mel_energies, np.finfo(np.float32).eps))
    feat = feat - feat.mean(axis=0, keepdims=True)                     # CMN as in frontend
    return feat[np.newaxis, :, :].astype(np.float32)


def matcha_mel_80(audio24k: np.ndarray) -> np.ndarray:
    y = np.asarray(audio24k, dtype=np.float64)
    pad = (1920 - 480) // 2
    y = np.pad(y, (pad, pad), mode="reflect")
    win = _hann_window(1920)
    n_frames = 1 + (len(y) - 1920) // 480       # center=False
    idx = np.arange(1920)[None, :] + 480 * np.arange(n_frames)[:, None]
    frames = y[idx] * win
    spec = np.fft.rfft(frames, axis=1)
    mag = np.sqrt(spec.real ** 2 + spec.imag ** 2 + 1e-9)
    fb = mel_filterbank(24000, 1920, 80, 0.0, 12000.0)
    m = mag @ fb.T                              # [frames, 80]
    return np.log(np.maximum(m, 1e-5)).astype(np.float32)
