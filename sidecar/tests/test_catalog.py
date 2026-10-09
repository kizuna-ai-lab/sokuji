import glob
import os
import pathlib

import pytest

from sokuji_sidecar import catalog


def test_models_have_deployments_and_languages():
    for m in catalog.asr_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        for d in m.deployments:
            assert d.backend in ("native_asr", "native_asr_stream")
            assert d.tier in {"gpu-vulkan", "gpu-metal", "cpu"}


def test_system_has_a_cpu_floor():
    # GPU-only models (Granite/Voxtral) are allowed; the SYSTEM still always has a
    # CPU floor via Whisper / sense-voice.
    assert any(any(d.tier == "cpu" for d in m.deployments) for m in catalog.asr_models())


def test_model_ids_are_unique():
    ids = [m.id for m in catalog.asr_models()]
    assert len(ids) == len(set(ids))


def test_lookup_known_and_unknown():
    assert catalog.asr_model("sense-voice").name == "SenseVoice"
    assert catalog.asr_model("does-not-exist") is None


def test_language_regression_fixtures():
    # Frozen facts verified from HF model cards — must never silently regress.
    assert catalog.asr_model("sense-voice").languages == ("zh", "en", "ja", "ko", "yue")
    assert catalog.asr_model("whisper-large-v3").languages == ("multi",)


def test_every_asr_row_is_native_asr_gguf():
    for m in catalog.asr_models():
        for d in m.deployments:
            assert d.backend in ("native_asr", "native_asr_stream")
            repo, fname = catalog.split_artifact(d.artifact)
            assert repo.startswith("handy-computer/") and fname.endswith(".gguf")


def test_sense_voice_row_native_asr_q8():
    m = catalog.asr_model("sense-voice")
    assert m.recommended is False and m.sort_order == 130
    # full ladder now: default (q8_0, rank 2.0) first, then f16 (listed-only,
    # rank 0.5) / q6_k, q4_k_m (curated, 1.0) / q5_k_m (listed-only)
    assert m.deployments[0].compute_type == "q8_0" and m.deployments[0].rank == 2.0
    assert m.deployments[0].artifact == "handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf"
    ct_rank = {d.compute_type: d.rank for d in m.deployments}
    assert ct_rank == {"q8_0": 2.0, "f16": 0.5, "q6_k": 1.0, "q5_k_m": 0.5, "q4_k_m": 1.0}


def test_granite_language_regression():
    assert catalog.asr_model("granite-speech-4.1-2b").languages == ("en", "fr", "de", "es", "pt", "ja")
    assert catalog.asr_model("granite-speech-4.1-2b-plus").languages == ("en", "fr", "de", "es", "pt")


def test_qwen3_asr_row():
    m = catalog.asr_model("qwen3-asr-1.7b")
    assert m is not None
    assert m.languages == ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
                           "fr", "it", "pt", "ru", "th", "vi", "hi", "id")
    assert m.recommended is True
    assert m.sort_order == 40   # WER 1.61 rank
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("native_asr", "gpu-vulkan", "q4_k_m",
         "handy-computer/Qwen3-ASR-1.7B-gguf/Qwen3-ASR-1.7B-Q4_K_M.gguf")


def test_granite_speech_5_turboctc_row():
    # transcribe.cpp 0.2.4 (#159): Granite Speech 5.0 TurboCTC, Apache-2.0 (the -nc sibling
    # is CC-BY-NC-SA and deliberately absent). WER 1.33 slots it between granite 4.1 2B
    # (20, 1.29) and parakeet-tdt-1.1b (25, 1.38).
    m = catalog.asr_model("granite-speech-5.0-470m-turboctc")
    assert m is not None
    assert m.name == "Granite Speech 5.0 TurboCTC (470M)"
    assert m.languages == ("en",)
    assert m.recommended is False
    assert m.sort_order == 22
    assert m.graph_family == "granite_speech5_ctc"     # GGUF general.architecture, not "granite5_ctc"
    assert m.size_bytes == 505606496
    d = m.deployments[0]
    assert (d.backend, d.compute_type, d.artifact) == (
        "native_asr", "q8_0",
        "handy-computer/granite-speech-5.0-470m-turboctc-gguf/granite-speech-5.0-470m-turboctc-Q8_0.gguf")
    assert catalog.asr_model("granite-speech-5.0-470m-turboctc-nc") is None


def test_cohere_asr_row():
    m = catalog.asr_model("cohere-transcribe-03-2026")
    assert m is not None
    assert m.name == "Cohere Transcribe"
    assert m.languages == ("en", "de", "fr", "it", "es", "pt", "el",
                           "nl", "pl", "ar", "vi", "zh", "ja", "ko")
    assert m.recommended is True
    assert m.sort_order == 10         # WER 1.25: benchmark-best, sorted first
    # 2026-07-04: transcribe.cpp GGUF (author-validated Q4_K_M default) +
    # Phase E3 quality ladder: a q8_0 alt rung (rank 1.0) the resolver
    # upgrades to when the memory budget allows. Default-quant rows come
    # first so downloads/size_bytes key off the default.
    assert m.deployments[0].compute_type == "q4_k_m" and m.deployments[0].rank == 2.0
    assert m.deployments[0].artifact == ("handy-computer/cohere-transcribe-03-2026-gguf/"
                                         "cohere-transcribe-03-2026-Q4_K_M.gguf")
    ct_rank = {d.compute_type: d.rank for d in m.deployments}
    assert ct_rank == {"q4_k_m": 2.0, "f16": 0.5, "q8_0": 1.0, "q6_k": 1.0, "q5_k_m": 0.5}
    assert m.size_bytes == 1558162944


def test_roster_is_wer_ranked():
    ids = [m.id for m in catalog.asr_models()]
    assert ids[0] == "cohere-transcribe-03-2026"           # WER 1.25, benchmark best
    assert len(ids) == 67
    orders = [m.sort_order for m in catalog.asr_models()]
    assert orders == sorted(orders)                        # rows stay rank-ordered
    assert sum(1 for m in catalog.asr_models() if m.recommended) == 7


# transcribe-cpp 0.2.2 (2026-08-30): the three families that landed upstream
# after our 0.1.3 pin. Each needs the 0.2 runtime — 0.1.3 rejects the GGUFs.
def test_parakeet_primeline_row():
    m = catalog.asr_model("parakeet-primeline")
    assert m is not None
    assert m.name == "Parakeet Primeline (de)"
    v3 = catalog.asr_model("parakeet-tdt-0.6b-v3")
    assert m.languages == v3.languages        # a v3 fine-tune: same 25 languages
    assert m.recommended is False
    assert m.sort_order == 81                 # slotted right after its base v3
    assert m.deployments[0].backend == "native_asr"
    assert m.deployments[0].compute_type == "q8_0"
    assert m.deployments[0].artifact == ("handy-computer/parakeet-primeline-gguf/"
                                         "parakeet-primeline-Q8_0.gguf")
    assert m.size_bytes == 739508640


def test_moss_transcribe_diarize_row():
    m = catalog.asr_model("moss-transcribe-diarize")
    assert m is not None
    assert m.name == "MOSS Transcribe (0.9B)"
    assert m.languages == ("en", "zh")
    assert m.recommended is False
    assert m.sort_order == 85                 # WER 1.93 @ Q8_0
    assert m.deployments[0].backend == "native_asr"   # batch-only upstream
    assert m.deployments[0].compute_type == "q8_0"
    # Upstream capitalises this base name; the ladder ships BF16 too, which we
    # skip (F16 is the listed-only top rung everywhere else).
    assert m.deployments[0].artifact == ("handy-computer/moss-transcribe-diarize-gguf/"
                                         "MOSS-Transcribe-Diarize-Q8_0.gguf")
    assert m.size_bytes == 986900160
    ct_rank = {d.compute_type: d.rank for d in m.deployments}
    assert ct_rank == {"q8_0": 2.0, "f16": 0.5, "q6_k": 1.0, "q5_k_m": 0.5, "q4_k_m": 1.0}


def test_multitalker_parakeet_streaming_row():
    m = catalog.asr_model("multitalker-parakeet-streaming-0.6b-v1")
    assert m is not None
    assert m.name == "Parakeet Multitalker Streaming 0.6B (en)"
    assert m.languages == ("en",)
    assert m.recommended is False
    assert m.sort_order == 114                # WER 2.18 @ Q8_0
    d = m.deployments[0]
    assert d.backend == "native_asr_stream"
    assert d.compute_type == "q8_0"
    # The ROOT GGUF (single-speaker streaming), not the bundle/ one that embeds
    # the Sortformer diarizer — multitalker output is offline-API only upstream.
    assert d.artifact == ("handy-computer/multitalker-parakeet-streaming-0.6b-v1-gguf/"
                          "multitalker-parakeet-streaming-0.6b-v1-Q8_0.gguf")
    assert m.size_bytes == 734123712


def test_whisper_large_v3_turbo_sizes_match_the_2026_07_21_reupload():
    m = catalog.asr_model("whisper-large-v3-turbo")
    sizes = {d.compute_type: d.est_bytes for d in m.deployments}
    assert sizes == {"q8_0": 886381760, "f16": 1625935520, "q6_k": 692536928,
                     "q5_k_m": 619628128, "q4_k_m": 536069728}
    assert m.size_bytes == 886381760


def test_voxtral_realtime_row():
    m = catalog.asr_model("voxtral-mini-4b-realtime")
    assert m is not None
    assert m.name == "Voxtral Mini 4B Realtime"
    assert m.languages == ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko")
    assert m.recommended is True
    assert m.sort_order == 100           # WER 2.07 rank
    d = m.deployments[0]
    # Streaming twin: routes through asr_engine's streaming loop via the
    # session.stream() committed/tentative adapter.
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("native_asr_stream", "gpu-vulkan", "q4_k_m",
         "handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf/Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf")


def test_fun_asr_mlt_nano_row():
    m = catalog.asr_model("fun-asr-mlt-nano")
    assert m is not None and m.name == "Fun-ASR MLT Nano"
    assert m.recommended is True
    assert len(m.languages) == 31
    assert m.languages[:6] == ("zh", "en", "yue", "ja", "ko", "vi")
    # Q6_K default: the author's WER table shows q6_k (1.69) beating bf16 (1.74).
    assert m.deployments[0].compute_type == "q6_k" and m.deployments[0].rank == 2.0
    assert m.deployments[0].artifact == ("handy-computer/Fun-ASR-MLT-Nano-2512-gguf/"
                                         "Fun-ASR-MLT-Nano-2512-Q6_K.gguf")
    assert {d.compute_type for d in m.deployments} == {"q6_k", "f16", "q8_0", "q5_k_m", "q4_k_m"}


TTS_CARD_IDS = ("moss-tts-nano", "supertonic-3", "qwen3-tts-0.6b", "qwen3-tts-1.7b",
                "omnivoice-0.6b", "pocket-tts-en", "pocket-tts-de", "pocket-tts-es",
                "pocket-tts-it", "pocket-tts-pt",
                # 2026-09-03 batch
                "voxcpm1-0.5b", "voxcpm2", "irodori-tts-v4-small", "index-tts2.5",
                # 2026-10-06 roster expansion (sub-project A)
                "cosyvoice3",
                "fireredtts3-base",
                "moss-tts-local-1.5",
                "vibevoice-1.5b",
                "chatterbox",
                "chatterbox-turbo",
                "confucius4",
                "magpie-357m",
                "neutts-2e",
                "kugelaudio-0",
                "qwen3-tts-1.7b-customvoice",
                "irodori-tts-500m-v3",
                "irodori-tts-v4.1-anime",
                "higgs-audio-v3-4b",
                "fish-audio-s2-pro",
                "breeze-tts-2",
                # sub-project A, batch 4
                "audio8-tts-0.6b",
                "soprano-1.1-80m",
                "glm-tts",
                "outetts-1.0-1b",
                "echo-tts",
                "kitten-tts2",
                "voicetut-tts",
                # sub-project A, batch 5
                "miotts-1.7b",
                "lfm2.5-audio-en",
                "lfm2.5-audio-ja")

# The 2026-09-03 batch arrived CPU-ONLY and earned every tier the same evening
# (commit 2f2b28bc, after the per-family fleet run; catalog._TTS_TIER_OVERRIDES).
# The set is kept so the tier test below asserts that promotion explicitly, card by card.
NEW_2026_09_03_TTS_CARD_IDS = ("voxcpm1-0.5b", "voxcpm2", "irodori-tts-v4-small", "index-tts2.5")


def test_tts_models_are_the_native_tts_cards():
    # 68 rows -> 10, slice 4 (spec §5.4 corrected 2026-08-31): every ONNX/
    # sherpa/MLX backend and its cards died with the ONNX/sherpa/MLX stacks.
    # 10 -> 14 on 2026-09-03: four more audio.cpp families. From 2026-10-06 the roster grows
    # card by card; TTS_CARD_IDS is the one list each new card is added to.
    ids = [m.id for m in catalog.tts_models()]
    assert set(ids) == set(TTS_CARD_IDS)
    assert len(ids) == len(set(ids)) == len(TTS_CARD_IDS)


def test_tts_models_have_deployments_languages_and_family():
    for m in catalog.tts_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        assert m.family, f"{m.id} has no family"
        for d in m.deployments:
            assert d.backend == "native_tts"
            # R19 follow-up / R25 (task 8): every family was GB10-Vulkan-
            # validated. R36 (slice-5b task 10): every family also gained
            # gpu-metal back, on M4 real-hardware evidence (catalog.
            # _TTS_TIER_OVERRIDES) — so every deployment is cpu, gpu-vulkan,
            # or gpu-metal.
            assert d.tier in ("cpu", "gpu-vulkan", "gpu-metal")


def _assert_tts_artifacts(m):
    """Every rung's artifact is "<repo>/<path>.gguf" with no empty segment, from audio.cpp's
    official mirror or a third-party repo pinned in PINNED_REVISIONS (ruling 4); every
    companion is a non-empty path inside that repo with its byte count."""
    for d in m.deployments:
        repo, path = catalog.split_artifact(d.artifact)
        assert path and path.endswith(".gguf"), (m.id, d.artifact)
        assert "" not in path.split("/"), (m.id, d.artifact)
        assert repo == catalog._AUDIOCPP_GGUF_REPO or repo in catalog.PINNED_REVISIONS, (m.id, repo)
        for rel, size in d.companions:
            assert rel and not set(rel.split("/")) & {"", ".", ".."}, (m.id, rel)
            assert size > 0, (m.id, rel)


def test_tts_artifacts_are_gguf_files_from_the_mirror_or_a_pinned_repo():
    for m in catalog.tts_models():
        _assert_tts_artifacts(m)
    # The fourteen cards that predate third-party hosting all come from the official mirror,
    # each rung a single file.
    for mid in PRE_A_TTS_CARD_IDS:
        for d in catalog.tts_model(mid).deployments:
            assert d.artifact.startswith("audio-cpp/audio.cpp-gguf/"), (mid, d.artifact)
            assert d.companions == (), (mid, d.artifact)


def test_the_artifact_rule_accepts_a_pinned_root_card_and_refuses_an_unpinned_one():
    def card(repo):
        return catalog._tts_gguf_row("x", "X", ("en",), "x_family", "",
                                     {"q8_0": ("x-q8_0.gguf", 1)}, default_quant="q8_0", order=99,
                                     repo=repo)
    _assert_tts_artifacts(card("WalkingCat/Soprano-1.1-80M-GGUF"))
    with pytest.raises(AssertionError):
        _assert_tts_artifacts(card("someone/unpinned-gguf"))


def test_tts_system_has_cpu_floor_and_unique_ids():
    # Every card keeps a cpu floor even after task 8's gpu-vulkan and task
    # 10's gpu-metal restorations (_TTS_TIER_OVERRIDES always includes "cpu"
    # alongside the two GPU tiers).
    ids = [m.id for m in catalog.tts_models()]
    assert len(ids) == len(set(ids)), "duplicate tts model ids"
    for m in catalog.tts_models():
        assert any(d.tier == "cpu" for d in m.deployments), f"{m.id} has no cpu floor"


def _assert_tts_ladder(m):
    """The two-rung shape every TTS card shares: one rank-2.0 default, any alt at rank 1.0,
    and every quant on one and the same tier set, with a cpu floor. Which set is pinned per
    card: every tier for the fourteen that predate sub-project A, cpu only for a card added
    since until the fleet has run it (R19)."""
    by_ct = {}
    for d in m.deployments:
        by_ct.setdefault(d.compute_type, set()).add(d.tier)
    want = by_ct[m.deployments[0].compute_type]
    assert "cpu" in want, (m.id, sorted(want))
    for ct, tiers in by_ct.items():
        assert tiers == want, (m.id, ct, sorted(tiers))
    ranks = {d.compute_type: d.rank for d in m.deployments}
    assert list(ranks.values()).count(2.0) == 1, m.id
    assert set(ranks.values()) <= {1.0, 2.0}, m.id


def test_tts_quant_ladder_shape():
    for m in catalog.tts_models():
        _assert_tts_ladder(m)
    # Every card that predates sub-project A runs on every lane: no family among them is a
    # tier exception (R29 for pocket_tts, R36 for gpu-metal, 2f2b28bc for the 2026-09-03 four).
    for mid in PRE_A_TTS_CARD_IDS:
        m = catalog.tts_model(mid)
        for ct in {d.compute_type for d in m.deployments}:
            assert {d.tier for d in m.deployments if d.compute_type == ct} == \
                {"cpu", "gpu-vulkan", "gpu-metal"}, (mid, ct)


def test_every_card_added_in_sub_project_a_starts_on_the_cpu_tier():
    """A new card starts on the CPU tier, whatever its family's tiers, and gains a GPU tier only
    for a lane the fleet has run that card on (R19, per card): a card of a family that already
    has GPU tiers is no exception."""
    assert len(A_TTS_CARD_IDS) == len(TTS_CARD_IDS) - len(PRE_A_TTS_CARD_IDS) > 0
    inheriting = [mid for mid in A_TTS_CARD_IDS
                  if catalog.tts_model(mid).family in catalog._TTS_TIER_OVERRIDES]
    assert inheriting                       # the rule is exercised, not vacuous
    for mid in A_TTS_CARD_IDS:
        assert {d.tier for d in catalog.tts_model(mid).deployments} == {"cpu"}, mid


def test_a_cards_own_tiers_override_its_familys():
    def card(**kw):
        return catalog._tts_gguf_row("x", "X", ("en",), "qwen3_tts", "X-GGUF",
                                     {"q8_0": ("x-q8_0.gguf", 1), "bf16": ("x-bf16.gguf", 2)},
                                     default_quant="q8_0", order=99, **kw)
    assert {d.tier for d in card().deployments} == set(catalog._TTS_TIER_OVERRIDES["qwen3_tts"])
    own = card(tiers=catalog._TTS_TIERS)
    _assert_tts_ladder(own)
    assert {d.tier for d in own.deployments} == {"cpu"}


def test_the_ladder_rule_accepts_a_cpu_only_new_family_and_refuses_mixed_tiers():
    new = catalog._tts_gguf_row("x", "X", ("en",), "some_unvalidated_family", "X-GGUF",
                                {"q8_0": ("x-q8_0.gguf", 1), "orig": ("x-orig.gguf", 2)},
                                default_quant="q8_0", order=99)
    _assert_tts_ladder(new)
    assert {d.tier for d in new.deployments} == {"cpu"}
    mixed = catalog.TtsModel("m", "M", ("en",), (
        catalog.Deployment("native_tts", "gpu-vulkan", "q8_0", "audio-cpp/audio.cpp-gguf/M/m-q8_0.gguf", 2.0),
        catalog.Deployment("native_tts", "cpu", "q8_0", "audio-cpp/audio.cpp-gguf/M/m-q8_0.gguf", 2.0),
        catalog.Deployment("native_tts", "cpu", "bf16", "audio-cpp/audio.cpp-gguf/M/m-bf16.gguf", 1.0)),
        family="voxcpm2", graph_family="voxcpm2")
    with pytest.raises(AssertionError):
        _assert_tts_ladder(mixed)


def test_pocket_tts_gpu_vulkan_r29():
    # Ruling R29 (task-8 second fix round, superseding R28): R28 had briefly
    # pinned pocket_tts cpu-only on a single, not-apples-to-apples,
    # cross-session comparison. A controlled re-measurement (warm-up call +
    # 4 timed same-shape runs each device, catalog._TTS_TIER_OVERRIDES' own
    # comment has the numbers) found Vulkan 5-9x FASTER, not slower -- no
    # measurement in either round had cpu winning -- so pocket_tts gains
    # gpu-vulkan like the other four GB10-validated families (and, per R36,
    # gpu-metal too).
    for mid in ("pocket-tts-en", "pocket-tts-de", "pocket-tts-es", "pocket-tts-it", "pocket-tts-pt"):
        m = catalog.tts_model(mid)
        assert m is not None and m.family == "pocket_tts"
        assert {d.tier for d in m.deployments} == {"cpu", "gpu-vulkan", "gpu-metal"}, mid


def test_tts_tier_overrides_default_is_cpu_only_for_unknown_family():
    # catalog._TTS_TIER_OVERRIDES.get(family, catalog._TTS_TIERS) is the exact
    # lookup _tts_gguf_row uses -- a family with no override entry (any future
    # new family, until it's explicitly validated) must fall through to the
    # cpu-only default, not silently inherit some other family's tiers.
    assert catalog._TTS_TIER_OVERRIDES.get("some_future_unvalidated_family",
                                            catalog._TTS_TIERS) == ("cpu",)
    assert "some_future_unvalidated_family" not in catalog._TTS_TIER_OVERRIDES


# Measured CPU peaks (card -> (rung measured, peak RSS in kB as `/usr/bin/time -v` reports it,
# which is KiB)), product-shaped (ruling 2026-10-09): a warm-up sentence, then a 22-word one (40
# Japanese characters for the Japanese cards, 15 Arabic words for VoiceTut), bare, and again in
# another process with a 3.1 s reference clip for a card that clones; the larger peak is the one
# recorded. A card whose peak is above 1.2x its rung's est_bytes, or at most 0.9x it, carries
# ram_factor = ceil(peak / est_bytes, to one decimal); every other card keeps 1.0.
MEASURED_CPU_PEAKS_KB = {
    "cosyvoice3": ("q8_0", 2652720),                  # with the clip (voice required)
    "fireredtts3-base": ("q8_0", 4631620),            # with the clip (voice required)
    "moss-tts-local-1.5": ("q8_0", 18521960),         # with the clip; bare 13198220
    "vibevoice-1.5b": ("q8_0", 4066124),              # with the clip; bare 3863200
    "chatterbox": ("q8_0", 2914832),                  # with the clip (voice required)
    "chatterbox-turbo": ("q8_0", 4338656),            # bare (no clone path)
    "confucius4": ("orig", 6776376),                  # with the clip (voice required)
    "magpie-357m": ("q8_0", 1312452),                 # bare (no clone path)
    "neutts-2e": ("orig", 2539620),                   # bare (no clone path)
    "kugelaudio-0": ("q8_0", 10104348),               # bare (no clone path)
    "qwen3-tts-1.7b-customvoice": ("q8_0", 4074512),  # its default preset (no clone path)
    "irodori-tts-500m-v3": ("q8_0", 2720656),         # with the clip; bare 2614688
    "irodori-tts-v4.1-anime": ("q8_0", 2927036),      # with the clip; bare 2781980
    "higgs-audio-v3-4b": ("q8_0", 6369076),           # with the clip; bare 5487188
    "fish-audio-s2-pro": ("q8_0", 8771944),           # with the clip; bare 8614776
    "breeze-tts-2": ("q8_0", 5355484),                # with the clip (voice required)
    "audio8-tts-0.6b": ("q8_0", 2948800),             # bare; with the clip 2867508
    "soprano-1.1-80m": ("q8_0", 544772),              # bare (no clone path)
    "glm-tts": ("q8_0", 5509516),                     # with the clip (voice required)
    "outetts-1.0-1b": ("q8_0", 4216684),              # with the clip; bare 3036760
    "echo-tts": ("q8_0", 6110784),                    # with the clip (voice required)
    "kitten-tts2": ("q8_0", 4353760),                 # with the clip; bare 4265356
    "voicetut-tts": ("q8_0", 1816688),                # with the clip (voice required)
    "miotts-1.7b": ("q8_0", 4687080),                 # with the clip (voice required)
    "lfm2.5-audio-en": ("q8_0", 1697700),             # bare (no clone path)
    "lfm2.5-audio-ja": ("q8_0", 1704176),             # bare (no clone path)
}


def _expected_ram_factor(mid):
    rung, peak_kb = MEASURED_CPU_PEAKS_KB[mid]
    est = next(d.est_bytes for d in catalog.tts_model(mid).deployments
               if d.tier == "cpu" and d.compute_type == rung)
    peak = peak_kb * 1024
    if est * 9 < peak * 10 <= est * 12:              # above 0.9x and not above 1.2x
        return 1.0
    return -(-peak * 10 // est) / 10                 # ceil to one decimal, integer arithmetic


def test_ram_factor_pins_each_card_to_its_measured_cpu_peak():
    assert set(MEASURED_CPU_PEAKS_KB) <= set(TTS_CARD_IDS)
    for mid in MEASURED_CPU_PEAKS_KB:
        assert catalog.tts_model(mid).ram_factor == _expected_ram_factor(mid), mid


def test_only_a_card_measured_above_1_2x_or_at_most_0_9x_carries_a_factor():
    carrying = {m.id for m in catalog.tts_models() if m.ram_factor != 1.0}
    assert carrying == {mid for mid in MEASURED_CPU_PEAKS_KB if _expected_ram_factor(mid) != 1.0}
    assert carrying                                   # the rule is exercised, not vacuous
    assert set(catalog._TTS_RAM_FACTORS) == carrying  # one table, nothing set elsewhere
    for mid, f in catalog._TTS_RAM_FACTORS.items():
        assert (f > 1.2 or f <= 0.9) and round(f, 1) == f, mid
    # both sides of the rule are populated: cards that need more than their file and less
    assert any(f > 1.2 for f in catalog._TTS_RAM_FACTORS.values())
    assert any(f <= 0.9 for f in catalog._TTS_RAM_FACTORS.values())


def test_a_measured_card_between_0_9x_and_1_2x_keeps_1_0():
    # fireredtts3 (1.13x), kugelaudio (1.06x), breeze (1.08x), glm (1.10x) and lfm2.5-audio
    # (0.95x, 0.96x) are measured but inside the band where a flat 1.0 is close enough.
    for mid in ("fireredtts3-base", "kugelaudio-0", "breeze-tts-2", "glm-tts", "lfm2.5-audio-en",
                "lfm2.5-audio-ja"):
        assert mid in MEASURED_CPU_PEAKS_KB and mid not in catalog._TTS_RAM_FACTORS
        assert catalog.tts_model(mid).ram_factor == 1.0, mid


def test_every_other_card_estimates_its_memory_from_the_file_alone():
    for m in [*catalog.asr_models(), *catalog.translate_models()]:
        assert m.ram_factor == 1.0, m.id
    unmeasured = set(TTS_CARD_IDS) - set(MEASURED_CPU_PEAKS_KB)
    assert unmeasured                                 # cards with no recorded peak
    for mid in unmeasured:
        assert catalog.tts_model(mid).ram_factor == 1.0, mid


def test_omnivoice_card_shape():
    m = catalog.tts_model("omnivoice-0.6b")
    assert m is not None
    assert m.family == "omnivoice"
    # The app's 74 codes less su, which OmniVoice's language_map.inc has under no id or name
    # (2026-10-09); ar and ne reach it as arb and npi (sk_tts.cpp).
    assert m.languages == (
        "af", "am", "ar", "az", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es",
        "et", "fa", "fi", "fil", "fr", "gl", "gu", "he", "hi", "hr", "hu", "id", "is", "it", "ja",
        "jv", "ka", "kk", "km", "kn", "ko", "lb", "lo", "lt", "lv", "mk", "ml", "mn", "mr", "ms",
        "mt", "my", "ne", "nl", "no", "pl", "ps", "pt", "ro", "ru", "si", "sk", "sl", "so", "sq",
        "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "uz", "vi", "yue", "zh")
    assert "su" not in m.languages and "multi" not in m.languages
    assert m.clones
    assert m.transcript_required is True   # ref_text mandatory (also qwen3_tts, R15(s4))
    assert m.named_voices is False         # no discoverable presets
    assert m.streaming is True             # omnivoice + supertonic are the streaming families (R5)
    assert m.sample_rate == 24000
    cts = {d.compute_type for d in m.deployments}
    assert cts == {"q8_0", "bf16"}
    default = next(d for d in m.deployments if d.rank == 2.0)
    assert default.compute_type == "q8_0"
    assert default.artifact == "audio-cpp/audio.cpp-gguf/OmniVoice-GGUF/omnivoice-q8_0.gguf"
    assert m.size_bytes == 1_350_288_416


def test_omnivoice_license():
    # Non-commercial license descriptor (issue #351 follow-up): the catalog
    # carries it as DATA so the renderer/downloader can gate on it generically
    # rather than special-casing "omnivoice" by id.
    m = catalog.tts_model("omnivoice-0.6b")
    assert m is not None
    lic = m.license
    assert lic is not None
    assert lic.spdx == "CC-BY-NC-4.0"
    assert lic.non_commercial is True
    assert lic.source_repo == "audio-cpp/audio.cpp-gguf"
    assert lic.attribution == "k2-fsa/OmniVoice"
    assert lic.requires_consent is True     # a License descriptor gates by default
    assert catalog.license_dict(m) == {
        "spdx": "CC-BY-NC-4.0",
        "name": "Creative Commons Attribution-NonCommercial 4.0 International",
        "url": "https://creativecommons.org/licenses/by-nc/4.0/",
        "nonCommercial": True,
        "requiresConsent": True,
        "sourceRepo": "audio-cpp/audio.cpp-gguf",
        "attribution": "k2-fsa/OmniVoice",
    }
    # Every other card has no license — license_dict is a plain pass-through
    # None, not a default-constructed License.
    assert catalog.tts_model("moss-tts-nano").license is None
    assert catalog.license_dict(catalog.tts_model("moss-tts-nano")) is None


def test_new_2026_09_03_tts_cards_carry_every_tier():
    # These four shipped cpu-only for as long as no lane had been measured. Both
    # accelerator lanes have been now (GB10 Vulkan and an M4's Metal, with the
    # native-1.0.2 wheels), so they carry the same three tiers as every other
    # family: a tier list states what CAN run. Whether a given machine SHOULD use
    # its GPU, and at which quant, is the planner's and the recommendation's call
    # (jiangzhuo's ruling, 2026-09-03) -- not something a family opts out of by
    # having a slow lane, which would only push that machine onto a slower one.
    for mid in NEW_2026_09_03_TTS_CARD_IDS:
        m = catalog.tts_model(mid)
        assert m is not None, mid
        assert catalog._TTS_TIER_OVERRIDES[m.family] == ("gpu-vulkan", "gpu-metal", "cpu"), mid
        assert {d.tier for d in m.deployments} == {"gpu-vulkan", "gpu-metal", "cpu"}, mid


def test_voxcpm_cards_shape():
    # Both VoxCPMs stream and clone from an OPTIONAL reference clip with no
    # transcript, and neither exposes built-in voices. Their sample rates are the
    # two outliers of the roster: 16 kHz for v1, 48 kHz for v2.
    v1 = catalog.tts_model("voxcpm1-0.5b")
    assert v1 is not None
    assert v1.family == "voxcpm1"
    assert v1.languages == ("zh", "en", "ja", "ko")
    assert v1.streaming is True and v1.clones is True
    assert v1.transcript_required is False and v1.named_voices is False
    assert v1.sample_rate == 16000
    assert v1.recommended is False
    # The repo ships exactly one file for voxcpm1 — a single-rung card, like supertonic.
    assert {d.compute_type for d in v1.deployments} == {"q8_0"}
    assert v1.size_bytes == 847_888_032

    v2 = catalog.tts_model("voxcpm2")
    assert v2 is not None
    assert v2.family == "voxcpm2"
    assert len(v2.languages) == 30 and "ja" in v2.languages and "zh" in v2.languages
    # Tagalog as the app's code (the spec's "tl"); the engine reads no language.
    assert "fil" in v2.languages and "tl" not in v2.languages
    # model_specs/voxcpm2.json's 31st entry is the non-code "zh dialects"; these
    # tuples carry language CODES the renderer matches on, so it is dropped.
    assert all(" " not in code for code in v2.languages)
    assert v2.streaming is True and v2.clones is True
    assert v2.transcript_required is False and v2.named_voices is False
    assert v2.sample_rate == 48000
    assert {d.compute_type for d in v2.deployments} == {"q8_0", "bf16"}
    assert next(d for d in v2.deployments if d.rank == 2.0).compute_type == "q8_0"
    assert v2.size_bytes == 2_955_000_480


def test_irodori_card_is_japanese_only_and_offline():
    m = catalog.tts_model("irodori-tts-v4-small")
    assert m is not None
    assert m.family == "irodori_tts"
    assert m.languages == ("ja",)      # audio.cpp throws for any other language
    assert m.streaming is False        # offline-only per model_specs/irodori_tts.json
    assert m.clones is True and m.transcript_required is False
    assert m.named_voices is False
    assert m.sample_rate == 48000
    assert {d.compute_type for d in m.deployments} == {"q8_0", "f16"}
    assert m.size_bytes == 1_368_991_360


def test_index_tts2_card_and_license():
    m = catalog.tts_model("index-tts2.5")
    assert m is not None
    assert m.family == "index_tts2"
    assert m.languages == ("zh", "en", "ja", "es", "ar")   # the 2.5 checkpoint's five
    assert m.streaming is False
    # Needs the clip, not a transcript of it: the card's voice_required (its family's rule).
    assert m.clones is True and m.transcript_required is False
    assert m.voice_required is True
    assert m.named_voices is False
    assert m.sample_rate == 22050
    assert m.size_bytes == 3_502_955_328

    lic = m.license
    assert lic is not None
    # NOT an OSI license and not in the SPDX list, hence LicenseRef-. It permits
    # commercial use below a MAU/revenue ceiling, so non_commercial must stay False
    # (the modal would otherwise tell the user something untrue) while
    # requires_consent still raises the download gate.
    assert lic.spdx == "LicenseRef-bilibili-Model-Use-License"
    assert lic.non_commercial is False
    assert lic.requires_consent is True
    assert catalog.license_dict(m)["requiresConsent"] is True
    assert catalog.license_dict(m)["nonCommercial"] is False


def test_index_tts2_is_the_only_new_card_with_a_license():
    for mid in ("voxcpm1-0.5b", "voxcpm2", "irodori-tts-v4-small"):
        m = catalog.tts_model(mid)
        assert m is not None and m.license is None, mid
        assert catalog.license_dict(m) is None, mid


def test_tts_moss_nano_is_offline_cloning():
    # R5: MOSS loses streaming (audio.cpp's moss_tts_nano is offline-only) —
    # a real behaviour change from the old ONNX backend's streaming support.
    m = catalog.tts_model("moss-tts-nano")
    assert m is not None
    assert m.family == "moss_tts_nano"
    assert m.streaming is False and m.clones is True
    assert m.named_voices is False   # sk_tts_presets() == [] for moss (Task 2's own CTest)
    assert m.recommended is True     # stays per spec — the MOSS product question is out of scope here
    assert m.sample_rate == 48000


def test_tts_model_unknown_returns_none():
    assert catalog.tts_model("does-not-exist") is None


def test_resolve_tts_card_static_id_returns_catalog_row():
    assert catalog.resolve_tts_card("moss-tts-nano") is catalog.tts_model("moss-tts-nano")


def test_resolve_tts_card_unknown_id_returns_none():
    # The sherpa-onnx ad-hoc community-voice synthesis (piper/vits/matcha/
    # kokoro/icefall) died with sherpa_tts.py (slice 4) — every unknown id,
    # "piper"-flavored or not, is now just None.
    assert catalog.resolve_tts_card("csukuangfj/vits-piper-xx-yy") is None
    assert catalog.resolve_tts_card("totally-unknown-xyz") is None


def test_only_translategemma_uses_the_gemma_prompt_family():
    """Pins the renderer's hardcoded copy of this family.

    TranslateGemma's chat template assembles the whole instruction itself and
    raises on a system role, so GemmaStrategy discards `system_prompt` and the
    settings UI must not offer a custom-prompt box for it (#526). The renderer
    cannot read `prompt_family` -- it is not on the wire -- so it pins the ids in
    TEMPLATE_OWNS_PROMPT (src/lib/local-inference/native/nativeCatalog.ts).

    If this fails because a new gemma-family card was added, update that set in
    the same change, or the new card will silently offer a prompt box that gets
    thrown away.
    """
    gemma = {m.id for m in catalog.TRANSLATE_MODELS if m.prompt_family == "gemma"}
    assert gemma == {"translategemma-4b"}


def test_llm_translate_rows_shape():
    m = catalog.translate_model("translategemma-4b")
    assert m is not None
    quants = {d.compute_type for d in m.deployments}
    assert quants == {"q4_k_m", "q8_0"}
    tiers = {(d.compute_type, d.tier) for d in m.deployments}
    for q in quants:
        assert {(q, "gpu-metal"), (q, "gpu-vulkan"), (q, "cpu")} <= tiers
    # gpu-cuda died with slice 3 (R2): no probe ever reports a "cuda" device
    # kind, so the tier was unreachable.
    assert not any(d.tier == "gpu-cuda" for d in m.deployments)
    # default quant (rank 2.0) is q4_k_m for the 4B card
    default = max(m.deployments, key=lambda d: d.rank)
    assert default.compute_type == "q4_k_m"
    assert all(d.backend == "native_translate" for d in m.deployments)
    assert m.prompt_family == "gemma"
    # same artifact across tiers of one quant (a GGUF is tier-agnostic)
    per_quant = {q: {d.artifact for d in m.deployments if d.compute_type == q}
                 for q in quants}
    assert all(len(a) == 1 for a in per_quant.values())


def test_llm_vulkan_tier_ranks_above_cpu():
    # gpu-vulkan (TIER_RANK 2.5) resolves above cpu (1.0). Ordering comes from
    # accel.TIER_RANK, not the order of the tiers tuple in _llm_translate_row.
    # gpu-metal is filtered out (no Apple/Metal on this machine); gpu-cuda no
    # longer exists as a deployment row at all (R2).
    from sokuji_sidecar import accel
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      apple_silicon=False,
                      installed=frozenset({"native_translate"}),
                      fingerprint="t", tc_kinds=("cpu", "vulkan"),
                      gpus=(("vulkan", "NVIDIA x", 12288),))
    plans = accel.resolve_deployments(catalog.translate_model("translategemma-4b"), m)
    seen = []
    for p in plans:
        if p.tier not in seen:
            seen.append(p.tier)
    assert seen == ["gpu-vulkan", "cpu"]


def test_small_qwen_defaults_to_q8():
    for mid in ("qwen2.5-0.5b", "qwen3-0.6b"):
        m = catalog.translate_model(mid)
        default = max(m.deployments, key=lambda d: d.rank)
        assert default.compute_type == "q8_0", mid
        assert all(d.backend == "native_translate" for d in m.deployments)
        assert m.prompt_family == "qwen"


def test_hunyuan_backend_and_no_fp8():
    for mid in ("hy-mt2-1.8b", "hy-mt2-7b", "hy-mt15-1.8b", "hy-mt15-7b"):
        m = catalog.translate_model(mid)
        assert all(d.backend == "native_translate" for d in m.deployments)
        assert all(d.compute_type in ("q4_k_m", "q8_0") for d in m.deployments)
        assert m.prompt_family == "hunyuan"


def test_gguf_artifact_naming():
    assert catalog._gguf_artifact("qwen3.5-2b", "q4_k_m") == \
        "unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf"
    # tencent filename case quirk is real upstream data: 7B Q8 is `HY-MT2-...`
    # while every other tencent GGUF filename in the table is `Hy-MT2-...`.
    assert catalog._gguf_artifact("hy-mt2-7b", "q8_0") == \
        "tencent/Hy-MT2-7B-GGUF/HY-MT2-7B-Q8_0.gguf"
    assert catalog._gguf_artifact("hy-mt2-7b", "q4_k_m") == \
        "tencent/Hy-MT2-7B-GGUF/Hy-MT2-7B-Q4_K_M.gguf"


def test_split_artifact():
    # 3-segment (deep) path: repo is the first two segments, filename is the rest.
    assert catalog.split_artifact(
        "mradermacher/translategemma-4b-it-GGUF/translategemma-4b-it.Q4_K_M.gguf") == (
        "mradermacher/translategemma-4b-it-GGUF", "translategemma-4b-it.Q4_K_M.gguf")
    # plain 2-segment repo id: no filename.
    assert catalog.split_artifact("Qwen/Qwen3-0.6B-GGUF") == (
        "Qwen/Qwen3-0.6B-GGUF", None)
    # deep path (filename itself contains a slash, e.g. an onnx/ subdir).
    assert catalog.split_artifact("org/repo/onnx/model.onnx") == ("org/repo", "onnx/model.onnx")


def test_all_translate_backends_installed_names():
    # Genuinely needs the sokuji-native wheel: accel._installed() only ever
    # reports native_translate when the real probe finds it importable. The
    # importorskip guards a dev checkout without the wheel; CI's sidecar-tests
    # installs it from requirements.txt, so this runs there.
    pytest.importorskip("sokuji_native")
    from sokuji_sidecar import accel
    installed = accel._installed()
    assert "native_translate" in installed
    for old in ("qwen_translate", "qwen35_translate", "hunyuan_translate",
                "gemma_translate", "opus_translate", "llamacpp_qwen",
                "llamacpp_hunyuan", "llamacpp_gemma", "ct2_opus_translate"):
        assert old not in installed


def test_translate_row_count_and_no_opus():
    # The 13 Opus-MT rows are gone (slice 3): 11 GGUF LLM cards remain (9 + Qwen 3.5
    # 4B and EuroLLM 1.7B, 2026-09-03), all on
    # native_translate.
    models = catalog.translate_models()
    assert len(models) == 11
    assert all(d.backend == "native_translate" for m in models for d in m.deployments)
    assert catalog.translate_model("opus-mt-ja-en") is None


def test_tts_pocket_cards_have_load_language_and_only_english_has_presets():
    # R9: model_specs/pocket_tts.json's OWN package list only wires the
    # "alba" preset into the english package — german/italian/portuguese/
    # spanish are clone-only BY DESIGN, even though the audio-cpp/
    # audio.cpp-gguf mirror happens to also host (verified different, not
    # copy-pasted) embeddings under those language directories too.
    langs = {"pocket-tts-en": "english", "pocket-tts-de": "german",
             "pocket-tts-es": "spanish", "pocket-tts-it": "italian",
             "pocket-tts-pt": "portuguese"}
    for mid, load_language in langs.items():
        m = catalog.tts_model(mid)
        assert m is not None and m.family == "pocket_tts"
        assert m.load_language == load_language
        assert m.clones is True and m.streaming is False
        if mid == "pocket-tts-en":
            assert m.named_voices is True
            assert m.extra_files == (("embeddings/alba.safetensors", 6194424),)
        else:
            assert m.named_voices is False
            assert m.extra_files == ()


def test_tts_languages_cover_the_renderer_set():
    langs = set()
    for m in catalog.tts_models():
        langs.update(m.languages)
    # Languages the renderer's NATIVE_TTS_BY_LANG offered must all survive.
    assert {"en", "de", "es", "fr", "it", "ru", "zh"} <= langs


def test_every_model_exposes_size_bytes_field():
    # size_bytes is a _ModelBase field, reachable on all three model kinds even
    # though only AsrModel/TranslateModel/TtsModel are constructed directly.
    for m in catalog.asr_models() + catalog.translate_models() + catalog.tts_models():
        assert hasattr(m, "size_bytes"), f"{m.id} missing size_bytes"
        assert isinstance(m.size_bytes, int)


def test_size_bytes_regression_values():
    # Frozen facts verified 2026-09-01 via the HF tree API (audio-cpp/
    # audio.cpp-gguf) — must never silently regress.
    assert catalog.asr_model("sense-voice").size_bytes == 252684608
    assert catalog.tts_model("moss-tts-nano").size_bytes == 193337984
    assert catalog.tts_model("supertonic-3").size_bytes == 312784196
    # pocket-tts-en's size includes its embeddings/alba.safetensors sidecar.
    assert catalog.tts_model("pocket-tts-en").size_bytes == 127856704 + 6194424
    assert catalog.tts_model("pocket-tts-de").size_bytes == 127857184


def test_voice_capability_map():
    cap = catalog.voice_capability
    assert cap(catalog.tts_model("moss-tts-nano")) == {"builtin": "none", "custom": "clip",
                                                       "required": False}
    assert cap(catalog.tts_model("supertonic-3")) == {"builtin": "named", "custom": "none",
                                                      "required": False}
    assert cap(catalog.tts_model("pocket-tts-en")) == {"builtin": "named", "custom": "clip",
                                                       "required": False}
    assert cap(catalog.tts_model("pocket-tts-de")) == {"builtin": "none", "custom": "clip",
                                                       "required": False}
    assert cap(catalog.tts_model("omnivoice-0.6b")) == {"builtin": "none", "custom": "clip",
                                                        "required": True,
                                                        "transcriptRequired": True}


def test_voice_required_is_its_own_axis_not_a_shape_inference():
    """The bug this axis exists to kill: `builtin == 'none' and custom == 'clip'` is the
    shape of BOTH a family that must be handed a clip and one that speaks fine without one,
    so the renderer's old shape-based pre-init gate disabled TTS for the second group.
    These six cards all share that shape and split 3/3 on `required`."""
    cap = catalog.voice_capability
    same_shape = ("moss-tts-nano", "voxcpm1-0.5b", "voxcpm2", "irodori-tts-v4-small",
                  "omnivoice-0.6b", "index-tts2.5")
    for mid in same_shape:
        c = cap(catalog.tts_model(mid))
        assert (c["builtin"], c["custom"]) == ("none", "clip"), mid

    not_required = ("moss-tts-nano", "voxcpm1-0.5b", "voxcpm2", "irodori-tts-v4-small",
                    "supertonic-3", "pocket-tts-en", "pocket-tts-de")
    required = ("qwen3-tts-0.6b", "qwen3-tts-1.7b", "omnivoice-0.6b", "index-tts2.5")
    for mid in not_required:
        assert cap(catalog.tts_model(mid))["required"] is False, mid
    for mid in required:
        assert cap(catalog.tts_model(mid))["required"] is True, mid

    # Every card carries the axis — absent must mean "sidecar too old", never "false".
    for m in catalog.tts_models():
        assert "required" in cap(m), m.id


# The fourteen cards that predate sub-project A, kept apart from TTS_CARD_IDS, which every
# 2026-10-06 card is appended to: assertions true only of these fourteen iterate this tuple.
PRE_A_TTS_CARD_IDS = TTS_CARD_IDS[:14]
# Every card sub-project A added: the rest of TTS_CARD_IDS.
A_TTS_CARD_IDS = TTS_CARD_IDS[14:]


def test_voice_required_families_is_the_single_source_of_truth():
    """A card's voice_required defaults to its family's rule (catalog.VOICE_REQUIRED_FAMILIES)
    and is what both the wire field and tts_backend's R16 gate read (through
    PlanConfig.voice_required), so the sidecar can never refuse a synth the renderer had
    already decided was fine, or vice versa."""
    from sokuji_sidecar import tts_backend
    assert tts_backend._VOICE_REQUIRED_FAMILIES is catalog.VOICE_REQUIRED_FAMILIES
    assert catalog.VOICE_REQUIRED_FAMILIES == {"qwen3_tts", "omnivoice", "index_tts2", "cosyvoice3", "fireredtts3", "chatterbox", "confucius4_tts", "glm_tts", "echo_tts", "miotts"}
    for m in catalog.tts_models():
        assert catalog.voice_capability(m)["required"] is m.voice_required, m.id
    # Every card that predates per-card overrides follows its family's rule.
    assert len(PRE_A_TTS_CARD_IDS) == 14
    for mid in PRE_A_TTS_CARD_IDS:
        m = catalog.tts_model(mid)
        assert m.voice_required is (m.family in catalog.VOICE_REQUIRED_FAMILIES), mid


def test_the_fourteen_existing_cards_clone_as_their_family_does():
    """The backend reports the CARD's clones to the renderer (PlanConfig.tts_clones), where it
    used to report the family's. Pinned equal for every card that predates the override, so
    nothing on the wire moves for them: native/src/sk_tts.cpp's kFamilies has every family
    clone except supertonic."""
    from sokuji_sidecar import planner
    for mid in PRE_A_TTS_CARD_IDS:
        m = catalog.tts_model(mid)
        assert m.clones is (m.family != "supertonic"), mid
        assert planner._plan_config(m).tts_clones is m.clones, mid


def test_supertonic_row():
    m = catalog.tts_model("supertonic-3")
    assert m and m.sample_rate == 44100
    assert m.clones is False and m.named_voices is True
    assert m.family == "supertonic"
    assert {d.backend for d in m.deployments} == {"native_tts"}
    # R19: supertonic is the card that triggered the cpu-only ruling (Metal
    # aborted on its first real-GPU contact, later attributed to CI's
    # paravirtual Metal VM rather than real hardware -- see catalog.py).
    # R19 follow-up / R25 (task 8): GB10 Vulkan validation passed for
    # supertonic too -- the abort does not reproduce on Vulkan -- so it
    # carries a gpu-vulkan tier. R36 (task 10): the M4 fix (resurrected
    # DIAG_MASK_INF/PAD kernels + ggml_sub's src1 cont) restores gpu-metal
    # too, fleet-wide.
    assert {d.tier for d in m.deployments} == {"cpu", "gpu-vulkan", "gpu-metal"}
    # Single quant only: Q8 is upstream-broken for supertonic (docs/gguf.md);
    # the repo's own "-q8_0.gguf" is in fact a byte-identical copy of "-orig.gguf".
    assert {d.compute_type for d in m.deployments} == {"f16"}


def test_qwen3_rows_and_capability():
    for mid, rec in (("qwen3-tts-0.6b", False), ("qwen3-tts-1.7b", False)):
        m = catalog.tts_model(mid)
        assert m and m.clones is True and m.streaming is False and m.sample_rate == 24000
        # R15(s4): qwen3_tts's base checkpoint has no default built-in voice and
        # its ICL clone mode requires ref_text one level deeper inside synth()
        # itself (live-verified, task-7-report.md §3) -- ref_text IS mandatory
        # here, same as omnivoice.
        assert m.transcript_required is True and m.recommended is rec
        assert {d.backend for d in m.deployments} == {"native_tts"}
        assert catalog.voice_capability(m) == {"builtin": "none", "custom": "clip",
                                               "required": True,
                                               "transcriptRequired": True}
    # Only supertonic-3 and moss-tts-nano stay recommended (per spec §11).
    assert catalog.tts_model("moss-tts-nano").recommended is True
    assert catalog.tts_model("supertonic-3").recommended is True


def test_deployment_platform_defaults():
    # D9: every deployment is all-platforms unless a card opts in.
    # requires_apple_silicon died with the MLX lane (slice 4).
    d = catalog.Deployment("be", "cpu", "int8", "repo", 1.0)
    assert d.platforms == ("linux", "windows", "macos")
    assert not hasattr(d, "requires_apple_silicon")


def test_shipped_deployments_are_all_platform():
    # Every platform-restricted shipped deployment (windows-only gpu-dml,
    # macOS-only Apple-Silicon MLX TTS) died in slice 4 along with the ONNX/
    # MLX backends that were their only consumers — every row is now
    # all-platform.
    for m in catalog.asr_models() + catalog.translate_models() + catalog.tts_models():
        for d in m.deployments:
            assert d.platforms == ("linux", "windows", "macos"), (m.id, d.tier)


_CACHE = os.path.expanduser("~/.cache/sokuji-native-tests")
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]


def test_every_card_has_a_graph_family():
    for m in catalog.asr_models() + catalog.translate_models() + catalog.tts_models():
        assert m.graph_family, m.id


def test_translate_prompt_family_unchanged_by_graph_family():
    fams = {m.id: m.prompt_family for m in catalog.translate_models()}
    assert fams["qwen3.5-4b"] == "qwen" and fams["eurollm-1.7b"] == "qwen" and fams["hy-mt2-7b"] == "hunyuan"
    graph = {m.id: m.graph_family for m in catalog.translate_models()}
    assert graph["eurollm-1.7b"] == "llama" and graph["qwen3-0.6b"] == "qwen3" and graph["translategemma-4b"] == "gemma3"
    assert graph["qwen3.5-4b"] != "qwen"                      # a llama.cpp architecture, never the prompt family


def test_tts_graph_family_is_the_audiocpp_family():
    for m in catalog.tts_models():
        assert m.graph_family == m.family


def test_every_tts_family_has_an_op_recording():
    """Spec A §3.3: the tts gate has teeth only where a recording exists; every shipped TTS
    card must have one (native/src/ops/tts-<family>.ops)."""
    for m in catalog.tts_models():
        assert (_REPO_ROOT / "native" / "src" / "ops" / f"tts-{m.graph_family}.ops").is_file(), m.id


def test_the_recorders_voice_required_families_are_the_catalogs():
    """The op recorder takes a voice-required family's clip synth alone, and a clip-optional
    family's bare synth and clip synth together (owner's ruling 2026-10-07, op-coverage
    precision). A family no user can run bare is voice-required there: one in
    VOICE_REQUIRED_FAMILIES, or one whose every card requires a voice. Keyed by graph_family,
    the recording's family."""
    import re
    text = (_REPO_ROOT / "native" / "tests" / "record_common.h").read_text()
    m = re.search(r"kVoiceRequiredFamilies\[\]\s*=\s*\{([^}]*)\}", text)
    assert m, "kVoiceRequiredFamilies not found in native/tests/record_common.h"
    cards: dict[str, list[bool]] = {}
    for card in catalog.tts_models():
        cards.setdefault(card.graph_family, []).append(card.voice_required)
    every_card = {family for family, required in cards.items() if all(required)}
    assert set(re.findall(r'"([^"]+)"', m.group(1))) == set(catalog.VOICE_REQUIRED_FAMILIES) | every_card


@pytest.mark.skipif(not os.path.exists(f"{_CACHE}/Qwen3-0.6B-Q8_0.gguf"), reason="cached model absent")
def test_translate_graph_family_matches_gguf_header():
    from sokuji_sidecar import gguf_header
    assert gguf_header.read_header(f"{_CACHE}/Qwen3-0.6B-Q8_0.gguf").architecture == catalog.translate_model("qwen3-0.6b").graph_family


@pytest.mark.parametrize("gguf,card_id", [
    ("whisper-tiny-Q8_0.gguf", "whisper-tiny"),
    ("moonshine-streaming-tiny-Q8_0.gguf", "moonshine-streaming-tiny"),
    # Two of the three archs whose Arch::name differs from their src/arch/ directory
    # (cohere, granite, granite_nar -> cohere_asr, granite_speech, granite_speech_nar);
    # the rows carried the directory names until 2026-09-05. granite_speech's GGUF is
    # not in the test cache, so its rows rest on the header rule alone.
    ("cohere-transcribe-03-2026-Q4_K_M.gguf", "cohere-transcribe-03-2026"),
    ("granite-speech-4.1-2b-nar-Q4_K_M.gguf", "granite-speech-4.1-2b-nar"),
    # transcribe.cpp 0.2.4's granite5_ctc directory reports Arch::name granite_speech5_ctc.
    ("granite-speech-5.0-470m-turboctc-Q8_0.gguf", "granite-speech-5.0-470m-turboctc"),
])
def test_asr_graph_family_matches_native_arch(gguf, card_id):
    """sk_asr_caps.arch for the cached file equals the card's graph_family — the string the
    recording is keyed by. The header half needs only the cached file (pure Python: the
    GGUF's general.architecture IS Arch::name, transcribe.cpp strcmp's one against the
    other at load); the load half additionally needs the wheel."""
    from sokuji_sidecar import gguf_header
    path = f"{_CACHE}/{gguf}"
    if not os.path.exists(path):
        pytest.skip("cached model absent")
    assert gguf_header.read_header(path).architecture == catalog.asr_model(card_id).graph_family
    sokuji_native = pytest.importorskip("sokuji_native")
    from sokuji_sidecar import native
    sokuji_native.init()
    cpu = next(d for d in sokuji_native.devices() if d.kind == "cpu")
    m = sokuji_native.asr_load(path, cpu)
    try:
        assert m.capabilities.arch == catalog.asr_model(card_id).graph_family
    finally:
        m.unload()


def test_rung_fallback_sets_cover_cached_ggufs():
    """Premise 7: a rung is a dtype SET. Every cached GGUF's matrix-tensor set — the dtypes
    WEIGHT expands over, with the integer index tables filtered out, which is what
    accel.weight_dtypes hands the query — must be within its rung's fallback set, or the
    pre-download answer would refuse a file it later accepts. The filter is the point: the raw
    header sets DO carry i32/i64, and widening the fallback sets to admit them instead is what
    made every Vulkan device refuse every TTS family (a MUL_MAT/GET_ROWS with an integer src0
    is a question no real graph poses)."""
    from sokuji_sidecar import gguf_header
    if not os.path.isdir(_CACHE):
        pytest.skip("no cached models")
    checked = 0
    for path in glob.glob(f"{_CACHE}/**/*.gguf", recursive=True):
        name = os.path.basename(path).lower().replace("-", "_")
        rung = next((r for r in ("q4_k_m", "q5_k_m", "q6_k", "q8_0", "bf16", "f16",
                                 "f32", "q4_k", "q4_0", "orig") if r in name), None)
        if rung is None:
            continue
        weights = gguf_header.read_header(path).matrix_types & catalog.WEIGHT_CAPABLE_DTYPES
        assert weights, path
        assert weights <= catalog.RUNG_FALLBACK_DTYPES[rung], (path, sorted(weights - catalog.RUNG_FALLBACK_DTYPES[rung]))
        checked += 1
    assert checked > 0


def test_weight_capable_dtypes_excludes_every_integer_type():
    """The predicate itself: floats and quantized types only. Derived from
    gguf_header.GGML_TYPE_NAMES, so a new quant spelling there joins it automatically while
    the integer index-table types and f64 stay out."""
    from sokuji_sidecar import gguf_header
    assert catalog.WEIGHT_CAPABLE_DTYPES.isdisjoint({"i8", "i16", "i32", "i64", "f64"})
    assert {"f32", "f16", "bf16", "q4_K", "q8_0", "q6_K", "mxfp4", "iq4_nl", "tq1_0"} <= catalog.WEIGHT_CAPABLE_DTYPES
    known = set(gguf_header.GGML_TYPE_NAMES.values())
    assert catalog.WEIGHT_CAPABLE_DTYPES == known - {"i8", "i16", "i32", "i64", "f64"}
    for rung, dts in catalog.RUNG_FALLBACK_DTYPES.items():
        assert dts <= catalog.WEIGHT_CAPABLE_DTYPES, (rung, sorted(dts - catalog.WEIGHT_CAPABLE_DTYPES))


def test_widest_fallback_matches_gen_ops_data():
    """native/cmake/gen_ops_data.py's WIDEST_FALLBACK constant must equal
    len(RUNG_FALLBACK_DTYPES["q4_k_m"]) — it is baked into the generated static_asserts at
    build time and the two must stay in sync by hand (comment in gen_ops_data.py says so)."""
    import re
    text = (_REPO_ROOT / "native" / "cmake" / "gen_ops_data.py").read_text()
    m = re.search(r"WIDEST_FALLBACK\s*=\s*(\d+)", text)
    assert m, "WIDEST_FALLBACK constant not found in gen_ops_data.py"
    assert int(m.group(1)) == len(catalog.RUNG_FALLBACK_DTYPES["q4_k_m"])


def test_the_new_rung_labels_have_their_dtype_sets():
    """Rung labels audio.cpp's own conversions use. The q4_k_m set stays the widest, which is
    what gen_ops_data.py's WIDEST_FALLBACK sizes the generated static_asserts by."""
    sets = catalog.RUNG_FALLBACK_DTYPES
    assert sets["orig"] == {"bf16", "f16", "f32"}
    assert sets["f32"] == {"f32"}
    assert sets["q4_k"] == {"q4_K", "bf16", "f16", "f32"}
    assert sets["q4_0"] == {"q4_0", "q6_K", "bf16", "f16", "f32"}
    widest = len(sets["q4_k_m"])
    assert all(len(s) <= widest for s in sets.values()), {r: len(s) for r, s in sets.items()}


# Weight dtypes of published files at those labels, integer tables dropped (GGUF headers read
# 2026-10-06; the label is the file name's own suffix).
_PUBLISHED_RUNG_DTYPES = (
    ("orig", {"f32"}),                          # confucius4-tts, fireredtts3-base
    ("orig", {"f32", "bf16"}),                  # neutts-2e
    ("f32", {"f32"}),                           # cosyvoice3
    ("q4_k", {"q4_K", "bf16", "f16"}),          # kugelaudio-0-open
    ("q4_0", {"q4_0", "bf16", "f32", "f16"}),   # breeze-tts-2
    ("bf16", {"f16", "bf16"}),                  # breeze-tts-2's bf16 file keeps f16 tensors
)


def test_published_files_fit_their_rungs_fallback_set():
    for rung, dtypes in _PUBLISHED_RUNG_DTYPES:
        fallback = catalog.RUNG_FALLBACK_DTYPES[rung]
        assert dtypes <= fallback, (rung, sorted(dtypes - fallback))


def test_tts_gguf_row_rejects_a_rung_without_a_fallback_set():
    """A rung label with no RUNG_FALLBACK_DTYPES entry would query op coverage over {f32} alone
    before its file is on disk; _tts_gguf_row refuses it at import, as _tc_row does."""
    with pytest.raises(ValueError, match="q5_0"):
        catalog._tts_gguf_row("x", "X", ("en",), "x_family", "X-GGUF",
                              {"q5_0": ("x-q5_0.gguf", 1)}, default_quant="q5_0", order=99)
    with pytest.raises(ValueError, match="include default 'bf16'"):
        catalog._tts_gguf_row("x", "X", ("en",), "x_family", "X-GGUF",
                              {"q8_0": ("x-q8_0.gguf", 1)}, default_quant="bf16", order=99)


def test_tts_gguf_row_checks_its_rung_dtypes():
    """A card's own per-rung dtype sets: one per rung it ships, never empty, and only types a
    WEIGHT tensor can hold. Each is loud at import, as the rung labels are."""
    def row(rung_dtypes):
        return catalog._tts_gguf_row("x", "X", ("en",), "x_family", "X-GGUF",
                                     {"q8_0": ("x-q8_0.gguf", 1), "f32": ("x-f32.gguf", 2)},
                                     default_quant="q8_0", order=99, rung_dtypes=rung_dtypes)
    m = row({"q8_0": {"q8_0", "f16", "f32"}, "f32": {"f32"}})
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"q8_0", "f16", "f32"}), "f32": frozenset({"f32"})}
    hash(m)                                                         # still a frozen, hashable card
    assert row(None).rung_dtypes == ()
    with pytest.raises(ValueError, match="bf16"):
        row({"bf16": {"bf16"}})                                     # a rung the card does not ship
    with pytest.raises(ValueError, match="empty"):
        row({"q8_0": set()})
    with pytest.raises(ValueError, match="i64"):
        row({"q8_0": {"q8_0", "i64"}})                              # an index table, never a WEIGHT
    # No wider than gen_ops_data.py's WIDEST_FALLBACK, which sizes the coverage cap's
    # static_assert. The label's own fallback set is no bound: a rung's set also covers its
    # companions' dtypes.
    with pytest.raises(ValueError, match="8 dtypes"):
        row({"q8_0": {"q4_0", "q4_K", "q5_K", "q6_K", "q8_0", "bf16", "f16", "f32"}})
    assert dict(row({"f32": {"f32", "f16"}}).rung_dtypes)["f32"] == {"f32", "f16"}


def test_a_rung_set_covers_its_companions_dtypes():
    """MioTTS's shape: a bf16 LM rung with a q8_0 codec companion. A rung's set is what
    accel.weight_dtypes reads once the rung is on disk, the matrix dtypes of the main GGUF and of
    every companion GGUF, so it holds the codec's q8_0 although RUNG_FALLBACK_DTYPES["bf16"]
    does not."""
    m = catalog._tts_gguf_row("x", "X", ("en",), "x_family", "X-GGUF", {"bf16": ("x-bf16.gguf", 1)},
                              default_quant="bf16", order=99,
                              companions={"bf16": (("Codec-GGUF/codec-q8_0.gguf", 1),)},
                              rung_dtypes={"bf16": {"bf16", "f16", "f32", "q8_0"}})
    assert dict(m.rung_dtypes)["bf16"] == {"bf16", "f16", "f32", "q8_0"}
    assert "q8_0" not in catalog.RUNG_FALLBACK_DTYPES["bf16"]


def test_every_tts_card_after_the_fourteen_carries_its_rung_dtypes():
    """A card added after the fourteen that predate sub-project A carries its own dtype set
    for every rung it ships (`rung_dtypes`, read from the published files' matrix tensors with
    benchmark/qwen3-asr-webgpu/hub_matrix_dtypes.py); the fourteen keep RUNG_FALLBACK_DTYPES.
    The check on the newer cards is vacuous until the first of them lands."""
    for m in catalog.tts_models():
        if m.id in PRE_A_TTS_CARD_IDS:
            assert m.rung_dtypes == (), m.id
        else:
            assert dict(m.rung_dtypes).keys() == {d.compute_type for d in m.deployments}, m.id


def _cached_rung_union(m, ct, root):
    """The weight-capable matrix dtypes of rung `ct`'s main GGUF and every companion GGUF, read
    from a test cache under `root` that stages the companions beside the main file (native/
    README.md, "Test model directories"), or, for a rung that spans folders of its repo (MioTTS's
    codec), at their repo-relative paths around the main file's folder; None unless all of them
    are cached there."""
    from sokuji_sidecar import gguf_header
    dep = next(d for d in m.deployments if d.compute_type == ct)
    main_rel = catalog.split_artifact(dep.artifact)[1]
    main = os.path.basename(main_rel)
    companions = [rel for rel, _n in dep.companions if rel.endswith(".gguf")]
    for path in sorted(glob.glob(f"{root}/**/{glob.escape(main)}", recursive=True)):
        here = os.path.dirname(path)
        repo_root = path[:-len(main_rel)] if path.endswith(os.sep + main_rel) else None
        files = [path]
        for rel in companions:
            beside = os.path.join(here, os.path.basename(rel))
            files.append(os.path.join(repo_root, rel) if repo_root and not os.path.isfile(beside) else beside)
        if all(os.path.isfile(f) for f in files):
            union = set()
            for f in files:
                union |= gguf_header.read_header(f).matrix_types
            return frozenset(union & catalog.WEIGHT_CAPABLE_DTYPES)
    return None


def test_cached_rung_union_reads_the_main_gguf_and_its_companions(tmp_path, monkeypatch):
    from sokuji_sidecar import gguf_header
    m = catalog._tts_gguf_row("x", "X", ("en",), "x_family", "X-GGUF", {"bf16": ("x-bf16.gguf", 1)},
                              default_quant="bf16", order=99,
                              companions={"bf16": (("Codec-GGUF/codec-q8_0.gguf", 1),)},
                              rung_dtypes={"bf16": {"bf16", "f32", "q8_0"}})
    card_dir = tmp_path / "tts" / "x"
    card_dir.mkdir(parents=True)
    (card_dir / "x-bf16.gguf").write_bytes(b"")
    headers = {"x-bf16.gguf": {"bf16", "f32", "i32"}, "codec-q8_0.gguf": {"q8_0"}}
    monkeypatch.setattr(gguf_header, "read_header", lambda p: gguf_header.GgufHeader(
        "x", frozenset(headers[os.path.basename(p)]), 1, frozenset(headers[os.path.basename(p)])))
    assert _cached_rung_union(m, "bf16", str(tmp_path)) is None              # the codec is not there
    (card_dir / "codec-q8_0.gguf").write_bytes(b"")
    assert _cached_rung_union(m, "bf16", str(tmp_path)) == {"bf16", "f32", "q8_0"}   # i32 dropped


def test_cached_rung_union_finds_a_companion_in_its_repo_folder(tmp_path, monkeypatch):
    """A rung that spans two folders of its repo (MioTTS's codec) is cached as the repo lays it
    out, the codec's folder beside the model's, which is where native looks for it."""
    from sokuji_sidecar import gguf_header
    m = catalog._tts_gguf_row("x", "X", ("en",), "x_family", "X-GGUF", {"bf16": ("x-bf16.gguf", 1)},
                              default_quant="bf16", order=99,
                              companions={"bf16": (("Codec-GGUF/codec-q8_0.gguf", 1),)},
                              rung_dtypes={"bf16": {"bf16", "f32", "q8_0"}})
    card_dir = tmp_path / "tts" / "x"
    (card_dir / "X-GGUF").mkdir(parents=True)
    (card_dir / "X-GGUF" / "x-bf16.gguf").write_bytes(b"")
    headers = {"x-bf16.gguf": {"bf16", "f32"}, "codec-q8_0.gguf": {"q8_0"}}
    monkeypatch.setattr(gguf_header, "read_header", lambda p: gguf_header.GgufHeader(
        "x", frozenset(headers[os.path.basename(p)]), 1, frozenset(headers[os.path.basename(p)])))
    assert _cached_rung_union(m, "bf16", str(tmp_path)) is None
    (card_dir / "Codec-GGUF").mkdir()
    (card_dir / "Codec-GGUF" / "codec-q8_0.gguf").write_bytes(b"")
    assert _cached_rung_union(m, "bf16", str(tmp_path)) == {"bf16", "f32", "q8_0"}


def test_card_rung_dtypes_equal_their_cached_rung_files():
    """A card's own set is its rung's pre-download question; once the rung is on disk the
    question is the matrix dtypes of its main GGUF and every companion GGUF together
    (accel.weight_dtypes). Read from the published files, the two are equal: a dtype missing from
    the card's set is never asked before the download, which could accept a rung the answer
    after it refuses, and an extra one is a question no file poses."""
    checked = 0
    for m in catalog.tts_models():
        for ct, dtypes in m.rung_dtypes:
            got = _cached_rung_union(m, ct, _CACHE)
            if got is None:
                continue
            assert got == dtypes, (m.id, ct, sorted(got ^ dtypes))
            checked += 1
    if not checked:
        pytest.skip("no rung of a card with its own dtype sets is fully cached")


# ---- Onboarding guards (2026-09-05): the two silent drops the native-onboarding doc warns
# about are now loud. See CLAUDE.md "Adding a native model or TTS family".

def test_tc_row_rejects_a_quant_key_outside_the_ladder():
    """A mistyped rung token ("BF16", "Q4_0", "q8_0") used to be dropped from the ladder
    without a word and surfaced only as a 404 at download time. _tc_row now raises at
    import, which every sidecar test module hits."""
    row = catalog._tc_row("x", "X", ("en",), "handy-computer/x-gguf", "x", 99,
                          {"Q8_0": 10, "Q4_K_M": 5}, "Q8_0")
    assert row.size_bytes == 10
    assert {d.compute_type for d in row.deployments} == {"q8_0", "q4_k_m"}
    with pytest.raises(ValueError, match="BF16"):
        catalog._tc_row("x", "X", ("en",), "handy-computer/x-gguf", "x", 99,
                        {"BF16": 10, "Q8_0": 10}, "Q8_0")
    with pytest.raises(ValueError, match="q8_0"):
        catalog._tc_row("x", "X", ("en",), "handy-computer/x-gguf", "x", 99,
                        {"q8_0": 10}, "q8_0")
    with pytest.raises(ValueError, match=r"include default 'Q4_K_M'; unknown=\[\]"):
        catalog._tc_row("x", "X", ("en",), "handy-computer/x-gguf", "x", 99,
                        {"Q8_0": 10}, "Q4_K_M")


def test_every_shipped_rung_has_a_fallback_dtype_set():
    """accel.weight_dtypes() falls back to {"f32"} for a compute_type with no entry in
    RUNG_FALLBACK_DTYPES — a silently optimistic pre-download coverage query. Every rung a
    shipped card can resolve to must therefore have an entry."""
    cards = list(catalog.asr_models()) + list(catalog.translate_models()) + list(catalog.tts_models())
    rungs = {d.compute_type for m in cards for d in m.deployments}
    missing = sorted(rungs - set(catalog.RUNG_FALLBACK_DTYPES))
    assert not missing, f"rungs without a RUNG_FALLBACK_DTYPES entry: {missing}"


def test_divergent_arch_names_are_pinned_to_arch_name():
    """The three transcribe.cpp architectures whose Arch::name differs from their src/arch/
    directory. Pure and cache-free so CI's sidecar-tests runs it: it guards the five rows
    against regressing to the directory names ("cohere", "granite", "granite_nar"). The
    strings themselves are proven against transcribe.cpp by
    test_asr_graph_family_matches_native_arch, which needs the cached GGUFs."""
    expected = {
        "cohere-transcribe-03-2026": "cohere_asr",
        "granite-speech-4.1-2b": "granite_speech",
        "granite-speech-4.1-2b-plus": "granite_speech",
        "granite-4.0-1b-speech": "granite_speech",
        "granite-speech-4.1-2b-nar": "granite_speech_nar",
    }
    got = {mid: catalog.asr_model(mid).graph_family for mid in expected}
    assert got == expected
    # And no row anywhere still carries one of the directory spellings.
    directory_names = {"cohere", "granite", "granite_nar"}
    offenders = sorted(m.id for m in catalog.asr_models() if m.graph_family in directory_names)
    assert not offenders, offenders


# Exact Hub sizes, read 2026-10-06: these six repos were re-converted upstream (transcribe.cpp
# #182 and later) and serve slightly larger files at every rung than they did when carded.
_RECONVERTED_ASR_SIZES = {
    "canary-1b-flash": {"F16": 1785657184, "Q8_0": 1048131424, "Q6_K": 857603936,
                        "Q5_K_M": 769563488, "Q4_K_M": 677141344},
    "canary-180m-flash": {"F16": 381632288, "Q8_0": 218447648, "Q6_K": 176291616,
                          "Q5_K_M": 158704416, "Q4_K_M": 139223840},
    "granite-speech-4.1-2b": {"F16": 4632623200, "Q8_0": 2559878944, "Q6_K": 2024968032,
                              "Q5_K_M": 1829704640, "Q4_K_M": 1602904896},
    "granite-4.0-1b-speech": {"F16": 4632623200, "Q8_0": 2559878944, "Q6_K": 2024968032,
                              "Q5_K_M": 1829704640, "Q4_K_M": 1602904896},
    "granite-speech-4.1-2b-plus": {"F16": 4229971936, "Q8_0": 2345973280, "Q6_K": 1859821632,
                                   "Q5_K_M": 1691297216, "Q4_K_M": 1489663552},
    "moss-transcribe-diarize": {"F16": 1833666240, "Q8_0": 986900160, "Q6_K": 768152256,
                                "Q5_K_M": 700314304, "Q4_K_M": 617345728},
}


@pytest.mark.parametrize("mid", sorted(_RECONVERTED_ASR_SIZES))
def test_reconverted_asr_rows_carry_the_hub_sizes(mid):
    m = catalog.asr_model(mid)
    by_quant = {d.compute_type.upper(): d.est_bytes for d in m.deployments}
    assert by_quant == _RECONVERTED_ASR_SIZES[mid]
    # deployments are default-first, and size_bytes is the default rung's
    assert m.size_bytes == by_quant[m.deployments[0].compute_type.upper()]


def test_cosyvoice3_card():
    # 2026-10-06: clone-only (audio.cpp refuses a synth with no clip), a transcript optional,
    # cpu-only until a fleet run gives the family GPU tiers; ja left after the 2026-10-08
    # loopback sweep found it broken.
    m = catalog.tts_model("cosyvoice3")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("cosyvoice3", "cosyvoice3", "CosyVoice 3 (0.5B)")
    assert m.sort_order == 14 and m.recommended is False
    assert m.languages == ("zh", "en", "ko", "de", "es", "fr", "it", "ru")
    assert m.clones is True and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 24000
    assert m.voice_required is True and m.presets == () and m.default_preset == ""
    assert "cosyvoice3" in catalog.VOICE_REQUIRED_FAMILIES
    assert m.license is None and m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0", "f32"}
    assert rungs["q8_0"].rank == 2.0 and rungs["f32"].rank == 1.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/CosyVoice3-GGUF/cosyvoice3-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 2_257_658_080
    assert rungs["f32"].artifact == "audio-cpp/audio.cpp-gguf/CosyVoice3-GGUF/cosyvoice3-f32.gguf"
    assert rungs["f32"].est_bytes == 6_995_036_608
    assert m.size_bytes == 2_257_658_080
    # The matrix dtypes of each rung's published GGUF (no companions), read from the Hub.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"}), "f32": frozenset({"f32"})}


def test_fireredtts3_base_card():
    # 2026-10-06: clone-only, transcript required; the vendor's 24 languages as codes
    # (sk_tts.cpp maps each to the vendor's tag); cpu-only until a fleet run.
    m = catalog.tts_model("fireredtts3-base")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("fireredtts3", "fireredtts3", "FireRedTTS-3 Base")
    assert m.sort_order == 15 and m.recommended is False
    assert m.languages == ("zh", "en", "yue", "ja", "ko", "es", "fr", "ru", "ar", "tr", "id", "pt",
                           "it", "nl", "vi", "de", "uk", "th", "pl", "ro", "el", "cs", "fi", "hi")
    assert m.clones is True and m.transcript_required is True and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 24000
    assert m.voice_required is True and m.presets == () and m.default_preset == ""
    assert "fireredtts3" in catalog.VOICE_REQUIRED_FAMILIES
    assert m.license is None and m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0"} and rungs["q8_0"].rank == 2.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/FireRedTTS3-Base-GGUF/fireredtts3-base-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 4_180_334_848
    assert m.size_bytes == 4_180_334_848
    # The matrix dtypes of the rung's published GGUF (no companions), read from the Hub.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"})}


def test_moss_tts_local_card():
    # 2026-10-06: speaks with nothing set, clip optional; 48 kHz; the vendor's 31 languages
    # with Tagalog as the app's "fil"; cpu-only until a fleet run.
    m = catalog.tts_model("moss-tts-local-1.5")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("moss_tts_local", "moss_tts_local", "MOSS-TTS-Local v1.5")
    assert m.sort_order == 16 and m.recommended is False
    assert m.languages == ("zh", "yue", "en", "ar", "cs", "da", "nl", "fi", "fr", "de", "el", "he",
                           "hi", "hu", "it", "ja", "ko", "mk", "ms", "fa", "pl", "pt", "ro", "ru",
                           "es", "sw", "sv", "fil", "th", "tr", "vi")
    assert "tl" not in m.languages
    assert m.clones is True and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 48000
    assert m.voice_required is False and m.presets == () and m.default_preset == ""
    assert m.license is None and m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0"} and rungs["q8_0"].rank == 2.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/MOSS-TTS-Local-v1.5-GGUF/moss-tts-local-v1.5-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 7_512_220_768
    assert m.size_bytes == 7_512_220_768
    # The matrix dtypes of the rung's published GGUF (no companions), read from the Hub.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"})}


def test_vibevoice_card_and_license():
    # 2026-10-06: an optional clip (decided by the CPU loopback), English and Chinese only.
    # MIT, but behind the consent gate with the conditional wording: Microsoft's model card
    # limits VibeVoice to research use (owner's ruling).
    m = catalog.tts_model("vibevoice-1.5b")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("vibevoice", "vibevoice", "VibeVoice 1.5B")
    assert m.sort_order == 17 and m.recommended is False
    assert m.languages == ("en", "zh")
    assert m.clones is True and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 24000
    assert m.voice_required is False and m.presets == () and m.default_preset == ""
    assert m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0", "bf16"}
    assert rungs["q8_0"].rank == 2.0 and rungs["bf16"].rank == 1.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/VibeVoice-1.5B-GGUF/vibevoice-1.5b-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 3_224_701_538
    assert rungs["bf16"].artifact == "audio-cpp/audio.cpp-gguf/VibeVoice-1.5B-GGUF/vibevoice-1.5b-bf16.gguf"
    assert rungs["bf16"].est_bytes == 5_420_021_858
    assert m.size_bytes == 3_224_701_538
    # The matrix dtypes of each rung's published GGUF (no companions), read from the Hub; the
    # q8_0 file carries bf16 and f16 matrices beside its q8_0 ones.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"bf16", "f16", "q8_0"}),
                                   "bf16": frozenset({"bf16"})}
    assert catalog.license_dict(m) == {
        "spdx": "LicenseRef-VibeVoice-Model-Card-Terms",
        "name": "VibeVoice model card terms of use (research use only)",
        "url": "https://huggingface.co/microsoft/VibeVoice-1.5B",
        "nonCommercial": False,
        "requiresConsent": True,
        "sourceRepo": "audio-cpp/audio.cpp-gguf",
        "attribution": "Microsoft (microsoft/VibeVoice-1.5B)",
    }


def test_chatterbox_card():
    # 2026-10-06: clone-only; the nineteen languages audio.cpp exposes of the vendor's 23
    # (ruling 9); cpu-only until a fleet run.
    m = catalog.tts_model("chatterbox")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("chatterbox", "chatterbox", "Chatterbox")
    assert m.sort_order == 18 and m.recommended is False
    assert m.languages == ("ar", "da", "de", "el", "en", "es", "fi", "fr", "hi", "it", "ko", "ms",
                           "nl", "no", "pl", "pt", "sv", "sw", "tr")
    assert not {"he", "ja", "ru", "zh"} & set(m.languages)
    assert m.clones is True and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 24000
    assert m.voice_required is True and m.presets == () and m.default_preset == ""
    assert "chatterbox" in catalog.VOICE_REQUIRED_FAMILIES
    assert m.license is None and m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0", "f16"}
    assert rungs["q8_0"].rank == 2.0 and rungs["f16"].rank == 1.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/Chatterbox-GGUF/chatterbox-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 2_088_393_668
    assert rungs["f16"].artifact == "audio-cpp/audio.cpp-gguf/Chatterbox-GGUF/chatterbox-f16.gguf"
    assert rungs["f16"].est_bytes == 3_744_360_386
    assert m.size_bytes == 2_088_393_668
    # The matrix dtypes of each rung's published GGUF (no companions), read from the Hub; the
    # q8_0 file carries f16 matrices beside its q8_0 ones.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"}),
                                   "f16": frozenset({"f16"})}


def test_chatterbox_turbo_card():
    # 2026-10-06: one built-in voice, no cloning, English only; cpu-only until a fleet run.
    m = catalog.tts_model("chatterbox-turbo")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("chatterbox_turbo", "chatterbox_turbo", "Chatterbox Turbo")
    assert m.sort_order == 19 and m.recommended is False
    assert m.languages == ("en",)
    assert m.clones is False and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 24000
    assert m.voice_required is False and m.presets == () and m.default_preset == ""
    cap = catalog.voice_capability(m)
    assert (cap["builtin"], cap["custom"], cap["required"]) == ("none", "none", False)
    assert m.license is None and m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0"} and rungs["q8_0"].rank == 2.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/Chatterbox-Turbo-GGUF/chatterbox-turbo-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 699_101_408
    assert m.size_bytes == 699_101_408
    # The matrix dtypes of the one published rung (no companions), read from the Hub.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"})}


def test_confucius4_card():
    # 2026-10-06: clone-only, no transcript; the vendor's 14 languages less ja, which the
    # 2026-10-08 loopback sweep found broken; one F32 ("orig") file; cpu-only until a fleet run.
    m = catalog.tts_model("confucius4")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("confucius4_tts", "confucius4_tts", "Confucius4-TTS")
    assert m.sort_order == 20 and m.recommended is False
    assert m.languages == ("zh", "en", "ko", "de", "fr", "es", "id", "it", "th", "pt", "ru",
                           "ms", "vi")
    assert m.clones is True and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 22050
    assert m.voice_required is True and m.presets == () and m.default_preset == ""
    assert "confucius4_tts" in catalog.VOICE_REQUIRED_FAMILIES
    assert m.license is None and m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"orig"} and rungs["orig"].rank == 2.0
    assert "orig" in catalog.RUNG_FALLBACK_DTYPES
    assert rungs["orig"].artifact == "audio-cpp/audio.cpp-gguf/Confucius4-TTS-GGUF/confucius4-tts-orig.gguf"
    assert rungs["orig"].est_bytes == 8_192_757_760
    assert m.size_bytes == 8_192_757_760
    # The matrix dtypes of the one published rung (F32 only, no companions), read from the Hub.
    assert dict(m.rung_dtypes) == {"orig": frozenset({"f32"})}


def test_magpie_card_and_license():
    # 2026-10-06: five baked speakers, no cloning; 11 languages as app codes (audio.cpp has not
    # ported the vendor's Japanese); NVIDIA Open Model License behind the conditional gate.
    m = catalog.tts_model("magpie-357m")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("magpie_tts", "magpie_tts", "Magpie TTS Multilingual (357M)")
    assert m.sort_order == 21 and m.recommended is False
    assert m.languages == ("ar", "de", "en", "es", "fr", "hi", "it", "ko", "pt", "vi", "zh")
    assert m.clones is False and m.transcript_required is False and m.named_voices is True
    assert m.streaming is False and m.sample_rate == 22050
    assert m.voice_required is False and m.default_preset == ""
    assert m.presets == ("Aria", "Jason", "John", "Leo", "Sofia")
    cap = catalog.voice_capability(m)
    assert (cap["builtin"], cap["custom"], cap["required"]) == ("named", "none", False)
    assert m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    # q8_0 is the only rung: the mirror's orig GGUF embeds a spec that declares the preset option
    # `speaker`, which audio.cpp's validator follows, while the engine reads `voice_id`
    # (magpie_tts/request.cpp:34), so every preset is refused on it.
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0"} and rungs["q8_0"].rank == 2.0
    assert rungs["q8_0"].artifact == ("audio-cpp/audio.cpp-gguf/MagpieTTS-Multilingual-357M-GGUF/"
                                      "magpie-tts-multilingual-357m-q8_0.gguf")
    assert rungs["q8_0"].est_bytes == 1_562_142_912
    assert m.size_bytes == 1_562_142_912
    assert catalog.license_dict(m) == {
        "spdx": "LicenseRef-NVIDIA-Open-Model-License",
        "name": "NVIDIA Open Model License",
        "url": "https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/",
        "nonCommercial": False,
        "requiresConsent": True,
        "sourceRepo": "audio-cpp/audio.cpp-gguf",
        "attribution": "NVIDIA",
    }
    # The matrix dtypes of the rung (no companions), read from the Hub: the q8_0 file keeps f16
    # tensors beside its q8_0 ones.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"})}


def test_neutts_card_and_license():
    # 2026-10-06: English; the four speakers Neuphonic documents for 2E (the GGUF carries nine
    # prompts); NeuTTS Open License behind the conditional gate.
    m = catalog.tts_model("neutts-2e")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("neutts", "neutts", "NeuTTS 2E")
    assert m.sort_order == 22 and m.recommended is False
    assert m.languages == ("en",)
    assert m.clones is False and m.transcript_required is False and m.named_voices is True
    assert m.streaming is False and m.sample_rate == 24000
    assert m.voice_required is False and m.default_preset == ""
    assert m.presets == ("emily", "paul", "sophie", "steven")
    cap = catalog.voice_capability(m)
    assert (cap["builtin"], cap["custom"], cap["required"]) == ("named", "none", False)
    assert m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"orig"} and rungs["orig"].rank == 2.0
    assert rungs["orig"].artifact == "audio-cpp/audio.cpp-gguf/NeuTTS-2E-GGUF/neutts-2e-orig.gguf"
    assert rungs["orig"].est_bytes == 3_016_181_288
    assert m.size_bytes == 3_016_181_288
    assert catalog.license_dict(m) == {
        "spdx": "LicenseRef-NeuTTS-Open-License-1.0",
        "name": "NeuTTS Open License v1.0",
        "url": "https://huggingface.co/neuphonic/neutts-2e/blob/main/LICENSE",
        "nonCommercial": False,
        "requiresConsent": True,
        "sourceRepo": "audio-cpp/audio.cpp-gguf",
        "attribution": "Neuphonic",
    }
    # The matrix dtypes of the one published rung (a single "orig" file, no companions), read
    # from the Hub: bf16 and f32.
    assert dict(m.rung_dtypes) == {"orig": frozenset({"bf16", "f32"})}


def test_kugelaudio_card():
    # 2026-10-06: four preset voices, no cloning, the vendor's 23 European languages; q8_0 and
    # q4_k (bf16 is above 10 GB); cpu-only until a fleet run.
    m = catalog.tts_model("kugelaudio-0")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("kugelaudio", "kugelaudio", "KugelAudio 0 Open")
    assert m.sort_order == 23 and m.recommended is False
    assert m.languages == ("en", "de", "fr", "es", "it", "pt", "nl", "pl", "ru", "uk", "cs", "ro",
                           "hu", "sv", "da", "fi", "no", "el", "bg", "sk", "hr", "sr", "tr")
    assert m.clones is False and m.transcript_required is False and m.named_voices is True
    assert m.streaming is False and m.sample_rate == 24000
    assert m.voice_required is False and m.default_preset == ""
    assert m.presets == ("default", "clear", "english_female", "english_male")
    cap = catalog.voice_capability(m)
    assert (cap["builtin"], cap["custom"], cap["required"]) == ("named", "none", False)
    assert m.license is None and m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0", "q4_k"}
    assert rungs["q8_0"].rank == 2.0 and rungs["q4_k"].rank == 1.0
    assert "q4_k" in catalog.RUNG_FALLBACK_DTYPES
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/KugelAudio-0-Open-GGUF/kugelaudio-0-open-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 9_752_398_658
    assert rungs["q4_k"].artifact == "audio-cpp/audio.cpp-gguf/KugelAudio-0-Open-GGUF/kugelaudio-0-open-q4_k.gguf"
    assert rungs["q4_k"].est_bytes == 5_732_997_442
    assert m.size_bytes == 9_752_398_658
    # The matrix dtypes of each published rung (no companions), read from the Hub: both keep
    # bf16 and f16 matrices beside their quantised ones. The key is the rung label ("q4_k"), the
    # dtype is ggml's spelling ("q4_K").
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"bf16", "f16", "q8_0"}),
                                   "q4_k": frozenset({"bf16", "f16", "q4_K"})}


def test_qwen3_customvoice_card():
    # 2026-10-06: the qwen3_tts CustomVoice checkpoint: nine built-in speakers, no cloning, and
    # a default speaker applied at load, so the card needs no voice although its family does.
    # It starts on the CPU tier although its family has GPU tiers: the qwen3_tts recording is
    # the Base checkpoint's clip synth, not this card's preset graph.
    m = catalog.tts_model("qwen3-tts-1.7b-customvoice")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("qwen3_tts", "qwen3_tts", "Qwen3-TTS 1.7B CustomVoice")
    assert m.sort_order == 24 and m.recommended is False
    assert m.languages == ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it")
    assert m.clones is False and m.transcript_required is False and m.named_voices is True
    assert m.streaming is False and m.sample_rate == 24000
    assert "qwen3_tts" in catalog.VOICE_REQUIRED_FAMILIES
    assert m.voice_required is False
    assert m.presets == ("Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden",
                         "Ono_Anna", "Sohee")
    assert m.default_preset == "Vivian" and m.default_preset in m.presets
    cap = catalog.voice_capability(m)
    assert (cap["builtin"], cap["custom"], cap["required"]) == ("named", "none", False)
    assert m.license is None and m.extra_files == ()
    assert set(catalog._TTS_TIER_OVERRIDES["qwen3_tts"]) > {"cpu"}
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0", "bf16"}
    assert rungs["q8_0"].rank == 2.0 and rungs["bf16"].rank == 1.0
    assert rungs["q8_0"].artifact == ("audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/"
                                      "qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf")
    assert rungs["q8_0"].est_bytes == 2_817_044_064
    assert rungs["bf16"].artifact == ("audio-cpp/audio.cpp-gguf/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/"
                                      "qwen3-tts-12hz-1.7b-customvoice-bf16.gguf")
    assert rungs["bf16"].est_bytes == 4_179_144_352
    assert m.size_bytes == 2_817_044_064
    # The matrix dtypes of each published rung (no companions), read from the Hub: the q8_0 file
    # keeps f16 and f32 matrices beside its quantised ones; the bf16 file is bf16 throughout.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"}),
                                   "bf16": frozenset({"bf16"})}


def test_irodori_500m_v3_card():
    # 2026-10-06: a second irodori_tts card; Japanese, clip optional, 48 kHz; it starts on the
    # CPU tier although its family has GPU tiers.
    m = catalog.tts_model("irodori-tts-500m-v3")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("irodori_tts", "irodori_tts", "Irodori TTS 500M v3")
    assert m.sort_order == 25 and m.recommended is False
    assert m.languages == ("ja",)
    assert m.clones is True and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 48000
    assert m.voice_required is False and m.presets == () and m.default_preset == ""
    assert m.license is None and m.extra_files == ()
    assert set(catalog._TTS_TIER_OVERRIDES["irodori_tts"]) > {"cpu"}
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0", "f16"}
    assert rungs["q8_0"].rank == 2.0 and rungs["f16"].rank == 1.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/Irodori-TTS-500M-v3-GGUF/irodori-tts-500m-v3-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 1_093_739_584
    assert rungs["f16"].artifact == "audio-cpp/audio.cpp-gguf/Irodori-TTS-500M-v3-GGUF/irodori-tts-500m-v3-f16.gguf"
    assert rungs["f16"].est_bytes == 1_254_813_120
    assert m.size_bytes == 1_093_739_584
    # The matrix dtypes of each published rung (no companions), read from the Hub: the q8_0 file
    # keeps f16 and f32 matrices beside its quantised ones; the f16 file is f16 throughout.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"}),
                                   "f16": frozenset({"f16"})}


def test_irodori_v41_anime_card():
    # 2026-10-06: a third irodori_tts card, in v4 Small's Hub folder; MIT by the owner's
    # ruling; it starts on the CPU tier although its family has GPU tiers.
    m = catalog.tts_model("irodori-tts-v4.1-anime")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("irodori_tts", "irodori_tts", "Irodori TTS v4.1 Anime")
    assert m.sort_order == 26 and m.recommended is False
    assert m.languages == ("ja",)
    assert m.clones is True and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 48000
    assert m.voice_required is False and m.presets == () and m.default_preset == ""
    assert m.license is None and m.extra_files == ()
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0"} and rungs["q8_0"].rank == 2.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/Irodori-TTS-v4-Small-GGUF/irodori-tts-v4.1-anime-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 1_112_547_264
    assert m.size_bytes == 1_112_547_264
    # The matrix dtypes of the one published rung (no companions), read from the Hub: eight
    # speaker-encoder feed-forward matrices (row length 1996, not a multiple of the 32-wide
    # quantisation block) stay bf16, and the codec's matrices are f16, beside the q8_0 ones.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"bf16", "f16", "q8_0"})}


HIGGS_PICKER_LANGS = ("af", "ar", "az", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en",
                      "es", "et", "fa", "fi", "fil", "fr", "gl", "gu", "he", "hi", "hr", "hu", "id",
                      "is", "it", "ja", "jv", "ka", "kk", "kn", "ko", "lb", "lt", "lv", "mk", "ml",
                      "mn", "mr", "ms", "mt", "ne", "nl", "no", "pl", "ps", "pt", "ro", "ru", "sk",
                      "sl", "so", "sq", "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "uz",
                      "vi", "zh")


def test_higgs_card_and_license():
    # 2026-10-06: an optional clip (decided by the CPU loopback); the vendor's 102 languages that
    # the Local Native picker can offer; non-commercial; cpu-only until a fleet run.
    m = catalog.tts_model("higgs-audio-v3-4b")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("higgs_audio_tts", "higgs_audio_tts", "Higgs Audio v3 TTS (4B)")
    assert m.sort_order == 27 and m.recommended is False
    assert m.languages == catalog.HIGGS_LANGS == HIGGS_PICKER_LANGS
    assert len(m.languages) == 67 and "tl" not in m.languages
    assert m.clones is True and m.transcript_required is False and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 24000
    assert m.voice_required is False and m.presets == () and m.default_preset == ""
    assert m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0", "bf16"}
    assert rungs["q8_0"].rank == 2.0 and rungs["bf16"].rank == 1.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/Higgs-Audio-v3-TTS-4B-GGUF/higgs-audio-v3-tts-4b-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 5_095_354_048
    assert rungs["bf16"].artifact == "audio-cpp/audio.cpp-gguf/Higgs-Audio-v3-TTS-4B-GGUF/higgs-audio-v3-tts-4b-bf16.gguf"
    assert rungs["bf16"].est_bytes == 8_501_587_648
    assert m.size_bytes == 5_095_354_048
    # The matrix dtypes of each published rung (no companions), read from the Hub: the q8_0 file
    # holds the 36 decoder layers' matrices as q8_0 and every other matrix (the embeddings, the
    # codec and its fc layers) as f16, with no f32 matrix; the bf16 file is bf16 throughout.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "q8_0"}),
                                   "bf16": frozenset({"bf16"})}
    assert catalog.license_dict(m) == {
        "spdx": "LicenseRef-Boson-Higgs-TTS-3-Research-Non-Commercial",
        "name": "Boson Higgs TTS 3 Research and Non-Commercial License",
        "url": "https://huggingface.co/bosonai/higgs-tts-3-4b/blob/main/LICENSE",
        "nonCommercial": True,
        "requiresConsent": True,
        "sourceRepo": "audio-cpp/audio.cpp-gguf",
        "attribution": "Boson AI (bosonai)",
    }


FISH_PICKER_LANGS = ("af", "am", "ar", "az", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el",
                     "en", "es", "et", "fa", "fi", "fil", "fr", "gl", "gu", "hi", "hr", "hu",
                     "id", "is", "it", "ja", "jv", "ka", "kk", "km", "kn", "ko", "lt", "lv",
                     "mn", "mr", "ms", "my", "ne", "nl", "no", "pl", "ps", "pt", "ro", "ru", "si",
                     "sk", "sl", "sq", "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "vi",
                     "zh")


def test_fish_card_and_license():
    # 2026-10-06: an optional clip that needs its transcript; the vendor's 83 languages that the
    # Local Native picker can offer, less ml and he, which the 2026-10-08 loopback sweep found
    # broken; non-commercial; q8_0 only (bf16 is above 10 GB).
    m = catalog.tts_model("fish-audio-s2-pro")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("fish_audio", "fish_audio", "Fish Audio S2 Pro")
    assert m.sort_order == 28 and m.recommended is False
    assert m.languages == catalog.FISH_LANGS == FISH_PICKER_LANGS
    assert len(m.languages) == 64 and not {"tl", "jw", "ml", "he"} & set(m.languages)
    assert m.clones is True and m.transcript_required is True and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 44100
    assert m.voice_required is False and m.presets == () and m.default_preset == ""
    assert m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0"} and rungs["q8_0"].rank == 2.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/Fish-Audio-S2-Pro-GGUF/fish-audio-s2-pro-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 6_317_911_232
    assert m.size_bytes == 6_317_911_232
    # The matrix dtypes of the one published rung (no companions), read from the Hub: the 40
    # decoder layers' matrices are q8_0, the embeddings and the quantiser codebooks f16, the
    # codec's convolutions f32, its rope tables bf16 (the loader never reads those) and its
    # attention masks i8 (not weight-capable).
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"bf16", "f16", "f32", "q8_0"})}
    assert catalog.license_dict(m) == {
        "spdx": "LicenseRef-Fish-Audio-Research-License",
        "name": "Fish Audio Research License",
        "url": "https://huggingface.co/fishaudio/s2-pro/blob/main/LICENSE.md",
        "nonCommercial": True,
        "requiresConsent": True,
        "sourceRepo": "audio-cpp/audio.cpp-gguf",
        "attribution": "Fish Audio (fishaudio)",
    }


def test_breeze_card_and_license():
    # 2026-10-06: clone mode only (bare, the engine designs a voice, which is sub-project C's),
    # so the card itself requires a clip although the family is not voice-required; the clone
    # needs its transcript; the two packages audio.cpp's spec lists; non-commercial.
    m = catalog.tts_model("breeze-tts-2")
    assert m is not None
    assert (m.family, m.graph_family, m.name) == ("breeze_tts", "breeze_tts", "Breeze-TTS 2")
    assert m.sort_order == 29 and m.recommended is False
    assert m.languages == ("zh", "en")
    assert m.clones is True and m.transcript_required is True and m.named_voices is False
    assert m.streaming is False and m.sample_rate == 24000
    assert "breeze_tts" not in catalog.VOICE_REQUIRED_FAMILIES
    assert m.voice_required is True and m.presets == () and m.default_preset == ""
    assert m.extra_files == ()
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert {d.tier for d in m.deployments} == {"cpu"}
    rungs = {d.compute_type: d for d in m.deployments}
    assert set(rungs) == {"q8_0", "bf16"}
    assert rungs["q8_0"].rank == 2.0 and rungs["bf16"].rank == 1.0
    assert rungs["q8_0"].artifact == "audio-cpp/audio.cpp-gguf/Breeze-TTS-2-GGUF/breeze-tts-2-q8_0.gguf"
    assert rungs["q8_0"].est_bytes == 5_079_668_352
    assert rungs["bf16"].artifact == "audio-cpp/audio.cpp-gguf/Breeze-TTS-2-GGUF/breeze-tts-2-bf16.gguf"
    assert rungs["bf16"].est_bytes == 7_342_916_800
    assert m.size_bytes == 5_079_668_352
    # The matrix dtypes of each published rung (no companions), read from the Hub: the q8_0 file
    # holds its quantised matrices beside bf16, f16 and f32 ones; the bf16 file only bf16 and f16.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"bf16", "f16", "f32", "q8_0"}),
                                   "bf16": frozenset({"bf16", "f16"})}
    assert catalog.license_dict(m) == {
        "spdx": "LicenseRef-BreezeBlue-Research-Non-Commercial",
        "name": "BreezeBlue Research and Non-Commercial License",
        "url": "https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE",
        "nonCommercial": True,
        "requiresConsent": True,
        "sourceRepo": "audio-cpp/audio.cpp-gguf",
        "attribution": "BreezeBlue",
    }


def test_audio8_card_shape():
    m = catalog.tts_model("audio8-tts-0.6b")
    assert m is not None and m.family == "audio8_tts" and m.graph_family == "audio8_tts"
    assert m.languages == ("yue", "zh", "nl", "en", "fr", "de", "it", "ja", "ko", "pl", "es")
    assert m.clones is True and m.transcript_required is True and m.streaming is False
    assert m.named_voices is False and m.presets == () and m.default_preset == ""
    assert m.voice_required is False                 # a bare synth works; the clone is optional
    assert m.sample_rate == 44100 and m.recommended is False and m.sort_order == 30
    assert m.load_language == ""
    assert m.license is None                         # Apache-2.0
    assert m.size_bytes == 1_429_545_312
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", "js-byte/Audio8-TTS-Preview-0.6b-GGUF/audio8-tts-preview-0.6b-q8_0.gguf",
         1_429_545_312, 2.0, ())]
    assert {d.tier for d in m.deployments} == {"cpu"}   # CPU-only until the fleet runs it
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert catalog.hub_revision("js-byte/Audio8-TTS-Preview-0.6b-GGUF") == "788f6fdb0bbdbbc407c63f3265cea9875b4a7c14"
    # The matrix dtypes of the published q8_0 file (no companions), read from the Hub at the pin.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"})}


def test_soprano_card_shape():
    m = catalog.tts_model("soprano-1.1-80m")
    assert m is not None and m.family == "soprano_tts" and m.graph_family == "soprano_tts"
    assert m.languages == ("en",)
    assert m.clones is False and m.transcript_required is False and m.streaming is False
    assert m.named_voices is False and m.presets == () and m.default_preset == ""
    assert m.voice_required is False
    assert catalog.voice_capability(m)["builtin"] == "none" and catalog.voice_capability(m)["custom"] == "none"
    assert m.sample_rate == 32000 and m.recommended is False and m.sort_order == 31
    assert m.license is None                         # Apache-2.0
    assert m.size_bytes == 123_162_336
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", "WalkingCat/Soprano-1.1-80M-GGUF/Soprano-1.1-80M-GGUF/soprano-1.1-80m-q8_0.gguf",
         123_162_336, 2.0, ()),
        ("bf16", "WalkingCat/Soprano-1.1-80M-GGUF/Soprano-1.1-80M-GGUF/soprano-1.1-80m-bf16.gguf",
         221_809_792, 1.0, ())]
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert catalog.hub_revision("WalkingCat/Soprano-1.1-80M-GGUF") == "36c6f47cf91421b7f0cf3d862d28ae2e41aab3f2"
    # The matrix dtypes of each published rung (no companions), read from the Hub at the pin: the
    # q8_0 file holds quantised matrices beside f16 and f32 ones; the bf16 file only bf16.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"}),
                                   "bf16": frozenset({"bf16"})}


def test_glm_tts_card_shape():
    m = catalog.tts_model("glm-tts")
    assert m is not None and m.family == "glm_tts" and m.graph_family == "glm_tts"
    assert m.languages == ("zh", "en")
    assert m.clones is True and m.transcript_required is True and m.streaming is False
    assert m.named_voices is False and m.presets == () and m.default_preset == ""
    assert m.voice_required is True and "glm_tts" in catalog.VOICE_REQUIRED_FAMILIES
    assert m.sample_rate == 24000 and m.recommended is False and m.sort_order == 32
    assert m.license is None                         # MIT (zai-org/GLM-TTS)
    assert m.size_bytes == 5_143_764_640
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", "mirek190/audio.cpp/Text to audio (TTS)/GLM-TTS_Q8.gguf", 5_143_764_640, 2.0, ())]
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert catalog.hub_revision("mirek190/audio.cpp") == "94bbade143c5f62c0c842ef5b2119f7880fa9ee4"
    # The matrix dtypes of the published q8_0 file (self-contained), read from the Hub at the pin.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"})}


# The vendor's 23 less ta, which the 2026-10-09 re-judge found unintelligible without a clip.
OUTETTS_LANGS = ("ar", "be", "bn", "de", "en", "es", "fa", "fr", "hu", "it", "ja", "ka",
                 "ko", "lt", "lv", "nl", "pl", "pt", "ru", "sw", "uk", "zh")


def test_outetts_card_shape_and_license():
    m = catalog.tts_model("outetts-1.0-1b")
    assert m is not None and m.family == "outetts" and m.graph_family == "outetts"
    assert m.languages == OUTETTS_LANGS
    assert m.clones is True and m.transcript_required is True and m.streaming is False
    assert m.named_voices is False and m.presets == () and m.default_preset == ""
    assert m.voice_required is False                 # a bare synth speaks (a random voice)
    assert m.sample_rate == 24000 and m.recommended is False and m.sort_order == 33
    assert m.size_bytes == 3_029_895_456
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", "mirek190/audio.cpp/Text to audio (TTS)/Llama-OuteTTS-1.0-1B_Q8.gguf", 3_029_895_456, 2.0, ())]
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    lic = m.license
    assert lic is not None and lic.spdx == "CC-BY-NC-SA-4.0"
    assert lic.non_commercial is True and lic.requires_consent is True
    assert lic.source_repo == "mirek190/audio.cpp"
    assert catalog.license_dict(m)["nonCommercial"] is True
    # The matrix dtypes of the published q8_0 file (self-contained), read from the Hub at the pin.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"bf16", "f16", "f32", "q8_0"})}


def test_echo_tts_card_shape_and_license():
    m = catalog.tts_model("echo-tts")
    assert m is not None and m.family == "echo_tts" and m.graph_family == "echo_tts"
    assert m.languages == ("en",)
    assert m.clones is True and m.transcript_required is False and m.streaming is False
    assert m.named_voices is False and m.presets == () and m.default_preset == ""
    assert m.voice_required is True and "echo_tts" in catalog.VOICE_REQUIRED_FAMILIES
    assert m.sample_rate == 44100 and m.recommended is False and m.sort_order == 34
    assert m.size_bytes == 3_028_207_456
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", "dignome/Echo-TTS/echo-tts-q8_0.gguf", 3_028_207_456, 2.0, ()),
        ("f16", "dignome/Echo-TTS/echo-tts-f16.gguf", 5_546_617_696, 1.0, ())]
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert catalog.hub_revision("dignome/Echo-TTS") == "5a7c7c5f510410a8841ba7e46cf6bfd91ea25c21"
    lic = m.license
    assert lic is not None and lic.spdx == "CC-BY-NC-SA-4.0"
    assert lic.non_commercial is True and lic.requires_consent is True
    assert lic.source_repo == "dignome/Echo-TTS"
    # The matrix dtypes of each published rung (both self-contained: DiT, PCA and Fish S1-DAC in
    # one file), read from the Hub at the pin: the q8_0 file holds quantised matrices beside f16
    # and f32 ones, the f16 file no quantised ones.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"}),
                                   "f16": frozenset({"f16", "f32"})}


KITTEN_VOICES = ("Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo", "Matthew",
                 "Elliot", "Willow", "Dolores", "Victor", "Dante", "Alfred", "Saoirse", "Claire",
                 "Raven", "Marcus", "Herbert", "Diana", "Laurence", "Maeve", "Walter", "Edith",
                 "Miles", "Grace", "Reginald", "Iris", "Frank", "Serena", "Julian", "Eleanor",
                 "Otis", "Vincent", "Martha", "Sable", "Victoria", "Arabic", "Hindi", "German",
                 "Spanish", "Italian", "French", "Portuguese", "Russian", "Chinese")


def test_kitten_tts2_card_shape_presets_and_license():
    m = catalog.tts_model("kitten-tts2")
    assert m is not None and m.family == "kitten_tts2" and m.graph_family == "kitten_tts2"
    assert m.languages == ("en", "ar", "zh", "fr", "de", "hi", "it", "pt", "ru", "es")
    assert m.clones is True and m.transcript_required is True and m.streaming is False
    assert m.named_voices is True and m.default_preset == ""   # a bare synth speaks Bruno
    assert m.presets == KITTEN_VOICES and len(m.presets) == 47 and "PreparedBruno" not in m.presets
    assert m.voice_required is False
    assert m.sample_rate == 24000 and m.recommended is False and m.sort_order == 35
    assert m.size_bytes == 3_282_123_776
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", "dignome/kitten_tts2/kitten-tts2-native-q8-multilingual.gguf", 3_282_123_776, 2.0, ())]
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert catalog.hub_revision("dignome/kitten_tts2") == "73b762c95b07c4f0675c927c25d65741b8dab7da"
    lic = m.license
    assert lic is not None and lic.spdx == "LicenseRef-Stellon-Labs-Community-License"
    assert lic.non_commercial is False and lic.requires_consent is True
    assert lic.source_repo == "dignome/kitten_tts2" and "Powered by Stellon Labs" in lic.attribution
    # The matrix dtypes of the one published rung (self-contained: the Qwen3 LM, speaker encoder
    # and S3 decoder in one file), read from the Hub at the pin.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"bf16", "f16", "f32", "q8_0"})}


def test_voicetut_card_runs_on_omnivoice_with_arz_forced():
    m = catalog.tts_model("voicetut-tts")
    omni = catalog.tts_model("omnivoice-0.6b")
    assert m is not None and m.family == "omnivoice" and m.graph_family == "omnivoice"
    assert m.languages == ("ar",) and m.load_language == "arz"
    assert m.clones is True and m.transcript_required is True and m.streaming is True
    assert m.named_voices is False and m.presets == () and m.default_preset == ""
    assert m.voice_required is True                  # omnivoice's rule: a clip and its transcript
    assert m.sample_rate == 24000 and m.recommended is False and m.sort_order == 36
    assert m.size_bytes == 1_350_264_224
    assert {(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments} == {
        ("q8_0", "mohammedaly22/VoiceTut-TTS-GGUF/voicetut-tts-q8_0.gguf", 1_350_264_224, 2.0, ()),
        ("f16", "mohammedaly22/VoiceTut-TTS-GGUF/voicetut-tts-f16.gguf", 1_639_524_576, 1.0, ())}
    # OmniVoice's GPU tiers are not inherited: the card starts on the CPU tier.
    assert {d.tier for d in omni.deployments} > {"cpu"}
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert catalog.hub_revision("mohammedaly22/VoiceTut-TTS-GGUF") == "615457bb2e9043f468e012c159146b28fa8f5959"
    # OmniVoice's licence terms (ruling 2026-10-06), naming the repo the file comes from.
    lic, olic = m.license, omni.license
    assert lic is not None and olic is not None
    assert (lic.spdx, lic.name, lic.url, lic.non_commercial, lic.attribution, lic.requires_consent) == \
           (olic.spdx, olic.name, olic.url, olic.non_commercial, olic.attribution, olic.requires_consent)
    assert lic.source_repo == "mohammedaly22/VoiceTut-TTS-GGUF"
    # The matrix dtypes of each published rung (both self-contained), read from the Hub at the
    # pin: the q8_0 file holds quantised matrices beside f16 and f32 ones, the f16 file only f16.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"}),
                                   "f16": frozenset({"f16"})}


MIOCODEC = ("MioCodec-25Hz-44.1kHz-v2-GGUF/miocodec-25hz-44khz-v2-q8_0.gguf", 299_066_464)


def test_miotts_card_pairs_every_rung_with_the_q8_0_codec():
    m = catalog.tts_model("miotts-1.7b")
    assert m is not None and m.family == "miotts" and m.graph_family == "miotts"
    assert m.languages == ("en", "ja")
    assert m.clones is True and m.transcript_required is False and m.streaming is False
    assert m.named_voices is False and m.presets == () and m.default_preset == ""
    assert m.voice_required is True and "miotts" in catalog.VOICE_REQUIRED_FAMILIES
    assert m.sample_rate == 44100 and m.recommended is False and m.sort_order == 37
    assert m.license is None                         # Apache-2.0 (MioTTS), MIT (MioCodec)
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", "audio-cpp/audio.cpp-gguf/MioTTS-1.7B-GGUF/miotts-1.7b-q8_0.gguf", 2_496_393_216, 2.0, (MIOCODEC,)),
        ("bf16", "audio-cpp/audio.cpp-gguf/MioTTS-1.7B-GGUF/miotts-1.7b-bf16.gguf", 3_817_598_976, 1.0, (MIOCODEC,))]
    # The download the card advertises is its default rung's whole package.
    assert m.size_bytes == 2_496_393_216
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert catalog.hub_revision("audio-cpp/audio.cpp-gguf") is None   # the official mirror stays unpinned
    # native/src/sk_tts_companions.h looks for exactly this file in exactly this folder.
    assert MIOCODEC[0].split("/") == ["MioCodec-25Hz-44.1kHz-v2-GGUF", "miocodec-25hz-44khz-v2-q8_0.gguf"]
    # Each rung's LM with the codec, read from the Hub: the q8_0 LM holds f16 and q8_0 matrices,
    # the bf16 one bf16 only, and the codec f16, f32 and q8_0.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f16", "f32", "q8_0"}),
                                   "bf16": frozenset({"bf16", "f16", "f32", "q8_0"})}


LFM2_EN_REPO = "LiquidAI/LFM2.5-Audio-1.5B-GGUF"


def _lfm2_companions(stem, quant, mmproj, vocoder, tokenizer):
    return ((f"mmproj-{stem}-{quant}.gguf", mmproj), (f"vocoder-{stem}-{quant}.gguf", vocoder),
            (f"tokenizer-{stem}-{quant}.gguf", tokenizer))


def _assert_lfm2_credits_cc_by_sources(lic, stem):
    # CC-BY 4.0 asks for attribution: both cards name the canary-180m-flash checkpoint and the
    # Mimi weights beside Liquid AI.
    assert lic.attribution.startswith(f"Liquid AI, {stem}. ")
    assert "NVIDIA's canary-180m-flash" in lic.attribution and "Kyutai's Mimi" in lic.attribution
    assert lic.attribution.count("CC-BY 4.0") == 2


def test_lfm2_english_card_ships_four_files_per_rung():
    m = catalog.tts_model("lfm2.5-audio-en")
    assert m is not None and m.family == "lfm2_audio" and m.graph_family == "lfm2_audio"
    assert m.languages == ("en",) and m.load_language == "auto"
    assert m.clones is False and m.transcript_required is False and m.streaming is False
    assert m.named_voices is True and m.default_preset == ""      # a bare synth speaks us_male
    assert m.presets == ("us_male", "us_female", "uk_male", "uk_female")
    assert m.voice_required is False
    assert m.sample_rate == 24000 and m.recommended is False and m.sort_order == 38
    stem = "LFM2.5-Audio-1.5B"
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", f"{LFM2_EN_REPO}/{stem}-Q8_0.gguf", 1_822_397_120, 2.0,
         _lfm2_companions(stem, "Q8_0", 293_443_936, 205_742_272, 76_957_632)),
        ("f16", f"{LFM2_EN_REPO}/{stem}-F16.gguf", 3_331_991_168, 1.0,
         _lfm2_companions(stem, "F16", 458_806_624, 387_159_232, 142_699_392)),
        ("q4_0", f"{LFM2_EN_REPO}/{stem}-Q4_0.gguf", 1_074_794_688, 1.0,
         _lfm2_companions(stem, "Q4_0", 219_511_136, 108_986_560, 50_546_112))]
    assert m.size_bytes == 1_822_397_120             # the default rung's whole package
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert m.family not in catalog._TTS_TIER_OVERRIDES
    assert catalog.hub_revision(LFM2_EN_REPO) == "7d525f883a077e20afb782f2ff618edcae0e39e4"
    # The Q4_0 backbone stores its token embedding as Q6_K (lfm2_audio.md).
    assert {"q4_0", "q6_K"} <= catalog.RUNG_FALLBACK_DTYPES["q4_0"]
    # Each rung's four files read from the Hub at the pin (hub_matrix_dtypes.py): the Q4_0 rung's
    # q6_K is that token embedding.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f32", "q8_0"}),
                                   "f16": frozenset({"f16", "f32"}),
                                   "q4_0": frozenset({"f32", "q4_0", "q6_K"})}
    lic = m.license
    assert lic is not None and lic.spdx == "LicenseRef-LFM-Open-License-1.0"
    assert lic.non_commercial is False and lic.requires_consent is True and lic.source_repo == LFM2_EN_REPO
    _assert_lfm2_credits_cc_by_sources(lic, stem)


LFM2_JA_REPO = "LiquidAI/LFM2.5-Audio-1.5B-JP-GGUF"


def test_lfm2_japanese_card_has_one_voice_and_no_f32_rung():
    m = catalog.tts_model("lfm2.5-audio-ja")
    assert m is not None and m.family == "lfm2_audio" and m.graph_family == "lfm2_audio"
    assert m.languages == ("ja",) and m.load_language == "auto"
    assert m.clones is False and m.transcript_required is False and m.streaming is False
    assert m.named_voices is False and m.presets == () and m.default_preset == ""   # any voice throws
    assert m.voice_required is False
    assert catalog.voice_capability(m)["builtin"] == "none"
    assert m.sample_rate == 24000 and m.recommended is False and m.sort_order == 39
    stem = "LFM2.5-Audio-1.5B-JP"
    assert [(d.compute_type, d.artifact, d.est_bytes, d.rank, d.companions) for d in m.deployments] == [
        ("q8_0", f"{LFM2_JA_REPO}/{stem}-Q8_0.gguf", 1_820_023_680, 2.0,
         _lfm2_companions(stem, "Q8_0", 293_443_840, 205_742_368, 74_584_224)),
        ("f16", f"{LFM2_JA_REPO}/{stem}-F16.gguf", 3_302_879_040, 1.0,
         _lfm2_companions(stem, "F16", 432_067_840, 387_159_328, 140_325_984)),
        ("q4_0", f"{LFM2_JA_REPO}/{stem}-Q4_0.gguf", 1_072_421_248, 1.0,
         _lfm2_companions(stem, "Q4_0", 219_511_040, 108_986_656, 48_172_704))]
    assert "f32" not in {d.compute_type for d in m.deployments}
    assert m.size_bytes == 1_820_023_680
    assert {d.tier for d in m.deployments} == {"cpu"}
    assert catalog.hub_revision(LFM2_JA_REPO) == "64b96718b341dbd5650f9e85627cecdcbd4ac61b"
    # Each rung's four files read from the Hub at the pin (hub_matrix_dtypes.py): the same sets as
    # the English checkpoint's, the Q4_0 rung's q6_K being its token embedding.
    assert dict(m.rung_dtypes) == {"q8_0": frozenset({"f32", "q8_0"}),
                                   "f16": frozenset({"f16", "f32"}),
                                   "q4_0": frozenset({"f32", "q4_0", "q6_K"})}
    lic = m.license
    assert lic is not None and lic.spdx == "LicenseRef-LFM-Open-License-1.0"
    assert lic.non_commercial is False and lic.requires_consent is True and lic.source_repo == LFM2_JA_REPO
    _assert_lfm2_credits_cc_by_sources(lic, stem)
