"""Cards from any repo, at a repo's root, with companion files per rung (spec stage 2.2): what
each rung downloads, when it counts as downloaded, what the planner fits, what load() stages
beside the main GGUF, what a delete keeps, and which dtypes op coverage expands over."""
import asyncio
import os

import pytest

from sokuji_sidecar import accel, backends, catalog, planner, tts_backend  # noqa: F401 (tts_backend registers native_tts)
from sokuji_sidecar import native_models as nm
from sokuji_sidecar.planner import PlanConfig
from _tts_cards import (CODEC, COMPANION_FAMILY, GPU12, GPU24, OFFICIAL, OFFICIAL_SHA,  # noqa: F401
                        PIN, PINNED_REPO, add_cached_file, companions, fake_native, hub_cache,
                        pinned, rung)   # companions, hub_cache, pinned: fixtures

_MAIN_Q8 = "Companion-Test-GGUF/companion-q8_0.gguf"
_MAIN_BF16 = "Companion-Test-GGUF/companion-bf16.gguf"


@pytest.fixture
def pinned_companions(pinned, monkeypatch):
    """A card at the root of the PINNED repo whose rungs each need a companion GGUF, plus an
    extra file the card shares: every kind of file a rung can need, read at the pin."""
    card = catalog._tts_gguf_row(
        "pinned-companion", "Pinned Companion", ("en",), "pocket_tts", "",
        {"q8_0": ("pc-q8_0.gguf", 11), "bf16": ("pc-bf16.gguf", 22)}, default_quant="q8_0",
        order=99, repo=PINNED_REPO, extra_files=(("embeddings/alba.safetensors", 5),),
        companions={"q8_0": (("vocoder-q8_0.gguf", 3),), "bf16": (("vocoder-bf16.gguf", 4),)})
    monkeypatch.setattr(catalog, "TTS_MODELS", catalog.TTS_MODELS + [card])
    return card


async def _send(_msg):
    pass


def test_a_third_party_card_at_its_repo_root_has_plain_artifacts():
    card = catalog._tts_gguf_row(
        "root-test", "Root Test", ("en",), "root_test", "",
        {"q8_0": ("root-q8_0.gguf", 100), "bf16": ("root-bf16.gguf", 200)},
        default_quant="q8_0", order=99, repo="WalkingCat/Soprano-1.1-80M-GGUF")
    assert [d.artifact for d in card.deployments] == [
        "WalkingCat/Soprano-1.1-80M-GGUF/root-q8_0.gguf",
        "WalkingCat/Soprano-1.1-80M-GGUF/root-bf16.gguf"]
    assert catalog.split_artifact(card.deployments[0].artifact) == (
        "WalkingCat/Soprano-1.1-80M-GGUF", "root-q8_0.gguf")
    assert card.size_bytes == 100
    assert all(d.companions == () for d in card.deployments)


def test_each_rung_carries_its_own_companions_and_counts_them(companions):
    q8, bf16 = rung(companions, "q8_0"), rung(companions, "bf16")
    assert q8.artifact == f"{OFFICIAL}/{_MAIN_Q8}"
    assert q8.companions == ((CODEC, 1 << 30), ("vocoder-q8_0.gguf", 1 << 29))
    assert bf16.companions == ((CODEC, 1 << 30), ("vocoder-bf16.gguf", 2 << 30))
    assert {d.companions for d in companions.deployments if d.compute_type == "bf16"} == \
        {bf16.companions}                                    # every tier of a rung agrees
    # est_bytes is the whole package: the figure the planner fits against device memory.
    assert q8.est_bytes == (5 << 30) + (1 << 30) + (1 << 29)
    assert bf16.est_bytes == (9 << 30) + (1 << 30) + (2 << 30)
    assert companions.size_bytes == q8.est_bytes             # the default rung's package


@pytest.mark.parametrize("bad", ["../escape.gguf", "/abs.gguf", "a//b.gguf", "", "dir/"])
def test_a_companion_path_must_stay_inside_the_repo(bad):
    with pytest.raises(ValueError, match="not a path inside"):
        catalog._tts_gguf_row("x", "X", ("en",), "x_family", "X-GGUF",
                              {"q8_0": ("x-q8_0.gguf", 1)}, default_quant="q8_0", order=99,
                              companions={"q8_0": ((bad, 1),)})


def test_companions_must_name_a_shipped_quant():
    with pytest.raises(ValueError, match="bf16"):
        catalog._tts_gguf_row("x", "X", ("en",), "x_family", "X-GGUF",
                              {"q8_0": ("x-q8_0.gguf", 1)}, default_quant="q8_0", order=99,
                              companions={"bf16": (("c.gguf", 1),)})


def test_download_specs_list_the_chosen_rung_with_its_companions(companions):
    assert nm.download_specs("companion-test")["files"] == [
        (OFFICIAL, _MAIN_Q8), (OFFICIAL, CODEC), (OFFICIAL, "vocoder-q8_0.gguf")]
    bf16 = rung(companions, "bf16").artifact
    assert nm.download_specs("companion-test", repo=bf16)["files"] == [
        (OFFICIAL, _MAIN_BF16), (OFFICIAL, CODEC), (OFFICIAL, "vocoder-bf16.gguf")]


def test_model_size_of_a_chosen_rung_counts_its_companions(companions, monkeypatch):
    def offline(*_a, **_k):
        raise AssertionError("a catalog rung's size needs no Hub call")
    monkeypatch.setattr("huggingface_hub.HfApi", offline)
    nm._SIZE_CACHE.clear()
    bf16 = rung(companions, "bf16")
    assert nm.model_size(bf16.artifact) == bf16.est_bytes
    assert nm.model_size("companion-test") == companions.size_bytes


def test_download_fetches_the_main_file_then_its_companions(companions, hub_cache, monkeypatch):
    import huggingface_hub
    fetched = []

    def fetch(repo, fname, revision=None, local_files_only=False):
        if local_files_only:
            raise FileNotFoundError(fname)
        fetched.append((repo, fname, revision))
        return None

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", fetch)
    assert asyncio.run(nm.download("companion-test", _send)) == "ready"
    assert fetched == [(OFFICIAL, _MAIN_Q8, None), (OFFICIAL, CODEC, None),
                       (OFFICIAL, "vocoder-q8_0.gguf", None)]


def test_a_rung_missing_one_companion_is_not_downloaded_and_never_chosen(companions, hub_cache,
                                                                         monkeypatch):
    """An interrupted bf16 download: its main GGUF and the shared codec landed, its vocoder did
    not. The q8_0 rung is complete."""
    import huggingface_hub
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, _MAIN_Q8, refs_main=True)
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, CODEC)
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, "vocoder-q8_0.gguf")
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, _MAIN_BF16)
    q8, bf16 = rung(companions, "q8_0").artifact, rung(companions, "bf16").artifact

    assert nm.model_status("companion-test", repo=bf16) == "absent"
    assert nm.model_status("companion-test", repo=q8) == "ready"
    assert nm.model_status("companion-test") == "ready"           # the q8_0 rung is whole
    assert accel._downloaded_quants(companions) == {"q8_0"}

    # bf16 fits 24 GiB and is the larger rung, so the fit walk would take it if it counted as
    # downloaded. It must not.
    monkeypatch.setattr(accel, "bench_load", lambda: {})
    plans = accel.resolve_tts("companion-test", machine=GPU24)
    assert plans[0].tier == "gpu-vulkan"
    assert {p.compute_type for p in plans} == {"q8_0"}

    # Re-downloading the bf16 rung on the unpinned mirror asks the Hub about every file: a
    # file that is already cached is only re-linked, never fetched again.
    real = huggingface_hub.hf_hub_download
    asked = []

    def hub(repo, fname, revision=None, local_files_only=False):
        if local_files_only:
            return real(repo, fname, revision=revision, local_files_only=True)
        asked.append((repo, fname, revision))
        try:
            return real(repo, fname, revision=revision, local_files_only=True)
        except Exception:
            return add_cached_file(hub_cache, repo, OFFICIAL_SHA, fname)

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", hub)
    assert asyncio.run(nm.download("companion-test", _send, repo=bf16)) == "ready"
    assert asked == [(OFFICIAL, _MAIN_BF16, None), (OFFICIAL, CODEC, None),
                     (OFFICIAL, "vocoder-bf16.gguf", None)]
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", real)
    assert nm.model_status("companion-test", repo=bf16) == "ready"


def test_a_retry_on_the_unpinned_mirror_survives_refs_main_moving(companions, hub_cache,
                                                                  monkeypatch):
    """The first online fetch of a run writes the mirror's newest commit to refs/main. A file
    skipped because it was cached at the OLD commit would then be found only under the old
    snapshot, and the rung would read absent right after a download that returned ready."""
    import huggingface_hub
    new_sha = "0123456789abcdef0123456789abcdef01234567"
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, _MAIN_BF16, refs_main=True)
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, CODEC)
    bf16 = rung(companions, "bf16").artifact
    assert nm.model_status("companion-test", repo=bf16) == "absent"       # no vocoder yet

    real = huggingface_hub.hf_hub_download

    def hub(repo, fname, revision=None, local_files_only=False):
        if local_files_only:
            return real(repo, fname, revision=revision, local_files_only=True)
        # An online call lands the file under the mirror's newest commit and moves refs/main.
        return add_cached_file(hub_cache, repo, new_sha, fname, refs_main=True)

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", hub)
    assert asyncio.run(nm.download("companion-test", _send, repo=bf16)) == "ready"
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", real)
    assert nm.model_status("companion-test", repo=bf16) == "ready"


def test_a_card_whose_only_cached_rung_lacks_a_companion_reads_absent(companions, hub_cache):
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, _MAIN_BF16, refs_main=True)
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, CODEC)
    assert nm.model_status("companion-test") == "absent"
    assert accel._downloaded_quants(companions) == set()


def test_the_planner_fits_a_rung_by_its_whole_package(companions):
    """bf16's main GGUF alone (9 GiB x 1.1) fits a 12 GiB device; its package (12 GiB x 1.1)
    does not, so the fit walk takes q8_0 (6.5 GiB x 1.1)."""
    bf16 = rung(companions, "bf16")
    factor = planner._LLAMA_RESIDENT_FACTOR
    assert (9 << 30) * factor <= (12 << 30) < bf16.est_bytes * factor
    plans = planner.resolve_tts("companion-test", machine=GPU12, platform="linux", cache={})
    assert [(p.tier, p.compute_type) for p in plans] == [("gpu-vulkan", "q8_0"), ("cpu", "q8_0")]


def test_each_plan_carries_its_own_rungs_staging_list(companions):
    pinned_bf16 = planner.resolve_tts("companion-test", "cpu", machine=GPU12, platform="linux",
                                      cache={}, pin="bf16")
    assert {p.compute_type for p in pinned_bf16} == {"bf16"}
    assert all(p.config.tts_extra_files == rung(companions, "bf16").companions
               for p in pinned_bf16)
    auto = planner.resolve_tts("companion-test", machine=GPU12, platform="linux", cache={})
    assert all(p.config.tts_extra_files == rung(companions, "q8_0").companions for p in auto)


def test_plan_config_resolves_extra_files_beside_the_rungs_main_file():
    card = catalog.tts_model("pocket-tts-en")
    for d in card.deployments:
        assert planner._plan_config(card, d).tts_extra_files == (
            ("PocketTTS-GGUF/english/embeddings/alba.safetensors", 6194424),)


def test_load_stages_every_companion_at_its_repo_relative_path(hub_cache, monkeypatch):
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, _MAIN_Q8, content=b"main", refs_main=True)
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, CODEC, content=b"codec")
    add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, "vocoder-q8_0.gguf", content=b"vocoder")
    loads = fake_native(monkeypatch)
    b = backends.make_backend("native_tts")
    b.load(f"{OFFICIAL}/{_MAIN_Q8}", "cpu", "q8_0", config=PlanConfig(
        tts_family=COMPANION_FAMILY, tts_extra_files=((CODEC, 5), ("vocoder-q8_0.gguf", 7))))
    root = os.path.join(hub_cache, catalog.TTS_STAGING_DIRNAME,
                        f"audio-cpp--audio.cpp-gguf__{OFFICIAL_SHA}")
    assert loads == [os.path.join(root, _MAIN_Q8)]
    for rel, content in ((CODEC, b"codec"), ("vocoder-q8_0.gguf", b"vocoder")):
        with open(os.path.join(root, rel), "rb") as f:
            assert f.read() == content
    b.unload()


def test_deleting_one_rung_keeps_a_companion_another_rung_still_needs(companions, hub_cache):
    snap = {rel: add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, rel,
                                 refs_main=(rel == _MAIN_Q8))
            for rel in (_MAIN_Q8, CODEC, "vocoder-q8_0.gguf", _MAIN_BF16, "vocoder-bf16.gguf")}
    staged = os.path.join(hub_cache, catalog.TTS_STAGING_DIRNAME,
                          f"audio-cpp--audio.cpp-gguf__{OFFICIAL_SHA}")
    for rel in (CODEC, "vocoder-bf16.gguf"):
        os.makedirs(os.path.dirname(os.path.join(staged, rel)), exist_ok=True)
        with open(os.path.join(staged, rel), "wb") as f:
            f.write(b"x")

    nm.delete_model("companion-test", repo=rung(companions, "bf16").artifact)
    assert not os.path.lexists(snap[_MAIN_BF16])
    assert not os.path.lexists(snap["vocoder-bf16.gguf"])
    assert os.path.exists(snap[CODEC])                             # q8_0 still needs it
    assert not os.path.exists(os.path.join(staged, "vocoder-bf16.gguf"))
    assert os.path.exists(os.path.join(staged, CODEC))
    assert nm.model_status("companion-test", repo=rung(companions, "q8_0").artifact) == "ready"

    nm.delete_model("companion-test")                              # the whole card
    assert not any(os.path.lexists(p) for p in snap.values())
    assert nm.model_status("companion-test") == "absent"


_SOLO_REPO = "acme/solo-tts"


@pytest.fixture
def solo_companions(monkeypatch):
    """A two-rung card alone on its own pinned repo, both rungs sharing one codec GGUF at the
    repo's root: no other card's files keep the repo alive."""
    monkeypatch.setitem(catalog.PINNED_REVISIONS, _SOLO_REPO, PIN)
    card = catalog._tts_gguf_row(
        "solo-test", "Solo Test", ("en",), "solo_test", "",
        {"q8_0": ("solo-q8_0.gguf", 11), "bf16": ("solo-bf16.gguf", 22)}, default_quant="q8_0",
        order=99, repo=_SOLO_REPO,
        companions={"q8_0": (("codec.gguf", 3),), "bf16": (("codec.gguf", 3),)})
    monkeypatch.setattr(catalog, "TTS_MODELS", catalog.TTS_MODELS + [card])
    return card


def test_deleting_one_rung_of_a_card_alone_on_its_repo_keeps_the_other_rung(solo_companions,
                                                                           hub_cache):
    snap = {rel: add_cached_file(hub_cache, _SOLO_REPO, PIN, rel)
            for rel in ("solo-q8_0.gguf", "solo-bf16.gguf", "codec.gguf")}
    staged = os.path.join(hub_cache, catalog.TTS_STAGING_DIRNAME, f"acme--solo-tts__{PIN}")
    os.makedirs(staged)
    for rel in ("solo-bf16.gguf", "codec.gguf"):
        with open(os.path.join(staged, rel), "wb") as f:
            f.write(b"x")
    q8, bf16 = rung(solo_companions, "q8_0").artifact, rung(solo_companions, "bf16").artifact

    nm.delete_model("solo-test", repo=bf16)
    assert not os.path.lexists(snap["solo-bf16.gguf"])
    assert os.path.exists(snap["solo-q8_0.gguf"])
    assert os.path.exists(snap["codec.gguf"])                       # the q8_0 rung needs it
    assert not os.path.exists(os.path.join(staged, "solo-bf16.gguf"))
    assert os.path.exists(os.path.join(staged, "codec.gguf"))
    assert nm.model_status("solo-test", repo=q8) == "ready"
    assert nm.model_status("solo-test", repo=bf16) == "absent"

    nm.delete_model("solo-test")                                    # the whole card
    assert not any(os.path.lexists(p) for p in snap.values())
    assert nm.model_status("solo-test") == "absent"


def test_deleting_one_pocket_rung_keeps_the_preset_the_other_rung_needs(hub_cache):
    card = catalog.tts_model("pocket-tts-en")
    q8, bf16 = rung(card, "q8_0"), rung(card, "bf16")
    alba = "PocketTTS-GGUF/english/embeddings/alba.safetensors"
    snap = {rel: add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, rel, refs_main=(i == 0))
            for i, rel in enumerate([catalog.split_artifact(q8.artifact)[1],
                                     catalog.split_artifact(bf16.artifact)[1], alba])}
    bf16_main = snap[catalog.split_artifact(bf16.artifact)[1]]
    assert nm.model_status("pocket-tts-en", repo=bf16.artifact) == "ready"

    nm.delete_model("pocket-tts-en", repo=bf16.artifact)
    assert not os.path.lexists(bf16_main)
    assert os.path.exists(snap[alba])                               # the q8_0 rung needs it
    assert nm.model_status("pocket-tts-en", repo=q8.artifact) == "ready"
    assert nm.model_status("pocket-tts-en", repo=bf16.artifact) == "absent"


@pytest.mark.parametrize("cached", [
    (CODEC,),                                    # only the shared codec: another rung's download
    (_MAIN_BF16,),                               # the main file, no companion yet
    (_MAIN_BF16, CODEC),                         # the main file and the codec, no vocoder yet
])
def test_weight_dtypes_of_a_partly_cached_rung_is_the_fallback(companions, hub_cache,
                                                               monkeypatch, cached):
    """A rung's op-coverage question before its download finishes is the wide fallback set,
    not the narrower union of whichever of its GGUFs happen to be cached."""
    for i, rel in enumerate(cached):
        add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, rel, refs_main=(i == 0))
    monkeypatch.setattr(accel.gguf_header, "read_header", lambda p: accel.gguf_header.GgufHeader(
        "x", frozenset({"q8_0"}), 1, frozenset({"q8_0"})))
    assert accel.weight_dtypes(companions, "bf16") == \
        tuple(sorted(catalog.RUNG_FALLBACK_DTYPES["bf16"]))


def test_weight_dtypes_reads_every_cached_gguf_of_the_rung(companions, hub_cache, monkeypatch):
    for rel in (_MAIN_Q8, CODEC, "vocoder-q8_0.gguf"):
        add_cached_file(hub_cache, OFFICIAL, OFFICIAL_SHA, rel, refs_main=(rel == _MAIN_Q8))
    headers = {"companion-q8_0.gguf": {"q8_0", "f32"}, "codec-q8_0.gguf": {"f16"},
               "vocoder-q8_0.gguf": {"bf16", "i32"}}
    monkeypatch.setattr(accel.gguf_header, "read_header", lambda p: accel.gguf_header.GgufHeader(
        "x", frozenset(headers[os.path.basename(p)]), 1, frozenset(headers[os.path.basename(p)])))
    assert accel.weight_dtypes(companions, "q8_0") == ("bf16", "f16", "f32", "q8_0")


def test_a_pinned_rung_is_downloaded_only_with_every_file_cached_at_the_pin(
        hub_cache, pinned_companions, monkeypatch):
    """Ruling 4 with companions: a pinned download writes snapshots/<pin>/ and no refs/main, so
    the main GGUF, the rung's companion and the card's extra file are each read at the pin. Read
    at "main" instead, a complete pinned rung would read absent forever."""
    card = pinned_companions
    q8, bf16 = rung(card, "q8_0"), rung(card, "bf16")
    add_cached_file(hub_cache, PINNED_REPO, PIN, "pc-q8_0.gguf")
    add_cached_file(hub_cache, PINNED_REPO, PIN, "vocoder-q8_0.gguf")
    assert nm.model_status("pinned-companion") == "absent"          # the extra file is missing
    assert accel._downloaded_quants(card) == set()

    add_cached_file(hub_cache, PINNED_REPO, PIN, "embeddings/alba.safetensors")
    assert nm.model_status("pinned-companion") == "ready"
    assert nm.model_status("pinned-companion", repo=q8.artifact) == "ready"
    assert nm.model_status("pinned-companion", repo=bf16.artifact) == "absent"
    assert accel._downloaded_quants(card) == {"q8_0"}

    # Op coverage reads the companion GGUF's header at the pin too.
    headers = {"pc-q8_0.gguf": {"q8_0"}, "vocoder-q8_0.gguf": {"f16"}}
    monkeypatch.setattr(accel.gguf_header, "read_header", lambda p: accel.gguf_header.GgufHeader(
        "x", frozenset(headers[os.path.basename(p)]), 1, frozenset(headers[os.path.basename(p)])))
    assert accel.weight_dtypes(card, "q8_0") == ("f16", "q8_0")


def test_a_pinned_rungs_redownload_asks_the_hub_only_for_what_is_missing_at_the_pin(
        hub_cache, pinned_companions, monkeypatch):
    import huggingface_hub
    add_cached_file(hub_cache, PINNED_REPO, PIN, "pc-q8_0.gguf")
    add_cached_file(hub_cache, PINNED_REPO, PIN, "embeddings/alba.safetensors")
    real = huggingface_hub.hf_hub_download
    asked = []

    def hub(repo, fname, revision=None, local_files_only=False):
        if local_files_only:
            return real(repo, fname, revision=revision, local_files_only=True)
        asked.append((repo, fname, revision))
        return add_cached_file(hub_cache, repo, PIN, fname)

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", hub)
    assert asyncio.run(nm.download("pinned-companion", _send)) == "ready"
    assert asked == [(PINNED_REPO, "vocoder-q8_0.gguf", PIN)]
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", real)
    assert nm.model_status("pinned-companion") == "ready"
