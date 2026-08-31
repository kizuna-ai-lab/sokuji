"""Built-in TTS voice listing (spec §6): a flat list of preset names, matching
sk_tts_presets'/TtsModel.presets()'s own shape -- audio.cpp publishes names only,
none of the old ONNX stack's editorial language/gender/curated metadata (any such
curation now lives, if anywhere, in the renderer).

If the requested model is the one currently loaded on the given engine, ask its
backend directly (mirrors .presets() on the live handle) -- always authoritative
when available. Otherwise, a load-free path serves what it can without a
session: supertonic's ten presets (F1-F5/M1-M5) are baked INTO the GGUF itself
(registry.inspect().discovered_configs, not a sibling directory the downloaded
snapshot ships separately -- see native/README.md's "GGUF-embedded sidecars"
note and native/tests/test_tts.cpp's own CTest, which enumerates exactly this
list), so they are hardcoded here (fix round 1, CQ-4) -- mirroring the old ONNX
SupertonicBackend's own hardcoded list, which likewise needed no download.
pocket_tts ships a REAL sibling `embeddings/*.safetensors` directory in its HF
snapshot, read straight off disk. moss_tts_nano / qwen3_tts / omnivoice have no
load-free listing (voice cloning only, or no bundled catalogue) and report []."""
from pathlib import Path

from .catalog import split_artifact

# audio.cpp's fixed supertonic preset roster (Task 1's sk_tts_presets() CTest
# against the shipped GGUF) -- a stable, small, hardcoded set, not something
# to read off disk. Checked before _LOAD_FREE_PRESETS below.
_SUPERTONIC_PRESETS = ("F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5")

# family -> (sub-directory inside the model's package dir, file suffix) for the
# load-free preset listing. Every other family has nothing to list without a load.
_LOAD_FREE_PRESETS = {
    "pocket_tts": ("embeddings", ".safetensors"),
}


def _scoped_snapshot_dir(repo: str, subdir: str):
    try:
        from huggingface_hub import snapshot_download
        return Path(snapshot_download(repo, allow_patterns=[f"{subdir}/*"], local_files_only=True))
    except Exception:
        return None


def list_builtin_voices(model_id: str | None = None, engine=None) -> list:
    if engine is not None and engine.is_loaded and (model_id is None or model_id == engine.model_id):
        return engine.list_builtin_voices()
    from . import catalog
    m = catalog.tts_model(model_id) if model_id else None
    family = getattr(m, "family", "")
    if family == "supertonic":
        return list(_SUPERTONIC_PRESETS)
    layout = _LOAD_FREE_PRESETS.get(family)
    if layout is None or not getattr(m, "deployments", None):
        return []
    sub, suffix = layout
    repo, fname = split_artifact(m.deployments[0].artifact)
    if not fname:
        return []
    model_dir = fname.rsplit("/", 1)[0] if "/" in fname else ""
    scoped = f"{model_dir}/{sub}" if model_dir else sub
    root = _scoped_snapshot_dir(repo, scoped)
    if root is None:
        return []
    voices_dir = root / scoped
    return sorted(p.stem for p in voices_dir.glob(f"*{suffix}")) if voices_dir.is_dir() else []
