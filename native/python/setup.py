"""Platform-tagged pure-Python wheel: py3-none-<platform>.

Two things come from outside this file. The platform tag is SOKUJI_NATIVE_PLAT (set by
CI, e.g. manylinux_2_39_x86_64, win_amd64, macosx_11_0_arm64), falling back to the
running interpreter's platform. The version is the one native/CMakeLists.txt stamped
into the staged contract.json, so a wheel can never claim a version its library does
not report; without a staged tree (a source checkout, an editable install before any
build) there is nothing to claim, and the version is 0.0.0."""
import json
import os
import pathlib
import sysconfig

from setuptools import setup
from setuptools.command.bdist_wheel import bdist_wheel as _bdist_wheel

CONTRACT = pathlib.Path(__file__).parent / "sokuji_native" / "_native" / "contract.json"


def native_version() -> str:
    try:
        with CONTRACT.open(encoding="utf-8") as fh:
            return json.load(fh)["version"]
    except (OSError, ValueError, KeyError):
        return "0.0.0"


class bdist_wheel(_bdist_wheel):
    def finalize_options(self):
        super().finalize_options()
        self.root_is_pure = False

    def get_tag(self):
        plat = os.environ.get("SOKUJI_NATIVE_PLAT") or sysconfig.get_platform().replace("-", "_").replace(".", "_")
        return "py3", "none", plat


setup(version=native_version(), cmdclass={"bdist_wheel": bdist_wheel})
