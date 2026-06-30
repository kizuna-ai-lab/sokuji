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


def test_list_builtin_voices_annotates_names_with_metadata(monkeypatch):
    monkeypatch.setattr(tts_voices, "list_builtin_voice_names",
                        lambda model=None: ["Ava", "Adam", "Xiaoyu", "Mortis"])
    out = {v["name"]: v for v in tts_voices.list_builtin_voices("moss-tts-nano")}
    assert out["Ava"] == {"name": "Ava", "language": "en", "curated": True,
                          "unstable": False, "default": True}
    assert out["Adam"]["unstable"] is True and out["Adam"]["curated"] is False
    assert out["Xiaoyu"]["default"] is True and out["Xiaoyu"]["language"] == "zh"
    # A voice with no language entry is never a per-language default.
    assert out["Mortis"]["language"] is None and out["Mortis"]["default"] is False
