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
    assert m.size_bytes == 986899616
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
                "pocket-tts-it", "pocket-tts-pt")


def test_tts_models_are_the_ten_native_tts_cards():
    # 68 rows -> 10, slice 4 (spec §5.4 corrected 2026-08-31): every ONNX/
    # sherpa/MLX backend and its cards died with the ONNX/sherpa/MLX stacks.
    ids = [m.id for m in catalog.tts_models()]
    assert set(ids) == set(TTS_CARD_IDS)
    assert len(ids) == len(set(ids)) == 10


def test_tts_models_have_deployments_languages_and_family():
    for m in catalog.tts_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        assert m.family, f"{m.id} has no family"
        for d in m.deployments:
            assert d.backend == "native_tts"
            # R19 follow-up / R25 (task 8): every family was GB10-Vulkan-
            # validated (catalog._TTS_TIER_OVERRIDES), so every deployment is
            # now cpu or gpu-vulkan — never gpu-metal (R25: no Apple-GPU box).
            assert d.tier in ("cpu", "gpu-vulkan")


def test_tts_artifacts_are_audiocpp_gguf_files():
    for m in catalog.tts_models():
        for d in m.deployments:
            assert d.artifact.startswith("audio-cpp/audio.cpp-gguf/"), (m.id, d.artifact)
            assert d.artifact.endswith(".gguf"), (m.id, d.artifact)


def test_tts_system_has_cpu_floor_and_unique_ids():
    # Every card keeps a cpu floor even after task 8's gpu-vulkan restoration
    # (_TTS_TIER_OVERRIDES always includes "cpu" alongside "gpu-vulkan").
    ids = [m.id for m in catalog.tts_models()]
    assert len(ids) == len(set(ids)), "duplicate tts model ids"
    for m in catalog.tts_models():
        assert any(d.tier == "cpu" for d in m.deployments), f"{m.id} has no cpu floor"


def test_tts_quant_ladder_shape():
    # Every card follows _llm_translate_row's two-rung shape: the default
    # quant is rank 2.0, any alt is rank 1.0, and EVERY quant carries the
    # SAME tier set (unlike the old catalog's per-precision/per-platform row
    # variation) -- {"cpu", "gpu-vulkan"} for every family post-task-8,
    # pocket_tts included (ruling R29, superseding R28 -- see
    # test_pocket_tts_gpu_vulkan_r29 below for why).
    for m in catalog.tts_models():
        by_ct = {}
        for d in m.deployments:
            by_ct.setdefault(d.compute_type, set()).add(d.tier)
        for ct, tiers in by_ct.items():
            assert tiers == {"cpu", "gpu-vulkan"}, (m.id, ct)
        ranks = {d.compute_type: d.rank for d in m.deployments}
        assert sorted(ranks.values(), reverse=True)[0] == 2.0, m.id
        assert set(ranks.values()) <= {1.0, 2.0}, m.id


def test_pocket_tts_gpu_vulkan_r29():
    # Ruling R29 (task-8 second fix round, superseding R28): R28 had briefly
    # pinned pocket_tts cpu-only on a single, not-apples-to-apples,
    # cross-session comparison. A controlled re-measurement (warm-up call +
    # 4 timed same-shape runs each device, catalog._TTS_TIER_OVERRIDES' own
    # comment has the numbers) found Vulkan 5-9x FASTER, not slower -- no
    # measurement in either round had cpu winning -- so pocket_tts gains
    # gpu-vulkan like the other four GB10-validated families.
    for mid in ("pocket-tts-en", "pocket-tts-de", "pocket-tts-es", "pocket-tts-it", "pocket-tts-pt"):
        m = catalog.tts_model(mid)
        assert m is not None and m.family == "pocket_tts"
        assert {d.tier for d in m.deployments} == {"cpu", "gpu-vulkan"}, mid


def test_tts_tier_overrides_default_is_cpu_only_for_unknown_family():
    # catalog._TTS_TIER_OVERRIDES.get(family, catalog._TTS_TIERS) is the exact
    # lookup _tts_gguf_row uses -- a family with no override entry (any future
    # new family, until it's explicitly validated) must fall through to the
    # cpu-only default, not silently inherit some other family's tiers.
    assert catalog._TTS_TIER_OVERRIDES.get("some_future_unvalidated_family",
                                            catalog._TTS_TIERS) == ("cpu",)
    assert "some_future_unvalidated_family" not in catalog._TTS_TIER_OVERRIDES


def test_omnivoice_card_shape():
    m = catalog.tts_model("omnivoice-0.6b")
    assert m is not None
    assert m.family == "omnivoice"
    assert m.languages == ("multi",)
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
    assert catalog.license_dict(m) == {
        "spdx": "CC-BY-NC-4.0",
        "name": "Creative Commons Attribution-NonCommercial 4.0 International",
        "url": "https://creativecommons.org/licenses/by-nc/4.0/",
        "nonCommercial": True,
        "sourceRepo": "audio-cpp/audio.cpp-gguf",
        "attribution": "k2-fsa/OmniVoice",
    }
    # Every other card has no license — license_dict is a plain pass-through
    # None, not a default-constructed License.
    assert catalog.tts_model("moss-tts-nano").license is None
    assert catalog.license_dict(catalog.tts_model("moss-tts-nano")) is None


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
    # reports native_translate when the real probe finds it importable (slice
    # 5 CI job runs the suite wheel-less, see test_runtime_gate.py).
    pytest.importorskip("sokuji_native")
    from sokuji_sidecar import accel
    installed = accel._installed()
    assert "native_translate" in installed
    for old in ("qwen_translate", "qwen35_translate", "hunyuan_translate",
                "gemma_translate", "opus_translate", "llamacpp_qwen",
                "llamacpp_hunyuan", "llamacpp_gemma", "ct2_opus_translate"):
        assert old not in installed


def test_translate_row_count_and_no_opus():
    # The 13 Opus-MT rows are gone (slice 3): 9 GGUF LLM cards remain, all on
    # native_translate.
    models = catalog.translate_models()
    assert len(models) == 9
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
    assert cap(catalog.tts_model("moss-tts-nano")) == {"builtin": "none", "custom": "clip"}
    assert cap(catalog.tts_model("supertonic-3")) == {"builtin": "named", "custom": "none"}
    assert cap(catalog.tts_model("pocket-tts-en")) == {"builtin": "named", "custom": "clip"}
    assert cap(catalog.tts_model("pocket-tts-de")) == {"builtin": "none", "custom": "clip"}
    assert cap(catalog.tts_model("omnivoice-0.6b")) == {"builtin": "none", "custom": "clip",
                                                        "transcriptRequired": True}


def test_supertonic_row():
    m = catalog.tts_model("supertonic-3")
    assert m and m.sample_rate == 44100
    assert m.clones is False and m.named_voices is True
    assert m.family == "supertonic"
    assert {d.backend for d in m.deployments} == {"native_tts"}
    # R19: supertonic is the card that triggered the cpu-only ruling (Metal
    # aborted on its first real-GPU contact). R19 follow-up / R25 (task 8):
    # GB10 Vulkan validation passed for supertonic too -- the Metal abort
    # does not reproduce on Vulkan -- so it now carries a gpu-vulkan tier.
    assert {d.tier for d in m.deployments} == {"cpu", "gpu-vulkan"}
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
