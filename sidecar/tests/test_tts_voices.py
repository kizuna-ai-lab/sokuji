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
