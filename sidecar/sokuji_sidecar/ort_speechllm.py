"""ORT-based speech-LLM ASR backends (torch/transformers-free).

First member: Cohere Transcribe via the onnx-community export — encoder
(input_features -> last_hidden_state) + optimum-style merged decoder with
KV cache, greedy decode. The numpy feature front end lives in
cohere_features; the tokenizer is a plain tokenizers.Tokenizer.

The q4 (MatMulNBits) variant serves BOTH the cpu and gpu-cuda tiers from one
2.1GB download — MatMulNBits has CPU and CUDA kernels.
"""
import json
import os

import numpy as np

from .backends import AsrResult, BackendLoadError, register_backend
from .cohere_features import cohere_log_mel

# Suffix per compute_type — which exported variant the sessions load.
_SUFFIX = {"q4": "_q4", "int8": "_quantized", "fp16": "_fp16", "fp32": ""}

# Languages with a <|xx|> prompt token in the Cohere tokenizer (catalog row).
_COHERE_LANGS = {"en", "de", "fr", "it", "es", "pt", "el",
                 "nl", "pl", "ar", "vi", "zh", "ja", "ko"}

_MAX_NEW_TOKENS = 1024


def _snapshot(model_ref: str) -> str:
    from huggingface_hub import snapshot_download
    return snapshot_download(repo_id=model_ref, local_files_only=True)


def _load_tokenizer(model_dir: str):
    from tokenizers import Tokenizer
    return Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))


def _load_sessions(model_dir: str, suffix: str, device: str):
    """(encoder, decoder) InferenceSessions. On device='cuda' the CUDA EP must
    actually be available — otherwise raise so the resolver falls back to the
    correctly-labelled cpu plan instead of silently running on CPU."""
    import onnxruntime as ort
    if device == "cuda":
        if "CUDAExecutionProvider" not in ort.get_available_providers():
            raise BackendLoadError("cuda requested but onnxruntime has no CUDA EP")
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    else:
        providers = ["CPUExecutionProvider"]
    so = ort.SessionOptions()
    enc = ort.InferenceSession(
        os.path.join(model_dir, "onnx", f"encoder_model{suffix}.onnx"), so, providers=providers)
    dec = ort.InferenceSession(
        os.path.join(model_dir, "onnx", f"decoder_model_merged{suffix}.onnx"), so, providers=providers)
    return enc, dec


@register_backend
class CohereOnnxBackend:
    """Cohere Transcribe (onnx-community export) on onnxruntime. Batch decode
    per VAD segment, greedy, stops at eos. model_ref is the ONNX repo id."""
    NAME = "cohere_onnx"

    def __init__(self):
        self._enc = None
        self._dec = None
        self._tok = None
        self._eos = 3
        self._layers = 8
        self._past_names = []
        self._has_cache_flag = False

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._enc = self._dec = self._tok = None
        try:
            d = _snapshot(model_ref)
            suffix = _SUFFIX.get(compute_type, "_q4")
            self._enc, self._dec = _load_sessions(d, suffix, device)
            self._tok = _load_tokenizer(d)
            try:
                with open(os.path.join(d, "generation_config.json")) as f:
                    eos = json.load(f).get("eos_token_id", 3)
                self._eos = eos if isinstance(eos, int) else 3
            except Exception:
                self._eos = 3
            names = [i.name for i in self._dec.get_inputs()]
            self._past_names = [n for n in names if n.startswith("past_key_values.")]
            self._has_cache_flag = "use_cache_branch" in names
            self._layers = max(int(n.split(".")[1]) for n in self._past_names) + 1
        except BackendLoadError:
            raise
        except Exception as e:  # missing snapshot/onnxruntime, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def _prompt_ids(self, language: str) -> list[int]:
        lang = language if language in _COHERE_LANGS else "en"
        tokens = ["▁", "<|startofcontext|>", "<|startoftranscript|>", "<|emo:undefined|>",
                  f"<|{lang}|>", f"<|{lang}|>", "<|pnc|>", "<|noitn|>",
                  "<|notimestamp|>", "<|nodiarize|>"]
        ids = [self._tok.token_to_id(t) for t in tokens]
        if any(i is None for i in ids):
            raise BackendLoadError(f"tokenizer is missing Cohere prompt tokens for {lang!r}")
        return ids

    def transcribe(self, samples, language) -> AsrResult:
        feats, _mask = cohere_log_mel(samples)
        enc_out = self._enc.run(None, {"input_features": feats[None, ...].astype(np.float32)})[0]

        prompt = self._prompt_ids(language or "en")
        head_dim = 128
        empty = np.zeros((1, 8, 0, head_dim), np.float32)
        past = {n: empty for n in self._past_names}
        ids = np.array([prompt], np.int64)
        pos0 = 0
        generated: list[int] = []

        for _step in range(_MAX_NEW_TOKENS):
            total = pos0 + ids.shape[1]
            feeds = {
                "input_ids": ids,
                "attention_mask": np.ones((1, total), np.int64),
                "position_ids": np.arange(pos0, total, dtype=np.int64)[None, :],
                "num_logits_to_keep": np.array(1, np.int64),
                "encoder_hidden_states": enc_out,
                **past,
            }
            if self._has_cache_flag:
                feeds["use_cache_branch"] = np.array([pos0 > 0])
            outs = self._dec.run(None, feeds)
            logits = outs[0]
            next_id = int(np.argmax(logits[0, -1]))
            # presents follow logits in output order: 4 per layer
            # (decoder.key, decoder.value, encoder.key, encoder.value)
            out_names = [o.name for o in self._dec.get_outputs()] if hasattr(self._dec, "get_outputs") \
                else [f"present.{i}.{br}.{kv}" for i in range(self._layers)
                      for br in ("decoder", "encoder") for kv in ("key", "value")]
            for name, val in zip(out_names[1:] if out_names[0] == "logits" else out_names, outs[1:]):
                pname = name.replace("present.", "past_key_values.") if name.startswith("present.") \
                    else name
                # keep the step-0 encoder cross-KV; later steps may emit empties
                if ".encoder." in pname and val.shape[2] == 0:
                    continue
                past[pname] = val
            pos0 = total
            if next_id == self._eos:
                break
            generated.append(next_id)
            ids = np.array([[next_id]], np.int64)

        text = self._tok.decode(generated, skip_special_tokens=True).strip()
        return AsrResult(text, language)

    def unload(self) -> None:
        self._enc = None
        self._dec = None
        self._tok = None

    @property
    def is_loaded(self) -> bool:
        return self._dec is not None
