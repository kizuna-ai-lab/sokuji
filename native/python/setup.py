"""Platform-tagged binary wheel with no compiled Python extension: py3-none-<platform>.

Two things come from outside this file. The platform tag is SOKUJI_NATIVE_PLAT (set by
CI, e.g. manylinux_2_39_x86_64, win_amd64, macosx_11_0_arm64), falling back to the
running interpreter's platform. The version is the one native/CMakeLists.txt stamped
into the staged contract.json, so a wheel can never claim a version its library does
not report. A wheel build without a staged tree (`sokuji_native/_native/` missing —
a source checkout before any `native/ci/build.sh`) is refused: such a wheel would
install but could never load, and a 0.0.0 version would only hide that."""
import json
import os
import pathlib
import sys
import sysconfig

from setuptools import setup
from setuptools.command.bdist_wheel import bdist_wheel as _bdist_wheel
from setuptools.dist import Distribution

NATIVE = pathlib.Path(__file__).parent / "sokuji_native" / "_native"
CONTRACT = NATIVE / "contract.json"


def _library_name() -> str:
    if sys.platform == "win32":
        return "sokuji_native.dll"
    if sys.platform == "darwin":
        return "libsokuji_native.dylib"
    return "libsokuji_native.so"


def native_version() -> str:
    if not CONTRACT.is_file():
        raise SystemExit(f"setup.py: no staged native payload at {NATIVE} — run native/ci/build.sh "
                         "(or cmake --install … --component sokuji) before building the wheel")
    lib = NATIVE / _library_name()
    if not lib.is_file():
        raise SystemExit(f"setup.py: staged payload at {NATIVE} has contract.json but no {lib.name} — "
                         "a partial stage would build a wheel that cannot load")
    with CONTRACT.open(encoding="utf-8") as fh:
        return json.load(fh)["version"]


class BinaryDistribution(Distribution):
    """Tell setuptools this is a platform-specific package. Without it the package is
    laid out as pure Python (`<name>.data/purelib/`) with shared libraries inside — pip
    installs that, but it is the wrong shape for a binary wheel and auditwheel rejects it
    as "not platlib compliant". With it the package sits at the wheel root (platlib)."""

    def has_ext_modules(self):
        return True


class bdist_wheel(_bdist_wheel):
    def get_tag(self):
        # has_ext_modules() would otherwise stamp the interpreter (cp312-cp312-…); the
        # library is reached through ctypes, so any Python 3 works: py3-none-<platform>.
        plat = os.environ.get("SOKUJI_NATIVE_PLAT") or sysconfig.get_platform().replace("-", "_").replace(".", "_")
        return "py3", "none", plat


setup(version=native_version(), distclass=BinaryDistribution, cmdclass={"bdist_wheel": bdist_wheel})
