# scripts/reexport-omnivoice/exporters.py
import os
import torch, omnivoice  # noqa: F401
from transformers import AutoModel


def load_model(model_dir):
    return AutoModel.from_pretrained(model_dir, trust_remote_code=True, dtype=torch.float32,
                                     attn_implementation="eager").eval()


class BidiLLM(torch.nn.Module):
    def __init__(self, llm):
        super().__init__(); self.llm = llm

    def forward(self, inputs_embeds, attention_mask):
        return self.llm(inputs_embeds=inputs_embeds, attention_mask=attention_mask, return_dict=True)[0]


def export_llm(model, out_path, dtype="fp32"):
    os.makedirs(out_path, exist_ok=True)
    H = model.llm.config.hidden_size
    wrap = BidiLLM(model.llm).eval()
    emb = torch.randn(1, 8, H); full = torch.ones(1, 1, 8, 8, dtype=torch.bool)
    with torch.no_grad():
        torch.onnx.export(
            wrap, (emb, full), os.path.join(out_path, "llm_decoder.onnx"),
            input_names=["inputs_embeds", "attention_mask"], output_names=["hidden_states"],
            dynamic_axes={"inputs_embeds": {0: "b", 1: "s"},
                          "attention_mask": {0: "b", 2: "s", 3: "s"},
                          "hidden_states": {0: "b", 1: "s"}},
            opset_version=20, do_constant_folding=True)
    # dtype conversion (fp16/int4) is handled in Task 5; fp32 is the base export.


def export_audio_embeddings(model, out_path):
    from codes.model_wrappers import AudioEmbeddingsEncoderWrapper
    w = AudioEmbeddingsEncoderWrapper(text_embed=model.get_input_embeddings(),
                                      audio_embed=model.audio_embeddings,
                                      layer_offsets=model.codebook_layer_offsets).eval()
    B, S = 1, 64
    ids = torch.randint(0, 1025, (B, 8, S), dtype=torch.int64)
    amask = torch.zeros(B, S, dtype=torch.bool); amask[:, S//4:3*S//4] = True
    with torch.no_grad():
        torch.onnx.export(w, (ids, amask), os.path.join(out_path, "audio_embeddings_encoder.onnx"),
            input_names=["input_ids", "audio_mask"], output_names=["inputs_embeds"],
            dynamic_axes={"input_ids": {0: "b", 2: "s"}, "audio_mask": {0: "b", 1: "s"},
                          "inputs_embeds": {0: "b", 1: "s"}}, opset_version=20)


def export_audio_heads(model, out_path):
    from codes.model_wrappers import AudioHeadsDecoderWrapper
    w = AudioHeadsDecoderWrapper(heads=model.audio_heads).eval()
    B, S = 1, 64
    hid = torch.randn(B, S, 1024)
    with torch.no_grad():
        torch.onnx.export(w, (hid,), os.path.join(out_path, "audio_heads_decoder.onnx"),
            input_names=["hidden_states"], output_names=["logits"],
            dynamic_axes={"hidden_states": {0: "b", 1: "s"}, "logits": {0: "b", 2: "s"}},
            opset_version=20)


def export_higgs(model_dir, out_path):
    """Re-export the four Higgs Audio V2 Tokenizer ONNX graphs (fp32) from source.

    Loads HiggsAudioV2TokenizerModel from <model_dir>/audio_tokenizer, strips weight_norm via
    the committed _prepare_tok, then writes acoustic_encoder / semantic_encoder /
    quantizer_encoder / higgs_decoder .onnx into <out_path>/audio_tokenizer/. fp32 only — the
    fp16 semantic_encoder is a known-broken export, so no dtype conversion happens here.

    Uses only committed code (codes.model_wrappers); no dependency on user_script or .spike.
    """
    from codes.model_wrappers import (
        _prepare_tok,
        HiggsAcousticEncoderWrapper, HiggsSemanticEncoderWrapper,
        HiggsQuantizerEncoderWrapper, HiggsDecoderWrapper,
        SR_24K, SR_16K, DOWNSAMPLE_FACTOR,
        HIGGS_D_ACOUSTIC, HIGGS_D_SEMANTIC, HIGGS_N_CB, HIGGS_CB_SIZE,
    )
    audio_tok_dir = os.path.join(model_dir, "audio_tokenizer")
    tok = AutoModel.from_pretrained(audio_tok_dir, dtype=torch.float32,
                                    attn_implementation="eager")
    tok = _prepare_tok(tok)

    d = os.path.join(out_path, "audio_tokenizer")
    os.makedirs(d, exist_ok=True)
    ds = int(getattr(tok.config, "semantic_downsample_factor", 2))
    T = SR_24K // DOWNSAMPLE_FACTOR  # 25 frames ~= 1 s of dummy features/codes

    # 1. acoustic_encoder: (B, 1, T_samples) -> (B, 256, T_frames)
    # The DAC residual units have a shape-dependent `if padding > 0` branch, so jit.trace the
    # wrapper first (resolves the branch to a no-op) and hand the ScriptModule straight to the
    # legacy TorchScript exporter (dynamo=False). This mirrors the authors' get_higgs_acoustic_model
    # returning a torch.jit.trace() result. Length stays dynamic despite tracing on a 1 s example.
    acoustic_wav = torch.randn(1, 1, SR_24K)
    acoustic = HiggsAcousticEncoderWrapper(tok.acoustic_encoder).eval()
    with torch.no_grad():
        acoustic = torch.jit.trace(acoustic, (acoustic_wav,), check_trace=False)
        torch.onnx.export(
            acoustic, (acoustic_wav,),
            os.path.join(d, "acoustic_encoder.onnx"),
            input_names=["waveform_24k"], output_names=["acoustic_features"],
            dynamic_axes={"waveform_24k": {0: "batch", 2: "samples"},
                          "acoustic_features": {0: "batch", 2: "frames"}},
            opset_version=20, dynamo=False)

    # 2. semantic_encoder: (B, T_samples) -> (B, 768, T_frames)
    semantic = HiggsSemanticEncoderWrapper(
        tok.semantic_model, tok.encoder_semantic, downsample_factor=ds).eval()
    with torch.no_grad():
        torch.onnx.export(
            semantic, (torch.randn(1, SR_16K),),
            os.path.join(d, "semantic_encoder.onnx"),
            input_names=["waveform_16k"], output_names=["semantic_features"],
            dynamic_axes={"waveform_16k": {0: "batch", 1: "samples"},
                          "semantic_features": {0: "batch", 2: "frames"}},
            opset_version=20, dynamo=False)

    # 3. quantizer_encoder: acoustic (B,256,T) + semantic (B,768,T) -> codes (num_q, B, T)
    quantizer = HiggsQuantizerEncoderWrapper(tok.fc, tok.quantizer, merge_mode="concat").eval()
    with torch.no_grad():
        torch.onnx.export(
            quantizer,
            (torch.randn(1, HIGGS_D_ACOUSTIC, T), torch.randn(1, HIGGS_D_SEMANTIC, T)),
            os.path.join(d, "quantizer_encoder.onnx"),
            input_names=["acoustic_features", "semantic_features"], output_names=["codes"],
            dynamic_axes={"acoustic_features": {0: "batch", 2: "frames"},
                          "semantic_features": {0: "batch", 2: "frames"},
                          "codes": {1: "batch", 2: "frames"}},
            opset_version=20, dynamo=False)

    # 4. higgs_decoder: codes (num_q, B, T) -> waveform_24k (B, 1, T_samples)
    # Same DAC branch in acoustic_decoder -> jit.trace the whole composite decoder wrapper before
    # export (mirrors the authors' get_higgs_decoder_model). Tracing as one unit unrolls RVQ.decode's
    # fixed num-quantizers loop while resolving the DAC branch; num_quantizers (codes axis 0) is static.
    codes_dummy = torch.randint(0, HIGGS_CB_SIZE, (HIGGS_N_CB, 1, T), dtype=torch.int64)
    decoder = HiggsDecoderWrapper(tok.quantizer, tok.fc2, tok.acoustic_decoder).eval()
    with torch.no_grad():
        decoder = torch.jit.trace(decoder, (codes_dummy,), check_trace=False)
        torch.onnx.export(
            decoder, (codes_dummy,),
            os.path.join(d, "higgs_decoder.onnx"),
            input_names=["codes"], output_names=["waveform_24k"],
            dynamic_axes={"codes": {1: "batch", 2: "frames"},
                          "waveform_24k": {0: "batch", 2: "samples"}},
            opset_version=20, dynamo=False)
