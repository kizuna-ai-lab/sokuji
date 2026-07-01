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


# Built-in MOSS voice curation — our editorial product judgment (mirrors the old
# renderer BUILTIN_VOICE_META). Quality verified for English (Ava reliably clean);
# others are best-effort by language. Unstable voices stay reachable behind
# "show all" (see issue #277).
_VOICE_META = {
    "Ava":    {"language": "en", "curated": True},
    "Bella":  {"language": "en", "curated": True},
    "Adam":   {"language": "en", "unstable": True},
    "Nathan": {"language": "en"},
    "Trump":  {"language": "en"},
    "Xiaoyu": {"language": "zh", "curated": True},
    "Yuewen": {"language": "zh", "curated": True},
    "Lingyu": {"language": "zh"},
    "Junhao": {"language": "zh"},
    "Zhiming":{"language": "zh", "unstable": True},
    "Weiguo": {"language": "zh"},
    "Saki":   {"language": "ja", "curated": True},
    "Soyo":   {"language": "ja", "curated": True},
    "Umiri":  {"language": "ja"},
    "Mei":    {"language": "ja"},
    "Anon":   {"language": "ja", "unstable": True},
    "Arisa":  {"language": "ja"},
    "Mortis": {"unstable": True},
}
_DEFAULT_VOICE_BY_LANG = {"en": "Ava", "zh": "Xiaoyu", "ja": "Saki"}


def list_builtin_voices(model_id=None):
    """Rich built-in voice descriptors: each manifest voice name annotated with
    our curation metadata. [] when the model isn't downloaded. The single source
    of built-in voice facts for the renderer (replaces its BUILTIN_VOICE_META).

    Style-voice models (Supertonic) don't ship a MOSS-style manifest: their 10
    presets are baked into the backend and available without a download."""
    from . import catalog
    m = catalog.tts_model(model_id) if model_id else None
    if m is not None and getattr(m, "style_voices", False):
        from .tts_backends import SupertonicBackend
        return [{"name": x["voice"], "language": None, "gender": x["gender"],
                 "curated": True, "unstable": False, "default": (x["voice"] == "Robert")}
                for x in SupertonicBackend.list_builtin_voices()]
    out = []
    for name in list_builtin_voice_names(model_id):
        meta = _VOICE_META.get(name, {})
        lang = meta.get("language")
        out.append({
            "name": name,
            "language": lang,
            "curated": bool(meta.get("curated")),
            "unstable": bool(meta.get("unstable")),
            "default": (_DEFAULT_VOICE_BY_LANG.get(lang) == name) if lang else False,
        })
    return out
