import numpy as np
from sokuji_sidecar.tts_backends import SupertonicBackend
CHUNK = 512 * 6

class _FakeSession:
    def __init__(self, out): self._out = out
    def get_outputs(self): return [type("O", (), {"name": self._out})()]
    def run(self, names, feeds):
        if "style_dp" in feeds: return [np.array([0.2], np.float32)]      # duration
        if "style_ttl" in feeds and "text_ids" in feeds: return [np.zeros((1, 4, 256), np.float32)]  # text_enc
        if "noisy_latent" in feeds: return [feeds["noisy_latent"]]        # vector_estimator
        return [np.zeros((1, feeds["latent"].shape[2] * CHUNK), np.float32)]  # vocoder

def _install(b):
    b._sess = {"dp": _FakeSession("duration"), "tenc": _FakeSession("text_emb"),
               "vest": _FakeSession("denoised_latent"), "voc": _FakeSession("wav_tts")}
    b._cfg = {"ae": {"sample_rate": 44100, "base_chunk_size": 512},
              "ttl": {"latent_dim": 24, "chunk_compress_factor": 6}}
    b._indexer = [1] * 70000
    b._voice = (np.zeros((1, 50, 256), np.float32), np.zeros((1, 8, 16), np.float32))
    b.sample_rate = 44100; b._total_step = 2

def test_generate_returns_float32_44k():
    b = SupertonicBackend(); _install(b); b.set_language("en")
    samples, ms = b.generate("Hello world.", 1.0)
    assert samples.dtype == np.float32 and samples.ndim == 1 and samples.size > 0
    assert isinstance(ms, int)

def test_backend_flags():
    assert (SupertonicBackend.NAME, SupertonicBackend.STREAMING, SupertonicBackend.CLONES) == ("supertonic", False, False)
