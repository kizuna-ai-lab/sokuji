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
    import os
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
    torch.onnx.export(w, (ids, amask), os.path.join(out_path, "audio_embeddings_encoder.onnx"),
        input_names=["input_ids", "audio_mask"], output_names=["inputs_embeds"],
        dynamic_axes={"input_ids": {0: "b", 2: "s"}, "audio_mask": {0: "b", 1: "s"},
                      "inputs_embeds": {0: "b", 1: "s"}}, opset_version=20)


def export_audio_heads(model, out_path):
    from codes.model_wrappers import AudioHeadsDecoderWrapper
    w = AudioHeadsDecoderWrapper(heads=model.audio_heads).eval()
    B, S = 1, 64
    hid = torch.randn(B, S, 1024)
    torch.onnx.export(w, (hid,), os.path.join(out_path, "audio_heads_decoder.onnx"),
        input_names=["hidden_states"], output_names=["logits"],
        dynamic_axes={"hidden_states": {0: "b", 1: "s"}, "logits": {0: "b", 2: "s"}},
        opset_version=20)
