# Apache License 2.0
"""ONNX session construction for OmniVoice with an explicit per-graph
execution-provider policy, mirroring cosyvoice3/runtime.py:

  - COLD graphs (the 4 Higgs audio-tokenizer graphs: acoustic_encoder,
    semantic_encoder, quantizer_encoder, higgs_decoder): CPU always --
    they run once per voice/utterance and their results are cached,
    never re-run inside the synthesis loop.
  - HOT graphs (the 3 backbone graphs: audio_embeddings, llm_decoder,
    audio_heads): the requested device (CUDA with CPU fallback) -- these
    run 32x per synthesis and dominate latency.

Two separate directories are involved: `model_dir` holds the backbone
variant (hot graphs), `higgs_dir` holds the shared `audio_tokenizer/`
directory (cold graphs) -- the Higgs audio tokenizer is not duplicated
per backbone variant.

`session_factory(path, providers, sess_options)` is the test seam,
mirroring cosyvoice3/runtime.py and qwen3_tts/runtime.py.
"""

GRAPH_FILES = {
    "audio_embeddings": "audio_embeddings_encoder.onnx",
    "llm_decoder": "llm_decoder.onnx",
    "audio_heads": "audio_heads_decoder.onnx",
    "acoustic_encoder": "acoustic_encoder.onnx",
    "semantic_encoder": "semantic_encoder.onnx",
    "quantizer_encoder": "quantizer_encoder.onnx",
    "higgs_decoder": "higgs_decoder.onnx",
}
COLD_GRAPHS = ("acoustic_encoder", "semantic_encoder", "quantizer_encoder",
               "higgs_decoder")


def _default_factory(path, providers, sess_options):
    import onnxruntime as ort
    return ort.InferenceSession(path, sess_options, providers=providers)


def _providers(device: str):
    if device == "cuda":
        return [("CUDAExecutionProvider", {"device_id": 0}),
                "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def build_sessions(model_dir: str, higgs_dir: str, device: str, threads: int,
                   session_factory=None):
    import onnxruntime as ort
    factory = session_factory or _default_factory
    hot = _providers(device)
    cpu = ["CPUExecutionProvider"]
    sessions = {}
    for key, rel in GRAPH_FILES.items():
        so = ort.SessionOptions()
        so.log_severity_level = 3
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = threads
        is_cold = key in COLD_GRAPHS
        base_dir = higgs_dir if is_cold else model_dir
        providers = cpu if is_cold else hot
        session = factory(f"{base_dir}/{rel}", providers, so)
        if device == "cuda" and not is_cold:
            # ORT silently falls back to CPU when the requested EP is
            # unavailable (missing CUDA libs, wrong onnxruntime package,
            # etc.) instead of raising. The backbone graphs are the hot
            # path (run 32x per synthesis) and are deliberately GPU-only
            # with no viable CPU deployment row, so a silently-CPU hot
            # session would invert the design without any visible error.
            # Fail fast instead. `get_providers` is absent on the fake
            # session objects the test seam substitutes (session_factory),
            # so the check is skipped there deliberately -- it's a
            # runtime safety net, not part of the seam's contract.
            get_providers = getattr(session, "get_providers", None)
            if get_providers is not None and \
                    "CUDAExecutionProvider" not in get_providers():
                raise RuntimeError(
                    f"omnivoice: hot graph {key!r} did not get "
                    f"CUDAExecutionProvider (actual providers: "
                    f"{get_providers()}); refusing silent CPU fallback")
        sessions[key] = session
    return sessions
