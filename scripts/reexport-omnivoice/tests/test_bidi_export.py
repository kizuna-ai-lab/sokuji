# scripts/reexport-omnivoice/tests/test_bidi_export.py
import os, pytest, torch
MODEL_DIR = os.environ.get("OMNIVOICE_SRC", ".spike/models/omnivoice_pt")

@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
def test_model_loads_and_has_llm():
    import omnivoice  # noqa
    from transformers import AutoModel
    m = AutoModel.from_pretrained(MODEL_DIR, trust_remote_code=True, dtype=torch.float32,
                                  attn_implementation="eager").eval()
    assert hasattr(m, "llm") and m.llm.config.hidden_size == 1024
    assert hasattr(m, "audio_embeddings") and hasattr(m, "audio_heads")


@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
def test_bidi_llm_is_bidirectional_and_matches_pytorch(tmp_path):
    import numpy as np, onnxruntime as ort
    from exporters import load_model, BidiLLM, export_llm
    m = load_model(MODEL_DIR)
    H = m.llm.config.hidden_size
    wrap = BidiLLM(m.llm).eval()

    # bidirectional: with a full mask, changing the last position must move earlier positions
    S = 12
    emb = torch.randn(1, S, H); full = torch.ones(1, 1, S, S, dtype=torch.bool)
    with torch.no_grad():
        h1 = wrap(emb, full); emb2 = emb.clone(); emb2[0, -1] += 3.0; h2 = wrap(emb2, full)
    assert (h1 - h2).abs()[0, 0].max().item() > 1e-3, "early position did not move => still causal"

    # parity: exported ONNX ~= PyTorch
    out = tmp_path / "llm"; out.mkdir()
    export_llm(m, str(out), dtype="fp32")
    sess = ort.InferenceSession(str(out / "llm_decoder.onnx"), providers=["CPUExecutionProvider"])
    e = torch.randn(1, 20, H); msk = torch.ones(1, 1, 20, 20, dtype=torch.bool)
    with torch.no_grad():
        ref = wrap(e, msk).numpy()
    got = sess.run(["hidden_states"], {"inputs_embeds": e.numpy().astype(np.float32),
                                       "attention_mask": msk.numpy()})[0]
    cos = float(np.dot(ref.ravel(), got.ravel()) / (np.linalg.norm(ref) * np.linalg.norm(got) + 1e-9))
    assert cos >= 0.9999, f"llm parity cos={cos}"


@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
def test_audio_embeddings_and_heads_parity(tmp_path):
    import numpy as np, onnxruntime as ort
    from exporters import load_model, export_audio_embeddings, export_audio_heads
    m = load_model(MODEL_DIR)
    out = tmp_path / "bb"; out.mkdir()
    export_audio_embeddings(m, str(out)); export_audio_heads(m, str(out))

    # audio_embeddings parity
    B, S = 1, 32
    ids = torch.randint(0, 1025, (B, 8, S), dtype=torch.int64)
    amask = torch.zeros(B, S, dtype=torch.bool); amask[:, S//4:3*S//4] = True
    with torch.no_grad():
        ref = m._prepare_embed_inputs(ids, amask).numpy()
    sess = ort.InferenceSession(str(out/"audio_embeddings_encoder.onnx"), providers=["CPUExecutionProvider"])
    got = sess.run(["inputs_embeds"], {"input_ids": ids.numpy(), "audio_mask": amask.numpy()})[0]
    assert np.abs(ref - got).max() < 1e-2

    # audio_heads parity
    hid = torch.randn(B, S, 1024)
    with torch.no_grad():
        ref_h = m.audio_heads(hid).view(B, S, 8, 1025).permute(0, 2, 1, 3).numpy()
    sess2 = ort.InferenceSession(str(out/"audio_heads_decoder.onnx"), providers=["CPUExecutionProvider"])
    got_h = sess2.run(["logits"], {"hidden_states": hid.numpy().astype(np.float32)})[0]
    assert np.abs(ref_h - got_h).max() < 1e-2


@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
def test_higgs_export_roundtrip(tmp_path):
    import numpy as np, onnxruntime as ort, soundfile as sf, soxr
    from exporters import export_higgs
    out = tmp_path / "hg"; out.mkdir()
    export_higgs(MODEL_DIR, str(out))
    d = str(out / "audio_tokenizer")
    ac = ort.InferenceSession(f"{d}/acoustic_encoder.onnx", providers=["CPUExecutionProvider"])
    se = ort.InferenceSession(f"{d}/semantic_encoder.onnx", providers=["CPUExecutionProvider"])
    qe = ort.InferenceSession(f"{d}/quantizer_encoder.onnx", providers=["CPUExecutionProvider"])
    de = ort.InferenceSession(f"{d}/higgs_decoder.onnx", providers=["CPUExecutionProvider"])

    wav, sr = sf.read("scripts/assets/gpt-sovits-voices/classic-zh.wav")
    wav = wav.astype(np.float32)
    if wav.ndim > 1:
        wav = wav[:, 0]
    w24 = soxr.resample(wav, sr, 24000).astype(np.float32)
    w16 = soxr.resample(wav, sr, 16000).astype(np.float32)

    af = ac.run(["acoustic_features"], {"waveform_24k": w24[None, None, :]})[0]
    sf_ = se.run(["semantic_features"], {"waveform_16k": w16[None, :]})[0]
    T = min(af.shape[2], sf_.shape[2]); af, sf_ = af[:, :, :T], sf_[:, :, :T]
    codes = qe.run(["codes"], {"acoustic_features": af, "semantic_features": sf_})[0]
    out_wav = de.run(["waveform_24k"], {"codes": codes})[0].squeeze()

    rms = float(np.sqrt(np.mean(out_wav.astype(np.float32) ** 2)))
    assert 0.02 < rms < 0.35, f"round-trip rms {rms} not speech-like"
    # codes must be diverse (real audio), not collapsed to a few entries
    assert len(np.unique(codes[0])) > 30

    # --- eager vs ONNX numeric parity ---
    # Compares the exported ONNX graphs against the eager HiggsAudioV2TokenizerModel on the
    # same clip. This catches subtly-wrong reconstructions (e.g. a wrong pad/downsample/
    # aggregation choice) that the speech-level RMS/diversity checks above cannot: those pass
    # for *any* plausible speech output, whereas a wrong intermediate step de-correlates the
    # codes/waveform from the reference model entirely (see thresholds below).
    from codes.model_wrappers import _prepare_tok
    from transformers import AutoModel
    tok = AutoModel.from_pretrained(os.path.join(MODEL_DIR, "audio_tokenizer"),
                                    dtype=torch.float32, attn_implementation="eager")
    tok = _prepare_tok(tok)
    w24_t = torch.from_numpy(w24)[None, None, :]
    with torch.no_grad():
        codes_eager = tok.encode(w24_t, return_dict=False).numpy()          # (1, 8, T_e)
        wav_eager = tok.decode(torch.from_numpy(codes_eager), return_dict=False)
        wav_eager = wav_eager.squeeze().numpy()                             # (T_samples,)

    codes_onnx_t = codes.transpose(1, 0, 2)  # (num_q, B, T) -> (B, num_q, T), eager's layout
    Tc = min(codes_eager.shape[-1], codes_onnx_t.shape[-1])
    code_match = float((codes_eager[:, :, :Tc] == codes_onnx_t[:, :, :Tc]).mean())

    Tw = min(len(wav_eager), len(out_wav))
    we = wav_eager[:Tw].astype(np.float64); wo = out_wav[:Tw].astype(np.float64)
    wav_cos = float(np.dot(we, wo) / (np.linalg.norm(we) * np.linalg.norm(wo) + 1e-9))

    # Observed on scripts/assets/gpt-sovits-voices/classic-zh.wav: code_match=0.9838,
    # wav_cos=0.9989 (rms eager=0.09992 vs onnx=0.09984, matching prior manual spot-check).
    # A 1-frame misalignment (e.g. an off-by-one pad) collapses code_match to ~0.01-0.03, so
    # these thresholds have a wide margin below genuine agreement and well above a broken export.
    assert code_match >= 0.95, f"eager/ONNX code agreement {code_match:.4f} too low"
    assert wav_cos >= 0.99, f"eager/ONNX waveform cosine {wav_cos:.4f} too low"


@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
@pytest.mark.parametrize("mode", ["fp16", "int4"])
def test_llm_quant_parity_and_audio(tmp_path, mode):
    import numpy as np, onnxruntime as ort
    from exporters import load_model, export_llm, export_audio_embeddings, export_audio_heads, quantize_llm
    import verify
    m = load_model(MODEL_DIR)
    base = tmp_path / "fp32"; base.mkdir(); export_llm(m, str(base), "fp32")
    q = tmp_path / mode; q.mkdir()
    quantize_llm(str(base / "llm_decoder.onnx"), str(q), mode)
    export_audio_embeddings(m, str(q)); export_audio_heads(m, str(q))

    # parity of quantized LLM vs PyTorch (looser bound for int4)
    from exporters import BidiLLM
    H = m.llm.config.hidden_size; wrap = BidiLLM(m.llm).eval()
    e = torch.randn(1, 20, H); msk = torch.ones(1, 1, 20, 20, dtype=torch.bool)
    with torch.no_grad(): ref = wrap(e, msk).numpy()
    sess = ort.InferenceSession(str(q / "llm_decoder.onnx"), providers=["CPUExecutionProvider"])
    got = sess.run(["hidden_states"], {"inputs_embeds": e.numpy().astype(np.float32),
                                       "attention_mask": msk.numpy()})[0]
    cos = float(np.dot(ref.ravel(), got.ravel()) / (np.linalg.norm(ref) * np.linalg.norm(got) + 1e-9))
    assert cos >= (0.999 if mode == "fp16" else 0.99), f"{mode} cos={cos}"

    # end-to-end: the ONNX-backed real pipeline produces speech-level audio
    wav = verify.hybrid_generate(MODEL_DIR, str(q), None, "Hello from the re-export.", "English")
    rms = float(np.sqrt(np.mean(np.asarray(wav, np.float32) ** 2)))
    assert 0.02 < rms < 0.35, f"{mode} audio rms {rms} not speech-like"
