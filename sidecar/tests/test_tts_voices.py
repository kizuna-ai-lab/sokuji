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


def test_supertonic_presets_without_download():
    v = tts_voices.list_builtin_voices("supertonic-3")
    assert [x["name"] for x in v] == ["Sarah", "Lily", "Jessica", "Olivia", "Emily",
                                       "Alex", "James", "Robert", "Sam", "Daniel"]
    assert next(x for x in v if x["name"] == "Robert")["default"] is True
    assert all(x["gender"] in ("F", "M") for x in v)


def test_qwen3_bundled_preset_voices_from_manifest(tmp_path, monkeypatch):
    # Generic voices/manifest.json branch: any TTS model may bundle ICL preset
    # voices this way, not just qwen3 — verified against the qwen3 catalog row.
    entries = [
        {"name": "Orion", "gender": "M", "default": True},
        {"name": "Leo", "gender": "M"},
        {"name": "Atlas", "gender": "M"},
        {"name": "Luna", "gender": "F"},
        {"name": "Nova", "gender": "F"},
        {"name": "Iris", "gender": "F"},
    ]
    snap = tmp_path / "snap"
    (snap / "voices").mkdir(parents=True)
    (snap / "voices" / "manifest.json").write_text(json.dumps(entries))
    monkeypatch.setattr(tts_voices, "_snapshot_dir", lambda repo: str(snap))
    out = tts_voices.list_builtin_voices("qwen3-tts-0.6b")
    assert [v["name"] for v in out] == ["Orion", "Leo", "Atlas", "Luna", "Nova", "Iris"]
    assert all(v["language"] is None and v["curated"] is True and v["unstable"] is False for v in out)
    genders = {v["name"]: v["gender"] for v in out}
    assert genders == {"Orion": "M", "Leo": "M", "Atlas": "M", "Luna": "F", "Nova": "F", "Iris": "F"}
    defaults = {v["name"]: v["default"] for v in out}
    assert defaults == {"Orion": True, "Leo": False, "Atlas": False,
                        "Luna": False, "Nova": False, "Iris": False}


def test_qwen3_without_bundled_voices_dir_falls_through_to_empty(tmp_path, monkeypatch):
    # Snapshot exists but has no voices/ dir (and no MOSS-style manifest either)
    # → generic branch falls through, MOSS-manifest path also fails → [].
    snap = tmp_path / "snap"
    snap.mkdir()
    monkeypatch.setattr(tts_voices, "_snapshot_dir", lambda repo: str(snap))
    assert tts_voices.list_builtin_voices("qwen3-tts-0.6b") == []


def test_pocket_bundled_voice_manifest_listing(monkeypatch, tmp_path):
    # Pocket rides the generic bundled-voices branch: the mirror repo ships
    # voices/manifest.json (staged by scripts/mirror_pocket_tts.py), so voice
    # listing needs no pocket-specific code path.
    from sokuji_sidecar import tts_voices
    vdir = tmp_path / "voices"
    vdir.mkdir()
    (vdir / "manifest.json").write_text(json.dumps(
        [{"name": "alba", "default": True}] + [{"name": n} for n in
         ["azelma", "cosette", "eponine", "fantine", "javert", "jean", "marius"]]))
    monkeypatch.setattr(tts_voices, "_snapshot_dir", lambda repo: str(tmp_path))
    out = tts_voices.list_builtin_voices("pocket-tts-en")
    assert len(out) == 8
    assert [v["name"] for v in out][:2] == ["alba", "azelma"]
    assert out[0]["default"] is True and out[1]["default"] is False
