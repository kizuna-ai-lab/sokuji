"""Lightweight built-in TTS voice listing: read voice names from the MOSS model
manifest (browser_poc_manifest.json) WITHOUT loading any ONNX session."""
import json
from pathlib import Path

from .moss_tts.ort_runtime import MANIFEST_CANDIDATE_RELATIVE_PATHS, OrtCpuRuntime


def _default_repo() -> str:
    from . import catalog
    m = catalog.tts_model("moss-tts-nano")
    # repos[0] is the LM repo that carries browser_poc_manifest.json
    return m.repos[0] if m and m.repos else "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"


def _snapshot_dir(repo: str) -> str:
    from huggingface_hub import snapshot_download
    return snapshot_download(repo_id=repo, local_files_only=True)


def list_builtin_voice_names(repo: str | None = None) -> list[str]:
    """Voice names from the snapshot manifest; [] if the model isn't downloaded."""
    try:
        root = Path(_snapshot_dir(repo or _default_repo()))
        manifest_path = OrtCpuRuntime._resolve_manifest_path(root)
        manifest = json.loads(manifest_path.read_text())
        return [str(v["voice"]) for v in manifest.get("builtin_voices", [])]
    except Exception:
        return []
