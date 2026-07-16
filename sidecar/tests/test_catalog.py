from sokuji_sidecar import catalog


def test_models_have_deployments_and_languages():
    for m in catalog.asr_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        for d in m.deployments:
            assert d.backend in ("transcribe_cpp", "transcribe_cpp_stream")
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


def test_every_asr_row_is_transcribe_cpp_gguf():
    for m in catalog.asr_models():
        for d in m.deployments:
            assert d.backend.startswith("transcribe_cpp")
            repo, fname = catalog.split_artifact(d.artifact)
            assert repo.startswith("handy-computer/") and fname.endswith(".gguf")


def test_sense_voice_row_transcribe_cpp_q8():
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
        ("transcribe_cpp", "gpu-vulkan", "q4_k_m",
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
    assert len(ids) == 23
    orders = [m.sort_order for m in catalog.asr_models()]
    assert orders == sorted(orders)                        # rows stay rank-ordered
    assert sum(1 for m in catalog.asr_models() if m.recommended) == 7


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
        ("transcribe_cpp_stream", "gpu-vulkan", "q4_k_m",
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


def test_tts_models_have_deployments_languages_and_repos():
    assert catalog.tts_models(), "no tts models"
    for m in catalog.tts_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        assert m.repos, f"{m.id} has no download repos"
        for d in m.deployments:
            assert d.backend in {"sherpa_tts", "moss_onnx", "supertonic",
                                 "qwen3tts_onnx", "mlx_audio_tts",
                                 "gpt_sovits_onnx", "pocket_onnx"}


def test_tts_system_has_cpu_floor_and_unique_ids():
    ids = [m.id for m in catalog.tts_models()]
    assert len(ids) == len(set(ids)), "duplicate tts model ids"
    for m in catalog.tts_models():
        assert any(d.tier == "cpu" for d in m.deployments), f"{m.id} has no cpu floor"


def test_tts_moss_nano_is_streaming_cloning():
    m = catalog.tts_model("moss-tts-nano")
    assert m is not None and m.streaming and m.clones
    assert len(m.repos) == 2  # LM ONNX + audio-tokenizer ONNX


def test_tts_model_unknown_returns_none():
    assert catalog.tts_model("does-not-exist") is None


def test_resolve_tts_card_static_id_returns_catalog_row():
    assert catalog.resolve_tts_card("moss-tts-nano") is catalog.tts_model("moss-tts-nano")


def test_resolve_tts_card_uncatalogued_sherpa_id_synthesises_card():
    mid = "csukuangfj/vits-piper-xx-yy"
    m = catalog.resolve_tts_card(mid)
    assert m is not None
    assert m.id == mid
    assert m.name == mid
    assert m.languages == ("multi",)
    assert m.deployments == (catalog.Deployment("sherpa_tts", "cpu", "fp32", mid, 1.0),)
    assert m.repos == (mid,)
    assert m.sample_rate == 16000


def test_resolve_tts_card_unknown_non_sherpa_id_returns_none():
    assert catalog.resolve_tts_card("totally-unknown-xyz") is None


def test_llm_translate_rows_shape():
    m = catalog.translate_model("translategemma-4b")
    assert m is not None
    quants = {d.compute_type for d in m.deployments}
    assert quants == {"q4_k_m", "q8_0"}
    tiers = {(d.compute_type, d.tier) for d in m.deployments}
    for q in quants:
        assert {(q, "gpu-cuda"), (q, "gpu-metal"),
                (q, "gpu-vulkan"), (q, "cpu")} <= tiers
    # default quant (rank 2.0) is q4_k_m for the 4B card
    default = max(m.deployments, key=lambda d: d.rank)
    assert default.compute_type == "q4_k_m"
    assert all(d.backend == "llamacpp_gemma" for d in m.deployments)
    # same artifact across tiers of one quant (a GGUF is tier-agnostic)
    per_quant = {q: {d.artifact for d in m.deployments if d.compute_type == q}
                 for q in quants}
    assert all(len(a) == 1 for a in per_quant.values())


def test_llm_vulkan_tier_ranks_between_cuda_and_cpu():
    # gpu-vulkan (TIER_RANK 2.5) resolves below gpu-cuda/gpu-metal (3.0) and
    # above cpu (1.0). Ordering comes from accel.TIER_RANK, not the order of
    # the tiers tuple in _llm_translate_row.
    from sokuji_sidecar import accel
    # Post-P2 Machine shape: NVIDIA presence comes from `gpus` descriptions via
    # accel.has_nvidia (no `nvidia` field / accel.Gpu class). gpu-cuda is
    # available (has_nvidia), gpu-vulkan via "vulkan" in tc_kinds, gpu-metal not.
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"llamacpp_gemma"}),
                      fingerprint="t", tc_kinds=("cpu", "vulkan"),
                      gpus=(("cuda", "NVIDIA x", 12288),))
    plans = accel.resolve_deployments(catalog.translate_model("translategemma-4b"), m)
    seen = []
    for p in plans:
        if p.tier not in seen:
            seen.append(p.tier)
    assert seen == ["gpu-cuda", "gpu-vulkan", "cpu"]   # gpu-metal filtered (no Apple/Metal)


def test_small_qwen_defaults_to_q8():
    for mid in ("qwen2.5-0.5b", "qwen3-0.6b"):
        m = catalog.translate_model(mid)
        default = max(m.deployments, key=lambda d: d.rank)
        assert default.compute_type == "q8_0", mid
        assert all(d.backend == "llamacpp_qwen" for d in m.deployments)


def test_hunyuan_backend_and_no_fp8():
    for mid in ("hy-mt2-1.8b", "hy-mt2-7b", "hy-mt15-1.8b", "hy-mt15-7b"):
        m = catalog.translate_model(mid)
        assert all(d.backend == "llamacpp_hunyuan" for d in m.deployments)
        assert all(d.compute_type in ("q4_k_m", "q8_0") for d in m.deployments)


def test_opus_rows_cpu_only():
    m = catalog.translate_model("opus-mt-ja-en")
    assert len(m.deployments) == 1
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type) == ("ct2_opus_translate", "cpu", "int8")
    assert d.artifact == "jiangzhuo9357/opus-mt-ja-en-ct2"


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
    assert catalog.split_artifact("jiangzhuo9357/opus-mt-ja-en-ct2") == (
        "jiangzhuo9357/opus-mt-ja-en-ct2", None)
    # deep path (filename itself contains a slash, e.g. an onnx/ subdir).
    assert catalog.split_artifact("org/repo/onnx/model.onnx") == ("org/repo", "onnx/model.onnx")


def test_all_translate_backends_installed_names():
    from sokuji_sidecar import accel
    installed = accel._installed()
    for name in ("llamacpp_qwen", "llamacpp_hunyuan", "llamacpp_gemma"):
        assert name in installed
    for old in ("qwen_translate", "qwen35_translate", "hunyuan_translate",
                "gemma_translate", "opus_translate"):
        assert old not in installed


def test_tts_models_use_repo_path_ids_and_have_num_speakers():
    tts = {m.id: m for m in catalog.tts_models()}
    # MOSS keeps its short id; piper models are keyed by their HF repo path.
    assert "moss-tts-nano" in tts
    assert "csukuangfj/vits-piper-en_US-amy-low" in tts
    assert "csukuangfj/vits-piper-de_DE-thorsten-low" in tts
    # Every TTS model carries num_speakers >= 1, and a piper id IS its repo.
    for m in catalog.tts_models():
        assert m.num_speakers >= 1, f"{m.id} num_speakers"
    amy = tts["csukuangfj/vits-piper-en_US-amy-low"]
    assert amy.repos == ("csukuangfj/vits-piper-en_US-amy-low",)
    assert amy.num_speakers == 1
    # A multi-speaker model exposes a range.
    assert tts["csukuangfj/vits-piper-en_US-libritts_r-medium"].num_speakers > 1


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
    # Frozen facts moved verbatim from the old hardcoded-sizes dict (native_models.py) —
    # must never silently regress.
    assert catalog.asr_model("sense-voice").size_bytes == 252684608
    assert catalog.tts_model("csukuangfj/vits-piper-en_US-amy-low").size_bytes == 81105784
    # aishell3 repoints to the existing HF repo with its measured kept-size
    # (the old vits-icefall id 404'd on HF and was never downloadable).
    assert catalog.tts_model("csukuangfj/vits-zh-aishell3").size_bytes == 123663994


def test_voice_capability_map():
    cap = catalog.voice_capability
    assert cap(catalog.tts_model("moss-tts-nano")) == {"builtin": "named", "custom": "clip"}
    assert cap(catalog.tts_model("supertonic-3")) == {"builtin": "named", "custom": "style"}
    assert cap(catalog.tts_model("csukuangfj/vits-zh-aishell3")) == {"builtin": "range", "custom": "none"}
    assert cap(catalog.tts_model("csukuangfj/vits-piper-en_US-amy-low")) == {"builtin": "none", "custom": "none"}


def test_supertonic_row():
    m = catalog.tts_model("supertonic-3")
    assert m and m.num_speakers == 10 and m.sample_rate == 44100
    assert m.clones is False and m.style_voices is True and m.named_voices is True
    assert m.repos == ("Supertone/supertonic-3",)
    assert {d.backend for d in m.deployments} == {"supertonic"}
    assert {d.tier for d in m.deployments} == {"gpu-cuda", "gpu-dml", "cpu"}


def test_qwen3_rows_and_capability():
    for mid, rec in (("qwen3-tts-0.6b", True), ("qwen3-tts-1.7b", False)):
        m = catalog.tts_model(mid)
        assert m and m.clones is True and m.streaming is False and m.sample_rate == 24000
        assert m.transcript_required is True and m.recommended is rec
        assert {d.backend for d in m.deployments} == {"qwen3tts_onnx", "mlx_audio_tts"}
        assert catalog.voice_capability(m) == {"builtin": "named", "custom": "clip", "transcriptRequired": True}
    # MOSS capability unchanged (no extra key)
    assert catalog.voice_capability(catalog.tts_model("moss-tts-nano")) == {"builtin": "named", "custom": "clip"}


def test_sherpa_tts_rows_are_cpu_only():
    # Stock sherpa-onnx wheel is CPU-only (its bundled ORT exposes just
    # CPUExecutionProvider, runtime-verified) — a gpu-cuda row shows a false
    # GPU badge and claims phantom VRAM in the cross-stage ledger (D11).
    for m in catalog.tts_models():
        for d in m.deployments:
            if d.backend == "sherpa_tts":
                assert d.tier == "cpu", m.id


def test_deployment_platform_defaults():
    # D9: every deployment is all-platforms + no Apple-Silicon requirement unless
    # a card opts in. Positional construction (backend, tier, compute_type,
    # artifact, rank) still works with the two new trailing fields.
    d = catalog.Deployment("be", "cpu", "int8", "repo", 1.0)
    assert d.platforms == ("linux", "windows", "macos")
    assert d.requires_apple_silicon is False


def test_deployment_platform_fields_are_settable():
    d = catalog.Deployment("be", "gpu-dml", "fp32", "repo", 1.0,
                           platforms=("windows",), requires_apple_silicon=False)
    assert d.platforms == ("windows",)
    mlx = catalog.Deployment("be", "gpu-metal", "fp16", "repo", 1.0,
                             platforms=("macos",), requires_apple_silicon=True)
    assert mlx.requires_apple_silicon is True


def test_shipped_deployments_are_all_platform_except_gpu_dml():
    # P3 default is all-three; P5 carved out the windows-only gpu-dml rows; P6
    # adds the macOS-only, Apple-Silicon MLX TTS rows. Those are the ONLY two
    # kinds of platform-restricted shipped deployment — everything else stays
    # all-platform.
    for m in catalog.asr_models() + catalog.translate_models() + catalog.tts_models():
        for d in m.deployments:
            if d.tier == "gpu-dml":
                assert d.platforms == ("windows",), (m.id, d.tier)
                assert d.requires_apple_silicon is False, (m.id, d.tier)
            elif d.backend == "mlx_audio_tts":
                assert d.platforms == ("macos",), (m.id, d.tier)      # Apple-Silicon MLX (D5)
                assert d.requires_apple_silicon is True, (m.id, d.tier)
            else:
                assert d.platforms == ("linux", "windows", "macos"), (m.id, d.tier)
                assert d.requires_apple_silicon is False, (m.id, d.tier)


def test_heavy_tts_cards_have_windows_only_gpu_dml_rows():
    for mid, backend in (("moss-tts-nano", "moss_onnx"),
                         ("supertonic-3", "supertonic"),
                         ("qwen3-tts-0.6b", "qwen3tts_onnx"),
                         ("qwen3-tts-1.7b", "qwen3tts_onnx")):
        m = catalog.tts_model(mid)
        by_tier = {}
        for d in m.deployments:
            by_tier.setdefault(d.tier, []).append(d)
        assert "gpu-dml" in by_tier, mid
        assert len(by_tier["gpu-dml"]) == 1, mid
        d = by_tier["gpu-dml"][0]
        assert d.backend == backend
        assert d.platforms == ("windows",), mid           # DirectML SKU is Windows-only
        assert d.compute_type == "fp32"
        # Same artifact as the CUDA row: DML runs the identical graphs (spec D2).
        assert d.artifact == by_tier["gpu-cuda"][0].artifact


def test_sherpa_tts_cards_have_no_gpu_dml_row():
    # spec D11: the stock sherpa-onnx wheel is CPU-only; no DirectML tier.
    for m in catalog.tts_models():
        if any(d.backend == "sherpa_tts" for d in m.deployments):
            assert all(d.tier != "gpu-dml" for d in m.deployments), m.id


def test_mlx_tts_deployment_rows():
    # spec D5 / P6: each MLX-lane card gains ONE Apple-Silicon macOS metal row,
    # pointed at the mlx-community repo, reusing the card's compute_type so the
    # card still exposes exactly one variant (no new TTS variantIds).
    expect = {
        "moss-tts-nano": "mlx-community/MOSS-TTS-Nano-100M",
        "qwen3-tts-0.6b": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
        "qwen3-tts-1.7b": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
    }
    for mid, repo in expect.items():
        m = catalog.tts_model(mid)
        mlx = [d for d in m.deployments if d.backend == "mlx_audio_tts"]
        assert len(mlx) == 1, mid
        d = mlx[0]
        assert d.tier == "gpu-metal"
        assert d.artifact == repo
        assert d.platforms == ("macos",)
        assert d.requires_apple_silicon is True
        # compute_type reused from the card's ONNX rows → still a single variant
        onnx_cts = {x.compute_type for x in m.deployments if x.backend != "mlx_audio_tts"}
        assert d.compute_type in onnx_cts
        assert len({x.compute_type for x in m.deployments}) == 1, mid


def test_mlx_cards_keep_onnx_cpu_fallback_rows():
    # The ONNX cpu row survives on every MLX-lane card (the mac fallback + the
    # runnable row on Linux/Windows/Intel-Mac).
    for mid in ("moss-tts-nano", "qwen3-tts-0.6b", "qwen3-tts-1.7b"):
        m = catalog.tts_model(mid)
        assert any(d.tier == "cpu" and d.backend != "mlx_audio_tts"
                   for d in m.deployments), mid
