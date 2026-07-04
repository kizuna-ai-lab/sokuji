"""transcribe.cpp ASR backend — THE torch-free runtime for every ASR catalog
model (2026-07-04 decision). ggml family: official GGUFs per model, Vulkan/
Metal/CPU backends from the stock PyPI wheel (CUDA needs the optional native
runtime; we ship Vulkan which already covers NVIDIA at 100x realtime).

model_ref is an upstream artifact path "org/repo/file.gguf" (same shape as the
llamacpp translate cards); the file must already be in the HF cache (the
manager downloads it first). Batch mode: one session.run() per VAD segment.
Streaming (Voxtral Realtime committed/tentative) is a planned follow-up via
session.stream()."""
import numpy as np

from .backends import AsrResult, BackendLoadError, register_backend
from .catalog import split_artifact

# Plan device -> transcribe.cpp backend kind.
_DEVICE_KIND = {"cpu": "cpu", "vulkan": "vulkan", "metal": "metal", "cuda": "cuda"}


@register_backend
class TranscribeCppBackend:
    """transcribe.cpp Model/Session wrapper (batch). The model family is
    auto-detected from the GGUF; language is passed as a hint when set."""
    NAME = "transcribe_cpp"
    STREAMING = False

    def __init__(self):
        self._model = None
        self._session = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self.unload()
        try:
            import transcribe_cpp as tc
            from huggingface_hub import hf_hub_download
            repo, fname = split_artifact(model_ref)
            if not fname:
                raise BackendLoadError(f"transcribe_cpp needs an 'org/repo/file.gguf' artifact, got {model_ref!r}")
            path = hf_hub_download(repo, fname, local_files_only=True)
            kind = _DEVICE_KIND.get(device)
            if kind is None:
                raise BackendLoadError(f"unknown device for transcribe_cpp: {device!r}")
            self._model = tc.Model(path, backend=kind)
            self._session = self._model.session()
        except BackendLoadError:
            self.unload()
            raise
        except Exception as e:  # missing wheel/gguf, no vulkan device → resolver falls back
            self.unload()
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        pcm = np.ascontiguousarray(np.asarray(samples, dtype=np.float32).reshape(-1))
        if pcm.size == 0:
            return AsrResult("", language)
        result = self._session.run(pcm, language=(language or None))
        return AsrResult((result.text or "").strip(), language)

    def unload(self) -> None:
        for attr in ("_session", "_model"):
            obj = getattr(self, attr, None)
            setattr(self, attr, None)
            if obj is not None:
                try:
                    obj.close()
                except Exception:
                    pass

    @property
    def is_loaded(self) -> bool:
        return self._session is not None
