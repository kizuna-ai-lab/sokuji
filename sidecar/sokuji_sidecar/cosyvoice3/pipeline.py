# Apache License 2.0
"""CosyVoice3 pure-ONNX zero-shot TTS pipeline: voice-prompt processing,
the LLM autoregressive loop, CFM flow with classifier-free guidance, and
the HiFT vocoder.

Direct port of ``.spike/cosyvoice3_spike.py`` (class ``CosyVoice3Onnx``)
into module functions taking a ``sessions`` dict (built by
``cosyvoice3.runtime.build_sessions``) as the first argument. See that
file's module docstring for the full rationale behind each numerical
choice (ras_sampling, stop-id superset, CFG flow, cosine CFM schedule,
feature configs, silent-token suppression) — nothing here should diverge
from it except the deltas called out below:

  - Resampling uses ``soxr`` instead of librosa (sidecar dependency,
    lighter than librosa's numba/audioread chain).
  - The prompt waveform is trimmed to 30s before feature extraction.
  - Empty/whitespace TTS text returns empty audio without touching any
    session (no prompt tokens wasted on a no-op request).
  - ``speed`` is applied post-flow by linearly resampling the mel time
    axis (official CosyVoice3 semantics), not by scaling durations
    upstream.
"""
from dataclasses import dataclass

import numpy as np
import soxr

from . import frontend
from .mel import kaldi_fbank_80_cmn, matcha_mel_80, whisper_log_mel_128
from .sampling import ras_sampling

SAMPLE_RATE = 24000
SPEECH_TOKEN_SIZE = 6561
SOS = 6561
TASK_ID = 6563
STOP_TOKEN_MIN = SPEECH_TOKEN_SIZE          # ids 6561..6760 all stop decoding
SILENT_TOKENS = frozenset({1, 2, 28, 29, 55, 248, 494, 2241, 2242, 2322, 2323})
MAX_CONSECUTIVE_SILENT = 5
TOKEN_MEL_RATIO = 2
CFG_RATE = 0.7
N_TIMESTEPS = 10
MIN_TOKEN_TEXT_RATIO = 2
MAX_TOKEN_TEXT_RATIO = 20
HARD_MAX_TOKENS = 1500

PROMPT_MAX_SECONDS = 30


@dataclass
class VoicePrompt:
    """Prompt state extracted once per voice, reused across ``synthesize`` calls."""
    speech_tokens: np.ndarray      # int64 [1, S]
    spk_embedding: np.ndarray      # f32 [1, 192]
    mel: np.ndarray                # f32 [2S, 80]
    prompt_text_ids: list


# --------------------------------------------------------------------------
# Prompt processing
# --------------------------------------------------------------------------

def process_prompt(sessions, tok, audio: np.ndarray, sr: int, transcript: str) -> VoicePrompt:
    """Extract speech tokens, speaker embedding and flow mel conditioning
    from a reference (prompt) waveform, plus the zero-shot prompt_text ids."""
    audio = np.asarray(audio, dtype=np.float32)
    audio = audio[: PROMPT_MAX_SECONDS * sr]

    a16 = soxr.resample(audio, sr, 16000) if sr != 16000 else audio
    a24 = soxr.resample(audio, sr, 24000) if sr != 24000 else audio

    feats = whisper_log_mel_128(a16)
    tokens = sessions["speech_tokenizer"].run(None, {
        "feats": feats,
        "feats_length": np.array([feats.shape[2]], dtype=np.int32),
    })[0].flatten().astype(np.int64)

    spk_emb = sessions["campplus"].run(None, {"input": kaldi_fbank_80_cmn(a16)})[0]
    spk_emb = spk_emb.reshape(1, -1).astype(np.float32)             # [1, 192]

    mel = matcha_mel_80(a24)                                        # [frames, 80]
    # official frontend: force feat frames == 2 * token count
    token_len = min(mel.shape[0] // TOKEN_MEL_RATIO, len(tokens))
    mel = mel[: TOKEN_MEL_RATIO * token_len]
    tokens = tokens[:token_len]

    prompt_text_ids = frontend.build_prompt_text_ids(tok, transcript)

    return VoicePrompt(
        speech_tokens=tokens[np.newaxis, :],                        # [1, S] int64
        spk_embedding=spk_emb,                                      # [1, 192]
        mel=mel,                                                    # [2S, 80]
        prompt_text_ids=prompt_text_ids,
    )


# --------------------------------------------------------------------------
# LLM autoregressive loop
# --------------------------------------------------------------------------

def llm_generate(sessions, tok, tts_text: str, prompt: VoicePrompt, rng) -> np.ndarray:
    """Run the LLM decode loop and return the silent-filtered flow token
    sequence (int64 [1, N])."""
    tts_ids = frontend.encode_tts_text(tok, tts_text)
    combined = np.array([prompt.prompt_text_ids + tts_ids], dtype=np.int64)
    text_emb = sessions["text_embedding"].run(None, {"input_ids": combined})[0]

    def speech_emb(ids):
        return sessions["speech_embedding"].run(
            None, {"token": np.asarray(ids, dtype=np.int64)})[0]

    sos_emb = speech_emb([[SOS]])
    task_emb = speech_emb([[TASK_ID]])
    prompt_speech_emb = speech_emb(prompt.speech_tokens)
    lm_input = np.concatenate([sos_emb, text_emb, task_emb, prompt_speech_emb],
                              axis=1).astype(np.float32)
    seq_len = lm_input.shape[1]

    hidden, past = sessions["llm_initial"].run(None, {
        "inputs_embeds": lm_input,
        "attention_mask": np.ones((1, seq_len), dtype=np.float32),
    })
    logits = sessions["llm_decoder"].run(None, {"hidden_state": hidden[:, -1:, :]})[0]

    min_len = MIN_TOKEN_TEXT_RATIO * len(tts_ids)
    max_len = min(MAX_TOKEN_TEXT_RATIO * len(tts_ids), HARD_MAX_TOKENS)
    min_len = min(min_len, max_len)  # HARD_MAX_TOKENS can cap max_len below
                                      # min_len for very long tts_text; without
                                      # this the stop-mask (active while
                                      # i < min_len) never lifts and decoding
                                      # runs to max_len every time.

    out_tokens: list = []       # full LLM sequence (RAS window + feedback)
    flow_tokens: list = []      # silent-filtered sequence for the flow
    consecutive_silent = 0
    for i in range(max_len):
        logp = logits[0].astype(np.float64)
        logp = logp - np.log(np.sum(np.exp(logp - logp.max()))) - logp.max()
        if i < min_len:
            logp[STOP_TOKEN_MIN:] = -np.inf
        token_id = ras_sampling(logp, out_tokens, rng)
        if token_id >= STOP_TOKEN_MIN:
            break
        out_tokens.append(token_id)
        if token_id in SILENT_TOKENS:
            consecutive_silent += 1
            if consecutive_silent <= MAX_CONSECUTIVE_SILENT:
                flow_tokens.append(token_id)
        else:
            consecutive_silent = 0
            flow_tokens.append(token_id)

        next_emb = speech_emb([[token_id]])
        hidden, past = sessions["llm_decode"].run(None, {
            "inputs_embeds": next_emb.astype(np.float32),
            "attention_mask": np.ones((1, seq_len + len(out_tokens)), dtype=np.float32),
            "past_key_values": past,
        })
        logits = sessions["llm_decoder"].run(None, {"hidden_state": hidden})[0]

    return np.array([flow_tokens], dtype=np.int64)


# --------------------------------------------------------------------------
# Flow (CFM with true CFG + cosine schedule)
# --------------------------------------------------------------------------

def flow_generate(sessions, flow_tokens: np.ndarray, prompt: VoicePrompt, rng) -> np.ndarray:
    emb = prompt.spk_embedding
    emb = emb / (np.linalg.norm(emb, axis=1, keepdims=True) + 1e-8)
    spks = sessions["flow_spk_projection"].run(None, {"embedding": emb.astype(np.float32)})[0]

    all_tokens = np.concatenate([prompt.speech_tokens, flow_tokens], axis=1)
    token_emb = sessions["flow_token_embedding"].run(None, {"token": all_tokens})[0]
    h = sessions["flow_pre_lookahead"].run(None, {"token_embedded": token_emb})[0]
    mel_len = h.shape[1]
    mel_len1 = prompt.mel.shape[0]

    mu = h.transpose(0, 2, 1).astype(np.float32)                   # [1, 80, L]
    conds = np.zeros((1, 80, mel_len), dtype=np.float32)
    conds[:, :, :mel_len1] = prompt.mel.T
    mask = np.ones((1, 1, mel_len), dtype=np.float32)

    x = rng.standard_normal((1, 80, mel_len)).astype(np.float32)
    t_span = 1.0 - np.cos(np.linspace(0.0, 1.0, N_TIMESTEPS + 1) * 0.5 * np.pi)

    zeros_mu = np.zeros_like(mu)
    zeros_spks = np.zeros_like(spks)
    zeros_conds = np.zeros_like(conds)
    t = float(t_span[0])
    dt = float(t_span[1] - t_span[0])
    for step in range(1, N_TIMESTEPS + 1):
        velocity = sessions["flow_estimator"].run(None, {
            "x": np.concatenate([x, x], axis=0),
            "mask": np.concatenate([mask, mask], axis=0),
            "mu": np.concatenate([mu, zeros_mu], axis=0),
            "t": np.array([t, t], dtype=np.float32),
            "spks": np.concatenate([spks, zeros_spks], axis=0),
            "cond": np.concatenate([conds, zeros_conds], axis=0),
        })[0]
        v = (1.0 + CFG_RATE) * velocity[0:1] - CFG_RATE * velocity[1:2]
        x = x + dt * v
        t = t + dt
        if step < N_TIMESTEPS:
            dt = float(t_span[step + 1] - t)

    return x[:, :, mel_len1:]                                      # [1, 80, L2]


# --------------------------------------------------------------------------
# HiFT vocoder
# --------------------------------------------------------------------------

def _stft_16_4(x: np.ndarray) -> np.ndarray:
    """torch.stft(n_fft=16, hop=4, hann, center=True) equivalent. [18, T]"""
    window = np.hanning(17)[:16].astype(np.float64)                # periodic hann
    y = np.pad(x.astype(np.float64), (8, 8), mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(y, 16)[::4] * window
    spec = np.fft.rfft(frames, axis=1)                             # [T, 9]
    return np.concatenate([spec.real.T, spec.imag.T], axis=0).astype(np.float32)


def _istft_16_4(magnitude: np.ndarray, phase: np.ndarray) -> np.ndarray:
    """torch.istft(n_fft=16, hop=4, hann, center=True) equivalent."""
    window = np.hanning(17)[:16].astype(np.float64)
    magnitude = np.clip(magnitude, None, 1e2)
    spec = magnitude.astype(np.float64) * np.exp(1j * phase.astype(np.float64))
    frames = np.fft.irfft(spec, n=16, axis=0) * window[:, None]    # [16, T]
    n_frames = frames.shape[1]
    out_len = 16 + (n_frames - 1) * 4
    audio = np.zeros(out_len)
    wsum = np.zeros(out_len)
    for r in range(16):
        audio[r: r + 4 * n_frames: 4] += frames[r]
        wsum[r: r + 4 * n_frames: 4] += window[r] ** 2
    audio = audio / np.maximum(wsum, 1e-8)
    return audio[8:-8].astype(np.float32)                          # center trim


def hift_generate(sessions, mel: np.ndarray) -> np.ndarray:
    mel = mel.astype(np.float32)
    f0 = sessions["hift_f0"].run(None, {"mel": mel})[0]                     # [1, L]
    source = sessions["hift_source"].run(None, {"f0": f0[:, np.newaxis, :]})[0]
    source_stft = _stft_16_4(source.squeeze())[np.newaxis, :, :]
    magnitude, phase = sessions["hift_decoder"].run(None, {
        "mel": mel, "source_stft": source_stft.astype(np.float32)})
    audio = _istft_16_4(magnitude.squeeze(0), phase.squeeze(0))
    return np.clip(audio, -0.99, 0.99)


# --------------------------------------------------------------------------
# End-to-end
# --------------------------------------------------------------------------

def synthesize(sessions, tok, text: str, prompt: VoicePrompt, rng, speed: float = 1.0) -> np.ndarray:
    """Synthesize ``text`` in the voice of ``prompt``. Returns float32 mono
    24 kHz audio, or an empty array if ``text`` is blank."""
    if not text.strip():
        return np.zeros(0, dtype=np.float32)

    flow_tokens = llm_generate(sessions, tok, text, prompt, rng)
    mel = flow_generate(sessions, flow_tokens, prompt, rng)

    if speed != 1.0:
        L = mel.shape[2]
        new_len = max(1, int(L / speed))
        xs = np.linspace(0, L - 1, new_len)
        mel = np.stack([np.interp(xs, np.arange(L), mel[0, c]) for c in range(80)]
                       )[np.newaxis].astype(np.float32)

    return hift_generate(sessions, mel)
