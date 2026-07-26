"""Materialize HF-cache symlinks as real files for ORT external-data loading.

The HF cache stores every downloaded file as a symlink into a sibling
../blobs/ tree. ORT's ValidateExternalDataPath canonicalizes a graph's
external-data path (*.bin for GPT-SoVITS, *.onnx.data for the >2GB Qwen3-TTS
graphs) and rejects it when the resolved file escapes the model directory —
which an HF blob symlink always does (it resolves out to ../../../blobs/…).
Stricter ORT builds (seen on the sbsa onnxruntime-gpu 1.24 wheel) then fail
the whole model load, on the cuda AND cpu tiers alike, because the check runs
at graph load before any device placement.

Dereferencing the symlink into a real directory entry keeps the file inside
the model dir where validation passes. A hardlink shares the blob's inode, so
there is no data copy and the HF cache stays intact; a copy is the
cross-filesystem fallback. The swap is atomic (build at a temp name, then
os.replace) so an interrupted run never leaves the weight missing.

This is the same "HF symlinks break stricter tooling, stage real files"
pattern the GPT-SoVITS EnglishG2P staging (_gpt_sovits_stage_real_tree) and
the MOSS hardlink staging (_link_tree) already use; centralized here so every
ORT backend that loads straight from the HF snapshot shares one implementation
instead of rediscovering the bug one weight file at a time.
"""
from __future__ import annotations

import glob
import os
import shutil


def materialize_symlinks(dir_path: str, *, suffixes: tuple[str, ...] | None = None) -> list[str]:
    """Replace symlinked files directly under dir_path with real entries.

    `suffixes`, when given, restricts the deref to names ending in one of them
    (e.g. (".bin",) or (".onnx.data",)); None derefs every symlinked file.
    Idempotent (a real file is skipped), tolerant of a missing dir (returns []),
    and it leaves a dangling symlink untouched so the caller fails loudly rather
    than silently dropping a weight. Returns the paths it materialized.
    """
    written: list[str] = []
    if not os.path.isdir(dir_path):
        return written  # tolerate a missing dir (e.g. plain-v2 has no hubert dir)
    for name in sorted(os.listdir(dir_path)):
        if suffixes is not None and not name.endswith(suffixes):
            continue
        p = os.path.join(dir_path, name)
        if not os.path.islink(p):
            continue
        real = os.path.realpath(p)
        if not os.path.isfile(real):
            continue  # dangling link — leave it so the caller fails loudly
        # Unique per-process tmp name: two processes materializing the same
        # dir concurrently (e.g. two sidecar sessions warming the same model)
        # previously shared the exact-named `p + ".tmp"`, so one could
        # remove/replace the other's in-progress tmp between creation and
        # os.replace, raising FileNotFoundError. A stale tmp left behind by a
        # run that crashed before reaching os.replace (a different, now-dead
        # pid) is swept below, best-effort, before this process starts its own.
        tmp = f"{p}.tmp{os.getpid()}"
        for stale in glob.glob(f"{p}.tmp*"):
            try:
                os.remove(stale)
            except OSError:
                try:
                    os.chmod(stale, 0o600)  # clear read-only (Windows) without going world-writable (POSIX)
                    os.remove(stale)
                except OSError:
                    pass  # in use by a concurrent run, or genuinely unremovable — best-effort cleanup only
        try:
            try:
                os.link(real, tmp)          # hardlink: real entry, same blob data
            except OSError:
                shutil.copy2(real, tmp)     # cross-filesystem fallback
            os.replace(tmp, p)              # atomic: symlink -> real file
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass  # tmp was never created, or already swept — nothing to clean up
            raise
        written.append(p)
    return written
