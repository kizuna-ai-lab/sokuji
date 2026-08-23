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

**Yes — and it does not require paying Apple.** True in-app auto-update
(download + silent install + relaunch, like Chrome/VS Code) is achievable with a
**locally created self-signed code-signing certificate**, because what
Squirrel.Mac actually demands is a *stable* signature, not an *Apple* one. See
§2.5, which is the section to read if you read only one.

Three things stand in the way today, and all three must go:

1. **The signature is ad-hoc, so it is not stable.** Squirrel.Mac (the engine
   under both Electron's built-in `autoUpdater` and `electron-updater`'s
   `MacUpdater`) verifies each downloaded update against the *running* app's
   code-signing designated requirement (DR). An ad-hoc signature's DR is a
   per-build cdhash, so it can never match. A **self-signed certificate**, by
   contrast, yields a DR of the form
   `identifier "…" and certificate root = H"…"`, which is identical across
   rebuilds — and Squirrel does **not** require a trusted anchor. Cost: $0.
   (§1.3, §2.5, §5.1)
2. **No `.zip` asset is published.** `MacUpdater` accepts only a zip and
   explicitly rejects `pkg`/`dmg`; today's releases ship PKGs only, so even a
   correctly signed build would fail with `ERR_UPDATER_ZIP_FILE_NOT_FOUND`.
   (§1.4)
3. **`/Applications/Sokuji.app` is root-owned.** The PKG installs it as root,
   and Squirrel's installer runs as the invoking user with **no** privilege
   escalation, so it likely cannot replace that bundle. Fixing 1 and 2 without
   fixing this produces an updater that downloads correctly and then fails to
   install. (failure mode 12)

What the money does and does not buy:

- **Auto-update does not need the USD 99.** A self-signed certificate satisfies
  Squirrel.Mac and — very probably — TCC, so microphone permission would also
  stop resetting on every update (§2.5c; this specific point still needs one
  hardware test).
- **First-install friction does need it.** Gatekeeper requires *notarization*,
  which requires the paid membership. No certificate of your own, and no
  updater, changes the first-run experience: the `sudo xattr -d
  com.apple.quarantine` step stays. The realistic mitigations there are a
  Homebrew tap or a documented `curl` installer (§4.4), not a code change.
- Everything else that gets suggested — Sparkle, `update.electronjs.org`, the
  free Apple tier, the nonprofit fee waiver — either requires the same money or
  buys nothing over the self-signed route. See "What does NOT work".

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

### 2.5 The self-signed certificate route — auto-update for $0

This is the finding that changes the decision. Squirrel.Mac needs a signature
that is **stable and self-consistent**, not one that chains to Apple. A
certificate you generate yourself provides exactly that.

#### 2.5a Verification does not require a trusted anchor

Apple's Code Signing Guide, [Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html):

> "The simple act of code signing does not require a certificate authority's
> signature on your certificate…"

> "Except for the explicit `anchor trusted` requirement, the system does not
> consult its trust settings database when verifying a code requirement.
> Therefore, as long as you don't add this designated requirement to your code
> signature, **the anchor certificate you use for signing your code does not
> have to be introduced to the user's system for validation to succeed.**"

Confirmed in Apple's open-source Security implementation. `CSCommon.h`
documents the flag as opt-in, and says what the default is:

```c
kSecCSCheckTrustedAnchors = 1 << 27, /* build certificate chain to system trust
                                        anchors, not to any self-signed certificate */
```

and `StaticCode.cpp`'s `verifySignature` installs an *empty* anchor set unless
that flag is passed. Squirrel.Mac passes
`kSecCSCheckNestedCode | kSecCSStrictValidate | kSecCSCheckAllArchitectures`
(§1.3) — `kSecCSCheckTrustedAnchors` is **absent**. Gatekeeper is the subsystem
that does demand a trusted anchor, and it only engages on quarantined files.

#### 2.5b The DR is stable across rebuilds

Apple's DR generator (`drmaker.cpp`) branches on whether there is a certificate
at all:

```cpp
// we can't make an explicit DR for a (proposed) ad-hoc signing because that
// requires the CodeDirectory (which we ain't got yet)
if (ctx.certCount() == 0) return NULL;
```

With a certificate it emits `identifier <id> and <anchor hash>`; `isAppleCA()`
is false for a self-signed cert, so it takes the `nonAppleAnchor()` branch and
pins the SHA-1 of the cert. The result reads:

```
designated => identifier "ai.kizunaai.sokuji" and certificate root = H"<sha1 of your cert>"
```

Ad-hoc takes the other path — `StaticCode.cpp` returns "a cdhash requirement for
all architectures", which is why today's builds can never validate each other.
TN3127 puts it in prose: "Ad hoc signed code… has a DR but it's tied to that
specific version of the code."

**So a rebuild signed with the same certificate and identifier satisfies the
previous build's DR, and Squirrel.Mac installs it.**

#### 2.5c TCC very likely stops re-prompting too

TN3127 describes the mechanism using *microphone* as its own example:

> "macOS solves this problem by recording your app's DR in its database of apps
> authorized to access the microphone. Each time your app tries to access the
> microphone, macOS checks that this version of the app satisfies the original
> DR."

A self-signed certificate produces a stable DR (§2.5b), so the recorded DR keeps
matching. **Caveat, stated honestly:** no Apple document says outright that TCC
accepts a non-Apple certificate — Apple engineers recommend Apple Development /
Developer ID identities simply because that is what developers have. This is
inference from a verified mechanism, and it is hardware test #1.

#### 2.5d What it costs you

- Apple's guidance says **"Do not ship apps signed by self-signed
  certificates."** The stated reason is that it proves nothing about authorship
  to the user — which costs Sokuji nothing here, because without notarization
  the app already proves nothing to Gatekeeper either. This is a real
  "against Apple's advice" call, made with eyes open, not a loophole: nothing
  is hidden from the user and Gatekeeper still behaves exactly as before.
- **First install is completely unchanged** — Gatekeeper wants notarization.
- **Certificate rotation resets everything**: a new cert means a new DR, which
  breaks the update chain *and* re-prompts TCC. Issue it with a very long
  validity and back it up carefully — this becomes a project secret on par with
  the signing key itself. Expired certs still *verify* (the engine accepts
  signatures made with expired certificates) but `codesign` refuses to *sign*
  with one.
- **Hardened runtime and entitlements are not needed** — those are notarization
  requirements. Skip them.
- **Pin the DR explicitly** with `codesign -r` rather than relying on the
  `nonAppleAnchor()` organization-field heuristic. Do not hand-write the
  requirement: dump the generated one with `codesign -d -r-` and reuse it
  verbatim.

#### 2.5e electron-builder already supports non-Apple identities

`app-builder-lib/out/codeSign/macCodeSign.js:234-250` has an explicit fallback:
when no "Developer ID Application" identity is found it searches for a
*non-Apple* certificate, skipping every Apple prefix. That path exists because
of electron-builder issue #458 — signing with a self-signed certificate is a
supported configuration, not a hack.

Two CI details to watch:

- `createKeychain` (`:120`) runs `security import` but **never**
  `security add-trusted-cert`, and identity discovery uses
  `security find-identity -v -p codesigning` — "-v" meaning valid. Whether a
  self-signed leaf lists as valid without an explicit trust setting is hardware
  test #6; if not, add `security add-trusted-cert -d -r trustRoot -k <keychain>`
  before the build.
- `kSecCSCheckNestedCode | kSecCSStrictValidate` means **all** nested Mach-O
  must be signed with the same identity — including
  `Contents/Resources/resources/drivers/SokujiVirtualAudio.driver`, a universal
  binary currently built with `CODE_SIGNING_REQUIRED=NO`. Code living under
  `Resources/` is also exactly what strict validation dislikes. This is a
  prerequisite for *any* signing route, paid or free.

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

**Ranking note:** Option S is the recommendation as of the decision not to pay
Apple. Option A is the same work with a Developer ID instead of a self-signed
certificate, and remains the answer if first-install friction is ever judged
more important than the $99.

### Option S (recommended, $0): self-signed certificate + the existing `electron-updater` stack

Identical in shape to Option A below, with the Developer ID and notarization
steps replaced by a certificate you issue yourself (§2.5). Concretely:

1. **Certificate**: Keychain Access → Certificate Assistant → Create a
   Certificate → **Self Signed Root** + **Code Signing**, "Let me override
   defaults", with a very long validity. Export as `.p12`. Treat it as a
   permanent project secret — rotating it breaks the update chain and resets
   TCC (§2.5d).
2. **CI**: store as `CSC_LINK` (base64 `.p12`) + `CSC_KEY_PASSWORD`. Drop
   `CSC_IDENTITY_AUTO_DISCOVERY: false` and `mac.identity: null`; set
   `mac.identity` to the certificate's common name. Do **not** set
   `mac.notarize`. Add `security add-trusted-cert` before the build if hardware
   test #6 says it is needed (§2.5e).
3. **Signing**: replace the ad-hoc `codesign --force --deep --sign -` in
   `scripts/electron-builder-fuses.js` with electron-builder's normal
   inside-out signing, and sign the HAL driver with the same identity (§2.5e).
   Pin the DR with `codesign -r` using a requirement dumped from
   `codesign -d -r-`.
4. **Artifacts**: add `zip` alongside `pkg` in `build.mac.target` — required by
   `MacUpdater`, and it makes `latest-mac.yml` machine-generated (§0).
5. **Ownership**: resolve per hardware test #2 — either `pkgbuild --ownership
   preserve` / a `chown` in `pkg-scripts/postinstall`, or drag-install.
6. **App**: delete the darwin refusal branches at `update-manager.js:99-113`
   and `:194-196` and let darwin share the AppImage path.
7. **Driver**: version-gate `SokujiVirtualAudio.driver` so the privileged step
   only runs when it actually changes (it has not changed since 2025-09-17).

Migration is clean: darwin auto-update is disabled today, so users already
install manually. They do that **one more time** — the release that carries the
self-signed bundle and the ownership fix — and are automatic from then on.

### Option A (same work, $99/yr): Developer ID + notarization + a mac ZIP

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

### Option D (superseded by Option S): Sparkle with EdDSA keys

Sparkle genuinely does not need an Apple account — but neither does Option S,
which reuses a stack this repo already ships. Recorded here for completeness.

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

- `electron-updater` with unsigned or **ad-hoc** builds — see §5.1. Note the
  distinction that matters: this is a statement about ad-hoc signing, *not*
  about the absence of an Apple certificate. A self-signed certificate works
  (§2.5).
- update.electronjs.org / `update-electron-app` without signing — requirement
  is explicit ("Your builds are code signed (macOS and MSIX only)"):
  https://github.com/electron/update-electron-app,
  https://github.com/electron/update.electronjs.org. (Unverified whether their
  check would accept a self-signed cert; moot, since Option S needs no service.)
- Any "disable verification" flag: none exists in `MacUpdater` (no signature
  code at all on mac, §1.4) and none can exist without forking Electron's
  bundled Squirrel.Mac (§1.3).
- The existing free SignPath arrangement, which is Windows-only in practice —
  see failure mode 14.
- **Nothing free fixes first install.** The free Apple tier lists
  "Notarization & Developer ID" under the paid tier only, and the fee waiver
  requires being "a legal entity with a status as a nonprofit organization,
  accredited educational institution, or government entity" —
  https://developer.apple.com/support/membership-fee-waiver/ — which a
  for-profit company cannot satisfy. There is no Apple open-source signing
  programme.

### 4.4 First-install friction — the part no certificate fixes

Gatekeeper wants notarization, so the `sudo xattr -d com.apple.quarantine` step
survives every option on this page. What can legitimately reduce it:

- **A Homebrew tap.** Homebrew Cask's current
  `Library/Homebrew/cask/quarantine.rb` hardcodes
  `check_quarantine_support → [:quarantine_unavailable, nil]`, so `available?`
  can never be true and **casks are not quarantined at all**; correspondingly
  `--no-quarantine` no longer appears in the manpage. A third-party tap
  (`brew tap kizuna-ai-lab/sokuji`) is a supported path and sidesteps
  homebrew-cask's acceptability rules. The HAL driver still needs root, so the
  cask would carry a `pkg` stanza and prompt once. *(Which Homebrew release
  changed this was not pinned down — verify before publishing.)*
- **A documented `curl` installer.** Quarantine is applied by the downloading
  application by design, and CLI tools deliberately do not set it, so a script
  the user reads and runs installs without the xattr dance. This is the same
  security posture the install docs already ask for, with fewer steps — but say
  plainly in the docs that it bypasses Gatekeeper, and publish checksums.

What not to do: ship anything that silently strips quarantine from a
browser-downloaded file. The user should always be the one deciding to bypass.

### Recommended sequence

1. **Run hardware tests #1 and #2** (§6). They are cheap, and between them they
   decide whether Option S delivers silent updates outright or needs an
   ownership fix first.
2. **Ship Option S.** One more manual install for existing macOS users, then
   parity with Linux AppImage — for $0.
3. **Separately, decide what to do about first install** (§4.4). It is a
   distribution/docs problem, not an updater problem, and the only complete fix
   is the $99.

Option C (in-app PKG download + launch Installer) is still worth knowing about
as a fallback if Option S fails a hardware test — it is ~40 lines and removes
the browser and Terminal from the update loop without any certificate at all.

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

   **But note what this is and is not.** That in-code comment says macOS builds
   "are unsigned (no Apple Developer ID), so electron-updater cannot apply the
   update — Squirrel.Mac requires the new bundle to share a valid Developer ID
   signature with the running one". The first half is right; the "Developer ID"
   part is not. Squirrel requires a *shared, stable* signature, and any
   certificate — including a self-signed one — supplies that (§2.5). Worth
   correcting in the source comment when Option S lands.
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
12a. **Never modify a bundle in place.** Apple has a document for exactly this
    failure — [Updating Mac Software](https://developer.apple.com/documentation/security/updating-mac-software),
    subtitled "Implement Mac software updates without causing code-signing
    crashes": "macOS caches information about the code's signature in the
    kernel. It doesn't flush that cache when you modify the file's contents.
    Modifying the file in place yields a mismatch… which can cause a
    hard-to-reproduce code-signing crash", and it applies to "executables,
    frameworks, dynamic libraries, and **bundles**". The fix is write-to-temp
    plus `rename(2)`: "the in-kernel cache is associated with the old file,
    which remains unmodified." Squirrel does this correctly; any hand-rolled
    updater must too. Related trap: `ditto` *merges* into an existing directory
    rather than replacing it, leaving stale files that then fail
    `kSecCSStrictValidate` — always extract to a fresh staging directory and
    swap.
12. **Root-owned install location defeats a correctly signed updater.**
    Squirrel.Mac's `SQRLInstaller` replaces the bundle with `rename()` as the
    invoking user and contains no `AuthorizationExecuteWithPrivileges` /
    `SMJobBless` path — when it does run as root it asserts that "the target must
    be the app bundle that contains this installer"
    (https://github.com/Squirrel/Squirrel.Mac/blob/master/Squirrel/SQRLInstaller.m).
    electron-builder invokes `pkgbuild` with no `--ownership` flag
    (`app-builder-lib/out/targets/pkg.js:215`), so the installed
    `/Applications/Sokuji.app` is root-owned.

    The precise mechanics are worth getting right, because they decide how much
    work this is. `/Applications` is **not** SIP-protected (Apple's System
    Integrity Protection Guide lists it under "Locations Available to
    Developers") and is mode 0775 `root:admin` with no sticky bit, so an admin
    user can write *in* it. But `rename(2)`'s CONFORMANCE section adds a
    directory-specific restriction — "This restriction has been generalized to
    disallow renaming of any **write-disabled directory**, even when this would
    not require a change to the `..` entry" — which suggests a root-owned
    `drwxr-xr-x Sokuji.app` cannot be renamed by an admin user even though its
    parent is writable. The man page says nothing about APFS, so this is
    hardware test #2. If it holds, the fix is `pkgbuild --ownership preserve`
    (Apple's documented escape hatch for special ownership requirements) or a
    `chown` to the console user in `pkg-scripts/postinstall`. User-owned apps in
    `/Applications` are unremarkable — Brave, Cursor and Firefox all install
    that way.

    Not a problem: Ventura's App Management protection applies to *notarized*
    apps, which Sokuji is not, and `NSUpdateSecurityPolicy` exists precisely to
    let same-developer updaters modify a bundle.
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

## 6. Hardware tests (all need a Mac; ranked by what they decide)

Everything in §2.5 was verified by reading Apple's own Security sources, but
reading source is not running it. These are ordered so the two that could sink
Option S come first.

**Tests 2–6 are scripted** in `scripts/verify-macos-selfsigned.sh` — run it on
any Mac, or from a `macos-26` CI job. Test 1 needs a human, because granting
microphone access requires clicking the dialog.

1. **Does TCC keep microphone permission across a rebuild signed with the same
   self-signed certificate?** Sign two builds with one cert, grant mic access to
   the first, install the second, check for a re-prompt. Decides whether Option S
   fixes the permission thrash or merely the updater (§2.5c).
2. **Can an admin user rename a root-owned, write-disabled directory inside
   `/Applications` on APFS?** `sudo mkdir /Applications/T.app && mv
   /Applications/T.app /Applications/T2.app` as a normal admin user. Decides
   whether the ownership fix is needed at all (failure mode 12).
3. **Does Squirrel.Mac accept the self-signed DR end to end?** Run a real update
   cycle between two self-signed builds. The source says yes (§2.5b); confirm.
4. **`xattr -l` a Node-downloaded artifact** → expect no `com.apple.quarantine`
   (gates Option C, and confirms §2.4's reasoning).
5. **Does `security find-identity -v -p codesigning` list the self-signed cert as
   valid** in a fresh CI keychain without `add-trusted-cert`? (§2.5e)
6. **Does the whole bundle pass `codesign --verify --deep --strict` once the HAL
   driver is signed with the same identity?** `kSecCSCheckNestedCode |
   kSecCSStrictValidate` is what Squirrel will apply (§2.5e).

## 7. What happens to macOS users who already installed

Three changes are on the table — a new app signature, a signed driver, and
(optionally) a newer BlackHole. They carry very different risk, and they should
not ship together.

### 7.1 Changing the app signature: ad-hoc → self-signed — low risk

- **The transition build must be installed by hand.** Its DR does not match the
  installed ad-hoc build, so no updater could apply it. This costs nothing:
  darwin auto-update is disabled today, so users already install every release
  by hand. One more time, then never again.
- **Microphone / system-audio permission: one more prompt.** The code identity
  changes, so TCC sees a new app. This already happens on *every* update today
  (failure mode 13), so it is not a regression — and after the transition it
  should stop, which is the point. Watch for the known stale-row case where
  System Settings shows the app as allowed but access is denied at runtime; the
  fix is `tccutil reset Microphone ai.kizunaai.sokuji` or toggling the checkbox.
  Worth a line in that release's notes.
- **Sign-in state survives.** `EnableCookieEncryption` is on, so Chromium keeps a
  "Safe Storage" key in the login keychain whose ACL is bound to the code
  identity — and TN2206 names the keychain as a DR-based subsystem, so a changed
  identity can prompt or reset the encrypted cookie store. But better-auth's
  session does **not** live there: `electron/better-auth-adapter.js:4` puts the
  cookie jar in `electron-conf`, a plain file under the app's userData. Users
  stay logged in. And as with TCC, today's ad-hoc builds already churn this key
  on every single build, so a stable certificate makes it better, not worse.
- **Ownership change** (if the PKG starts chowning the bundle) is invisible to
  the user.
- **Gatekeeper is unchanged.** The PKG is still not notarized, so the
  `xattr` step stays exactly as it is today.

### 7.2 Signing the driver — safe, and required anyway

The device UID is a compile-time macro. Upstream `BlackHole.c` defines:

```c
#define kDriver_Name         "BlackHole"     // overridden to "SokujiVirtualAudio"
#define kDriver_Name_Format  "%ich"
#define kDevice_UID          kDriver_Name kDriver_Name_Format "_UID"
#define kNumber_Of_Channels  2               // passed explicitly by our build script
```

and the shipped binary confirms the resulting literals —
`SokujiVirtualAudio%ich_UID`, `SokujiVirtualAudio%ich_2_UID`,
`SokujiVirtualAudio%ich_ModelUID` — which resolve at runtime to
**`SokujiVirtualAudio2ch_UID`** and friends.

Code signing adds a `_CodeSignature` directory and a signature blob. It changes
**no string constant**, so the device UID, the device name and the bundle ID all
stay put. Every app that has "SokujiVirtualAudio" selected as its microphone —
Zoom, Meet, Teams — keeps that selection. Signing the driver is safe.

It is also not optional: `kSecCSCheckNestedCode | kSecCSStrictValidate` covers
the copy inside the app bundle at
`Contents/Resources/resources/drivers/SokujiVirtualAudio.driver` (§2.5e).

*Cleaner alternative worth considering:* move the driver out of the app bundle
entirely and ship it as a separate PKG payload. Code under `Resources/` is
precisely what strict validation is unhappy about, and the app only ever uses
that copy as installer payload — nothing loads it from there.

### 7.3 Bumping the BlackHole version — the actually risky one, and unnecessary

Do not fold this into the signing change. It is a separate decision with its own
failure modes, and nothing about auto-update requires it — the driver has been
frozen at BlackHole 0.6.1 / build 596 since 2025-09-17 and works.

- **The device UID could change.** It is derived from `kDriver_Name` plus the
  channel count. Our build script pins both, so a straight version bump should
  keep `SokujiVirtualAudio2ch_UID` — but if upstream ever reshapes the
  `kDevice_UID` macro, or if the channel count changes, the UID changes with it.
  The symptom is nasty and silent: every app that had the device selected falls
  back to its default, and users report "translation audio stopped reaching
  Zoom" with nothing in our logs. Diff the macros before bumping.
- **`killall coreaudiod` interrupts audio system-wide**, in every running app.
  The PKG does this on every install today. Doing it mid-meeting is bad; a
  driver update should be something the user opts into, not a side effect.
- **Auto-update will not carry the driver.** Squirrel replaces the app bundle;
  `/Library/Audio/Plug-Ins/HAL/` is outside it and needs root. So once Option S
  ships, an app update and a driver update are different events — and nothing
  currently detects the skew, because no code reads the driver's
  `Contents/Resources/VERSION`. Add that version check *before* you ever need to
  bump the driver, not after.

## 8. Open questions

1. **Certificate custody.** A self-signed root becomes a permanent project
   secret: losing or rotating it breaks the update chain for every existing
   install and resets TCC (§2.5d). Where does it live, who holds the backup, and
   what is the recovery plan if it leaks? This is the main *governance* cost of
   Option S, and it is not zero even though the dollar cost is.
2. **Enrollment identity** (only if the $99 is ever reconsidered for
   first-install friction): individual vs organization "Kizuna AI Lab"
   (legal-entity verification, D-U-N-S). Who holds the Account Holder role?
   (Only that role can create the Developer ID certificate, §2.1.)
3. **Keep PKG or move to DMG+ZIP?** electron-builder can emit
   `pkg`+`zip` or `dmg`+`zip`. Keeping PKG preserves the current
   BlackHole-driver install scripts (`pkg-scripts/`) and avoids translocation
   by construction; needs a check that a `zip`-installed update keeps whatever
   the PKG postinstall set up. This decision is coupled to failure mode 12: if
   the PKG stays, `postinstall` must set the ownership, and that has to survive
   the *next* PKG run.
4. **Does the driver actually need reinstalling after a Squirrel update?**
   The driver lives outside the app bundle (`/Library/Audio/Plug-Ins/HAL/`), so
   replacing `Sokuji.app` should leave it untouched — but the app's presence
   check (`electron/macos-audio-utils.js:159`) and the unity-gain helper path
   need confirming against a bundle swapped in place rather than reinstalled.
5. **Windows parity**: mac work would leave Windows as the only platform on
   the manual `_downloadUpdate()` path (Forge Squirrel.Windows output is not
   electron-updater-compatible, per the comment in
   `electron/update-manager.js`) — worth a separate look at NSIS-via-
   electron-builder to unify, since SignPath signing already exists.
6. **First signed release migration note**: users on today's ad-hoc builds
   cannot auto-install the first self-signed version (DR mismatch, failure
   mode 3). Since darwin auto-update is disabled today this costs nothing in
   practice, but the release notes for that version should say so.
