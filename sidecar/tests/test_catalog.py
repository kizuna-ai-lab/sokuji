from sokuji_sidecar import catalog


def test_models_have_deployments_and_languages():
    for m in catalog.asr_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        for d in m.deployments:
            assert d.backend in {"ctranslate2", "sherpa", "transformers", "qwen3asr",
                                 "cohere_transformers", "voxtral_realtime", "funasr_sensevoice",
                                 "funasr_nano"}


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


def test_sense_voice_uses_funasr_whisper_uses_ctranslate2():
    assert catalog.asr_model("sense-voice").deployments[0].backend == "funasr_sensevoice"
    assert catalog.asr_model("whisper-tiny").deployments[0].backend == "ctranslate2"


def test_sense_voice_row_has_gpu_and_cpu_funasr():
    m = catalog.asr_model("sense-voice")
    assert m.recommended is True and m.sort_order == 1
    assert [(d.backend, d.tier, d.compute_type) for d in m.deployments] == [
        ("funasr_sensevoice", "gpu-cuda", "float32"),
        ("funasr_sensevoice", "cpu", "float32"),
    ]
    assert all(d.artifact == catalog.SENSE_VOICE_REPO for d in m.deployments)


def test_granite_language_regression():
    assert catalog.asr_model("granite-speech-4.1-2b").languages == ("en", "fr", "de", "es", "pt", "ja")
    assert catalog.asr_model("granite-speech-4.1-2b-plus").languages == ("en", "fr", "de", "es", "pt")


def test_qwen3_asr_row():
    m = catalog.asr_model("qwen3-asr-1.7b")
    assert m is not None
    assert m.languages == ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
                           "fr", "it", "pt", "ru", "th", "vi", "hi", "id")
    assert m.recommended is True         # Phase 2: native runtime available → recommended
    assert m.sort_order == 9
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("qwen3asr", "gpu-cuda", "bfloat16", "bezzam/Qwen3-ASR-1.7B")


def test_cohere_asr_row():
    m = catalog.asr_model("cohere-transcribe-03-2026")
    assert m is not None
    assert m.name == "Cohere Transcribe"
    assert m.languages == ("en", "de", "fr", "it", "es", "pt", "el",
                           "nl", "pl", "ar", "vi", "zh", "ja", "ko")
    assert m.recommended is True
    assert m.sort_order == 0          # sorted first
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("cohere_transformers", "gpu-cuda", "bfloat16", "AEmotionStudio/cohere-transcribe-03-2026-models")


def test_cohere_is_first_qwen3_shifted():
    ids = [m.id for m in catalog.asr_models()]
    assert ids[0] == "cohere-transcribe-03-2026"           # inserted first in the list
    assert catalog.asr_model("qwen3-asr-1.7b").sort_order == 9   # 7 → 8 (cohere) → 9 (whisper-medium)
    assert catalog.asr_model("sense-voice").sort_order == 1      # shifted +1 from 0


def test_voxtral_realtime_row():
    m = catalog.asr_model("voxtral-mini-4b-realtime")
    assert m is not None
    assert m.name == "Voxtral Mini 4B Realtime"
    assert m.languages == ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko")
    assert m.recommended is True         # Phase 2: streaming landed → promote to recommended
    assert m.sort_order == 10            # after whisper-medium inserted: Qwen3 → 9, Voxtral → 10
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("voxtral_realtime", "gpu-cuda", "bfloat16", "mistralai/Voxtral-Mini-4B-Realtime-2602")


def test_fun_asr_mlt_nano_row():
    m = catalog.asr_model("fun-asr-mlt-nano")
    assert m is not None and m.name == "Fun-ASR MLT Nano"
    assert m.recommended is True
    assert len(m.languages) == 31
    assert m.languages[:6] == ("zh", "en", "yue", "ja", "ko", "vi")
    assert [(d.backend, d.tier, d.compute_type) for d in m.deployments] == [
        ("funasr_nano", "gpu-cuda", "float32"),
        ("funasr_nano", "cpu", "float32"),
    ]
    assert all(d.artifact == catalog.FUN_ASR_MLT_REPO for d in m.deployments)


def test_tts_models_have_deployments_languages_and_repos():
    assert catalog.tts_models(), "no tts models"
    for m in catalog.tts_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        assert m.repos, f"{m.id} has no download repos"
        for d in m.deployments:
            assert d.backend in {"sherpa_tts", "moss_onnx"}


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


def test_translate_models_have_deployments_and_cpu_floor():
    for m in catalog.translate_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        assert any(d.tier == "cpu" for d in m.deployments), f"{m.id} lacks a cpu floor"
        for d in m.deployments:
            assert d.backend in {"qwen_translate", "qwen35_translate", "gemma_translate",
                                 "hunyuan_translate", "opus_translate"}


def test_translate_model_ids_unique_and_lookup():
    ids = [m.id for m in catalog.translate_models()]
    assert len(ids) == len(set(ids))
    assert catalog.translate_model("does-not-exist") is None


def test_translate_rows_map_to_qwen_repos():
    expected = {
        "qwen2.5-0.5b": ("qwen_translate", "Qwen/Qwen2.5-0.5B-Instruct"),
        "qwen3-0.6b": ("qwen_translate", "Qwen/Qwen3-0.6B"),
        "qwen3.5-0.8b": ("qwen35_translate", "Qwen/Qwen3.5-0.8B"),
        "qwen3.5-2b": ("qwen35_translate", "Qwen/Qwen3.5-2B"),
    }
    for mid, (backend, repo) in expected.items():
        m = catalog.translate_model(mid)
        assert m is not None, f"missing {mid}"
        tiers = [(d.backend, d.tier, d.compute_type, d.artifact) for d in m.deployments]
        assert (backend, "gpu-cuda", "bfloat16", repo) in tiers
        assert (backend, "cpu", "float32", repo) in tiers


def test_new_llm_translate_rows():
    from sokuji_sidecar import catalog
    g = catalog.translate_model("translategemma-4b")
    assert g is not None
    assert g.name == "TranslateGemma 4B"
    assert {d.tier for d in g.deployments} == {"gpu-cuda", "cpu"}
    assert all(d.backend == "gemma_translate" for d in g.deployments)
    assert g.deployments[0].artifact == "google/translategemma-4b-it"

    for mid, repo in [("hy-mt2-1.8b", "tencent/Hy-MT2-1.8B"),
                      ("hy-mt2-7b", "tencent/Hy-MT2-7B")]:
        h = catalog.translate_model(mid)
        assert h is not None and all(d.backend == "hunyuan_translate" for d in h.deployments)
        assert h.deployments[0].artifact == repo
        assert {d.tier for d in h.deployments} == {"gpu-cuda", "cpu"}
        # bf16 on GPU, float32 on CPU (mirrors the Qwen rows)
        gpu = next(d for d in h.deployments if d.tier == "gpu-cuda")
        cpu = next(d for d in h.deployments if d.tier == "cpu")
        assert gpu.compute_type == "bfloat16" and cpu.compute_type == "float32"


def test_hymt2_has_fp8_variant():
    from sokuji_sidecar import catalog
    for mid, fp8_repo in [("hy-mt2-7b", "tencent/Hy-MT2-7B-FP8"),
                          ("hy-mt2-1.8b", "tencent/Hy-MT2-1.8B-FP8")]:
        m = catalog.translate_model(mid)
        fp8 = [d for d in m.deployments if d.compute_type == "fp8"]
        assert len(fp8) == 1
        assert fp8[0].tier == "gpu-cuda"
        assert fp8[0].backend == "hunyuan_translate"
        assert fp8[0].artifact == fp8_repo
        assert fp8[0].min_capability == (8, 9)
        # bf16 + cpu still present, bf16 has no capability gate
        bf16 = next(d for d in m.deployments if d.tier == "gpu-cuda" and d.compute_type == "bfloat16")
        assert bf16.min_capability is None
        assert any(d.tier == "cpu" for d in m.deployments)


def test_gemma_has_no_fp8_variant():
    from sokuji_sidecar import catalog
    g = catalog.translate_model("translategemma-4b")
    assert not any(d.compute_type == "fp8" for d in g.deployments)


def test_opus_rows_present_with_expected_shape():
    from sokuji_sidecar import catalog
    m = catalog.translate_model("opus-mt-zh-en")
    assert m is not None
    assert m.name == "Opus-MT (zh → en)"
    backends = {d.backend for d in m.deployments}
    tiers = [d.tier for d in m.deployments]
    assert backends == {"opus_translate"}
    assert tiers == ["gpu-cuda", "cpu"]            # no fp8 variant
    assert [d.compute_type for d in m.deployments] == ["bfloat16", "float32"]
    assert all(d.artifact == "Helsinki-NLP/opus-mt-zh-en" for d in m.deployments)


def test_opus_en_ja_uses_jap_repo_but_ja_display():
    from sokuji_sidecar import catalog
    m = catalog.translate_model("opus-mt-en-jap")
    assert m is not None
    assert m.name == "Opus-MT (en → ja)"           # display maps jap→ja
    assert m.deployments[0].artifact == "Helsinki-NLP/opus-mt-en-jap"


def test_all_13_opus_pairs_registered():
    from sokuji_sidecar import catalog
    ids = {m.id for m in catalog.translate_models()}
    for pid in ["opus-mt-ru-en", "opus-mt-zh-en", "opus-mt-en-zh", "opus-mt-hu-en",
                "opus-mt-en-es", "opus-mt-en-ar", "opus-mt-en-ru", "opus-mt-es-en",
                "opus-mt-en-vi", "opus-mt-ar-en", "opus-mt-ja-en", "opus-mt-en-jap",
                "opus-mt-ko-en"]:
        assert pid in ids, pid


def test_hymt15_translate_rows():
    from sokuji_sidecar import catalog
    for mid, repo in [("hy-mt15-1.8b", "tencent/HY-MT1.5-1.8B"),
                      ("hy-mt15-7b", "tencent/HY-MT1.5-7B")]:
        h = catalog.translate_model(mid)
        assert h is not None and all(d.backend == "hunyuan_translate" for d in h.deployments)
        assert h.deployments[0].artifact == repo
        gpu = next(d for d in h.deployments if d.tier == "gpu-cuda" and d.compute_type == "bfloat16")
        cpu = next(d for d in h.deployments if d.tier == "cpu")
        assert gpu.compute_type == "bfloat16" and cpu.compute_type == "float32"


def test_hymt15_has_fp8_variant():
    from sokuji_sidecar import catalog
    for mid, fp8_repo in [("hy-mt15-1.8b", "tencent/HY-MT1.5-1.8B-FP8"),
                          ("hy-mt15-7b", "tencent/HY-MT1.5-7B-FP8")]:
        m = catalog.translate_model(mid)
        fp8 = [d for d in m.deployments if d.compute_type == "fp8"]
        assert len(fp8) == 1
        assert fp8[0].tier == "gpu-cuda"
        assert fp8[0].backend == "hunyuan_translate"
        assert fp8[0].artifact == fp8_repo
        assert fp8[0].min_capability == (8, 9)


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
