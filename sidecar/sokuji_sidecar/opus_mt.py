"""Torch-free opus-mt translation via onnxruntime greedy seq2seq.

Inference reuses the Xenova-style split ONNX exports (encoder + decoder +
decoder_with_past) on onnxruntime — no torch. Tokenization uses the canonical
MarianTokenizer (SentencePiece; transformers' tokenizer is pure-python and does
not require torch), since the Xenova `tokenizer.json` Precompiled normalizer is
rejected by current `tokenizers`. KV-cache names are mapped generically
(present.* -> past_key_values.*) so the loop works for any Marian opus-mt export
with this layout.
"""
import json


def _tok_repo_for(onnx_repo):
    """Map the ONNX repo to the Helsinki repo that ships the SentencePiece tokenizer."""
    name = onnx_repo.split("/")[-1]
    if not name.startswith("opus-mt-"):
        name = "opus-mt-" + name
    return f"Helsinki-NLP/{name}"


def _named_run(sess, feeds):
    names = [o.name for o in sess.get_outputs()]
    return dict(zip(names, sess.run(names, feeds)))


def _present_to_past(out, which):
    return {("past_key_values" + n[len("present"):]): v
            for n, v in out.items() if n.startswith("present") and f".{which}." in n}


class OpusMtTranslator:
    def __init__(self, onnx_repo, tok_repo=None, max_len=512):
        import numpy as np
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from transformers import MarianTokenizer
        self._np = np
        g = lambda f: hf_hub_download(onnx_repo, f, local_files_only=True)

        def sess(name):
            return ort.InferenceSession(g(f"onnx/{name}"), providers=["CPUExecutionProvider"])

        self._enc = sess("encoder_model_quantized.onnx")
        self._dec = sess("decoder_model_quantized.onnx")
        self._decp = sess("decoder_with_past_model_quantized.onnx")
        self._tok = MarianTokenizer.from_pretrained(tok_repo or _tok_repo_for(onnx_repo), local_files_only=True)
        cfg = json.load(open(g("config.json")))
        self._start = cfg.get("decoder_start_token_id", 65000)
        self._eos = cfg.get("eos_token_id", 0)
        self._max_len = max_len

    def translate(self, text):
        np = self._np
        enc = self._tok(text, return_tensors="np")
        enc_ids = enc["input_ids"].astype(np.int64)
        attn = enc["attention_mask"].astype(np.int64)
        ehs = self._enc.run(None, {"input_ids": enc_ids, "attention_mask": attn})[0]

        out = _named_run(self._dec, {
            "encoder_attention_mask": attn,
            "input_ids": np.array([[self._start]], dtype=np.int64),
            "encoder_hidden_states": ehs,
        })
        tok_id = int(out["logits"][0, -1].argmax())
        enc_kv = _present_to_past(out, "encoder")   # constant across steps
        dec_kv = _present_to_past(out, "decoder")   # updated each step

        ids = []
        while len(ids) < self._max_len:
            if tok_id == self._eos:
                break
            ids.append(tok_id)
            out = _named_run(self._decp, {
                "encoder_attention_mask": attn,
                "input_ids": np.array([[tok_id]], dtype=np.int64),
                **dec_kv, **enc_kv,
            })
            tok_id = int(out["logits"][0, -1].argmax())
            dec_kv = _present_to_past(out, "decoder")

        return self._tok.decode(ids, skip_special_tokens=True).strip()
