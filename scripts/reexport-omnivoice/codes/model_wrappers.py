"""ONNX-export wrapper modules for the OmniVoice backbone (non-LLM graphs).

PROVENANCE: this module is imported by `exporters.py` (`from codes.model_wrappers import ...`)
as `user_script.py` in the upstream onnx-community export toolchain does, but the upstream
`onnx-community` repo that ships `user_script.py` does not ship its `codes/` package — so this
file does not exist anywhere upstream to vendor verbatim.

The two wrapper classes below are NOT a guess: they are a direct, line-for-line port of
`OmniVoice._prepare_embed_inputs()` and the `audio_heads` projection + reshape block from
`OmniVoice.forward()`, as implemented in the `omnivoice` PyPI package itself
(`omnivoice/models/omnivoice.py`, Apache-2.0, Copyright 2026 Xiaomi Corp — authors: Han Zhu).
Reconstructed here so the two backbone exporters (`export_audio_embeddings`/`export_audio_heads`)
have a committed, reproducible import target instead of depending on gitignored spike scratch.
Only `AudioEmbeddingsEncoderWrapper` and `AudioHeadsDecoderWrapper` are included here — Higgs
wrapper classes (used by Task 4, not this task) are intentionally NOT included; add them there
when needed.
"""

import torch
import torch.nn as nn

HIDDEN_SIZE = 1024
NUM_CODEBOOKS = 8
AUDIO_VOCAB = 1025


class AudioEmbeddingsEncoderWrapper(nn.Module):
    """Fuses text + audio-codec token embeddings into a single ONNX-exportable module.

    Ports `OmniVoice._prepare_embed_inputs(input_ids, audio_mask)` verbatim, taking the
    three participating sub-modules/buffers as constructor args instead of `self.*` lookups
    so the graph has no dependency on the rest of the OmniVoice model.
    """

    def __init__(self, text_embed, audio_embed, layer_offsets):
        super().__init__()
        self.text_embed = text_embed
        self.audio_embed = audio_embed
        self.register_buffer("layer_offsets", layer_offsets.view(1, -1, 1), persistent=False)

    def forward(self, input_ids: torch.Tensor, audio_mask: torch.Tensor) -> torch.Tensor:
        # input_ids: [Batch, 8, Seq] ; audio_mask: [Batch, Seq]
        text_embeds = self.text_embed(input_ids[:, 0, :])

        # Apply shift to audio IDs based on codebook layer (Layer 0 ID, Layer 1 ID + 1025, ...)
        shifted_ids = (input_ids * audio_mask.unsqueeze(1)) + self.layer_offsets

        # [Batch, 8, Seq] -> [Batch, Seq, Hidden]
        audio_embeds = self.audio_embed(shifted_ids).sum(dim=1)

        return torch.where(audio_mask.unsqueeze(-1), audio_embeds, text_embeds)


class AudioHeadsDecoderWrapper(nn.Module):
    """Projects LLM hidden states to per-codebook audio-token logits.

    Ports the `audio_heads` + reshape block from `OmniVoice.forward()` verbatim:
    `hidden_states [B,S,H] -> logits_flat [B,S,C*V] -> logits [B,C,S,V]`.
    """

    def __init__(self, heads):
        super().__init__()
        self.heads = heads

    def forward(self, hidden_states: torch.Tensor) -> torch.Tensor:
        batch_size, seq_len, _ = hidden_states.shape
        logits_flat = self.heads(hidden_states)
        # [B, S, C, V] -> [B, C, S, V]
        return logits_flat.view(
            batch_size, seq_len, NUM_CODEBOOKS, AUDIO_VOCAB
        ).permute(0, 2, 1, 3)
