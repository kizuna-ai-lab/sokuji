# Switch to the Node Engine and Delete Python Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In one PR, ship the native libraries inside the app, launch the TypeScript engine in an Electron utilityProcess instead of the Python sidecar, and delete the Python sidecar with everything that built, downloaded and launched it.

**Architecture:** Main keeps its IPC contract (`native-host:start|stop|status`, `sidecar-bundle:*`) so the renderer is untouched. `native-host:start` forks `dist-electron/engine.js` as a utilityProcess, which reports its port over `parentPort`. Each build job fetches the pinned native archive for its own platform into `resources/native/`, which both packagers already copy as extra resources and sign with the app.

**Tech Stack:** Electron 44 `utilityProcess`, the existing Vite main-process build, electron-builder (macOS, Linux), Electron Forge (Windows), `fzstd` + `tar-stream` (already dependencies), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-23-sidecar-without-python-design.md` (§6.1, §6.5, §8, §9 phase 4). Consumes plan 1's archives (`manifest.json` layout) and plan 2's `startEngine`.

## Global Constraints

- The renderer does not change in this plan. IPC channel names, reply shapes and the WebSocket protocol stay as they are.
- `native-host:start` resolves `{ ok: true, port }` or `{ ok: false, error }` (today's shape). Every engine-level failure (unsupported platform, addon load failure, three crashes within 60 s) arrives through `{ ok: false, error }`.
- `sidecar-bundle:status` answers `{ status: 'ready', sku, version: <nativeVersion> }`, or `{ status: 'unsupported' }` where `detectSku()` returns null; `install`, `cancel` and `remove` answer `{ ok: true }` and do nothing; `manifest` answers `{ ok: true, manifest: null }`; `usage` answers `{ ok: true, bytes: 0 }`. (Plan 5 of the spec's rollout, the renderer cleanup, removes them later.)
- Native files live in `resources/native/` in the repo checkout (git-ignored) and at `<process.resourcesPath>/resources/native/` in packaged apps. `sk_init`'s `module_dir` is that directory.
- The archive version is pinned by `package.json` `nativeVersion` and the sha256 per SKU in `scripts/native-archives.json`; a build fails on a mismatch.
- WebSocket origins allowed by the engine: the dev server's `http://localhost:5173`, and the packaged renderer's origin as measured in Task 1 (expected `file://`). `null` is never allowed.
- Testers' models in `userData/hf-cache` stay; `HF_HOME` defaults to it exactly as today. `userData/sidecar/` is deleted once, on first launch of the new version.
- The Electron fuses stay as they are (`RunAsNode=false`, `OnlyLoadAppFromAsar=true`).
- This is one PR. Before it opens, its branch is built on all five platforms with a manual `build.yml` run, and the maintainer approves pushing the branch, running the workflow and opening the PR, each named with repo and branch.

## Review Focus

1. **A packaged app on macOS loads unsigned-looking files from `Resources`** (notarization passes but Gatekeeper or library validation refuses a dylib at run time). Expected: the engine starts on a notarized build on a real Mac. Pinned in Task 6 (Mac verification step).
2. **The engine crashes repeatedly** (a bad driver aborts on every load). Expected: after three crashes in 60 s, `native-host:start` answers `{ ok: false, error: 'The local engine stopped unexpectedly three times...' }` and stops respawning until the app restarts. Pinned in Task 2.
3. **The app quits while the engine is busy** (a TTS stream, a download). Expected: quit is not delayed by more than 2 s and no orphan engine process remains. Pinned in Task 2 (`stop kills after 2 s`) and Task 6 (manual check per platform).
4. **A user upgrades from a build that had the Python bundle installed.** Expected: first launch removes `userData/sidecar/` (hundreds of MB) without blocking startup; models in `hf-cache` are untouched. Pinned in Task 4.
5. **Windows on ARM or another unsupported platform.** Expected: `sidecar-bundle:status` answers `unsupported` and `native-host:start` answers an error, as today. Pinned in Task 4.

---

## File Structure

| Path | Change |
|---|---|
| `electron/engine/entry.ts` | Create: utilityProcess entry; reads its env, calls `startEngine`, talks to main over `parentPort` |
| `electron/engine-host.js` (+ test) | Create: `EngineHost` — fork, handshake, watchdog, crash budget, stop |
| `electron/native-dir.js` (+ test) | Create: `resolveNativeDir({ isPackaged, resourcesPath, env, repoRoot })` |
| `electron/main.js` | Modify: use `EngineHost`; stub the `sidecar-bundle:*` handlers; first-run cleanup |
| `vite.config.ts` | Modify: add entries `engine` (`electron/engine/entry.ts`), `engine-host`, `native-dir`; drop `native-host-manager`, `sidecar-bundle` |
| `scripts/fetch-native.mjs` (+ test), `scripts/native-archives.json` | Create: download, verify and unpack the pinned archive into `resources/native/` |
| `package.json` | `nativeVersion` added, `sidecarVersion` removed, `fetch:native` script |
| `.gitignore` | `resources/native/` |
| `.github/workflows/build.yml` | Fetch native per build job; extend the macOS signature check; drop `sidecar-tests`; e2e job fetches native |
| `.github/workflows/native-build.yml` | Release job stops attaching wheels |
| `src/lib/local-inference/native/nativeProtocol.consistency.test.ts` | Read `electron/engine/wire_schema.json` and the TS handlers |
| Deleted | `sidecar/`, `electron/native-host-manager.js` (+ test), `electron/sidecar-bundle.js` (+ test), `scripts/build-sidecar-bundle.py`, `scripts/sidecar-bundle-smoke.py`, `.github/workflows/sidecar-bundles.yml`, `electron/engine/test/schemaCopy.test.ts`, `sidecar/tools/*` |
| `CLAUDE.md`, `native/README.md`, `docs/` pages that describe the sidecar | Rewrite the sidecar sections for the Node engine |

`electron/sidecar-sku.js` stays (`detectSku()` still decides "unsupported").

---

### Task 1: Engine entry and the packaged renderer's origin

**Files:**
- Create: `electron/engine/entry.ts`, `electron/engine/entry.test.ts`, `electron/engine/deadline.ts`, `electron/engine/deadline.test.ts`
- Modify: `vite.config.ts` (entry `engine`); the ASR, translate and TTS backends from plan 2 (wrap their native calls)

**Interfaces:**
- Consumes: plan 2's `startEngine`.
- Produces: the parentPort protocol, both directions plain objects:
  - engine → main: `{ type: 'ready', port }`, `{ type: 'failed', error }`, `{ type: 'log', level, message }`, `{ type: 'pong', seq }`, `{ type: 'stuck', job }` (a job passed its deadline).
  - main → engine: `{ type: 'ping', seq }`, `{ type: 'stop' }` (close the server, unload models, `process.exit(0)`).
  - env read by the entry: `SOKUJI_NATIVE_DIR`, `SOKUJI_ENGINE_ORIGINS` (comma-separated), plus plan 2's variables.
- Produces: `withDeadline<T>(p: Promise<T>, ms: number, job: string, onStuck: (job: string) => void): Promise<T>` in `deadline.ts` — rejects with `Error('<job> did not finish within <s> s')` and calls `onStuck` once when `ms` passes. Deadlines (spec §6.5): model load 600 s; ASR run 30 s + 5 × audio seconds; stream feed 30 s; translation 30 s + 0.25 s × `maxTokens`; TTS synth 30 s + 0.5 s × text length in characters. The entry's `onStuck` posts `{ type: 'stuck', job }`.

- [ ] **Step 1: Write the failing tests** (`entry.test.ts`, with a fake `parentPort` and plan 2's fake native): posts `ready` with a port that accepts a WebSocket; posts `failed` with the loader message when `SOKUJI_NATIVE_DIR` is wrong; answers `ping` with `pong` of the same `seq`; on `stop` resolves `close()` and calls the injected `exit(0)`; a fake ASR run that never settles makes the socket receive an `error` and the port receive `{ type: 'stuck', job: 'asr_run' }` after the deadline (fake timers). `deadline.test.ts`: resolves untouched before the deadline; rejects and calls `onStuck` once after it; a late settle after the deadline is ignored.
- [ ] **Step 2: Run, fail.** `npx vitest run electron/engine/entry.test.ts`.
- [ ] **Step 3: Implement**, and add the `engine` entry to `vite.config.ts` (`ws` is bundled because it is a devDependency; do not add it to `external`).
- [ ] **Step 4: Run, pass**, then `npm run build` and confirm `dist-electron/engine.js` exists and contains no `require("ws")`.
- [ ] **Step 5: Measure the packaged origin.** In a throwaway local packaged build (`npm run make` or `electron-builder --dir` on this machine), log the `Origin` header of the first WebSocket upgrade. Record it in the commit message and in `main.js`'s origin list (Task 3). Expected `file://`. If it is `null`, stop and raise it in the thread: allowing `null` would admit sandboxed web pages, so the check needs another design.
- [ ] **Step 6: Commit** `git commit -m "feat(engine): utilityProcess entry"`

### Task 2: `EngineHost`

**Files:** Create `electron/engine-host.js`, `electron/engine-host.test.js`

**Interfaces:**
- Consumes: Task 1's parentPort protocol.
- Produces: `class EngineHost { constructor({ fork, enginePath, env, log, now }) ; start(): Promise<{ port: number }> ; stop(): Promise<void> ; status(): { running: boolean; port: number | null } ; registerIpc(ipcMain): void }` — `registerIpc` registers `native-host:start|stop|status` with today's reply shapes. `fork` defaults to `utilityProcess.fork` with `{ serviceName: 'Sokuji Engine', stdio: 'pipe', env }`.

- [ ] **Step 1: Write the failing tests** with an injected fake `fork` (a fake child with `postMessage`, `on('message')`, `on('exit')`, `kill()`):

```js
it('resolves the port from the ready message', async () => {});
it('a second start while running returns the same port without forking', async () => {});
it('rejects with the engine error on failed', async () => {});
it('rejects if no ready arrives within 30 s', async () => {});
it('an exit before ready rejects at once', async () => {});
it('after three crashes in 60 s, start refuses until restart', async () => {
  // three exits with code 134 at t=0,10,20 s → fourth start rejects /stopped unexpectedly three times/
});
it('kills the engine when a ping goes unanswered for 15 s', async () => {});
it('kills and forgets the engine on stuck', async () => {});
it('stop posts stop and kills after 2 s', async () => {});
it('forwards log messages to the app log', async () => {});
```

- [ ] **Step 2: Run, fail.** `npx vitest run electron/engine-host.test.js`.
- [ ] **Step 3: Implement.** Timers come from injected `now`/`setTimeout` so tests use fake timers. An exit after `ready` clears the port (the renderer's next `connect()` respawns, as today).
- [ ] **Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(electron): EngineHost runs the engine in a utilityProcess"`

### Task 3: Native directory and fetching the archive

**Files:**
- Create: `electron/native-dir.js` (+ test), `scripts/fetch-native.mjs` (+ `scripts/fetch-native.test.mjs`), `scripts/native-archives.json`
- Modify: `package.json` (`"nativeVersion": "<the native-v release plan 1 published>"`, `"fetch:native": "node scripts/fetch-native.mjs"`), `.gitignore` (`resources/native/`)

**Interfaces:**
- Produces:
  - `resolveNativeDir({ isPackaged, resourcesPath, env, repoRoot }): string` — `env.SOKUJI_NATIVE_DIR` if set; packaged: `path.join(resourcesPath, 'resources', 'native')`; otherwise `path.join(repoRoot, 'resources', 'native')`.
  - `scripts/native-archives.json`: `{ "version": "x.y.z", "sha256": { "linux-x64": "...", "linux-arm64": "...", "win-x64": "...", "mac-arm64": "...", "mac-x64": "..." } }`, copied from the release's `manifest.json`.
  - `fetch-native.mjs [--sku <sku>] [--from <dir-or-url>]`: SKU defaults to `detectSku()` for the running machine; downloads `sokuji-native-<sku>-v<version>.tar.zst` from the `native-v<version>` release (or `--from`), checks the sha256 from `native-archives.json` and that `version` equals `package.json` `nativeVersion`, empties `resources/native/`, unpacks the archive's single top-level directory into it with `fzstd` + `tar-stream` (rejecting absolute paths, `..` and links, as `sidecar-bundle.js` does), and is a no-op when `resources/native/contract.json` already names that version.

- [ ] **Step 1: Write the failing tests**: `native-dir` (the three cases); `fetch-native` against a local archive made by plan 1's `make_app_archive.py` from a fake stage (`--from <tmpdir>`): unpacks the four files; refuses a sha256 mismatch; refuses a `nativeVersion` / `native-archives.json` mismatch; refuses an entry named `../evil`; second run is a no-op.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass**, then on this machine `npm run fetch:native` (after plan 1's release exists) and `node -e` load check as in plan 1 Task 9 Step 4.
- [ ] **Step 5: Commit** `git commit -m "build: fetch the pinned native archive into resources/native"`

### Task 4: Wire the engine into main

**Files:** Modify `electron/main.js`, `vite.config.ts`; Create `electron/legacy-sidecar-cleanup.js` (+ test); Test `electron/main.engine.test.js`

**Interfaces:**
- Consumes: `EngineHost` (Task 2), `resolveNativeDir` (Task 3), `detectSku` (`electron/sidecar-sku.js`).
- Produces: the IPC behaviour in Global Constraints; `removeLegacySidecar(userDataDir, { rm, log }): Promise<void>` — removes `userData/sidecar/` if present, logs the bytes freed, never throws.

- [ ] **Step 1: Write the failing tests** (the main-process handlers are extracted into a small factory so they can be tested off-Electron, the pattern `native-host-manager.test.js` used):

```js
it('sidecar-bundle:status answers ready with the native version', async () => {});
it('sidecar-bundle:status answers unsupported where detectSku is null', async () => {});
it('install, cancel and remove are no-ops that answer ok', async () => {});
it('native-host:start answers an error on an unsupported platform without forking', async () => {});
it('the engine env carries SOKUJI_NATIVE_DIR, SOKUJI_ENGINE_ORIGINS and HF_HOME defaulting to userData/hf-cache', async () => {});
it('removeLegacySidecar deletes userData/sidecar and leaves hf-cache alone', async () => {});
it('removeLegacySidecar swallows errors', async () => {});
```

- [ ] **Step 2: Run, fail. Step 3: Implement**: replace `NativeHostManager` with `EngineHost` at the same call sites (`main.js:63-64`, `:243`, `:745`, `:787`, `:793`); stub the bundle handlers (`:795-914`); call `removeLegacySidecar` after `app.whenReady()` without awaiting it. **Step 4: Run, pass**, plus the full unit suite: `npx vitest run` → green.
- [ ] **Step 5: Real run on this machine.** `npm run fetch:native && VITE_ENABLED_PROVIDERS=local_native npm run e2e:build`, then the re-port's real-session e2e tests (#578, plan D) with `SOKUJI_NATIVE_DIR` instead of `SOKUJI_SIDECAR_PYTHON`. Expected: they pass on the Node engine with the same thresholds they pass on Python.
- [ ] **Step 6: Commit** `git commit -m "feat(electron): launch the Node engine; bundle IPC answers ready"`

### Task 5: Delete the Python sidecar

**Files:** the Deleted row of the File Structure table; Modify `src/lib/local-inference/native/nativeProtocol.consistency.test.ts`, `.github/workflows/build.yml` (drop `sidecar-tests`), `.github/workflows/native-build.yml` (release attaches archives and `manifest.json` only), `package.json` (drop `sidecarVersion`), `CLAUDE.md`, `native/README.md`, the `docs/` pages that describe installing the engine

- [ ] **Step 1: Repoint the consistency test first** and watch it fail on purpose: point it at `electron/engine/wire_schema.json` and scan `electron/engine/**/*.ts` for `type: '...'` literals; temporarily remove one outbound type from a handler and confirm the test reports it; restore.
- [ ] **Step 2: Delete** the files and jobs; `git grep -n -i "sidecarVersion\|sidecar-bundle\|sokuji_sidecar\|SOKUJI_SIDECAR"` returns only the renderer's bundle-state code (plan 5 of the rollout) and historical specs under `docs/superpowers/`.
- [ ] **Step 3: Run** `npx vitest run`, `npm run typecheck`, `npm run typecheck:engine`, `npm run build` → all green.
- [ ] **Step 4: Commit** `git commit -m "chore: delete the Python sidecar and its bundle pipeline"`

### Task 6: Packaging, signing checks and the five-platform gate

**Files:** Modify `.github/workflows/build.yml`

- [ ] **Step 1:** In each build job, before packaging: `npm run fetch:native -- --sku <the job's sku>`. In the e2e job: the same for `linux-x64`. Add `libvulkan1` to the deb's `recommends` in `package.json` (`build.linux.deb` / the deb target's options), next to `pulseaudio-utils` and `xwayland`.
- [ ] **Step 2:** Extend the macOS post-build check: for every file under `Contents/Resources/resources/native/`, `codesign --verify --strict` passes and `codesign -dv` shows TeamIdentifier `48ST7Q3ACJ`. On Windows, list the native files' Authenticode status in the job summary (Valid once plan 1 Task 10 is done; NotSigned is accepted until then).
- [ ] **Step 3: Commit** `git commit -m "ci: package and check the native files"`
- [ ] **Step 4: Five-platform gate (needs the maintainer's go-ahead to push branch `feat/engine-switch` to `kizuna-ai-lab/sokuji` and run `build.yml` with `workflow_dispatch`).** Expected: five green build jobs. Then, on each platform's packaged build: enable the tester switch, download one small model per stage, run one session end to end, quit during a TTS stream (quit within 2 s, no engine process left). Linux arm64: this machine. macOS: a real Mac (notarized build; Metal used). Windows and Linux x64: the machines named in the spec's open item 5.
- [ ] **Step 5:** Ask the maintainer to open the PR (`kizuna-ai-lab/sokuji`, `feat/engine-switch` → `main`), with the gate results in the description.
