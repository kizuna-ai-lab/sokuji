"""cohere_features: numpy port of transformers' CohereAsrFeatureExtractor
(NeMo FilterbankFeatures) — the torch-free front end for the Cohere ORT backend.

Golden tests compare against the reference extractor from the venv's
transformers fork (dither=0 for determinism); they self-skip when transformers
is absent (the torch-free venv after Phase D)."""
import numpy as np
import pytest

from sokuji_sidecar.cohere_features import cohere_log_mel


def _ref_extractor():
    transformers = pytest.importorskip("transformers")
    from transformers.models.cohere_asr.feature_extraction_cohere_asr import (
        CohereAsrFeatureExtractor,
    )
    return CohereAsrFeatureExtractor(
        feature_size=128, sampling_rate=16000, hop_length=160, n_fft=512,
        win_length=400, preemphasis=0.97, dither=0.0, normalize="per_feature",
        log=True)


CLIPS = [
    ("tone", (0.1 * np.sin(2 * np.pi * 220.0 * np.arange(16000) / 16000)).astype(np.float32)),
    ("chirp", (0.2 * np.sin(2 * np.pi * (100 + 3000 * np.linspace(0, 1, 24000) ** 2)
                            * np.linspace(0, 1.5, 24000))).astype(np.float32)),
    ("noiseish", (np.tile(np.linspace(-0.3, 0.3, 777), 40)).astype(np.float32)),
    ("short", (0.05 * np.sin(2 * np.pi * 440.0 * np.arange(3200) / 16000)).astype(np.float32)),
]


@pytest.mark.parametrize("name,clip", CLIPS, ids=[c[0] for c in CLIPS])
def test_golden_parity_with_reference(name, clip):
    ref = _ref_extractor()(clip, sampling_rate=16000, return_tensors="np")
    feats, mask = cohere_log_mel(clip)
    ref_feats = np.asarray(ref["input_features"])[0]
    ref_mask = np.asarray(ref["attention_mask"])[0].astype(bool)
    assert feats.shape == ref_feats.shape, (feats.shape, ref_feats.shape)
    assert mask.tolist() == ref_mask.tolist()
    np.testing.assert_allclose(feats, ref_feats, rtol=2e-4, atol=2e-4)


def test_shapes_and_dtype():
    feats, mask = cohere_log_mel(np.zeros(16000, np.float32))
    # 1s @ 16k, hop 160, center pad 256*2: floor((16000+512-512)/160)=100 valid,
    # torch.stft emits 1 + floor((16000+512-512)/160) = 101 frames
    assert feats.shape == (101, 128) and feats.dtype == np.float32
    assert mask.shape == (101,) and mask.dtype == bool
    assert mask[:100].all()


def test_no_torch_or_transformers_imports():
    import ast, inspect
    from sokuji_sidecar import cohere_features as m
    tree = ast.parse(inspect.getsource(m))
    imported = {getattr(n, "module", None) or a.name
                for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in n.names}
    assert not any((x or "").split(".")[0] in ("torch", "transformers", "librosa")
                   for x in imported)
