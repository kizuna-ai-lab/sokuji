"""Model download/status registry for the LOCAL_NATIVE provider.

Each native model id maps to a set of HuggingFace repos. status checks they're
fully cached; download fetches them file-by-file with progress. Mirrors
LOCAL_INFERENCE's manage-before-use UX, but server-side (HF cache).
"""
import fnmatch
import os

from .catalog import asr_model as _asr_model, split_artifact


def _ignored(filename, patterns):
    """True if `filename` matches any ignore pattern. fnmatch globs (`*` spans
    `/`, so `train/*` matches `train/a/b.py`); an exact filename like
    `tf_model.h5` matches only itself. Used to filter the download + size file set."""
    return any(fnmatch.fnmatch(filename, p) for p in patterns)

def _tts_extra_files(_tm, fname):
    """(repo-relative) sidecar asset paths for a TTS card's `extra_files`
    (pocket-tts-en's embeddings/alba.safetensors), resolved next to `fname`'s
    own directory — the same directory every quant of that card shares."""
    if not _tm.extra_files:
        return []
    dirpath = fname.rsplit("/", 1)[0] if "/" in fname else ""
    return [f"{dirpath}/{name}" if dirpath else name for name, _size in _tm.extra_files]


def _base_specs(model_id):
    """Per-model repos/ignore for a model id."""
    from .catalog import tts_model as _tts_model
    _tm = _tts_model(model_id) if model_id else None
    if _tm is not None:
        # Every TTS card is a single-file audio.cpp GGUF — exactly the ASR/
        # translate shape: artifact "org/repo/dir/file.gguf" -> one pinned
        # file. pocket-tts-en additionally ships a same-directory preset
        # asset (embeddings/alba.safetensors) that sk_tts_presets discovers
        # next to the loaded gguf, listed via TtsModel.extra_files.
        repo, fname = split_artifact(_tm.deployments[0].artifact)
        files = [(repo, fname)] + [(repo, extra) for extra in _tts_extra_files(_tm, fname)]
        return {"repos": [], "urls": [], "files": files}
    from .catalog import translate_model as _translate_model
    _trm = _translate_model(model_id) if model_id else _translate_model("qwen2.5-0.5b")
    if _trm is not None:
        # Default-variant artifact = first deployment (rank ordering puts the
        # default quant first). A pinned variant arrives via the `repo`
        # override in download_specs, exactly like the old FP8 flow.
        # Every translate card (native_translate) is a GGUF LLM: artifact is
        # an "org/repo/filename.gguf" upstream path — exactly one file to fetch.
        default_artifact = _trm.deployments[0].artifact
        return {"repos": [], "urls": [], "files": [split_artifact(default_artifact)]}
    am = _asr_model(model_id)
    if am is not None:
        # Every ASR card is a transcribe.cpp GGUF: artifact "org/repo/file.gguf"
        # → exactly one pinned file to fetch (the repo ships 5+ quants).
        repo, fname = split_artifact(am.deployments[0].artifact)
        if fname:
            return {"repos": [], "urls": [], "files": [(repo, fname)]}
        return {"repos": [repo], "urls": []}
    # Unknown id (not a catalog card): treat it as a bare repo id. The
    # sherpa-onnx piper/vits community-voice aliasing that used to live here
    # died with sherpa_tts.py (slice 4) — every id is now a catalog id or
    # this generic fallback.
    return {"repos": [model_id], "urls": []}


def download_specs(model_id, repo=None):
    """Map a model id to its download sources: {repos: [..], urls: [..]}.

    `repo` overrides the model's default repo with a chosen variant's repo (the
    variant id resolves to a sibling repo) — variants are translation-only, so
    the override short-circuits before the per-catalog dispatch in _base_specs.

    A variant `repo` is now often an upstream artifact ("org/repo/file.gguf"),
    not a bare repo id — split it the same way the catalog rows are split, so
    the chosen variant downloads as a single pinned file too."""
    if repo:
        repo2, fname = split_artifact(repo)
        if fname:
            from .catalog import tts_model as _tts_model
            _tm = _tts_model(model_id) if model_id else None
            extra = _tts_extra_files(_tm, fname) if _tm is not None else []
            files = [(repo2, fname)] + [(repo2, e) for e in extra]
            return {"repos": [], "urls": [], "files": files}
        return {"repos": [repo], "urls": []}
    return _base_specs(model_id)


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


def _ladder_artifacts(model_id):
    """Every quant rung's artifact for a multi-quant catalog card (ASR or a
    GGUF LLM translate card), [] for single-variant/unknown ids. model_status's
    no-override path treats a card as RUNNABLE when ANY rung is cached —
    load-time resolution only ever loads downloaded quants (accel's
    downloaded= restriction), so runnability must not depend on the static
    default rung (field bug: Fun-ASR default Q6_K vs downloaded Q8_0 read
    'absent' from every bare status query)."""
    m = _asr_model(model_id) if model_id else None
    if m is None:
        from .catalog import translate_model as _translate_model
        m = _translate_model(model_id) if model_id else None
    if m is None:
        from .catalog import tts_model as _tts_model
        m = _tts_model(model_id) if model_id else None
    if m is None:
        return []
    arts, seen = [], set()
    for d in m.deployments:
        if d.compute_type in seen:
            continue
        seen.add(d.compute_type)
        arts.append(d.artifact)
    return arts if len(arts) > 1 else []


def model_status(model_id, repo=None):
    """'ready' only if every repo + url is cached locally AND complete, else 'absent'.

    `repo` overrides the model's default repo with a chosen variant's repo (mirrors
    download_specs), so status reflects the variant the card actually downloads.
    WITHOUT an override, a multi-quant card's file requirement is satisfied by
    ANY cached rung of its ladder (see _ladder_artifacts) — the override form
    keeps per-quant semantics for the download buttons. This covers every
    catalog kind uniformly (ASR, translate, TTS): every card is a single-file
    (or, for pocket-tts-en, single-file-plus-sidecar) artifact, so there is no
    per-kind status branch left — TTS used to need one (a whole-repo,
    any-variant-cached check) before its artifacts became single-file GGUFs.

    Translate cards (native_translate) need nothing beyond their GGUF file —
    translation runs in-process through sokuji_native, the same wheel ASR and
    TTS already require, so there is no separate runtime binary to install."""
    specs = download_specs(model_id, repo)
    try:
        if not _repos_cached(specs):
            return "absent"
        ladder = _ladder_artifacts(model_id) if repo is None else []
        if ladder:
            from huggingface_hub import hf_hub_download

            def _rung_cached(artifact):
                r, fname = split_artifact(artifact)
                try:
                    hf_hub_download(r, fname, local_files_only=True)
                    return True
                except Exception:
                    return False
            if not any(_rung_cached(a) for a in ladder):
                return "absent"
        elif specs.get("files"):
            from huggingface_hub import hf_hub_download
            for r, fname in specs["files"]:
                hf_hub_download(r, fname, local_files_only=True)
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
    # Files-shaped specs (GGUF cards) name their exact (repo, filename) pairs
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

    # Byte mode when the total size is known (all catalog cards).
    size = None
    try:
        size = model_size(model_id if not repo else repo)
    except Exception:
        size = None
    total_bytes = size or None

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

    for i, (r, fname) in enumerate(files):
        if cancelled():
            return "cancelled"
        await _fetch(hf_hub_download, r, fname, poll_repo=r)
        await progress(final=i == len(files) - 1)
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
