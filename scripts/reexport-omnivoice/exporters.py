# scripts/reexport-omnivoice/exporters.py
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
