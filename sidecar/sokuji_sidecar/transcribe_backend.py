"""transcribe.cpp ASR backend — THE torch-free runtime for every ASR catalog
model (2026-07-04 decision). ggml family: official GGUFs per model, Vulkan/
Metal/CPU backends from the stock PyPI wheel (CUDA needs the optional native
runtime; we ship Vulkan which already covers NVIDIA at 100x realtime).

model_ref is an upstream artifact path "org/repo/file.gguf" (same shape as the
llamacpp translate cards); the file must already be in the HF cache (the
manager downloads it first). Batch mode: one session.run() per VAD segment.

The streaming variant (transcribe_cpp_stream — Voxtral Realtime) adapts
session.stream()'s committed/tentative view to asr_engine's stream contract
(feed/drain/end/abort): drain() emits committed-prefix DELTAS only (tentative
text can be revised, so it never enters the append-only partial), and end()
finalizes + returns the whole utterance's committed text."""
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

    def _match_language(self, language):
        """Map the app's language code onto the tag set the LOADED model
        publishes (capabilities.languages). Families disagree: whisper /
        voxtral / sense-voice list bare ISO codes ('zh'), nemotron lists full
        locales ('zh-CN') and HARD-REJECTS anything else (UnsupportedRequest,
        status 10 — even bare 'en'). Exact match first, then primary-subtag
        match ('zh' → 'zh-CN'); a tag the model doesn't know becomes None so
        the session degrades to autodetect instead of failing to start (every
        catalog card reports supports_language_detect)."""
        if not language:
            return None
        caps = getattr(self._model, "capabilities", None)
        tags = tuple(getattr(caps, "languages", ()) or ())
        if not tags:
            return language                # model publishes no list — pass through
        want = language.lower().replace("_", "-")
        for t in tags:
            if t.lower() == want:
                return t
        primary = want.split("-")[0]
        for t in tags:
            if t.lower().split("-")[0] == primary:
                return t
        return None

    def transcribe(self, samples, language) -> AsrResult:
        if self._session is None:
            raise BackendLoadError("transcribe_cpp not loaded")
        pcm = np.ascontiguousarray(np.asarray(samples, dtype=np.float32).reshape(-1))
        if pcm.size == 0:
            return AsrResult("", language)
        result = self._session.run(pcm, language=self._match_language(language))
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


class _TcStream:
    """asr_engine stream adapter over one transcribe.cpp Stream. Lifecycle:
    engine opens at speech start, feed()s audio, drain()s partial deltas,
    end()s at the VAD endpoint (or abort()s on teardown); the session returns
    to idle via reset() so the next open_stream() can reuse it."""

    def __init__(self, session, language=None):
        self._raw = session.stream(language=(language or None))
        self._emitted = 0        # chars of committed text already drained
        self._done = False

    def feed(self, samples_f32_16k) -> None:
        pcm = np.ascontiguousarray(np.asarray(samples_f32_16k, dtype=np.float32).reshape(-1))
        if pcm.size:
            self._raw.feed(pcm)

    def drain(self) -> list:
        committed = self._raw.text().committed or ""
        if len(committed) > self._emitted:
            delta = committed[self._emitted:]
            self._emitted = len(committed)
            return [delta]
        return []

    def end(self) -> str:
        """Finalize and return the WHOLE utterance's committed text (the engine
        replaces the accumulated partial with this)."""
        try:
            self._raw.finalize()
            final = self._raw.text().committed or ""
        finally:
            self._close()
        return final.strip()

    def abort(self) -> None:
        self._close()

    def _close(self) -> None:
        if self._done:
            return
        self._done = True
        try:
            self._raw.reset()
        except Exception:
            pass


@register_backend
class TranscribeCppStreamBackend(TranscribeCppBackend):
    """Streaming twin of TranscribeCppBackend for GGUFs whose runtime reports
    supports_streaming (Voxtral Realtime). Registered under its own NAME so the
    catalog row selects it and asr_engine's class-flag pre-check routes it to
    the streaming loop."""
    NAME = "transcribe_cpp_stream"
    STREAMING = True

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        super().load(model_ref, device, compute_type)
        caps = getattr(self._model, "capabilities", None)
        if not (caps and getattr(caps, "supports_streaming", False)):
            self.unload()
            raise BackendLoadError(f"{model_ref} does not support streaming")

    def open_stream(self, language=None) -> _TcStream:
        """`language` is the user's source-language hint — same contract as the
        batch path's session.run(language=...); None/empty = autodetect. The
        hint is mapped onto the model's own tag set first (see _match_language)."""
        if self._session is None:
            raise BackendLoadError("transcribe_cpp_stream not loaded")
        return _TcStream(self._session, self._match_language(language))
