"""Lightweight built-in TTS voice listing: read voice names from the MOSS model
manifest (browser_poc_manifest.json) WITHOUT loading any ONNX session."""
import json
from pathlib import Path

from .moss_tts.ort_runtime import OrtCpuRuntime

_DEFAULT_REPO = "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"


def _repo_for(model_id: str | None) -> str:
    """Resolve a catalog TTS id (e.g. 'moss-tts-nano') to its HF LM repo — repos[0]
    carries browser_poc_manifest.json. None → the default MOSS model. An id that
    isn't in the catalog is treated as a raw repo path (a direct repo id still
    works). The renderer sends catalog short ids, NOT repo paths."""
    from . import catalog
    lookup = model_id or "moss-tts-nano"
    m = catalog.tts_model(lookup)
    if m and m.repos:
        return m.repos[0]
    return model_id or _DEFAULT_REPO   # unknown id → assume it's already a repo path


def _snapshot_dir(repo: str) -> str:
    from huggingface_hub import snapshot_download
    return snapshot_download(repo_id=repo, local_files_only=True)


def list_builtin_voice_names(model_id: str | None = None) -> list[str]:
    """Voice names from the snapshot manifest; [] if the model isn't downloaded.
    `model_id` is a catalog TTS id (resolved to its HF repo); None → default MOSS."""
    try:
        root = Path(_snapshot_dir(_repo_for(model_id)))
        manifest_path = OrtCpuRuntime._resolve_manifest_path(root)
        manifest = json.loads(manifest_path.read_text())
        return [str(v["voice"]) for v in manifest.get("builtin_voices", [])]
    except Exception:
        return []
