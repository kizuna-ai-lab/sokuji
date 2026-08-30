"""Native ASR backends (spec §5.3): the two classes that used to wrap the transcribe_cpp
PyPI binding now wrap sokuji_native's AsrModel — same load()/transcribe()/unload()
contract, same stream adapter contract (feed/drain/end/abort), same language mapping.

model_ref is an upstream artifact path "org/repo/file.gguf"; the file must already be in
the HF cache (the manager downloads it first). Batch mode: one AsrModel.run() per VAD
segment. The streaming variant adapts AsrStream's committed/tentative view to asr_engine's
stream contract: drain() emits committed-prefix DELTAS only (tentative text can be revised,
so it never enters the append-only partial), and end() finalizes + returns the whole
utterance's committed text."""
import numpy as np

from . import native
from .backends import AsrResult, BackendLoadError, register_backend
from .catalog import split_artifact

# Plan device -> sokuji_native device kind. (cuda/dml tiers never existed for ASR.)
_DEVICE_KIND = {"cpu": "cpu", "vulkan": "vulkan", "metal": "metal"}


@register_backend
class NativeAsrBackend:
    """sokuji_native AsrModel wrapper (batch). The model family is auto-detected from the
    GGUF; language is passed as a hint when set."""
    NAME = "native_asr"
    STREAMING = False

    def __init__(self):
        self._model = None

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self.unload()
        try:
            from huggingface_hub import hf_hub_download
            repo, fname = split_artifact(model_ref)
            if not fname:
                raise BackendLoadError(f"native_asr needs an 'org/repo/file.gguf' artifact, got {model_ref!r}")
            path = hf_hub_download(repo, fname, local_files_only=True)
            kind = _DEVICE_KIND.get(device)
            if kind is None:
                raise BackendLoadError(f"unknown device for native_asr: {device!r}")
            self._model = native.module().asr_load(path, native.device_for(kind))
        except BackendLoadError:
            self.unload()
            raise
        except Exception as e:  # missing wheel/gguf, no vulkan device, NativeError → resolver falls back
            self.unload()
            raise BackendLoadError(str(e))

    def _match_language(self, language):
        """Map the app's language code onto the tag set the LOADED model publishes
        (capabilities.languages). Families disagree: whisper / voxtral / sense-voice list
        bare ISO codes ('zh'), nemotron lists full locales ('zh-CN') and HARD-REJECTS
        anything else. Exact match first, then primary-subtag match ('zh' → 'zh-CN'); a
        tag the model doesn't know becomes None so the run degrades to autodetect instead
        of failing (every catalog card reports supports_language_detect)."""
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
        if self._model is None:
            raise BackendLoadError("native_asr not loaded")
        pcm = np.ascontiguousarray(np.asarray(samples, dtype=np.float32).reshape(-1))
        if pcm.size == 0:
            return AsrResult("", language)
        try:
            text = self._model.run(pcm, self._match_language(language))
        except Exception as e:
            raise BackendLoadError(str(e))
        return AsrResult((text or "").strip(), language)

    def unload(self) -> None:
        model, self._model = self._model, None
        if model is not None:
            try:
                model.unload()
            except Exception:
                pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None


class _NativeStream:
    """asr_engine stream adapter over one sokuji_native AsrStream. Lifecycle: the engine
    opens at speech start, feed()s audio, drain()s partial deltas, end()s at the VAD
    endpoint (or abort()s on teardown). The committed view refreshes on every feed(); drain()
    diffs it against what it already emitted (Ruling I)."""

    def __init__(self, model, language=None):
        self._raw = model.open_stream(language or None)
        self._committed = ""
        self._emitted = 0        # chars of committed text already drained
        self._done = False

    def feed(self, samples_f32_16k) -> None:
        pcm = np.ascontiguousarray(np.asarray(samples_f32_16k, dtype=np.float32).reshape(-1))
        if pcm.size and not self._done:
            self._committed = self._raw.feed(pcm).committed or ""

    def drain(self) -> list:
        if len(self._committed) > self._emitted:
            delta = self._committed[self._emitted:]
            self._emitted = len(self._committed)
            return [delta]
        return []

    def end(self) -> str:
        """Finalize and return the WHOLE utterance's committed text (the engine replaces
        the accumulated partial with this)."""
        if self._done:
            return self._committed.strip()
        try:
            final = self._raw.finalize() or ""
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
            self._raw.close()
        except Exception:
            pass


@register_backend
class NativeAsrStreamBackend(NativeAsrBackend):
    """Streaming twin for GGUFs whose runtime reports supports_streaming (Voxtral Realtime,
    Moonshine Streaming, Parakeet streaming, Nemotron streaming). Registered under its own
    NAME so the catalog row selects it and asr_engine's class-flag pre-check routes it to
    the streaming loop."""
    NAME = "native_asr_stream"
    STREAMING = True

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        super().load(model_ref, device, compute_type, config)
        caps = getattr(self._model, "capabilities", None)
        if not (caps and getattr(caps, "supports_streaming", False)):
            self.unload()
            raise BackendLoadError(f"{model_ref} does not support streaming")

    def open_stream(self, language=None) -> _NativeStream:
        """`language` is the user's source-language hint — same contract as the batch
        path; None/empty = autodetect. Mapped onto the model's own tag set first."""
        if self._model is None:
            raise BackendLoadError("native_asr_stream not loaded")
        try:
            return _NativeStream(self._model, self._match_language(language))
        except BackendLoadError:
            raise
        except Exception as e:
            raise BackendLoadError(str(e))
