# Store Installer Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every release ships two Windows installers, both signed in one SignPath request: the website's `Sokuji-X.Y.Z.Setup.exe` and the Microsoft Store's `Sokuji-X.Y.Z-store-installer.exe`. The backend serves the Store's at a pinned URL, and the Store listing stops promising an install.

**Architecture:**
- **Store installer.** The Windows build job makes the website installer as today. It then moves `out/make` aside, writes `resources/distribution.json` into the packaged app, and runs `electron-forge make --from-package` again. The second Setup is renamed.
- **Signing.** Both installers go up as one `windows-unsigned` artifact. SignPath's `default` configuration gets one `<pe-file>` pattern per installer.
- **Release.** latest.yml is built from `*.Setup.exe` only.
- **Backend.** sokuji-backend's `pinnedAssetUrl` accepts the second name.

**Tech Stack:** GitHub Actions (windows-latest bash, ubuntu bash), Electron Forge 8.0.1 (`--from-package`), SignPath artifact configuration v1, Cloudflare Worker (TypeScript, Vitest), Python 3 (listing CSV).

**Spec:** `docs/superpowers/specs/2026-10-17-vbcable-prompt-store-installer-design.md` (§6-§8)

**Depends on:** `docs/superpowers/plans/2026-10-17-vbcable-prompt.md` Task 1 (`electron/distribution-channel.js`, whose `MARKER_FILE` and `STORE_MARKER` the consistency test imports). Land that plan first, or on the same branch before this one.

## Global Constraints

- English for code, comments, commits and listing sources; conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Ask before outward acts.** Ask the owner before every push, PR, merge, deploy or SignPath change, naming the target, e.g. "push `worktree-vbcable-channels` to `kizuna-ai-lab/sokuji`" or "open a PR on `kizuna-ai-lab/sokuji-backend`". Merging sokuji-backend `main` deploys production.
- **Installer names.**
  - The Store installer's name is exactly `Sokuji-${VERSION}-store-installer.exe`. It must not contain `Setup`.
  - The website installer stays `Sokuji-${VERSION} Setup.exe` from Squirrel, renamed to `Sokuji-${VERSION}.Setup.exe` in the release job.
- **Marker.** The marker file is `resources/distribution.json` with content `{"channel":"store"}`, exactly as `electron/distribution-channel.js` reads it.
- **Signing.** One SignPath request per release, so one manual approval.
- **Listing.** No URLs in the description, no claim of zero network activity, and the title stays "Sokuji" (`~/Desktop/kizunaai/sokuji-store-listing/README.md` copy rules).

## Review Focus

1. **A PR build with no tag.** The store make still runs on every Windows build and must not need any secret. Only the upload steps are tag-gated (Task 1, by keeping the `if:` on uploads only).
2. **A packaged-app folder name other than `Sokuji-win32-x64`** (product name change, arm64 matrix). The step must find exactly one `out/*-win32-<arch>` folder or fail loudly, never write the marker into the wrong tree (Task 1).
3. **A release where SignPath returned only one file.** latest.yml must still be built from the website installer, and the job must fail rather than publish without the Store installer (Task 1).
4. **The pinned route given the Store name with another version** (`v0.45.6` + `Sokuji-0.45.5-store-installer.exe`): it answers 404, like the website name (Task 2).
5. **The SignPath UI configuration left at the old single pattern when a tag is pushed.** `*Setup*.exe` still matches exactly one file, so signing passes but the Store installer comes back unsigned. Task 1's release check catches the missing signed file only if SignPath drops it. Task 4 makes the UI update a precondition of tagging, and Task 1's release check verifies that every installer has an Authenticode signature block.

---

### Task 1: Make, sign and release both installers

**Files:**
- Create: `electron/store-installer.consistency.test.js`
- Modify: `.signpath/artifact-configurations/default.xml`
- Modify: `.github/workflows/build.yml`. These steps:
  - a new step after "Build Electron app with Forge" (`:314-327`);
  - the two upload steps (`:599-611`);
  - "Collect release assets" (`:737-767`);
  - "Generate latest.yml for auto-updater" (`:769-796`);
  - the diagnostics test list (`:56-78`).

**Interfaces:**
- Consumes: `MARKER_FILE`, `STORE_MARKER` from `electron/distribution-channel.js`.
- Produces:
  - the artifact `windows-unsigned`, holding `Sokuji-X.Y.Z Setup.exe` and `Sokuji-X.Y.Z-store-installer.exe` at its root;
  - release assets `Sokuji-X.Y.Z.Setup.exe` and `Sokuji-X.Y.Z-store-installer.exe`, plus a latest.yml naming the former.

- [ ] **Step 1: Write the failing test**

```js
// electron/store-installer.consistency.test.js
//
// The Microsoft Store's installer is made in build.yml, signed by SignPath's
// `default` configuration and read by distribution-channel.js. Nothing runs
// that pipeline before a tag, so the names that tie it together are pinned
// here (spec 2026-10-17 §6).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKER_FILE, STORE_MARKER } from './distribution-channel.js';

const root = join(__dirname, '..');
const workflow = readFileSync(join(root, '.github/workflows/build.yml'), 'utf8');
const signpath = readFileSync(join(root, '.signpath/artifact-configurations/default.xml'), 'utf8');

/** One step of build.yml, from its `- name:` line to the next one. */
function step(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  expect(start, `expected a step named ${name}`).toBeGreaterThan(-1);
  const next = workflow.indexOf('- name:', start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

/** SignPath's path wildcard: `*` is any run of characters within the zip's root. */
const escape = (s) => s.replace(/[.+?^$()|[\]\\{}]/g, '\\$&');
const glob = (pattern) => new RegExp('^' + pattern.split('*').map(escape).join('[^/]*') + '$');

describe('the Microsoft Store installer pipeline', () => {
  const make = step('Make the Microsoft Store installer (Windows)');

  it('writes the marker distribution-channel.js reads into the packaged app, then makes from that package', () => {
    expect(make).toContain(`'${JSON.stringify(STORE_MARKER)}'`);
    expect(make).toContain(`/resources/${MARKER_FILE}"`);
    expect(make.indexOf(MARKER_FILE)).toBeLessThan(make.indexOf('electron-forge make'));
    expect(make).toContain('--from-package');
    expect(make).not.toMatch(/^\s+if: .*refs\/tags/m);
  });

  it('puts both installers side by side under the names the rest of the pipeline expects', () => {
    expect(make).toContain('"out/make-web/squirrel.windows/x64/Sokuji-${VERSION} Setup.exe" out/installers/');
    expect(make).toContain('"out/installers/Sokuji-${VERSION}-store-installer.exe"');
  });

  it('signs both installers in one request, each matched by exactly one pattern', () => {
    const patterns = [...signpath.matchAll(/<pe-file path="([^"]+)">/g)].map((m) => glob(m[1]));
    expect(patterns).toHaveLength(2);
    for (const name of ['Sokuji-1.2.3 Setup.exe', 'Sokuji-1.2.3-store-installer.exe']) {
      expect(patterns.filter((p) => p.test(name)), name).toHaveLength(1);
    }
  });

  it('uploads both installers for signing, and the website make\'s nupkg for the release', () => {
    expect(step('Upload unsigned Windows installers for signing')).toContain('path: out/installers/*.exe');
    expect(step('Upload Windows nupkg for release')).toContain('path: out/make-web/squirrel.windows/x64/*.nupkg');
  });

  it('releases the Store installer and feeds the updater the website installer only', () => {
    expect(step('Collect release assets')).toContain("-name '*-store-installer.exe'");
    const latest = step('Generate latest.yml for auto-updater');
    expect(latest).toContain('-name "*.Setup.exe"');
    expect(latest).toMatch(/-ne 1 \]; then[\s\S]*exit 1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/store-installer.consistency.test.js`
Expected: FAIL with "expected a step named Make the Microsoft Store installer (Windows)".

- [ ] **Step 3: SignPath configuration**

Replace `.signpath/artifact-configurations/default.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <!-- The website's Squirrel installer (contains the embedded nupkg) -->
    <pe-file path="*Setup*.exe">
      <authenticode-sign />
    </pe-file>
    <!-- The Microsoft Store's installer: the same app plus resources/distribution.json
         (spec 2026-10-17 §6). Its name holds no "Setup", so each pattern matches one file. -->
    <pe-file path="*-store-installer.exe">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

- [ ] **Step 4: The make step**

In `.github/workflows/build.yml`, insert this step after "Build Electron app with Forge" (after its `VITE_ENABLED_PROVIDERS` env line, before the `# electron-builder bundles an x86_64-only` comment):

```yaml
      # The Microsoft Store's installer (spec 2026-10-17 §6): the same packaged
      # app plus resources/distribution.json, which turns the one-click VB-CABLE
      # install into a link (Store policy 10.2.3). maker-squirrel always writes
      # out/make/squirrel.windows/x64, so the website's installer moves aside
      # first. Every Windows build runs it, so a PR proves it still works; only
      # a tag uploads.
      - name: Make the Microsoft Store installer (Windows)
        if: runner.os == 'Windows'
        shell: bash
        run: |
          set -euo pipefail
          VERSION=$(node -p "require('./package.json').version")
          ARCH='${{ matrix.arch || 'x64' }}'
          mv out/make out/make-web
          shopt -s nullglob
          APP_DIRS=(out/*-win32-"$ARCH")
          if [ "${#APP_DIRS[@]}" -ne 1 ] || [ ! -d "${APP_DIRS[0]}/resources" ]; then
            echo "Expected one packaged app under out/*-win32-$ARCH, found: ${APP_DIRS[*]:-none}" >&2
            exit 1
          fi
          printf '%s\n' '{"channel":"store"}' > "${APP_DIRS[0]}/resources/distribution.json"
          npx electron-forge make --arch="$ARCH" --from-package
          mkdir -p out/installers
          cp "out/make-web/squirrel.windows/x64/Sokuji-${VERSION} Setup.exe" out/installers/
          cp "out/make/squirrel.windows/x64/Sokuji-${VERSION} Setup.exe" "out/installers/Sokuji-${VERSION}-store-installer.exe"
          ls -la out/installers
```

- [ ] **Step 5: The upload steps**

Replace the two Windows upload steps with:

```yaml
      - name: Upload unsigned Windows installers for signing
        if: startsWith(github.ref, 'refs/tags/v') && matrix.os == 'windows-latest'
        uses: actions/upload-artifact@v6
        with:
          name: windows-unsigned
          # Both at the zip's root, where SignPath's two patterns look.
          path: out/installers/*.exe

      - name: Upload Windows nupkg for release
        if: startsWith(github.ref, 'refs/tags/v') && matrix.os == 'windows-latest'
        uses: actions/upload-artifact@v6
        with:
          name: windows-nupkg
          path: out/make-web/squirrel.windows/x64/*.nupkg
```

- [ ] **Step 6: The release job**

In "Collect release assets", between the rename loop's `cd ..` and `echo "=== Release assets ==="`, insert:

```bash
          # The Microsoft Store's installer travels with the release: the Store
          # downloads it through sokuji-backend's pinned route. Fail rather than
          # publish a release the Store submission cannot point at, or one whose
          # installers came back without a signature.
          if [ -z "$(find release-assets -name '*-store-installer.exe')" ]; then
            echo "The Store installer is missing from the signed artifacts" >&2
            exit 1
          fi
          # An Authenticode signature sits in the PE certificate table (optional-
          # header data directory 4). This job has no checkout and no
          # osslsigncode, so a non-empty entry is the check: it tells a signed
          # installer from one SignPath never touched.
          python3 -I - release-assets/*.exe <<'EOF'
          import struct, sys
          unsigned = []
          for path in sys.argv[1:]:
              data = open(path, 'rb').read()
              pe = struct.unpack_from('<I', data, 0x3C)[0]
              optional = pe + 24
              directories = optional + (96 if struct.unpack_from('<H', data, optional)[0] == 0x10B else 112)
              _offset, size = struct.unpack_from('<II', data, directories + 4 * 8)
              if data[pe:pe + 4] != b'PE\0\0' or size == 0:
                  unsigned.append(path)
          for path in unsigned:
              print(f'Not signed: {path}', file=sys.stderr)
          sys.exit(1 if unsigned else 0)
          EOF
```

In "Generate latest.yml for auto-updater", replace:

```bash
          # Find the signed Windows .exe
          EXE_FILE=$(find release-assets -name "*.exe" | head -1)
          if [ -z "$EXE_FILE" ]; then
            echo "Warning: No .exe found, skipping latest.yml generation"
            exit 0
          fi
```

with:

```bash
          # The website's installer only: the Store's must never reach the updater.
          mapfile -t EXES < <(find release-assets -name "*.Setup.exe")
          if [ "${#EXES[@]}" -ne 1 ]; then
            echo "Expected one *.Setup.exe, found ${#EXES[@]}: ${EXES[*]:-none}" >&2
            exit 1
          fi
          EXE_FILE=${EXES[0]}
```

- [ ] **Step 7: CI list**

In the `test (diagnostics)` list, after `electron/squirrel-nuspec.consistency.test.js` (and after the VB-CABLE plan's entries if they are already there), add:

```yaml
          electron/store-installer.consistency.test.js
```

- [ ] **Step 8: Run the tests and lint the workflow**

Run: `npx vitest run electron/store-installer.consistency.test.js electron/squirrel-nuspec.consistency.test.js electron/distribution-channel.test.js`
Expected: PASS.

Run: `python3 -I -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build.yml'))" && echo yaml-ok`
Expected: `yaml-ok`.

Prove the signature check tells a signed installer from an unsigned one. Use v0.45.5's signed installer, and a copy of it with the certificate-table entry zeroed:

```bash
mkdir -p "$CLAUDE_JOB_DIR/tmp/pecheck/release-assets"
cd "$CLAUDE_JOB_DIR/tmp/pecheck"
curl -sSLo release-assets/signed.exe "https://github.com/kizuna-ai-lab/sokuji/releases/download/v0.45.5/Sokuji-0.45.5.Setup.exe"
python3 -I - release-assets/signed.exe release-assets/unsigned.exe <<'EOF'
import struct, sys
data = bytearray(open(sys.argv[1], 'rb').read())
pe = struct.unpack_from('<I', data, 0x3C)[0]
optional = pe + 24
directories = optional + (96 if struct.unpack_from('<H', data, optional)[0] == 0x10B else 112)
struct.pack_into('<II', data, directories + 4 * 8, 0, 0)
open(sys.argv[2], 'wb').write(data)
EOF
```

Then paste the heredoc from Step 6 (from `python3 -I - release-assets/*.exe <<'EOF'` to `EOF`, unindented) into the shell, once with only `signed.exe` present and once with both.
Expected: exit 0 with no output the first time. The second time, exit 1 and `Not signed: release-assets/unsigned.exe`.

- [ ] **Step 9: Commit**

```bash
git add electron/store-installer.consistency.test.js .signpath/artifact-configurations/default.xml .github/workflows/build.yml
git commit -m "ci: make, sign and release the Microsoft Store installer beside the website's"
```

The PR build's Windows job is the first real run of the make step. After the owner allows the push, check that the job's log lists both files under `out/installers`.

---

### Task 2: Backend pinned route serves the Store installer (kizuna-ai-lab/sokuji-backend)

**Files** (in a sokuji-backend worktree, e.g. `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend/.claude/worktrees/store-installer-route` on a new branch from `origin/main`; run this task from a session or subagent whose working directory is that worktree):
- Modify: `src/routes/pinned-download.ts:1-67`
- Test: `src/routes/pinned-download.test.ts`

**Interfaces:**
- Produces: `pinnedAssetUrl('vX.Y.Z', 'Sokuji-X.Y.Z-store-installer.exe')` → `https://github.com/kizuna-ai-lab/sokuji/releases/download/vX.Y.Z/Sokuji-X.Y.Z-store-installer.exe`.

- [ ] **Step 1: Write the failing tests**

In `src/routes/pinned-download.test.ts`, inside `describe("pinnedAssetUrl", …)`, add:

```ts
    it("maps the Microsoft Store's installer of the same release too", () => {
        expect(pinnedAssetUrl("v0.43.2", "Sokuji-0.43.2-store-installer.exe")).toBe(
            `${GITHUB}/v0.43.2/Sokuji-0.43.2-store-installer.exe`
        );
    });

    it("refuses a Store installer whose version is not the tag's", () => {
        expect(pinnedAssetUrl("v0.43.2", "Sokuji-0.43.1-store-installer.exe")).toBeNull();
    });
```

and extend the "refuses every other asset" list with `"Sokuji-0.43.2-store-installer.exe.blockmap"` and `"Sokuji-0.43.2.store-installer.exe"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/routes/pinned-download.test.ts`
Expected: FAIL on the first new test (null instead of the URL).

- [ ] **Step 3: Implement**

Replace `pinnedAssetUrl` and its JSDoc:

```ts
/**
 * The GitHub asset behind `/api/download/:tag/:file`, or null.
 *
 * `tag` must be `vX.Y.Z` exactly — not a prerelease, and not the `sidecar-v` or
 * `native-v` tags that share the repository — and `file` must be one of that
 * version's two Windows installers: the website's `Sokuji-X.Y.Z.Setup.exe`, or
 * the Microsoft Store's `Sokuji-X.Y.Z-store-installer.exe`, which leaves out the
 * one-click VB-CABLE install the Store's policy forbids.
 */
export function pinnedAssetUrl(tag: string, file: string): string | null {
    const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
    if (!match) return null;
    const version = match[1];
    if (file !== `Sokuji-${version}.Setup.exe` && file !== `Sokuji-${version}-store-installer.exe`) return null;
    return `${RELEASE_BASE}/${tag}/${file}`;
}
```

In the file's header comment, change "Only the Windows installer of a plain release tag is served." to "Only the two Windows installers of a plain release tag are served."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/routes/pinned-download.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit, then ask**

```bash
git add src/routes/pinned-download.ts src/routes/pinned-download.test.ts
git commit -m "feat(download): serve the Microsoft Store installer from the pinned route"
```

Ask the owner before pushing the branch to `kizuna-ai-lab/sokuji-backend` and before opening its PR. Merging to `main` deploys production. The route only widens what it serves, and an unpublished name still answers 404 from GitHub.

---

### Task 3: Store listing copy and certification notes

**Files** (`~/Desktop/kizunaai/sokuji-store-listing/`, not a git repository):
- Modify: `master_en.json` (`Description`, `ApplicableLicenseTerms`)
- Modify: `i18n/<code>.json` for all 29 languages (the same two fields)
- Create: `certification-notes.txt`
- Output: `out/Sokuji-store-listing.csv`, copied to `~/Downloads/Sokuji-store-listing-v3/`

- [ ] **Step 1: Keep the v2 sources**

```bash
cd ~/Desktop/kizunaai/sokuji-store-listing
cp master_en.json master_en.v2.json
cp -r i18n i18n.v2
```

- [ ] **Step 2: Change the English sentences**

In `master_en.json`:
- `Description`: replace "On Windows this uses the VB-CABLE virtual audio driver; if it is missing, Sokuji offers to install it for you." with "On Windows this uses VB-CABLE, a free virtual audio driver from VB-Audio that you install separately; Sokuji links to it and picks it up automatically."
- `ApplicableLicenseTerms`: replace "The VB-CABLE virtual audio driver, which Sokuji can install with your consent, is third-party software from VB-Audio under its own license." with "The VB-CABLE virtual audio driver, which you can install separately for the virtual microphone, is third-party software from VB-Audio under its own license."

Check: `grep -c "offers to install\|with your consent" master_en.json` prints `0`.

- [ ] **Step 3: Translate the two sentences into the 29 languages**

For each `i18n/<code>.json`, replace only the sentence that carries the VB-CABLE install offer in `Description`, and the clause about installing VB-CABLE with consent in `ApplicableLicenseTerms`, with a translation of the new English. For example, ja `Description` has "Windows では VB-CABLE 仮想オーディオドライバーを使用します。インストールされていない場合は、Sokuji がインストールを提案します。", and ja `ApplicableLicenseTerms` ends "Sokuji は、お客様の同意を得た場合にのみこれをインストールします。".
- Keep "VB-CABLE" and "VB-Audio" verbatim.
- Leave every other sentence unchanged.

Then print each language's VB-CABLE sentences for review:

```bash
python3 -I -c "
import json,glob
for f in sorted(glob.glob('i18n/*.json')):
    d=json.load(open(f))
    for k in ('Description','ApplicableLicenseTerms'):
        s=d[k]; i=s.find('VB-CABLE'); print(f, k, '|', s[max(0,i-60):i+200].replace(chr(10),' '))
"
```

- [ ] **Step 4: Certification notes**

Write `certification-notes.txt`:

```text
Sokuji does not install any third-party software. One optional feature, sending the translated voice into meeting apps as a microphone, works when the user has installed the free VB-CABLE driver from VB-Audio. The app only links to vb-audio.com for that. Every other feature works without it.
```

- [ ] **Step 5: Build and stage the CSV**

Run: `python3 -I build_csv.py`
Expected: it reports no limit or required-field errors and writes `out/Sokuji-store-listing.csv`.

```bash
mkdir -p ~/Downloads/Sokuji-store-listing-v3
cp out/Sokuji-store-listing.csv ~/Downloads/Sokuji-store-listing-v3/
cp -r out/images ~/Downloads/Sokuji-store-listing-v3/
```

In README.md's "Copy rules", add a line: "Since v3 (2026-10-17) the listing never says Sokuji installs VB-CABLE; it says the user installs it separately and Sokuji links to it (Store policy 10.2.3.2)."

---

### Task 4: The owner's steps (not code)

These are the owner's to take. The executor lists them in the hand-over and checks each when the owner reports it done.

- [ ] **SignPath UI.** Set the `default` artifact configuration of the SignPath project to the new `.signpath/artifact-configurations/default.xml`. This must happen before the next `v*` tag, or the Store installer comes back unsigned and Task 1's release check fails the release.
- [ ] **Merge both.** Merge this plan's and the VB-CABLE plan's sokuji PRs, and the sokuji-backend PR, which deploys.
- [ ] **Release.** Cut the next app release as usual (CLAUDE.md "Version Update Process") and approve the one SignPath request.
- [ ] **Verify** (I can run these when asked):
  - `curl -sI https://sokuji.kizuna.ai/api/download/vX.Y.Z/Sokuji-X.Y.Z-store-installer.exe` answers `200` with `content-disposition: attachment; filename="Sokuji-X.Y.Z-store-installer.exe"`;
  - `latest.yml` names `Sokuji-X.Y.Z.Setup.exe`;
  - both installers show a valid SignPath Foundation signature on Windows (`Get-AuthenticodeSignature`).
- [ ] **Smart App Control.** On the Windows test machine (.13), with Smart App Control on, the Store installer installs and the app starts in store mode: the Speech row offers a link, not an install.
- [ ] **Partner Center.** New submission:
  - Packages: the installer URL becomes the Store installer's pinned URL; the `--silent` argument is unchanged.
  - Store listings: import `~/Downloads/Sokuji-store-listing-v3/`.
  - Submission options: paste `certification-notes.txt` into the certification notes.
