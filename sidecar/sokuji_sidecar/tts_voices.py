"""Built-in TTS voice listing (spec §6): a flat list of preset names, matching
sk_tts_presets'/TtsModel.presets()'s own shape -- audio.cpp publishes names only,
none of the old ONNX stack's editorial language/gender/curated metadata (any such
curation now lives, if anywhere, in the renderer).

If the requested model is the one currently loaded on the given engine, ask its
backend directly (mirrors .presets() on the live handle). Otherwise, a load-free
path resolves the model's catalog card and reads preset names straight off its
local HF snapshot -- no session needed: supertonic ships `voice_styles/*.json`,
pocket_tts ships `embeddings/*.safetensors`. moss_tts_nano / qwen3_tts / omnivoice
have no load-free listing (voice cloning only, or no bundled catalogue) and report
[]. TtsModel.family doesn't exist yet (it lands with the slice-4 catalog task); the
`getattr` default below just means every current card falls through to [] until
then, same pattern as planner._plan_config's defensive reads."""
from pathlib import Path

from .catalog import split_artifact

# family -> (sub-directory inside the model's package dir, file suffix) for the
# load-free preset listing. Every other family has nothing to list without a load.
_LOAD_FREE_PRESETS = {
    "supertonic": ("voice_styles", ".json"),
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
    layout = _LOAD_FREE_PRESETS.get(getattr(m, "family", ""))
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
