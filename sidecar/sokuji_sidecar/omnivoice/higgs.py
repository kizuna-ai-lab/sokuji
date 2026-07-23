# Apache License 2.0
"""Higgs Audio Tokenizer codec glue: reference-clip voice-cloning encode and
codes -> waveform decode, driving four of the seven sessions from
`runtime.build_sessions` (`acoustic_encoder`, `semantic_encoder`,
`quantizer_encoder`, `higgs_decoder` -- the COLD graphs). Torch-free -- numpy
+ `soxr` for resampling + `soundfile` to read the reference clip.

Ports the exact ONNX-pipeline logic from `.spike/models/repo/inference.py`'s
`higgs_encode`/`higgs_decode` (the same pipeline independently verified
end-to-end, including an eager-vs-ONNX numeric parity check against the
PyTorch HiggsAudioV2TokenizerModel, in
`scripts/reexport-omnivoice/tests/test_bidi_export.py::
test_higgs_export_roundtrip`: code_match=0.9838, wav_cos=0.9989 on
`scripts/assets/gpt-sovits-voices/classic-zh.wav`), with one API change:
`encode_reference` here drops the leading batch axis on its returned codes
(`(8, T)` instead of the spike's `(8, 1, T)`) since this backend only ever
encodes one reference clip at a time.

Pipeline (encode_reference):
  ref_audio @ 24 kHz -> acoustic_encoder -> acoustic_features (1, 256, Ta)
  ref_audio @ 16 kHz -> semantic_encoder -> semantic_features (1, 768, Ts)
  T = min(Ta, Ts); truncate BOTH streams to T (split-graph contract -- the
    two encoders are independent conv stacks over different sample rates
    and can disagree by a frame or two on non-multiple clip lengths)
  acoustic_features[:, :, :T] + semantic_features[:, :, :T]
    -> quantizer_encoder -> codes (8, 1, T) int64 -> drop batch -> (8, T)

Pipeline (decode):
  codes (8, T) -> add batch axis -> (8, 1, T) -> higgs_decoder
    -> waveform_24k (1, 1, samples) -> squeeze -> (samples,) float32
"""
import numpy as np
import soundfile as sf
import soxr

SR_24K = 24_000
SR_16K = 16_000


def _load_mono(wav_path: str):
    """Load a clip and return (samples float32, sample_rate). Stereo clips
    are reduced to their first channel (matches the reference pipeline in
    test_bidi_export.py::test_higgs_export_roundtrip)."""
    wav, sr = sf.read(wav_path)
    wav = np.asarray(wav, dtype=np.float32)
    if wav.ndim > 1:
        wav = wav[:, 0]
    return wav, sr


def _align_to_min_t(acoustic_features: np.ndarray, semantic_features: np.ndarray):
    """Split-graph contract: acoustic_encoder and semantic_encoder are
    independent conv stacks over 24 kHz/16 kHz resamples of the same clip
    and can disagree on frame count by a frame or two (non-multiple clip
    lengths, differing internal padding). Truncate BOTH to
    T = min(Ta, Ts) along the trailing time axis before quantizer_encoder,
    which requires matching T on its two inputs."""
    t = min(acoustic_features.shape[2], semantic_features.shape[2])
    return acoustic_features[:, :, :t], semantic_features[:, :, :t]


def encode_reference(sessions: dict, wav_path: str) -> np.ndarray:
    """Encode a reference clip to Higgs codec codes for voice cloning.

    `sessions` is the dict from `runtime.build_sessions(...)` (or any dict
    exposing `acoustic_encoder`/`semantic_encoder`/`quantizer_encoder` ORT
    sessions with matching `run(output_names, feed) -> [array]`).

    Returns `np.int64` of shape `(8, T)` -- the 8 codebooks, with the batch
    axis dropped (this backend encodes exactly one reference clip at a
    time).
    """
    wav, sr = _load_mono(wav_path)
    w24 = soxr.resample(wav, sr, SR_24K).astype(np.float32)
    w16 = soxr.resample(wav, sr, SR_16K).astype(np.float32)

    acoustic_features = sessions["acoustic_encoder"].run(
        ["acoustic_features"], {"waveform_24k": w24[None, None, :]})[0]
    semantic_features = sessions["semantic_encoder"].run(
        ["semantic_features"], {"waveform_16k": w16[None, :]})[0]

    acoustic_features, semantic_features = _align_to_min_t(
        acoustic_features, semantic_features)

    codes = sessions["quantizer_encoder"].run(
        ["codes"],
        {"acoustic_features": acoustic_features,
         "semantic_features": semantic_features})[0]  # (8, 1, T) int64

    return codes[:, 0, :].astype(np.int64)


def decode(sessions: dict, codes: np.ndarray) -> np.ndarray:
    """Decode Higgs codec codes (`(8, T)`) to a 24 kHz waveform via
    `sessions["higgs_decoder"]`. Returns `np.float32` of shape `(samples,)`.
    """
    codes = np.asarray(codes, dtype=np.int64)
    if codes.ndim != 2 or codes.shape[0] != 8:
        raise ValueError(f"codes must have shape (8, T), got {codes.shape}")
    codes_3d = codes[:, None, :]  # (8, 1, T)

    waveform = sessions["higgs_decoder"].run(
        ["waveform_24k"], {"codes": codes_3d})[0]  # (1, 1, samples)

    return np.asarray(waveform, dtype=np.float32).squeeze()
