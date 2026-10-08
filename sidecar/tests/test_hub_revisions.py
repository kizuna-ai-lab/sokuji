"""Ruling 4: a third-party TTS repo is pinned to one commit, and every Hub call the sidecar
makes on the TTS path reads that commit. audio.cpp's official mirror stays unpinned: its calls
pass revision=None, so what users downloaded before still resolves through refs/main."""
import ast
import asyncio
import importlib.util
import json
import os
import pathlib
import re
import sys
import types

import pytest

from sokuji_sidecar import accel, backends, catalog, tts_backend, tts_voices  # noqa: F401 (tts_backend registers native_tts)
from sokuji_sidecar import native_models as nm
from sokuji_sidecar.planner import PlanConfig
from _tts_cards import (CPU_MACHINE, OFFICIAL_SHA, PIN, PINNED_REPO, add_cached_file,  # noqa: F401
                        fake_native, hub_cache, pinned)   # hub_cache, pinned: pytest fixtures

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
_PKG = pathlib.Path(catalog.__file__).resolve().parent
_OFFICIAL = "audio-cpp/audio.cpp-gguf"
_HUB_FUNCS = {"hf_hub_download", "snapshot_download", "get_paths_info", "repo_info",
              "list_repo_files"}


def test_pinned_revisions_are_the_third_party_repos_at_their_commits():
    assert catalog.PINNED_REVISIONS == {
        "js-byte/Audio8-TTS-Preview-0.6b-GGUF": "788f6fdb0bbdbbc407c63f3265cea9875b4a7c14",
        "WalkingCat/Soprano-1.1-80M-GGUF": "36c6f47cf91421b7f0cf3d862d28ae2e41aab3f2",
        "mirek190/audio.cpp": "94bbade143c5f62c0c842ef5b2119f7880fa9ee4",
        "dignome/Echo-TTS": "5a7c7c5f510410a8841ba7e46cf6bfd91ea25c21",
        "dignome/kitten_tts2": "73b762c95b07c4f0675c927c25d65741b8dab7da",
        "mohammedaly22/VoiceTut-TTS-GGUF": "615457bb2e9043f468e012c159146b28fa8f5959",
        "LiquidAI/LFM2.5-Audio-1.5B-GGUF": "7d525f883a077e20afb782f2ff618edcae0e39e4",
        "LiquidAI/LFM2.5-Audio-1.5B-JP-GGUF": "64b96718b341dbd5650f9e85627cecdcbd4ac61b",
        # Not third-party, but the same need: the repo removed its plain GGUFs on 2026-09-12
        # (bundle/ only since); 1a9defe9 is the last commit that has them, at the card's sizes.
        "handy-computer/multitalker-parakeet-streaming-0.6b-v1-gguf":
            "1a9defe9bb8f2a7ca2110454f6920f794e45df11",
    }
    for repo, sha in catalog.PINNED_REVISIONS.items():
        assert re.fullmatch(r"[0-9a-f]{40}", sha), repo
    assert _OFFICIAL not in catalog.PINNED_REVISIONS


def test_hub_revision_is_the_pin_or_none():
    assert catalog.hub_revision("WalkingCat/Soprano-1.1-80M-GGUF") == \
        "36c6f47cf91421b7f0cf3d862d28ae2e41aab3f2"
    assert catalog.hub_revision(_OFFICIAL) is None
    assert catalog.hub_revision("handy-computer/whisper-base-gguf") is None


def _hub_calls(path, functions=None):
    """{line: (enclosing function, passes revision=)} for every Hub call in `path`: a call of
    one of _HUB_FUNCS, or a call that hands one of them to a helper (download's _fetch).
    Optionally only inside the named functions."""
    tree = ast.parse(pathlib.Path(path).read_text())
    found = {}
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if functions is not None and fn.name not in functions:
            continue
        for node in ast.walk(fn):
            if not isinstance(node, ast.Call):
                continue
            callee = (node.func.attr if isinstance(node.func, ast.Attribute)
                      else getattr(node.func, "id", None))
            hands_one_over = any(isinstance(a, ast.Name) and a.id in _HUB_FUNCS for a in node.args)
            if callee in _HUB_FUNCS or hands_one_over:
                found[node.lineno] = (fn.name, any(k.arg == "revision" for k in node.keywords))
    return found


@pytest.mark.parametrize("module, functions", [
    ("native_models.py", None),
    ("tts_backend.py", None),
    ("tts_voices.py", None),
    ("accel.py", {"_downloaded_quants", "_artifact_path", "_companion_paths"}),
])
def test_every_tts_path_hub_call_passes_a_revision(module, functions):
    """A pinned download writes snapshots/<sha>/ and no refs/main, so ONE lookup of "main"
    left anywhere on the TTS path reads a downloaded pinned card as absent forever."""
    calls = _hub_calls(_PKG / module, functions)
    assert calls, f"no Hub call found in {module}: the scan is not looking"
    missing = sorted(f"{module}:{line} {fn}" for line, (fn, ok) in calls.items() if not ok)
    assert missing == []


def test_a_pinned_download_reads_ready_only_at_its_revision(hub_cache, pinned):
    add_cached_file(hub_cache, PINNED_REPO, PIN, "pinned-q8_0.gguf")          # no refs/main
    assert nm.model_status("pinned-test") == "ready"
    assert nm.model_status("pinned-test", repo=f"{PINNED_REPO}/pinned-q8_0.gguf") == "ready"
    assert nm.model_status("pinned-test", repo=f"{PINNED_REPO}/pinned-bf16.gguf") == "absent"
    assert accel._downloaded_quants(pinned) == {"q8_0"}
    assert accel._artifact_path(pinned, "q8_0").endswith(
        os.path.join("snapshots", PIN, "pinned-q8_0.gguf"))


def test_a_pinned_card_loads_from_its_pinned_snapshot(hub_cache, pinned, monkeypatch):
    add_cached_file(hub_cache, PINNED_REPO, PIN, "pinned-q8_0.gguf", content=b"pinned gguf")
    loads = fake_native(monkeypatch)
    b = backends.make_backend("native_tts")
    b.load(f"{PINNED_REPO}/pinned-q8_0.gguf", "cpu", "q8_0",
           config=PlanConfig(tts_family="moss_tts_nano"))
    assert b.is_loaded
    # The staging key is <repo>__<rev>: the pinned commit, read off the snapshot directory.
    assert loads[0].endswith(os.path.join(f"acme--pinned-tts__{PIN}", "pinned-q8_0.gguf"))
    with open(loads[0], "rb") as f:
        assert f.read() == b"pinned gguf"
    b.unload()


def test_the_load_free_voice_listing_reads_a_pinned_snapshot(hub_cache, pinned):
    add_cached_file(hub_cache, PINNED_REPO, PIN, "embeddings/alba.safetensors")
    assert tts_voices.list_builtin_voices("pinned-test", None) == ["alba"]


def test_download_fetches_a_pinned_card_at_its_revision(hub_cache, pinned, monkeypatch):
    import huggingface_hub
    fetched = []

    def fetch(repo, fname, revision=None, local_files_only=False):
        if local_files_only:
            raise FileNotFoundError(fname)          # nothing cached yet
        fetched.append((repo, fname, revision))
        return None

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", fetch)

    async def send(_msg):
        pass

    assert asyncio.run(nm.download("pinned-test", send)) == "ready"
    assert fetched == [(PINNED_REPO, "pinned-q8_0.gguf", PIN)]


def test_model_size_reads_a_pinned_file_at_its_revision(monkeypatch):
    import huggingface_hub
    monkeypatch.setitem(catalog.PINNED_REVISIONS, PINNED_REPO, PIN)
    seen = {}

    class _Api:
        def get_paths_info(self, repo_id, paths, revision=None):
            seen.update(repo=repo_id, paths=paths, revision=revision)
            return [types.SimpleNamespace(size=7)]

    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    nm._SIZE_CACHE.clear()
    # Not a catalog rung, so its size comes from the Hub -- at the pinned commit.
    assert nm.model_size(f"{PINNED_REPO}/not-a-card-q4_0.gguf") == 7
    assert seen == {"repo": PINNED_REPO, "paths": ["not-a-card-q4_0.gguf"], "revision": PIN}


def test_delete_reclaims_a_pinned_snapshot(hub_cache, pinned):
    add_cached_file(hub_cache, PINNED_REPO, PIN, "pinned-q8_0.gguf", content=b"x" * 11)
    assert nm.model_status("pinned-test") == "ready"
    assert nm.delete_model("pinned-test") == 11
    assert nm.model_status("pinned-test") == "absent"


def test_unpinned_official_repo_cards_call_the_hub_with_revision_none(hub_cache, monkeypatch):
    """Cards on audio.cpp's official mirror are not pinned: every Hub call for them passes
    revision=None, the Hub's own default, so status, download and delete behave exactly as
    they did before pinning existed."""
    import huggingface_hub
    hub, snaps, scans = [], [], []

    def hub_download(repo, fname, **kw):
        hub.append((repo, fname, kw))
        if kw.get("local_files_only"):
            raise FileNotFoundError(fname)    # nothing cached: status reads absent, download fetches
        return None

    def snapshot(repo, **kw):
        snaps.append((repo, kw))
        raise FileNotFoundError(repo)

    def scan(*args, **kw):
        scans.append((args, kw))
        return types.SimpleNamespace(repos=[])

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", hub_download)
    monkeypatch.setattr(huggingface_hub, "snapshot_download", snapshot)
    monkeypatch.setattr(huggingface_hub, "scan_cache_dir", scan)

    async def send(_msg):
        pass

    assert nm.model_status("supertonic-3") == "absent"
    assert nm.model_status("moss-tts-nano") == "absent"
    assert asyncio.run(nm.download("supertonic-3", send)) == "ready"
    assert nm.delete_model("supertonic-3") == 0
    moss = catalog.tts_model("moss-tts-nano")
    assert accel._downloaded_quants(moss) == set()
    assert accel._artifact_path(moss, "q8_0") is None
    assert tts_voices.list_builtin_voices("pocket-tts-en", None) == []
    with pytest.raises(backends.BackendLoadError):
        backends.make_backend("native_tts").load(
            catalog.tts_model("supertonic-3").deployments[0].artifact, "cpu", "f16",
            config=PlanConfig(tts_family="supertonic"))

    assert hub and snaps
    for repo, _fname, kw in hub:
        assert repo == _OFFICIAL
        assert "revision" in kw and kw["revision"] is None, kw
    for repo, kw in snaps:
        assert repo == _OFFICIAL
        assert "revision" in kw and kw["revision"] is None, kw
    assert scans == [((), {})]                 # delete scans the cache; no revision is involved
    fetched = [(r, f) for r, f, kw in hub if not kw.get("local_files_only")]
    assert fetched == [(_OFFICIAL, "Supertonic-3-GGUF/supertonic-3-f16.gguf")]


def test_an_existing_official_download_still_reads_downloaded(hub_cache):
    """What a user downloaded before pinning existed -- snapshots/<sha> plus refs/main --
    still reads as downloaded through the real Hub library: status, the downloaded-rung set
    and the artifact path. This passes before the change too; it must still pass after it."""
    add_cached_file(hub_cache, _OFFICIAL, OFFICIAL_SHA,
                    "Supertonic-3-GGUF/supertonic-3-f16.gguf", refs_main=True)
    add_cached_file(hub_cache, _OFFICIAL, OFFICIAL_SHA,
                    "MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-bf16.gguf")
    assert nm.model_status("supertonic-3") == "ready"
    assert nm.model_status("moss-tts-nano") == "ready"
    moss = catalog.tts_model("moss-tts-nano")
    bf16 = next(d.artifact for d in moss.deployments if d.compute_type == "bf16")
    assert nm.model_status("moss-tts-nano", repo=bf16) == "ready"
    assert accel._downloaded_quants(moss) == {"bf16"}
    assert accel._artifact_path(moss, "bf16").endswith(os.path.join(
        "snapshots", OFFICIAL_SHA, "MOSS-TTS-Nano-100M-GGUF", "moss-tts-nano-100m-bf16.gguf"))


def test_a_vanished_pinned_repo_fails_like_any_download_and_breaks_no_reader(hub_cache, pinned,
                                                                              monkeypatch):
    """A pinned repo or commit that has gone makes the Hub raise RepositoryNotFoundError or
    RevisionNotFoundError. The download ends exactly where an unpinned download failure ends
    today (one `error` message tagged with the model, no `model_download_done`, the task
    bookkeeping cleared), and nothing that only reads lets the exception escape."""
    import huggingface_hub
    from huggingface_hub.errors import RepositoryNotFoundError, RevisionNotFoundError

    class _Conn:
        def __init__(self):
            self.sent = []

        async def send(self, msg):
            self.sent.append(msg)

    def run_download(model, exc):
        def fetch(repo, fname, revision=None, local_files_only=False):
            raise exc
        monkeypatch.setattr(huggingface_hub, "hf_hub_download", fetch)
        state = {"cancels": {model: asyncio.Event()}, "download_tasks": {model: None}}
        conn = _Conn()
        asyncio.run(nm._run_download(state, model, conn))
        return state, conn.sent

    # Today's failure path, for a card on the unpinned official mirror.
    unpinned = OSError("network unreachable")
    state, sent = run_download("supertonic-3", unpinned)
    assert sent == [{"type": "error", "model": "supertonic-3", "message": str(unpinned)}]
    assert state == {"cancels": {}, "download_tasks": {}}

    monkeypatch.setattr(accel, "probe", lambda force=False: CPU_MACHINE)
    monkeypatch.setattr(accel, "bench_load", lambda: {})
    for gone in (RepositoryNotFoundError(f"{PINNED_REPO}: 404"),
                 RevisionNotFoundError(f"{PINNED_REPO}@{PIN}: 404")):
        state, sent = run_download("pinned-test", gone)
        assert sent == [{"type": "error", "model": "pinned-test", "message": str(gone)}]
        assert state == {"cancels": {}, "download_tasks": {}}

        def lookup(*_a, _gone=gone, **_k):
            raise _gone

        class _Api:
            def get_paths_info(self, *_a, _gone=gone, **_k):
                raise _gone

        monkeypatch.setattr(huggingface_hub, "hf_hub_download", lookup)
        monkeypatch.setattr(huggingface_hub, "snapshot_download", lookup)
        monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
        nm._SIZE_CACHE.clear()
        assert nm.model_status("pinned-test") == "absent"
        assert nm.model_status("pinned-test", repo=f"{PINNED_REPO}/pinned-bf16.gguf") == "absent"
        assert isinstance(nm.model_size(f"{PINNED_REPO}/pinned-bf16.gguf"), int)
        assert accel._downloaded_quants(pinned) == set()
        assert tts_voices.list_builtin_voices("pinned-test", None) == []
        reply, _ = asyncio.run(accel._h_models_catalog(
            {}, {"kind": "tts", "id": 1, "models": ["pinned-test"]}, None))
        assert [v["downloaded"] for v in reply["models"][0]["variants"]] == [False, False]


def test_hub_sizes_reads_the_given_revision(monkeypatch, tmp_path):
    """Spec stage 2.5: a third-party file's size is read at its pinned commit."""
    import huggingface_hub
    seen = []

    class _Api:
        def model_info(self, repo, revision=None, files_metadata=False):
            seen.append((repo, revision, files_metadata))
            return types.SimpleNamespace(
                sha=revision or "f" * 40, private=False,
                siblings=[types.SimpleNamespace(
                    rfilename="Soprano-1.1-80M-GGUF/soprano-1.1-80m-q8_0.gguf", size=123162336)])

    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    # The old script ran at import from sys.argv: keep whatever it would write in tmp_path.
    monkeypatch.setattr(sys, "argv", ["hub_sizes.py", "acme/import-time",
                                      str(tmp_path / "import.json")])
    spec = importlib.util.spec_from_file_location(
        "hub_sizes", _REPO_ROOT / "benchmark" / "qwen3-asr-webgpu" / "hub_sizes.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    seen.clear()

    out = tmp_path / "soprano.json"
    sha = catalog.PINNED_REVISIONS["WalkingCat/Soprano-1.1-80M-GGUF"]
    assert mod.main(["WalkingCat/Soprano-1.1-80M-GGUF", str(out), sha]) == 0
    assert seen == [("WalkingCat/Soprano-1.1-80M-GGUF", sha, True)]
    data = json.loads(out.read_text())
    assert data["revision"] == sha and data["sha"] == sha
    assert data["files"] == {"Soprano-1.1-80M-GGUF/soprano-1.1-80m-q8_0.gguf": 123162336}
    # Without a revision the repo's head is read, as before.
    assert mod.main(["WalkingCat/Soprano-1.1-80M-GGUF", str(out)]) == 0
    assert seen[-1] == ("WalkingCat/Soprano-1.1-80M-GGUF", None, True)


@pytest.mark.parametrize("module", ["asr_backend.py", "translate_backend.py"])
def test_every_asr_and_translate_load_hub_call_passes_a_revision(module):
    """The load paths resolve the GGUF the status call found; a pinned ASR or translation repo
    (the multitalker card) has no refs/main, so a revision-less lookup here would find nothing."""
    calls = _hub_calls(_PKG / module)
    assert calls, f"no Hub call found in {module}: the scan is not looking"
    missing = sorted(f"{module}:{line} {fn}" for line, (fn, ok) in calls.items() if not ok)
    assert missing == []


def test_a_pinned_asr_card_loads_from_its_pinned_snapshot(hub_cache, monkeypatch):
    from sokuji_sidecar import asr_backend, native
    repo = "acme/pinned-asr-gguf"
    monkeypatch.setitem(catalog.PINNED_REVISIONS, repo, PIN)
    snap = add_cached_file(hub_cache, repo, PIN, "pinned-asr-Q8_0.gguf")      # no refs/main
    loads = []
    monkeypatch.setattr(native, "module", lambda: types.SimpleNamespace(
        asr_load=lambda path, device: loads.append(path) or object()))
    monkeypatch.setattr(native, "device_for", lambda kind: f"dev:{kind}")
    asr_backend.NativeAsrBackend().load(f"{repo}/pinned-asr-Q8_0.gguf", "cpu", "q8_0")
    assert loads == [snap]


def test_the_multitalker_card_is_pinned_to_its_last_plain_gguf_commit():
    m = catalog.asr_model("multitalker-parakeet-streaming-0.6b-v1")
    repo, _fname = catalog.split_artifact(m.deployments[0].artifact)
    assert catalog.hub_revision(repo) == "1a9defe9bb8f2a7ca2110454f6920f794e45df11"
