import types

from sokuji_sidecar import catalog, tts_voices


class _FakeEngine:
    def __init__(self, model_id, voices, is_loaded=True):
        self.model_id = model_id
        self.is_loaded = is_loaded
        self._voices = voices

    def list_builtin_voices(self):
        return self._voices


def test_engine_loaded_model_matches_asks_backend_directly():
    eng = _FakeEngine("pocket-tts-en", ["alba", "azelma"])
    assert tts_voices.list_builtin_voices("pocket-tts-en", eng) == ["alba", "azelma"]


def test_engine_loaded_but_different_model_falls_through(monkeypatch):
    eng = _FakeEngine("pocket-tts-en", ["alba"])
    monkeypatch.setattr(catalog, "tts_model", lambda mid: None)
    assert tts_voices.list_builtin_voices("supertonic-3", eng) == []


def test_no_model_id_uses_whatever_is_loaded():
    eng = _FakeEngine("moss-tts-nano", ["Ava", "Bella"])
    assert tts_voices.list_builtin_voices(None, eng) == ["Ava", "Bella"]


def test_no_engine_and_no_model_id_returns_empty():
    assert tts_voices.list_builtin_voices(None, None) == []


def _fake_card(family, artifact="acme/repo/pocket_tts-en/model.gguf"):
    return types.SimpleNamespace(
        family=family, deployments=[types.SimpleNamespace(artifact=artifact)])


def test_supertonic_load_free_listing_reads_voice_styles(monkeypatch, tmp_path):
    card = _fake_card("supertonic", artifact="acme/repo/supertonic/model.gguf")
    monkeypatch.setattr(catalog, "tts_model", lambda mid: card)
    vdir = tmp_path / "supertonic" / "voice_styles"
    vdir.mkdir(parents=True)
    (vdir / "Robert.json").write_text("{}")
    (vdir / "Sarah.json").write_text("{}")
    monkeypatch.setattr(tts_voices, "_scoped_snapshot_dir", lambda repo, subdir: tmp_path)
    out = tts_voices.list_builtin_voices("supertonic-3", None)
    assert out == ["Robert", "Sarah"]


def test_pocket_load_free_listing_reads_embeddings(monkeypatch, tmp_path):
    card = _fake_card("pocket_tts", artifact="acme/repo/pocket_tts-en/model.gguf")
    monkeypatch.setattr(catalog, "tts_model", lambda mid: card)
    vdir = tmp_path / "pocket_tts-en" / "embeddings"
    vdir.mkdir(parents=True)
    (vdir / "alba.safetensors").write_bytes(b"")
    (vdir / "azelma.safetensors").write_bytes(b"")
    monkeypatch.setattr(tts_voices, "_scoped_snapshot_dir", lambda repo, subdir: tmp_path)
    out = tts_voices.list_builtin_voices("pocket-tts-en", None)
    assert out == ["alba", "azelma"]


def test_scoped_snapshot_dir_receives_repo_and_scoped_subdir(monkeypatch):
    card = _fake_card("pocket_tts", artifact="acme/pocket-repo/pocket_tts-en/model.gguf")
    monkeypatch.setattr(catalog, "tts_model", lambda mid: card)
    seen = {}

    def fake_scoped(repo, subdir):
        seen["repo"], seen["subdir"] = repo, subdir
        return None

    monkeypatch.setattr(tts_voices, "_scoped_snapshot_dir", fake_scoped)
    assert tts_voices.list_builtin_voices("pocket-tts-en", None) == []
    assert seen == {"repo": "acme/pocket-repo", "subdir": "pocket_tts-en/embeddings"}


def test_families_without_load_free_presets_return_empty(monkeypatch):
    for family in ("moss_tts_nano", "qwen3_tts", "omnivoice", ""):
        card = _fake_card(family)
        monkeypatch.setattr(catalog, "tts_model", lambda mid, c=card: c)
        assert tts_voices.list_builtin_voices("some-model", None) == []


def test_no_deployments_returns_empty(monkeypatch):
    card = types.SimpleNamespace(family="supertonic", deployments=())
    monkeypatch.setattr(catalog, "tts_model", lambda mid: card)
    assert tts_voices.list_builtin_voices("supertonic-3", None) == []


def test_snapshot_resolution_failure_returns_empty(monkeypatch):
    card = _fake_card("supertonic")
    monkeypatch.setattr(catalog, "tts_model", lambda mid: card)
    monkeypatch.setattr(tts_voices, "_scoped_snapshot_dir", lambda repo, subdir: None)
    assert tts_voices.list_builtin_voices("supertonic-3", None) == []


def test_missing_voices_dir_returns_empty(monkeypatch, tmp_path):
    card = _fake_card("supertonic", artifact="acme/repo/supertonic/model.gguf")
    monkeypatch.setattr(catalog, "tts_model", lambda mid: card)
    monkeypatch.setattr(tts_voices, "_scoped_snapshot_dir", lambda repo, subdir: tmp_path)
    # tmp_path/supertonic/voice_styles was never created.
    assert tts_voices.list_builtin_voices("supertonic-3", None) == []
