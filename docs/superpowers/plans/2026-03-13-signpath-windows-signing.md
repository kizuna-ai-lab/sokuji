# SignPath Windows Code Signing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Windows code signing via SignPath to the GitHub Actions CI pipeline so that Setup.exe is Authenticode-signed before release.

**Architecture:** SignPath signs artifacts externally via API. A new `sign-windows` job sits between the existing `build` and `release` jobs. Only `Setup.exe` is signed — Squirrel embeds the nupkg inside it, and SmartScreen only checks the outer executable.

**Tech Stack:** GitHub Actions, SignPath OSS (submit-signing-request@v2), Electron Forge maker-squirrel

**Spec:** `docs/superpowers/specs/2026-03-13-signpath-windows-signing-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `.signpath/artifact-configurations/default.xml` | Create | Tells SignPath what to sign inside the uploaded ZIP |
| `.github/workflows/build.yml` | Modify | Add sign job, split Windows artifact uploads, update release job |

No other files are created or modified. `forge.config.js` is unchanged.

---

## Chunk 1: Implementation

### Task 1: Create SignPath artifact configuration

**Files:**
- Create: `.signpath/artifact-configurations/default.xml`

- [ ] **Step 1: Create the artifact configuration file**

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

This tells SignPath: "The uploaded artifact is a ZIP containing a PE file matching `*Setup*.exe`. Sign it with Authenticode."

The `<zip-file>` root is required because GitHub's `upload-artifact` wraps files in a ZIP.

- [ ] **Step 2: Verify the file is valid XML**

Run: `xmllint --noout .signpath/artifact-configurations/default.xml`
Expected: No output (valid XML)

If `xmllint` is not available, visual inspection is sufficient — the file is 8 lines.

- [ ] **Step 3: Commit**

```bash
git add .signpath/artifact-configurations/default.xml
git commit -m "ci: add SignPath artifact configuration for Windows signing"
```

---

### Task 2: Modify build job — split Windows artifact uploads

**Files:**
- Modify: `.github/workflows/build.yml:167-172`

**Context:** The current build job has a single Windows upload step (lines 167-172):

```yaml
      - name: Upload Windows artifacts
        if: startsWith(github.ref, 'refs/tags/v') && matrix.os == 'windows-latest'
        uses: actions/upload-artifact@v4
        with:
          name: windows-artifacts
          path: out/make/
```

This uploads the entire `out/make/` directory as `windows-artifacts`. We need to split this into two artifacts:
1. `windows-unsigned` — only `*Setup*.exe` (sent to SignPath for signing)
2. `windows-nupkg` — only `*.nupkg` (passed directly to release job for Squirrel auto-updates)

The old `windows-artifacts` artifact name is removed entirely.

- [ ] **Step 1: Replace the existing Windows upload step**

Replace lines 167-172 of `.github/workflows/build.yml`:

```yaml
      - name: Upload Windows artifacts
        if: startsWith(github.ref, 'refs/tags/v') && matrix.os == 'windows-latest'
        uses: actions/upload-artifact@v4
        with:
          name: windows-artifacts
          path: out/make/
```

With these two steps:

```yaml
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

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: split Windows artifact upload into unsigned exe + nupkg"
```

---

### Task 3: Add sign-windows job

**Files:**
- Modify: `.github/workflows/build.yml` (insert new job between `build` and `release`)

**Context:** Insert the `sign-windows` job after the `build` job definition (after line 179) and before the `release` job (line 181). The job:
1. Downloads the unsigned Setup.exe
2. Re-uploads it so SignPath gets a fresh artifact ID from this job's context
3. Submits the signing request to SignPath
4. Waits for completion and uploads the signed result

- [ ] **Step 1: Add the sign-windows job**

Insert this job between the `build` job's closing and the `release` job:

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

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add sign-windows job for SignPath code signing"
```

---

### Task 4: Modify release job to use signed artifacts

**Files:**
- Modify: `.github/workflows/build.yml` (release job, lines 181-255)

**Context:** The release job needs three changes:
1. Add `sign-windows` to `needs` array
2. Replace `windows-artifacts` download with `windows-signed` + `windows-nupkg` downloads
3. Update "Collect release assets" to find exe in `windows-signed/` and nupkg in `windows-nupkg/`

- [ ] **Step 1: Update release job `needs`**

Change line 184:
```yaml
    needs: build
```
To:
```yaml
    needs: [build, sign-windows]
```

- [ ] **Step 2: Replace Windows artifact download**

Replace lines 200-204:
```yaml
      - name: Download Windows artifacts
        uses: actions/download-artifact@v4
        with:
          name: windows-artifacts
          path: windows-artifacts
```

With:
```yaml
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
```

- [ ] **Step 3: Update Debug artifacts step**

In the "Debug artifacts structure" step, replace:
```bash
          echo "=== Windows ==="
          find windows-artifacts -type f || true
```
With:
```bash
          echo "=== Windows (signed) ==="
          find windows-signed -type f || true
          echo "=== Windows (nupkg) ==="
          find windows-nupkg -type f || true
```

- [ ] **Step 4: Update Collect release assets step**

In the "Collect release assets" step, replace:
```bash
          find windows-artifacts -name "*.exe" -exec cp {} release-assets/ \;
          find windows-artifacts -name "*.nupkg" -exec cp {} release-assets/ \;
```
With:
```bash
          find windows-signed -name "*.exe" -exec cp {} release-assets/ \;
          find windows-nupkg -name "*.nupkg" -exec cp {} release-assets/ \;
```

- [ ] **Step 5: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml'))"`
Expected: No error output (valid YAML)

Alternatively: `npx yaml-lint .github/workflows/build.yml` or `actionlint .github/workflows/build.yml`

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: update release job to use signed Windows artifacts"
```

---

### Task 5: Final review and squash commit

- [ ] **Step 1: Review the full diff**

Run: `git diff main -- .github/workflows/build.yml .signpath/`

Verify:
- `.signpath/artifact-configurations/default.xml` exists with correct XML
- Build job has two Windows upload steps (`windows-unsigned` + `windows-nupkg`)
- `sign-windows` job exists between `build` and `release`
- Release job `needs: [build, sign-windows]`
- Release job downloads `windows-signed` and `windows-nupkg`
- Release job collects exe from `windows-signed/` and nupkg from `windows-nupkg/`
- No references to old `windows-artifacts` remain

- [ ] **Step 2: Verify no remaining references to `windows-artifacts`**

Run: `grep -n "windows-artifacts" .github/workflows/build.yml`
Expected: No output (no matches)

---

## Chunk 2: Manual Setup & Validation

These steps require human action in external systems. They cannot be automated.

### Task 6: SignPath Dashboard Setup (manual — done by project owner)

- [ ] **Step 1: Create project in SignPath**
  - Go to https://app.signpath.io
  - Create new project with slug: `sokuji`
  - Repository URL: `https://github.com/kizuna-ai-lab/sokuji`

- [ ] **Step 2: Link trusted build system**
  - In project settings, link the predefined "GitHub.com" trusted build system

- [ ] **Step 3: Create artifact configuration**
  - Name/slug: `default`
  - Paste the contents of `.signpath/artifact-configurations/default.xml`

- [ ] **Step 4: Verify test-signing policy exists**
  - Confirm `test-signing` policy with self-signed certificate is available

### Task 7: GitHub Repository Setup (manual — done by project owner)

- [ ] **Step 1: Add SignPath API token as repository secret**
  - Go to: Settings → Secrets and variables → Actions → Secrets tab
  - Name: `SIGNPATH_API_TOKEN`
  - Value: Generate from SignPath dashboard → User menu → API Tokens
  - The token must have **submitter** role on the `sokuji` project

- [ ] **Step 2: Add SignPath repository variables**
  - Go to: Settings → Secrets and variables → Actions → Variables tab
  - Add these three variables:

  | Variable | Value |
  |----------|-------|
  | `SIGNPATH_ORGANIZATION_ID` | *(from SignPath dashboard → Organization settings)* |
  | `SIGNPATH_PROJECT_SLUG` | `sokuji` |
  | `SIGNPATH_SIGNING_POLICY_SLUG` | `test-signing` |

  These are non-sensitive identifiers. Using variables (not secrets) so they're visible and easy to change. Phase 2 only requires changing `SIGNPATH_SIGNING_POLICY_SLUG` to `release-signing`.

### Task 8: Pipeline Validation (after manual setup is complete)

- [ ] **Step 1: Push the branch and create a test tag**

```bash
git push origin worktree-signpath-windows-signing
git tag -a v0.0.0-signing-test -m "Test SignPath signing pipeline"
git push origin v0.0.0-signing-test
```

- [ ] **Step 2: Monitor the GitHub Actions run**
  - Verify `build` job completes and uploads `windows-unsigned` + `windows-nupkg`
  - Verify `sign-windows` job starts, submits to SignPath, and receives signed artifact
  - Verify `release` job collects signed exe and nupkg in release assets

- [ ] **Step 3: Verify the signed artifact**
  - Download `SokujiSetup.exe` from the GitHub release
  - On Windows, run: `Get-AuthenticodeSignature .\SokujiSetup.exe`
  - Expected: `Status: Valid` with the test-signing certificate subject

- [ ] **Step 4: Clean up test tag**

```bash
git push origin --delete v0.0.0-signing-test
git tag -d v0.0.0-signing-test
```

---

## Phase 2 Reference (future — when release-signing is available)

Not part of this implementation. When SignPath assigns the EV certificate:

1. In SignPath dashboard: assign EV cert to `release-signing` policy, enable origin verification
2. In GitHub repo variables: change `SIGNPATH_SIGNING_POLICY_SLUG` from `test-signing` to `release-signing`
3. Push a real release tag and verify SmartScreen does not warn on a clean Windows machine
4. Close issue #105
