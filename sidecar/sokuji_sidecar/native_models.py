"""Model download/status registry for the LOCAL_NATIVE provider.

Each native model id maps to a set of HuggingFace repos (+ the VAD url). status
checks they're fully cached; download fetches them file-by-file with progress.
Mirrors LOCAL_INFERENCE's manage-before-use UX, but server-side (HF cache).

The silero VAD (silero_vad.onnx) is a shared runtime dependency of EVERY ASR
model: AsrEngine._init_vad() loads it for both the offline and streaming paths,
independent of which recognizer runs. So download_specs() appends it for any
ASR-catalog model (not just SenseVoice), guaranteeing a single-model offline
install is self-sufficient. It's a 643KB global singleton at sokuji-vad/, so
delete_model() never removes it — another installed model may still need it.
"""
import fnmatch
import os

from .asr_engine import VAD_URL
from .catalog import asr_model as _asr_model


def _ignored(filename, patterns):
    """True if `filename` matches any ignore pattern. fnmatch globs (`*` spans
    `/`, so `train/*` matches `train/a/b.py`); an exact filename like
    `tf_model.h5` matches only itself. Used to filter the download + size file set."""
    return any(fnmatch.fnmatch(filename, p) for p in patterns)

QWEN_REPO = "Qwen/Qwen2.5-0.5B-Instruct"
SENSE_VOICE_REPO = "FunAudioLLM/SenseVoiceSmall"
FUN_ASR_MLT_REPO = os.environ.get("SOKUJI_FUNASR_NANO_REPO", "FunAudioLLM/Fun-ASR-MLT-Nano-2512")


def _whisper_size(model_id):
    return model_id.replace("faster-whisper-", "").replace("whisper-", "")


def _vad_cache_path():
    cache = os.path.join(os.environ.get("HF_HOME", os.path.expanduser("~/.cache/huggingface")), "sokuji-vad")
    return os.path.join(cache, "silero_vad.onnx")


def _base_specs(model_id):
    """Per-model repos/ignore, WITHOUT the shared VAD (download_specs adds that)."""
    from .catalog import tts_model as _tts_model
    _tm = _tts_model(model_id) if model_id else None
    if _tm is not None:
        return {"repos": list(_tm.repos), "urls": list(_tm.urls)}
    if not model_id:
        return {"repos": [os.environ.get("SOKUJI_TRANSLATE_MODEL", QWEN_REPO)], "urls": []}
    if "piper" in model_id or "vits" in model_id:
        from .sherpa_tts import PIPER_REPOS
        return {"repos": [PIPER_REPOS.get(model_id, model_id)], "urls": []}
    if "whisper" in model_id:
        return {"repos": [f"Systran/faster-whisper-{_whisper_size(model_id)}"], "urls": []}
    if model_id.startswith("granite-speech"):
        # Granite speech-LLM ids (catalog) live under the ibm-granite/ org on HF.
        return {"repos": [f"ibm-granite/{model_id}"], "urls": []}
    if model_id == "sense-voice":
        return {"repos": [os.environ.get("SOKUJI_ASR_REPO", SENSE_VOICE_REPO)], "urls": []}
    if model_id == "fun-asr-mlt-nano":
        return {"repos": [FUN_ASR_MLT_REPO], "urls": []}
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
        # Honour SOKUJI_TRANSLATE_MODEL so download matches what the catalog/runtime loads.
        return {"repos": [os.environ.get("SOKUJI_TRANSLATE_MODEL", QWEN_REPO)], "urls": []}
    if model_id == "qwen3-0.6b":
        return {"repos": ["Qwen/Qwen3-0.6B"], "urls": []}
    if model_id == "qwen3.5-0.8b":
        return {"repos": ["Qwen/Qwen3.5-0.8B"], "urls": []}
    if model_id == "qwen3.5-2b":
        return {"repos": ["Qwen/Qwen3.5-2B"], "urls": []}
    if model_id == "translategemma-4b":
        return {"repos": ["google/translategemma-4b-it"], "urls": []}
    if model_id in ("hy-mt2-1.8b", "hy-mt2-7b"):
        # Skip the training scripts (train/, deepspeed/llama-factory) and the
        # README images (imgs/) — weights + tokenizer + config only.
        repo = "tencent/Hy-MT2-1.8B" if model_id == "hy-mt2-1.8b" else "tencent/Hy-MT2-7B"
        return {"repos": [repo], "urls": [], "ignore": ["train/*", "imgs/*"]}
    if model_id in ("hy-mt15-1.8b", "hy-mt15-7b"):
        # HY-MT1.5 repos carry only weights + tokenizer + config (no train/imgs).
        repo = "tencent/HY-MT1.5-1.8B" if model_id == "hy-mt15-1.8b" else "tencent/HY-MT1.5-7B"
        return {"repos": [repo], "urls": []}
    if model_id.startswith("opus-mt-"):
        # Helsinki repos ship the SAME model in 4 frameworks; the opus_translate
        # backend loads only pytorch_model.bin. Skip the TF/Rust/Flax weights
        # (exact filenames), which are 50-80% of the repo (en-zh: 1446MB → 301MB).
        return {"repos": [f"Helsinki-NLP/{model_id}"], "urls": [],
                "ignore": ["tf_model.h5", "rust_model.ot", "flax_model.msgpack"]}
    return {"repos": [model_id], "urls": []}


def download_specs(model_id, repo=None):
    """Map a model id to its download sources: {repos: [..], urls: [..]}.

    Every ASR-catalog model gets the shared silero VAD appended (see module
    docstring); non-ASR ids (translation, TTS) do not. The id is matched against
    the ASR catalog by exact id, so a bare HF repo id (e.g. the raw SenseVoice
    repo passed to model_status) is treated as non-ASR and gets no VAD.

    `repo` overrides the model's default repo with a chosen variant's repo (the
    variant id resolves to a sibling repo). Variants are translation-only and
    never need the VAD, so the override short-circuits before the VAD logic."""
    if repo:
        return {"repos": [repo], "urls": []}
    spec = _base_specs(model_id)
    if _asr_model(model_id) is not None and VAD_URL not in spec["urls"]:
        spec = {**spec, "urls": [*spec["urls"], VAD_URL]}
    return spec


_SILERO_VAD_BYTES = 643854  # silero_vad.onnx (k2-fsa release)
_SIZE_CACHE = {}


def model_size(model_id):
    """Total download size (bytes) of a model's repos + urls. Reads the catalog
    row's `size_bytes` field for catalog models (instant, offline); unknown ids
    (variant repos, newly added models) fall back to a live HF lookup, cached."""
    from .catalog import translate_model as _translate_model, tts_model as _tts_model
    cat_model = _asr_model(model_id) or _translate_model(model_id) or _tts_model(model_id)
    if cat_model is not None and cat_model.size_bytes:
        return cat_model.size_bytes
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
            total += sum((s.size or 0) for s in (info.siblings or []) if not _ignored(s.rfilename, ignore))
        except Exception:
            pass
    total += len(specs["urls"]) * _SILERO_VAD_BYTES
    _SIZE_CACHE[model_id] = total
    return total


def model_status(model_id, repo=None):
    """'ready' only if every repo + url is cached locally AND complete, else 'absent'.

    `repo` overrides the model's default repo with a chosen variant's repo (mirrors
    download_specs), so status reflects the variant the card actually downloads."""
    import glob
    from huggingface_hub import snapshot_download
    from huggingface_hub.constants import HF_HUB_CACHE
    specs = download_specs(model_id, repo)
    try:
        for r in specs["repos"]:
            snapshot_download(repo_id=r, local_files_only=True)
            # snapshot_download(local_files_only=True) is satisfied by a PARTIAL cache — offline
            # it can't know the repo's full file list, so an interrupted download (e.g. a session
            # started mid-fetch) reads back as 'ready' and then fails to load. A half-fetched blob
            # leaves a '<sha>.<etag>.incomplete' in blobs/. But a *stale* leftover can coexist with
            # the finalized '<sha>' blob (a later resume re-fetched under a different temp name), so
            # only treat it as not-ready when the finalized blob is actually missing.
            blobs = os.path.join(HF_HUB_CACHE, f"models--{r.replace('/', '--')}", "blobs")
            for inc in glob.glob(os.path.join(blobs, "*.incomplete")):
                if not os.path.exists(os.path.join(blobs, os.path.basename(inc).split(".")[0])):
                    return "absent"
        for _url in specs["urls"]:
            if not os.path.exists(_vad_cache_path()):
                return "absent"
        return "ready"
    except Exception:
        return "absent"


def delete_model(model_id, repo=None):
    """Remove a model's cached repos from the HF cache.

    `repo` overrides the model's default repo with a chosen variant's repo
    (mirrors download_specs / model_status), so deleting an FP8-only HY-MT card
    actually frees the FP8 cache instead of the unused bf16 default.

    Returns the number of bytes freed. Repos are deleted via the hub's cache
    scanner so we only touch fully-managed revisions; a repo shared with another
    still-needed model is deleted here too — callers should only delete models
    the user explicitly removed.

    The shared silero VAD (sokuji-vad/) is deliberately NOT removed: every ASR
    model depends on it, so deleting one model must not strand the others
    offline. It's a 643KB singleton — cheaper to keep than to refcount.
    """
    from huggingface_hub import scan_cache_dir
    specs = download_specs(model_id, repo)
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
    return freed


def _download_url(url):
    import urllib.request
    dst = _vad_cache_path()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not os.path.exists(dst):
        urllib.request.urlretrieve(url, dst)


async def download(model_id, send, should_cancel=None, repo=None):
    """Download every file for a model, awaiting `send({model_progress})` per file.

    `repo` overrides the model's default repo with a chosen variant's repo (e.g. an
    FP8 quant) — threaded through to `download_specs` so the fetched repo matches
    exactly what the deterministic load-path `select_variant` will load.

    Returns 'ready' when complete or 'cancelled' if `should_cancel()` became true
    between files. hf_hub_download runs in a worker thread that cannot be killed
    mid-file, so cancellation is checked at file boundaries — a multi-file repo
    stops promptly, a single huge file finishes first. Partial downloads are safe:
    the HF cache is atomic per blob, so an interrupted model reads back as absent.
    """
    import asyncio
    from huggingface_hub import HfApi, hf_hub_download
    cancelled = (lambda: bool(should_cancel and should_cancel()))
    specs = download_specs(model_id, repo)
    api = HfApi()
    ignore = set(specs.get("ignore", []))
    files = []
    for r in specs["repos"]:  # `r`, not `repo`, so the variant `repo` param is not shadowed
        try:
            files.extend((r, f) for f in api.list_repo_files(r) if not _ignored(f, ignore))
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
    for r, fname in files:
        if cancelled():
            return "cancelled"
        await asyncio.to_thread(hf_hub_download, r, fname)
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
    repos = msg.get("repos") or {}
    statuses = {m: model_status(m, repos.get(m)) for m in (msg.get("models") or [])}
    return {"type": "model_status_result", "id": msg.get("id"), "statuses": statuses}, None


async def _h_model_sizes(state, msg, _b, conn=None):
    sizes = {m: model_size(m) for m in (msg.get("models") or [])}
    return {"type": "model_sizes_result", "id": msg.get("id"), "sizes": sizes}, None


async def _run_download(state, model, conn, repo=None):
    """Background download task: streams progress, then pushes a terminal
    model_download_done (status ready|cancelled) or an error tagged with `model`.
    `repo` selects a chosen variant's repo when set (default keeps the model's
    default repo)."""
    event = state.get("cancels", {}).get(model)
    try:
        status = await download(model, conn.send, should_cancel=(event.is_set if event else None), repo=repo)
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
    repo = msg.get("repo")  # chosen variant's repo (None → model's default repo)
    if conn is None:
        return {"type": "error", "id": msg.get("id"), "message": "no connection"}, None
    state.setdefault("cancels", {})[model] = asyncio.Event()
    state.setdefault("download_tasks", {})[model] = asyncio.create_task(_run_download(state, model, conn, repo))
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
    repo = msg.get("repo")  # chosen variant's repo (None → model's default repo)
    freed = await asyncio.to_thread(delete_model, model, repo)
    return {"type": "model_delete_result", "id": msg.get("id"), "model": model, "freed": freed}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"model_status": _h_model_status, "model_sizes": _h_model_sizes,
         "model_download": _h_model_download, "model_cancel": _h_model_cancel,
         "model_delete": _h_model_delete})
