"""v2 export: prefill on input_embeds (no embedding table in any graph), last-token logits.

Reuses the andrewleech/qwen3-asr-onnx pipeline (layer forward, step export, Reshape fixup);
only the prefill wrapper is new. usage: export_v2.py --src <v1 dir> --out <v2 dir>
"""
import argparse
import os
import shutil
import sys

import torch
import torch.nn as nn

PIPE = "/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx"
sys.path.insert(0, PIPE)
os.chdir(PIPE)  # export.py resolves its helpers relative to the checkout
from export import load_model  # noqa: E402
from src.decoder_wrapper import _decoder_layer_forward, export_decoder_step  # noqa: E402
from src.onnx_fixup import fix_reshape_allowzero  # noqa: E402


class PrefillEmbedsWrapper(nn.Module):
    """Decoder prefill over caller-provided embeddings; emits last-position logits + stacked KV."""

    def __init__(self, text_model, lm_head, text_config):
        super().__init__()
        self.layers = text_model.layers
        self.norm = text_model.norm
        self.rotary_emb = text_model.rotary_emb
        self.lm_head = lm_head
        self.num_kv_groups = text_config.num_attention_heads // text_config.num_key_value_heads

    def forward(self, input_embeds, position_ids):
        seq_len = input_embeds.shape[1]
        cos, sin = self.rotary_emb(input_embeds, position_ids.unsqueeze(0).expand(3, -1, -1))
        mask = torch.full((seq_len, seq_len), torch.finfo(input_embeds.dtype).min, dtype=input_embeds.dtype)
        mask = torch.triu(mask, diagonal=1).unsqueeze(0).unsqueeze(0)
        h, ks, vs = input_embeds, [], []
        for layer in self.layers:
            h, k, v = _decoder_layer_forward(layer, h, cos, sin, mask, past_key=None, past_value=None,
                                             num_kv_groups=self.num_kv_groups)
            ks.append(k)
            vs.append(v)
        logits = self.lm_head(self.norm(h)[:, -1:, :])
        return logits, torch.stack(ks, dim=0), torch.stack(vs, dim=0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-ASR-0.6B")
    ap.add_argument("--src", required=True, help="v1 output dir (encoder.onnx, tokenizer, config, embed_tokens.bin)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--opset", type=int, default=17)
    a = ap.parse_args()
    src, out = os.path.abspath(a.src), os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)

    model = load_model(a.model, dtype=torch.float32)
    tc = model.config.thinker_config.text_config
    wrapper = PrefillEmbedsWrapper(model.thinker.model, model.thinker.lm_head, tc).eval()

    seq_len = 100
    dummy_x = torch.randn(1, seq_len, tc.hidden_size, dtype=torch.float32)
    dummy_pos = torch.arange(seq_len, dtype=torch.long).unsqueeze(0)
    init_path = os.path.join(out, "decoder_init.onnx")
    with torch.no_grad():
        torch.onnx.export(
            wrapper, (dummy_x, dummy_pos), init_path,
            input_names=["input_embeds", "position_ids"],
            output_names=["logits", "present_keys", "present_values"],
            dynamic_axes={
                "input_embeds": {0: "batch", 1: "seq_len"},
                "position_ids": {0: "batch", 1: "seq_len"},
                "present_keys": {1: "batch", 3: "seq_len"},
                "present_values": {1: "batch", 3: "seq_len"},
            },
            opset_version=a.opset, do_constant_folding=True,
        )
    n = fix_reshape_allowzero(init_path)
    print(f"decoder_init (embeds) -> {init_path} (fixed {n} Reshape allowzero attrs)")

    export_decoder_step(model, os.path.join(out, "decoder_step.onnx"), opset_version=a.opset)

    for f in ("encoder.onnx", "encoder.fp16.onnx", "embed_tokens.bin", "tokenizer.json", "tokenizer_config.json",
              "vocab.json", "added_tokens.json", "config.json", "preprocessor_config.json", "mel_filters.json"):
        if os.path.exists(os.path.join(src, f)):
            shutil.copy(os.path.join(src, f), out)
    for f in sorted(os.listdir(out)):
        print(f"{os.path.getsize(os.path.join(out, f)) / 1e6:9.1f} MB  {f}")


if __name__ == "__main__":
    main()
