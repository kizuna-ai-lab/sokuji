# Sidecar Bundle Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship P7's self-contained sidecar bundles to end users — GitHub Releases hosting on `sidecar-vX.Y.Z` prerelease tags, a single `package.json` `sidecarVersion` site with strict matching, a robust 2 GB-class downloader (multi-part, Range resume, cancel, disk preflight, phases), and an explicit "Inference Engine" card gating the native provider (spec `docs/superpowers/specs/2026-07-10-sidecar-bundle-distribution-design.md`).

**Architecture:** The build script (`scripts/build-sidecar-bundle.py`) gains version-from-package.json, byte-split parts and a per-version manifest; CI publishes prerelease GitHub Releases on `sidecar-v*` tags. The Electron main process rewrites `installBundle` into an idempotent staged pipeline (userData staging, per-part sha256, Range resume, AbortController cancel) and extends the IPC surface (`status`/`install`/`cancel`/`manifest`/`remove`). `resolveSidecarLaunch` enforces `bundle.json.version === package.json.sidecarVersion`. The renderer extends `nativeModelStore`'s bundle state machine and adds an `EngineSection` card above the native model list.

**Tech Stack:** Python 3 stdlib + `zstandard` (build script, pytest), Node/Electron main process (`fzstd`, `tar-stream` already installed; `fs.statfsSync` for preflight; global `fetch`), Zustand + React + react-i18next (renderer, vitest + @testing-library/react).

## Global Constraints

- Repo: `kizuna-ai-lab/sokuji`. All work on the `native-sidecar` branch (worktree `.claude/worktrees/native-sidecar-phase1`).
- English only in code/comments/docs. Conventional commit messages.
- Any `git push`, `gh` action, tag push, or release publish is **operator-gated** (explicit per-action consent). This plan only commits locally.
- SKU keys are exactly `linux-nvidia | win-nvidia | win-directml | mac` (P7). `detectSku` returns `null` on unsupported hardware (Intel mac).
- `PART_LIMIT = int(1.9 * 1024 ** 3)` bytes (GitHub release assets max 2 GiB; ~100 MiB headroom) — spec S5.
- Default hosting base: `https://github.com/kizuna-ai-lab/sokuji/releases/download/sidecar-v<version>` — spec S4. Env overrides: `SOKUJI_SIDECAR_BUNDLE_BASE_URL` (where), `SOKUJI_SIDECAR_VERSION` (which) — spec S11.
- Manifest schema (per-version): `{version, bundles: [{sku, version, sha256, size, installedSize, parts: [{name, size, sha256}]}]}` with **relative** part names — spec S4/S5.
- Sidecar version single site: root `package.json` `"sidecarVersion"` (semver). Initial value: `"0.1.0"` — spec S1.
- Staging dir: `<userData>/sidecar/.staging/` (never `os.tmpdir()`) — spec S6.
- Disk preflight: free ≥ `size + installedSize + 512 MiB` — spec S8.
- Progress payload: `{phase: 'download'|'verify'|'extract', downloaded, total}` — spec S9.
- Python tests: `cd sidecar && .venv/bin/python -m pytest tests/<file> -q`. JS tests: `npx vitest run <paths>` from the worktree root.
- `tsc` is NOT clean in this repo (~113 pre-existing errors): correctness gate is vitest, not tsc.

---

### Task 1: `package.json` sidecarVersion + build-script default version

**Files:**
- Modify: `package.json:3` (add field after `"version"`)
- Modify: `scripts/build-sidecar-bundle.py` (add `default_version`; make `--version` optional)
- Test: `sidecar/tests/test_build_sidecar_bundle.py` (append)

**Interfaces:**
- Produces: `default_version(repo_root: str) -> str` (reads `package.json` `sidecarVersion`, `SystemExit` when missing); CLI `--version` optional (empty/absent → default). Consumed by Task 3 (CI builds without a version input) and mirrored by Task 4's JS `requiredSidecarVersion`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_build_sidecar_bundle.py` (add `import json` next to the existing imports at the top of the file if not present):

```python
def test_default_version_reads_package_json(tmp_path):
    (tmp_path / "package.json").write_text(
        json.dumps({"version": "9.9.9", "sidecarVersion": "0.1.0"}))
    assert b.default_version(str(tmp_path)) == "0.1.0"


def test_default_version_missing_field_exits(tmp_path):
    (tmp_path / "package.json").write_text(json.dumps({"version": "9.9.9"}))
    with pytest.raises(SystemExit):
        b.default_version(str(tmp_path))


def test_repo_package_json_declares_sidecar_version():
    root = pathlib.Path(__file__).resolve().parents[2]
    pkg = json.loads((root / "package.json").read_text())
    assert re.fullmatch(r"\d+\.\d+\.\d+", pkg["sidecarVersion"])
```

(`pathlib` is already imported at the top of the test file; add `import re` if missing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_build_sidecar_bundle.py -q`
Expected: FAIL — `AttributeError: module 'build_sidecar_bundle' has no attribute 'default_version'` and `KeyError: 'sidecarVersion'`.

- [ ] **Step 3: Add the field and the function**

In `package.json`, line 3 currently reads `"version": "0.30.6",` — insert directly after it:

```json
  "sidecarVersion": "0.1.0",
```

In `scripts/build-sidecar-bundle.py`, add after `host_supports_sku` (after line 69):

```python
def default_version(repo_root: str) -> str:
    """The sidecar's canonical version = package.json `sidecarVersion` (spec S1).
    One field, one bump; the sidecar-vX.Y.Z tag must match it (CI-asserted)."""
    pkg = json.loads((Path(repo_root) / "package.json").read_text())
    v = pkg.get("sidecarVersion")
    if not v:
        raise SystemExit("package.json has no sidecarVersion field")
    return v
```

In `_main`, change the `--version` argument (line 202) from:

```python
    ap.add_argument("--version", required=True)
```

to:

```python
    ap.add_argument("--version", default="",
                    help="override; defaults to package.json sidecarVersion")
```

and replace the two lines that consume it (lines 209–212):

```python
    repo_root = str(Path(__file__).resolve().parent.parent)
    bundle_dir = build_bundle_dir(args.sku, args.version, args.out, repo_root)
    if args.archive:
        _archive_and_manifest(args.sku, args.version, bundle_dir, args.out, args.base_url)
```

with:

```python
    repo_root = str(Path(__file__).resolve().parent.parent)
    version = args.version or default_version(repo_root)
    bundle_dir = build_bundle_dir(args.sku, version, args.out, repo_root)
    if args.archive:
        _archive_and_manifest(args.sku, version, bundle_dir, args.out, args.base_url)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_build_sidecar_bundle.py -q`
Expected: PASS (existing suites + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/build-sidecar-bundle.py sidecar/tests/test_build_sidecar_bundle.py
git commit -m "feat(sidecar): single-site sidecarVersion in package.json as default bundle version"
```

---

### Task 2: Multi-part split + per-version manifest (Python)

**Files:**
- Modify: `scripts/build-sidecar-bundle.py` (add `PART_LIMIT`, `dir_size`, `split_parts`; rewrite `build_manifest`, `merge_manifests`, `_archive_and_manifest`; add `--merge-fragments` mode; drop `--base-url`; delete `_vkey`)
- Test: `sidecar/tests/test_build_sidecar_bundle.py` (rewrite 2 tests, append 5)

**Interfaces:**
- Consumes: `archive_name`, `sha256_file`, `pack_zst`, `default_version` (Task 1).
- Produces:
  - `PART_LIMIT: int` == `int(1.9 * 1024 ** 3)`
  - `dir_size(path: str) -> int`
  - `split_parts(archive_path: str, limit: int = PART_LIMIT) -> list[dict]` — `[{name, size, sha256}]`; multi-part deletes the original archive; single-part keeps it (its name == `archive_name(...)`).
  - `build_manifest(sku, version, *, sha256, size, installed_size, parts) -> dict` — `{sku, version, sha256, size, installedSize, parts}` (NO `url` field).
  - `merge_manifests(fragments) -> dict` — `{version, bundles: sorted-by-sku}`; `SystemExit` on mixed versions.
  - CLI: `--merge-fragments <paths...> --merged-out <file>` merges and exits; `--sku` becomes optional (required unless merging).
- Contract with Task 5 (JS installer): single-part `parts[0].name === archiveName(sku, version)`; multi-part names are `archiveName(...) + '.001'` etc.; `entry.sha256` is the whole reassembled archive.

- [ ] **Step 1: Rewrite the two stale tests**

In `sidecar/tests/test_build_sidecar_bundle.py`, REPLACE the existing `test_build_manifest_fields` function with:

```python
def test_build_manifest_fields(tmp_path):
    m = b.build_manifest(
        "mac", "0.1.0", sha256="ab" * 32, size=7, installed_size=20,
        parts=[{"name": "sidecar-mac-v0.1.0.tar.zst", "size": 7, "sha256": "cd" * 32}])
    assert m == {
        "sku": "mac", "version": "0.1.0", "sha256": "ab" * 32, "size": 7,
        "installedSize": 20,
        "parts": [{"name": "sidecar-mac-v0.1.0.tar.zst", "size": 7, "sha256": "cd" * 32}],
    }
```

and REPLACE the existing `test_merge_manifests_keeps_latest_per_sku` function with:

```python
def test_merge_manifests_uniform_version_sorted_by_sku():
    agg = b.merge_manifests([
        {"sku": "win-directml", "version": "0.1.0"},
        {"sku": "linux-nvidia", "version": "0.1.0"},
    ])
    assert agg["version"] == "0.1.0"
    assert [e["sku"] for e in agg["bundles"]] == ["linux-nvidia", "win-directml"]


def test_merge_manifests_rejects_mixed_versions():
    with pytest.raises(SystemExit):
        b.merge_manifests([
            {"sku": "mac", "version": "0.1.0"},
            {"sku": "linux-nvidia", "version": "0.2.0"},
        ])
```

- [ ] **Step 2: Append the split/size/CLI tests**

Append to the same file:

```python
def test_split_parts_single_when_under_limit(tmp_path):
    arc = tmp_path / "sidecar-mac-v1.tar.zst"
    arc.write_bytes(b"A" * 100)
    parts = b.split_parts(str(arc), limit=1000)
    assert parts == [{"name": "sidecar-mac-v1.tar.zst", "size": 100,
                      "sha256": hashlib.sha256(b"A" * 100).hexdigest()}]
    assert arc.exists()  # single part: the archive itself is the part


def test_split_parts_chunks_when_over_limit(tmp_path):
    arc = tmp_path / "sidecar-linux-nvidia-v1.tar.zst"
    payload = bytes(range(256)) * 40  # 10240 bytes
    arc.write_bytes(payload)
    parts = b.split_parts(str(arc), limit=4096)
    assert [p["name"] for p in parts] == [
        "sidecar-linux-nvidia-v1.tar.zst.001",
        "sidecar-linux-nvidia-v1.tar.zst.002",
        "sidecar-linux-nvidia-v1.tar.zst.003",
    ]
    assert [p["size"] for p in parts] == [4096, 4096, 2048]
    assert not arc.exists()  # multi-part: the whole archive is replaced by parts
    joined = b"".join((tmp_path / p["name"]).read_bytes() for p in parts)
    assert joined == payload
    for p in parts:
        assert p["sha256"] == hashlib.sha256(
            (tmp_path / p["name"]).read_bytes()).hexdigest()


def test_part_limit_leaves_headroom_under_github_2gib():
    assert b.PART_LIMIT == int(1.9 * 1024 ** 3)
    assert b.PART_LIMIT < 2 * 1024 ** 3


def test_dir_size_walks(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "a").write_bytes(b"12345")
    (tmp_path / "sub" / "b").write_bytes(b"123")
    assert b.dir_size(str(tmp_path)) == 8


def test_cli_merge_fragments(tmp_path):
    f1 = tmp_path / "a.json"
    f1.write_text(json.dumps({"sku": "mac", "version": "0.1.0"}))
    f2 = tmp_path / "b.json"
    f2.write_text(json.dumps({"sku": "linux-nvidia", "version": "0.1.0"}))
    out = tmp_path / "manifest.json"
    assert b._main(["--merge-fragments", str(f1), str(f2),
                    "--merged-out", str(out)]) == 0
    merged = json.loads(out.read_text())
    assert merged["version"] == "0.1.0" and len(merged["bundles"]) == 2
```

- [ ] **Step 3: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_build_sidecar_bundle.py -q`
Expected: FAIL — `build_manifest` rejects keyword args, `split_parts`/`dir_size`/`PART_LIMIT` missing, CLI rejects `--merge-fragments`.

- [ ] **Step 4: Implement in `scripts/build-sidecar-bundle.py`**

Add after the `_PBS_LATEST` constant (line 48):

```python
# GitHub release assets max out at 2 GiB; keep ~100 MiB headroom (spec S5).
PART_LIMIT = int(1.9 * 1024 ** 3)
```

Add after `sha256_file` (after line 167):

```python
def dir_size(path: str) -> int:
    """Unpacked byte size of a bundle dir (`installedSize`, for disk preflight)."""
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total


def split_parts(archive_path: str, limit: int = PART_LIMIT) -> list:
    """Byte-split an archive into `.001/.002/...` chunks of at most `limit`
    bytes when it exceeds `limit`; otherwise return a single-entry parts list
    for the file itself. Multi-part deletes the original (the parts replace
    it). The manifest always carries `parts`, so the installer has exactly one
    code path (spec S5)."""
    size = os.path.getsize(archive_path)
    base = os.path.basename(archive_path)
    if size <= limit:
        return [{"name": base, "size": size, "sha256": sha256_file(archive_path)}]
    parts = []
    with open(archive_path, "rb") as src:
        idx = 1
        while True:
            h = hashlib.sha256()
            written = 0
            chunk_path = f"{archive_path}.{idx:03d}"
            with open(chunk_path, "wb") as out:
                while written < limit:
                    buf = src.read(min(1 << 20, limit - written))
                    if not buf:
                        break
                    out.write(buf)
                    h.update(buf)
                    written += len(buf)
            if written == 0:
                os.unlink(chunk_path)
                break
            parts.append({"name": os.path.basename(chunk_path), "size": written,
                          "sha256": h.hexdigest()})
            idx += 1
    os.unlink(archive_path)
    return parts
```

REPLACE `build_manifest` (lines 170–172) with:

```python
def build_manifest(sku: str, version: str, *, sha256: str, size: int,
                   installed_size: int, parts: list) -> dict:
    """Per-SKU manifest fragment (spec S4/S5). Part names are RELATIVE — the
    installer resolves them against its base URL (mirror-friendly)."""
    return {"sku": sku, "version": version, "sha256": sha256, "size": size,
            "installedSize": installed_size, "parts": parts}
```

REPLACE `_vkey` + `merge_manifests` (lines 175–185) with:

```python
def merge_manifests(fragments) -> dict:
    """Merge same-version per-SKU fragments into the release's manifest.json.
    All fragments MUST carry one version (per-version manifest, spec S4)."""
    versions = sorted({f["version"] for f in fragments})
    if len(versions) != 1:
        raise SystemExit(f"manifest fragments span multiple versions: {versions}")
    return {"version": versions[0],
            "bundles": sorted(fragments, key=lambda f: f["sku"])}
```

REPLACE `_archive_and_manifest` (lines 188–196) with:

```python
def _archive_and_manifest(sku, version, bundle_dir, out_root):
    arc = str(Path(out_root) / archive_name(sku, version))
    installed = dir_size(bundle_dir)
    pack_zst(bundle_dir, arc)
    whole_sha = sha256_file(arc)
    whole_size = os.path.getsize(arc)
    parts = split_parts(arc)
    frag = build_manifest(sku, version, sha256=whole_sha, size=whole_size,
                          installed_size=installed, parts=parts)
    frag_path = Path(out_root) / f"{bundle_dirname(sku, version)}.json"
    frag_path.write_text(json.dumps(frag, indent=2))
    print(f"[bundle] archived {archive_name(sku, version)} ({whole_size} bytes, "
          f"{len(parts)} part(s), sha256 {whole_sha[:12]})", flush=True)
```

REPLACE the whole `_main` (lines 199–213) with:

```python
def _main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sku", required=False, choices=sorted(SKU_TRIPLE))
    ap.add_argument("--version", default="",
                    help="override; defaults to package.json sidecarVersion")
    ap.add_argument("--out", default="out/bundles")
    ap.add_argument("--archive", action="store_true",
                    help="also pack .tar.zst (split if >PART_LIMIT) + manifest fragment")
    ap.add_argument("--merge-fragments", nargs="+", default=None,
                    help="merge per-SKU fragment JSONs into one manifest.json and exit")
    ap.add_argument("--merged-out", default="manifest.json")
    args = ap.parse_args(argv)
    repo_root = str(Path(__file__).resolve().parent.parent)
    if args.merge_fragments:
        frags = [json.loads(Path(p).read_text()) for p in args.merge_fragments]
        Path(args.merged_out).write_text(json.dumps(merge_manifests(frags), indent=2))
        print(f"[bundle] merged {len(frags)} fragment(s) -> {args.merged_out}", flush=True)
        return 0
    if not args.sku:
        ap.error("--sku is required unless --merge-fragments is given")
    version = args.version or default_version(repo_root)
    bundle_dir = build_bundle_dir(args.sku, version, args.out, repo_root)
    if args.archive:
        _archive_and_manifest(args.sku, version, bundle_dir, args.out)
    return 0
```

Also update the module docstring's `Usage:` block (lines 18–21) to:

```
Usage:
    python scripts/build-sidecar-bundle.py --sku linux-nvidia --archive --out out/bundles
Version defaults to package.json `sidecarVersion`. Archives over PART_LIMIT are
byte-split into `.001/.002/...` parts. `--merge-fragments a.json b.json` merges
per-SKU fragments into the release manifest.json.
```

- [ ] **Step 5: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_build_sidecar_bundle.py -q`
Expected: PASS (all suites, including the rewritten manifest/merge tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/build-sidecar-bundle.py sidecar/tests/test_build_sidecar_bundle.py
git commit -m "feat(sidecar): multi-part bundle split + per-version manifest with installedSize"
```

---

### Task 3: CI — tag trigger, version guard, prerelease publish

**Files:**
- Modify: `.github/workflows/sidecar-bundles.yml` (full rewrite below)
- Test: `sidecar/tests/test_sidecar_bundles_workflow.py`

**Interfaces:**
- Consumes: CLI default version + `--merge-fragments` (Tasks 1–2).
- Produces: on `sidecar-vX.Y.Z` tag push — a **prerelease** GitHub Release carrying `sidecar-<sku>-v<version>.tar.zst[.NNN]` for all 4 SKUs plus the merged `manifest.json`. `workflow_dispatch` stays artifact-only (dry-run lane, spec S11).

- [ ] **Step 1: Update the workflow tests**

In `sidecar/tests/test_sidecar_bundles_workflow.py`, RENAME `test_workflow_is_valid_yaml_with_three_jobs` to `test_workflow_is_valid_yaml_with_four_jobs` and replace its body, then append one test:

```python
def test_workflow_is_valid_yaml_with_four_jobs():
    yaml = pytest.importorskip("yaml")
    doc = yaml.safe_load(WF.read_text())
    assert {"build-linux", "build-windows", "build-mac", "release"} <= set(doc["jobs"])
    assert doc["jobs"]["build-windows"]["strategy"]["matrix"]["sku"] == ["win-nvidia", "win-directml"]
    assert doc["jobs"]["release"]["needs"] == ["build-linux", "build-windows", "build-mac"]


def test_workflow_publishes_prerelease_on_sidecar_tags():
    text = WF.read_text()
    assert "sidecar-v*" in text                    # tag trigger
    assert "softprops/action-gh-release" in text   # same publisher as app releases
    assert "prerelease: true" in text              # never the repo's "latest" (electron-updater)
    assert "--merge-fragments" in text             # merged manifest.json asset
    assert "sidecarVersion" in text                # tag == package.json guard
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_sidecar_bundles_workflow.py -q`
Expected: FAIL — no `release` job, no tag trigger.

- [ ] **Step 3: Rewrite the workflow**

Replace the full contents of `.github/workflows/sidecar-bundles.yml` with:

```yaml
# .github/workflows/sidecar-bundles.yml
# Build the self-contained sidecar bundles per SKU (spec D10 + the distribution
# spec). Two lanes (spec S11):
#   - workflow_dispatch: dry run — Actions artifacts only (size measurement, smoke).
#   - sidecar-vX.Y.Z tag push: build all SKUs and publish a PRERELEASE GitHub
#     Release with the archives + merged manifest.json. Always prerelease:
#     electron-updater resolves the repo's "latest release" to find latest*.yml
#     for app auto-update — a sidecar release must never win that lookup.
# Signing/notarization stays an operator follow-up; artifacts are unsigned.
name: sidecar-bundles

permissions:
  contents: read

on:
  workflow_dispatch:
    inputs:
      version:
        description: Version override (defaults to package.json sidecarVersion)
        required: false
        default: ''
  push:
    tags: ['sidecar-v*']

jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Verify tag matches package.json sidecarVersion
        if: startsWith(github.ref, 'refs/tags/sidecar-v')
        run: |
          WANT="${GITHUB_REF_NAME#sidecar-v}"
          HAVE="$(node -p "require('./package.json').sidecarVersion")"
          [ "$WANT" = "$HAVE" ] || { echo "tag $WANT != package.json sidecarVersion $HAVE"; exit 1; }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python -m pip install zstandard
      - name: Build linux-nvidia bundle
        env:
          VERSION: ${{ inputs.version }}
        run: python scripts/build-sidecar-bundle.py --sku linux-nvidia --version "$VERSION" --archive --out out/bundles
      - uses: actions/upload-artifact@v4
        with:
          name: sidecar-linux-nvidia
          path: out/bundles/sidecar-linux-nvidia-v*

  build-windows:
    runs-on: windows-latest
    strategy:
      matrix:
        sku: [win-nvidia, win-directml]
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Verify tag matches package.json sidecarVersion
        if: startsWith(github.ref, 'refs/tags/sidecar-v')
        shell: bash
        run: |
          WANT="${GITHUB_REF_NAME#sidecar-v}"
          HAVE="$(node -p "require('./package.json').sidecarVersion")"
          [ "$WANT" = "$HAVE" ] || { echo "tag $WANT != package.json sidecarVersion $HAVE"; exit 1; }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python -m pip install zstandard
      - name: Build ${{ matrix.sku }} bundle
        env:
          VERSION: ${{ inputs.version }}
        run: python scripts/build-sidecar-bundle.py --sku ${{ matrix.sku }} --version "$env:VERSION" --archive --out out/bundles
      - uses: actions/upload-artifact@v4
        with:
          name: sidecar-${{ matrix.sku }}
          path: out/bundles/sidecar-${{ matrix.sku }}-v*

  build-mac:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Verify tag matches package.json sidecarVersion
        if: startsWith(github.ref, 'refs/tags/sidecar-v')
        run: |
          WANT="${GITHUB_REF_NAME#sidecar-v}"
          HAVE="$(node -p "require('./package.json').sidecarVersion")"
          [ "$WANT" = "$HAVE" ] || { echo "tag $WANT != package.json sidecarVersion $HAVE"; exit 1; }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: python -m pip install zstandard
      - name: Build mac bundle
        env:
          VERSION: ${{ inputs.version }}
        run: python scripts/build-sidecar-bundle.py --sku mac --version "$VERSION" --archive --out out/bundles
      - uses: actions/upload-artifact@v4
        with:
          name: sidecar-mac
          path: out/bundles/sidecar-mac-v*

  release:
    if: startsWith(github.ref, 'refs/tags/sidecar-v')
    needs: [build-linux, build-windows, build-mac]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/download-artifact@v4
        with:
          path: out/bundles
          merge-multiple: true
      - name: Merge per-SKU manifest fragments
        run: python scripts/build-sidecar-bundle.py --merge-fragments out/bundles/sidecar-*.json --merged-out out/bundles/manifest.json
      - name: Publish prerelease
        uses: softprops/action-gh-release@v2
        with:
          prerelease: true
          files: |
            out/bundles/sidecar-*.tar.zst*
            out/bundles/manifest.json
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_sidecar_bundles_workflow.py -q`
Expected: PASS (3 tests; the YAML test skips only without PyYAML).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/sidecar-bundles.yml sidecar/tests/test_sidecar_bundles_workflow.py
git commit -m "ci(sidecar): publish prerelease bundles + manifest on sidecar-v* tags"
```

---

### Task 4: Electron download helpers — version, base URL, staging, Range resume

**Files:**
- Modify: `electron/sidecar-bundle.js` (add helpers; keep existing exports)
- Test: `electron/sidecar-bundle.test.js` (append)

**Interfaces:**
- Consumes: `archiveName`, `verifySha256` (existing).
- Produces (all exported from `sidecar-bundle.js`):
  - `requiredSidecarVersion({env?, pkg?}) -> string` — `env.SOKUJI_SIDECAR_VERSION` || `package.json` `sidecarVersion`; throws when missing.
  - `bundleBaseUrl(version, env?) -> string` — env `SOKUJI_SIDECAR_BUNDLE_BASE_URL` (trailing slashes stripped) or `https://github.com/kizuna-ai-lab/sokuji/releases/download/sidecar-v<version>`.
  - `stagingDir(userDataDir) -> string` — `<userData>/sidecar/.staging`.
  - `stagedBytes(userDataDir, sku, version) -> number`.
  - `pruneStaging(userDataDir, keepArchiveName) -> void`.
  - `downloadPart({url, dest, part, onPartProgress?, fetchImpl?, signal?}) -> Promise<void>` — skip/resume/restart per staged bytes; verifies `part.sha256` (deletes on mismatch); `onPartProgress(receivedBytesIncludingOffset)`.
  - `concatParts(partPaths, outPath) -> Promise<void>`.
- Consumed by Task 5 (`installBundle` v2), Task 6 (IPC), Task 7 (launch gate).

- [ ] **Step 1: Write the failing tests**

Append to `electron/sidecar-bundle.test.js` (extend the import list from `./sidecar-bundle.js` with `requiredSidecarVersion, bundleBaseUrl, stagingDir, stagedBytes, pruneStaging, downloadPart, concatParts`; add `mkdirSync, statSync` to the `fs` import):

```javascript
// A minimal fetch Response stand-in: one chunk, then done.
function fetchResponse(bytes, { status = 200 } = {}) {
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(bytes.length) },
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { done: true } : ((sent = true), { done: false, value: Uint8Array.from(bytes) }),
      }),
    },
  };
}

const sha = (buf) => crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');

describe('requiredSidecarVersion / bundleBaseUrl (spec S1/S4/S11)', () => {
  it('env override wins; package field is the default; missing field throws', () => {
    expect(requiredSidecarVersion({ env: { SOKUJI_SIDECAR_VERSION: '9.9.9' } })).toBe('9.9.9');
    expect(requiredSidecarVersion({ env: {}, pkg: { sidecarVersion: '0.1.0' } })).toBe('0.1.0');
    expect(requiredSidecarVersion({ env: {} })).toBe(req('../package.json').sidecarVersion);
    expect(() => requiredSidecarVersion({ env: {}, pkg: {} })).toThrow(/sidecarVersion/);
  });
  it('derives the GitHub release URL from the version, env override replaces it', () => {
    expect(bundleBaseUrl('0.1.0', {}))
      .toBe('https://github.com/kizuna-ai-lab/sokuji/releases/download/sidecar-v0.1.0');
    expect(bundleBaseUrl('0.1.0', { SOKUJI_SIDECAR_BUNDLE_BASE_URL: 'http://localhost:8000/' }))
      .toBe('http://localhost:8000');
  });
});

describe('staging (spec S6)', () => {
  it('stagedBytes counts only files of this sku+version; pruneStaging drops the rest', () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-stage-'));
    mkdirSync(stagingDir(u), { recursive: true });
    const keep = archiveName('mac', '0.1.0');
    writeFileSync(path.join(stagingDir(u), `${keep}.001`), Buffer.alloc(10));
    writeFileSync(path.join(stagingDir(u), `${keep}.002`), Buffer.alloc(5));
    writeFileSync(path.join(stagingDir(u), archiveName('mac', '0.0.9')), Buffer.alloc(99));
    expect(stagedBytes(u, 'mac', '0.1.0')).toBe(15);
    pruneStaging(u, keep);
    expect(existsSync(path.join(stagingDir(u), archiveName('mac', '0.0.9')))).toBe(false);
    expect(existsSync(path.join(stagingDir(u), `${keep}.001`))).toBe(true);
  });
});

describe('downloadPart resume decision table (spec S7)', () => {
  const payload = Buffer.from('0123456789abcdef');
  const part = { name: 'p', size: payload.length, sha256: sha(payload) };

  it('complete + valid staged part: no fetch at all', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    writeFileSync(dest, payload);
    const fetchImpl = vi.fn();
    await downloadPart({ url: 'u', dest, part, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('partial staged part: resumes with a Range header and appends', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    writeFileSync(dest, payload.subarray(0, 6));
    const fetchImpl = vi.fn(async (_u, opts) => {
      expect(opts.headers.Range).toBe('bytes=6-');
      return fetchResponse(payload.subarray(6), { status: 206 });
    });
    const seen = [];
    await downloadPart({ url: 'u', dest, part, fetchImpl, onPartProgress: (n) => seen.push(n) });
    expect(readFileSync(dest)).toEqual(payload);
    expect(seen.at(-1)).toBe(payload.length); // progress includes the staged offset
  });

  it('server ignoring Range (HTTP 200) restarts from zero', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    writeFileSync(dest, payload.subarray(0, 6));
    const fetchImpl = vi.fn(async () => fetchResponse(payload, { status: 200 }));
    await downloadPart({ url: 'u', dest, part, fetchImpl });
    expect(readFileSync(dest)).toEqual(payload);
  });

  it('corrupt complete staged part: re-downloads from zero', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    writeFileSync(dest, Buffer.alloc(payload.length, 0x7a)); // right size, wrong bytes
    const fetchImpl = vi.fn(async (_u, opts) => {
      expect(opts.headers.Range).toBeUndefined();
      return fetchResponse(payload);
    });
    await downloadPart({ url: 'u', dest, part, fetchImpl });
    expect(readFileSync(dest)).toEqual(payload);
  });

  it('sha mismatch after download deletes the part and rejects', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-dl-'));
    const dest = path.join(d, 'p');
    const fetchImpl = vi.fn(async () => fetchResponse(Buffer.from('WRONG-BYTES-16!!')));
    await expect(downloadPart({ url: 'u', dest, part, fetchImpl })).rejects.toThrow(/sha256/);
    expect(existsSync(dest)).toBe(false);
  });
});

describe('concatParts', () => {
  it('reassembles parts byte-identically', async () => {
    const d = mkdtempSync(path.join(tmpdir(), 'sb-cat-'));
    writeFileSync(path.join(d, 'a'), 'hello ');
    writeFileSync(path.join(d, 'b'), 'world');
    await concatParts([path.join(d, 'a'), path.join(d, 'b')], path.join(d, 'out'));
    expect(readFileSync(path.join(d, 'out'), 'utf8')).toBe('hello world');
  });
});
```

(Also add `vi` to the vitest import at the top: `import { describe, it, expect, vi } from 'vitest';`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/sidecar-bundle.test.js`
Expected: FAIL — the new names are not exported.

- [ ] **Step 3: Implement in `electron/sidecar-bundle.js`**

Add after the `bundleStatus` function (after line 22):

```javascript
const GITHUB_RELEASES_BASE = 'https://github.com/kizuna-ai-lab/sokuji/releases/download';

// The engine version this app build requires (spec S1/S2): package.json's
// `sidecarVersion` — packaged into the asar by both forge and electron-builder.
// SOKUJI_SIDECAR_VERSION overrides it for hardware verification of a
// not-yet-adopted release (spec S11).
function requiredSidecarVersion({ env = process.env, pkg = null } = {}) {
  if (env.SOKUJI_SIDECAR_VERSION) return env.SOKUJI_SIDECAR_VERSION;
  const p = pkg || require('../package.json');
  if (!p.sidecarVersion) throw new Error('package.json has no sidecarVersion field');
  return p.sidecarVersion;
}

// Where the per-version manifest + archives live (spec S4). The env override is
// the mirror/staging knob (spec S11): it replaces the whole base; the relative
// path layout (manifest.json + part names) is identical everywhere.
function bundleBaseUrl(version, env = process.env) {
  const o = env.SOKUJI_SIDECAR_BUNDLE_BASE_URL;
  if (o) return o.replace(/\/+$/, '');
  return `${GITHUB_RELEASES_BASE}/sidecar-v${version}`;
}

// Download staging lives under userData, NOT os.tmpdir(): /tmp is commonly
// tmpfs on Linux (a 2 GB download must not eat RAM) and does not survive
// reboots (which would kill resume) — spec S6.
function stagingDir(userDataDir) {
  return path.join(userDataDir, 'sidecar', '.staging');
}

// Bytes already staged for this sku+version (drives the renderer's 'paused' state).
function stagedBytes(userDataDir, sku, version) {
  const prefix = archiveName(sku, version);
  const dir = stagingDir(userDataDir);
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === prefix || f.startsWith(`${prefix}.`)) {
        total += fs.statSync(path.join(dir, f)).size;
      }
    }
  } catch { /* no staging dir yet */ }
  return total;
}

// Drop staged files that do not belong to this archive. Version is part of the
// file name, so stale downloads from an older sidecarVersion never survive.
function pruneStaging(userDataDir, keepArchiveName) {
  const dir = stagingDir(userDataDir);
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const f of names) {
    if (f !== keepArchiveName && !f.startsWith(`${keepArchiveName}.`)) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  }
}

// Download one part into `dest`, resuming from already-staged bytes with an
// HTTP Range request (spec S7; GitHub release assets honor Range). The part's
// sha256 is verified afterwards; a mismatching file is deleted before the
// error propagates, so the next attempt restarts that part from zero.
// Resume is not a separate code path — the whole function is idempotent.
async function downloadPart({ url, dest, part, onPartProgress, fetchImpl = fetch, signal }) {
  let offset = 0;
  try { offset = fs.statSync(dest).size; } catch { /* nothing staged */ }
  if (offset > part.size) { fs.rmSync(dest, { force: true }); offset = 0; }
  if (offset === part.size) {
    try {
      await verifySha256(dest, part.sha256);
      onPartProgress?.(part.size);
      return;                                   // complete + valid: skip
    } catch {
      fs.rmSync(dest, { force: true });
      offset = 0;                               // complete + corrupt: restart
    }
  }
  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
  const r = await fetchImpl(url, { headers, signal });
  if (offset > 0 && r.status === 200) {
    offset = 0;                                 // server ignored Range: restart
  } else if (r.status !== 200 && r.status !== 206) {
    throw new Error(`part fetch failed: HTTP ${r.status}`);
  }
  if (!r.body) throw new Error('part fetch failed: empty body');
  const ws = fs.createWriteStream(dest, { flags: offset > 0 ? 'a' : 'w' });
  let received = offset;
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!ws.write(Buffer.from(value))) {
        await new Promise((res, rej) => {
          const onDrain = () => { ws.off('error', onErr); res(); };
          const onErr = (e) => { ws.off('drain', onDrain); rej(e); };
          ws.once('drain', onDrain);
          ws.once('error', onErr);
        });
      }
      onPartProgress?.(received);
    }
  } catch (err) {
    ws.destroy();
    throw err;
  }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
  try {
    await verifySha256(dest, part.sha256);
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

// Reassemble split parts into the whole archive (multi-part case, spec S5).
async function concatParts(partPaths, outPath) {
  const ws = fs.createWriteStream(outPath);
  for (const p of partPaths) {
    await new Promise((res, rej) => {
      const rs = fs.createReadStream(p);
      rs.on('error', rej);
      ws.on('error', rej);
      rs.on('end', res);
      rs.pipe(ws, { end: false });
    });
  }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
}
```

Extend `module.exports` (lines 187–190) to:

```javascript
module.exports = {
  archiveName, bundleInstallDir, bundleStatus, pickBundle,
  verifySha256, extractTarZst, installBundle,
  requiredSidecarVersion, bundleBaseUrl, stagingDir, stagedBytes, pruneStaging,
  downloadPart, concatParts,
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run electron/sidecar-bundle.test.js`
Expected: PASS (existing suites + the 4 new describes).

- [ ] **Step 5: Commit**

```bash
git add electron/sidecar-bundle.js electron/sidecar-bundle.test.js
git commit -m "feat(electron): sidecar version/baseUrl helpers + resumable part downloads"
```

---

### Task 5: `installBundle` v2 pipeline + `removeBundle`

**Files:**
- Modify: `electron/sidecar-bundle.js` (replace `installBundle`, lines 151–185; delete the now-unused `const os = require('os');` import; add `removeBundle`)
- Test: `electron/sidecar-bundle.test.js` (append)

**Interfaces:**
- Consumes: Task 4 helpers + existing `extractTarZst`/`verifySha256`/`pickBundle`.
- Produces:
  - `installBundle({sku, version, userDataDir, onProgress?, fetchImpl?, signal?, stopSidecar?, env?, statfs?}) -> Promise<{version}>` — NEW signature (old `baseUrl` param is gone; base URL derives from `bundleBaseUrl(version, env)`). `onProgress` payload: `{phase, downloaded, total}`.
  - `removeBundle(userDataDir, sku) -> void`.
- NOTE: `electron/main.js` still calls the old signature until Task 6 — vitest stays green (main.js is not under test), but do Tasks 5 and 6 back-to-back.

- [ ] **Step 1: Write the failing tests**

Append to `electron/sidecar-bundle.test.js` (extend the `./sidecar-bundle.js` import with `removeBundle`). The end-to-end tests reuse the committed extraction fixture `electron/__fixtures__/bundle-sample.tar.zst`:

```javascript
describe('installBundle v2 pipeline (spec S4–S9)', () => {
  const fixture = readFileSync(path.join(__dirname, '__fixtures__', 'bundle-sample.tar.zst'));
  const bigStatfs = () => ({ bavail: 1e9, bsize: 4096 });   // plenty of space
  const jsonResponse = (obj) => ({ ok: true, status: 200, json: async () => obj });

  function manifestFor(parts, { version = '9.9.9' } = {}) {
    return {
      version,
      bundles: [{
        sku: 'mac', version, sha256: sha(fixture), size: fixture.length,
        installedSize: 64, parts,
      }],
    };
  }

  function fetchFor(manifest, partBytes) {
    return vi.fn(async (url, opts) => {
      if (String(url).endsWith('/manifest.json')) return jsonResponse(manifest);
      const name = String(url).split('/').pop();
      // Serve staged-resume requests too: honor a Range header with a 206 slice.
      const bytes = partBytes[name];
      const range = opts?.headers?.Range;
      if (range) {
        const from = Number(/bytes=(\d+)-/.exec(range)[1]);
        return fetchResponse(bytes.subarray(from), { status: 206 });
      }
      return fetchResponse(bytes);
    });
  }

  it('single part: downloads, extracts, swaps, writes bundle.json, stops sidecar', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const name = archiveName('mac', '9.9.9');
    const manifest = manifestFor([{ name, size: fixture.length, sha256: sha(fixture) }]);
    const stopSidecar = vi.fn();
    const phases = [];
    const r = await installBundle({
      sku: 'mac', version: '9.9.9', userDataDir: u,
      fetchImpl: fetchFor(manifest, { [name]: fixture }),
      statfs: bigStatfs, stopSidecar, env: {},
      onProgress: (p) => phases.push(p.phase),
    });
    expect(r).toEqual({ version: '9.9.9' });
    expect(readFileSync(path.join(u, 'sidecar', 'mac', 'app', 'hi.txt'), 'utf8')).toBe('hi');
    expect(JSON.parse(readFileSync(path.join(u, 'sidecar', 'mac', 'bundle.json'), 'utf8')))
      .toEqual({ sku: 'mac', version: '9.9.9' });
    expect(stopSidecar).toHaveBeenCalled();
    expect(phases).toContain('download');
    expect(phases).toContain('extract');
    expect(stagedBytes(u, 'mac', '9.9.9')).toBe(0);          // staging cleaned
  });

  it('multi part: reassembles, verifies the whole archive, installs', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const name = archiveName('mac', '9.9.9');
    const cut = Math.floor(fixture.length / 2);
    const p1 = fixture.subarray(0, cut);
    const p2 = fixture.subarray(cut);
    const manifest = manifestFor([
      { name: `${name}.001`, size: p1.length, sha256: sha(p1) },
      { name: `${name}.002`, size: p2.length, sha256: sha(p2) },
    ]);
    await installBundle({
      sku: 'mac', version: '9.9.9', userDataDir: u,
      fetchImpl: fetchFor(manifest, { [`${name}.001`]: p1, [`${name}.002`]: p2 }),
      statfs: bigStatfs, env: {},
    });
    expect(readFileSync(path.join(u, 'sidecar', 'mac', 'app', 'hi.txt'), 'utf8')).toBe('hi');
  });

  it('rejects a manifest whose entry version differs (strict matching, spec S2)', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const name = archiveName('mac', '8.8.8');
    const manifest = manifestFor([{ name, size: fixture.length, sha256: sha(fixture) }],
      { version: '8.8.8' });
    await expect(installBundle({
      sku: 'mac', version: '9.9.9', userDataDir: u,
      fetchImpl: fetchFor(manifest, { [name]: fixture }), statfs: bigStatfs, env: {},
    })).rejects.toThrow(/strict matching/);
  });

  it('fails early with exact numbers when disk is short (spec S8)', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-inst-'));
    const name = archiveName('mac', '9.9.9');
    const manifest = manifestFor([{ name, size: fixture.length, sha256: sha(fixture) }]);
    await expect(installBundle({
      sku: 'mac', version: '9.9.9', userDataDir: u,
      fetchImpl: fetchFor(manifest, { [name]: fixture }),
      statfs: () => ({ bavail: 1, bsize: 4096 }),          // ~4 KB free
      env: {},
    })).rejects.toThrow(/disk space/);
  });

  it('removeBundle deletes the installed tree', async () => {
    const u = mkdtempSync(path.join(tmpdir(), 'sb-rm-'));
    mkdirSync(path.join(u, 'sidecar', 'mac'), { recursive: true });
    writeFileSync(path.join(u, 'sidecar', 'mac', 'bundle.json'), '{}');
    removeBundle(u, 'mac');
    expect(existsSync(path.join(u, 'sidecar', 'mac'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/sidecar-bundle.test.js`
Expected: FAIL — `removeBundle` not exported; `installBundle` rejects with the old "hosting is not configured" error (no `baseUrl` given).

- [ ] **Step 3: Replace `installBundle` and add `removeBundle`**

In `electron/sidecar-bundle.js`, delete `const os = require('os');` (line 2) and REPLACE the whole old `installBundle` (lines 151–185) with:

```javascript
// Full install pipeline (spec S4–S9):
//   manifest → strict version check → disk preflight → per-part download with
//   resume → reassemble+verify → stop sidecar → extract → atomic swap → clean
//   staging. Idempotent per part, so cancel/crash + re-invoke resumes naturally.
async function installBundle({
  sku, version, userDataDir, onProgress,
  fetchImpl = fetch, signal, stopSidecar, env = process.env,
  statfs = (p) => fs.statfsSync(p),
}) {
  const baseUrl = bundleBaseUrl(version, env);
  const manifest = await _fetchJson(`${baseUrl}/manifest.json`, fetchImpl);
  const entry = pickBundle(manifest, sku);
  if (!entry) throw new Error(`no bundle for sku ${sku} in manifest`);
  if (entry.version !== version) {
    throw new Error(
      `manifest version ${entry.version} does not match required ${version} (strict matching)`);
  }

  // Disk preflight (spec S8): the archive and the unpacked tree coexist briefly.
  let free = null;
  try {
    const s = statfs(userDataDir);
    free = Number(s.bavail) * Number(s.bsize);
  } catch { /* fs without statfs support: skip the preflight */ }
  const need = entry.size + (entry.installedSize || 0) + 512 * 1024 * 1024;
  if (free !== null && free < need) {
    const gb = (n) => (n / 1e9).toFixed(1);
    throw new Error(`not enough disk space: need ~${gb(need)} GB free, have ${gb(free)} GB`);
  }

  const stage = stagingDir(userDataDir);
  fs.mkdirSync(stage, { recursive: true });
  const wholeName = archiveName(sku, version);
  pruneStaging(userDataDir, wholeName);

  const total = entry.size;
  let completed = 0;
  for (const part of entry.parts) {
    await downloadPart({
      url: `${baseUrl}/${part.name}`,
      dest: path.join(stage, part.name),
      part, fetchImpl, signal,
      onPartProgress: (received) =>
        onProgress?.({ phase: 'download', downloaded: completed + received, total }),
    });
    completed += part.size;
  }

  onProgress?.({ phase: 'verify', downloaded: total, total });
  const archive = path.join(stage, wholeName);
  if (entry.parts.length > 1) {
    await concatParts(entry.parts.map((p) => path.join(stage, p.name)), archive);
    await verifySha256(archive, entry.sha256);   // whole-archive identity check
    for (const p of entry.parts) fs.rmSync(path.join(stage, p.name), { force: true });
  }
  // Single part: the staged part IS the archive (same file name) and its
  // sha256 was already verified by downloadPart — no second 2 GB hash pass.

  // A running sidecar holds its python open; on Windows the rename swap below
  // would fail on the locked exe. Stop it first (spec S9) — the renderer
  // restarts it on demand after install.
  stopSidecar?.();

  const dest = bundleInstallDir(userDataDir, sku);
  const tmpDir = `${dest}.tmp`;
  const oldDir = `${dest}.old`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(oldDir, { recursive: true, force: true });
  onProgress?.({ phase: 'extract', downloaded: total, total });
  await extractTarZst(archive, tmpDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Two-rename swap: dest is never deleted before the replacement is ready; on
  // failure the previous bundle is restored from .old before rethrowing.
  let movedExisting = false;
  try {
    if (fs.existsSync(dest)) { fs.renameSync(dest, oldDir); movedExisting = true; }
    fs.renameSync(tmpDir, dest);
  } catch (error) {
    if (movedExisting && !fs.existsSync(dest) && fs.existsSync(oldDir)) fs.renameSync(oldDir, dest);
    throw error;
  }
  fs.rmSync(oldDir, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  fs.writeFileSync(path.join(dest, 'bundle.json'), JSON.stringify({ sku, version }));
  return { version };
}

// Delete an installed bundle (frees several GB — the engine card's Remove action).
// Staged downloads are left alone: version-named files never go stale silently
// (pruneStaging on the next install drops anything that no longer matches).
function removeBundle(userDataDir, sku) {
  fs.rmSync(bundleInstallDir(userDataDir, sku), { recursive: true, force: true });
}
```

Add `removeBundle` to `module.exports`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run electron/sidecar-bundle.test.js`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add electron/sidecar-bundle.js electron/sidecar-bundle.test.js
git commit -m "feat(electron): staged resumable install pipeline with preflight and phases"
```

---

### Task 6: Main-process IPC v2 + GPU name + preload channels

**Files:**
- Modify: `electron/sidecar-sku.js` (add `parseGpuName`, `nvidiaGpuName`)
- Modify: `electron/main.js:478-512` (replace the sidecar-bundle IPC block)
- Modify: `electron/preload.js` (3 new invoke channels after line 137)
- Test: `electron/sidecar-sku.test.js` (append), `electron/preload.native.test.js` (extend)

**Interfaces:**
- Consumes: Task 5 `installBundle`/`removeBundle`/`stagedBytes`/`requiredSidecarVersion`/`bundleBaseUrl`; existing `nativeHost` instance (`electron/main.js:17`) and `resolvePython` (`electron/native-host-manager.js`).
- Produces IPC contract (consumed by Task 8's store):
  - `sidecar-bundle:status` → `{ok, sku, state: 'unsupported'|'absent'|'mismatch'|'ready', installed, installedVersion, requiredVersion, gpuName, stagedBytes, devVenvPresent}`
  - `sidecar-bundle:manifest` → `{ok, size, installedSize}` | `{ok: false, error}`
  - `sidecar-bundle:install` → `{ok: true, sku, version}` | `{ok: false, sku, cancelled: true}` | `{ok: false, sku, error}`
  - `sidecar-bundle:cancel` → `{ok: true}` (aborts the stream, keeps staging)
  - `sidecar-bundle:remove` → `{ok: true}` (stops sidecar, deletes install dir)
  - `sidecar-sku.js`: `parseGpuName(stdout) -> string|null`, `nvidiaGpuName() -> string|null` (memoized `nvidia-smi -L`).

- [ ] **Step 1: Write the failing tests**

Append to `electron/sidecar-sku.test.js` (extend the import with `parseGpuName`):

```javascript
describe('parseGpuName', () => {
  it('extracts the marketing name from nvidia-smi -L', () => {
    expect(parseGpuName('GPU 0: NVIDIA GeForce RTX 4070 (UUID: GPU-1234)\n'))
      .toBe('NVIDIA GeForce RTX 4070');
  });
  it('returns null on empty/garbage output', () => {
    expect(parseGpuName('')).toBeNull();
    expect(parseGpuName(undefined)).toBeNull();
    expect(parseGpuName('No devices found')).toBeNull();
  });
});
```

In `electron/preload.native.test.js`, REPLACE the existing sidecar-bundle channel assertion (`it('includes the sidecar-bundle channels', ...)`) so the list covers all five invoke channels + the progress push:

```javascript
  it('includes the sidecar-bundle channels', () => {
    const src = readFileSync(join(__dirname, 'preload.js'), 'utf8');
    for (const ch of [
      'sidecar-bundle:status', 'sidecar-bundle:install', 'sidecar-bundle:cancel',
      'sidecar-bundle:manifest', 'sidecar-bundle:remove', 'sidecar-bundle-progress',
    ]) {
      expect(src).toContain(`'${ch}'`);
    }
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/sidecar-sku.test.js electron/preload.native.test.js`
Expected: FAIL — `parseGpuName` not exported; cancel/manifest/remove channels missing.

- [ ] **Step 3: Add the GPU-name probe to `electron/sidecar-sku.js`**

Add after `_probeNvidiaUncached` (after line 27):

```javascript
// "GPU 0: NVIDIA GeForce RTX 4070 (UUID: GPU-...)" -> "NVIDIA GeForce RTX 4070"
function parseGpuName(stdout) {
  const m = /^GPU \d+:\s*(.+?)\s*\(/m.exec(stdout || '');
  return m ? m[1] : null;
}

let _gpuName;  // memoized once per process, like probeNvidia
function nvidiaGpuName() {
  if (_gpuName !== undefined) return _gpuName;
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('nvidia-smi', ['-L'], { timeout: 4000, encoding: 'utf8' });
    _gpuName = r.status === 0 ? parseGpuName(r.stdout) : null;
  } catch {
    _gpuName = null;
  }
  return _gpuName;
}
```

Extend the exports: `module.exports = { detectSku, probeNvidia, bundleRootFor, parseGpuName, nvidiaGpuName };`

- [ ] **Step 4: Replace the IPC block in `electron/main.js`**

Replace lines 478–512 (from `// ---- Self-contained sidecar bundle install/status ...` through the closing `});` of the install handler) with:

```javascript
// ---- Self-contained sidecar bundle install/status (distribution spec) ----
// SKU detection + bundle download live in the main process because the sidecar
// (which the bundle provides) is not yet running. Progress is pushed to the
// renderer on 'sidecar-bundle-progress', mirroring the model-download UX.
const { detectSku: _detectSku, probeNvidia: _probeNvidia, nvidiaGpuName: _nvidiaGpuName } = require('./sidecar-sku');
const { resolvePython: _resolveSidecarPython } = require('./native-host-manager');
const sidecarBundle = require('./sidecar-bundle');
const _currentSku = () =>
  _detectSku(process.platform, { hasNvidia: _probeNvidia(), arch: process.arch });
ipcMain.handle('sidecar-bundle:status', () => {
  const sku = _currentSku();
  if (sku === null) {
    return { ok: true, sku: null, state: 'unsupported', installed: false,
             installedVersion: null, requiredVersion: null, gpuName: null,
             stagedBytes: 0, devVenvPresent: false };
  }
  let requiredVersion = null;
  try { requiredVersion = sidecarBundle.requiredSidecarVersion(); }
  catch { /* tree without the field — no version gate */ }
  const st = sidecarBundle.bundleStatus(app.getPath('userData'), sku);
  // Strict matching (spec S2): an installed bundle at any other version is a
  // 'mismatch' — the renderer presents it as "engine update required".
  const state = !st.installed ? 'absent'
    : (requiredVersion === null || st.version === requiredVersion) ? 'ready' : 'mismatch';
  let devVenvPresent = false;
  try { devVenvPresent = require('fs').existsSync(_resolveSidecarPython()); } catch { /* keep false */ }
  return {
    ok: true, sku, state,
    installed: st.installed, installedVersion: st.version, requiredVersion,
    gpuName: _nvidiaGpuName(),
    stagedBytes: requiredVersion === null ? 0
      : sidecarBundle.stagedBytes(app.getPath('userData'), sku, requiredVersion),
    devVenvPresent,
  };
});
// Best-effort manifest peek so the engine card can show exact sizes pre-install.
ipcMain.handle('sidecar-bundle:manifest', async () => {
  const sku = _currentSku();
  if (sku === null) return { ok: false, error: 'unsupported platform' };
  try {
    const version = sidecarBundle.requiredSidecarVersion();
    const r = await fetch(`${sidecarBundle.bundleBaseUrl(version)}/manifest.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const entry = sidecarBundle.pickBundle(await r.json(), sku);
    if (!entry) throw new Error(`no bundle for sku ${sku}`);
    return { ok: true, size: entry.size ?? null, installedSize: entry.installedSize ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
// In-flight guard + cancellation. Cancel aborts the network stream but KEEPS
// the staging files — re-invoking install resumes from the staged bytes (S7).
let _bundleInstalling = false;
let _bundleAbort = null;
ipcMain.handle('sidecar-bundle:install', async (event) => {
  const sku = _currentSku();
  if (sku === null) return { ok: false, sku: null, error: 'no sidecar bundle for this platform' };
  if (_bundleInstalling) return { ok: false, sku, error: 'bundle install already in progress' };
  _bundleInstalling = true;
  _bundleAbort = new AbortController();
  try {
    const r = await sidecarBundle.installBundle({
      sku,
      version: sidecarBundle.requiredSidecarVersion(),
      userDataDir: app.getPath('userData'),
      signal: _bundleAbort.signal,
      stopSidecar: () => nativeHost.stop(),
      onProgress: (p) => {
        if (!event.sender.isDestroyed()) event.sender.send('sidecar-bundle-progress', { sku, ...p });
      },
    });
    return { ok: true, sku, ...r };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, sku, cancelled: true };
    return { ok: false, sku, error: e instanceof Error ? e.message : String(e) };
  } finally {
    _bundleInstalling = false;
    _bundleAbort = null;
  }
});
ipcMain.handle('sidecar-bundle:cancel', () => {
  _bundleAbort?.abort();
  return { ok: true };
});
ipcMain.handle('sidecar-bundle:remove', () => {
  const sku = _currentSku();
  if (sku === null) return { ok: false, error: 'unsupported platform' };
  nativeHost.stop();  // release file locks before deleting (Windows)
  sidecarBundle.removeBundle(app.getPath('userData'), sku);
  return { ok: true };
});
```

- [ ] **Step 5: Whitelist the new preload channels**

In `electron/preload.js`, the invoke whitelist currently reads (lines 135–137):

```javascript
        // Self-contained sidecar bundle install/status (renderer → main)
        'sidecar-bundle:status',
        'sidecar-bundle:install',
```

Replace with:

```javascript
        // Self-contained sidecar bundle install/status (renderer → main)
        'sidecar-bundle:status',
        'sidecar-bundle:install',
        'sidecar-bundle:cancel',
        'sidecar-bundle:manifest',
        'sidecar-bundle:remove',
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run electron/sidecar-sku.test.js electron/preload.native.test.js electron/sidecar-bundle.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/sidecar-sku.js electron/sidecar-sku.test.js electron/main.js electron/preload.js electron/preload.native.test.js
git commit -m "feat(electron): bundle IPC v2 - strict-match status, cancel, manifest peek, remove"
```

---

### Task 7: Strict version gate in `resolveSidecarLaunch`

**Files:**
- Modify: `electron/native-host-manager.js` (extend `resolveSidecarLaunch`; wire `requiredVersion`/`readVersion` into `start()`)
- Test: `electron/native-host-manager.test.js` (append)

**Interfaces:**
- Consumes: `requiredSidecarVersion` (Task 4).
- Produces: `resolveSidecarLaunch({platform, envOverride, bundleRoot, requiredVersion?, readVersion?, devVenvPython, devCwd, existsSync})` — bundle source accepted only when `!requiredVersion || readVersion(bundleRoot) === requiredVersion`; `env`/`venv` paths unchanged (spec S2 exemptions).

- [ ] **Step 1: Write the failing tests**

Append to `electron/native-host-manager.test.js`:

```javascript
describe('resolveSidecarLaunch strict version matching (spec S2)', () => {
  const base = {
    platform: 'linux', envOverride: undefined, bundleRoot: '/u/sidecar/linux-nvidia',
    devVenvPython: '/repo/sidecar/.venv/bin/python', devCwd: '/repo/sidecar',
    existsSync: () => true,
  };
  it('accepts the bundle when versions match', () => {
    const l = resolveSidecarLaunch({ ...base, requiredVersion: '0.1.0', readVersion: () => '0.1.0' });
    expect(l.source).toBe('bundle');
  });
  it('rejects a stale bundle and falls back to venv', () => {
    const l = resolveSidecarLaunch({ ...base, requiredVersion: '0.2.0', readVersion: () => '0.1.0' });
    expect(l.source).toBe('venv');
  });
  it('no requiredVersion keeps the old behavior (bundle accepted)', () => {
    const l = resolveSidecarLaunch({ ...base, requiredVersion: null, readVersion: () => '0.1.0' });
    expect(l.source).toBe('bundle');
  });
  it('env override bypasses the version gate entirely', () => {
    const l = resolveSidecarLaunch({
      ...base, envOverride: '/x/py', requiredVersion: '9.9.9', readVersion: () => '0.0.1',
    });
    expect(l.source).toBe('env');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/native-host-manager.test.js`
Expected: FAIL — "rejects a stale bundle" gets `source: 'bundle'` (no gate yet).

- [ ] **Step 3: Extend `resolveSidecarLaunch`**

In `electron/native-host-manager.js`, REPLACE the function (lines 17–28) with:

```javascript
function resolveSidecarLaunch({ platform, envOverride, bundleRoot, requiredVersion, readVersion, devVenvPython, devCwd, existsSync }) {
  if (envOverride) return { python: envOverride, cwd: devCwd, source: 'env' };
  if (bundleRoot) {
    const bundlePython = platform === 'win32'
      ? path.join(bundleRoot, 'python', 'python.exe')
      : path.join(bundleRoot, 'python', 'bin', 'python3');
    if (existsSync(bundlePython)) {
      // Strict matching (spec S2): an installed bundle is only usable when its
      // version equals the app's sidecarVersion. A stale bundle falls through to
      // the venv path — which does not exist in packaged apps, so the start
      // fails and the UI shows "engine update required" instead of silently
      // running an untested app x sidecar combination.
      const installed = readVersion ? readVersion(bundleRoot) : null;
      if (!requiredVersion || installed === requiredVersion) {
        return { python: bundlePython, cwd: path.join(bundleRoot, 'app'), source: 'bundle' };
      }
    }
  }
  return { python: devVenvPython, cwd: devCwd, source: 'venv' };
}
```

- [ ] **Step 4: Wire it into `start()`**

In `start()`, directly after the `bundleRoot` resolution block (after line 71, before `const launch = resolveSidecarLaunch({`), add:

```javascript
      let requiredVersion = null;
      if (!envOverride) {
        try { requiredVersion = require('./sidecar-bundle').requiredSidecarVersion(); }
        catch { /* tree without the field — no version gate */ }
      }
```

and extend the `resolveSidecarLaunch` call (lines 72–79) with the two new properties:

```javascript
      const launch = resolveSidecarLaunch({
        platform: process.platform,
        envOverride,
        bundleRoot,
        requiredVersion,
        readVersion: (root) => {
          try { return JSON.parse(fs.readFileSync(path.join(root, 'bundle.json'), 'utf8')).version ?? null; }
          catch { return null; }
        },
        devVenvPython: resolvePython(),
        devCwd: path.join(__dirname, '..', 'sidecar'),
        existsSync: fs.existsSync,
      });
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run electron/native-host-manager.test.js`
Expected: PASS (existing suites + the 4 new tests).

- [ ] **Step 6: Commit**

```bash
git add electron/native-host-manager.js electron/native-host-manager.test.js
git commit -m "feat(electron): strict sidecarVersion gate in bundle launch resolution"
```

---

### Task 8: Renderer store — bundle state machine v2

**Files:**
- Modify: `src/stores/nativeModelStore.ts` (interface fields, initial state, `refreshBundle`/`installBundle` rewrite, new actions, `ensureCatalog` guard, one selector)
- Test: `src/stores/nativeModelStore.test.ts` (replace the bundle suite)

**Interfaces:**
- Consumes: IPC contract from Task 6.
- Produces (store):
  - `bundleStatus: 'unknown' | 'unsupported' | 'absent' | 'mismatch' | 'paused' | 'installing' | 'ready' | 'error'`
  - `bundlePhase: 'download' | 'verify' | 'extract' | null`, `bundleRequiredVersion: string | null`, `bundleStagedBytes: number`, `bundleGpuName: string | null`, `bundleDevVenv: boolean`, `bundleSize: number | null`, `bundleInstalledSize: number | null`
  - actions `cancelBundle()`, `removeBundle()`, `fetchBundleEntry()`; selector `useNativeBundlePhase`
  - `refreshBundle` maps: `sku === null → 'unsupported'`; `state === 'absent'|'mismatch'` with `stagedBytes > 0 → 'paused'`; no-op while `'installing'`.
  - `ensureCatalog` refuses to boot a `'mismatch'` bundle (sets `sidecarStatus: 'unavailable'`).
- Consumed by Task 9 (gating message) and Task 10 (EngineSection).

- [ ] **Step 1: Replace the bundle test suite**

In `src/stores/nativeModelStore.test.ts`, REPLACE the whole `describe('nativeModelStore bundle install (spec D10)', ...)` block (lines 258–295) with:

```typescript
describe('nativeModelStore bundle state machine (distribution spec)', () => {
  const statusReply = (over: Record<string, unknown> = {}) => ({
    ok: true, sku: 'linux-nvidia', state: 'ready', installed: true,
    installedVersion: '0.1.0', requiredVersion: '0.1.0',
    gpuName: 'NVIDIA GeForce RTX 4070', stagedBytes: 0, devVenvPresent: false,
    ...over,
  });

  beforeEach(() => {
    useNativeModelStore.setState({
      bundleStatus: 'unknown', bundlePhase: null, bundleSku: null, bundleVersion: null,
      bundleRequiredVersion: null, bundleStagedBytes: 0, bundleGpuName: null,
      bundleDevVenv: false, bundleSize: null, bundleInstalledSize: null,
      bundleProgress: { downloaded: 0, total: 0 }, bundleError: '',
    });
  });

  it('refreshBundle maps ready + carries gpu/dev metadata', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(statusReply()),
    };
    await useNativeModelStore.getState().refreshBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('ready');
    expect(s.bundleVersion).toBe('0.1.0');
    expect(s.bundleRequiredVersion).toBe('0.1.0');
    expect(s.bundleGpuName).toBe('NVIDIA GeForce RTX 4070');
  });

  it('refreshBundle maps mismatch and unsupported', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(statusReply({
        state: 'mismatch', installedVersion: '0.1.0', requiredVersion: '0.2.0' })),
    };
    await useNativeModelStore.getState().refreshBundle();
    expect(useNativeModelStore.getState().bundleStatus).toBe('mismatch');

    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(statusReply({ sku: null, state: 'unsupported', installed: false })),
    };
    await useNativeModelStore.getState().refreshBundle();
    expect(useNativeModelStore.getState().bundleStatus).toBe('unsupported');
  });

  it('refreshBundle maps absent+stagedBytes to paused', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(statusReply({
        state: 'absent', installed: false, installedVersion: null, stagedBytes: 812 })),
    };
    await useNativeModelStore.getState().refreshBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('paused');
    expect(s.bundleStagedBytes).toBe(812);
  });

  it('refreshBundle is a no-op while installing', async () => {
    useNativeModelStore.setState({ bundleStatus: 'installing' });
    const invoke = vi.fn();
    (globalThis as any).window.electron = { invoke };
    await useNativeModelStore.getState().refreshBundle();
    expect(invoke).not.toHaveBeenCalled();
    expect(useNativeModelStore.getState().bundleStatus).toBe('installing');
  });

  it('installBundle streams phased progress then flips to ready', async () => {
    let progressCb: ((p: any) => void) | null = null;
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: true, sku: 'linux-nvidia', version: '0.1.0' }),
      receive: (ch: string, f: any) => { if (ch === 'sidecar-bundle-progress') progressCb = f; },
      removeListener: () => {},
    };
    const p = useNativeModelStore.getState().installBundle();
    expect(useNativeModelStore.getState().bundleStatus).toBe('installing');
    progressCb?.({ phase: 'download', downloaded: 5, total: 10 });
    expect(useNativeModelStore.getState().bundleProgress).toEqual({ downloaded: 5, total: 10 });
    expect(useNativeModelStore.getState().bundlePhase).toBe('download');
    progressCb?.({ phase: 'extract', downloaded: 10, total: 10 });
    expect(useNativeModelStore.getState().bundlePhase).toBe('extract');
    await p;
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('ready');
    expect(s.bundleVersion).toBe('0.1.0');
    expect(s.bundlePhase).toBeNull();
  });

  it('installBundle cancelled -> paused with staged bytes kept', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: false, sku: 'linux-nvidia', cancelled: true }),
      receive: (ch: string, f: any) => { if (ch === 'sidecar-bundle-progress') f({ phase: 'download', downloaded: 812, total: 2000 }); },
      removeListener: () => {},
    };
    await useNativeModelStore.getState().installBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('paused');
    expect(s.bundleStagedBytes).toBe(812);
  });

  it('installBundle surfaces an install error', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: false, error: 'not enough disk space: need ~7.4 GB free, have 3.1 GB' }),
      receive: () => {}, removeListener: () => {},
    };
    await useNativeModelStore.getState().installBundle();
    const s = useNativeModelStore.getState();
    expect(s.bundleStatus).toBe('error');
    expect(s.bundleError).toMatch(/disk space/);
  });

  it('fetchBundleEntry stores manifest sizes best-effort', async () => {
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue({ ok: true, size: 2040, installedSize: 4900 }),
    };
    await useNativeModelStore.getState().fetchBundleEntry();
    const s = useNativeModelStore.getState();
    expect(s.bundleSize).toBe(2040);
    expect(s.bundleInstalledSize).toBe(4900);
  });
});
```

(Ensure `beforeEach` is included in the vitest import of this test file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL — unknown fields (`bundlePhase`, …), missing actions, old status mapping.

- [ ] **Step 3: Extend the interface**

In `src/stores/nativeModelStore.ts`, REPLACE the bundle members of the `NativeModelStore` interface (lines 20–33, from `bundleSku` through `installBundle`) with:

```typescript
  /** Detected bundle SKU for this machine (linux-nvidia | win-nvidia | win-directml | mac). */
  bundleSku: string | null;
  /** Self-contained sidecar bundle lifecycle (distribution spec S2/S7/S10). */
  bundleStatus: 'unknown' | 'unsupported' | 'absent' | 'mismatch' | 'paused' | 'installing' | 'ready' | 'error';
  /** Install pipeline phase while `bundleStatus === 'installing'`. */
  bundlePhase: 'download' | 'verify' | 'extract' | null;
  /** Installed bundle version (from its bundle.json marker), if any. */
  bundleVersion: string | null;
  /** Engine version this app build requires (package.json sidecarVersion). */
  bundleRequiredVersion: string | null;
  /** Bytes already staged from an interrupted download (drives 'paused'). */
  bundleStagedBytes: number;
  /** Detected GPU marketing name (nvidia-smi), for the engine card. */
  bundleGpuName: string | null;
  /** True when a dev venv python exists — dev checkout, quiet card note. */
  bundleDevVenv: boolean;
  /** Download / unpacked sizes from the manifest peek (null while unknown). */
  bundleSize: number | null;
  bundleInstalledSize: number | null;
  /** Live download progress while `bundleStatus === 'installing'`. */
  bundleProgress: { downloaded: number; total: number };
  /** Last bundle install error (empty when none). */
  bundleError: string;
  /** Query the main process for SKU + install/mismatch/staged state. */
  refreshBundle: () => Promise<void>;
  /** Download + unpack the machine's bundle via IPC, streaming phased progress. */
  installBundle: () => Promise<void>;
  /** Abort the in-flight download; staging is kept so install resumes later. */
  cancelBundle: () => Promise<void>;
  /** Delete the installed engine (frees disk) and re-read status. */
  removeBundle: () => Promise<void>;
  /** Best-effort manifest peek for exact sizes on the absent/mismatch card. */
  fetchBundleEntry: () => Promise<void>;
```

- [ ] **Step 4: Update initial state + actions**

REPLACE the bundle initial-state lines (137–141) with:

```typescript
  bundleSku: null,
  bundleStatus: 'unknown',
  bundlePhase: null,
  bundleVersion: null,
  bundleRequiredVersion: null,
  bundleStagedBytes: 0,
  bundleGpuName: null,
  bundleDevVenv: false,
  bundleSize: null,
  bundleInstalledSize: null,
  bundleProgress: { downloaded: 0, total: 0 },
  bundleError: '',
```

REPLACE `refreshBundle` (lines 143–161) and `installBundle` (lines 163–183) with:

```typescript
  refreshBundle: async () => {
    if (get().bundleStatus === 'installing') return; // never clobber a live install
    try {
      const r = await bundleInvoke('sidecar-bundle:status');
      if (!r?.ok) return;
      const base = r.sku === null ? 'unsupported' : (r.state as 'absent' | 'mismatch' | 'ready');
      // Staged bytes from an interrupted download surface as 'paused' (spec S7)
      // so the card offers Resume instead of a from-scratch Download.
      const status = (base === 'absent' || base === 'mismatch') && r.stagedBytes > 0 ? 'paused' : base;
      set({
        bundleSku: r.sku ?? null,
        bundleStatus: status,
        bundleVersion: r.installedVersion ?? null,
        bundleRequiredVersion: r.requiredVersion ?? null,
        bundleStagedBytes: r.stagedBytes ?? 0,
        bundleGpuName: r.gpuName ?? null,
        bundleDevVenv: !!r.devVenvPresent,
        bundleError: '',
        bundleProgress: { downloaded: 0, total: 0 },
        bundlePhase: null,
      });
    } catch {
      // best-effort; a dev checkout with no bundle simply stays 'unknown'
    }
  },

  installBundle: async () => {
    // Reentrancy guard: a double-click must not race two IPC installs.
    if (get().bundleStatus === 'installing') return;
    set({
      bundleStatus: 'installing', bundlePhase: 'download',
      bundleProgress: { downloaded: get().bundleStagedBytes, total: 0 }, bundleError: '',
    });
    const off = onBundleProgress((p) =>
      set({
        bundleProgress: { downloaded: p.downloaded ?? 0, total: p.total ?? 0 },
        bundlePhase: p.phase ?? 'download',
      }));
    try {
      const r = await bundleInvoke('sidecar-bundle:install');
      off?.();
      if (r?.ok) {
        set({
          bundleStatus: 'ready', bundleSku: r.sku ?? null, bundleVersion: r.version ?? null,
          bundlePhase: null, bundleStagedBytes: 0,
        });
        // Unlock the provider gate + warm the freshly installed sidecar.
        void revalidateNativeProvider();
      } else if (r?.cancelled) {
        set({
          bundleStatus: 'paused', bundlePhase: null,
          bundleStagedBytes: get().bundleProgress.downloaded,
        });
      } else {
        set({ bundleStatus: 'error', bundlePhase: null, bundleError: r?.error || 'bundle install failed' });
      }
    } catch (err) {
      off?.();
      set({
        bundleStatus: 'error', bundlePhase: null,
        bundleError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  cancelBundle: async () => {
    try { await bundleInvoke('sidecar-bundle:cancel'); } catch { /* main unreachable */ }
  },

  removeBundle: async () => {
    try {
      const r = await bundleInvoke('sidecar-bundle:remove');
      if (r?.ok) await get().refreshBundle();
    } catch { /* best-effort */ }
  },

  fetchBundleEntry: async () => {
    try {
      const r = await bundleInvoke('sidecar-bundle:manifest');
      if (r?.ok) set({ bundleSize: r.size ?? null, bundleInstalledSize: r.installedSize ?? null });
    } catch { /* offline — the card shows a placeholder size */ }
  },
```

- [ ] **Step 5: Guard `ensureCatalog` against a mismatched bundle**

In `ensureCatalog` (line 206), after the early-return on `ready/starting` (line 208) and BEFORE `set({ sidecarStatus: 'starting' });`, insert:

```typescript
    // Strict matching (spec S2): never boot a stale bundle. refreshBundle is a
    // cheap IPC; 'mismatch' shows as unavailable + the engine card's update CTA.
    await get().refreshBundle();
    if (get().bundleStatus === 'mismatch') {
      set({ sidecarStatus: 'unavailable' });
      return;
    }
```

- [ ] **Step 6: Add the phase selector**

After `useNativeBundleProgress` (line 373), add:

```typescript
export const useNativeBundlePhase = () => useNativeModelStore((s) => s.bundlePhase);
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS (all suites, including the existing ensureCatalog tests — with no `window.electron` mock, `refreshBundle` fails silently and the guard is a no-op).

- [ ] **Step 8: Commit**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "feat(native): bundle state machine v2 - paused/mismatch/phases + cancel/remove"
```

---

### Task 9: Provider-gate messages for engine states

**Files:**
- Modify: `src/stores/settingsStore.ts:1372-1379` (the LOCAL_NATIVE not-ready branch)
- Test: `src/stores/settingsStore.native-gate.test.ts` (create)

**Interfaces:**
- Consumes: `bundleStatus` from Task 8 (`ensureCatalog` has already refreshed it by the time the branch runs).
- Produces: sharper `validationMessage` when the sidecar is not ready because the ENGINE is the problem (mismatch/absent/paused) rather than a generic "unavailable". i18n keys follow the repo's inline-fallback convention (`settings.localNative*` keys live only as code fallbacks, like the existing ones).

- [ ] **Step 1: Write the failing test**

Create `src/stores/settingsStore.native-gate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The gate only runs inside Electron; force the environment check on.
vi.mock('../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/environment')>()),
  isElectron: () => true,
}));

import { useSettingsStore } from './settingsStore';
import { useNativeModelStore } from './nativeModelStore';
import { Provider } from '../types/Provider';

describe('validateApiKey LOCAL_NATIVE engine gating (spec S2/S10)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE });
    // Stub the store actions the branch calls so no WS/IPC is attempted.
    useNativeModelStore.setState({
      ensureCatalog: async () => {},
      refreshBundle: async () => {},
    } as never);
  });

  it('mismatch: reports that the engine needs an update', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'mismatch' } as never);
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/engine needs an update/i);
  });

  it('absent: points at the engine download', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'absent' } as never);
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/download the inference engine/i);
  });

  it('engine fine but sidecar down: keeps the generic unavailable message', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'ready' } as never);
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/unavailable/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/stores/settingsStore.native-gate.test.ts`
Expected: FAIL — mismatch/absent cases get the generic "unavailable" message.

- [ ] **Step 3: Refine the not-ready branch**

In `src/stores/settingsStore.ts`, the block at lines 1372–1379 currently reads:

```typescript
        const status = useNativeModelStore.getState().sidecarStatus;
        if (status !== 'ready') {
          const message = status === 'unavailable'
            ? i18n.t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')
            : i18n.t('settings.localNativeStarting', 'Starting the local engine…');
          set({ isApiKeyValid: false, availableModels: [], validationMessage: message, isValidating: false });
          return { valid: false, message, validating: false };
        }
```

Replace with:

```typescript
        const status = useNativeModelStore.getState().sidecarStatus;
        if (status !== 'ready') {
          // When the ENGINE (bundle) is the reason, say so precisely — the
          // engine card in provider settings carries the matching CTA (spec S10).
          const bundle = useNativeModelStore.getState().bundleStatus;
          const message = bundle === 'mismatch'
            ? i18n.t('settings.localNativeEngineUpdateRequired',
                'The inference engine needs an update — open provider settings to update it')
            : (bundle === 'absent' || bundle === 'paused')
              ? i18n.t('settings.localNativeEngineRequired',
                  'Download the inference engine in provider settings')
              : status === 'unavailable'
                ? i18n.t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')
                : i18n.t('settings.localNativeStarting', 'Starting the local engine…');
          set({ isApiKeyValid: false, availableModels: [], validationMessage: message, isValidating: false });
          return { valid: false, message, validating: false };
        }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/stores/settingsStore.native-gate.test.ts`
Expected: PASS (3 tests). If the mismatch test fails because `ensureCatalog` stubbing didn't hold, check that the `setState` cast uses `as never` (zustand accepts action overrides in partial state).

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.native-gate.test.ts
git commit -m "feat(native): engine-aware provider gate messages (update/download required)"
```

---

### Task 10: EngineSection card + wiring + i18n

**Files:**
- Create: `src/components/Settings/sections/EngineSection.tsx`
- Create: `src/components/Settings/sections/EngineSection.scss`
- Create: `src/components/Settings/sections/EngineSection.test.tsx`
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (import + top-level hook + render at line 1712–1715)
- Modify: `src/locales/en/translation.json`, `src/locales/zh_CN/translation.json`, `src/locales/zh_TW/translation.json`, `src/locales/ja/translation.json` (add the `engine` group)

**Interfaces:**
- Consumes: store fields/actions from Task 8.
- Produces: `EngineSection: React.FC<{ isSessionActive?: boolean }>` — the one surface for all engine states (spec S10 state machine); model area gating in `renderLocalNativeSettings`.

- [ ] **Step 1: Write the failing component tests**

Create `src/components/Settings/sections/EngineSection.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngineSection } from './EngineSection';
import { useNativeModelStore } from '../../../stores/nativeModelStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, def: string, vars?: Record<string, unknown>) =>
      def.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars?.[v] ?? '')),
  }),
}));

const setBundle = (patch: Record<string, unknown>) =>
  useNativeModelStore.setState({
    refreshBundle: async () => {}, fetchBundleEntry: async () => {},
    installBundle: async () => {}, cancelBundle: async () => {}, removeBundle: async () => {},
    ...patch,
  } as never);

describe('EngineSection states (spec S10)', () => {
  beforeEach(() => setBundle({
    bundleStatus: 'unknown', bundleDevVenv: false, bundleGpuName: null,
    bundleSku: null, bundleVersion: null, bundleRequiredVersion: null,
    bundleSize: null, bundleInstalledSize: null, bundleStagedBytes: 0,
    bundlePhase: null, bundleProgress: { downloaded: 0, total: 0 }, bundleError: '',
  }));

  it('renders nothing while unknown', () => {
    const { container } = render(<EngineSection />);
    expect(container.firstChild).toBeNull();
  });

  it('unsupported: explanatory note only', () => {
    setBundle({ bundleStatus: 'unsupported' });
    render(<EngineSection />);
    expect(screen.getByText(/not supported/)).toBeTruthy();
  });

  it('dev venv without a bundle: quiet dev note, no download nag', () => {
    setBundle({ bundleStatus: 'absent', bundleDevVenv: true });
    render(<EngineSection />);
    expect(screen.getByText(/Development mode/)).toBeTruthy();
    expect(screen.queryByText(/Download engine/)).toBeNull();
  });

  it('absent: download CTA with sku, gpu and size', () => {
    setBundle({
      bundleStatus: 'absent', bundleSku: 'linux-nvidia',
      bundleGpuName: 'NVIDIA GeForce RTX 4070', bundleSize: 2 * 1024 ** 3,
    });
    render(<EngineSection />);
    expect(screen.getByText(/Download engine/)).toBeTruthy();
    expect(screen.getByText(/linux-nvidia/)).toBeTruthy();
    expect(screen.getByText(/RTX 4070/)).toBeTruthy();
    expect(screen.getByText(/2\.0 GB/)).toBeTruthy();
  });

  it('mismatch: update CTA with both versions', () => {
    setBundle({ bundleStatus: 'mismatch', bundleVersion: '0.1.0', bundleRequiredVersion: '0.2.0' });
    render(<EngineSection />);
    expect(screen.getByText(/0\.1\.0 → 0\.2\.0/)).toBeTruthy();
    expect(screen.getByText(/Update engine/)).toBeTruthy();
  });

  it('installing/download: percent + cancel', () => {
    setBundle({
      bundleStatus: 'installing', bundlePhase: 'download',
      bundleProgress: { downloaded: 512 * 1024 ** 2, total: 2 * 1024 ** 3 },
    });
    render(<EngineSection />);
    expect(screen.getByText(/25%/)).toBeTruthy();
    expect(screen.getByText(/Cancel/)).toBeTruthy();
  });

  it('installing/verify: indeterminate, no cancel', () => {
    setBundle({
      bundleStatus: 'installing', bundlePhase: 'verify',
      bundleProgress: { downloaded: 1, total: 1 },
    });
    render(<EngineSection />);
    expect(screen.getByText(/Verifying/)).toBeTruthy();
    expect(screen.queryByText(/Cancel/)).toBeNull();
  });

  it('paused: resume CTA with staged MB', () => {
    setBundle({ bundleStatus: 'paused', bundleStagedBytes: 812 * 1024 ** 2 });
    render(<EngineSection />);
    expect(screen.getByText(/812 MB/)).toBeTruthy();
    expect(screen.getByText(/Resume download/)).toBeTruthy();
  });

  it('error: message + retry', () => {
    setBundle({ bundleStatus: 'error', bundleError: 'not enough disk space: need ~7.4 GB free, have 3.1 GB' });
    render(<EngineSection />);
    expect(screen.getByText(/disk space/)).toBeTruthy();
    expect(screen.getByText(/Retry/)).toBeTruthy();
  });

  it('ready: version badge + remove affordance', () => {
    setBundle({ bundleStatus: 'ready', bundleVersion: '0.1.0', bundleInstalledSize: 4.9 * 1e9 });
    render(<EngineSection />);
    expect(screen.getByText(/Engine 0\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/Remove engine/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/Settings/sections/EngineSection.test.tsx`
Expected: FAIL — cannot resolve `./EngineSection`.

- [ ] **Step 3: Create `EngineSection.tsx`**

```tsx
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Download, X, RefreshCw, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useNativeModelStore } from '../../../stores/nativeModelStore';
import './EngineSection.scss';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const fmtGB = (n: number | null | undefined) => (n == null ? null : `${(n / GB).toFixed(1)} GB`);
const fmtMB = (n: number) => `${Math.round(n / MB)} MB`;

/**
 * Engine (sidecar bundle) install/update card — the gate above the native
 * model list (distribution spec S10). One surface for every engine state:
 * unsupported / absent / mismatch / paused / installing (phased) / error / ready.
 */
export const EngineSection: React.FC<{ isSessionActive?: boolean }> = ({ isSessionActive = false }) => {
  const { t } = useTranslation();
  const {
    bundleStatus, bundleSku, bundleVersion, bundleRequiredVersion, bundleProgress,
    bundlePhase, bundleError, bundleStagedBytes, bundleGpuName, bundleDevVenv,
    bundleSize, bundleInstalledSize,
    refreshBundle, installBundle, cancelBundle, removeBundle, fetchBundleEntry,
  } = useNativeModelStore();

  useEffect(() => { void refreshBundle(); }, [refreshBundle]);
  // Peek the manifest for exact sizes once the card knows it must offer a download.
  useEffect(() => {
    if ((bundleStatus === 'absent' || bundleStatus === 'mismatch' || bundleStatus === 'paused')
        && bundleSize == null) {
      void fetchBundleEntry();
    }
  }, [bundleStatus, bundleSize, fetchBundleEntry]);

  if (bundleStatus === 'unknown') return null;

  if (bundleStatus === 'unsupported') {
    return (
      <div className="engine-section">
        <div className="engine-section__row engine-section__row--muted">
          <AlertTriangle size={14} />
          <span>{t('engine.unsupported', 'Local inference is not supported on this device')}</span>
        </div>
      </div>
    );
  }

  // Dev checkout with a venv and no bundle: quiet note, no download nag —
  // the venv launch path keeps working (spec S2 exemption).
  if (bundleDevVenv && (bundleStatus === 'absent' || bundleStatus === 'paused')) {
    return (
      <div className="engine-section">
        <div className="engine-section__row engine-section__row--muted">
          <Cpu size={14} />
          <span>{t('engine.devMode', 'Development mode · local venv')}</span>
        </div>
      </div>
    );
  }

  const sizeLabel = fmtGB(bundleSize) ?? t('engine.sizeUnknown', 'size unavailable offline');
  const pct = bundleProgress.total > 0
    ? Math.min(100, Math.round((bundleProgress.downloaded / bundleProgress.total) * 100))
    : 0;

  return (
    <div className="engine-section">
      <div className="engine-section__header">
        <Cpu size={16} />
        <span className="engine-section__title">{t('engine.title', 'Inference Engine')}</span>
        {bundleStatus === 'ready' && (
          <span className="engine-section__version">
            <CheckCircle size={14} /> {t('engine.ready', 'Engine {{version}}', { version: bundleVersion })}
          </span>
        )}
      </div>

      {bundleGpuName && (
        <div className="engine-section__row">
          {t('engine.detected', 'Detected: {{gpu}}', { gpu: bundleGpuName })}
        </div>
      )}

      {bundleStatus === 'absent' && (
        <>
          <div className="engine-section__row">
            {t('engine.package', 'Engine package: {{sku}} · {{size}}', { sku: bundleSku, size: sizeLabel })}
          </div>
          <button className="engine-section__action" disabled={isSessionActive}
                  onClick={() => void installBundle()}>
            <Download size={14} /> {t('engine.download', 'Download engine')}
          </button>
        </>
      )}

      {bundleStatus === 'mismatch' && (
        <>
          <div className="engine-section__row engine-section__row--warn">
            <AlertTriangle size={14} />
            {t('engine.updateRequired', 'Engine update required ({{from}} → {{to}})',
              { from: bundleVersion, to: bundleRequiredVersion })}
          </div>
          <button className="engine-section__action" disabled={isSessionActive}
                  onClick={() => void installBundle()}>
            <RefreshCw size={14} /> {t('engine.update', 'Update engine')}
            {bundleSize != null ? ` · ${fmtGB(bundleSize)}` : ''}
          </button>
        </>
      )}

      {bundleStatus === 'paused' && (
        <>
          <div className="engine-section__row">
            {t('engine.paused', 'Paused · {{done}} downloaded', { done: fmtMB(bundleStagedBytes) })}
          </div>
          <button className="engine-section__action" onClick={() => void installBundle()}>
            <Download size={14} /> {t('engine.resume', 'Resume download')}
          </button>
        </>
      )}

      {bundleStatus === 'installing' && (
        <>
          <div className="engine-section__row">
            {bundlePhase === 'verify' ? t('engine.verifying', 'Verifying…')
              : bundlePhase === 'extract' ? t('engine.extracting', 'Extracting…')
              : t('engine.downloading', '{{done}} / {{total}} · {{pct}}%', {
                  done: fmtMB(bundleProgress.downloaded),
                  total: fmtGB(bundleProgress.total) ?? '…',
                  pct,
                })}
          </div>
          <div className="engine-section__bar">
            <div
              className={`engine-section__bar-fill${bundlePhase !== 'download' ? ' engine-section__bar-fill--busy' : ''}`}
              style={bundlePhase === 'download' ? { width: `${pct}%` } : undefined}
            />
          </div>
          {bundlePhase === 'download' && (
            <button className="engine-section__action engine-section__action--secondary"
                    onClick={() => void cancelBundle()}>
              <X size={14} /> {t('engine.cancel', 'Cancel')}
            </button>
          )}
        </>
      )}

      {bundleStatus === 'error' && (
        <>
          <div className="engine-section__row engine-section__row--error">{bundleError}</div>
          <button className="engine-section__action" onClick={() => void installBundle()}>
            <RefreshCw size={14} /> {t('engine.retry', 'Retry')}
          </button>
        </>
      )}

      {bundleStatus === 'ready' && (
        <div className="engine-section__row engine-section__row--muted">
          {bundleInstalledSize != null && (
            <span>{t('engine.onDisk', '{{size}} on disk', { size: fmtGB(bundleInstalledSize) })}</span>
          )}
          <button
            className="engine-section__link" disabled={isSessionActive}
            onClick={() => {
              if (window.confirm(t('engine.removeConfirm', 'Remove the engine and free disk space?'))) {
                void removeBundle();
              }
            }}
          >
            <Trash2 size={13} /> {t('engine.remove', 'Remove engine')}
          </button>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Create `EngineSection.scss`**

```scss
// Engine (sidecar bundle) card — dark-theme styling consistent with the
// model-management cards (see ModelManagementSection.scss).
.engine-section {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__header { display: flex; align-items: center; gap: 8px; color: #e0e0e0; }
  &__title { font-weight: 600; font-size: 13px; flex: 1; }
  &__version { display: inline-flex; align-items: center; gap: 4px; color: #10a37f; font-size: 12px; }

  &__row {
    display: flex; align-items: center; gap: 6px; font-size: 12px; color: #b0b0b0;
    &--muted { color: #888; }
    &--warn { color: #e6a23c; }
    &--error { color: #e74c3c; }
  }

  &__bar { height: 6px; border-radius: 3px; background: #333; overflow: hidden; }
  &__bar-fill {
    height: 100%; background: #10a37f; transition: width 0.2s ease;
    &--busy { width: 100%; animation: engine-busy 1.2s linear infinite; }
  }

  &__action {
    align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
    background: #10a37f; color: #fff; border: none; border-radius: 6px;
    padding: 6px 12px; font-size: 12px; cursor: pointer;
    &:hover { background: #0e9271; }
    &:disabled { opacity: 0.5; cursor: default; }
    &--secondary { background: #444; &:hover { background: #555; } }
  }

  &__link {
    display: inline-flex; align-items: center; gap: 4px; background: none; border: none;
    color: #888; font-size: 12px; cursor: pointer; padding: 0; margin-left: auto;
    &:hover { color: #e74c3c; }
    &:disabled { opacity: 0.5; cursor: default; }
  }

  &__models-placeholder { font-size: 12px; color: #888; padding: 10px 4px 2px; }
}

@keyframes engine-busy {
  0% { opacity: 0.35; }
  50% { opacity: 0.7; }
  100% { opacity: 0.35; }
}
```

- [ ] **Step 5: Run the component tests**

Run: `npx vitest run src/components/Settings/sections/EngineSection.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 6: Wire into `ProviderSpecificSettings.tsx`**

Add the import next to the `NativeModelManagementSection` import (line 58):

```tsx
import { EngineSection } from './EngineSection';
```

Add a top-level hook near the component's other store hooks (hooks must NOT live inside `renderLocalNativeSettings`; put this alongside the existing `useNativeModelStore`/settings hooks at the top of the component — search for where `nativeCatalog` or `localNativeSettings` hooks are declared):

```tsx
  // Engine gate (spec S10): the native model list only renders once the engine
  // is usable (installed bundle at the right version, or a dev venv checkout).
  const engineBundleStatus = useNativeModelStore((s) => s.bundleStatus);
  const engineDevVenv = useNativeModelStore((s) => s.bundleDevVenv);
  const engineUsable = engineBundleStatus === 'ready' || engineDevVenv;
```

(If `useNativeModelStore` is not yet imported in this file, add `import { useNativeModelStore } from '../../../stores/nativeModelStore';` — adjust the relative depth to match the file's existing store imports.)

Then in `renderLocalNativeSettings`, replace line 1715:

```tsx
        <NativeModelManagementSection isSessionActive={isSessionActive} />
```

with:

```tsx
        <EngineSection isSessionActive={isSessionActive} />
        {engineUsable ? (
          <NativeModelManagementSection isSessionActive={isSessionActive} />
        ) : (
          <div className="engine-section__models-placeholder">
            {t('engine.installHint', 'Install the engine to browse and download models')}
          </div>
        )}
```

(`t` is already available in this component — it renders translated labels throughout; verify the destructuring at the top and reuse it.)

- [ ] **Step 7: Add the i18n `engine` group**

In each of `src/locales/en/translation.json`, `src/locales/zh_CN/translation.json`, `src/locales/zh_TW/translation.json`, `src/locales/ja/translation.json`, insert an `"engine"` group as a sibling directly BEFORE the existing `"models"` group (en: line ~896; keep JSON valid — trailing comma on the new group).

en:

```json
  "engine": {
    "title": "Inference Engine",
    "detected": "Detected: {{gpu}}",
    "package": "Engine package: {{sku}} · {{size}}",
    "sizeUnknown": "size unavailable offline",
    "download": "Download engine",
    "update": "Update engine",
    "updateRequired": "Engine update required ({{from}} → {{to}})",
    "downloading": "{{done}} / {{total}} · {{pct}}%",
    "verifying": "Verifying…",
    "extracting": "Extracting…",
    "paused": "Paused · {{done}} downloaded",
    "resume": "Resume download",
    "cancel": "Cancel",
    "retry": "Retry",
    "ready": "Engine {{version}}",
    "onDisk": "{{size}} on disk",
    "remove": "Remove engine",
    "removeConfirm": "Remove the engine and free disk space?",
    "unsupported": "Local inference is not supported on this device",
    "devMode": "Development mode · local venv",
    "installHint": "Install the engine to browse and download models"
  },
```

zh_CN:

```json
  "engine": {
    "title": "推理引擎",
    "detected": "检测到:{{gpu}}",
    "package": "引擎包:{{sku}} · {{size}}",
    "sizeUnknown": "离线,无法获取体积",
    "download": "下载引擎",
    "update": "更新引擎",
    "updateRequired": "引擎需要更新({{from}} → {{to}})",
    "downloading": "{{done}} / {{total}} · {{pct}}%",
    "verifying": "校验中…",
    "extracting": "解压中…",
    "paused": "已暂停 · 已下载 {{done}}",
    "resume": "继续下载",
    "cancel": "取消",
    "retry": "重试",
    "ready": "引擎 {{version}}",
    "onDisk": "占用磁盘 {{size}}",
    "remove": "删除引擎",
    "removeConfirm": "删除引擎并释放磁盘空间?",
    "unsupported": "此设备不支持本地推理",
    "devMode": "开发模式 · 本地 venv",
    "installHint": "安装引擎后可浏览和下载模型"
  },
```

zh_TW:

```json
  "engine": {
    "title": "推理引擎",
    "detected": "偵測到:{{gpu}}",
    "package": "引擎套件:{{sku}} · {{size}}",
    "sizeUnknown": "離線,無法取得大小",
    "download": "下載引擎",
    "update": "更新引擎",
    "updateRequired": "引擎需要更新({{from}} → {{to}})",
    "downloading": "{{done}} / {{total}} · {{pct}}%",
    "verifying": "驗證中…",
    "extracting": "解壓中…",
    "paused": "已暫停 · 已下載 {{done}}",
    "resume": "繼續下載",
    "cancel": "取消",
    "retry": "重試",
    "ready": "引擎 {{version}}",
    "onDisk": "佔用磁碟 {{size}}",
    "remove": "刪除引擎",
    "removeConfirm": "刪除引擎並釋放磁碟空間?",
    "unsupported": "此裝置不支援本機推理",
    "devMode": "開發模式 · 本機 venv",
    "installHint": "安裝引擎後可瀏覽和下載模型"
  },
```

ja:

```json
  "engine": {
    "title": "推論エンジン",
    "detected": "検出: {{gpu}}",
    "package": "エンジン: {{sku}} · {{size}}",
    "sizeUnknown": "オフラインのためサイズ不明",
    "download": "エンジンをダウンロード",
    "update": "エンジンを更新",
    "updateRequired": "エンジンの更新が必要です({{from}} → {{to}})",
    "downloading": "{{done}} / {{total}} · {{pct}}%",
    "verifying": "検証中…",
    "extracting": "展開中…",
    "paused": "一時停止中 · {{done}} ダウンロード済み",
    "resume": "ダウンロードを再開",
    "cancel": "キャンセル",
    "retry": "再試行",
    "ready": "エンジン {{version}}",
    "onDisk": "ディスク使用量 {{size}}",
    "remove": "エンジンを削除",
    "removeConfirm": "エンジンを削除してディスク容量を解放しますか?",
    "unsupported": "このデバイスはローカル推論に対応していません",
    "devMode": "開発モード · ローカル venv",
    "installHint": "エンジンをインストールするとモデルを閲覧・ダウンロードできます"
  },
```

Remaining locales ride the English fallback (repo convention) until the usual batch localization pass.

- [ ] **Step 8: Verify JSON validity + run the touched suites**

Run:

```bash
node -e "for (const l of ['en','zh_CN','zh_TW','ja']) JSON.parse(require('fs').readFileSync('src/locales/'+l+'/translation.json')); console.log('LOCALES_OK')"
npx vitest run src/components/Settings/sections/EngineSection.test.tsx src/stores/nativeModelStore.test.ts
```

Expected: `LOCALES_OK` + PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/Settings/sections/EngineSection.tsx src/components/Settings/sections/EngineSection.scss src/components/Settings/sections/EngineSection.test.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/locales/en/translation.json src/locales/zh_CN/translation.json src/locales/zh_TW/translation.json src/locales/ja/translation.json
git commit -m "feat(native): Inference Engine card - download/update/resume/remove UI + model-area gate"
```

---

### Task 11: Full-suite verification

- [ ] **Step 1: Python sidecar suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS (including `test_build_sidecar_bundle.py`, `test_sidecar_bundles_workflow.py`, and the unchanged `test_torch_free_gate.py` / `test_sku_requirements.py`).

- [ ] **Step 2: JS/TS touched suites**

Run: `npx vitest run electron/ src/stores/nativeModelStore.test.ts src/stores/settingsStore.native-gate.test.ts src/components/Settings/sections/EngineSection.test.tsx`
Expected: PASS.

- [ ] **Step 3: No stale references to the removed contract**

Run: `grep -rn "SOKUJI_SIDECAR_BUNDLE_BASE_URL" electron/ src/ | grep -v "spec\|\.md"`
Expected: matches only inside `electron/sidecar-bundle.js`'s `bundleBaseUrl` (the env override), NOT in `main.js` (the old "hosting is not configured" path is gone).

- [ ] **Step 4: Commit any stragglers**

```bash
git status --short   # expect: clean (everything committed per task)
```

---

## Deferred / operator follow-ups (NOT tasks)

1. **First dry run + real sizes** — trigger `sidecar-bundles.yml` via `workflow_dispatch` (operator-gated), record the four SKU archive sizes in `docs/superpowers/notes/` (answers whether linux/win-nvidia actually split). The `build-linux` job also serves as the deferred P7 boot acceptance.
2. **First release** — bump nothing (already `0.1.0`), tag `sidecar-v0.1.0`, push (operator-gated). Verify the prerelease carries 4 archives (+ parts) + `manifest.json`, and that app auto-update still resolves the latest APP release (prerelease flag honored by electron-updater).
3. **Hardware verification lanes** — on Win/mac boxes run a packaged app with `SOKUJI_SIDECAR_VERSION=0.1.0` (+ `SOKUJI_SIDECAR_BUNDLE_BASE_URL` if testing pre-publish artifacts): download → resume mid-way (kill network) → install → sidecar boots → models list.
4. **P7 leftovers unchanged** — win/mac bundle boots, signing/notarization (macOS codesign+notarytool, Windows Authenticode), AV/SmartScreen behavior, Linux non-NVIDIA CPU-fallback decision.
5. **Locale batch pass** — fill the `engine` group into the remaining ~31 locales.
