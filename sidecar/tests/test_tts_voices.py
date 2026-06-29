import json, os
from sokuji_sidecar import tts_voices

def test_list_builtin_voice_names_reads_manifest_without_model_load(tmp_path, monkeypatch):
    # Lay out a fake snapshot with a manifest containing two voices.
    snap = tmp_path / "snap"
    (snap / "MOSS-TTS-Nano-100M-ONNX").mkdir(parents=True)
    manifest = {"builtin_voices": [{"voice": "Ava"}, {"voice": "Junhao"}]}
    (snap / "MOSS-TTS-Nano-100M-ONNX" / "browser_poc_manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(tts_voices, "_snapshot_dir", lambda repo: str(snap))
    assert tts_voices.list_builtin_voice_names("any/repo") == ["Ava", "Junhao"]

def test_list_builtin_voice_names_empty_when_absent(monkeypatch):
    def boom(repo):
        raise FileNotFoundError("not downloaded")
    monkeypatch.setattr(tts_voices, "_snapshot_dir", boom)
    assert tts_voices.list_builtin_voice_names("any/repo") == []

import asyncio
from sokuji_sidecar import tts_engine

def test_handler_returns_voices(monkeypatch):
    monkeypatch.setattr("sokuji_sidecar.tts_voices.list_builtin_voice_names", lambda model=None: ["Ava"])
    state = {}; tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["list_tts_voices"](state, {"id": 1, "type": "list_tts_voices"}, None, None))
    assert reply == {"type": "list_tts_voices_result", "id": 1, "voices": ["Ava"]}


def test_list_builtin_voice_names_resolves_catalog_id_to_repo(tmp_path, monkeypatch):
    # The renderer passes the catalog SHORT id ('moss-tts-nano'), not the HF repo.
    # list_builtin_voice_names must resolve it to the catalog's LM repo before
    # snapshot_download, else snapshot_download('moss-tts-nano') fails → [].
    from sokuji_sidecar import tts_voices, catalog
    snap = tmp_path / "snap"
    (snap / "MOSS-TTS-Nano-100M-ONNX").mkdir(parents=True)
    (snap / "MOSS-TTS-Nano-100M-ONNX" / "browser_poc_manifest.json").write_text(
        '{"builtin_voices": [{"voice": "Ava"}, {"voice": "Bella"}]}')
    seen = {}
    def fake_snap(repo):
        seen["repo"] = repo
        return str(snap)
    monkeypatch.setattr(tts_voices, "_snapshot_dir", fake_snap)
    out = tts_voices.list_builtin_voice_names("moss-tts-nano")
    assert out == ["Ava", "Bella"]
    expected_repo = catalog.tts_model("moss-tts-nano").repos[0]
    assert seen["repo"] == expected_repo and seen["repo"] != "moss-tts-nano"
