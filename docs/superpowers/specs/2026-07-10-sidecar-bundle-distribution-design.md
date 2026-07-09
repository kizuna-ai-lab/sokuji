# Sidecar Bundle Distribution — Download, Hosting, Versioning, UI — Spec

**Date**: 2026-07-10
**Branch**: native-sidecar

## Goal

Ship the P7 self-contained sidecar bundles to end users: host them on GitHub
Releases, give the sidecar a first-class version number that the app pins
exactly, make the 2 GB-class download robust (multi-part, resume, cancel,
disk preflight), and put an explicit "Inference Engine" card in the native
provider settings that gates the whole provider until the matching bundle is
installed.

This spec closes the three items P7 deliberately left open: hosting (the
`SOKUJI_SIDECAR_BUNDLE_BASE_URL` operator decision), the renderer UI (Task 8
only added store state), and version matching (P7's manifest was
latest-per-sku with an operator-supplied `--version`).

## Context (what already exists, P7 / commit aa367368)

- `scripts/build-sidecar-bundle.py` — embedded CPython 3.12 + per-SKU wheels +
  `sokuji_sidecar` → `sidecar-<sku>-v<version>.tar.zst` + manifest fragment
  `{sku, version, sha256, size, url}`; `merge_manifests()` → latest-per-sku
  `manifest.json`.
- SKUs: `linux-nvidia`, `win-nvidia`, `win-directml`, `mac` (Apple Silicon;
  Intel mac → `detectSku` returns `null`).
- `.github/workflows/sidecar-bundles.yml` — `workflow_dispatch` only; uploads
  Actions artifacts, never publishes.
- Electron: `sidecar-sku.js` (detect), `resolveSidecarLaunch` (env → bundle →
  dev venv), `sidecar-bundle.js` (`installBundle`: fetch manifest → download →
  sha256 → streamed tar.zst extract with traversal/symlink guards → atomic
  two-rename swap into `userData/sidecar/<sku>`), IPC
  `sidecar-bundle:status|install` + `sidecar-bundle-progress` push,
  `nativeModelStore` bundle state.
- App releases publish to GitHub Releases via `softprops/action-gh-release`;
  auto-update via electron-updater (GitHub provider, reads `latest*.yml` from
  the latest release).
- Bundle sizes are **unmeasured** (P7 spike deferred: dev box at 99% disk).
  The nvidia SKU (onnxruntime-gpu[cuda,cudnn], ~4–5 GB unpacked) plausibly
  straddles GitHub's 2 GiB per-asset limit after zstd-19.

## Decisions

| # | Decision | Rationale / constraint |
|---|----------|------------------------|
| S1 | **Sidecar gets its own semver with a single canonical site: root `package.json` `"sidecarVersion"`.** `package.json` is already whitelisted by both forge and electron-builder, so the packaged app reads it directly (`sidecar/` is not packaged at all). The build script stamps this version into each bundle's `bundle.json`, which is how an installed bundle knows what it is. The CI tag job asserts the `sidecar-vX.Y.Z` tag matches `package.json`. There is no separate "pin" concept, pin file, or second version site. | One field, one bump, no sync test needed. `build-sidecar-bundle.py --version` becomes optional (defaults to reading `package.json` `sidecarVersion`; override for dev builds only). |
| S2 | **Strict version matching**: a bundle is usable only if `bundle.json.version === package.json.sidecarVersion`. Mismatch is presented as "engine update required" and the native provider stays gated until updated. `env` (`SOKUJI_SIDECAR_PYTHON`) and dev-venv launch paths are exempt — dev workflow unchanged. | No untested app×sidecar combination ever runs in production; no cross-version compatibility matrix to maintain. Cost: after an app auto-update an offline user's native provider is unavailable until the engine re-downloads. |
| S3 | **Hosting = GitHub Releases in `kizuna-ai-lab/sokuji`, dedicated tags `sidecar-vX.Y.Z`, always marked prerelease.** Assets: the per-SKU archives (or their parts) + the merged `manifest.json`. | Reuses the already-proven release CDN (app installers live there). `prerelease` keeps electron-updater away from these releases (its GitHub provider resolves "latest release" to find `latest*.yml`; a sidecar release without those files would break app auto-update). The tag string is additionally not valid semver — double safety. Prerelease assets remain publicly downloadable. |
| S4 | **Runtime manifest, per-version**: the app fetches `<baseUrl>/manifest.json` where `baseUrl` defaults to `https://github.com/kizuna-ai-lab/sokuji/releases/download/sidecar-v<version>`. No hashes or URLs are embedded in the app. Manifest entries use **relative file names** resolved against `baseUrl` (mirror-friendly). sha256 verification is for transport integrity (corruption/truncation), not anti-tamper — the whole distribution chain (app installers, auto-update) already trusts GitHub release assets; hardening only this link adds nothing. | Keeps the P7 manifest mechanism; the per-version location makes the manifest effectively immutable for a given `sidecarVersion`, preserving S2 semantics. Convention: never replace assets of a published `sidecar-vX.Y.Z` in place — fix forward with a new version. (In-place replacement remains a technically possible emergency escape hatch; it only affects new installs.) |
| S5 | **Multi-part split as a mechanical fallback**: after packing, if the archive exceeds `PART_LIMIT` (1.9 GiB), split it byte-wise into `.tar.zst.001/.002/…` and delete the whole archive. Manifest always uses a `parts` array (single-part = one entry) so the installer has one code path. Each part carries `{name, size, sha256}`; the outer entry keeps whole-archive `sha256`, `size`, and new `installedSize` (unpacked `du`, for disk preflight). | GitHub hard limit: 2 GiB per release asset. First real sizes come from a `workflow_dispatch` dry run; the split logic simply never triggers for SKUs that fit. Layered bundles (runtime/app split) are deliberately deferred (see Out of scope) — `parts` does not preclude adding `layers` later. |
| S6 | **Download staging moves to `userData/sidecar/.staging/`** (files keep their manifest names, which embed sku+version). | `os.tmpdir()` is wrong twice: on Linux `/tmp` is commonly tmpfs (a 2 GB download eats RAM) and it does not survive reboot (kills resume). Version-in-filename means stale parts from an older version simply never match and get cleaned up. |
| S7 | **Resume + cancel**: the install pipeline is idempotent per part — existing staging file with matching size+sha256 → skip; smaller → HTTP `Range: bytes=<have>-` append; hash mismatch → delete and re-download. Cancel = new IPC `sidecar-bundle:cancel` aborts the in-flight fetch (AbortController) and **keeps** staging files; "resume" is just calling install again. GitHub Releases supports Range requests. | For 2 GB on consumer networks, restart-from-zero is a real UX failure. Resume is not a separate code path — it falls out of the idempotent pipeline. |
| S8 | **Disk preflight**: before downloading, require free space at the `userData` volume ≥ `size + installedSize + 512 MiB` margin (archive and unpacked tree coexist briefly). Fail early with exact numbers in the error. | A user must not discover disk exhaustion at 90 % of a 2 GB download. |
| S9 | **Progress gains phases**: `sidecar-bundle-progress` payload adds `phase: 'download' | 'verify' | 'extract'`. Update installs stop the running sidecar before the atomic swap. | sha256 over 2 GB and extraction each take ~10 s+; without a phase indicator the UI looks frozen. On Windows a running `python.exe` would make the rename-swap fail — stop first. |
| S10 | **UI = an explicit "Inference Engine" card** (`EngineSection`) at the top of the native provider settings, above the model management area, mirroring the model-download UX: explicit click to download, never automatic. The card is the single surface for all engine states (see state machine). The model area shows a placeholder and the provider validation gate stays closed until the engine is `ready`. | The model catalog is served by the running sidecar over WS — without the engine there is nothing to render below; the engine is structurally a gate, not a list item. A surprise 2 GB download must be impossible. |
| S11 | **Environment lanes need no separate staging repo/infra.** The version-bump commit is the promotion gate: a published `sidecar-vX.Y.Z` release that no app build references yet *is* the staging channel, and hardware verification downloads the exact production bytes (real URLs, real CDN, real parts). Two env overrides cover every non-production scenario: `SOKUJI_SIDECAR_BUNDLE_BASE_URL` (where: localhost dir, mirror, unpinned release) and `SOKUJI_SIDECAR_VERSION` (which: overrides `sidecarVersion` so a packaged old app can exercise a not-yet-adopted engine). | Rebuild-based promotion (rc → final) was rejected: the build fetches the *latest* python-build-standalone release and pip resolves transitive deps at build time, so two builds days apart are not byte-identical. Verifying the published asset itself is strictly higher fidelity. A separate repo would need a cross-repo PAT and a second permission surface for no isolation gain. |

## Version lifecycle

```
1. Sidecar work merges to native-sidecar/main as usual (version unchanged).
2. Release: one commit bumps the single version site
     package.json                        "sidecarVersion": "0.2.0"
   → git tag sidecar-v0.2.0 → push (operator-gated).
3. CI (sidecar-bundles.yml, new tag trigger):
     - asserts tag == package.json sidecarVersion
     - 4-SKU matrix build (--archive; version read from source)
     - release job: collect artifacts, merge_manifests → manifest.json,
       softprops/action-gh-release → PRERELEASE sidecar-v0.2.0
4. Hardware verification (Win/mac boxes): run any app build with
     SOKUJI_SIDECAR_VERSION=0.2.0
   (+ base-URL override if testing from a non-default location);
   verified bytes == shipped bytes.
   If broken: fix forward, release 0.2.1; 0.2.0 is never referenced.
5. App releases whenever, carrying whatever sidecarVersion is in the tree.
   Users see "engine update required" only when that value actually changed.
```

Ordering note: once the bump lands on main, subsequent app releases require
the new engine. App releases are already deliberate (operator tags them), so
no extra process is added; verify before cutting an app release. For extra
caution the bump+tag can live on a branch until verified.

## Manifest schema (per-version, attached to the release)

```json
{
  "version": "0.2.0",
  "bundles": [
    {
      "sku": "linux-nvidia",
      "version": "0.2.0",
      "sha256": "<whole archive>",
      "size": 2181667225,
      "installedSize": 4900000000,
      "parts": [
        { "name": "sidecar-linux-nvidia-v0.2.0.tar.zst.001", "size": 2040109465, "sha256": "…" },
        { "name": "sidecar-linux-nvidia-v0.2.0.tar.zst.002", "size": 141557760,  "sha256": "…" }
      ]
    },
    {
      "sku": "win-directml",
      "version": "0.2.0",
      "sha256": "…",
      "size": 410000000,
      "installedSize": 900000000,
      "parts": [ { "name": "sidecar-win-directml-v0.2.0.tar.zst", "size": 410000000, "sha256": "…" } ]
    }
  ]
}
```

Changes vs P7 fragments: `url` (absolute) → `parts[].name` (relative to
`baseUrl`); new `installedSize`; `merge_manifests` stays (it now merges the
four same-version fragments rather than latest-per-sku).

## Install pipeline (main process)

```
resolve baseUrl (env override || derived from sidecarVersion)
fetch ${baseUrl}/manifest.json → entry = pickBundle(manifest, sku)
disk preflight (S8) → fail early with numbers
for each part (sequential):
  staging file exists?
    size == part.size && sha256 ok → skip
    size <  part.size             → Range-resume append
    sha mismatch                  → delete, full re-download
  verify part.sha256
concatenate parts → whole-archive sha256 (phase: verify)
stop running sidecar (if any)
extract to <install>.tmp (phase: extract) → two-rename atomic swap
write bundle.json {sku, version} → clean staging
```

Cancel (`sidecar-bundle:cancel`) aborts the fetch, keeps staging, store enters
`paused`. Re-invoking install resumes naturally. After reboot/crash,
`refreshBundle` reports staged bytes so the UI can present `paused` instead of
`absent`.

## Engine card state machine (`EngineSection`, renderer)

```
checking ──→ unsupported     sku=null (Intel mac, …): explanatory text, terminal
    ├──→ absent              "⚡ Detected: NVIDIA RTX 4070" (gpuName via status IPC)
    │                        "Engine: linux-nvidia · 1.9 GB" (size from manifest,
    │                        fetched best-effort; placeholder when offline)
    │                        [Download engine]
    ├──→ mismatch            "⚠ Engine update required (0.1.0 → 0.2.0)"
    │                        [Update engine · 1.9 GB]
    ├──→ paused              "Paused · 812 MB downloaded"  [Resume]
    ↓ (download/update click)
 installing                  progress bar · 812 MB / 1.9 GB · 42 % · [Cancel]
    │      phase=verify      "Verifying…"   (indeterminate)
    │      phase=extract     "Extracting…"  (indeterminate)
    ├──→ error               exact message (disk / network / checksum) · [Retry]
    ↓
 ready                       "✓ Engine 0.2.0 · linux-nvidia · 4.9 GB on disk"
                             [Remove engine] (confirm; frees disk, → absent)
```

Interlocks: non-`ready` → model area placeholder, provider validation gate
closed, sidecar not auto-started. Dev mode (venv/env launch source) shows a
quiet "Development mode · local venv" note instead of the card states.
`bundleStatus` in `nativeModelStore` grows `mismatch`/`paused` states plus
`installedVersion`/`requiredVersion`/`phase` fields; `sidecar-bundle:status`
returns `{sku, gpuName, installed, installedVersion, requiredVersion, stagedBytes}`.

i18n: keys land in en/zh/ja first; remaining locales ride the English
fallback until the usual batch pass.

## Environment lanes

| Lane | Trigger | Artifacts land | Purpose |
|------|---------|----------------|---------|
| Local dev | `build-sidecar-bundle.py --version 0-dev` + `python -m http.server` + both env overrides | local dir | installer/UI iteration, zero GitHub |
| CI dry run | `workflow_dispatch` | Actions artifacts (auto-expire, invisible to users) | real size measurement, build smoke |
| Production candidate | tag `sidecar-vX.Y.Z` | prerelease (unreferenced = staging) | hardware verification → version-bump commit = go-live |

| Env var | Meaning |
|---------|---------|
| `SOKUJI_SIDECAR_BUNDLE_BASE_URL` | Override manifest/asset base URL (mirror, localhost, unpinned release) |
| `SOKUJI_SIDECAR_VERSION` | Override `package.json` `sidecarVersion` (test an unadopted engine) |
| `SOKUJI_SIDECAR_PYTHON` | (existing) bypass bundles entirely, dev only |

## Testing

- **pytest**: split logic (> limit → parts, ≤ limit → single part; byte-identical
  reassembly; per-part sha256/size), manifest fields (`parts`, `installedSize`,
  relative names), default version resolution (build script reads
  `package.json` `sidecarVersion`), workflow YAML (tag trigger + release job
  present).
- **vitest (electron)**: resume decision table (complete part skipped / partial
  part gets Range header / corrupt part deleted), cancel keeps staging,
  status three-state (absent/ready/mismatch) from bundle.json vs
  sidecarVersion, `resolveSidecarLaunch` rejects version mismatch while
  env/venv paths stay exempt, disk preflight arithmetic, stop-before-swap.
- **vitest (renderer)**: store state machine incl. `paused` recovery and
  `phase` passthrough; `EngineSection` renders every state; provider gate
  interlock.
- **CI**: first `workflow_dispatch` dry run records real 4-SKU sizes in a
  notes doc (answers whether nvidia actually needs splitting).
- **Deferred hardware** (unchanged from P7): win/mac real-machine boots,
  signing/notarization (operator follow-up), AV/SmartScreen behavior.

## Out of scope (deliberate)

- Layered bundles (runtime/app split for KB-sized code-only updates) — future
  bandwidth optimization; `parts` schema does not block it.
- Manual SKU override in UI (e.g. forcing DirectML on an NVIDIA box) —
  `SOKUJI_SIDECAR_PYTHON` covers developer needs.
- Background/silent auto-update of the engine, download throttling/scheduling,
  mirror auto-failover, beta channels.
- Signing/notarization of bundles (existing operator follow-up from P7).
- Linux non-NVIDIA CPU SKU (P7/D10 open item — unchanged: nvidia bundle's CPU
  fallback).
