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
