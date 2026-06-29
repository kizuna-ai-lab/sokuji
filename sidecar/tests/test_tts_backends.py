import os
import numpy as np
import pytest
from sokuji_sidecar import backends, tts_backends  # noqa: F401 (registers backends)


def test_sherpa_tts_registered_and_flags():
    b = backends.make_backend("sherpa_tts")
    assert b.NAME == "sherpa_tts" and b.STREAMING is False and b.CLONES is False
    assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TTS"),
                    reason="set SOKUJI_RUN_TTS=1 (downloads the piper model)")
def test_sherpa_tts_cpu_smoke():
    from huggingface_hub import snapshot_download
    snapshot_download("csukuangfj/vits-piper-en_US-amy-low")  # populate cache
    b = backends.make_backend("sherpa_tts")
    b.load("csukuangfj/vits-piper-en_US-amy-low", "cpu", "fp32")
    assert b.is_loaded and b.sample_rate > 0
    samples, gen_ms = b.generate("hello world", 1.0)
    assert isinstance(samples, np.ndarray) and samples.size > 0 and gen_ms >= 0
    b.unload(); assert b.is_loaded is False
