# macOS Auto-Update for Sokuji: Feasibility Research

Research date: 2026-08-24, against `v0.38.0` (`9d81aeca`). All claims below are
sourced from primary sources (official docs, first-party source code, or this
repository) and cited inline. Local source citations refer to
`electron-updater@6.8.3` as installed in this repo's `node_modules/`.

Related: **issue #106** ("Add macOS code signing and notarization for Gatekeeper
trust") already covers the signing half — enrollment, certificates, entitlements,
CI secrets — and is still open. This document is about the *update* half, which
#106 does not address: what it takes to go from "we show a notification" to "the
app updates itself". Signing is a prerequisite for that, not the whole of it.

## TL;DR verdict

**Yes, true in-app auto-update (download + silent install + relaunch, like
Chrome/VS Code) is technically possible for Sokuji on macOS, and most of the
plumbing already exists in this repo.** Three things stand in the way, and all
three must go:

1. **No Developer ID code signature** — the hard blocker, and the only one that
   costs money. Squirrel.Mac (the engine under both Electron's built-in
   `autoUpdater` and `electron-updater`'s `MacUpdater`) verifies each downloaded
   update against the *running* app's code-signing designated requirement, and
   refuses to install anything that does not match. There is no flag, fork, or
   configuration escape hatch — the check lives in compiled Objective-C inside
   Electron itself, not in JS. (§1.3, §5.1)
2. **No `.zip` asset is published.** `MacUpdater` accepts only a zip and
   explicitly rejects `pkg`/`dmg`; today's releases ship PKGs only, so even a
   correctly signed build would fail with `ERR_UPDATER_ZIP_FILE_NOT_FOUND`.
   (§1.4)
3. **`/Applications/Sokuji.app` is root-owned.** The PKG installs it as root,
   and Squirrel's installer runs as the invoking user with **no** privilege
   escalation, so it cannot replace that bundle. Fixing 1 and 2 without fixing
   this produces an updater that downloads correctly and then fails to install.
   (failure mode 12)

- With an Apple Developer Program membership (**USD 99/year**) + a Developer ID
  Application certificate + notarization, the existing
  `electron/update-manager.js` + `electron-updater` stack can do full
  auto-update after roughly: add a `zip` target for mac, add ~6 CI secrets, and
  delete the darwin "notify-only" branch. Estimated effort: 1–2 days of
  engineering plus Apple enrollment lead time.
- Without an Apple account, **silent in-place auto-update is impossible** via
  any Squirrel-based path (ad-hoc signatures mathematically cannot pass the
  check — see §5.1). The honest fallbacks are (a) a semi-automatic
  "download the PKG in-app and launch the installer" flow mirroring the
  existing Windows path, or (b) embedding the native Sparkle framework with
  EdDSA-signed updates, which avoids Apple signing for *updates* but is a
  large, unmaintained-territory integration for Electron and does nothing for
  the first-install Gatekeeper experience.
- Signing + notarizing would *also* eliminate today's first-install pain (the
  "unverified developer" dialog / System Settings "Open Anyway" dance, which
  macOS Sequoia made strictly worse by removing the Control-click override).

---

## 0. What ships today, and why it hurts

| Piece | State |
|---|---|
| macOS artifact | `Sokuji-<v>-arm64.pkg` / `-x64.pkg` only (~132–139 MB each) |
| Signing | ad-hoc only — `scripts/electron-builder-fuses.js` runs `codesign --force --deep --sign -`; `package.json` sets `mac.identity: null`; CI sets `CSC_IDENTITY_AUTO_DISCOVERY: false` |
| Notarization | none |
| `latest-mac.yml` | hand-generated in CI (the PKG target does not emit one) and lists the two PKGs |
| Update path | `electron/update-manager.js:99-113` sets `supportsAutoUpdate: false` on darwin and hands the renderer a `pkgUrl`; `:194-196` refuses `update-download` outright |
| User steps per release | download in browser → `sudo xattr -d com.apple.quarantine ~/Downloads/Sokuji-*.pkg` → run installer → probably re-grant microphone permission (failure mode 13) |

Linux AppImage already does true in-app auto-update and Windows already downloads
the installer in-app and launches it. macOS is the only platform left fully manual.

**The volume matters.** The project shipped 15 releases between 2026-07-27 and
2026-08-23 — roughly one every two days. Every one of them puts a macOS user
through the sequence above. Whatever this costs to fix, it is amortised over a
release every 48 hours.

Only the mac `zip` target sets `isWriteUpdateInfo`
(`app-builder-lib/out/macPackager.js:115-117`), which is why the PKG-only release
needs that hand-rolled `latest-mac.yml` step in CI — adding a zip makes the file
machine-generated and emits a blockmap for differential download at the same time.

---

## 1. How the macOS update machinery actually works

### 1.1 Electron's built-in `autoUpdater` = Squirrel.Mac

Electron's docs state the macOS updater is "built upon Squirrel.Mac, meaning
you don't need any special setup to make it work", and are explicit about the
blocker:

> "Your application must be signed for automatic updates on macOS. This is a
> requirement of `Squirrel.Mac`."
> — https://www.electronjs.org/docs/latest/api/auto-updater

The same page notes update requests are subject to App Transport Security
(ATS); apps needing to talk to plain-HTTP servers must set
`NSAllowsArbitraryLoads` (relevant to §1.3's localhost proxy, which works in
practice because electron-updater serves on `http://127.0.0.1` and Electron's
helper allows it; keep in mind if updates ever fail with ATS errors).

### 1.2 Squirrel.Mac server contract (JSON + ZIP)

From the Squirrel.Mac README (https://github.com/Squirrel/Squirrel.Mac):

- Server returns HTTP **200 + JSON** when an update exists, **204 No Content**
  when it doesn't.
- Update JSON schema:

  ```json
  {
    "url": "https://mycompany.example.com/myapp/releases/myrelease",
    "name": "My Release Name",
    "notes": "Theses are some release notes innit",
    "pub_date": "2013-09-18T12:29:53+01:00",
    "sha256": "…",
    "size": 104857600,
    "delta": { "from_version": "412", "url": "…", "sha256": "…", "size": 7340032 }
  }
  ```

  "The only required key is \"url\", the others are optional." and
  "\"pub_date\" if present must be formatted according to ISO 8601."
- Archive format: **ZIP only** — "Squirrel will request \"url\" with
  `Accept: application/zip` and only supports installing ZIP updates."
  (DMG and PKG are *not* update formats; they are first-install formats.)
- **Delta updates: yes.** Squirrel.Mac supports binary delta patches via the
  optional `delta` key; the README's Dependencies section says "Binary delta
  support compiles Sparkle's BinaryDelta sources and the bsdiff it vendors"
  (submodule pinned to Sparkle 2.9.5). A failed delta falls back to the full
  ZIP. Note: the electron-updater flow (§1.3) never populates `delta` — it
  does its own differential download of the ZIP instead.
- Install/relaunch: downloaded updates are installed automatically when the
  app terminates, or immediately via the `relaunchToInstallUpdate` signal
  (surfaced in Electron as `autoUpdater.quitAndInstall()`).

### 1.3 What signature validation Squirrel.Mac actually performs (source)

This is the crux, and it is in Squirrel.Mac's Objective-C, compiled into the
Electron binary — not overridable from JS:

- At init, `SQRLUpdater` captures the **running app's** signature:
  `_signature = [SQRLCodeSignature currentApplicationSignature:&error];` and
  if that fails it logs *"Could not get code signature for running
  application, application updates are disabled"* and throws
  `NSInternalInconsistencyException`.
  — https://github.com/Squirrel/Squirrel.Mac/blob/master/Squirrel/SQRLUpdater.m
- `SQRLCodeSignature` extracts the running app's **designated requirement**
  (`SecCodeCopySelf` → `SecCodeCopyDesignatedRequirement`) and verifies every
  downloaded bundle against it with
  `SecStaticCodeCheckValidityWithErrors(staticCode, kSecCSCheckNestedCode |
  kSecCSStrictValidate | kSecCSCheckAllArchitectures, requirement)`; on
  mismatch the update fails with `SQRLCodeSignatureErrorDidNotPass`.
  — https://github.com/Squirrel/Squirrel.Mac/blob/master/Squirrel/SQRLCodeSignature.m
- Consequences by signing state:
  - **Unsigned app**: `SecCodeCopyDesignatedRequirement` fails → updater
    disabled/throws at startup.
  - **Ad-hoc-signed app** (what Sokuji CI produces today): init succeeds, but
    the update can never verify — see §5.1.
  - **Developer ID-signed app**: works, because Apple's policy engine
    deliberately makes new versions of the same signed program satisfy the old
    DR: "a program's DR should also be satisfied by updates, i.e., new
    versions of that code, and by nothing else. This is how the macOS code
    signing policy engine recognizes updates and upgrades."
    — TN2206, https://developer.apple.com/library/archive/technotes/tn2206/_index.html
- After installing, Squirrel **removes quarantine** from the new bundle:
  `clearQuarantineForDirectory:` "Recursively clears the quarantine extended
  attribute … This ensures users don't see a warning that the application was
  downloaded from the Internet." (implemented via
  `removexattr(path, "com.apple.quarantine", XATTR_NOFOLLOW)`).
  — https://github.com/Squirrel/Squirrel.Mac/blob/master/Squirrel/SQRLInstaller.m

### 1.4 `electron-updater`'s `MacUpdater` (the stack Sokuji already ships)

From the installed source
(`node_modules/electron-updater/out/MacUpdater.js`, v6.8.3; upstream:
https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/MacUpdater.ts):

- It selects the **ZIP** asset from the update info:
  `findFile(files, "zip", ["pkg", "dmg"])`; if none exists it throws
  `ERR_UPDATER_ZIP_FILE_NOT_FOUND` ("ZIP file not provided"). **Sokuji's
  current mac releases publish only `.pkg` files (v0.38.0 assets:
  `latest-mac.yml`, `Sokuji-0.38.0-{arm64,x64}.pkg`), so even a signed build
  would fail here until a zip target is added.**
- It downloads the ZIP itself (supports **differential download** against a
  cached `update.zip` from the previous update), then spins up an
  `http.createServer()` on `127.0.0.1:<random port>`, guarded by
  single-use Basic-auth credentials from `crypto.randomBytes`. It calls the
  native `autoUpdater.setFeedURL({url: "http://127.0.0.1:<port>", headers:
  {Authorization: "Basic …"}})`; Squirrel then requests `/`, receives
  `{ "url": "http://127.0.0.1:<port>/<random>.zip" }`, fetches the ZIP from
  localhost, and performs the §1.3 signature validation + install.
- Arch handling: it detects arm64/Rosetta (`sysctl.proc_translated`,
  `uname -a`) and filters release files by whether the file URL contains
  "arm64" — so per-arch zips must be named accordingly.
- **Signature verification in electron-updater itself is Windows-only**: the
  only `verifySignature` implementation is
  `out/windowsExecutableCodeSignatureVerifier.js` (PowerShell
  `Get-AuthenticodeSignature`), used by `NsisUpdater`. `MacUpdater` contains
  no signature code and no unsigned-mode flag — macOS enforcement is entirely
  delegated to Squirrel.Mac. The docs are categorical: "macOS application must
  be signed in order for auto updating to work."
  — https://www.electron.build/docs/features/auto-update
- Required published files: "`zip` target for macOS is **required** for
  Squirrel.Mac, otherwise `latest-mac.yml` cannot be created, which causes
  `autoUpdater` error. Default target for macOS is `dmg`+`zip`, so there is no
  need to explicitly specify target." (same page). The ZIP is required because
  Squirrel only installs ZIPs (§1.2); the DMG exists purely for humans doing
  the first install.
- Publish providers: GitHub Releases, S3, DigitalOcean Spaces, Cloudflare R2,
  Keygen, generic HTTPS (same page). The **GitHub provider needs no token for
  public repos**: `GitHubProvider.getLatestVersion()` reads the public
  `https://github.com/{owner}/{repo}/releases.atom` feed and downloads
  `latest-mac.yml` + assets from public release URLs
  (https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts;
  confirmed in local `out/providers/GitHubProvider.js`). A token (`GH_TOKEN`)
  is only needed for private repos. Sokuji's update *check* already works this
  way today on all platforms.

---

## 2. What Apple requires (and what it fixes)

### 2.1 Membership and certificate

- **Apple Developer Program: "Enrollment is 99 USD (or in local currency where
  available) per membership year."** The free tier explicitly lacks
  "Notarization & Developer ID for Mac apps".
  — https://developer.apple.com/support/compare-memberships/
- **Developer ID Application certificate**: "Sign a Mac app before
  distributing it outside the Mac App Store." Creation requires the **Account
  Holder** role (or an admin with the cloud-managed Developer ID certificate
  access role); a team may hold **up to five** Developer ID Application and
  five Developer ID Installer certificates.
  — https://developer.apple.com/help/account/certificates/create-developer-id-certificates/
- Expiry vs revocation semantics matter for updaters: "If your certificate
  expires, users can still download, install, and run versions … signed with
  this certificate. However, you'll need a new certificate to sign updates …
  If your certificate is revoked, users will no longer be able to install
  applications that have been signed with this certificate."
  — https://developer.apple.com/help/account/certificates/certificates-overview/

### 2.2 Notarization

- Required for Developer ID distribution on modern macOS: "Beginning in macOS
  10.15, all software built after June 1, 2019, and distributed with Developer
  ID must be notarized."
  — https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- The notary service requires (same page): a **Developer ID** certificate
  ("Don't use a Mac Distribution, ad hoc, Apple Developer, or local
  development certificate."), the **Hardened Runtime** enabled, a secure
  timestamp, and no `get-task-allow` entitlement.
- `notarytool` is the current submission CLI; the old `altool` was cut off:
  "Starting November 1, 2023, the Apple notary service no longer accepts
  uploads from altool or Xcode 13 or earlier." (same page)
- **Stapling and ZIPs**: "You should also attach the ticket to your software
  using the `stapler` tool, so that future distributions include the ticket …
  This ensures that Gatekeeper can find the ticket even when a network
  connection isn't available." And critically: "While you can notarize a ZIP
  archive, you can't staple to it directly. Instead, run `stapler` against
  each item that you added to the archive. Then create a new ZIP file
  containing the stapled items for distribution."
  — https://developer.apple.com/documentation/security/customizing-the-notarization-workflow
  (electron-builder's `mac.notarize: true` automates sign → notarize → staple;
  see §4.)

### 2.3 Hardened Runtime and entitlements Sokuji needs

- "To upload a macOS app to be notarized, you must enable the Hardened Runtime
  capability." — https://developer.apple.com/documentation/security/hardened-runtime
- Electron requires the JIT runtime exception; microphone capture requires the
  audio-input resource-access entitlement:
  - `com.apple.security.cs.allow-jit` (Hardened Runtime "Runtime Exceptions",
    same page).
  - `com.apple.security.device.audio-input`: "A Boolean value that indicates
    whether the app may record audio using the built-in microphone and access
    audio input using Core Audio."
    — https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input
- `@electron/osx-sign` (used by both Forge's `osxSign` and electron-builder)
  already ships default entitlements covering this:
  `entitlements/default.darwin.plist` contains `com.apple.security.cs.allow-jit`
  and `com.apple.security.device.audio-input` (plus camera, bluetooth, etc.).
  — https://github.com/electron/osx-sign/blob/main/entitlements/default.darwin.plist
  So no custom entitlements file is strictly needed to start; trimming the
  defaults to just JIT + audio-input is optional hygiene.
- TCC prompt text: microphone access also needs `NSMicrophoneUsageDescription`
  in `Info.plist`. Sokuji's Forge/electron-builder configs do not set one
  (`grep NSMicrophoneUsageDescription` finds nothing in `forge.config.js` /
  `package.json`), so it currently rides on Electron's default plist strings —
  worth setting an app-specific string via `extendInfo` when touching signing.

### 2.4 Gatekeeper, quarantine, translocation — why signed+notarized fixes the UX

- Gatekeeper first-open checks: "all software in macOS is checked for known
  malicious content the first time it's opened", verifying it is "notarized by
  Apple to be free of known malicious content" and "from an identified
  developer", with user approval requested before first open.
  — https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web
- `com.apple.quarantine` is the extended attribute browsers and other
  downloading apps put on files; whether an app's *own* downloads are
  quarantined is opt-in via the `LSFileQuarantineEnabled` Info.plist key: "A
  Boolean value indicating whether the files this app creates are quarantined
  by default."
  — https://developer.apple.com/documentation/bundleresources/information-property-list/lsfilequarantineenabled
- The dialogs users see today for Sokuji's unsigned/ad-hoc PKG and app are
  documented by Apple: the "app developer cannot be verified" alert ("in macOS
  Catalina and later — the app hasn't been notarized by Apple, macOS can't
  verify that the app is free of malware"), and the "damaged" alert when
  "macOS detects that software has been modified or damaged". The only
  override is System Settings → Privacy & Security → "Open Anyway".
  — https://support.apple.com/en-us/102445
- **macOS Sequoia made unsigned distribution strictly worse**: "users will no
  longer be able to Control-click to override Gatekeeper … They'll need to
  visit System Settings > Privacy & Security to review security information
  for software before allowing it to run." (Apple Developer News, 2024-08-06)
  — https://developer.apple.com/news/?id=saqachfa
- **App translocation** (a.k.a. Gatekeeper Path Randomization): "Starting with
  macOS Sierra, running a newly-downloaded app from a disk image, archive, or
  the Downloads directory will cause Gatekeeper to isolate that app at a
  unspecified read-only location in the filesystem." (TN2206). The Platform
  Security guide phrases it as "When necessary, Gatekeeper opens apps from
  randomized, read-only locations." A translocated app cannot update itself in
  place (its bundle path is a read-only mount). Mitigation per TN2206: ship an
  installer or have users drag the app to `/Applications`. Sokuji's PKG
  installs to `/Applications` with `isRelocatable: false` (package.json →
  `build.pkg`), which avoids translocation; a future DMG flow must tell users
  to drag to Applications. There is no entitlement that controls translocation
  (nothing like `com.apple.security.translocation` exists in Apple's
  entitlement registry: https://developer.apple.com/documentation/bundleresources/entitlements).
- **Does a Squirrel in-place update re-trigger Gatekeeper?** No, by design:
  Gatekeeper's first-open approval applies to quarantined software (above),
  and Squirrel strips `com.apple.quarantine` from what it installs (§1.3).
  The update ZIP downloaded by electron-updater over Node HTTP is not
  quarantined anyway (quarantine is opt-in per `LSFileQuarantineEnabled`,
  which Electron does not set). Each released version must still be
  Developer-ID signed and notarized in CI — notarize + staple the `.app`,
  then zip it (§2.2) — both for first-time downloaders and so the DR check
  in §1.3 passes.

---

## 3. Cost

| Item | Cost | Source |
|---|---|---|
| Apple Developer Program (required; only path to Developer ID + notarization) | **USD 99 / year** | https://developer.apple.com/support/compare-memberships/ |
| Developer ID Application certificate | included in membership (max 5, Account Holder creates) | https://developer.apple.com/help/account/certificates/create-developer-id-certificates/ |
| Notarization service (`notarytool` submissions) | no per-submission fee documented; included in Developer ID workflow | https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution |
| CI macOS runners | already in use and **free**: "Use of the standard GitHub-hosted runners is free and unlimited on public repositories." Sokuji already builds on `macos-26` (arm64) and `macos-15-intel` (x64) — see `.github/workflows/build.yml` | https://docs.github.com/en/actions/reference/runners/github-hosted-runners |
| Engineering (estimate, not a sourced fact) | ~1–2 days for Option A below: CI secrets + zip target + updater branch change + a release dry-run | — |

Notes on enrollment friction (not a monetary cost): enrolling as an
*organization* ("Kizuna AI Lab") requires legal-entity verification; enrolling
as an *individual* is faster but the signature then shows the individual's
name. Membership lapse consequences are in §2.1 (expiry is survivable;
revocation is not).

---

## 4. Implementation options, ranked

### Option A (recommended): keep `electron-updater`, add signing + notarization + a mac ZIP

Smallest diff from today's architecture; `UpdateManager` and the renderer
update store already handle check/download/progress/install states, and the
Linux AppImage branch already exercises the full
`downloadUpdate()`/`quitAndInstall()` flow.

1. **Apple side**: enroll (USD 99/yr) → Account Holder creates a Developer ID
   Application certificate (§2.1) → export as `.p12` → create an App Store
   Connect API key or app-specific password for notarization (§4.1 below).
2. **Build side** (electron-builder already builds the mac artifacts in CI):
   - Change `build.mac.target` from `pkg` to include `zip` (electron-builder's
     default for mac is `dmg`+`zip`; keeping `pkg` alongside `zip` also works —
     `MacUpdater` picks the zip, humans can keep using the pkg). The zip is
     non-negotiable (§1.4: `ERR_UPDATER_ZIP_FILE_NOT_FOUND`).
   - Remove `"identity": null` from `build.mac` and drop
     `CSC_IDENTITY_AUTO_DISCOVERY: false` from the mac job; provide
     `CSC_LINK` (base64 `.p12`) + `CSC_KEY_PASSWORD` secrets instead. With
     no valid identity electron-builder skips signing; `identity: null`
     skips it explicitly. — https://www.electron.build/docs/features/code-signing/code-signing-mac
   - Set `mac.notarize: true` and provide notarization env vars;
     "electron-builder handles all three steps automatically when configured"
     (sign → notarize → staple), no `afterSign` hook needed on current
     versions. — https://www.electron.build/docs/features/code-signing/notarization
   - Delete the ad-hoc `codesign --force --deep --sign -` fallback in
     `scripts/electron-builder-fuses.js` for signed builds (fuses are flipped
     in `afterPack` *before* signing, which is the correct order — the file's
     own comment says fuses run "before code signing the application").
   - Keep `--publish never` + the existing release job; just make sure the
     `.zip` files and the regenerated `latest-mac.yml` (which must list the
     zips) get uploaded with the other assets, and that the zip names carry
     `arm64`/`x64` (the arch filter in §1.4 matches on "arm64" in the URL).
3. **Install-location side** — *this step is easy to miss and fatal to skip.*
   `pkgbuild` is invoked without an `--ownership` flag
   (`app-builder-lib/out/targets/pkg.js:215`), so the installed bundle ends up
   root-owned and Squirrel cannot replace it (failure mode 12). Either add a `chown` to
   `pkg-scripts/postinstall`:

   ```sh
   chown -R "$(stat -f%Su /dev/console)" /Applications/Sokuji.app
   ```

   or stop shipping the app itself in a PKG and go back to a drag-install
   DMG/ZIP, leaving the PKG (or a separate privileged step) for the HAL driver
   alone.
4. **Driver side**: decouple `SokujiVirtualAudio.driver` from app updates.
   Today every macOS update is a full PKG run whose `preinstall`/`postinstall`
   delete and re-copy the driver and restart `coreaudiod`, which is pure waste —
   the driver binary has not changed since 2025-09-17 (2494 commits ago), is
   pinned at BlackHole 0.6.1 build 596, and nothing in the app ever reads its
   version. Give it a version stamp and run the privileged install only when it
   actually changes.
5. **App side** (`electron/update-manager.js`): remove the darwin
   `supportsAutoUpdate = false` branch and let darwin share the AppImage code
   path (`autoUpdater.downloadUpdate()` → `update-downloaded` →
   `quitAndInstall()`). electron-updater serves the zip to Squirrel via its
   localhost proxy automatically (§1.4).

CI secrets to add (electron-builder names):
`CSC_LINK`, `CSC_KEY_PASSWORD`, and either
`APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` (API key,
recommended for CI) or `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` +
`APPLE_TEAM_ID`. — https://www.electron.build/docs/features/code-signing/notarization

### Option B: Forge-native stack (`MakerZIP` + `publisher-github` + `update-electron-app` / update.electronjs.org)

Forge's own auto-update story
(https://www.electronforge.io/advanced/auto-update) recommends
`update-electron-app` + the free update.electronjs.org service, and states
"having a signed application is a pre-requisite for using auto updates on
macOS." update.electronjs.org's requirements
(https://github.com/electron/update.electronjs.org): public GitHub repo,
builds published to GitHub Releases, and "Your builds are code signed (macOS
and MSIX only)"; mac assets must be `.zip` named with `-mac`/`-darwin` (+
optional `-arm64`/`-x64`). Signing/notarization would be configured via
Forge's `packagerConfig.osxSign` (`@electron/osx-sign`) and `osxNotarize`
(`@electron/notarize`) —
https://www.electronforge.io/guides/code-signing/code-signing-macos — and
Forge's ZIP maker can even emit a Squirrel.Mac `RELEASES.json` manifest for
static storage via `macUpdateManifestBaseUrl`
(https://www.electronforge.io/config/makers/zip).

Honest assessment for Sokuji: this replaces a working custom UpdateManager
(with its per-platform UX, progress events, release notes) with a service that
still requires exactly the same Apple certificate. It's the right default for
a fresh app; for this repo it's more churn for no reduction in the actual
blocker. Rank below Option A.

### Option C (no Apple account needed): semi-automatic PKG update — the zero-cost interim

Mirror the existing Windows flow (`_downloadUpdate()` + `shell.openPath()`)
on darwin: download `Sokuji-<v>-<arch>.pkg` with Node `https` in-app, then
launch Installer.app and quit. The user clicks through the installer
(admin auth). This is *not* silent auto-update, but it removes the
browser-download step, and — because quarantine on app-created files is
opt-in via `LSFileQuarantineEnabled` (§2.4), which Electron does not set —
the downloaded PKG should not carry `com.apple.quarantine`, avoiding the
Gatekeeper dance for updates (needs one verification pass on real hardware;
see Open questions). First-time installs keep today's full friction,
Sequoia-style (§2.4).

### Option D (no Apple account): Sparkle with EdDSA keys — possible, not recommended

Sparkle, the native macOS updater framework, does not hard-require Apple
signing: its security model is "Sign the published update archive (dmg, zip,
etc) … with Sparkle's EdDSA (ed25519) signature", with Apple Developer ID
notarization recommended "if possible"
(https://sparkle-project.org/documentation/). So it is the one real updater
that can silently update an app without an Apple account. Costs that make it
last-ranked here: it is a Cocoa framework with no maintained Electron
bridge (you'd write and maintain native glue + IPC yourself), Squirrel/
electron-updater would be abandoned for one platform, and it does nothing
about first-install Gatekeeper friction or the Sequoia policy (§2.4) — users
still fight to launch the app the first time.

### What does NOT work (verified against source)

- `electron-updater` with unsigned or ad-hoc builds — see §5.1.
- update.electronjs.org / `update-electron-app` without signing — requirement
  is explicit ("Your builds are code signed (macOS and MSIX only)"):
  https://github.com/electron/update-electron-app,
  https://github.com/electron/update.electronjs.org.
- Any "disable verification" flag: none exists in `MacUpdater` (no signature
  code at all on mac, §1.4) and none can exist without forking Electron's
  bundled Squirrel.Mac (§1.3).
- The existing free SignPath arrangement, which is Windows-only in practice —
  see failure mode 14.

### Recommended sequence

1. **Now, free: ship Option C.** It removes the browser and the Terminal from
   the update loop for existing users, and it is the smallest change on this
   page (roughly the `_downloadUpdate`/`_installUpdate` pair already in
   `update-manager.js`, pointed at `pkgUrl`). One hardware verification gates it
   (§6.5).
2. **Decide on the USD 99.** Given the release cadence (§0) and the likely TCC
   re-prompting (failure mode 13), this looks like the highest-leverage $99 in
   the project, and it is the only thing that fixes *first* install.
3. **After signing lands: Option A**, including the ownership and driver steps.
   At that point macOS reaches parity with Linux AppImage.

Steps 1 and 3 are not wasted work relative to each other: the in-app download
plumbing from C is what a driver-update prompt in A would reuse.

---

## 5. Failure modes and gotchas

1. **Ad-hoc signature ≠ signature, for update purposes.** Apple's own
   Security framework synthesizes the designated requirement for ad-hoc code
   as "a cdhash requirement for all architectures"
   (`SecStaticCode::defaultDesignatedRequirement()`,
   https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_codesigning/lib/StaticCode.cpp).
   The cdhash changes with every build, so version N+1 can never satisfy the
   DR captured from running version N — Squirrel's verify (§1.3) always fails.
   Sokuji CI ad-hoc signs today (`scripts/electron-builder-fuses.js`,
   `codesign --sign -`), which is why the in-code comment in
   `electron/update-manager.js` correctly rules auto-update out.
2. **No mac ZIP published → instant `ERR_UPDATER_ZIP_FILE_NOT_FOUND`.**
   Current releases ship only PKGs (checked against the v0.38.0 release
   assets); `latest-mac.yml` must list zips (§1.4).
3. **Identity/bundle-ID drift breaks the DR chain.** The update must satisfy
   the *old* version's DR (TN2206, §1.3). Changing team, certificate type, or
   `CFBundleIdentifier` between releases strands existing installs on manual
   update for one cycle. Same for the transition release itself: the first
   signed version cannot be auto-installed by today's ad-hoc installs — users
   do one final manual install.
4. **Certificate revocation is fatal, expiry is not** (§2.1 quotes). Protect
   the `.p12`; a leak → revocation → users cannot install anything signed with
   it, and notarization's audit trail is the mitigation
   (https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
5. **Notarize/staple order with ZIPs.** You cannot staple a ZIP; staple the
   `.app`, then zip (§2.2). electron-builder's `mac.notarize: true` handles
   the order; hand-rolled pipelines regularly get this wrong and produce apps
   that fail Gatekeeper offline.
6. **Hardened Runtime can break Electron if entitlements are dropped.**
   Notarization forces Hardened Runtime (§2.3); without
   `com.apple.security.cs.allow-jit` V8 JIT is disallowed, and without
   `com.apple.security.device.audio-input` mic capture dies — fatal for a
   speech-translation app. `@electron/osx-sign` defaults already include both
   (§2.3), so danger arises only when supplying custom entitlements files.
7. **App translocation** breaks self-update for apps launched from
   `Downloads`/DMG without being moved (read-only randomized mount, §2.4).
   PKG-to-/Applications (current setup) avoids it; if a DMG becomes the
   primary download, the "drag to Applications" step is load-bearing.
8. **Fuses vs signing order**: `EnableEmbeddedAsarIntegrityValidation` and
   `OnlyLoadAppFromAsar` are already flipped in `afterPack`, i.e. before
   signing — correct; flipping fuses after signing invalidates the signature.
9. **Per-arch asset naming**: `MacUpdater` distinguishes arm64 by looking for
   "arm64" in the file URL and applies Rosetta detection (§1.4). Keep
   electron-builder's default `${productName}-${version}-${arch}-mac.zip`-style
   names or at minimum keep "arm64" in the arm64 zip name.
10. **GitHub provider quirks**: version discovery parses the public
    `releases.atom` feed (§1.4) — a draft release is invisible (good), but a
    pre-release tag can be picked up by `allowPrerelease` logic; Sokuji's
    single-channel `vX.Y.Z` tagging is compatible as-is.
11. **Sequoia first-install policy** (§2.4) is a distribution problem
    signing+notarization fixes and nothing else does; it also makes Option C's
    first-install story steadily worse over OS releases.
12. **Root-owned install location defeats a correctly signed updater.**
    Squirrel.Mac's `SQRLInstaller` replaces the bundle with `rename()` as the
    invoking user and contains no `AuthorizationExecuteWithPrivileges` /
    `SMJobBless` path — when it does run as root it asserts that "the target must
    be the app bundle that contains this installer"
    (https://github.com/Squirrel/Squirrel.Mac/blob/master/Squirrel/SQRLInstaller.m).
    electron-builder invokes `pkgbuild` with no `--ownership` flag
    (`app-builder-lib/out/targets/pkg.js:215`), so the installed
    `/Applications/Sokuji.app` is root-owned and the update will fail at install
    time even with a valid Developer ID. See Option A step 3 for the fix.
13. **TCC permission thrash — the cost nobody logged.** Apple's guidance is
    explicit: "If your code is unsigned or signed ad hoc […] the system can't
    tell that version N+1 of your code is the same as version N, and thus you'll
    encounter excessive prompts"
    (https://developer.apple.com/forums/thread/730043). With no stable signing
    identity TCC keys on the code directory hash, and every Sokuji build
    produces a new one — so macOS users very likely re-grant microphone and
    system-audio-recording permission on *every* update today. A Developer ID
    signature fixes this as a side effect, arguably a bigger day-to-day win than
    the updater itself. (Unverified on hardware — see §6.)
14. **The existing SignPath arrangement does not extend to macOS.** SignPath
    (free for OSS, already used for the Windows Authenticode signature) can hold
    and use Apple keys through its macOS CryptoTokenKit provider, but it does
    **not** issue Apple certificates — the Developer ID certificate still has to
    come from a paid Apple Developer Program membership
    (https://docs.signpath.io/crypto-providers/macos). There is no OSS discount
    on the Apple side.

---

## 6. Open questions

1. **Enrollment identity**: individual (fast, personal name on the
   certificate) vs organization "Kizuna AI Lab" (legal-entity verification,
   D-U-N-S). Who holds the Account Holder role? (Only that role can create the
   Developer ID certificate, §2.1.)
2. **Keep PKG or move to DMG+ZIP?** electron-builder can emit
   `pkg`+`zip` or `dmg`+`zip`. Keeping PKG preserves the current
   BlackHole-driver install scripts (`pkg-scripts/`) and avoids translocation
   by construction; needs a check that a `zip`-installed update keeps whatever
   the PKG postinstall set up. This decision is coupled to failure mode 12: if
   the PKG stays, `postinstall` must chown the bundle to the console user, and
   that chown has to survive the *next* PKG run.
3. **Does the driver actually need reinstalling after a Squirrel update?**
   The driver lives outside the app bundle (`/Library/Audio/Plug-Ins/HAL/`), so
   replacing `Sokuji.app` should leave it untouched — but the app's presence
   check (`electron/macos-audio-utils.js:159`) and the unity-gain helper path
   need confirming against a bundle swapped in place rather than reinstalled.
4. **Do macOS users really lose microphone permission on each update today?**
   (failure mode 13) Apple's guidance says they should; nobody has confirmed it
   against a real install. Worth checking before pricing the $99 decision,
   because it may be the larger of the two benefits.
5. **Option C verification** (worth doing regardless, since Option C is the
   zero-cost interim): confirm
   on real hardware that a PKG downloaded via Node `https` in the packaged app
   carries no `com.apple.quarantine` and that Installer.app opens it without
   Gatekeeper interference on Sequoia/Tahoe.
6. **Windows parity**: mac work would leave Windows as the only platform on
   the manual `_downloadUpdate()` path (Forge Squirrel.Windows output is not
   electron-updater-compatible, per the comment in
   `electron/update-manager.js`) — worth a separate look at NSIS-via-
   electron-builder to unify, since SignPath signing already exists.
7. **First signed release migration note**: users on ≤ current ad-hoc builds
   must manually install the first signed version (failure mode 3); the
   release notes for that version should say so.
