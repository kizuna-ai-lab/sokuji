"""Structure check for the SKU-bundle CI workflow. Text asserts run everywhere;
a full YAML parse runs only when PyYAML is present (importorskip)."""
import pathlib

import pytest

WF = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows" / "sidecar-bundles.yml"


def test_workflow_names_all_skus_and_runners():
    text = WF.read_text()
    for sku in ("linux-nvidia", "linux-arm64", "win-nvidia", "win-directml", "mac"):
        assert sku in text, sku
    for runner in ("ubuntu-latest", "ubuntu-24.04-arm", "windows-latest", "macos-14"):
        assert runner in text, runner
    assert "build-sidecar-bundle.py" in text
    assert "--archive" in text
    assert "actions/upload-artifact@v4" in text


def test_workflow_is_valid_yaml_with_five_jobs():
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(WF.read_text())
    assert {"build-linux", "build-linux-arm", "build-windows", "build-mac",
            "release"} <= set(doc["jobs"])
    assert doc["jobs"]["build-windows"]["strategy"]["matrix"]["sku"] == ["win-nvidia", "win-directml"]
    assert doc["jobs"]["release"]["needs"] == [
        "build-linux", "build-linux-arm", "build-windows", "build-mac"]


def test_linux_arm_job_boot_smokes_the_packed_bundle():
    """The arm job runs ON the target arch, so it can afford what the x64 jobs
    can't: unpack the .tar.zst it just built and boot the bundled interpreter
    to the {"port": n} handshake (catches exec-format/symlink/perm regressions)."""
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(WF.read_text())
    job = doc["jobs"]["build-linux-arm"]
    assert job["runs-on"] == "ubuntu-24.04-arm"
    smoke = [s for s in job["steps"]
             if "sokuji_sidecar" in str(s.get("run", "")) and "port" in str(s.get("run", ""))]
    assert smoke, "arm job must boot the bundle to the port handshake"
    # the smoke boots the UNPACKED ARCHIVE (cat handles split .001 parts too)
    assert any("tar.zst" in str(s["run"]) for s in smoke)


def test_workflow_publishes_prerelease_on_sidecar_tags():
    text = WF.read_text()
    assert "sidecar-v*" in text                    # tag trigger
    assert "softprops/action-gh-release" in text   # same publisher as app releases
    assert "prerelease: true" in text              # never the repo's "latest" (electron-updater)
    assert "--merge-fragments" in text             # merged manifest.json asset
    assert "sidecarVersion" in text                # tag == package.json guard


def test_workflow_is_hardened():
    # Least-privilege token + no credential persistence on checkout (zizmor posture).
    text = WF.read_text()
    assert text.count("persist-credentials: false") == 5, "all five checkouts must opt out"
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(text)
    assert doc["permissions"] == {"contents": "read"}
    # Only the release job escalates, and only to publish the release assets.
    assert doc["jobs"]["release"]["permissions"] == {"contents": "write"}
