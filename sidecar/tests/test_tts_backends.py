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


def test_moss_onnx_registered_and_flags():
    b = backends.make_backend("moss_onnx")
    assert b.NAME == "moss_onnx" and b.STREAMING is True and b.CLONES is True
    assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TTS"),
                    reason="set SOKUJI_RUN_TTS=1 (downloads MOSS-TTS-Nano ONNX assets)")
def test_moss_onnx_cpu_streaming_smoke():
    from huggingface_hub import snapshot_download
    snapshot_download("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX")
    snapshot_download("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")
    b = backends.make_backend("moss_onnx")
    b.load("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX", "cpu", "fp32")
    assert b.is_loaded and b.sample_rate > 0
    chunks = list(b.generate_stream("hello world", 1.0))
    assert len(chunks) >= 1 and all(c.dtype == np.float32 for c in chunks)
    full, gen_ms = b.generate("hello world", 1.0)
    assert full.size > 0 and gen_ms >= 0
    b.unload(); assert b.is_loaded is False
