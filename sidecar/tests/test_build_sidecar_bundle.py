"""Pure-helper tests for the bundle build script. The full linux build is a
manual acceptance step in the plan (needs network + wheels), not a unit test."""
import importlib.util
import pathlib
import platform

import pytest

# scripts/build-sidecar-bundle.py has a hyphen in its filename (it doubles as
# a CLI entry point invoked as `python scripts/build-sidecar-bundle.py ...`
# from CI), so it is not a valid `import` target — a plain `import
# build_sidecar_bundle` can never resolve a hyphenated file. Load it directly
# from its path instead, bound to the same `b` name the tests below use.
_SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "build-sidecar-bundle.py"
_spec = importlib.util.spec_from_file_location("build_sidecar_bundle", _SCRIPT)
b = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b)


def test_sku_triple_mapping():
    assert b.SKU_TRIPLE["linux-nvidia"] == "x86_64-unknown-linux-gnu"
    assert b.SKU_TRIPLE["win-nvidia"] == "x86_64-pc-windows-msvc"
    assert b.SKU_TRIPLE["win-directml"] == "x86_64-pc-windows-msvc"
    assert b.SKU_TRIPLE["mac"] == "aarch64-apple-darwin"


def test_sku_requirements_mapping():
    assert b.sku_requirements("linux-nvidia") == "requirements-nvidia.txt"
    assert b.sku_requirements("win-nvidia") == "requirements-nvidia.txt"
    assert b.sku_requirements("win-directml") == "requirements-directml.txt"
    assert b.sku_requirements("mac") == "requirements-mac.txt"
    with pytest.raises(KeyError):
        b.sku_requirements("bogus")


def test_select_python_asset_picks_install_only_not_stripped():
    assets = [
        {"name": "cpython-3.12.8+20241219-x86_64-unknown-linux-gnu-install_only.tar.gz",
         "browser_download_url": "URL-A"},
        {"name": "cpython-3.12.8+20241219-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
         "browser_download_url": "URL-STRIPPED"},
        {"name": "cpython-3.12.8+20241219-x86_64-pc-windows-msvc-install_only.tar.gz",
         "browser_download_url": "URL-WIN"},
        {"name": "cpython-3.11.9+20240101-x86_64-unknown-linux-gnu-install_only.tar.gz",
         "browser_download_url": "URL-OLD-SERIES"},
    ]
    assert b.select_python_asset(assets, "x86_64-unknown-linux-gnu") == "URL-A"
    assert b.select_python_asset(assets, "x86_64-pc-windows-msvc") == "URL-WIN"
    with pytest.raises(SystemExit):
        b.select_python_asset(assets, "aarch64-apple-darwin")


def test_bundle_dirname():
    assert b.bundle_dirname("linux-nvidia", "0.30.6") == "sidecar-linux-nvidia-v0.30.6"


def test_host_supports_sku_matches_platform():
    assert b.host_supports_sku("linux-nvidia") == (platform.system() == "Linux")
    assert b.host_supports_sku("win-nvidia") == (platform.system() == "Windows")
    assert b.host_supports_sku("mac") == (
        platform.system() == "Darwin" and platform.machine() == "arm64")
