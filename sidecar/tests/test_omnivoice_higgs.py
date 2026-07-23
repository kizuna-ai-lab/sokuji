"""Tests for the Higgs codec glue: reference-clip encode (acoustic_encoder +
semantic_encoder + quantizer_encoder, with the split-graph min-T alignment)
and codes -> waveform decode (higgs_decoder).

The min-T truncation test uses a fake sessions dict for the three encoder
graphs (no real ONNX needed) so it always runs -- it only needs the real,
committed ``classic-zh.wav`` asset to drive `encode_reference`'s audio-load
path. The round-trip test against the real re-exported Higgs graphs
self-skips when ``scripts/reexport-omnivoice/out/audio_tokenizer/`` is not
present on disk, mirroring test_omnivoice_frontend.py's skip convention for
the real tokenizer.json spike asset.
"""
import os

import numpy as np
import pytest

from sokuji_sidecar.omnivoice import higgs

_REPO_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", ".."))
_HIGGS_DIR = os.path.join(
    _REPO_ROOT, "scripts", "reexport-omnivoice", "out", "audio_tokenizer")
_WAV_PATH = os.path.join(
    _REPO_ROOT, "scripts", "assets", "gpt-sovits-voices", "classic-zh.wav")


def _real_higgs_dir():
    return _HIGGS_DIR if os.path.isdir(_HIGGS_DIR) else None


def _build_real_sessions():
    import onnxruntime as ort
    d = _HIGGS_DIR
    opts_kwargs = {"providers": ["CPUExecutionProvider"]}
    return {
        "acoustic_encoder": ort.InferenceSession(
            f"{d}/acoustic_encoder.onnx", **opts_kwargs),
        "semantic_encoder": ort.InferenceSession(
            f"{d}/semantic_encoder.onnx", **opts_kwargs),
        "quantizer_encoder": ort.InferenceSession(
            f"{d}/quantizer_encoder.onnx", **opts_kwargs),
        "higgs_decoder": ort.InferenceSession(
            f"{d}/higgs_decoder.onnx", **opts_kwargs),
    }


@pytest.mark.skipif(_real_higgs_dir() is None,
                     reason="re-exported Higgs audio_tokenizer graphs not present")
def test_encode_reference_then_decode_round_trip_is_speech_like():
    sessions = _build_real_sessions()

    codes = higgs.encode_reference(sessions, _WAV_PATH)
    assert codes.dtype == np.int64
    assert codes.shape[0] == 8
    assert codes.ndim == 2
    assert codes.shape[1] > 0
    # codes must be diverse (real audio), not collapsed to a few entries
    assert len(np.unique(codes[0])) > 30

    wav = higgs.decode(sessions, codes)
    assert wav.dtype == np.float32
    assert wav.ndim == 1
    rms = float(np.sqrt(np.mean(wav.astype(np.float64) ** 2)))
    assert 0.02 < rms < 0.35, f"round-trip rms {rms} not speech-like"


class _RecordingSession:
    """Fake ORT session: records the feed dict of every `run` call and
    always returns a single canned output array, regardless of input."""

    def __init__(self, output):
        self._output = output
        self.calls = []

    def run(self, output_names, feed):
        self.calls.append(feed)
        return [self._output]


def test_encode_reference_truncates_mismatched_feature_lengths_to_min_t():
    # acoustic_encoder "sees" 5 frames, semantic_encoder "sees" 7 -- a
    # realistic disagreement between the two independent conv stacks on a
    # non-multiple clip length. The split-graph contract requires BOTH to
    # be truncated to T = min(5, 7) = 5 before quantizer_encoder runs.
    acoustic_features = np.arange(1 * 256 * 5, dtype=np.float32).reshape(1, 256, 5)
    semantic_features = np.arange(1 * 768 * 7, dtype=np.float32).reshape(1, 768, 7)
    canned_codes = np.zeros((8, 1, 5), dtype=np.int64)
    canned_codes[0] = np.arange(5, dtype=np.int64)

    acoustic_session = _RecordingSession(acoustic_features)
    semantic_session = _RecordingSession(semantic_features)
    quantizer_session = _RecordingSession(canned_codes)
    sessions = {
        "acoustic_encoder": acoustic_session,
        "semantic_encoder": semantic_session,
        "quantizer_encoder": quantizer_session,
    }

    codes = higgs.encode_reference(sessions, _WAV_PATH)

    # No shape error, and the returned codes reflect the truncated T=5.
    assert codes.shape == (8, 5)
    assert codes.dtype == np.int64

    # The quantizer_encoder must have actually received T=5 on BOTH inputs
    # -- proving the truncation happened before the call, not after.
    assert len(quantizer_session.calls) == 1
    fed_acoustic = quantizer_session.calls[0]["acoustic_features"]
    fed_semantic = quantizer_session.calls[0]["semantic_features"]
    assert fed_acoustic.shape == (1, 256, 5)
    assert fed_semantic.shape == (1, 768, 5)
    # And it's a genuine prefix truncation, not a reshape/reinterpretation.
    np.testing.assert_array_equal(fed_acoustic, acoustic_features[:, :, :5])
    np.testing.assert_array_equal(fed_semantic, semantic_features[:, :, :5])


def test_decode_rejects_wrong_codes_shape():
    with pytest.raises(ValueError):
        higgs.decode({}, np.zeros((7, 5), dtype=np.int64))


def test_prepare_reference_trims_caps_and_normalizes():
    """prepare_reference conditions a user recording so cloning stays stable:
    trims leading/trailing silence, caps to MAX_REF_SECONDS, peak-normalizes."""
    sr = 16000
    tone = (0.2 * np.sin(2 * np.pi * 220 * np.arange(sr) / sr)).astype(np.float32)
    # 1s silence + 1s tone + 1s silence -> trimmed to ~the 1s tone
    clip = np.concatenate([np.zeros(sr, np.float32), tone, np.zeros(sr, np.float32)])
    out = higgs.prepare_reference(clip, sr)
    assert out.ndim == 1
    assert 0.7 * sr <= out.size <= 1.3 * sr             # leading/trailing silence trimmed
    assert abs(float(np.abs(out).max()) - 0.95) < 0.02  # peak-normalized

    # a long clip is capped to MAX_REF_SECONDS
    capped = higgs.prepare_reference(np.tile(tone, 20), sr)  # 20 s of tone
    assert capped.size == int(sr * higgs.MAX_REF_SECONDS)

    # all-silence clip: no voiced frames, no peak -> returned unchanged, no crash
    out_sil = higgs.prepare_reference(np.zeros(sr, np.float32), sr)
    assert out_sil.size == sr and float(np.abs(out_sil).max()) == 0.0


def test_prepare_reference_caps_at_a_pause_not_mid_word():
    """A clip over the cap must be cut at a PAUSE, not hard-cut mid-sound: a
    hard mid-word cut makes the model emit an "eh"-like completion artifact at
    the start of every generated chunk."""
    sr = 16000
    tone = (0.2 * np.sin(2 * np.pi * 220 * np.arange(sr) / sr)).astype(np.float32)
    # 6s tone + 0.3s pause + 4s tone = 10.3s > 8s cap; the pause sits inside
    # the second half of the cap window [4s, 8s) -> cut lands there, not at 8s
    clip = np.concatenate([np.tile(tone, 6), np.zeros(int(sr * 0.3), np.float32), np.tile(tone, 4)])
    out = higgs.prepare_reference(clip, sr)
    assert 5.8 * sr <= out.size <= 6.5 * sr   # ends at the pause (~6.0-6.3s)
    # and the tail of the returned clip is the quiet region, not cut mid-tone
    assert float(np.abs(out[-int(sr * 0.05):]).max()) < 0.05
