# Apache License 2.0
"""ONNX session construction for CosyVoice3 with an explicit per-graph
execution-provider policy (spike-verified):

  - COLD graphs (speech_tokenizer_v3 969MB, campplus): CPU always — they
    run once per voice (results are cached), never in the synthesis loop.
  - HOT graphs: the requested device (CUDA with CPU fallback) — int4
    MatMulNBits backbones + fp32 flow/hift/decoder graphs are valid on
    both CPU and CUDA at graph-optimization level ALL on ORT >= 1.23.2.
  - fp16 graphs are deliberately NOT shipped: they are numerically broken
    on CUDA and on ORT >= 1.24 CPU (NaN / garbage tokens).

`session_factory(path, providers, sess_options)` is the test seam,
mirroring qwen3_tts/runtime.py.
"""

GRAPH_FILES = {
    "text_embedding": "onnx/text_embedding.onnx",
    "speech_tokenizer": "onnx/speech_tokenizer_v3.onnx",
    "campplus": "onnx/campplus.onnx",
    "llm_initial": "onnx/llm_backbone_initial_int4.onnx",
    "llm_decode": "onnx/llm_backbone_decode_int4.onnx",
    "llm_decoder": "onnx/llm_decoder.onnx",
    "speech_embedding": "onnx/llm_speech_embedding.onnx",
    "flow_token_embedding": "onnx/flow_token_embedding.onnx",
    "flow_spk_projection": "onnx/flow_speaker_projection.onnx",
    "flow_pre_lookahead": "onnx/flow_pre_lookahead.onnx",
    "flow_estimator": "onnx/flow_estimator.onnx",
    "hift_f0": "onnx/hift_f0_predictor.onnx",
    "hift_source": "onnx/hift_source_generator.onnx",
    "hift_decoder": "onnx/hift_decoder.onnx",
}
COLD_GRAPHS = ("speech_tokenizer", "campplus")


def _default_factory(path, providers, sess_options):
    import onnxruntime as ort
    return ort.InferenceSession(path, sess_options, providers=providers)


def _providers(device: str):
    if device == "cuda":
        return [("CUDAExecutionProvider", {"device_id": 0}),
                "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def build_sessions(model_dir: str, device: str, threads: int,
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
        providers = cpu if key in COLD_GRAPHS else hot
        session = factory(f"{model_dir}/{rel}", providers, so)
        if device == "cuda" and key not in COLD_GRAPHS:
            # ORT silently falls back to CPU when the requested EP is
            # unavailable (missing CUDA libs, wrong onnxruntime package,
            # etc.) instead of raising. This card is deliberately GPU-only
            # with no cpu deployment row (spike-measured CPU RTF ~3.5 misses
            # the realtime bar), so a silently-CPU hot session would invert
            # the design without any visible error, at an RTF around 3.
            # Fail fast instead. `get_providers` is absent on the fake
            # session objects the test seam substitutes (session_factory),
            # so the check is skipped there deliberately -- it's a runtime
            # safety net, not part of the seam's contract.
            get_providers = getattr(session, "get_providers", None)
            if get_providers is not None and \
                    "CUDAExecutionProvider" not in get_providers():
                raise RuntimeError(
                    f"cosyvoice3: hot graph {key!r} did not get "
                    f"CUDAExecutionProvider (actual providers: "
                    f"{get_providers()}); refusing silent CPU fallback")
        sessions[key] = session
    return sessions
