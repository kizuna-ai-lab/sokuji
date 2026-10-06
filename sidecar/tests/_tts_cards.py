"""Synthetic TTS cards, a real on-disk huggingface_hub cache layout, and a stand-in for the
native TTS entry points, shared by the sidecar tests of pinned revisions, companion files and
per-card voices. None of the cards here is a real family's, and none is in the catalog unless
a test puts it there through monkeypatch."""
import os
import types

import pytest

from sokuji_sidecar import accel, catalog

PIN = "0123456789abcdef0123456789abcdef01234567"            # a commit hash: 40 hex digits
PINNED_REPO = "acme/pinned-tts"
OFFICIAL_SHA = "fedcba9876543210fedcba9876543210fedcba98"   # what refs/main names in a test cache

CPU_MACHINE = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
                            installed=frozenset({"native_tts"}), fingerprint="t-cpu",
                            tc_kinds=("cpu",), generation="G-test")


def pinned_card():
    """Two rungs at the root of a pinned third-party repo, built from Deployments directly
    (no _tts_gguf_row keyword needed). Family pocket_tts, so the load-free voice listing
    reaches the Hub for it."""
    deps = (
        catalog.Deployment("native_tts", "cpu", "q8_0", f"{PINNED_REPO}/pinned-q8_0.gguf", 2.0,
                           est_bytes=11),
        catalog.Deployment("native_tts", "cpu", "bf16", f"{PINNED_REPO}/pinned-bf16.gguf", 1.0,
                           est_bytes=22),
    )
    return catalog.TtsModel("pinned-test", "Pinned Test", ("en",), deps, family="pocket_tts",
                            size_bytes=11, graph_family="pocket_tts")


def add_cached_file(cache_root, repo, rev, rel_path, content=b"x", refs_main=False):
    """One file in a REAL huggingface_hub cache layout: a blob under blobs/ and a
    snapshots/<rev>/<rel_path> symlink to it. refs/main is written only when asked: a download
    at a pinned commit never writes it. Returns the snapshot path."""
    repo_dir = os.path.join(cache_root, f"models--{repo.replace('/', '--')}")
    blob = os.path.join(repo_dir, "blobs", "blob-" + rel_path.replace("/", "_"))
    link = os.path.join(repo_dir, "snapshots", rev, rel_path)
    os.makedirs(os.path.dirname(blob), exist_ok=True)
    os.makedirs(os.path.dirname(link), exist_ok=True)
    with open(blob, "wb") as f:
        f.write(content)
    os.symlink(blob, link)
    if refs_main:
        os.makedirs(os.path.join(repo_dir, "refs"), exist_ok=True)
        with open(os.path.join(repo_dir, "refs", "main"), "w") as f:
            f.write(rev)
    return link


@pytest.fixture
def hub_cache(monkeypatch, tmp_path):
    """A private HF cache root that every Hub lookup, cache scan and staging call reads."""
    import huggingface_hub.constants as hfc
    root = tmp_path / "hub"
    root.mkdir()
    monkeypatch.setattr(hfc, "HF_HUB_CACHE", str(root))
    monkeypatch.setattr("huggingface_hub.utils._cache_manager.HF_HUB_CACHE", str(root))
    return str(root)


@pytest.fixture
def pinned(monkeypatch):
    """pinned_card() in the catalog, its repo pinned to PIN."""
    card = pinned_card()
    monkeypatch.setitem(catalog.PINNED_REVISIONS, PINNED_REPO, PIN)
    monkeypatch.setattr(catalog, "TTS_MODELS", catalog.TTS_MODELS + [card])
    return card


class _LoadedModel:
    capabilities = types.SimpleNamespace(streaming=False, clones=False, transcript_required=False,
                                         sample_rate=24000)

    def presets(self):
        return []

    def unload(self):
        pass


def fake_native(monkeypatch):
    """Stand-in for sokuji_native's TTS load: records every path tts_load is handed and
    returns a model that loads and unloads cleanly. Returns the list of loaded paths."""
    from sokuji_sidecar import native
    loads = []

    def tts_load(path, family, device=None, language=None):
        loads.append(path)
        return _LoadedModel()

    monkeypatch.setattr(native, "module", lambda: types.SimpleNamespace(tts_load=tts_load))
    monkeypatch.setattr(native, "device_for", lambda kind: f"dev:{kind}")
    return loads
