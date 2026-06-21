"""Model download/status registry for the LOCAL_NATIVE provider.

Each native model id maps to a set of HuggingFace repos (+ the VAD url). status
checks they're fully cached; download fetches them file-by-file with progress.
Mirrors LOCAL_INFERENCE's manage-before-use UX, but server-side (HF cache).
"""
import os

from .asr_engine import VAD_URL

QWEN_REPO = "Qwen/Qwen2.5-0.5B-Instruct"
SENSE_VOICE_REPO = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"


def _whisper_size(model_id):
    return model_id.replace("faster-whisper-", "").replace("whisper-", "")


def _vad_cache_path():
    cache = os.path.join(os.environ.get("HF_HOME", os.path.expanduser("~/.cache/huggingface")), "sokuji-vad")
    return os.path.join(cache, "silero_vad.onnx")


def download_specs(model_id):
    """Map a model id to its download sources: {repos: [..], urls: [..]}."""
    if not model_id or model_id == "qwen":
        return {"repos": [os.environ.get("SOKUJI_TRANSLATE_MODEL", QWEN_REPO)], "urls": []}
    if "piper" in model_id or "vits" in model_id:
        from .sherpa_tts import PIPER_REPOS
        return {"repos": [PIPER_REPOS.get(model_id, model_id)], "urls": []}
    if model_id.startswith("Xenova/opus-mt-"):
        name = model_id.split("/")[-1]
        return {"repos": [model_id, f"Helsinki-NLP/{name}"], "urls": []}
    if "whisper" in model_id:
        return {"repos": [f"Systran/faster-whisper-{_whisper_size(model_id)}"], "urls": []}
    if model_id == "sense-voice":
        return {"repos": [os.environ.get("SOKUJI_ASR_REPO", SENSE_VOICE_REPO)], "urls": [VAD_URL]}
    return {"repos": [model_id], "urls": []}


_SILERO_VAD_BYTES = 643854  # silero_vad.onnx (k2-fsa release)
_SIZE_CACHE = {}


def model_size(model_id):
    """Total download size (bytes) of a model's repos + urls. Cached per process."""
    if model_id in _SIZE_CACHE:
        return _SIZE_CACHE[model_id]
    from huggingface_hub import HfApi
    specs = download_specs(model_id)
    total = 0
    api = HfApi()
    for repo in specs["repos"]:
        try:
            info = api.repo_info(repo, files_metadata=True)
            total += sum((s.size or 0) for s in (info.siblings or []))
        except Exception:
            pass
    total += len(specs["urls"]) * _SILERO_VAD_BYTES
    _SIZE_CACHE[model_id] = total
    return total


def model_status(model_id):
    """'ready' if every repo + url for this model is cached locally, else 'absent'."""
    from huggingface_hub import snapshot_download
    specs = download_specs(model_id)
    try:
        for repo in specs["repos"]:
            snapshot_download(repo_id=repo, local_files_only=True)
        for _url in specs["urls"]:
            if not os.path.exists(_vad_cache_path()):
                return "absent"
        return "ready"
    except Exception:
        return "absent"


def _download_url(url):
    import urllib.request
    dst = _vad_cache_path()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not os.path.exists(dst):
        urllib.request.urlretrieve(url, dst)


async def download(model_id, send):
    """Download every file for a model, awaiting `send({model_progress})` per file."""
    import asyncio
    from huggingface_hub import HfApi, hf_hub_download
    specs = download_specs(model_id)
    api = HfApi()
    files = []
    for repo in specs["repos"]:
        try:
            files.extend((repo, f) for f in api.list_repo_files(repo))
        except Exception:
            pass
    total = len(files) + len(specs["urls"])
    done = 0
    for repo, fname in files:
        await asyncio.to_thread(hf_hub_download, repo, fname)
        done += 1
        await send({"type": "model_progress", "model": model_id, "downloaded": done, "total": total})
    for url in specs["urls"]:
        await asyncio.to_thread(_download_url, url)
        done += 1
        await send({"type": "model_progress", "model": model_id, "downloaded": done, "total": total})


async def _h_model_status(state, msg, _b, conn=None):
    statuses = {m: model_status(m) for m in (msg.get("models") or [])}
    return {"type": "model_status_result", "id": msg.get("id"), "statuses": statuses}, None


async def _h_model_sizes(state, msg, _b, conn=None):
    sizes = {m: model_size(m) for m in (msg.get("models") or [])}
    return {"type": "model_sizes_result", "id": msg.get("id"), "sizes": sizes}, None


async def _h_model_download(state, msg, _b, conn=None):
    model = msg.get("model")
    if conn is not None:
        await download(model, conn.send)
    return {"type": "ok", "id": msg.get("id")}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"model_status": _h_model_status, "model_sizes": _h_model_sizes,
         "model_download": _h_model_download})
