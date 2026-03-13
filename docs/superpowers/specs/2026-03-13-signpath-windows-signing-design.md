# SignPath Windows Code Signing Design

**Issue**: [#105 — Add Windows code signing for SmartScreen trust](https://github.com/kizuna-ai-lab/sokuji/issues/105)
**Date**: 2026-03-13
**Status**: Approved

## Problem

Windows SmartScreen blocks unsigned executables with "Unknown Publisher" warnings. The current CI pipeline (`build.yml`) produces unsigned Windows installers via Electron Forge's `maker-squirrel`.

## Decision

Use [SignPath](https://signpath.io) (approved OSS plan) for Windows code signing. SignPath provides EV-level Authenticode signing through their HSM infrastructure, integrated as a post-build step in GitHub Actions.

**Scope**: Windows code signing only (`.exe` installer + `.nupkg` app package). No macOS signing, no Microsoft Store distribution.

## Architecture

### Signing Flow

```
Build job (existing, windows-latest)
  → electron-forge make → unsigned SokujiSetup.exe + .nupkg
  → upload-artifact (windows-unsigned)
        ↓
Sign job (new, ubuntu-latest) — tag pushes only
  → submit-signing-request to SignPath
  → SignPath deep-signs: PE files inside .nupkg → nuget-sign .nupkg → authenticode-sign Setup.exe
  → download signed artifacts
  → upload-artifact (windows-signed)
        ↓
Release job (existing, modified)
  → download windows-signed (instead of windows-artifacts)
  → attach to GitHub Release
```

Key architectural decisions:
- Signing happens **externally** via SignPath API, not inside `electron-forge make`
- No changes to `forge.config.js` — signing is a CI-only concern
- `<zip-file>` must be root element because GitHub's `upload-artifact` wraps everything in ZIP
- All jobs must run on **GitHub-hosted runners** (OSS requirement)
- Sign job runs **only on tag pushes** — avoids secret unavailability on fork PRs and unnecessary SignPath API calls on every push

### Phased Rollout

- **Phase 1 (immediate)**: Implement CI pipeline with `test-signing` policy. Validate end-to-end by pushing a test tag (e.g., `v0.0.0-signing-test`).
- **Phase 2 (after SignPath approval)**: Switch to `release-signing` (EV cert) for real release tags. This is a config-only change — update the `signing-policy-slug` value in the workflow.

### Rollback

If signing breaks a release, the sign job can be bypassed by:
1. Removing `sign-windows` from the release job's `needs` array
2. Changing the release job to download `windows-unsigned` instead of `windows-signed`

This restores the pre-signing behavior (unsigned releases).

## Pre-Implementation: Verify Nupkg Structure

**This step is mandatory before creating the artifact configuration.**

Squirrel.Windows uses the NuGet package format but may not follow the standard `lib/net*` layout. The exact internal path must be verified:

```bash
# Build locally on Windows (or from CI artifacts)
npx electron-forge make --platform win32

# Inspect the nupkg (it's a ZIP file)
unzip -l out/make/squirrel.windows/x64/*.nupkg
```

Common Squirrel layouts:
- `lib/net45/` — most common, Squirrel's historical convention
- `lib/` — flat layout in some versions

The artifact configuration XML below assumes `lib/net45/`. **Adjust paths based on actual inspection results.**

## Artifact Configuration

**File**: `.signpath/artifact-configurations/default.xml`

Electron Forge Squirrel output structure:
```
out/make/squirrel.windows/x64/
  ├── SokujiSetup.exe           # Squirrel installer
  ├── Sokuji-x.y.z-full.nupkg   # NuGet update package (contains app .exe + .dll)
  └── RELEASES                   # Squirrel update manifest (plain text, no signing needed)
```

SignPath artifact configuration (deep signing):
```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <!-- Deep sign: sign PE files inside nupkg, then sign the nupkg itself -->
    <nupkg-file path="*.nupkg" max-matches="unbounded">
      <!-- VERIFY THIS PATH: run `unzip -l *.nupkg` and adjust if needed -->
      <directory path="lib">
        <directory path="net*" max-matches="unbounded">
          <pe-file-set>
            <include path="*.exe" max-matches="unbounded" />
            <include path="*.dll" min-matches="0" max-matches="unbounded" />
            <for-each>
              <authenticode-sign />
            </for-each>
          </pe-file-set>
        </directory>
      </directory>
      <nuget-sign />
    </nupkg-file>
    <!-- Sign the Squirrel installer exe -->
    <pe-file path="*Setup*.exe">
      <authenticode-sign />
    </pe-file>
    <!-- RELEASES file: plain text, no signing needed. -->
    <!-- If SignPath rejects unmatched files, add: <file path="RELEASES" /> -->
  </zip-file>
</artifact-configuration>
```

## Signing Policies

### Policy selection

During Phase 1, use `test-signing` only. During Phase 2, switch to `release-signing` for tag pushes:

```yaml
# Phase 1 (immediate)
signing-policy-slug: test-signing

# Phase 2 (after EV cert is available)
signing-policy-slug: release-signing
```

- **`test-signing`**: Self-signed cert. Validates pipeline correctness. Available now.
- **`release-signing`**: EV cert from SignPath Foundation. Solves SmartScreen. Available after SignPath configures it.

### Policy enforcement

SignPath policies are configured **in the SignPath dashboard**, not via repository files. The policy settings to configure:

| Setting | `test-signing` | `release-signing` |
|---------|---------------|-------------------|
| Certificate | Self-signed (auto-assigned) | EV cert (assigned by SignPath) |
| Submitters | CI user | CI user |
| Approval required | No | No (or optional manual approval) |
| Trusted build system | GitHub.com | GitHub.com |
| Origin verification | Off | On — restrict to `main` branch + `v*` tags |
| GitHub-hosted runners | Required (OSS) | Required (OSS) |
| Disallow reruns | Off | On |

## Workflow Changes

### Modified: `.github/workflows/build.yml`

#### Build job changes

Add upload of unsigned Windows artifacts (runs on all tag pushes, alongside existing artifact uploads):

```yaml
# After existing "Build Electron app with Forge" step (windows-latest)
# Replace the existing "Upload Windows artifacts" step with this:
- name: Upload unsigned Windows artifacts for signing
  if: startsWith(github.ref, 'refs/tags/v') && matrix.os == 'windows-latest'
  uses: actions/upload-artifact@v4
  with:
    name: windows-unsigned
    path: out/make/squirrel.windows/x64/
```

This **replaces** the existing `Upload Windows artifacts` step (which uploaded to `windows-artifacts`). The unsigned artifacts are now named `windows-unsigned`, and the release job will consume `windows-signed` after the sign job processes them.

#### New sign job

```yaml
sign-windows:
  name: Sign Windows artifacts
  if: startsWith(github.ref, 'refs/tags/v')
  needs: build
  runs-on: ubuntu-latest
  permissions:
    contents: read
    id-token: write
    actions: read
  steps:
    - name: Checkout
      uses: actions/checkout@v4

    - name: Download unsigned artifacts
      uses: actions/download-artifact@v4
      with:
        name: windows-unsigned
        path: unsigned/

    # SignPath requires a github-artifact-id from upload-artifact.
    # We must re-upload because the original upload happened in a different job
    # and artifact IDs cannot be passed across jobs without explicit output wiring.
    - name: Upload for SignPath
      id: upload-for-signing
      uses: actions/upload-artifact@v4
      with:
        name: windows-to-sign
        path: unsigned/

    - name: Submit signing request
      id: sign
      uses: signpath/github-action-submit-signing-request@v1
      with:
        api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
        organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}
        project-slug: sokuji
        signing-policy-slug: test-signing
        artifact-configuration-slug: default
        github-artifact-id: ${{ steps.upload-for-signing.outputs.artifact-id }}
        wait-for-completion: true
        output-artifact-directory: signed/
        wait-for-completion-timeout-in-seconds: 1200

    - name: Upload signed artifacts
      uses: actions/upload-artifact@v4
      with:
        name: windows-signed
        path: signed/
```

#### Release job changes

Update `needs` and download signed artifacts:

```yaml
release:
  if: startsWith(github.ref, 'refs/tags/v')
  needs: [build, sign-windows]
  runs-on: ubuntu-latest
  steps:
    # ... existing download steps for linux, macos ...

    - name: Download Windows artifacts
      uses: actions/download-artifact@v4
      with:
        name: windows-signed
        path: windows-artifacts

    # Rest of release job unchanged — it already collects *.exe from windows-artifacts/
```

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `.signpath/artifact-configurations/default.xml` | Create | Artifact config for deep signing |
| `.github/workflows/build.yml` | Modify | Add sign job, replace Windows artifact upload, update release job |

## Manual Setup Required

These steps must be completed in external systems before the CI pipeline will work.

### SignPath Dashboard (https://app.signpath.io)

1. **Create project**
   - Project slug: `sokuji`
   - Repository URL: `https://github.com/kizuna-ai-lab/sokuji`

2. **Link trusted build system**
   - Select the predefined "GitHub.com" trusted build system
   - Link it to the `sokuji` project

3. **Create artifact configuration**
   - Name/slug: `default`
   - Paste the XML from the "Artifact Configuration" section above
   - Alternatively: upload a sample unsigned ZIP for SignPath to analyze, then adjust
   - **Important**: Verify the nupkg internal paths first (see "Pre-Implementation" section)

4. **Verify signing policies**
   - `test-signing`: Should already exist with self-signed certificate
   - `release-signing`: Will be available after SignPath configures it — see Phase 2 checklist

5. **Set origin verification** (on `release-signing` policy, when available)
   - Repository URL: `https://github.com/kizuna-ai-lab/sokuji`
   - Allowed branches: `main` and tags matching `v*`

### GitHub Repository Settings

1. **Add secret**: `SIGNPATH_API_TOKEN`
   - Generate in SignPath dashboard: User menu → API Tokens
   - Token must have **submitter** role on the `sokuji` project

2. **Add variable**: `SIGNPATH_ORGANIZATION_ID`
   - Found in SignPath dashboard: Organization settings → Organization ID

### Test Certificate (Phase 1 validation)

The `.cer` file from SignPath's test-signing certificate can be installed on a Windows test machine:
1. Double-click the `.cer` file
2. Install to "Trusted Root Certification Authorities" store
3. Run the test-signed installer — it should not show SmartScreen warning on that machine
4. This confirms signing is working correctly before EV cert is available

## Testing Plan

1. **Nupkg structure verification**: Build locally, inspect `.nupkg` contents, adjust artifact config XML if needed
2. **Pipeline validation**: Push a test tag (e.g., `v0.0.0-signing-test`), confirm sign job runs and completes with `test-signing`
3. **Artifact inspection**: Download signed artifacts, verify Authenticode signatures:
   - PowerShell: `Get-AuthenticodeSignature .\SokujiSetup.exe`
   - Or: `signtool verify /pa SokujiSetup.exe`
4. **Nupkg deep signing**: Extract signed `.nupkg`, verify inner `.exe` and `.dll` files are also signed
5. **Clean install test**: Run signed installer on a Windows test machine (with test cert installed)
6. **Full release test**: Create a test tag, verify the complete build → sign → release flow

## Phase 2 Checklist (when release-signing becomes available)

- [ ] SignPath assigns EV certificate to `release-signing` policy
- [ ] Configure origin verification on `release-signing` policy (main branch + v* tags)
- [ ] Update workflow: change `signing-policy-slug` from `test-signing` to `release-signing`
- [ ] Push a test release tag to validate EV signing end-to-end
- [ ] Verify SmartScreen does NOT warn on a clean Windows machine (no test cert installed)
- [ ] Update issue #105 as complete
