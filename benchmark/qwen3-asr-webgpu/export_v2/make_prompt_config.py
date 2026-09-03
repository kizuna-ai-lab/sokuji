"""Emit prompt_config.json for the v2 layout.

Everything the browser worker needs that is not a tensor: prompt token ids, the audio-token
formula constants, per-language prefix ids for forcing "language <Name><asr_text>", the
embedding table's dtype/shape/scales file, decoder dims, and which files make each variant.
usage: make_prompt_config.py <model_dir> [int8|float16|float32] [hf_model_id]
Decoder dims and the embedding shape come from the pipeline's config.json in <model_dir>, so
the same script serves the 0.6B and the 1.7B. The andrewleech/qwen3-asr-onnx checkout is found
via $QWEN3_ASR_ONNX_DIR (default: the current directory).
"""
import json
import os
import sys

sys.path.insert(0, os.environ.get("QWEN3_ASR_ONNX_DIR", os.getcwd()))
from src.prompt import ASR_TEXT_TOKEN_ID, AUDIO_PAD_TOKEN_ID, AUDIO_START_TOKEN_ID, EOS_TOKEN_IDS, build_prompt_ids  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402

d = sys.argv[1]
embed_dtype = sys.argv[2] if len(sys.argv) > 2 else "int8"
model_id = sys.argv[3] if len(sys.argv) > 3 else "Qwen/Qwen3-ASR-0.6B"
tok = AutoTokenizer.from_pretrained(d)
with open(os.path.join(d, "config.json")) as f:
    dec = json.load(f)["decoder"]
vocab, hidden = dec["vocab_size"], dec["hidden_size"]

ids0 = build_prompt_ids(0)  # no audio pads: prefix and suffix back to back
cut = ids0.index(AUDIO_START_TOKEN_ID) + 1
prefix, suffix = ids0[:cut], ids0[cut:]
assert build_prompt_ids(3) == prefix + [AUDIO_PAD_TOKEN_ID] * 3 + suffix

names = {"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "yue": "Cantonese", "ar": "Arabic",
         "de": "German", "es": "Spanish", "fr": "French", "it": "Italian", "pt": "Portuguese", "ru": "Russian",
         "th": "Thai", "vi": "Vietnamese", "hi": "Hindi", "id": "Indonesian"}
lang_prefix = {k: tok.encode(f"language {v}", add_special_tokens=False) + [ASR_TEXT_TOKEN_ID] for k, v in names.items()}
for k, v in lang_prefix.items():
    assert tok.decode(v[:-1]) == f"language {names[k]}", (k, tok.decode(v[:-1]))

embedding = {
    "int8": {"file": "embed_tokens.int8.bin", "dtype": "int8", "shape": [vocab, hidden], "scales_file": "embed_scales.f32.bin"},
    "float16": {"file": "embed_tokens.fp16.bin", "dtype": "float16", "shape": [vocab, hidden]},
    "float32": {"file": "embed_tokens.bin", "dtype": "float32", "shape": [vocab, hidden]},
}[embed_dtype]

cfg = {
    "layout_version": 2,
    "model": model_id,
    "mel": {"sample_rate": 16000, "n_fft": 400, "hop_length": 160, "n_mels": 128, "fmin": 0, "fmax": 8000,
            "filters_file": "mel_filters.json", "drop_last_frame": True},
    "audio_tokens": {"conv_window": 100, "tokens_per_window": 13,
                     "conv_out": "(t + 1) // 2 applied three times to (frames % conv_window), plus tokens_per_window per full window"},
    "prompt": {"prefix_ids": prefix, "suffix_ids": suffix, "audio_pad_id": AUDIO_PAD_TOKEN_ID,
               "asr_text_id": ASR_TEXT_TOKEN_ID, "eos_ids": list(EOS_TOKEN_IDS), "max_new_tokens": 256},
    "language_prefix_ids": lang_prefix,
    "language_names": names,
    "embedding": embedding,
    "decoder": {"num_layers": dec["num_layers"], "num_key_value_heads": dec["num_key_value_heads"], "head_dim": dec["head_dim"],
                "hidden_size": hidden, "vocab_size": vocab},
    "variants": {
        "q4": {"encoder": "encoder.onnx", "decoder_init": "decoder_init.int4.onnx", "decoder_step": "decoder_step.int4.onnx",
               "weights": "decoder_weights.int4.data", "required_features": []},
        "q4f16": {"encoder": "encoder.fp16.onnx", "decoder_init": "decoder_init.q4f16.onnx", "decoder_step": "decoder_step.q4f16.onnx",
                  "weights": "decoder_weights.q4f16.data", "required_features": ["shader-f16"]},
    },
}
with open(os.path.join(d, "prompt_config.json"), "w") as f:
    json.dump(cfg, f, indent=1, ensure_ascii=False)
print("prefix", prefix)
print("suffix", suffix)
print("language prefixes:", {k: v for k, v in list(lang_prefix.items())[:4]}, "... 16 total, embedding:", embed_dtype)
print("decoder:", cfg["decoder"], "model:", model_id)
