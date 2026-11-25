"""The golden exporter (sidecar/tools/export_goldens.py) writes the vectors the TypeScript engine is held to: the same
files, byte for byte, on every run, and the catalog and planner as the sidecar has them."""
import json
import os
import subprocess
import sys

TOOL = os.path.join(os.path.dirname(__file__), "..", "tools", "export_goldens.py")
FILES = ("catalog", "characterization", "planner", "gguf", "prompts", "dsp_asr", "dsp_tts", "specs")


def _run(out):
    subprocess.run([sys.executable, TOOL, "--out", str(out)], check=True, capture_output=True, text=True)


def test_two_runs_write_the_same_eight_files(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    _run(a)
    _run(b)
    assert sorted(os.listdir(a)) == sorted(f"{name}.json" for name in FILES)
    for name in FILES:
        assert (a / f"{name}.json").read_bytes() == (b / f"{name}.json").read_bytes(), name


def test_catalog_and_characterization_hold_what_the_sidecar_has(tmp_path):
    _run(tmp_path)
    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert catalog["generator"] == "export_goldens.py" and catalog["sidecar_commit"]
    kinds = [case["kind"] for case in catalog["cases"]]
    assert (kinds.count("asr"), kinds.count("translate"), kinds.count("tts")) == (67, 11, 14)
    characterization = json.loads((tmp_path / "characterization.json").read_text())
    errors = [c["result"] for c in characterization["cases"] if isinstance(c["result"], dict) and "error" in c["result"]]
    assert any(e["error"] == "NoUsablePlan" for e in errors)
