# SignPath Windows Code Signing Design

**Issue**: [#105 — Add Windows code signing for SmartScreen trust](https://github.com/kizuna-ai-lab/sokuji/issues/105)
**Date**: 2026-03-13
**Status**: Approved

## Problem

Windows SmartScreen blocks unsigned executables with "Unknown Publisher" warnings. The current CI pipeline (`build.yml`) produces unsigned Windows installers via Electron Forge's `maker-squirrel`.

## Decision

Use [SignPath](https://signpath.io) (approved OSS plan) for Windows code signing. SignPath provides EV-level Authenticode signing through their HSM infrastructure, integrated as a post-build step in GitHub Actions.

**Scope**: Windows code signing only (Setup.exe installer). No macOS signing, no Microsoft Store distribution.

## Architecture

### Signing Flow

```
Build job (existing, windows-latest)
  → electron-forge make → unsigned SokujiSetup.exe
  → upload-artifact (windows-unsigned) — Setup.exe only
        ↓
Sign job (new, ubuntu-latest) — tag pushes only
  → submit-signing-request to SignPath
  → SignPath Authenticode-signs Setup.exe
  → download signed Setup.exe
  → upload-artifact (windows-signed)
        ↓
Release job (existing, modified)
  → download windows-signed (instead of windows-artifacts)
  → attach to GitHub Release
```

Key architectural decisions:
- **Sign only Setup.exe** — Squirrel's Setup.exe embeds the full `.nupkg` inside itself. SmartScreen checks the signature of the executable the user runs. Signing Setup.exe is sufficient and is the established pattern used by other Electron + SignPath OSS projects (TurboWarp, VSCodium, Spicetify). No deep signing of nupkg internals needed.
- Signing happens **externally** via SignPath API, not inside `electron-forge make`
- No changes to `forge.config.js` — signing is a CI-only concern
- `<zip-file>` must be root element because GitHub's `upload-artifact` wraps everything in ZIP
- All jobs must run on **GitHub-hosted runners** (OSS requirement)
- Sign job runs **only on tag pushes** — avoids secret unavailability on fork PRs and unnecessary SignPath API calls on every push

### Why not deep-sign the nupkg?

Research into existing Electron + SignPath integrations shows:
- **TurboWarp**: Signs only `TurboWarp-Setup*x64.exe`
- **VSCodium**: Signs only `*.exe` and `*.msi`
- **Spicetify**: Signs only `spicetify.exe`

None of these projects deep-sign nupkg internals. Setup.exe contains the Squirrel bootstrapper with the nupkg embedded — the OS only checks the outer executable's signature. Deep signing would add complexity and potential failure points for no user-facing benefit.

### Phased Rollout

- **Phase 1 (immediate)**: Implement CI pipeline with `test-signing` policy. Validate end-to-end by pushing a test tag (e.g., `v0.0.0-signing-test`).
- **Phase 2 (after SignPath approval)**: Switch to `release-signing` (EV cert) for real release tags. This is a config-only change — update the `signing-policy-slug` value in the workflow.

### Rollback

If signing breaks a release, the sign job can be bypassed by:
1. Removing `sign-windows` from the release job's `needs` array
2. Changing the release job to download `windows-unsigned` instead of `windows-signed`

This restores the pre-signing behavior (unsigned releases).

## Artifact Configuration

**File**: `.signpath/artifact-configurations/default.xml`

Electron Forge Squirrel output:
```
out/make/squirrel.windows/x64/
  ├── SokujiSetup.exe           # Squirrel installer (embeds nupkg inside)
  ├── Sokuji-x.y.z-full.nupkg   # NuGet update package (not uploaded for signing)
  └── RELEASES                   # Squirrel update manifest (not uploaded for signing)
```

Only `SokujiSetup.exe` is uploaded for signing. The artifact configuration:

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <!-- Sign the Squirrel installer exe (contains embedded nupkg) -->
    <pe-file path="*Setup*.exe">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

## Signing Policies

### Policy selection

The signing policy slug is configured as a GitHub repository variable (`SIGNPATH_SIGNING_POLICY_SLUG`), not hardcoded in the workflow. To switch policies, change the variable value — no workflow file changes needed.

- **Phase 1**: Set `SIGNPATH_SIGNING_POLICY_SLUG` = `test-signing`
- **Phase 2**: Set `SIGNPATH_SIGNING_POLICY_SLUG` = `release-signing`

Policy details:
- **`test-signing`**: Self-signed cert. Validates pipeline correctness. Available now.
- **`release-signing`**: EV cert from SignPath Foundation. Solves SmartScreen. Available after SignPath configures it.

### Policy enforcement

SignPath policies are configured **in the SignPath dashboard**, not via repository files. The policy settings to configure:

| Setting | `test-signing` | `release-signing` |
|---------|---------------|-------------------|
| Certificate | Self-signed (auto-assigned) | EV cert (assigned by SignPath) |
| Submitters | CI user | CI user |
| Approval required | No | Yes — required by SignPath Foundation for OSS production certificates |
| Trusted build system | GitHub.com | GitHub.com |
| Origin verification | Off | On — restrict to `main` branch + `v*` tags |
| GitHub-hosted runners | Required (OSS) | Required (OSS) |
| Disallow reruns | Off | On |

## Workflow Changes

### Modified: `.github/workflows/build.yml`

#### Build job changes

Replace the existing `Upload Windows artifacts` step with two separate uploads:

```yaml
# Replace the existing "Upload Windows artifacts" step with these two:
- name: Upload unsigned Windows installer for signing
  if: startsWith(github.ref, 'refs/tags/v') && matrix.os == 'windows-latest'
  uses: actions/upload-artifact@v4
  with:
    name: windows-unsigned
    path: out/make/squirrel.windows/x64/*Setup*.exe

- name: Upload Windows nupkg for release
  if: startsWith(github.ref, 'refs/tags/v') && matrix.os == 'windows-latest'
  uses: actions/upload-artifact@v4
  with:
    name: windows-nupkg
    path: out/make/squirrel.windows/x64/*.nupkg
```

The Setup.exe goes through signing. The nupkg is passed directly to the release job (needed for Squirrel auto-updates). The RELEASES file is not uploaded — it was never included in GitHub Releases.

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
        overwrite: true

    - name: Submit signing request
      id: sign
      uses: signpath/github-action-submit-signing-request@v2
      with:
        api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
        organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}
        project-slug: ${{ vars.SIGNPATH_PROJECT_SLUG }}
        signing-policy-slug: ${{ vars.SIGNPATH_SIGNING_POLICY_SLUG }}
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

    - name: Download signed Windows installer
      uses: actions/download-artifact@v4
      with:
        name: windows-signed
        path: windows-signed

    - name: Download Windows nupkg
      uses: actions/download-artifact@v4
      with:
        name: windows-nupkg
        path: windows-nupkg

    # Update "Collect release assets" to use new paths:
    #   find windows-signed -name "*.exe" -exec cp {} release-assets/ \;
    #   find windows-nupkg -name "*.nupkg" -exec cp {} release-assets/ \;
```

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `.signpath/artifact-configurations/default.xml` | Create | Artifact config for Authenticode signing of Setup.exe |
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
   - Alternatively: upload a sample unsigned Setup.exe ZIP for SignPath to analyze

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

2. **Add variables** (Settings → Secrets and variables → Actions → Variables tab):

   | Variable | Value | Notes |
   |----------|-------|-------|
   | `SIGNPATH_ORGANIZATION_ID` | *(from SignPath dashboard → Organization settings)* | Organization identifier |
   | `SIGNPATH_PROJECT_SLUG` | `sokuji` | Project slug in SignPath |
   | `SIGNPATH_SIGNING_POLICY_SLUG` | `test-signing` | Change to `release-signing` for Phase 2 |

### Test Certificate (Phase 1 validation)

The `.cer` file from SignPath's test-signing certificate can be installed on a Windows test machine:
1. Double-click the `.cer` file
2. Install to "Trusted Root Certification Authorities" store
3. Run the test-signed installer — it should not show SmartScreen warning on that machine
4. This confirms signing is working correctly before EV cert is available

## Testing Plan

1. **Pipeline validation**: Push a test tag (e.g., `v0.0.0-signing-test`), confirm sign job runs and completes with `test-signing`
2. **Artifact inspection**: Download signed artifacts, verify Authenticode signatures:
   - PowerShell: `Get-AuthenticodeSignature .\SokujiSetup.exe`
   - Or: `signtool verify /pa SokujiSetup.exe`
3. **Clean install test**: Run signed installer on a Windows test machine (with test cert installed)
4. **Full release test**: Create a test tag, verify the complete build → sign → release flow

## Phase 2 Checklist (when release-signing becomes available)

- [ ] SignPath assigns EV certificate to `release-signing` policy
- [ ] Configure origin verification on `release-signing` policy (main branch + v* tags)
- [ ] Update GitHub variable: change `SIGNPATH_SIGNING_POLICY_SLUG` from `test-signing` to `release-signing`
- [ ] Push a test release tag to validate EV signing end-to-end
- [ ] Verify SmartScreen does NOT warn on a clean Windows machine (no test cert installed)
- [ ] Update issue #105 as complete
