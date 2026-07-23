# scripts/reexport-omnivoice/verify.py
"""Plan-1 end-to-end check: run the model's own generate() with model.llm monkeypatched
to an ONNX-backed shim, so a quantized llm_decoder.onnx can be validated by producing real
speech through the unmodified PyTorch pipeline (audio embeddings, audio heads, Higgs
tokenizer all stay native PyTorch — only the bidirectional LLM backbone is swapped).

Ported from the proven .spike/reexport.py OnnxLLMShim/hybrid-generate spike.
"""
import numpy as np
import torch
import onnxruntime as ort
from exporters import load_model


class _OnnxLLMShim:
    def __init__(self, sess, real):
        self._s, self._r = sess, real

    def __call__(self, inputs_embeds=None, attention_mask=None, return_dict=True, position_ids=None, **kw):
        h = self._s.run(["hidden_states"], {
            "inputs_embeds": inputs_embeds.detach().cpu().numpy().astype(np.float32),
            "attention_mask": attention_mask.detach().cpu().numpy()})[0]
        return (torch.from_numpy(h).to(inputs_embeds.dtype),)

    def __getattr__(self, n):
        return getattr(self._r, n)


def hybrid_generate(model_dir, backbone_dir, higgs_dir, text, language, provider="CPUExecutionProvider"):
    """Load the model fresh, swap model.llm for an ONNX session at
    <backbone_dir>/llm_decoder.onnx, and run the real model.generate(). higgs_dir is
    accepted for interface symmetry with the other export stages but unused here: the
    model's own native Higgs (PyTorch) audio tokenizer handles decode, not our exported
    Higgs graphs. `provider` selects the ONNX Runtime execution provider for the
    llm_decoder session (default CPU; pass "CUDAExecutionProvider" to run the
    bidirectional LLM backbone on GPU — see cuda_rtf below).
    """
    m = load_model(model_dir)
    sess = ort.InferenceSession(f"{backbone_dir}/llm_decoder.onnx", providers=[provider])
    real = m.llm
    del m._modules["llm"]           # deregister the nn.Module so a plain shim can take its place
    m.llm = _OnnxLLMShim(sess, real)
    return np.asarray(m.generate(text=text, language=language)[0], dtype=np.float32).squeeze()


def cuda_rtf(model_dir, backbone_dir, text="This is a real time factor measurement.", language="English"):
    """Measure end-to-end RTF with the bidirectional llm_decoder.onnx running on
    CUDAExecutionProvider (GB10 GPU). Everything else in hybrid_generate (audio
    embeddings/heads, Higgs tokenizer decode) still runs in PyTorch on CPU, so the
    returned rtf is an UPPER BOUND on the pure-ONNX pipeline planned for Plan 2 —
    re-confirm there once embeddings/heads/decode are also ONNX.
    """
    import time
    if "CUDAExecutionProvider" in ort.get_available_providers():
        ort.preload_dlls()
    t = time.time()
    wav = hybrid_generate(model_dir, backbone_dir, None, text, language, provider="CUDAExecutionProvider")
    gen = time.time() - t
    dur = len(wav) / 24000
    return {"gen_s": round(gen, 2), "audio_s": round(dur, 2), "rtf": round(gen / dur, 3)}
