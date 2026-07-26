"""Tests for the torch-free numpy port of OmniVoice's iterative-unmasking
decoder (`omnivoice/decode.py`): classifier-free guidance + gumbel position
scheduling driving the 3 backbone ONNX graphs (audio_embeddings -> llm_decoder
[full bidirectional 4-D mask] -> audio_heads).

The correctness gate is a **deterministic parity oracle**: an fp32 backbone
(same precision + eager attention PyTorch uses) is exported from the same model,
and a fixture is captured from the PyTorch `_generate_iterative` with
position_temperature=0 / class_temperature=0 (no gumbel, greedy). The numpy
decoder, fed the identical input_ids/audio_mask/num_target_tokens, must agree
with the captured codes >= 0.98 (a handful of fp-driven argmax ties may differ).

Two independent perturbations PROVE the metric is strict (not tautological):
dropping CFG (guidance_scale=0) and swapping the bidirectional mask for a causal
one both collapse agreement far below 0.98 -- if the decoder trivially matched
regardless of correctness, these would not move the number.

All heavy-asset tests self-skip when the re-exported graphs / captured fixtures
are absent, mirroring test_omnivoice_higgs.py's skip convention. Fixtures live
in the gitignored `scripts/reexport-omnivoice/out/` tree and are produced by the
Task-4 capture step in `.spike/exportenv`.
"""
import os

import numpy as np
import pytest

from sokuji_sidecar.omnivoice import decode
from sokuji_sidecar.omnivoice.decode import DecodeConfig, generate_codes

_REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
_FP32_DIR = os.path.join(
    _REPO_ROOT, "scripts", "reexport-omnivoice", "out", "_fp32_backbone")
_FP16_DIR = os.path.join(
    _REPO_ROOT, "scripts", "reexport-omnivoice", "out", "fp16")
_HIGGS_DIR = os.path.join(
    _REPO_ROOT, "scripts", "reexport-omnivoice", "out", "audio_tokenizer")
_PARITY_NPZ = os.path.join(_FP32_DIR, "decode_parity.npz")
_SMOKE_NPZ = os.path.join(_FP32_DIR, "smoke_input.npz")

_BACKBONE_FILES = ("audio_embeddings_encoder.onnx", "llm_decoder.onnx",
                   "audio_heads_decoder.onnx")


def _has_backbone(d):
    return d is not None and all(
        os.path.exists(os.path.join(d, f)) for f in _BACKBONE_FILES)


def _fp32_ready():
    return _has_backbone(_FP32_DIR) and os.path.exists(_PARITY_NPZ)


def _build_sessions(d):
    import onnxruntime as ort
    kw = {"providers": ["CPUExecutionProvider"]}
    return {
        "audio_embeddings": ort.InferenceSession(
            f"{d}/audio_embeddings_encoder.onnx", **kw),
        "llm_decoder": ort.InferenceSession(f"{d}/llm_decoder.onnx", **kw),
        "audio_heads": ort.InferenceSession(f"{d}/audio_heads_decoder.onnx", **kw),
    }


def _cfg_from_npz(z, **overrides):
    kw = dict(
        num_step=int(z["num_step"]),
        guidance_scale=float(z["guidance_scale"]),
        t_shift=float(z["t_shift"]),
        layer_penalty_factor=float(z["layer_penalty_factor"]),
        position_temperature=float(z["position_temperature"]),
        class_temperature=float(z["class_temperature"]),
    )
    kw.update(overrides)
    return DecodeConfig(**kw)


def _agreement(a, b):
    a = np.asarray(a)
    b = np.asarray(b)
    assert a.shape == b.shape, (a.shape, b.shape)
    return float(np.mean(a == b))


# ---------------------------------------------------------------------------
# The correctness gate: deterministic parity vs PyTorch _generate_iterative
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not _fp32_ready(),
                    reason="fp32 backbone oracle + parity fixture not present")
def test_deterministic_parity_matches_pytorch_generate_iterative():
    z = np.load(_PARITY_NPZ)
    cfg = _cfg_from_npz(z)
    # Sanity: the captured config is genuinely the deterministic one (no gumbel).
    assert cfg.position_temperature == 0.0 and cfg.class_temperature == 0.0

    sessions = _build_sessions(_FP32_DIR)
    codes = generate_codes(
        sessions, z["input_ids"], z["audio_mask"], int(z["num_target_tokens"]),
        cfg=cfg)

    pt_codes = z["codes"]
    assert codes.shape == pt_codes.shape == (8, int(z["num_target_tokens"]))
    assert codes.dtype == np.int64

    agreement = _agreement(codes, pt_codes)
    assert agreement >= 0.98, (
        f"numpy decoder disagrees with PyTorch _generate_iterative: "
        f"agreement={agreement:.4f} (< 0.98)")


# ---------------------------------------------------------------------------
# Strictness proof #1: dropping CFG (guidance_scale=0) collapses agreement.
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not _fp32_ready(),
                    reason="fp32 backbone oracle + parity fixture not present")
def test_dropping_cfg_collapses_agreement():
    z = np.load(_PARITY_NPZ)
    sessions = _build_sessions(_FP32_DIR)

    faithful = generate_codes(
        sessions, z["input_ids"], z["audio_mask"], int(z["num_target_tokens"]),
        cfg=_cfg_from_npz(z))
    no_cfg = generate_codes(
        sessions, z["input_ids"], z["audio_mask"], int(z["num_target_tokens"]),
        cfg=_cfg_from_npz(z, guidance_scale=0.0))

    a_faithful = _agreement(faithful, z["codes"])
    a_nocfg = _agreement(no_cfg, z["codes"])
    assert a_faithful >= 0.98
    # The metric must actually discriminate: removing CFG (a real algorithmic
    # error) has to move agreement well away from the faithful value.
    assert a_nocfg < 0.9, f"no-CFG agreement {a_nocfg:.4f} not collapsed"
    assert a_faithful - a_nocfg >= 0.3, (
        f"metric did not discriminate: faithful={a_faithful:.4f} "
        f"no_cfg={a_nocfg:.4f}")


# ---------------------------------------------------------------------------
# Strictness proof #2: a causal mask (instead of the bidirectional 4-D mask --
# the entire reason for the re-export) collapses agreement.
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not _fp32_ready(),
                    reason="fp32 backbone oracle + parity fixture not present")
def test_causal_mask_collapses_agreement():
    z = np.load(_PARITY_NPZ)
    sessions = _build_sessions(_FP32_DIR)
    cfg = _cfg_from_npz(z)

    (bii, bam, battn, c_len, u_len) = decode._build_cfg_batch(
        z["input_ids"], z["audio_mask"], int(z["num_target_tokens"]))

    # Perturb: replace the bidirectional blocks with causal (lower-triangular).
    causal_attn = np.zeros_like(battn)
    causal_attn[0, 0, :c_len, :c_len] = np.tril(np.ones((c_len, c_len), bool))
    causal_attn[1, 0, :u_len, :u_len] = np.tril(np.ones((u_len, u_len), bool))
    if c_len > u_len:
        diag = np.arange(u_len, c_len)
        causal_attn[1, 0, diag, diag] = True

    rng = np.random.default_rng(0)
    causal_codes = decode._decode_loop(
        sessions, bii.copy(), bam, causal_attn, c_len, u_len, cfg, rng)

    a_causal = _agreement(causal_codes, z["codes"])
    assert a_causal < 0.9, f"causal-mask agreement {a_causal:.4f} not collapsed"


# ---------------------------------------------------------------------------
# Defaults-config end-to-end smoke: real longer input, published fp16 graphs,
# gumbel scheduling -> diverse codes; optional Higgs decode -> speech-level RMS.
# ---------------------------------------------------------------------------
@pytest.mark.skipif(
    not (_has_backbone(_FP16_DIR) and os.path.exists(_SMOKE_NPZ)),
    reason="published fp16 backbone + smoke input not present")
def test_defaults_config_produces_diverse_codes_and_speech():
    z = np.load(_SMOKE_NPZ)
    sessions = _build_sessions(_FP16_DIR)
    cfg = DecodeConfig()  # library defaults (num_step=32, guidance=2, pos_temp=5)

    codes = generate_codes(
        sessions, z["input_ids"], z["audio_mask"], int(z["num_target_tokens"]),
        cfg=cfg, seed=0)

    assert codes.shape == (8, int(z["num_target_tokens"]))
    assert codes.dtype == np.int64
    assert int(codes.min()) >= 0 and int(codes.max()) < 1024  # no MASK id leaked
    for cb in range(8):
        uniq = len(np.unique(codes[cb]))
        assert uniq > 30, f"codebook {cb} not diverse: {uniq} unique"

    # Optional: decode to waveform and check it is speech-level (not silence /
    # not exploding). Gated on the Higgs audio_tokenizer graphs being present.
    if os.path.isdir(_HIGGS_DIR):
        import onnxruntime as ort
        from sokuji_sidecar.omnivoice import higgs
        hk = {"providers": ["CPUExecutionProvider"]}
        higgs_sessions = {
            "higgs_decoder": ort.InferenceSession(
                f"{_HIGGS_DIR}/higgs_decoder.onnx", **hk),
        }
        wav = higgs.decode(higgs_sessions, codes)
        assert wav.dtype == np.float32 and wav.ndim == 1 and wav.size > 0
        rms = float(np.sqrt(np.mean(wav.astype(np.float64) ** 2)))
        assert 0.01 < rms < 0.6, f"decoded rms {rms} not speech-like"


# ---------------------------------------------------------------------------
# Pure-numpy unit checks for the ported helpers (no ONNX needed -- always run).
# ---------------------------------------------------------------------------
def test_get_time_steps_matches_reference_formula():
    ts = decode._get_time_steps(0.0, 1.0, 32, 0.1)
    assert ts.shape == (33,)
    # endpoints are fixed points of t_shift*t/(1+(t_shift-1)*t): 0->0, 1->1
    assert abs(ts[0] - 0.0) < 1e-9
    assert abs(ts[-1] - 1.0) < 1e-9
    assert np.all(np.diff(ts) > 0)  # strictly increasing


def test_log_softmax_matches_naive():
    rng = np.random.default_rng(1)
    x = rng.standard_normal((2, 5, 7)).astype(np.float32)
    got = decode._log_softmax(x, axis=-1)
    ref = x - np.log(np.sum(np.exp(x - x.max(-1, keepdims=True)), -1, keepdims=True)) \
        - x.max(-1, keepdims=True)
    np.testing.assert_allclose(got, ref, atol=1e-5)
    # rows are proper log-probabilities: exp sums to 1
    np.testing.assert_allclose(np.exp(got).sum(-1), np.ones((2, 5)), atol=1e-5)


def test_filter_top_k_keeps_only_top_ratio():
    logits = np.array([[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]],
                      dtype=np.float32)
    out = decode._filter_top_k(logits, ratio=0.1)  # k = ceil(0.1*10) = 1
    assert np.isfinite(out).sum() == 1
    assert out[0, 9] == 9.0  # only the single largest kept


def test_build_cfg_batch_shapes_and_uncond_mask():
    C, c_len, u_len = 8, 12, 5
    input_ids = np.arange(C * c_len, dtype=np.int64).reshape(1, C, c_len)
    audio_mask = np.zeros((1, c_len), dtype=bool)
    audio_mask[0, c_len - u_len:] = True

    bii, bam, battn, got_clen, got_ulen = decode._build_cfg_batch(
        input_ids, audio_mask, u_len)
    assert got_clen == c_len and got_ulen == u_len
    assert bii.shape == (2, C, c_len)
    assert battn.shape == (2, 1, c_len, c_len)
    # cond row: full bidirectional block over the whole sequence
    assert battn[0, 0].all()
    # uncond row: full block over the first u_len, plus a padding diagonal
    assert battn[1, 0, :u_len, :u_len].all()
    diag = np.arange(u_len, c_len)
    assert battn[1, 0, diag, diag].all()
    # off-diagonal padding region stays masked
    assert not battn[1, 0, u_len, u_len - 1]
    # uncond ids are the LAST u_len tokens of the cond input
    np.testing.assert_array_equal(bii[1, :, :u_len], input_ids[0, :, -u_len:])
