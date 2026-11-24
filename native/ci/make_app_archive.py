#!/usr/bin/env python3
"""Pack the staged native libraries and the Node addon into the per-SKU app archive.

usage: make_app_archive.py <stage_dir> <sku> <version> <out_dir> [--build-dir D] [--notices-in F]
       make_app_archive.py --manifest <archive_dir> <version>

First form: <stage_dir> is the flat `cmake --install` tree of both install components
(`sokuji`: libsokuji_native, the ggml libraries and backend modules, contract.json; and
`sokuji_node`: sokuji_native_node.node). Writes into <out_dir>

    sokuji-native-<sku>-v<version>.tar.zst          one top-level directory of the same name,
                                                    holding the stage and NOTICES.txt
    sokuji-native-<sku>-v<version>.tar.zst.sha256   `sha256sum -c` format

Plan 3 (the app) downloads and unpacks exactly this, so the layout is a contract. The archive is
reproducible: entries sorted by name, mtime 0, uid/gid 0, no user names, modes by file kind,
zstd level 19 on one thread. The same stage gives the same bytes on any machine.

The script refuses (exit 1, nothing written) a stage that is missing the addon, contract.json or
the native library, that is not flat, whose contract.json names another version than <version>,
or whose NOTICES.in lists a license file that does not exist.

Second form (the release job): writes <archive_dir>/manifest.json,

    {"version": "1.2.1", "archives": {"<sku>": {"file": "...", "sha256": "...", "size": N}}}

from every sokuji-native-<sku>-v<version>.tar.zst in the directory, after checking each against
its .sha256 file. Other files in the directory (the wheels) are ignored.

Needs the `zstandard` module (pip install zstandard) for the first form; the manifest form is stdlib only.
"""
import argparse
import hashlib
import io
import json
import os
import pathlib
import re
import sys
import tarfile


HERE = pathlib.Path(__file__).resolve().parent
SRC_DIR = HERE.parent                      # native/
NODE_ADDON = "sokuji_native_node.node"
CONTRACT = "contract.json"
NOTICES = "NOTICES.txt"
NATIVE_LIBS = ("libsokuji_native.so", "libsokuji_native.dylib", "sokuji_native.dll")
SKU_RE = r"[a-z0-9]+(?:-[a-z0-9]+)+"       # linux-x64, mac-arm64
VERSION_RE = r"\d+\.\d+\.\d+(?:\.\d+)?"
ARCHIVE_RE = re.compile(rf"^sokuji-native-(?P<sku>{SKU_RE})-v(?P<version>{VERSION_RE})\.tar\.zst$")
SHA256_LINE_RE = re.compile(r"^(?P<hex>[0-9a-fA-F]{64}) [ *](?P<name>.+)$")
ZSTD_LEVEL = 19


class Failure(Exception):
    """A reason to refuse; main() prints it and exits 1."""


def sha256_of(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


# --------------------------------------------------------------------------- the archive

def check_stage(stage: pathlib.Path, version: str) -> list[pathlib.Path]:
    """The files to pack, sorted by name; raises Failure if the stage is not a valid one."""
    if not stage.is_dir():
        raise Failure(f"stage directory not found: {stage}")
    files = []
    for p in sorted(stage.iterdir(), key=lambda p: p.name):
        if p.is_symlink() or not p.is_file():
            kind = "a directory" if p.is_dir() else "not a regular file"
            raise Failure(f"the stage must be flat, regular files only: {p.name} is {kind}")
        files.append(p)
    names = {p.name for p in files}
    if NODE_ADDON not in names:
        raise Failure(f"{NODE_ADDON} is missing from the stage {stage} (install the sokuji_node component)")
    if CONTRACT not in names:
        raise Failure(f"{CONTRACT} is missing from the stage {stage} (install the sokuji component)")
    if not names & set(NATIVE_LIBS):
        raise Failure(f"no native library ({' | '.join(NATIVE_LIBS)}) in the stage {stage}")
    if NOTICES in names:
        raise Failure(f"the stage already has a {NOTICES}; the script generates it")
    try:
        contract = json.loads((stage / CONTRACT).read_text(encoding="utf-8"))
        have = contract["version"]
    except (ValueError, KeyError, TypeError) as e:
        raise Failure(f"{CONTRACT} is not a contract with a version: {e!r}") from e
    if have != version:
        raise Failure(f"{CONTRACT} says version {have}, but the archive is for {version}")
    return files


def read_notices_in(notices_in: pathlib.Path, build_dir: pathlib.Path) -> list[tuple[str, pathlib.Path]]:
    entries = []
    for n, line in enumerate(notices_in.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, bar, template = (s.strip() for s in line.partition("|"))
        if not bar or not name or not template:
            raise Failure(f"{notices_in}:{n}: expected `<name> | <license file>`")
        # Check the template before substituting, so a build path that contains '@' is fine.
        if "@" in template.replace("@BUILD@", "").replace("@SRC@", ""):
            raise Failure(f"{notices_in}:{n}: unknown placeholder in {template}")
        path = template.replace("@BUILD@", str(build_dir)).replace("@SRC@", str(SRC_DIR))
        entries.append((name, pathlib.Path(path)))
    if not entries:
        raise Failure(f"{notices_in} lists no upstreams")
    return entries


def build_notices(entries, sku: str, version: str) -> bytes:
    rule = "=" * 80
    parts = [f"sokuji-native {version} ({sku}): third-party notices\n\n"
             "This archive contains software from the projects below, each under the license\n"
             "reproduced after its name.\n"]
    for name, path in entries:
        if not path.is_file():
            raise Failure(f"license file of {name} not found: {path}")
        try:
            text = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError as e:
            raise Failure(f"license file of {name} is not UTF-8 text: {path}") from e
        text = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
        parts.append(f"\n{rule}\n{name}\n{rule}\n\n{text}\n")
    return "".join(parts).encode("utf-8")


def mode_of(name: str) -> int:
    """By kind, not by what this host's filesystem says, so every host agrees."""
    return 0o755 if name.endswith((".node", ".dll", ".dylib")) or re.search(r"\.so(\.\d+)*$", name) else 0o644


def tar_info(name: str, size: int, mode: int) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.size = size
    info.mode = mode
    info.type = tarfile.REGTYPE
    info.mtime = 0
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    return info


def write_archive(files, notices: bytes, top: str, dest: pathlib.Path) -> None:
    try:
        import zstandard          # only this step needs it; the manifest form runs without
    except ImportError:
        raise Failure("the zstandard module is required (pip install zstandard)") from None
    members = [(f"{top}/{p.name}", p, p.stat().st_size, mode_of(p.name)) for p in files]
    members.append((f"{top}/{NOTICES}", None, len(notices), 0o644))
    members.sort(key=lambda m: m[0])
    cctx = zstandard.ZstdCompressor(level=ZSTD_LEVEL, write_checksum=True)   # one thread: same bytes anywhere
    with open(dest, "wb") as raw, cctx.stream_writer(raw, closefd=False) as zst, \
            tarfile.open(fileobj=zst, mode="w|", format=tarfile.PAX_FORMAT) as tar:
        for name, path, size, mode in members:
            if path is None:
                tar.addfile(tar_info(name, size, mode), io.BytesIO(notices))
            else:
                with open(path, "rb") as f:
                    tar.addfile(tar_info(name, size, mode), f)


def make_archive(argv) -> int:
    ap = argparse.ArgumentParser(prog="make_app_archive.py", description="Pack the stage and the Node addon.",
                                 epilog="or: make_app_archive.py --manifest <archive_dir> <version>")
    ap.add_argument("stage_dir", type=pathlib.Path)
    ap.add_argument("sku")
    ap.add_argument("version")
    ap.add_argument("out_dir", type=pathlib.Path)
    ap.add_argument("--build-dir", type=pathlib.Path, help="CMake build tree for @BUILD@ in NOTICES.in "
                    "(default: the parent of stage_dir)")
    ap.add_argument("--notices-in", type=pathlib.Path, default=HERE / "NOTICES.in")
    args = ap.parse_args(argv)

    if not re.fullmatch(SKU_RE, args.sku):
        raise Failure(f"bad sku {args.sku!r} (want e.g. linux-x64)")
    if not re.fullmatch(VERSION_RE, args.version):
        raise Failure(f"bad version {args.version!r} (want e.g. 1.2.1, no leading v)")
    stage = args.stage_dir.resolve()
    build_dir = (args.build_dir or stage.parent).resolve()

    files = check_stage(stage, args.version)
    notices = build_notices(read_notices_in(args.notices_in, build_dir), args.sku, args.version)

    top = f"sokuji-native-{args.sku}-v{args.version}"
    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    final = out / f"{top}.tar.zst"
    sha_final = out / f"{top}.tar.zst.sha256"
    tmp, sha_tmp = out / f".{final.name}.tmp", out / f".{sha_final.name}.tmp"
    try:
        write_archive(files, notices, top, tmp)
        digest = sha256_of(tmp)
        sha_tmp.write_text(f"{digest}  {final.name}\n", encoding="utf-8")
        os.replace(tmp, final)
        os.replace(sha_tmp, sha_final)
    finally:
        for p in (tmp, sha_tmp):
            p.unlink(missing_ok=True)
    print(f"make_app_archive: {final} ({final.stat().st_size} bytes, {len(files) + 1} files) sha256 {digest}")
    return 0


# --------------------------------------------------------------------------- the manifest

def make_manifest(argv) -> int:
    ap = argparse.ArgumentParser(prog="make_app_archive.py --manifest",
                                 description="Write manifest.json for the archives in a directory.")
    ap.add_argument("archive_dir", type=pathlib.Path)
    ap.add_argument("version")
    args = ap.parse_args(argv)
    if not re.fullmatch(VERSION_RE, args.version):
        raise Failure(f"bad version {args.version!r} (want e.g. 1.2.1, no leading v)")
    if not args.archive_dir.is_dir():
        raise Failure(f"not a directory: {args.archive_dir}")

    archives = {}
    for p in sorted(args.archive_dir.iterdir(), key=lambda p: p.name):
        m = ARCHIVE_RE.match(p.name)
        if not m:
            continue                                  # wheels and the like
        if m["version"] != args.version:
            raise Failure(f"{p.name} is version {m['version']}, expected {args.version}")
        sha_file = p.with_name(p.name + ".sha256")
        if not sha_file.is_file():
            raise Failure(f"{sha_file.name} is missing")
        line = SHA256_LINE_RE.match(sha_file.read_text(encoding="utf-8").strip())
        if not line or line["name"] != p.name:
            raise Failure(f"{sha_file.name} is not `<sha256>  {p.name}`")
        actual = sha256_of(p)
        if line["hex"].lower() != actual:
            raise Failure(f"{p.name}: sha256 {actual} does not match {sha_file.name} ({line['hex'].lower()})")
        archives[m["sku"]] = {"file": p.name, "sha256": actual, "size": p.stat().st_size}
    if not archives:
        raise Failure(f"no archives (sokuji-native-<sku>-v{args.version}.tar.zst) in {args.archive_dir}")

    manifest = args.archive_dir / "manifest.json"
    manifest.write_text(json.dumps({"version": args.version, "archives": archives}, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8")
    print(f"make_app_archive: {manifest}: {', '.join(archives)}")
    return 0


def main(argv) -> int:
    try:
        if argv and argv[0] == "--manifest":
            return make_manifest(argv[1:])
        return make_archive(argv)
    except Failure as e:
        print(f"make_app_archive: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
