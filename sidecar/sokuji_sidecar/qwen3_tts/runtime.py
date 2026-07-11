"""Qwen3-TTS ONNX session management and autoregressive generation loop.

Faithful port of the ONNX talker runtime from the reference implementation
(`.superpowers/qwen3-ref/run_pipeline.py`, lines 203-532: `OrtSession`,
`default_providers`, `OnnxTalkerEmbeddings`, `OnnxTalker.generate_codes`).

One behavioral addition over the reference: when no `talker_prefill` graph is
available, `generate_codes` runs the FIRST autoregressive step through
`talker_decode` with zero-length past-KV arrays instead of a dedicated
prefill graph. This was verified bit-identical to prefill by the design
spike. After the first step, both modes thread the KV cache through
`talker_decode` identically, so the reference's "no-KV re-prefill" fallback
branch is unreachable in zero-past mode (decode always returns present KV).

Sampling primitives (softmax, suppression, repetition penalty, top-k/top-p,
sampling) live in `sampling.py` and are imported here, not reimplemented.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .sampling import apply_repetition_penalty, apply_suppress_tokens, sample_next_token

# Graphs that are cheap/one-shot and always run on CPU, regardless of device.
_COLD_GRAPH_NAMES = ("speaker_encoder", "tokenizer12hz_encode", "text_project")

# Default (heads, head_dim) used for zero-past KV arrays when the decode
# graph's declared input shape doesn't expose concrete dims (symbolic dims,
# or a fake/test session with no shape metadata at all).
_DEFAULT_PAST_HEADS = 8
_DEFAULT_PAST_HEAD_DIM = 128


class _Session:
    """Thin wrapper over a raw ONNX-Runtime-shaped session object.

    Mirrors the reference `OrtSession`, but wraps an already-constructed
    session (real `onnxruntime.InferenceSession` or a test double) instead of
    loading one from a path. Depends on nothing beyond `get_outputs()` and
    `run(output_names, input_feed)`; `get_inputs()` is read opportunistically
    since not every session needs its input names captured (e.g. embedding
    lookup graphs never need theirs).
    """

    def __init__(self, session: Any) -> None:
        self.session = session
        get_inputs = getattr(session, "get_inputs", None)
        self.input_names = [i.name for i in get_inputs()] if callable(get_inputs) else []
        self.output_names = [o.name for o in session.get_outputs()]

    def run(self, feeds: dict, output_names: list[str] | None = None):
        return self.session.run(output_names or self.output_names, feeds)


def default_providers(device: str | None = None) -> list[str]:
    """Resolve the ONNX Runtime execution providers for `device`.

    "dml" pins DirectML (Windows non-NVIDIA SKU) for the HOT graphs;
    build_sessions keeps the cheap one-shot COLD graphs on CPU regardless
    (spec D2: the autoregressive HOT graphs run on DML, the COLD ones stay
    CPU). A "dml" device never appends CUDA even when the CUDA EP is present."""
    import onnxruntime as ort

    available = ort.get_available_providers()
    dev = str(device).lower() if device else ""
    if dev == "cpu":
        return ["CPUExecutionProvider"]
    providers: list[str] = []
    if dev == "dml":
        # Fail-fast (mirrors moss_tts _resolve_ort_providers): a "dml" request on
        # an onnxruntime build without the DML EP must NOT silently return CPU —
        # the gpu-dml load then raises and load_with_fallback picks the cpu plan
        # (labeled cpu) instead of reporting gpu-dml while running on CPU.
        if "DmlExecutionProvider" not in available:
            raise RuntimeError(
                "DmlExecutionProvider was requested but this onnxruntime build does "
                f"not expose it. Available providers: {', '.join(available) or 'none'}")
        providers.append("DmlExecutionProvider")
    elif "CUDAExecutionProvider" in available:
        providers.append("CUDAExecutionProvider")
    providers.append("CPUExecutionProvider")
    return providers


def build_sessions(onnx_dir: str | Path, device: str | None, threads: int) -> dict[str, Any]:
    """Build the Qwen3-TTS talker ONNX sessions with per-graph device placement.

    COLD graphs (`speaker_encoder`, `tokenizer12hz_encode`, `text_project`)
    always run on CPU. The remaining (HOT) graphs get CUDA+CPU providers when
    `device == "cuda"`, else CPU-only. Each CUDA session creation is wrapped
    in try/except with a CPU-only retry, mirroring the reference
    `_make_session` pattern.

    `talker_prefill` is included only if `talker_prefill.onnx` exists in
    `onnx_dir` — its absence puts `generate_codes` into zero-past mode.
    """
    import onnxruntime as ort  # local import: fake-session tests never touch ORT

    onnx_dir = Path(onnx_dir)

    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.log_severity_level = 3
    options.intra_op_num_threads = int(threads)

    hot_providers = default_providers(device)
    cold_providers = ["CPUExecutionProvider"]

    def _make_session(path: Path, providers: list[str]):
        try:
            return ort.InferenceSession(str(path), sess_options=options, providers=providers)
        except Exception:
            return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])

    graph_files = {
        "talker_decode": "talker_decode.onnx",
        "code_predictor": "code_predictor.onnx",
        "code_predictor_embed": "code_predictor_embed.onnx",
        "codec_embed": "codec_embed.onnx",
        "text_project": "text_project.onnx",
        "speaker_encoder": "speaker_encoder.onnx",
        "tokenizer12hz_encode": "tokenizer12hz_encode.onnx",
        "tokenizer12hz_decode": "tokenizer12hz_decode.onnx",
    }

    sessions: dict[str, Any] = {}
    for name, filename in graph_files.items():
        providers = cold_providers if name in _COLD_GRAPH_NAMES else hot_providers
        sessions[name] = _make_session(onnx_dir / filename, providers)

    prefill_path = onnx_dir / "talker_prefill.onnx"
    if prefill_path.exists():
        sessions["talker_prefill"] = _make_session(prefill_path, hot_providers)

    if str(device).lower() == "dml":
        # Fail-fast if a HOT graph silently fell back to CPU — either _make_session's
        # CPU retry fired, or ORT dropped DirectML at session creation. Without this
        # the gpu-dml plan would load "successfully" and run the AR graphs on CPU
        # while reporting gpu-dml; raising lets load_with_fallback pick the cpu plan
        # (labeled cpu). Mirrors moss_tts OrtCpuRuntime._session. COLD graphs are
        # CPU by design and are exempt.
        for name, sess in sessions.items():
            if name in _COLD_GRAPH_NAMES:
                continue
            if "DmlExecutionProvider" not in sess.get_providers():
                raise RuntimeError(
                    f"DmlExecutionProvider was requested but the HOT graph {name!r} was "
                    f"created without it (providers: {sess.get_providers()})")

    return sessions


class Embeddings:
    """Wraps the codec/sub-code/text embedding lookup ONNX graphs.

    Reference: `OnnxTalkerEmbeddings` (run_pipeline.py lines 306-331). Each
    session is optional so callers (like `generate_codes`) can construct an
    instance covering only the sessions they need.
    """

    def __init__(
        self,
        *,
        text_project_session: Any = None,
        codec_embed_session: Any = None,
        code_predictor_embed_session: Any = None,
    ) -> None:
        self._text_project = _Session(text_project_session) if text_project_session is not None else None
        self._codec_embed = _Session(codec_embed_session) if codec_embed_session is not None else None
        self._code_predictor_embed = (
            _Session(code_predictor_embed_session) if code_predictor_embed_session is not None else None
        )

    def text_project(self, input_ids: np.ndarray) -> np.ndarray:
        if self._text_project is None:
            raise RuntimeError("text_project session not available")
        outputs = self._text_project.run({"input_ids": input_ids.astype(np.int64)})
        return outputs[0].astype(np.float32)

    def codec_embed(self, input_ids: np.ndarray) -> np.ndarray:
        if self._codec_embed is None:
            raise RuntimeError("codec_embed session not available")
        outputs = self._codec_embed.run({"input_ids": input_ids.astype(np.int64)})
        return outputs[0].astype(np.float32)

    def code_predictor_embed(self, input_ids: np.ndarray, generation_step: int) -> np.ndarray:
        if self._code_predictor_embed is None:
            raise RuntimeError("code_predictor_embed session not available")
        step = np.array([generation_step], dtype=np.int64)
        outputs = self._code_predictor_embed.run(
            {"input_ids": input_ids.astype(np.int64), "generation_step": step}
        )
        return outputs[0].astype(np.float32)

    @classmethod
    def from_sessions(cls, sessions: dict[str, Any]) -> "Embeddings":
        """Build an `Embeddings` covering all three graphs from a `build_sessions()` dict."""
        return cls(
            text_project_session=sessions.get("text_project"),
            codec_embed_session=sessions.get("codec_embed"),
            code_predictor_embed_session=sessions.get("code_predictor_embed"),
        )


def _zero_past_feeds(decode_session: Any, past_names: list[str], batch: int) -> dict[str, np.ndarray]:
    """Build zero-length past-KV feeds for `talker_decode`'s past inputs.

    Reads concrete (heads, head_dim) dims from the decode graph's declared
    input shape when available; falls back to `(8, 128)` for symbolic or
    missing dims (e.g. shape metadata unavailable on a test double).
    """
    metas = {meta.name: meta for meta in decode_session.get_inputs()}
    feeds: dict[str, np.ndarray] = {}
    for name in past_names:
        meta = metas.get(name)
        shape = getattr(meta, "shape", None) if meta is not None else None
        heads = shape[1] if shape is not None and len(shape) > 1 and isinstance(shape[1], int) else _DEFAULT_PAST_HEADS
        head_dim = (
            shape[3] if shape is not None and len(shape) > 3 and isinstance(shape[3], int) else _DEFAULT_PAST_HEAD_DIM
        )
        feeds[name] = np.zeros((batch, heads, 0, head_dim), dtype=np.float32)
    return feeds


def _is_binding_capable(sess: Any) -> bool:
    """True when `sess` is a CUDA session exposing the IOBinding surface.

    The AR-loop test fakes define no `get_providers`, so they (and any CPU
    session) stay on the numpy reference path; DirectML sessions also return
    False (no CUDA device strings for OrtValue binding)."""
    get_providers = getattr(sess, "get_providers", None)
    if not callable(get_providers) or "CUDAExecutionProvider" not in get_providers():
        return False
    return callable(getattr(sess, "io_binding", None)) and callable(
        getattr(sess, "run_with_iobinding", None))


class _SessionDecodeRunner:
    """Reference decode runner: numpy feeds, KV cache round-trips through the
    host every step. Preserves the original `generate_codes` semantics exactly,
    including the prefill-session path and the no-KV re-prefill fallback (which
    needs the prompt embeddings grown by one codec frame per step)."""

    def __init__(self, sessions: dict[str, Any]) -> None:
        decode_raw = sessions["talker_decode"]
        self._decode_raw = decode_raw
        self._decode = _Session(decode_raw)
        self._past_names = self._decode.input_names[2:] if len(self._decode.input_names) > 2 else []
        prefill_raw = sessions.get("talker_prefill")
        self._prefill = _Session(prefill_raw) if prefill_raw is not None else None
        self._past: list | None = None
        self._inputs_np: np.ndarray | None = None

    def prefill(self, inputs_np: np.ndarray, mask_np: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        self._inputs_np = inputs_np
        if self._prefill is not None:
            outputs = self._prefill.run({"inputs_embeds": inputs_np, "attention_mask": mask_np})
            if len(outputs) < 2:
                raise RuntimeError("talker_prefill session must output logits and last_hidden")
        else:
            zero_past = _zero_past_feeds(self._decode_raw, self._past_names, inputs_np.shape[0])
            outputs = self._decode.run({"inputs_embeds": inputs_np, "attention_mask": mask_np, **zero_past})
            if len(outputs) < 2:
                raise RuntimeError("talker_decode session must output logits and last_hidden")
        self._past = list(outputs[2:]) if len(outputs) > 2 else None
        return outputs[0], outputs[1]

    def step(self, codec_sum: np.ndarray, mask_np: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        self._inputs_np = np.concatenate([self._inputs_np, codec_sum], axis=1)
        if self._past is None or len(self._past_names) == 0:
            # Reference's no-KV re-prefill fallback. In zero-past mode there
            # is no prefill session to fall back to, so a missing KV cache
            # here means the decode graph doesn't thread state — a hard
            # runtime error rather than a silent behavior change.
            if self._prefill is None:
                raise RuntimeError("talker_decode produced no KV cache and no talker_prefill is available")
            outputs = self._prefill.run({"inputs_embeds": self._inputs_np, "attention_mask": mask_np})
        else:
            feed = {"inputs_embeds": codec_sum, "attention_mask": mask_np}
            for name, value in zip(self._past_names, self._past):
                feed[name] = value
            outputs = self._decode.run(feed)
        self._past = list(outputs[2:]) if len(outputs) > 2 else None
        return outputs[0], outputs[1]


def generate_codes(
    sessions: dict[str, Any],
    cfg_talker: Any,
    inputs_embeds: np.ndarray,
    attention_mask: np.ndarray,
    trailing_text_hidden: np.ndarray,
    tts_pad_embed: np.ndarray,
    *,
    max_new_tokens: int,
    sampling_params: dict,
    eos_token_id: int,
    suppress_tokens: list | None,
    rng: np.random.Generator,
) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Autoregressively generate talker codes.

    Faithful port of `OnnxTalker.generate_codes` (reference lines 370-532),
    with zero-past initial-pass support when `sessions` has no
    `talker_prefill` key — see module docstring.

    Args:
        sessions: Dict as returned by `build_sessions`, keyed by graph name.
        cfg_talker: Talker config namespace; only `num_code_groups` is read.
        inputs_embeds: [batch, seq, hidden] float32 prompt embeddings.
        attention_mask: [batch, seq] int64 attention mask for the prompt.
        trailing_text_hidden: [batch, trailing_len, hidden] float32 hidden
            states summed into the codec embedding for the first
            `trailing_len` generation steps.
        tts_pad_embed: [1 or batch, 1, hidden] float32 padding embedding
            summed in once `trailing_text_hidden` is exhausted.
        max_new_tokens: Maximum number of AR steps (talker frames) to run.
        sampling_params: Dict with keys `do_sample`, `top_k`, `top_p`,
            `temperature`, `repetition_penalty`, `subtalker_dosample`,
            `subtalker_top_k`, `subtalker_top_p`, `subtalker_temperature`.
        eos_token_id: Token ID that marks end-of-sequence for the main code.
        suppress_tokens: Token IDs to suppress in the main-code logits, or None.
        rng: NumPy random generator used for sampling.

    Returns:
        (codes_list, hidden_list): per-batch-item lists of
        [effective_len, num_code_groups] int64 codes and
        [effective_len, hidden] float32 hidden states, truncated at the
        first EOS frame (or the full length if no EOS was generated).
    """
    if _is_binding_capable(sessions["talker_decode"]):
        from . import runtime_cuda  # lazy: only real CUDA sessions reach this

        runner: Any = runtime_cuda.BindingDecodeRunner(sessions["talker_decode"])
        embeddings: Any = runtime_cuda.table_embeds_for(sessions, cfg_talker)
    else:
        runner = _SessionDecodeRunner(sessions)
        embeddings = Embeddings(
            codec_embed_session=sessions["codec_embed"],
            code_predictor_embed_session=sessions["code_predictor_embed"],
        )
    return _ar_loop(
        runner,
        embeddings,
        _Session(sessions["code_predictor"]),
        cfg_talker,
        inputs_embeds,
        attention_mask,
        trailing_text_hidden,
        tts_pad_embed,
        max_new_tokens=max_new_tokens,
        sampling_params=sampling_params,
        eos_token_id=eos_token_id,
        suppress_tokens=suppress_tokens,
        rng=rng,
    )


def _ar_loop(
    runner: Any,
    embeddings: Any,
    code_predictor: _Session,
    cfg_talker: Any,
    inputs_embeds: np.ndarray,
    attention_mask: np.ndarray,
    trailing_text_hidden: np.ndarray,
    tts_pad_embed: np.ndarray,
    *,
    max_new_tokens: int,
    sampling_params: dict,
    eos_token_id: int,
    suppress_tokens: list | None,
    rng: np.random.Generator,
) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Shared AR loop over a decode `runner` and an `embeddings` provider.

    `runner` owns talker_decode invocation and KV-cache threading
    (`_SessionDecodeRunner` for numpy feeds, `runtime_cuda.BindingDecodeRunner`
    for the device-resident IOBinding path); `embeddings` provides
    `codec_embed(ids)` / `code_predictor_embed(ids, step)` (per-step sessions
    or pre-extracted tables). Everything else — sampling, EOS bookkeeping,
    trailing-hidden switch, truncation — is identical for both paths.
    """
    do_sample = sampling_params["do_sample"]
    top_k = sampling_params["top_k"]
    top_p = sampling_params["top_p"]
    temperature = sampling_params["temperature"]
    repetition_penalty = sampling_params["repetition_penalty"]
    subtalker_dosample = sampling_params["subtalker_dosample"]
    subtalker_top_k = sampling_params["subtalker_top_k"]
    subtalker_top_p = sampling_params["subtalker_top_p"]
    subtalker_temperature = sampling_params["subtalker_temperature"]

    inputs_np = inputs_embeds.astype(np.float32)
    mask_np = attention_mask.astype(np.int64)

    trailing_hidden = trailing_text_hidden.astype(np.float32)
    tts_pad = tts_pad_embed.astype(np.float32)
    if tts_pad.shape[0] == 1 and trailing_hidden.shape[0] > 1:
        tts_pad = np.repeat(tts_pad, trailing_hidden.shape[0], axis=0)

    batch = inputs_np.shape[0]
    num_code_groups = int(cfg_talker.num_code_groups)

    generated_steps: list[np.ndarray] = []
    hidden_steps: list[np.ndarray] = []
    generated_first_codes: list[np.ndarray] = []

    finished = np.zeros((batch,), dtype=bool)

    logits, last_hidden = runner.prefill(inputs_np, mask_np)

    for step in range(max_new_tokens):
        step_logits = logits[:, -1, :]
        step_logits = apply_suppress_tokens(step_logits, suppress_tokens)

        hist = np.stack(generated_first_codes, axis=1) if generated_first_codes else None
        step_logits = apply_repetition_penalty(step_logits, hist, repetition_penalty)

        next_ids = sample_next_token(
            step_logits,
            rng=rng,
            do_sample=do_sample,
            top_k=top_k,
            top_p=top_p,
            temperature=temperature,
        ).astype(np.int64)

        if finished.any():
            next_ids = next_ids.copy()
            next_ids[finished] = eos_token_id

        generated_first_codes.append(next_ids)
        finished = finished | (next_ids == eos_token_id)

        first_embed = embeddings.codec_embed(next_ids[:, None])

        embed_seq = [last_hidden.astype(np.float32), first_embed]
        subcode_ids = np.zeros((batch, num_code_groups - 1), dtype=np.int64)
        sub_embeds: list[np.ndarray] = []

        for j in range(num_code_groups - 1):
            inputs_embed = np.concatenate(embed_seq, axis=1)
            gen_step = np.full((batch,), j, dtype=np.int64)
            sub_logits = code_predictor.run(
                {"inputs_embeds": inputs_embed.astype(np.float32), "generation_step": gen_step},
                output_names=["logits"],
            )[0]
            sub_next = sample_next_token(
                sub_logits,
                rng=rng,
                do_sample=subtalker_dosample,
                top_k=subtalker_top_k,
                top_p=subtalker_top_p,
                temperature=subtalker_temperature,
            ).astype(np.int64)
            subcode_ids[:, j] = sub_next

            sub_embed = embeddings.code_predictor_embed(sub_next[:, None], j)
            sub_embeds.append(sub_embed)
            embed_seq.append(sub_embed)

        codec_sum = first_embed
        for emb in sub_embeds:
            codec_sum = codec_sum + emb

        if step < trailing_hidden.shape[1]:
            codec_sum = codec_sum + trailing_hidden[:, step : step + 1, :]
        else:
            codec_sum = codec_sum + tts_pad

        mask_np = np.concatenate([mask_np, np.ones((batch, 1), dtype=np.int64)], axis=1)

        step_codes = np.concatenate([next_ids[:, None], subcode_ids], axis=1)
        generated_steps.append(step_codes)
        hidden_steps.append(last_hidden.astype(np.float32))

        if finished.all():
            break

        logits, last_hidden = runner.step(codec_sum.astype(np.float32), mask_np)

    if not generated_steps:
        empty = [np.empty((0, num_code_groups), dtype=np.int64) for _ in range(batch)]
        empty_hidden = [np.empty((0, inputs_np.shape[-1]), dtype=np.float32) for _ in range(batch)]
        return empty, empty_hidden

    codes = np.stack(generated_steps, axis=1)
    first_codebook = codes[:, :, 0]
    is_stop = first_codebook == eos_token_id
    has_stop = is_stop.any(axis=1)
    stop_indices = np.argmax(is_stop, axis=1)
    effective_lengths = np.where(has_stop, stop_indices, codes.shape[1]).astype(np.int64)

    hidden_stack = np.concatenate(hidden_steps, axis=1)

    codes_list: list[np.ndarray] = []
    hidden_list: list[np.ndarray] = []
    for i in range(batch):
        length = int(effective_lengths[i])
        codes_list.append(codes[i, :length, :].astype(np.int64))
        hidden_list.append(hidden_stack[i, :length, :].astype(np.float32))

    return codes_list, hidden_list


__all__ = ["build_sessions", "default_providers", "Embeddings", "generate_codes"]
