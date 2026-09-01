"""Model download/status registry for the LOCAL_NATIVE provider.

Each native model id maps to a set of HuggingFace repos. status checks they're
fully cached; download fetches them file-by-file with progress. Mirrors
LOCAL_INFERENCE's manage-before-use UX, but server-side (HF cache).
"""
import fnmatch
import os
import shutil

from .catalog import TTS_STAGING_DIRNAME, asr_model as _asr_model, split_artifact


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


def _extra_files_present(model_id) -> bool:
    """True if every one of a TTS card's `extra_files` (pocket-tts-en's
    embeddings/alba.safetensors) is already cached, or the card has none.

    Fix round 1, CQ-2: `_ladder_artifacts`'s any-rung relaxation only ever
    looks at each quant's PRIMARY artifact file — a card whose extra_files
    sidecar is missing still read 'ready' as long as one gguf rung was cached.
    Checked unconditionally (both the bare and repo-override `model_status`
    paths) in addition to, not instead of, the existing ladder/files check —
    for an override, `specs["files"]` already lists the extras too (see
    `download_specs`), so this is a cheap, harmless re-check there and the
    only thing that actually closes the gap on the bare (ladder) path."""
    from .catalog import tts_model as _tts_model
    m = _tts_model(model_id) if model_id else None
    if m is None or not m.extra_files:
        return True
    from huggingface_hub import hf_hub_download
    repo, fname = split_artifact(m.deployments[0].artifact)
    for extra in _tts_extra_files(m, fname):
        try:
            hf_hub_download(repo, extra, local_files_only=True)
        except Exception:
            return False
    return True


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
    A card's `extra_files` sidecar (see _extra_files_present) is required in
    addition to the ladder/files check, on both the bare and override paths.

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
        if not _extra_files_present(model_id):
            return "absent"
        return "ready"
    except Exception:
        return "absent"


def _repo_owner_cards(repo: str) -> set:
    """Card ids (across ASR/translate/TTS) whose deployments reference `repo`
    (the repo half of split_artifact). Distinguishes a genuinely per-card
    upstream repo — every ASR/translate card today: the repo IS the card, so
    its other cached quants are that SAME card's siblings — from a repo
    several DIFFERENT cards share: every TTS card downloads from
    audio-cpp/audio.cpp-gguf. Only the latter needs file-level delete (see
    delete_model) — deleting one card must never touch another's files."""
    from .catalog import asr_models, translate_models, tts_models
    owners = set()
    for m in list(asr_models()) + list(translate_models()) + list(tts_models()):
        if any(split_artifact(d.artifact)[0] == repo for d in m.deployments):
            owners.add(m.id)
    return owners


def _delete_shared_repo_files(cache, repo: str, fnames) -> int:
    """Remove exactly `fnames` (relative snapshot paths within `repo`) from
    the HF cache — used when `_repo_owner_cards(repo)` says more than one
    catalog card shares `repo` (fix round 1, CQ-1). huggingface_hub's cache
    scanner has no file-level delete API, only whole-revision
    (`delete_revisions`), which would remove every OTHER card's cached files
    from the same shared snapshot too (a reviewer-caught bug: deleting one
    TTS card freed several GB of other cards' downloads).

    Matching is done on each file's path RELATIVE TO ITS OWN REVISION'S
    SNAPSHOT ROOT (`CachedRevisionInfo.snapshot_path`) — fix round 2:
    `CachedFileInfo.file_name` is the BASENAME only (huggingface_hub's own
    `_scan_cached_repo` sets it to `file_path.name`), never the dir-prefixed
    relative path (e.g. "MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-
    q8_0.gguf") our `fnames`/`wanted` hold — round 1 matched on `file_name`,
    which is NEVER equal to a dir-prefixed `fnames` entry, so `matched` was
    always empty and this function was a silent, total no-op in production
    (verified via the library source and a live repro).

    Deletes each matched file's snapshot symlink, and its underlying blob
    ONLY when no file OUTSIDE `fnames` in the same repo still points at that
    blob (HF's cache is content-addressed by hash, so a blob is shared only
    when two files are byte-identical — never true for distinct per-card
    GGUFs in practice, but checked to be safe rather than assumed). Returns
    the bytes actually reclaimed (blobs deleted; symlinks are ~0 bytes)."""
    wanted = set(fnames)
    repo_info = next((r for r in cache.repos
                      if r.repo_id == repo and r.repo_type == "model"), None)
    if repo_info is None:
        return 0
    # (relative_path, CachedFileInfo) pairs across every revision of the repo.
    all_pairs = [
        (f.file_path.relative_to(revision.snapshot_path).as_posix(), f)
        for revision in repo_info.revisions
        for f in revision.files
    ]
    matched = [f for rel, f in all_pairs if rel in wanted]
    kept_blobs = {f.blob_path for rel, f in all_pairs if rel not in wanted}
    freed = 0
    for f in matched:
        try:
            os.remove(f.file_path)
        except OSError:
            pass
        if f.blob_path not in kept_blobs:
            try:
                freed += os.path.getsize(f.blob_path)
                os.remove(f.blob_path)
            except OSError:
                pass
    return freed


def _staging_root() -> str:
    from huggingface_hub import constants
    return os.path.join(constants.HF_HUB_CACHE, TTS_STAGING_DIRNAME)


def _prune_staged_files(repo: str, fnames) -> None:
    """Ruling R18: disk-reclamation coupling. tts_backend.py's load() hard-links a
    card's gguf (+ pocket_tts's embeddings sidecar) into a small staging tree under
    this SAME cache root (its own module docstring has the full defect trace) so
    audio.cpp's canonicalizing loader sees a real, extension-bearing path instead of
    an HF snapshot symlink. A hard link is a SECOND directory entry for the SAME
    inode, so removing only the HF-cache-side symlink/blob (as
    _delete_shared_repo_files just did) does not reclaim the underlying disk blocks
    while a staged link still references that inode -- "delete" would silently free
    nothing. Scoped to exactly `fnames` (never a whole staged revision at once), for
    the identical reason _delete_shared_repo_files is file-scoped: a repo can be
    shared by several catalog cards (every TTS card downloads from
    audio-cpp/audio.cpp-gguf), and deleting one must never remove another's staged
    files -- `fnames` are relative-to-repo paths, the same shape
    _stage_for_native()'s own `rel_path` uses, so identity matches without the two
    modules sharing code."""
    root = _staging_root()
    prefix = repo.replace("/", "--") + "__"
    try:
        entries = os.listdir(root)
    except OSError:
        return
    wanted = set(fnames)
    for entry in entries:
        if not entry.startswith(prefix):
            continue
        rev_dir = os.path.join(root, entry)
        for rel in wanted:
            try:
                os.remove(os.path.join(rev_dir, rel))
            except OSError:
                pass
        # Prune now-empty directories bottom-up (topdown=False visits rev_dir itself
        # last) so a fully-deleted card doesn't leave an empty <repo>__<rev>/<subdir>
        # tree behind forever; a directory another card still has files under simply
        # fails to rmdir (not empty) and is left alone.
        for dirpath, _dirs, _files in os.walk(rev_dir, topdown=False):
            try:
                os.rmdir(dirpath)
            except OSError:
                pass


def _prune_staged_repo(repo: str) -> None:
    """Ruling R18: whole-repo delete's staging counterpart to
    _prune_staged_files -- safe to remove EVERY staged revision for `repo` outright
    here because delete_model() only takes the whole-repo path when
    `_repo_owner_cards(repo)` reports at most one owning card (see delete_model's own
    docstring): there is no OTHER card's staged files under this repo's prefix to
    protect. A harmless no-op for a repo nothing has ever staged (every non-TTS
    repo, today)."""
    root = _staging_root()
    prefix = repo.replace("/", "--") + "__"
    try:
        entries = os.listdir(root)
    except OSError:
        return
    for entry in entries:
        if entry.startswith(prefix):
            shutil.rmtree(os.path.join(root, entry), ignore_errors=True)


def delete_model(model_id, repo=None):
    """Remove a model's cached files from the HF cache.

    `repo` overrides the model's default repo with a chosen variant's repo
    (mirrors download_specs / model_status), so deleting an FP8-only HY-MT card
    actually frees the FP8 cache instead of the unused bf16 default.

    Returns the number of bytes freed.

    `specs["repos"]` entries (whole-repo cards — today only the unknown-id
    fallback) are always deleted via the hub's cache scanner's whole-revision
    delete, so we only touch fully-managed revisions.

    `specs["files"]` entries are deleted per-repo, gated on `_repo_owner_cards`:
    a repo used by exactly one catalog card (every ASR/translate card, and
    the common case for TTS before slice 4) is STILL deleted by whole
    revision — its other cached quants are that same card's siblings, so
    removing all of them together is the correct "delete this model"
    behavior. A repo SHARED by more than one card (every TTS card shares
    audio-cpp/audio.cpp-gguf) is instead pruned file-by-file
    (`_delete_shared_repo_files`) so deleting one card can never remove
    another's cached files from the same shared snapshot (fix round 1, CQ-1
    — this claim used to read "per-card siblings, not shared across
    different cards", which is no longer true for TTS).

    Ruling R18: either delete path also removes the card's own hard-link-staged
    entries under TTS_STAGING_DIRNAME (`_prune_staged_files`/`_prune_staged_repo`) —
    tts_backend.py's load() stages a card's gguf (+ sidecars) as hard links so
    audio.cpp's canonicalizing loader can read them; a hard link keeps the
    underlying blob's inode (and its disk blocks) alive even after the HF-cache-side
    symlink/blob above is removed, so skipping this would make "delete" free zero
    bytes for any TTS card whose model was ever loaded.

    M4: `repo=None` means "delete the whole model", not just whichever ONE rung
    download_specs()/model_status() resolve as the default for status/download
    purposes. For a TTS card every quant deployment shares the SAME (multi-card-
    shared) HF repo but a DIFFERENT fname — download_specs's single-rung shape
    (the default quant's artifact only) is right for status/download (which only
    ever want ONE resolved rung at a time), but wrong here: a previously
    downloaded NON-default rung (e.g. an f16 pin the user downloaded, then
    deleted after the renderer's variant selector reverted to "default") would
    otherwise survive untouched and keep model_status reporting the card "ready"
    forever (_ladder_artifacts' any-rung-cached relaxation). Expand to every
    rung's (repo, fname) [+ extra_files] below when the caller asked for the
    whole model, not a specific chosen variant.

    F4: staged-tree pruning must not depend on scan_cache_dir() succeeding — the
    staged hard-link tree is a SEPARATE tree from the one scan_cache_dir() reads
    (a sibling of models--org--repo/ under the same cache root, R18), so a
    transient/out-of-band scan failure must not skip pruning it too (previously
    the `cache is None` branch returned 0 before ever reaching either prune call).
    """
    from huggingface_hub import scan_cache_dir
    specs = download_specs(model_id, repo)
    wanted_repos = set(specs["repos"])
    files_by_repo: dict = {}
    for r, fname in specs.get("files", []):
        files_by_repo.setdefault(r, []).append(fname)

    if repo is None:
        from .catalog import tts_model as _tts_model
        _tm = _tts_model(model_id) if model_id else None
        if _tm is not None:
            # T4ii: pre-seed with what the _base_specs loop above (specs.get
            # ("files", [])) already contributed to files_by_repo -- otherwise
            # the deployment whose (repo, fname) matches the default rung
            # download_specs() already resolved gets appended to
            # files_by_repo[r] a SECOND time below (a harmless but wasteful
            # duplicate delete-file entry).
            seen = {(r, fname) for r, fname in specs.get("files", [])}
            for dep in _tm.deployments:
                r, fname = split_artifact(dep.artifact)
                if fname is None or (r, fname) in seen:
                    continue
                seen.add((r, fname))
                files_by_repo.setdefault(r, []).append(fname)
                for extra in _tts_extra_files(_tm, fname):
                    if (r, extra) not in seen:
                        seen.add((r, extra))
                        files_by_repo[r].append(extra)

    # F4: classify repos into "file-scoped" (shared by >1 catalog card) vs
    # "whole-revision" (solo owner) BEFORE the cache scan below — this
    # classification is pure catalog data (_repo_owner_cards never touches the
    # cache), so it, and the staged-tree prune that follows from it, must not be
    # skipped just because scan_cache_dir() itself fails.
    shared_repo_fnames: dict = {}
    solo_repos = set()
    for r, fnames in files_by_repo.items():
        if len(_repo_owner_cards(r)) > 1:
            shared_repo_fnames[r] = fnames
        else:
            solo_repos.add(r)
    wanted_repos |= solo_repos

    try:
        cache = scan_cache_dir()
    except Exception:
        cache = None
    if cache is None:
        # F4: can't compute HF-cache-side byte counts or delete cache blobs
        # without a successful scan, but the staged tree lives outside what
        # scan_cache_dir() reads at all -- prune it anyway so a scan failure
        # (or an out-of-band HF-cache wipe that makes the NEXT scan fail) never
        # leaves a TTS card's staged hard link (and the disk it keeps alive)
        # behind with no other path left to reach it.
        for r, fnames in shared_repo_fnames.items():
            _prune_staged_files(r, fnames)
        for r in wanted_repos:
            _prune_staged_repo(r)
        return 0

    freed = 0
    for r, fnames in shared_repo_fnames.items():
        freed += _delete_shared_repo_files(cache, r, fnames)
        _prune_staged_files(r, fnames)

    if wanted_repos:
        revisions = []
        for repo_info in cache.repos:
            if repo_info.repo_id in wanted_repos:
                freed += repo_info.size_on_disk
                revisions.extend(rev.commit_hash for rev in repo_info.revisions)
        if revisions:
            cache.delete_revisions(*revisions).execute()
        for r in wanted_repos:
            _prune_staged_repo(r)
    return freed


# Poll interval for streaming a big file's in-flight bytes (tests shrink it).
_PROGRESS_POLL_S = 0.5


def _incomplete_bytes(repo):
    """Bytes of the repo's in-flight `.incomplete` blobs — hf_hub_download
    streams into `<cache>/models--org--repo/blobs/<etag>.incomplete`, so their
    combined size IS the current file's downloaded byte count. Best-effort.

    Fix round 1, CQ-3 (reviewer-judged cosmetic, left as-is): for a repo
    SHARED by multiple cards (every TTS card downloads from
    audio-cpp/audio.cpp-gguf — see _repo_owner_cards), this sums the
    `.incomplete` blobs of the WHOLE repo, not just the file this download
    call is polling for. Two TTS downloads racing against the same repo would
    each see the other's in-flight bytes bleed into their progress bar for a
    moment. `.incomplete` files are named by content-etag, not target
    filename, so there is no cheap way to scope this to one file without an
    extra HF API round-trip per poll tick; harmless beyond a transient
    progress-bar glitch (download() still awaits the correct file's own
    result), so left un-scoped rather than over-engineered."""
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
