"""Platform-tagged pure-Python wheel: py3-none-<platform>. The platform tag comes from
SOKUJI_NATIVE_PLAT (set by CI, e.g. manylinux_2_28_x86_64, win_amd64,
macosx_11_0_arm64); locally it falls back to the running interpreter's platform."""
import os
import sysconfig

from setuptools import setup
from setuptools.command.bdist_wheel import bdist_wheel as _bdist_wheel


class bdist_wheel(_bdist_wheel):
    def finalize_options(self):
        super().finalize_options()
        self.root_is_pure = False

    def get_tag(self):
        plat = os.environ.get("SOKUJI_NATIVE_PLAT") or sysconfig.get_platform().replace("-", "_").replace(".", "_")
        return "py3", "none", plat


setup(cmdclass={"bdist_wheel": bdist_wheel})
