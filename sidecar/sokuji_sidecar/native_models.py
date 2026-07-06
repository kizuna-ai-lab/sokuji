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

# The exact CTranslate2 export files the ct2_opus_translate backend reads
# (see ct2_opus.Ct2OpusSession). Our jiangzhuo9357/opus-mt-*-ct2 repos mirror
# the gaudi/opus-mt-*-ctranslate2 layout; pin the file set instead of
# snapshotting the repo.
OPUS_FILES = ["config.json", "model.bin", "shared_vocabulary.json",
              "source.spm", "target.spm"]


def _ignored(filename, patterns):
    """True if `filename` matches any ignore pattern. fnmatch globs (`*` spans
    `/`, so `train/*` matches `train/a/b.py`); an exact filename like
    `tf_model.h5` matches only itself. Used to filter the download + size file set."""
    return any(fnmatch.fnmatch(filename, p) for p in patterns)

def _vad_cache_path():
    cache = os.path.join(os.environ.get("HF_HOME", os.path.expanduser("~/.cache/huggingface")), "sokuji-vad")
    return os.path.join(cache, "silero_vad.onnx")


def _base_specs(model_id):
    """Per-model repos/ignore, WITHOUT the shared VAD (download_specs adds that)."""
    from .catalog import tts_model as _tts_model
    _tm = _tts_model(model_id) if model_id else None
    if _tm is not None:
        repos = list(_tm.repos)
        # macOS on Apple Silicon runs the MLX lane (spec D5): fetch the single
        # self-contained mlx-community repo (the mlx_audio_tts deployment's
        # artifact) instead of the multi-GB ONNX assets. Every other platform —
        # Linux, Windows, and Intel Macs (where requires_apple_silicon drops the
        # MLX row) — keeps the ONNX repos. current_platform() is checked first,
        # so the non-macOS path never probes hardware.
        mlx = next((d for d in _tm.deployments if d.backend == "mlx_audio_tts"), None)
        if mlx is not None:
            from . import accel
            if accel.current_platform() == "macos" and accel.probe().apple_silicon:
                repos = [mlx.artifact]
        spec = {"repos": repos, "urls": list(_tm.urls)}
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
        if _trm.deployments[0].backend == "ct2_opus_translate":
            # Opus artifact is a plain "jiangzhuo9357/opus-mt-xx-yy-ct2" repo
            # id — the backend only needs the 5 CTranslate2 export files.
            return {"repos": [], "urls": [],
                    "files": [(default_artifact, f) for f in OPUS_FILES]}
        # LLM cards: artifact is an "org/repo/filename.gguf" upstream path —
        # exactly one file to fetch.
        return {"repos": [], "urls": [], "files": [split_artifact(default_artifact)]}
    am = _asr_model(model_id)
    if am is not None:
        # Every ASR card is a transcribe.cpp GGUF: artifact "org/repo/file.gguf"
        # → exactly one pinned file to fetch (the repo ships 5+ quants).
        repo, fname = split_artifact(am.deployments[0].artifact)
        if fname:
            return {"repos": [], "urls": [], "files": [(repo, fname)]}
        return {"repos": [repo], "urls": []}
    if "piper" in model_id or "vits" in model_id:
        from .sherpa_tts import PIPER_REPOS
        return {"repos": [PIPER_REPOS.get(model_id, model_id)], "urls": []}
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


# Poll interval for streaming a big file's in-flight bytes (tests shrink it).
_PROGRESS_POLL_S = 0.5
# Display-only estimate for one llama-server flavor install (the real asset
# size isn't cheaply known before the fetch; only weights the progress bar).
_LLAMA_FLAVOR_EST_BYTES = 30_000_000


def _incomplete_bytes(repo):
    """Bytes of the repo's in-flight `.incomplete` blobs — hf_hub_download
    streams into `<cache>/models--org--repo/blobs/<etag>.incomplete`, so their
    combined size IS the current file's downloaded byte count. Best-effort."""
    try:
        from huggingface_hub import constants
        d = os.path.join(constants.HF_HUB_CACHE,
                         f"models--{repo.replace('/', '--')}", "blobs")
        return sum(os.path.getsize(os.path.join(d, f))
                   for f in os.listdir(d) if f.endswith(".incomplete"))
    except Exception:
        return 0


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

    Progress is reported in BYTES when the model's total size is known (every
    catalog card, via size_bytes): completed files contribute their real
    on-disk size, and while a file is in flight a poller streams the growing
    `.incomplete` blob size — so a single multi-GB GGUF (every ASR/LLM card)
    moves the renderer's bar continuously instead of sitting at 0/N. Unknown
    total → the old per-file unit counting.

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
    total_units = len(files) + len(specs["urls"])
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
        total_units += len(llama_flavors)

    # Byte mode when the total size is known (all catalog cards). Flavor
    # installs weight in at a nominal estimate; the final event pins to total.
    size = None
    try:
        size = model_size(model_id if not repo else repo)
    except Exception:
        size = None
    if size and VAD_URL in specs["urls"]:
        # Catalog size_bytes covers the model files only — add the shared VAD.
        # Guarded on size_bytes being SET: for a (hypothetical) catalog row
        # without it, model_size()'s live-lookup fallback already counted the
        # VAD via specs["urls"], and adding it here would double-count.
        cat = _asr_model(model_id)
        if cat is not None and cat.size_bytes:
            size += _SILERO_VAD_BYTES
    total_bytes = (size + _LLAMA_FLAVOR_EST_BYTES * len(llama_flavors)) if size else None

    done_units = 0
    done_bytes = 0

    async def progress(*, final=False):
        if total_bytes:
            n = total_bytes if final else min(done_bytes, total_bytes - 1)
            await send({"type": "model_progress", "model": model_id,
                        "downloaded": n, "total": total_bytes})
        else:
            await send({"type": "model_progress", "model": model_id,
                        "downloaded": done_units, "total": total_units})

    async def _fetch(fn, *args, poll_repo=None, est=0):
        """Run one blocking fetch in a thread; while it runs, stream the
        in-flight blob size (byte mode only). Returns the fetch's result."""
        nonlocal done_bytes, done_units
        stop = asyncio.Event()

        async def _poll():
            while not stop.is_set():
                cur = _incomplete_bytes(poll_repo)
                if cur:
                    await send({"type": "model_progress", "model": model_id,
                                "downloaded": min(done_bytes + cur, total_bytes - 1),
                                "total": total_bytes})
                try:
                    await asyncio.wait_for(stop.wait(), _PROGRESS_POLL_S)
                except asyncio.TimeoutError:
                    pass

        poller = asyncio.create_task(_poll()) if (total_bytes and poll_repo) else None
        try:
            result = await asyncio.to_thread(fn, *args)
        finally:
            if poller is not None:
                stop.set()
                await poller
        got = 0
        if total_bytes:
            try:
                got = os.path.getsize(os.path.realpath(result)) if result else est
            except Exception:
                got = est
        done_bytes += got or est
        done_units += 1
        return result

    is_last_stage = not specs["urls"] and not llama_flavors
    for i, (r, fname) in enumerate(files):
        if cancelled():
            return "cancelled"
        await _fetch(hf_hub_download, r, fname, poll_repo=r)
        await progress(final=is_last_stage and i == len(files) - 1)
    for i, url in enumerate(specs["urls"]):
        if cancelled():
            return "cancelled"
        await _fetch(_download_url, url, est=_SILERO_VAD_BYTES)
        await progress(final=not llama_flavors and i == len(specs["urls"]) - 1)
    for i, flavor in enumerate(llama_flavors):
        if cancelled():
            return "cancelled"
        from . import llama_runtime
        await _fetch(llama_runtime.ensure_binary, flavor, est=_LLAMA_FLAVOR_EST_BYTES)
        await progress(final=i == len(llama_flavors) - 1)
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
