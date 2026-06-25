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
    if not model_id:
        return {"repos": [os.environ.get("SOKUJI_TRANSLATE_MODEL", QWEN_REPO)], "urls": []}
    if "piper" in model_id or "vits" in model_id:
        from .sherpa_tts import PIPER_REPOS
        return {"repos": [PIPER_REPOS.get(model_id, model_id)], "urls": []}
    if model_id.startswith("Xenova/opus-mt-"):
        name = model_id.split("/")[-1]
        return {"repos": [model_id, f"Helsinki-NLP/{name}"], "urls": []}
    if "whisper" in model_id:
        return {"repos": [f"Systran/faster-whisper-{_whisper_size(model_id)}"], "urls": []}
    if model_id.startswith("granite-speech"):
        # Granite speech-LLM ids (catalog) live under the ibm-granite/ org on HF.
        return {"repos": [f"ibm-granite/{model_id}"], "urls": []}
    if model_id == "sense-voice":
        return {"repos": [os.environ.get("SOKUJI_ASR_REPO", SENSE_VOICE_REPO)], "urls": [VAD_URL]}
    if model_id == "qwen3-asr-1.7b":
        return {"repos": ["bezzam/Qwen3-ASR-1.7B"], "urls": []}
    if model_id == "cohere-transcribe-03-2026":
        return {"repos": ["AEmotionStudio/cohere-transcribe-03-2026-models"], "urls": []}
    if model_id == "voxtral-mini-4b-realtime":
        # Repo ships model.safetensors (HF, needed) + consolidated.safetensors (Mistral
        # format, 8.86GB, unused by transformers) — skip the duplicate.
        return {"repos": ["mistralai/Voxtral-Mini-4B-Realtime-2602"], "urls": [],
                "ignore": ["consolidated.safetensors"]}
    if model_id == "qwen2.5-0.5b":
        return {"repos": ["Qwen/Qwen2.5-0.5B-Instruct"], "urls": []}
    if model_id == "qwen3-0.6b":
        return {"repos": ["Qwen/Qwen3-0.6B"], "urls": []}
    if model_id == "qwen3.5-0.8b":
        return {"repos": ["Qwen/Qwen3.5-0.8B"], "urls": []}
    if model_id == "qwen3.5-2b":
        return {"repos": ["Qwen/Qwen3.5-2B"], "urls": []}
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
    ignore = set(specs.get("ignore", []))
    for repo in specs["repos"]:
        try:
            info = api.repo_info(repo, files_metadata=True)
            total += sum((s.size or 0) for s in (info.siblings or []) if s.rfilename not in ignore)
        except Exception:
            pass
    total += len(specs["urls"]) * _SILERO_VAD_BYTES
    _SIZE_CACHE[model_id] = total
    return total


def model_status(model_id):
    """'ready' only if every repo + url is cached locally AND complete, else 'absent'."""
    import glob
    from huggingface_hub import snapshot_download
    from huggingface_hub.constants import HF_HUB_CACHE
    specs = download_specs(model_id)
    try:
        for repo in specs["repos"]:
            snapshot_download(repo_id=repo, local_files_only=True)
            # snapshot_download(local_files_only=True) is satisfied by a PARTIAL cache — offline
            # it can't know the repo's full file list, so an interrupted download (e.g. a session
            # started mid-fetch) reads back as 'ready' and then fails to load. A half-fetched blob
            # leaves a '<sha>.<etag>.incomplete' in blobs/. But a *stale* leftover can coexist with
            # the finalized '<sha>' blob (a later resume re-fetched under a different temp name), so
            # only treat it as not-ready when the finalized blob is actually missing.
            blobs = os.path.join(HF_HUB_CACHE, f"models--{repo.replace('/', '--')}", "blobs")
            for inc in glob.glob(os.path.join(blobs, "*.incomplete")):
                if not os.path.exists(os.path.join(blobs, os.path.basename(inc).split(".")[0])):
                    return "absent"
        for _url in specs["urls"]:
            if not os.path.exists(_vad_cache_path()):
                return "absent"
        return "ready"
    except Exception:
        return "absent"


def delete_model(model_id):
    """Remove a model's cached repos (+ its VAD file) from the HF cache.

    Returns the number of bytes freed. Repos are deleted via the hub's cache
    scanner so we only touch fully-managed revisions; a repo shared with another
    still-needed model is deleted here too — callers should only delete models
    the user explicitly removed.
    """
    from huggingface_hub import scan_cache_dir
    specs = download_specs(model_id)
    wanted = set(specs["repos"])
    freed = 0
    try:
        cache = scan_cache_dir()
    except Exception:
        cache = None
    if cache is not None:
        revisions = []
        for repo in cache.repos:
            if repo.repo_id in wanted:
                freed += repo.size_on_disk
                revisions.extend(rev.commit_hash for rev in repo.revisions)
        if revisions:
            cache.delete_revisions(*revisions).execute()
    # Drop the shared VAD file only when removing the model that owns it.
    if specs["urls"] and os.path.exists(_vad_cache_path()):
        try:
            freed += os.path.getsize(_vad_cache_path())
            os.remove(_vad_cache_path())
        except OSError:
            pass
    return freed


def _download_url(url):
    import urllib.request
    dst = _vad_cache_path()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not os.path.exists(dst):
        urllib.request.urlretrieve(url, dst)


async def download(model_id, send, should_cancel=None):
    """Download every file for a model, awaiting `send({model_progress})` per file.

    Returns 'ready' when complete or 'cancelled' if `should_cancel()` became true
    between files. hf_hub_download runs in a worker thread that cannot be killed
    mid-file, so cancellation is checked at file boundaries — a multi-file repo
    stops promptly, a single huge file finishes first. Partial downloads are safe:
    the HF cache is atomic per blob, so an interrupted model reads back as absent.
    """
    import asyncio
    from huggingface_hub import HfApi, hf_hub_download
    cancelled = (lambda: bool(should_cancel and should_cancel()))
    specs = download_specs(model_id)
    api = HfApi()
    ignore = set(specs.get("ignore", []))
    files = []
    for repo in specs["repos"]:
        try:
            files.extend((repo, f) for f in api.list_repo_files(repo) if f not in ignore)
        except Exception:
            pass
    # Never report a no-op download as success: if a model declares repos but none
    # could be listed (wrong/unreachable repo id, network failure), fail loudly so
    # the renderer surfaces it — instead of returning 'ready' having fetched nothing.
    if specs["repos"] and not files:
        raise RuntimeError(
            f"no downloadable files for {model_id} (repos {specs['repos']} unreachable)")
    total = len(files) + len(specs["urls"])
    done = 0
    for repo, fname in files:
        if cancelled():
            return "cancelled"
        await asyncio.to_thread(hf_hub_download, repo, fname)
        done += 1
        await send({"type": "model_progress", "model": model_id, "downloaded": done, "total": total})
    for url in specs["urls"]:
        if cancelled():
            return "cancelled"
        await asyncio.to_thread(_download_url, url)
        done += 1
        await send({"type": "model_progress", "model": model_id, "downloaded": done, "total": total})
    return "ready"


async def _h_model_status(state, msg, _b, conn=None):
    statuses = {m: model_status(m) for m in (msg.get("models") or [])}
    return {"type": "model_status_result", "id": msg.get("id"), "statuses": statuses}, None


async def _h_model_sizes(state, msg, _b, conn=None):
    sizes = {m: model_size(m) for m in (msg.get("models") or [])}
    return {"type": "model_sizes_result", "id": msg.get("id"), "sizes": sizes}, None


async def _run_download(state, model, conn):
    """Background download task: streams progress, then pushes a terminal
    model_download_done (status ready|cancelled) or an error tagged with `model`."""
    event = state.get("cancels", {}).get(model)
    try:
        status = await download(model, conn.send, should_cancel=(event.is_set if event else None))
        await conn.send({"type": "model_download_done", "model": model, "status": status})
    except Exception as e:
        await conn.send({"type": "error", "model": model, "message": str(e)})
    finally:
        state.get("cancels", {}).pop(model, None)
        state.get("download_tasks", {}).pop(model, None)


async def _h_model_download(state, msg, _b, conn=None):
    """Start a download as a background task so the connection stays responsive
    to model_cancel. Completion is pushed via model_download_done, not returned."""
    import asyncio
    model = msg.get("model")
    if conn is None:
        return {"type": "error", "id": msg.get("id"), "message": "no connection"}, None
    state.setdefault("cancels", {})[model] = asyncio.Event()
    state.setdefault("download_tasks", {})[model] = asyncio.create_task(_run_download(state, model, conn))
    return None, None


async def _h_model_cancel(state, msg, _b, conn=None):
    """Signal an in-flight download to stop at the next file boundary."""
    event = state.get("cancels", {}).get(msg.get("model"))
    if event is not None:
        event.set()
    return {"type": "ok", "id": msg.get("id")}, None


async def _h_model_delete(state, msg, _b, conn=None):
    import asyncio
    model = msg.get("model")
    freed = await asyncio.to_thread(delete_model, model)
    return {"type": "model_delete_result", "id": msg.get("id"), "model": model, "freed": freed}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"model_status": _h_model_status, "model_sizes": _h_model_sizes,
         "model_download": _h_model_download, "model_cancel": _h_model_cancel,
         "model_delete": _h_model_delete})
