import numpy as np
from sokuji_sidecar import pocket_bundle as pb


def test_constants():
    assert pb.SAMPLE_RATE == 24000 and pb.LATENT_DIM == 32 and pb.DEFAULT_LSD_STEPS == 1
    assert set(pb.MODEL_STEMS) == {
        "mimiEncoder", "textConditioner", "flowLmMain", "flowLmFlow", "mimiDecoder"}


def test_parse_npy_float32(tmp_path):
    arr = np.arange(5, dtype=np.float32)
    p = tmp_path / "x.npy"
    np.save(p, arr)
    out = pb.parse_npy_float32(str(p))
    assert out.dtype == np.float32 and np.allclose(out, arr)
