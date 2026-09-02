"""Gate for the Linux wheels: what the staged shared objects may depend on.

usage: check_linux_deps.py <stage_dir> <wheel platform tag>

The wheels are tagged manylinux_2_<N>_* (the glibc floor of the runner that built
them). Two things would make that tag a lie, and neither is visible from a green
build: a DT_NEEDED on a library that is not on every glibc-2.<N> system, or a
versioned glibc symbol newer than 2.<N>. This checks both with readelf, on the
staged tree, before the wheel is built.

The Vulkan loader (libvulkan.so.1) is allowed: ggml's Vulkan backend links it, as
every Vulkan program does, and a machine without it simply gets no Vulkan device
(ggml skips a module it cannot dlopen). auditwheel cannot be the gate here for that
reason — it has no "known external" allowance for `show`, only `repair --exclude`.
"""
import pathlib
import re
import subprocess
import sys

ALLOWED = {"libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0", "librt.so.1",
           "libgcc_s.so.1", "libstdc++.so.6", "libvulkan.so.1"}
ALLOWED_PREFIXES = ("ld-linux-",)

# The manylinux tag floors GLIBC, but says nothing about libstdc++ (allowed above as a
# system library): a glibc-2.39 host may run an older C++ runtime. Bound the C++ symbol
# versions to what the tag era's toolchain ships — GCC 13 (Ubuntu 24.04, the build
# runner) for the 2.39 tags: GLIBCXX_3.4.33 / CXXABI_1.3.15. A tag missing here gets
# no C++ bound (and says so), never a wrong one.
# The 2.35 row (R37, Ubuntu 22.04's floor) is GCC 12's runtime — Ubuntu 22.04 ships
# libstdc++6 from gcc-12 even though its default g++ is 11.4, so a build with the
# distro's default compiler still links the gcc-12 shared library. Measured on the
# real jammy validation box (glibc 2.35, gcc 11.4.0):
# GLIBCXX_3.4.30 / CXXABI_1.3.13 — see .superpowers/linux-x64-vulkan-validation.md §5.
CXX_CEILINGS = {
    (2, 39): {"GLIBCXX": (3, 4, 33), "CXXABI": (1, 3, 15)},
    (2, 35): {"GLIBCXX": (3, 4, 30), "CXXABI": (1, 3, 13)},
}


def readelf(*args: str) -> str:
    return subprocess.run(["readelf", "-W", *args], check=True, capture_output=True, text=True).stdout


def main() -> int:
    stage = pathlib.Path(sys.argv[1])
    plat = sys.argv[2]
    m = re.match(r"manylinux_(\d+)_(\d+)_", plat)
    if not m:
        print(f"check_linux_deps: not a manylinux tag, nothing to check: {plat}")
        return 0
    floor = (int(m.group(1)), int(m.group(2)))

    elves = sorted(p for p in stage.rglob("*") if p.is_file() and ".so" in p.name)
    shipped = {p.name for p in elves}
    problems: list[str] = []
    for path in elves:
        needed = re.findall(r"\(NEEDED\)\s+Shared library: \[([^\]]+)\]", readelf("-d", str(path)))
        for lib in needed:
            if lib in ALLOWED or lib in shipped or lib.startswith(ALLOWED_PREFIXES):
                continue
            problems.append(f"{path.name}: needs {lib}, which is neither shipped nor a system library on every host")
        dyn_syms = readelf("--dyn-syms", str(path))
        versions = {tuple(int(x) for x in v.split(".")) for v in re.findall(r"@+GLIBC_(\d+\.\d+)", dyn_syms)}
        too_new = sorted(v for v in versions if v > floor)
        if too_new:
            problems.append(f"{path.name}: references GLIBC_{'.'.join(map(str, too_new[-1]))} > tag floor {floor[0]}.{floor[1]}")
        for ns, ceiling in CXX_CEILINGS.get(floor, {}).items():
            found = {tuple(int(x) for x in v.split("."))
                     for v in re.findall(r"@+" + ns + r"_([0-9.]+)\b", dyn_syms)}
            over = sorted(v for v in found if v > ceiling)
            if over:
                problems.append(f"{path.name}: references {ns}_{'.'.join(map(str, over[-1]))} > "
                                f"ceiling {'.'.join(map(str, ceiling))} for {plat}")
    if floor not in CXX_CEILINGS:
        print(f"check_linux_deps: no C++ runtime ceiling known for glibc {floor[0]}.{floor[1]} — GLIBCXX/CXXABI unchecked")

    print(f"check_linux_deps: {len(elves)} shared objects, glibc floor {floor[0]}.{floor[1]} ({plat})")
    for p in problems:
        print("  " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
