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
from .catalog import asr_model as _asr_model, split_artifact

# The exact Xenova export files the opus_onnx_translate backend reads (see
# marian_onnx.MarianOnnxSession). Xenova's opus-mt-* repos also ship unquantized
# fp32/fp16 onnx we never load — pin the file set instead of snapshotting the repo.
OPUS_FILES = ["config.json", "generation_config.json", "tokenizer.json",
              "tokenizer_config.json", "onnx/encoder_model_quantized.onnx",
              "onnx/decoder_model_merged_quantized.onnx"]


def _ignored(filename, patterns):
    """True if `filename` matches any ignore pattern. fnmatch globs (`*` spans
    `/`, so `train/*` matches `train/a/b.py`); an exact filename like
    `tf_model.h5` matches only itself. Used to filter the download + size file set."""
    return any(fnmatch.fnmatch(filename, p) for p in patterns)

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
        spec = {"repos": list(_tm.repos), "urls": list(_tm.urls)}
        if model_id == "supertonic-3":
            # The Supertone HF repo ships ~14MB of audio_samples/*.wav + img/*.png
            # (demo assets) that the runtime never loads.
            spec["ignore"] = ["audio_samples/*", "img/*"]
        if model_id == "csukuangfj/vits-zh-aishell3":
            # Skip the torch checkpoint (478MB), the text-normalization FST
            # archive (181MB, rule_fsts is not wired in SherpaTtsBackend) and
            # the int8 duplicate (the backend must find exactly ONE .onnx).
            spec["ignore"] = ["G_AISHELL.pth", "rule.far", "vits-aishell3.int8.onnx"]
        return spec
    from .catalog import translate_model as _translate_model
    _trm = _translate_model(model_id) if model_id else _translate_model("qwen2.5-0.5b")
    if _trm is not None:
        # Default-variant artifact = first deployment (rank ordering puts the
        # default quant first). A pinned variant arrives via the `repo`
        # override in download_specs, exactly like the old FP8 flow.
        default_artifact = _trm.deployments[0].artifact
        if _trm.deployments[0].backend == "opus_onnx_translate":
            # Opus artifact is a plain "Xenova/opus-mt-xx-yy" repo id — the
            # backend only needs 6 specific files out of the repo's full
            # (multi-framework) export set.
            return {"repos": [], "urls": [],
                    "files": [(default_artifact, f) for f in OPUS_FILES]}
        # LLM cards: artifact is an "org/repo/filename.gguf" upstream path —
        # exactly one file to fetch.
        return {"repos": [], "urls": [], "files": [split_artifact(default_artifact)]}
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
    return {"repos": [model_id], "urls": []}


def download_specs(model_id, repo=None):
    """Map a model id to its download sources: {repos: [..], urls: [..]}.

    Every ASR-catalog model gets the shared silero VAD appended (see module
    docstring); non-ASR ids (translation, TTS) do not. The id is matched against
    the ASR catalog by exact id, so a bare HF repo id (e.g. the raw SenseVoice
    repo passed to model_status) is treated as non-ASR and gets no VAD.

    `repo` overrides the model's default repo with a chosen variant's repo (the
    variant id resolves to a sibling repo). Variants are translation-only and
    never need the VAD, so the override short-circuits before the VAD logic.

    A variant `repo` is now often an upstream artifact ("org/repo/file.gguf"),
    not a bare repo id — split it the same way the catalog rows are split, so
    the chosen variant downloads as a single pinned file too."""
    if repo:
        repo2, fname = split_artifact(repo)
        if fname:
            return {"repos": [], "urls": [], "files": [(repo2, fname)]}
        return {"repos": [repo], "urls": []}
    spec = _base_specs(model_id)
    if _asr_model(model_id) is not None and VAD_URL not in spec["urls"]:
        spec = {**spec, "urls": [*spec["urls"], VAD_URL]}
    return spec


def _needs_llama_binary(model_id) -> bool:
    """True when `model_id` resolves to a catalog translate row served by a
    llamacpp_* backend — those need the shared llama-server binary installed
    alongside the GGUF weights (see download() / model_status())."""
    from .catalog import translate_model as _translate_model
    tm = _translate_model(model_id) if model_id else None
    return tm is not None and tm.deployments[0].backend.startswith("llamacpp_")


_SILERO_VAD_BYTES = 643854  # silero_vad.onnx (k2-fsa release)
_SIZE_CACHE = {}


def model_size(model_id):
    """Total download size (bytes) of a model's repos + urls. Reads the catalog
    row's `size_bytes` field for catalog models (instant, offline); unknown ids
    (variant repos, newly added models) fall back to a live HF lookup, cached.

    `model_id` may itself be an upstream file artifact ("org/repo/file.gguf") —
    e.g. a Deployment.artifact with no est_bytes set — in which case only that
    one file's size is looked up via get_paths_info, not the whole repo."""
    from .catalog import translate_model as _translate_model, tts_model as _tts_model
    cat_model = _asr_model(model_id) or _translate_model(model_id) or _tts_model(model_id)
    if cat_model is not None and cat_model.size_bytes:
        return cat_model.size_bytes
    if model_id in _SIZE_CACHE:
        return _SIZE_CACHE[model_id]
    from huggingface_hub import HfApi
    api = HfApi()
    total = 0
    repo2, fname = split_artifact(model_id)
    if fname:
        try:
            infos = api.get_paths_info(repo2, [fname])
            total = sum((getattr(i, "size", 0) or 0) for i in infos)
        except Exception:
            total = 0
    else:
        specs = download_specs(model_id)
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


def _repos_cached(specs) -> bool:
    """True if every repo in `specs["repos"]` is cached locally AND complete."""
    import glob
    from huggingface_hub import snapshot_download
    from huggingface_hub.constants import HF_HUB_CACHE
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
                return False
    return True


def model_status(model_id, repo=None):
    """'ready' only if every repo + url is cached locally AND complete, else 'absent'.

    `repo` overrides the model's default repo with a chosen variant's repo (mirrors
    download_specs), so status reflects the variant the card actually downloads.

    llamacpp_* translate cards additionally need the shared llama-server binary
    installed for EVERY required flavor (see download() / llama_runtime.
    required_flavors) — the machine's default flavor AND the tiny cpu floor;
    without both, the card can't load on every device the UI exposes even
    with every GGUF file cached, so status must report 'absent' until all
    required flavors land."""
    specs = download_specs(model_id, repo)
    try:
        if not _repos_cached(specs):
            return "absent"
        if specs.get("files"):
            from huggingface_hub import hf_hub_download
            for r, fname in specs["files"]:
                hf_hub_download(r, fname, local_files_only=True)
        for _url in specs["urls"]:
            if not os.path.exists(_vad_cache_path()):
                return "absent"
        if _needs_llama_binary(model_id):
            from . import llama_runtime
            if any(llama_runtime.binary_path(f) is None
                   for f in llama_runtime.required_flavors()):
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

    The llama-server binary (see llama_runtime) is likewise NOT removed here:
    it's shared by every llamacpp_* translate card, so deleting one card must
    not strand the others without a runtime. It's small next to the GGUF
    weights — cheaper to keep installed than to refcount across cards.

    Upstream-sourced cards (files-shaped specs) are deleted by their upstream
    repo, same as a repos entry — deleting one such card removes ALL cached
    files of that upstream repo, including the sibling quant if it was also
    downloaded (both quants of a card share one upstream GGUF repo). That's
    acceptable: they're per-card siblings, not shared across different cards.
    """
    from huggingface_hub import scan_cache_dir
    specs = download_specs(model_id, repo)
    wanted = set(specs["repos"]) | {r for r, _fname in specs.get("files", [])}
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
    # Files-shaped specs (GGUF/Opus cards) name their exact (repo, filename) pairs
    # statically — no listing round-trip needed. Merged into the same `files` work
    # list so the no-op guard and progress `total` below count them for free.
    files.extend(specs.get("files", []))
    # Never report a no-op download as success: if a model declares repos but none
    # could be listed (wrong/unreachable repo id, network failure), fail loudly so
    # the renderer surfaces it — instead of returning 'ready' having fetched nothing.
    if specs["repos"] and not files:
        raise RuntimeError(
            f"no downloadable files for {model_id} (repos {specs['repos']} unreachable)")
    total = len(files) + len(specs["urls"])
    # llamacpp cards need EVERY required llama-server flavor installed (the
    # machine's default flavor for a normal load, plus the tiny cpu floor for
    # device=cpu / the gpu->cpu fallback — see llama_runtime.required_flavors).
    # Each missing flavor counts as one more download unit up front so the
    # renderer's progress bar covers it; a flavor an earlier download already
    # installed is a no-op here.
    llama_flavors = []
    if _needs_llama_binary(model_id):
        from . import llama_runtime
        llama_flavors = [f for f in llama_runtime.required_flavors()
                         if llama_runtime.binary_path(f) is None]
        total += len(llama_flavors)
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
    for flavor in llama_flavors:
        if cancelled():
            return "cancelled"
        from . import llama_runtime
        await asyncio.to_thread(llama_runtime.ensure_binary, flavor)
        done += 1
        await send({"type": "model_progress", "model": model_id,
                    "downloaded": done, "total": total})
    return "ready"


async def _h_model_status(state, msg, _b, conn=None):
    repos = msg.get("repos") or {}
    statuses = {m: model_status(m, repos.get(m)) for m in (msg.get("models") or [])}
    return {"type": "model_status_result", "id": msg.get("id"), "statuses": statuses}, None


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
        {"model_status": _h_model_status,
         "model_download": _h_model_download, "model_cancel": _h_model_cancel,
         "model_delete": _h_model_delete})
