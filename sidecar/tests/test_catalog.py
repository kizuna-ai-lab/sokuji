from sokuji_sidecar import catalog


def test_models_have_deployments_and_languages():
    for m in catalog.asr_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        for d in m.deployments:
            assert d.backend in {"ctranslate2", "sherpa", "transformers", "qwen3asr",
                                 "cohere_transformers", "voxtral_realtime", "funasr_sensevoice"}


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
        ("funasr_sensevoice", "gpu-cuda", "float16"),
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
