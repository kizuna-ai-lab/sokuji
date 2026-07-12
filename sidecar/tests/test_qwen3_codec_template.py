import numpy as np, os
from types import SimpleNamespace
from sokuji_sidecar.qwen3_tts import codec, config, template
FIX = os.path.join(os.path.dirname(__file__), "fixtures", "qwen3_tts_config.json")

class _IO:
    def __init__(self, n): self.name = n

class _Enc:
    def get_outputs(self): return [_IO("audio_codes"), _IO("lengths")]
    def run(self, names, feeds):
        n = feeds["input_values"].shape[1]
        frames = max(1, int(np.ceil(n / 1920)))
        return [np.ones((1, frames, 16), np.int64), np.array([frames], np.int64)]

class _Dec:
    def get_outputs(self): return [_IO("audio_values"), _IO("lengths")]
    def run(self, names, feeds):
        frames = feeds["audio_codes"].shape[1]
        return [np.zeros((1, frames * 1920), np.float32), np.array([frames * 1920], np.int64)]

def test_codec_roundtrip_shapes():
    c = codec.Codec12Hz({"tokenizer12hz_encode": _Enc(), "tokenizer12hz_decode": _Dec()})
    codes = c.encode(np.zeros(24000, np.float32))
    assert codes.shape == (13, 16)                      # ceil(24000/1920)
    wav = c.decode(codes)
    assert wav.shape == (13 * 1920,)

class _FakeEmb:
    """text_project returns per-id one-hot-ish rows so layout is inspectable."""
    def __init__(self, h=8): self.h = h
    def text_project(self, ids):
        out = np.zeros((1, ids.shape[1], self.h), np.float32)
        out[0, :, 0] = ids[0].astype(np.float32); return out
    def codec_embed(self, ids):
        out = np.zeros((1, ids.shape[1], self.h), np.float32)
        out[0, :, 1] = ids[0].astype(np.float32); return out
    def code_predictor_embed(self, ids, step):
        out = np.zeros((1, ids.shape[1], self.h), np.float32)
        out[0, :, 2] = ids[0].astype(np.float32); return out

def _cfg(): return config.load_model_config(FIX)

def test_template_no_voice_shapes_and_mask():
    cfg = _cfg(); emb = _FakeEmb()
    ids = np.arange(12, dtype=np.int64)[None, :]        # 3 role + 4 text + 5 trailing
    padded, mask, trail, pad_emb = template.build_talker_inputs(
        cfg, emb, input_ids=ids, ref_ids=None, voice_clone_prompt=None, language_name="english")
    assert padded.ndim == 3 and padded.shape[0] == 1 and padded.shape[2] == 8
    assert mask.shape == (1, padded.shape[1]) and mask.all()
    # trailing hidden = text_project(ids[4:-5]) + tts_eos → 3 text tokens + 1
    assert trail.shape[1] == 4
    assert pad_emb.shape == (1, 1, 8)

def test_template_icl_requires_ref_ids():
    cfg = _cfg(); emb = _FakeEmb()
    ids = np.arange(12, dtype=np.int64)[None, :]
    vcp = {"ref_code": [np.ones((5, 16), np.int64)], "ref_spk_embedding": [np.zeros(8, np.float32)],
           "x_vector_only_mode": [False], "icl_mode": [True]}
    try:
        template.build_talker_inputs(cfg, emb, ids, ref_ids=None, voice_clone_prompt=vcp, language_name=None)
        assert False, "expected ValueError"
    except ValueError:
        pass
