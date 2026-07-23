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
`AudioEmbeddingsEncoderWrapper` and `AudioHeadsDecoderWrapper` cover the OmniVoice backbone.

The four Higgs* wrapper classes + constants + `_strip_weight_norm`/`_prepare_tok` below are a
reconstructed port (Apache-2.0) of the Higgs Audio V2 Tokenizer export logic that the authors'
`user_script.py` imported from a `codes/` package which upstream never shipped. They are NOT a
guess: each `forward` is a line-for-line transcription of `HiggsAudioV2TokenizerModel.encode()`
and `.decode()` in transformers
(`transformers/models/higgs_audio_v2_tokenizer/modeling_higgs_audio_v2_tokenizer.py`,
Copyright 2025 Boson AI and The HuggingFace Team, Apache-2.0), split at the four sub-graph
boundaries the authors' `user_script.py` documented (acoustic / semantic / quantizer / decoder),
and cross-checked against that upstream `user_script.py`'s IO configs and dummy-input shapes.
The DAC `acoustic_encoder` and `acoustic_decoder` contain a shape-dependent Python branch
(`DacResidualUnit.forward`: `if padding > 0`) plus `Snake1d`'s shape-capture reshape, which
`torch.onnx.export` cannot resolve cleanly — so, exactly as the authors did, they are
`torch.jit.trace()`d first to bake a branch-free graph before ONNX export.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

HIDDEN_SIZE = 1024
NUM_CODEBOOKS = 8
AUDIO_VOCAB = 1025

# --- Higgs Audio V2 Tokenizer constants (audio_tokenizer/config.json, cross-checked at runtime) ---
SR_24K = 24000           # config.sample_rate — DAC acoustic sample rate
SR_16K = 16000           # config.semantic_sample_rate — HuBERT semantic sample rate
DOWNSAMPLE_FACTOR = 960  # config.hop_length = prod(downsampling_ratios [8,5,4,2,3]); 24000/960 = 25 fps
HIGGS_D_ACOUSTIC = 256   # acoustic_model_config.hidden_size (DAC encoder output channels)
HIGGS_D_SEMANTIC = 768   # semantic_model_config.hidden_size (HuBERT / SemanticEncoder channels)
HIGGS_N_CB = 8           # config.num_quantizers = 1000*bw[-1]//(frame_rate*nbits) = 2000//250
HIGGS_CB_SIZE = 1024     # config.codebook_size
# The semantic branch pads with a hardcoded 160 (NOT self.pad=hop_length//2=480) — see
# HiggsAudioV2TokenizerModel._extract_semantic_features: F.pad(input_values, (160, 160)).
HIGGS_SEMANTIC_PAD = 160


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


# =============================================================================
# Higgs Audio V2 Tokenizer — weight-norm stripping + four export sub-graphs
# =============================================================================


def _strip_weight_norm(module: nn.Module) -> nn.Module:
    """Remove every weight_norm hook / parametrization under `module` in place.

    weight_norm keeps the effective conv weight as `w = g * v/||v||`, recomputed each
    forward via a hook (legacy `torch.nn.utils.weight_norm`) or a parametrization
    (`torch.nn.utils.parametrizations.weight_norm`). Both add non-persistent state that
    `torch.onnx.export` chokes on, so we fold the effective weight into a plain Parameter.

    HiggsAudioV2TokenizerModel exposes `remove_weight_norm()` but it only covers the DAC
    acoustic encoder/decoder; the HuBERT semantic model's `pos_conv_embed.conv` is
    parametrized too, so we also walk every submodule generically.
    """
    if hasattr(module, "remove_weight_norm"):
        try:
            module.remove_weight_norm()
        except Exception:
            pass
    for m in module.modules():
        try:  # legacy hook-based weight_norm
            torch.nn.utils.remove_weight_norm(m)
        except (ValueError, AttributeError, RuntimeError):
            pass
        params = getattr(m, "parametrizations", None)
        if params is not None and "weight" in params:  # parametrization-based weight_norm
            try:
                torch.nn.utils.parametrize.remove_parametrizations(m, "weight", leave_parametrized=True)
            except Exception:
                pass
    return module


def _prepare_tok(tok):
    """Strip weight_norm + detach all grads on the full tokenizer, in place.

    Must run on the whole `tok` BEFORE extracting sub-modules: weight_norm hooks live on
    the Conv layers, and stripping the parent cleans them all at once. Bound methods like
    `tok.encode` are not nn.Modules, so they cannot be cleaned individually.
    """
    tok.eval()
    _strip_weight_norm(tok)
    tok.requires_grad_(False)
    # weight_norm removal can leave the folded weight as a plain grad-tracking tensor.
    for sub in tok.modules():
        for attr_name in list(vars(sub)):
            v = getattr(sub, attr_name, None)
            if (isinstance(v, torch.Tensor)
                    and not isinstance(v, torch.nn.Parameter)
                    and v.requires_grad):
                setattr(sub, attr_name, v.detach())
    return tok


class HiggsAcousticEncoderWrapper(nn.Module):
    """DAC acoustic encoder: waveform_24k (B,1,T_samples) -> acoustic_features (B,256,T_frames).

    Wraps `tok.acoustic_encoder`, the DAC encoder branch of
    `HiggsAudioV2TokenizerModel.encode()` (the `e_acoustic = self.acoustic_encoder(...)` line).
    The DAC residual units carry a shape-dependent `if padding > 0` branch, so this wrapper is
    `torch.jit.trace()`d before ONNX export (see `exporters.export_higgs`, the analog of the
    authors' `get_higgs_acoustic_model` loader which returns a traced result). The branch
    resolves to a no-op for real audio; length stays dynamic (conv ops + Snake1d's dynamic
    reshape are length-agnostic). The wrapper itself stays a plain nn.Module so the exporter's
    own tracer can register it — never store a pre-traced ScriptModule as a submodule.
    """

    def __init__(self, acoustic_encoder: nn.Module):
        super().__init__()
        self.acoustic_encoder = acoustic_encoder

    def forward(self, waveform_24k: torch.Tensor) -> torch.Tensor:
        return self.acoustic_encoder(waveform_24k)


class HiggsSemanticEncoderWrapper(nn.Module):
    """HuBERT semantic encoder: waveform_16k (B,T_samples) -> semantic_features (B,768,T_frames).

    Replicates `HiggsAudioV2TokenizerModel._extract_semantic_features()` followed by
    `encoder_semantic` (the `e_semantic = self.encoder_semantic(...)` line of `.encode()`).
    The input is already 16 kHz mono, so the internal resample + `[:, 0, :]` channel-select are
    skipped; everything after `F.pad(160, 160)` is identical:
      pad -> HuBERT(output_hidden_states) -> mean over ALL hidden states -> stride-`downsample_factor`
      -> encoder_semantic(features.transpose(1,2)).
    HuBERT has no data-dependent branches in eval (mask probs = 0), so no jit.trace is needed.
    """

    def __init__(self, semantic_model: nn.Module, encoder_semantic: nn.Module,
                 downsample_factor: int = 2, pad: int = HIGGS_SEMANTIC_PAD):
        super().__init__()
        self.semantic_model = semantic_model
        self.encoder_semantic = encoder_semantic
        self.downsample_factor = int(downsample_factor)
        self.pad = int(pad)

    def forward(self, waveform_16k: torch.Tensor) -> torch.Tensor:
        input_values = F.pad(waveform_16k, (self.pad, self.pad))
        outputs = self.semantic_model(input_values, output_hidden_states=True)
        stacked = torch.stack([h for h in outputs.hidden_states], dim=1)
        semantic_features = stacked.mean(dim=1)                      # (B, T_frames, 768)
        if self.downsample_factor > 1:
            semantic_features = semantic_features[:, :: self.downsample_factor, :]
        return self.encoder_semantic(semantic_features.transpose(1, 2))  # (B, 768, T_frames)


class HiggsQuantizerEncoderWrapper(nn.Module):
    """RVQ encoder: acoustic (B,256,T) + semantic (B,768,T) -> codes (num_q, B, T).

    Reproduces the tail of `HiggsAudioV2TokenizerModel.encode()`:
      embeddings = cat([acoustic, semantic], dim=1) -> fc(transpose) -> quantizer.encode.
    `merge_mode="concat"` matches the only merge the transformers implementation uses. The
    codes are returned as the RVQ produces them, (num_quantizers, B, T) — the (B, num_q, T)
    transpose that full `.encode()` applies is left out, and the decoder wrapper consumes this
    same (num_q, B, T) layout. RVQ.encode is a fixed Python loop, so it exports directly.
    """

    def __init__(self, fc: nn.Module, quantizer: nn.Module, merge_mode: str = "concat"):
        super().__init__()
        self.fc = fc
        self.quantizer = quantizer
        assert merge_mode == "concat", f"only concat merge is supported (got {merge_mode})"

    def forward(self, acoustic_features: torch.Tensor, semantic_features: torch.Tensor) -> torch.Tensor:
        embeddings = torch.cat([acoustic_features, semantic_features], dim=1)   # (B, 1024, T)
        embeddings = self.fc(embeddings.transpose(1, 2)).transpose(1, 2)        # (B, 1024, T)
        return self.quantizer.encode(embeddings)                               # (num_q, B, T)


class HiggsDecoderWrapper(nn.Module):
    """Codec decoder: codes (num_q, B, T) -> waveform_24k (B, 1, T_samples).

    Reproduces `HiggsAudioV2TokenizerModel.decode()` minus its leading transpose (codes already
    arrive in the (num_q, B, T) layout produced by HiggsQuantizerEncoderWrapper):
      quantizer.decode(codes) -> fc2(transpose) -> acoustic_decoder.
    The DAC `acoustic_decoder` carries the same shape-dependent branch as the encoder, so the
    whole wrapper is `torch.jit.trace()`d before ONNX export (see `exporters.export_higgs`).
    Tracing the composite as one unit resolves the DAC branch while keeping RVQ.decode's fixed
    num-quantizers loop unrolled; the wrapper stays a plain nn.Module (no nested ScriptModule).
    """

    def __init__(self, quantizer: nn.Module, fc2: nn.Module, acoustic_decoder: nn.Module):
        super().__init__()
        self.quantizer = quantizer
        self.fc2 = fc2
        self.acoustic_decoder = acoustic_decoder

    def forward(self, codes: torch.Tensor) -> torch.Tensor:
        quantized = self.quantizer.decode(codes)                          # (B, 1024, T)
        quantized_acoustic = self.fc2(quantized.transpose(1, 2)).transpose(1, 2)  # (B, 256, T)
        return self.acoustic_decoder(quantized_acoustic)                  # (B, 1, T_samples)
