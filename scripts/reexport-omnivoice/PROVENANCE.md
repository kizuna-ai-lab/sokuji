# omnivoice-onnx-bidi — provenance

- Source: k2-fsa/OmniVoice (weights CC-BY-NC-4.0; root constraint: Emilia dataset).
- This artifact re-exports ALL graphs from that source. The `llm_decoder` is exported with a
  **full (bidirectional) attention mask** — unlike `onnx-community/OmniVoice-Onnx`, whose genai
  `Qwen3ForCausalLM` build is **causal** and produces noise (see sokuji#351).
- Inference: plain onnxruntime; the real decoding algorithm (CFG + special-token framing + gumbel +
  schedule) lives in the Sokuji sidecar backend, not in this repo.
- License of THIS artifact remains CC-BY-NC-4.0 (a derivative of NC weights). Non-commercial only.
