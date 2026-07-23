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
    import numpy as np, onnxruntime as ort, sys
    sys.path.insert(0, ".spike/models/repo")  # authors' codes/ + user_script
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
