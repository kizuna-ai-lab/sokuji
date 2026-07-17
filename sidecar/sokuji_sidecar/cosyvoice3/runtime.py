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
        sessions[key] = factory(f"{model_dir}/{rel}", providers, so)
    return sessions
