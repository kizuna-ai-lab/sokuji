"""Gate: the staged tree carries exactly ONE ggml, and libsokuji_native carries none of it.

usage: check_single_ggml.py <stage_dir>

jiangzhuo's rule (2026-09-25): no duplicated module code in the sidecar bundle — every engine
links the single shared ggml. Each of transcribe.cpp, llama.cpp and audio.cpp vendors its own
ggml; three patch/guard lines keep them off it today. If an upstream ever builds its copy
anyway, the copy is linked statically with hidden visibility, so the stripped wheel's dynamic
symbol table cannot show it. This runs on the UNSTRIPPED stage (build.sh calls it before
strip) and checks:
  1. libsokuji_native defines none of ggml's core symbols (any binding: nm lists locals too).
     audiocpp_compat.h's static-inline shims are local ggml_* symbols by design, which is why
     this checks a fixed set of core names rather than every ggml_* symbol.
  2. every shared library in the stage is one we ship on purpose, and each appears once.
Linux and macOS (nm). The Windows lane (build.ps1) is not gated by this script.
"""
import pathlib
import re
import subprocess
import sys

CORE = ("ggml_init", "ggml_free", "ggml_graph_compute", "gguf_init_from_file",
        "ggml_backend_sched_new", "ggml_backend_load_all")
SHIPPED = re.compile(r"^lib(sokuji_native|ggml|ggml-base|ggml-cpu(-[A-Za-z0-9_.]+)?|ggml-vulkan|ggml-metal)"
                     r"\.(so|dylib)$")


def _nm(args: list[str]) -> tuple[set[str], bool]:
    """Defined symbol names, and whether nm had any symbol table to read at all."""
    r = subprocess.run(["nm", *args], capture_output=True, text=True)
    names = set()
    for line in r.stdout.splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[1] not in ("U", "w", "v"):
            names.add(parts[2][1:] if sys.platform == "darwin" and parts[2].startswith("_") else parts[2])
    readable = r.returncode == 0 and "no symbols" not in r.stderr and bool(r.stdout.strip())
    return names, readable


def defined_symbols(lib: pathlib.Path) -> set[str]:
    """Full symbol table (locals included) plus, on Linux, the dynamic table. Fails closed:
    a stripped library cannot prove it carries no second ggml, so that is an error, not a pass
    (seen while writing this gate: a stripped copy of libggml-base read as 'no ggml here')."""
    full, readable = _nm([str(lib)])
    if not readable:
        raise SystemExit(f"check_single_ggml: {lib.name} has no symbol table — run this on the "
                         f"unstripped stage (build.sh calls it before strip)")
    if sys.platform.startswith("linux"):
        full |= _nm(["-D", str(lib)])[0]
    return full


def main(stage: pathlib.Path) -> int:
    bad = []
    libs = [p for p in stage.rglob("*") if p.is_file() and re.search(r"\.(so|dylib)(\.|$)", p.name)]
    seen: dict[str, pathlib.Path] = {}
    for p in libs:
        if not SHIPPED.match(p.name):
            bad.append(f"unexpected shared library in the stage: {p.relative_to(stage)}")
        if p.name in seen:
            bad.append(f"duplicate: {p.relative_to(stage)} and {seen[p.name].relative_to(stage)}")
        seen[p.name] = p
    host = [p for p in libs if p.name.startswith("libsokuji_native.")]
    if len(host) != 1:
        bad.append(f"expected exactly one libsokuji_native, found {len(host)}")
    else:
        dup = sorted(set(CORE) & defined_symbols(host[0]))
        if dup:
            bad.append(f"{host[0].name} defines ggml core symbols (a second ggml is linked in): {dup}")
    for b in bad:
        print(f"check_single_ggml: {b}", file=sys.stderr)
    if not bad:
        print(f"check_single_ggml: OK — {len(libs)} shared libraries, one ggml")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(pathlib.Path(sys.argv[1])))
