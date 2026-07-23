# Windows Sandbox Crash Self-Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect Chromium sandbox startup crashes on Windows caused by orphaned AppContainer SID ACEs, guide the user through a permission repair, and provide a `--no-sandbox` fallback — all user-confirmed, all Windows-gated. (issue #352)

**Architecture:** A single self-contained module `electron/sandbox-recovery.js` holds all logic (pure parsers + state-machine deciders + dependency-injected side-effect helpers + electron orchestration). `electron/main.js` gets exactly three wiring points. Everything is gated on `process.platform === 'win32'`; other platforms are untouched.

**Tech Stack:** Node CommonJS (electron main), `child_process.execFileSync('icacls', ...)`, vitest for tests.

## Global Constraints

- Windows-only: every exported orchestration function early-returns on non-win32; no behavior change elsewhere.
- No silent mutation: every ACL write and every sandbox downgrade happens only after a user clicks a dialog button.
- Confirmation requires the ACL scan, not just the crash signature. Never offer Repair when the scan is clean.
- Orphan SID regex: `/S-1-15-2(?:-\d+){6,}/` — excludes legit `S-1-15-2-1` / `S-1-15-2-2`. Match SIDs only, never localized account names.
- Never use `icacls /reset` or `icacls /save`. Repair is precise `/remove "*<SID>"` only, with a text backup log first.
- icacls output decoded as `latin1` (byte-safe) and processed line-by-line; only ASCII SID + flag tokens are extracted.
- Dialog copy is English (matches `vb-cable-installer.js` precedent). Do not wire renderer i18n into main.
- Correctness gate is vitest, NOT tsc (repo has ~113 pre-existing tsc errors). Do not break the existing 1380+ tests.
- English-only comments/docs; conventional commits.

## File Structure

- **Create** `electron/sandbox-recovery.js` — all logic.
- **Create** `electron/sandbox-recovery.test.js` — vitest unit tests (runs on Linux + Windows; no real icacls, deps injected).
- **Create** `electron/__fixtures__/icacls-*.txt` — real-shaped icacls output fixtures (or inline fixtures in the test).
- **Modify** `electron/main.js` — three wiring points only.

## Module API (`electron/sandbox-recovery.js`)

Pure (no electron, no I/O):
- `parseIcaclsAces(text) -> Array<{sid, inherited}>`
- `findExplicitOrphanSids(text) -> string[]` (unique, non-inherited orphan SIDs)
- `isGpuSandboxCrash(details) -> boolean` (type GPU + reason crashed|abnormal-exit + exitCode -2147483645|2147483651)
- `evaluateCrashRelaunch(existingMarker, now, appVersion, opts?) -> {marker, shouldRelaunch}` (1h window, max 2 auto-relaunch)
- `evaluateNoSandbox(marker, currentVersion) -> {noSandbox, clearMarker}`
- `buildBackupLog(scanResults, isoStamp) -> string`

Dependency-injected side effects (deps = {fs, execFileSync, now, env, log}):
- `scanDirectory(dir, deps) -> {dir, sids, rawOutput, error}`
- `repairDirectory(dir, sids, deps) -> {dir, removed, errors}`
- `getScanDirectories(app, env) -> string[]`
- `readJsonFile(fs, path)`, marker read/write/delete helpers

Electron orchestration (app/dialog passed in; win32-gated):
- `applyNoSandboxFlag(app, options?) -> boolean` — wiring #1 (top of main.js)
- `registerCrashDetection(app, options?)` — wiring #3 (top of main.js)
- `handleRecoveryMode(app, dialog, options?) -> boolean` (proceedToCreateWindow) — wiring #2 (whenReady, before createWindow)

Constants: `CRASH_MARKER = 'sandbox-crash-marker.json'`, `FALLBACK_MARKER = 'no-sandbox-fallback.json'`, `ISSUE_URL`.

---

### Task 1: icacls parser + orphan detection (pure)

- [ ] Write failing tests for `parseIcaclsAces` / `findExplicitOrphanSids` using fixtures: clean dir, inherited `(I)` orphan, explicit orphan, legit named `S-1-15-2-1`/`S-1-15-2-2` raw SID lines, non-English locale account name with explicit orphan SID.
- [ ] Run → fail (not defined).
- [ ] Implement parser (line split, orphan SID regex, trailing-flags extraction, `(I)` exact-group inheritance check).
- [ ] Run → pass.
- [ ] Commit.

### Task 2: crash signature + state machines (pure)

- [ ] Write failing tests for `isGpuSandboxCrash` (signed/unsigned exit codes, wrong type/reason rejected), `evaluateCrashRelaunch` (window filtering, 2-relaunch cap, null marker), `evaluateNoSandbox` (no marker / same version / changed version).
- [ ] Run → fail.
- [ ] Implement the three deciders.
- [ ] Run → pass.
- [ ] Commit.

### Task 3: scan/repair/backup with injected deps

- [ ] Write failing tests: `scanDirectory` parses mocked execFileSync output + handles thrown error; `repairDirectory` builds `['<dir>','/remove','*<sid>']` args and records errors; `buildBackupLog` includes dirs, SIDs, raw output, issue URL.
- [ ] Run → fail.
- [ ] Implement.
- [ ] Run → pass.
- [ ] Commit.

### Task 4: orchestration (applyNoSandboxFlag / registerCrashDetection / handleRecoveryMode) with mock app+dialog

- [ ] Write failing tests: non-win32 no-op; applyNoSandboxFlag appends switch on same-version marker, clears on changed; registerCrashDetection writes marker + relaunch on first GPU crash, no relaunch past cap; handleRecoveryMode returns true when no marker, confirmed path (repair success → relaunch, repair fail → fallback dialog), unconfirmed path offers no repair, continue-no-sandbox writes fallback marker.
- [ ] Run → fail.
- [ ] Implement orchestration + dialog helpers (`showMessageBoxSync`, `noLink:true`).
- [ ] Run → pass.
- [ ] Commit.

### Task 5: main.js wiring (3 points)

- [ ] Add `const sandboxRecovery = process.platform === 'win32' ? require('./sandbox-recovery') : null;` near top requires.
- [ ] After appendSwitch block (line ~84): `applyNoSandboxFlag(app)` + `registerCrashDetection(app)`.
- [ ] whenReady top: `if (sandboxRecovery && !sandboxRecovery.handleRecoveryMode(app, dialog)) return;`
- [ ] Run full vitest suite → green.
- [ ] Commit.

### Task 6: Windows E2E (isolated dir), then PR

- [ ] `npm run package`, copy output to `C:\SokujiSandboxTest\`, inject orphan ACE on that dir only, verify crash→relaunch→confirmed dialog→repair→clean sandbox launch; then unconfirmed, no-sandbox fallback, version regression. Clean up.
- [ ] Push branch, open PR referencing #352 + upstream electron#51761.
