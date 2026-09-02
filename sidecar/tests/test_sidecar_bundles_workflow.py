"""Structure check for the SKU-bundle CI workflow. Text asserts run everywhere;
a full YAML parse runs only when PyYAML is present (importorskip)."""
import pathlib

import pytest

WF = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows" / "sidecar-bundles.yml"

BUILD_JOBS = ["build-linux-x64", "build-linux-arm64", "build-win-x64",
              "build-mac-arm64", "build-mac-x64"]


def test_workflow_names_all_skus_and_runners():
    text = WF.read_text()
    for sku in ("linux-x64", "linux-arm64", "win-x64", "mac-arm64", "mac-x64"):
        assert sku in text, sku
    for runner in ("ubuntu-22.04", "ubuntu-22.04-arm", "windows-2022", "macos-14", "macos-15-intel"):
        assert runner in text, runner
    assert "build-sidecar-bundle.py" in text
    assert "--archive" in text
    assert "actions/upload-artifact@v6" in text
    assert "actions/download-artifact@v7" in text
    # Old GPU-vendor SKU vocabulary must be fully gone (spec §7 rename).
    for old in ("linux-nvidia", "win-nvidia", "win-directml"):
        assert old not in text, old


def test_workflow_is_valid_yaml_with_five_build_jobs_and_release():
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(WF.read_text())
    assert set(BUILD_JOBS) | {"release"} == set(doc["jobs"])
    # Each build job invokes build-sidecar-bundle.py with its own --sku, no
    # matrix strategy (five platform-named jobs, one SKU each).
    for job_name, sku in zip(BUILD_JOBS,
                              ("linux-x64", "linux-arm64", "win-x64", "mac-arm64", "mac-x64")):
        job = doc["jobs"][job_name]
        assert "strategy" not in job
        steps_text = " ".join(str(s.get("run", "")) for s in job["steps"])
        assert f"--sku {sku}" in steps_text, job_name
    assert doc["jobs"]["release"]["needs"] == BUILD_JOBS


def test_runner_choices_mirror_native_build_workflow():
    # Same runner-per-SKU choices as native-build.yml (spec §7).
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(WF.read_text())
    expected = {
        "build-linux-x64": "ubuntu-22.04",
        "build-linux-arm64": "ubuntu-22.04-arm",
        "build-win-x64": "windows-2022",
        "build-mac-arm64": "macos-14",
        "build-mac-x64": "macos-15-intel",
    }
    for job_name, runner in expected.items():
        assert doc["jobs"][job_name]["runs-on"] == runner, job_name


def test_linux_arm_job_boot_smokes_the_packed_bundle():
    """The arm job runs ON the target arch, so it can afford what the x64 jobs
    can't: unpack the .tar.zst it just built and boot the bundled interpreter
    to the {"port": n} handshake (catches exec-format/symlink/perm regressions)."""
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(WF.read_text())
    job = doc["jobs"]["build-linux-arm64"]
    assert job["runs-on"] == "ubuntu-22.04-arm"
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
    assert text.count("persist-credentials: false") == 6, "all six checkouts must opt out"
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(text)
    assert doc["permissions"] == {"contents": "read"}
    # Only the release job escalates, and only to publish the release assets.
    assert doc["jobs"]["release"]["permissions"] == {"contents": "write"}


def test_bundle_size_reported_to_job_summary_in_every_build_job_and_release():
    """Mirrors native-build.yml:98-100's `ls -la ... | tee -a
    "$GITHUB_STEP_SUMMARY"` pattern: every per-SKU build job must report its
    archive size (and manifest fragment byte counts), and the release job
    must report a combined listing after merging the per-SKU fragments."""
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(WF.read_text())
    for job_name in BUILD_JOBS:
        steps = doc["jobs"][job_name]["steps"]
        size_steps = [s for s in steps if "GITHUB_STEP_SUMMARY" in str(s.get("run", ""))]
        assert size_steps, f"{job_name} must report bundle size to the job summary"
    release_steps = doc["jobs"]["release"]["steps"]
    assert any("GITHUB_STEP_SUMMARY" in str(s.get("run", "")) for s in release_steps), \
        "release job must report a combined size summary"
