"""CUDA fast path for the Qwen3-TTS AR loop.

Two independent optimizations over the numpy reference path in `runtime.py`,
both pure orchestration (bit-identical outputs given identical kernels):

- `BindingDecodeRunner`: drives `talker_decode` through ORT IOBinding so the
  KV cache never leaves the GPU. Present-KV OrtValues from step N are bound
  back as past-KV inputs of step N+1 (the graph's past/present I/O is
  positionally 1:1); only the tiny logits/last_hidden tensors are copied to
  the host each step. This removes the ~2 x 28-layer KV round-trip
  (hundreds of KiB per generated token of pure memcpy) per frame.
- `table_embeds_for`: extracts the `codec_embed` / `code_predictor_embed`
  Gather tables once per loaded model (one arange sweep per table) and serves
  per-step lookups as host-side numpy indexing, removing 16 session.run
  dispatches per generated frame.

Selection happens in `runtime.generate_codes` via `_is_binding_capable`; CPU
and DirectML sessions (and the test fakes) never reach this module.
"""

from __future__ import annotations

import weakref
from typing import Any

import numpy as np

from .runtime import _Session, _float_input_dtype, _zero_past_feeds


def _sub_vocab(cfg_talker: Any) -> int:
    pred_cfg = getattr(cfg_talker, "code_predictor_config", None)
    if isinstance(pred_cfg, dict):
        return int(pred_cfg.get("vocab_size", 2048))
    return int(getattr(pred_cfg, "vocab_size", 2048))


class BindingDecodeRunner:
    """Decode runner that keeps the talker KV cache device-resident.

    Always prefills through `talker_decode` with zero-length past feeds (the
    snapshots ship no `talker_prefill` graph; zero-past decode was verified
    bit-identical to prefill by the design spike). Host<->device traffic per
    step: new-frame embedding + attention mask up, logits + last_hidden down.
    """

    def __init__(self, decode_session: Any) -> None:
        self._sess = decode_session
        self._input_names = [i.name for i in decode_session.get_inputs()]
        self._output_names = [o.name for o in decode_session.get_outputs()]
        self._past_names = self._input_names[2:] if len(self._input_names) > 2 else []
        # Two bindings used alternately. OrtValues returned by get_outputs()
        # REFERENCE the binding's internal storage: clearing (or re-running)
        # the same binding invalidates them (observed on ORT 1.24 — garbage
        # ranks, then segfault). Ping-ponging guarantees the binding holding
        # the presents consumed by step N is only cleared at step N+2, after
        # step N+1 has produced replacements on the other binding.
        self._iobs = [decode_session.io_binding(), decode_session.io_binding()]
        self._turn = 0
        self._dtype = _float_input_dtype(decode_session)
        self._present: list | None = None

    def prefill(self, inputs_np: np.ndarray, mask_np: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        zero_past = _zero_past_feeds(self._sess, self._past_names, inputs_np.shape[0], self._dtype)
        return self._run(inputs_np, mask_np, cpu_past=zero_past)

    def step(self, codec_sum: np.ndarray, mask_np: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if self._present is None or len(self._past_names) == 0:
            raise RuntimeError("talker_decode produced no KV cache and no talker_prefill is available")
        return self._run(codec_sum, mask_np, past_values=self._present)

    def _run(
        self,
        embeds_np: np.ndarray,
        mask_np: np.ndarray,
        *,
        cpu_past: dict[str, np.ndarray] | None = None,
        past_values: list | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        iob = self._iobs[self._turn]
        self._turn = 1 - self._turn
        iob.clear_binding_inputs()
        iob.clear_binding_outputs()
        iob.bind_cpu_input(self._input_names[0], np.ascontiguousarray(embeds_np, dtype=self._dtype))
        iob.bind_cpu_input(self._input_names[1], np.ascontiguousarray(mask_np, dtype=np.int64))
        if cpu_past is not None:
            for name, arr in cpu_past.items():
                iob.bind_cpu_input(name, arr)
        if past_values is not None:
            for name, value in zip(self._past_names, past_values):
                iob.bind_ortvalue_input(name, value)
        for name in self._output_names[:2]:
            iob.bind_output(name, "cpu")
        for name in self._output_names[2:]:
            iob.bind_output(name, "cuda")
        self._sess.run_with_iobinding(iob)
        outputs = iob.get_outputs()
        if len(outputs) < 2:
            raise RuntimeError("talker_decode session must output logits and last_hidden")
        logits = outputs[0].numpy()
        last_hidden = outputs[1].numpy()
        self._present = list(outputs[2:]) if len(outputs) > 2 else None
        return logits, last_hidden


class TableEmbeds:
    """Embedding lookups served from tables extracted out of the ONNX graphs.

    `codec_embed` and `code_predictor_embed` are pure Gather graphs; one
    arange sweep per table recovers the full weight matrix, after which every
    per-step lookup is a host-side fancy index instead of a session.run."""

    def __init__(self, codec_table: np.ndarray, predictor_tables: list[np.ndarray]) -> None:
        self._codec_table = codec_table
        self._predictor_tables = predictor_tables

    @classmethod
    def extract(cls, sessions: dict[str, Any], cfg_talker: Any) -> "TableEmbeds":
        codec_vocab = int(cfg_talker.vocab_size)
        codec_sess = _Session(sessions["codec_embed"])
        ids = np.arange(codec_vocab, dtype=np.int64)[None, :]
        codec_table = np.asarray(codec_sess.run({"input_ids": ids})[0], dtype=np.float32)[0]

        sub_vocab = _sub_vocab(cfg_talker)
        pred_sess = _Session(sessions["code_predictor_embed"])
        sub_ids = np.arange(sub_vocab, dtype=np.int64)[None, :]
        tables = []
        for j in range(int(cfg_talker.num_code_groups) - 1):
            step = np.array([j], dtype=np.int64)
            outputs = pred_sess.run({"input_ids": sub_ids, "generation_step": step})
            tables.append(np.asarray(outputs[0], dtype=np.float32)[0])
        return cls(codec_table, tables)

    def codec_embed(self, input_ids: np.ndarray) -> np.ndarray:
        return self._codec_table[np.asarray(input_ids, dtype=np.int64)]

    def code_predictor_embed(self, input_ids: np.ndarray, generation_step: int) -> np.ndarray:
        return self._predictor_tables[int(generation_step)][np.asarray(input_ids, dtype=np.int64)]


class GraphedCodePredictor:
    """code_predictor driven through CUDA Graph replays, one graph per input
    length (the 15 substep lengths 2..16 are the only shapes that occur).

    Requires a dedicated session created with `enable_cuda_graph`; per
    `gpu_graph_id` the bound device addresses must stay fixed between the
    capture run and every replay, so each length gets one IOBinding with
    pre-allocated CUDA OrtValues refreshed via `update_inplace`. Replays were
    verified bit-identical to plain session runs on GB10; the win is the
    per-call launch overhead of the ~565-node optimized graph (~0.5ms of the
    ~2.5ms call). Any failure (capture refused, kernel error) permanently
    drops to `fallback` — the plain numpy-feed session."""

    def __init__(self, onnx_path: str, *, hidden: int, sub_vocab: int, fallback: Any) -> None:
        import onnxruntime as ort  # lazy: fakes inject a module double

        options = ort.SessionOptions()
        options.log_severity_level = 3
        self.session = ort.InferenceSession(
            str(onnx_path), sess_options=options,
            providers=[("CUDAExecutionProvider", {"enable_cuda_graph": "1"}),
                       "CPUExecutionProvider"])
        self._ort = ort
        self._hidden = int(hidden)
        self._sub_vocab = int(sub_vocab)
        self._fallback = fallback
        self._bindings: dict[int, tuple] = {}
        self._broken = False

    def _binding_for(self, length: int, dtype: Any):
        cached = self._bindings.get(length)
        if cached is not None:
            return cached
        ort = self._ort
        x_val = ort.OrtValue.ortvalue_from_shape_and_type(
            (1, length, self._hidden), dtype, "cuda", 0)
        g_val = ort.OrtValue.ortvalue_from_shape_and_type((1,), np.int64, "cuda", 0)
        out_val = ort.OrtValue.ortvalue_from_shape_and_type(
            (1, self._sub_vocab), dtype, "cuda", 0)
        iob = self.session.io_binding()
        iob.bind_ortvalue_input("inputs_embeds", x_val)
        iob.bind_ortvalue_input("generation_step", g_val)
        iob.bind_ortvalue_output("logits", out_val)
        run_options = ort.RunOptions()
        run_options.add_run_config_entry("gpu_graph_id", str(length))
        entry = (iob, x_val, g_val, out_val, run_options)
        self._bindings[length] = entry
        return entry

    def run(self, feeds: dict, output_names: list[str] | None = None) -> list:
        x = feeds["inputs_embeds"]
        if self._broken or x.shape[0] != 1:
            return self._fallback.run(feeds, output_names)
        try:
            iob, x_val, g_val, out_val, run_options = self._binding_for(
                int(x.shape[1]), x.dtype)
            x_val.update_inplace(np.ascontiguousarray(x))
            g_val.update_inplace(
                np.ascontiguousarray(feeds["generation_step"], dtype=np.int64))
            self.session.run_with_iobinding(iob, run_options)
            return [out_val.numpy()]
        except Exception:
            self._broken = True
            return self._fallback.run(feeds, output_names)


# Extracted tables cached per loaded model, keyed on the codec_embed session
# object (a new build_sessions() dict means new session objects → fresh cache).
_TABLE_CACHE: "weakref.WeakKeyDictionary[Any, TableEmbeds]" = weakref.WeakKeyDictionary()


def table_embeds_for(sessions: dict[str, Any], cfg_talker: Any) -> TableEmbeds:
    key = sessions["codec_embed"]
    cached = _TABLE_CACHE.get(key)
    if cached is None:
        cached = TableEmbeds.extract(sessions, cfg_talker)
        _TABLE_CACHE[key] = cached
    return cached


# Graphed code_predictor cached per loaded model, keyed on the plain session.
_GRAPHED_CP_CACHE: "weakref.WeakKeyDictionary[Any, Any]" = weakref.WeakKeyDictionary()


def graphed_code_predictor_for(sessions: dict[str, Any], cfg_talker: Any, *, hidden: int) -> Any:
    """The CUDA-graph code_predictor for this model, or the plain session
    wrapper when no graph dir is recorded or session creation fails."""
    plain = _Session(sessions["code_predictor"])
    cp_path = (sessions.get("_graph_paths") or {}).get("code_predictor")
    if not cp_path:
        return plain
    key = sessions["code_predictor"]
    cached = _GRAPHED_CP_CACHE.get(key)
    if cached is None:
        try:
            cached = GraphedCodePredictor(
                cp_path,
                hidden=hidden, sub_vocab=_sub_vocab(cfg_talker), fallback=plain)
        except Exception:
            cached = plain
        _GRAPHED_CP_CACHE[key] = cached
    return cached


__all__ = [
    "BindingDecodeRunner",
    "GraphedCodePredictor",
    "TableEmbeds",
    "graphed_code_predictor_for",
    "table_embeds_for",
]
