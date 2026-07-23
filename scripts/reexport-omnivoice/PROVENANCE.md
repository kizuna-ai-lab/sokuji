# omnivoice-onnx-bidi — provenance

- Source: k2-fsa/OmniVoice (weights CC-BY-NC-4.0; root constraint: Emilia dataset).
- This artifact re-exports ALL graphs from that source. The `llm_decoder` is exported with a
  **full (bidirectional) attention mask** — unlike `onnx-community/OmniVoice-Onnx`, whose genai
  `Qwen3ForCausalLM` build is **causal** and produces noise (see sokuji#351).
- Inference: plain onnxruntime; the real decoding algorithm (CFG + special-token framing + gumbel +
  schedule) lives in the Sokuji sidecar backend, not in this repo.
- Verification scope: this toolchain's `verify.py` is a HYBRID check — only `llm_decoder.onnx` runs
  through onnxruntime, with embeddings/heads/Higgs still in PyTorch. The pure-ONNX pipeline is the
  sidecar backend (`sidecar/sokuji_sidecar/omnivoice/`), whose numpy decoder was verified to exact
  (1.0) parity against the PyTorch reference.
- License of THIS artifact remains CC-BY-NC-4.0 (a derivative of NC weights). Non-commercial only.
