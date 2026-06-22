from sokuji_sidecar import catalog


def test_models_have_deployments_and_languages():
    for m in catalog.asr_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        for d in m.deployments:
            assert d.backend in {"ctranslate2", "sherpa", "transformers"}


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


def test_sense_voice_uses_sherpa_whisper_uses_ctranslate2():
    assert catalog.asr_model("sense-voice").deployments[0].backend == "sherpa"
    assert catalog.asr_model("whisper-tiny").deployments[0].backend == "ctranslate2"


def test_granite_language_regression():
    assert catalog.asr_model("granite-speech-4.1-2b").languages == ("en", "fr", "de", "es", "pt", "ja")
    assert catalog.asr_model("granite-speech-4.1-2b-plus").languages == ("en", "fr", "de", "es", "pt")
