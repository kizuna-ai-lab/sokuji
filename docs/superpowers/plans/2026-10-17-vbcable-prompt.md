# VB-CABLE Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Windows' VB-CABLE startup dialog with an in-app offer: a one-click install in the website's build, a link in the Microsoft Store's build. The offer appears once as a modal and in the Speech settings wherever the driver is needed.

**Architecture:**
- The main process learns which build it is from `resources/distribution.json`, an optional marker kept sticky in userData. It exposes the answer over IPC and refuses installs in the Store build.
- The installer runs unattended and returns a result.
- The renderer reads VB-CABLE's presence from the device list the routing already uses. One zustand store holds the channel, the install attempt and the seen flag. One component (`VbCableNotice`) draws every state, both in the Speech row and inside the one-time modal (`VbCableIntro`).

**Tech Stack:** Electron 44 main process (CommonJS), React 19 + TypeScript, zustand, i18next (30 catalogs), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-17-vbcable-prompt-store-installer-design.md`

**Companion plan:** `docs/superpowers/plans/2026-10-17-store-installer-pipeline.md` (CI, SignPath, backend, listing). This plan lands first. The pipeline plan's consistency test imports `MARKER_FILE` from Task 1.

## Global Constraints

- English for all code, comments and commit messages; conventional commits; end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never `git push`, open a PR, or run `gh` without the owner's explicit go-ahead, naming the target: `kizuna-ai-lab/sokuji` and the branch.
- Branch: `worktree-vbcable-channels` in `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/squirrel-sac-signing`.
- **Recording failures.** `src/**` records failures with `reportError` / `reportWarning` (`src/lib/diagnostics/report.ts`), never `console.error` / `console.warn`. `src/lib/diagnostics/consoleLedger.consistency.test.ts` fails otherwise. `electron/*.js` keeps `console.*`.
- **Catalogs.** Every new i18n key goes into all 30 catalogs under `src/locales/*/translation.json`; `src/locales/locales.consistency.test.ts` requires en's keys everywhere.
- **Names kept verbatim.** "VB-CABLE", "VB-Audio" and "Install Driver" stay as written in every language. The device name `CABLE Output (VB-Audio Virtual Cable)` comes from `virtualMicrophoneName()` and is never in a catalog.
- **Store channel.** It never installs: the renderer offers no install button and main's `install-vbcable` refuses.
- **Fail closed.** An unreadable channel is `store`; an unreadable seen flag is "seen".
- **Ready notice.** It has a × only, never auto-hides, is not persisted, and appears only after an install Sokuji started this session.
- **Running tests.** Use `npx vitest run <paths>` from the worktree root. The full suite has pre-existing unrelated failures, so judge only the files a task names, plus Task 9's list.

## Review Focus

1. **Labels before media permission.** Before permission is granted, every output label is empty. Presence must read `unknown`, not `missing`, so the prompt does not flash on a fresh install (Task 4).
2. **Apostrophe or non-ASCII in the user name.** The temp path then contains it. The PowerShell commands must quote it (`'` doubled) and still run (Task 2).
3. **Declined UAC on a non-English Windows.** The cancel is detected by exit code 1223, not by English message text, so it reads as `cancelled` (Task 2).
4. **Install clicked twice quickly** (the row and the modal, or a double click): exactly one `install-vbcable` IPC (Task 5).
5. **The driver appears while the install is still running** (the user has not closed VB-Audio's window): the ready notice shows, not "Installing…" (Task 7). The modal stays open through that change (Task 8).

---

### Task 1: Distribution channel module

**Files:**
- Create: `electron/distribution-channel.js`
- Test: `electron/distribution-channel.test.js`

**Interfaces:**
- Produces: `resolveDistributionChannel({ resourcesPath?: string, userDataPath?: string, fs?: typeof import('fs') }): 'website' | 'store'`; `MARKER_FILE = 'distribution.json'`; `STORE_MARKER = { channel: 'store' }`.

- [ ] **Step 1: Write the failing test**

```js
// electron/distribution-channel.test.js
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDistributionChannel, MARKER_FILE, STORE_MARKER } from './distribution-channel.js';

const dirs = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sokuji-dist-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const STORE = JSON.stringify(STORE_MARKER);

/** A packaged app's resources folder and a userData folder, each with an optional marker. */
function layout({ packaged, recorded } = {}) {
  const resourcesPath = tmp();
  const userDataPath = path.join(tmp(), 'Sokuji');
  if (packaged !== undefined) fs.writeFileSync(path.join(resourcesPath, MARKER_FILE), packaged);
  if (recorded !== undefined) {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(path.join(userDataPath, MARKER_FILE), recorded);
  }
  return { resourcesPath, userDataPath };
}

describe('resolveDistributionChannel', () => {
  it('is the website build when there is no marker, and records nothing', () => {
    const p = layout();
    expect(resolveDistributionChannel(p)).toBe('website');
    expect(fs.existsSync(path.join(p.userDataPath, MARKER_FILE))).toBe(false);
  });

  it('is the Store build when the packaged marker says so, and records it in userData', () => {
    const p = layout({ packaged: STORE });
    expect(resolveDistributionChannel(p)).toBe('store');
    expect(JSON.parse(fs.readFileSync(path.join(p.userDataPath, MARKER_FILE), 'utf8'))).toEqual(STORE_MARKER);
  });

  it('stays the Store build after the in-app update installed the unmarked website build', () => {
    expect(resolveDistributionChannel(layout({ recorded: STORE }))).toBe('store');
  });

  it('treats a malformed or foreign marker as absent', () => {
    for (const packaged of ['', '{', '"store"', JSON.stringify({ channel: 'website' }), JSON.stringify({ channel: 'STORE' })]) {
      expect(resolveDistributionChannel(layout({ packaged }))).toBe('website');
    }
  });

  it('still answers store when the record cannot be written', () => {
    const p = layout({ packaged: STORE });
    const failing = { ...fs, mkdirSync: () => { throw new Error('EACCES'); }, writeFileSync: () => { throw new Error('EACCES'); } };
    expect(resolveDistributionChannel({ ...p, fs: failing })).toBe('store');
  });

  it('does not rewrite a record that is already there', () => {
    const p = layout({ packaged: STORE, recorded: STORE });
    const writes = [];
    const spy = { ...fs, writeFileSync: (...args) => { writes.push(args); } };
    expect(resolveDistributionChannel({ ...p, fs: spy })).toBe('store');
    expect(writes).toEqual([]);
  });

  it('answers website without a resources path (a development run)', () => {
    expect(resolveDistributionChannel({ resourcesPath: undefined, userDataPath: tmp() })).toBe('website');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/distribution-channel.test.js`
Expected: FAIL with "Failed to resolve import ./distribution-channel.js" or similar.

- [ ] **Step 3: Write the implementation**

```js
// electron/distribution-channel.js
//
// Which build this is: the website's installer or the Microsoft Store's
// (spec 2026-10-17 §1). The Store's installer is the website's packaged app
// with one file added, resources/distribution.json, because Store policy
// 10.2.3 forbids offering to install other software (the VB-CABLE driver).
//
// The in-app updater installs the website's build over a Store install, and
// that build has no marker, so the first launch of a marked build records the
// channel in userData and every later launch reads it from there. Only
// `store` is ever recorded. Nothing here throws: an unreadable file is an
// absent one.
const fsDefault = require('fs');
const path = require('path');

const MARKER_FILE = 'distribution.json';
const STORE_MARKER = { channel: 'store' };

function isStoreMarker(file, fs) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data !== null && typeof data === 'object' && data.channel === STORE_MARKER.channel;
  } catch {
    return false;
  }
}

/**
 * @returns {'website' | 'store'}
 */
function resolveDistributionChannel({ resourcesPath = process.resourcesPath, userDataPath, fs = fsDefault } = {}) {
  const recorded = userDataPath ? path.join(userDataPath, MARKER_FILE) : null;
  if (resourcesPath && isStoreMarker(path.join(resourcesPath, MARKER_FILE), fs)) {
    if (recorded && !isStoreMarker(recorded, fs)) {
      try {
        fs.mkdirSync(userDataPath, { recursive: true });
        fs.writeFileSync(recorded, `${JSON.stringify(STORE_MARKER)}\n`);
      } catch (error) {
        console.warn('[Sokuji] [Distribution] Could not record the Store channel:', error?.message);
      }
    }
    return 'store';
  }
  return recorded && isStoreMarker(recorded, fs) ? 'store' : 'website';
}

module.exports = { resolveDistributionChannel, MARKER_FILE, STORE_MARKER };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/distribution-channel.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/distribution-channel.js electron/distribution-channel.test.js
git commit -m "feat(electron): tell the Microsoft Store build from the website build"
```

---

### Task 2: Unattended VB-CABLE installer

**Files:**
- Modify (rewrite): `electron/vb-cable-installer.js`
- Test: `electron/vb-cable-installer.test.js`

**Interfaces:**
- Consumes: `isVBCableInstalled()` from `electron/windows-audio-utils.js` (unchanged), through the default `isInstalled` dependency.
- Produces: `installVBCable(deps?) → Promise<{ ok: true } | { ok: false, reason: 'cancelled' | 'download-failed' | 'not-detected' | 'failed' }>`; `psQuote(value: string): string`; `runPowerShell(script, execFileImpl?)`; `VB_CABLE_ZIP_URL`; `SETUP_EXE = 'VBCABLE_Setup_x64.exe'`; `UAC_CANCELLED_EXIT = 1223`.

The rewrite drops every native dialog, the VBScript and `shell.openPath` fallbacks, and the exports nothing else uses: `ensureVBCableInstalled`, `promptVBCableInstallation`, `waitForInstallation`, `isAdmin`, `getVBCableDownloadUrl`, `getInstallationInstructions`. Its two callers (`windows-audio-utils.js:33-36`, `main.js:879-899`) change in Task 3, in the same branch.

- [ ] **Step 1: Write the failing test**

```js
// electron/vb-cable-installer.test.js
import { describe, it, expect, vi } from 'vitest';
import { installVBCable, psQuote, runPowerShell, VB_CABLE_ZIP_URL, UAC_CANCELLED_EXIT } from './vb-cable-installer.js';

const TEMP = 'C:\\Users\\ann\\AppData\\Local\\Temp';

/** Everything installVBCable reaches outside itself, faked. `installed` answers successive isInstalled() calls. */
function deps({ installed = [false, true], response, powershell, tempRoot = TEMP } = {}) {
  let i = 0;
  const scripts = [];
  return {
    tempRoot,
    fetchImpl: vi.fn(async () => response ?? new Response(new Uint8Array([0x50, 0x4b]), { status: 200 })),
    fs: { mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}), rm: vi.fn(async () => {}) },
    powershell: powershell ?? vi.fn(async (script) => { scripts.push(script); return ''; }),
    isInstalled: vi.fn(async () => installed[Math.min(i++, installed.length - 1)]),
    sleep: vi.fn(async () => {}),
    detectAttempts: 3,
    scripts,
  };
}

describe('psQuote', () => {
  it('makes a single-quoted PowerShell literal, doubling quotes inside', () => {
    expect(psQuote("C:\\Users\\O'Brien\\x.zip")).toBe("'C:\\Users\\O''Brien\\x.zip'");
  });
});

describe('runPowerShell', () => {
  it('runs powershell.exe with the script as one argument, hidden, never through a shell', async () => {
    const execFileImpl = vi.fn((_file, _args, _opts, cb) => cb(null, 'out', ''));
    await expect(runPowerShell('Get-Date', execFileImpl)).resolves.toBe('out');
    expect(execFileImpl).toHaveBeenCalledWith('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date'], { windowsHide: true }, expect.any(Function));
  });
});

describe('installVBCable', () => {
  it('does nothing when VB-CABLE is already there', async () => {
    const d = deps({ installed: [true] });
    await expect(installVBCable(d)).resolves.toEqual({ ok: true });
    expect(d.fetchImpl).not.toHaveBeenCalled();
    expect(d.powershell).not.toHaveBeenCalled();
  });

  it('downloads, extracts, runs the setup elevated and waits for the driver', async () => {
    const d = deps({ installed: [false, false, true] });
    await expect(installVBCable(d)).resolves.toEqual({ ok: true });
    expect(d.fetchImpl).toHaveBeenCalledWith(VB_CABLE_ZIP_URL, { redirect: 'follow' });
    const dir = `${TEMP}\\sokuji-vbcable`;
    expect(d.scripts[0]).toBe(`Expand-Archive -LiteralPath '${dir}\\vbcable.zip' -DestinationPath '${dir}' -Force`);
    expect(d.scripts[1]).toContain(`Start-Process -FilePath '${dir}\\VBCABLE_Setup_x64.exe' -WorkingDirectory '${dir}' -Verb RunAs -Wait -ErrorAction Stop`);
    expect(d.scripts[1]).toContain(`exit ${UAC_CANCELLED_EXIT}`);
    expect(d.fs.rm).toHaveBeenCalledWith(dir, { recursive: true, force: true });
  });

  it('quotes a temp path that holds an apostrophe', async () => {
    const d = deps({ tempRoot: "C:\\Users\\O'Brien\\AppData\\Local\\Temp" });
    await installVBCable(d);
    expect(d.scripts[0]).toContain("-LiteralPath 'C:\\Users\\O''Brien\\AppData\\Local\\Temp\\sokuji-vbcable\\vbcable.zip'");
  });

  it('reads a declined administrator prompt as cancelled, by exit code, in any Windows language', async () => {
    const powershell = vi.fn(async (script) => {
      if (script.startsWith('try { Start-Process')) throw Object.assign(new Error('Command failed'), { code: UAC_CANCELLED_EXIT, stderr: 'この操作はユーザーによって取り消されました。' });
      return '';
    });
    const d = deps({ powershell });
    await expect(installVBCable(d)).resolves.toEqual({ ok: false, reason: 'cancelled' });
    expect(d.fs.rm).toHaveBeenCalled();
  });

  it('reports a download that did not answer 200 without running anything', async () => {
    const d = deps({ response: new Response('nope', { status: 404 }) });
    await expect(installVBCable(d)).resolves.toEqual({ ok: false, reason: 'download-failed' });
    expect(d.powershell).not.toHaveBeenCalled();
    expect(d.fs.rm).toHaveBeenCalled();
  });

  it('reports not-detected when the setup closed but the driver never appeared', async () => {
    const d = deps({ installed: [false] });
    await expect(installVBCable(d)).resolves.toEqual({ ok: false, reason: 'not-detected' });
    expect(d.isInstalled).toHaveBeenCalledTimes(1 + 3);
    expect(d.sleep).toHaveBeenCalledTimes(2);
  });

  it('reports failed for any other error, such as an archive that will not extract', async () => {
    const powershell = vi.fn(async () => { throw Object.assign(new Error('Command failed'), { code: 1 }); });
    await expect(installVBCable(deps({ powershell }))).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/vb-cable-installer.test.js`
Expected: FAIL. `psQuote`, `runPowerShell` and `UAC_CANCELLED_EXIT` are not exported, and `installVBCable` shows dialogs.

- [ ] **Step 3: Rewrite the module**

Replace the whole of `electron/vb-cable-installer.js` with:

```js
// Installs VB-CABLE for the website's build, behind the renderer's prompt
// (spec 2026-10-17 §2). No native dialogs: the result is what the prompt draws.
// The Microsoft Store's build never reaches this (main.js 'install-vbcable').
//
// The user still approves the administrator prompt and clicks "Install Driver"
// in VB-Audio's own window; Sokuji only fetches the pack and starts its setup.
const path = require('path').win32;
const fsPromises = require('fs').promises;
const { execFile } = require('child_process');

const VB_CABLE_ZIP_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip';
const SETUP_EXE = 'VBCABLE_Setup_x64.exe';
// ERROR_CANCELLED: the administrator prompt was declined. Matched by code,
// because Start-Process words the message in the system's language.
const UAC_CANCELLED_EXIT = 1223;

/** A PowerShell single-quoted literal: only ' needs escaping, as ''. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Run one PowerShell command, arguments passed as an array so no shell parses them. */
function runPowerShell(script, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || '');
        reject(error);
      } else {
        resolve(String(stdout || ''));
      }
    });
  });
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'cancelled' | 'download-failed' | 'not-detected' | 'failed' }>}
 */
async function installVBCable({
  tempRoot = require('electron').app.getPath('temp'),
  fetchImpl = fetch,
  fs = fsPromises,
  powershell = runPowerShell,
  isInstalled = () => require('./windows-audio-utils').isVBCableInstalled(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  detectAttempts = 5,
  detectIntervalMs = 2000,
} = {}) {
  if (await isInstalled()) return { ok: true };

  const dir = path.join(tempRoot, 'sokuji-vbcable');
  try {
    await fs.mkdir(dir, { recursive: true });
    const zip = path.join(dir, 'vbcable.zip');
    try {
      const response = await fetchImpl(VB_CABLE_ZIP_URL, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fs.writeFile(zip, Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('[Sokuji] [VB-CABLE Installer] Download failed:', error?.message);
      return { ok: false, reason: 'download-failed' };
    }

    await powershell(`Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(dir)} -Force`);

    const setup = path.join(dir, SETUP_EXE);
    try {
      await powershell(
        `try { Start-Process -FilePath ${psQuote(setup)} -WorkingDirectory ${psQuote(dir)} -Verb RunAs -Wait -ErrorAction Stop } `
        + `catch { $e = $_.Exception; while ($e) { if ($e.NativeErrorCode -eq ${UAC_CANCELLED_EXIT}) { exit ${UAC_CANCELLED_EXIT} }; $e = $e.InnerException }; throw }`,
      );
    } catch (error) {
      if (error?.code === UAC_CANCELLED_EXIT) return { ok: false, reason: 'cancelled' };
      throw error;
    }

    for (let attempt = 0; attempt < detectAttempts; attempt++) {
      if (attempt > 0) await sleep(detectIntervalMs);
      if (await isInstalled()) return { ok: true };
    }
    return { ok: false, reason: 'not-detected' };
  } catch (error) {
    console.error('[Sokuji] [VB-CABLE Installer] Installation failed:', error?.message, error?.stderr || '');
    return { ok: false, reason: 'failed' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { installVBCable, psQuote, runPowerShell, VB_CABLE_ZIP_URL, SETUP_EXE, UAC_CANCELLED_EXIT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/vb-cable-installer.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/vb-cable-installer.js electron/vb-cable-installer.test.js
git commit -m "refactor(electron): install VB-CABLE without native dialogs and return a result"
```

---

### Task 3: Main-process wiring (startup, IPC, allowlist)

**Files:**
- Modify: `electron/windows-audio-utils.js:13-50` (`createVirtualAudioDevices`)
- Modify: `electron/main.js`. Three places:
  - a require next to the other top-level requires (around `:160`);
  - a lazy getter next to `lastAudioStatus` (`:192`);
  - the `install-vbcable` handler (`:878-899`), plus a new handler after `get-app-version` (`:789`).
- Modify: `electron/ipc-channels.js:42-43`
- Test: `electron/vbcable.wiring.test.js`

**Interfaces:**
- Consumes: `resolveDistributionChannel` (Task 1); `installVBCable` (Task 2).
- Produces: IPC `get-distribution-channel` → `'website' | 'store'`; IPC `install-vbcable` → Task 2's result, or `{ ok: false, reason: 'not-offered' }` outside the website channel, or `{ ok: false, reason: 'unsupported' }` off Windows.

- [ ] **Step 1: Write the failing test**

```js
// electron/vbcable.wiring.test.js
//
// main.js cannot be booted in vitest; its VB-CABLE wiring is asserted on its
// source text, as sandbox-recovery.wiring.test.js does (spec 2026-10-17 §2-3).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVOKE_CHANNELS } from './ipc-channels.js';
import { createVirtualAudioDevices } from './windows-audio-utils.js';

const read = (file) => readFileSync(join(__dirname, file), 'utf8');
const main = read('main.js');

/** The body of one `ipcMain.handle(channel, ...)`, up to the next handler. */
function handler(channel) {
  const start = main.indexOf(`ipcMain.handle('${channel}'`);
  expect(start, `expected a handler for ${channel}`).toBeGreaterThan(-1);
  const next = main.indexOf('ipcMain.handle(', start + 1);
  return main.slice(start, next === -1 ? undefined : next);
}

describe('VB-CABLE wiring', () => {
  it('answers the distribution channel over IPC, and the renderer may ask', () => {
    expect(handler('get-distribution-channel')).toContain('getDistributionChannel()');
    expect(INVOKE_CHANNELS).toContain('get-distribution-channel');
  });

  it('refuses an install outside the website channel before loading the installer', () => {
    const body = handler('install-vbcable');
    const check = body.indexOf("getDistributionChannel() !== 'website'");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf("require('./vb-cable-installer')"));
    expect(body).toContain('installVBCable()');
  });

  it('never prompts or installs at startup on Windows', async () => {
    expect(read('windows-audio-utils.js')).not.toContain('vb-cable-installer');
    await expect(createVirtualAudioDevices()).resolves.toBe(true);
  });

  it('the installer shows no native dialog', () => {
    const installer = read('vb-cable-installer.js');
    expect(installer).not.toMatch(/\bdialog\b/);
    expect(installer).not.toContain('showMessageBox');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/vbcable.wiring.test.js`
Expected: FAIL on "expected a handler for get-distribution-channel" and on `windows-audio-utils.js` still requiring the installer.

- [ ] **Step 3: Implement**

In `electron/windows-audio-utils.js`, replace `createVirtualAudioDevices` (lines 13-50, JSDoc included) with:

```js
/**
 * Windows has nothing to create: the virtual microphone is VB-CABLE, a driver
 * the user installs. The renderer reads it from the device list and offers it
 * where it is needed (spec 2026-10-17 §3), so startup never prompts or waits.
 * @returns {Promise<boolean>} Always true
 */
async function createVirtualAudioDevices() {
  return true;
}
```

In `electron/main.js`, add next to `const sandboxRecovery = ...` (line 160):

```js
const { resolveDistributionChannel } = require('./distribution-channel');
```

Below `let lastAudioStatus = null;` (line 192), add:

```js
// The website's build or the Microsoft Store's (spec 2026-10-17 §1). Read on
// first use, after app.setName has fixed the userData path it records into.
let distributionChannel = null;
function getDistributionChannel() {
  if (!distributionChannel) {
    distributionChannel = resolveDistributionChannel({
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
    });
  }
  return distributionChannel;
}
```

After `ipcMain.handle('get-app-version', () => app.getVersion());` (line 789), add:

```js
ipcMain.handle('get-distribution-channel', () => getDistributionChannel());
```

Replace the whole `install-vbcable` handler (lines 878-899, comment included) with:

```js
// Install VB-CABLE behind the renderer's prompt. Store policy 10.2.3: the
// Microsoft Store's build never installs other software (spec 2026-10-17 §2).
ipcMain.handle('install-vbcable', async () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported' };
  if (getDistributionChannel() !== 'website') return { ok: false, reason: 'not-offered' };
  console.log('[Sokuji] [Main] VB-CABLE installation requested from renderer');
  return require('./vb-cable-installer').installVBCable();
});
```

In `electron/ipc-channels.js`, after `'install-vbcable',` (line 43), add:

```js
  'get-distribution-channel',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/vbcable.wiring.test.js electron/ipc-channels.test.js electron/windows-audio-utils.appaudio.test.js`
Expected: PASS. `ipc-channels.test.js` confirms the new channel has a handler.

- [ ] **Step 5: Commit**

```bash
git add electron/windows-audio-utils.js electron/main.js electron/ipc-channels.js electron/vbcable.wiring.test.js
git commit -m "feat(electron): no VB-CABLE dialog at startup; install only in the website build"
```

---

### Task 4: VB-CABLE presence from the device list

**Files:**
- Create: `src/lib/audio/vbCable.ts`
- Test: `src/lib/audio/vbCable.test.ts`

**Interfaces:**
- Consumes: `findVirtualSpeaker` (`src/lib/audio/virtualSpeaker.ts:10`).
- Produces: `type VbCablePresence = 'not-applicable' | 'unknown' | 'present' | 'missing'`; `vbCablePresence(input: { electron: boolean; windows: boolean; devicesLoaded: boolean; outputs: readonly { deviceId: string; label: string }[] }): VbCablePresence`; `VB_AUDIO_URL = 'https://vb-audio.com/Cable/'`; `VB_CABLE_SETUP_FILE = 'VBCABLE_Setup_x64.exe'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/audio/vbCable.test.ts
import { describe, it, expect } from 'vitest';
import { vbCablePresence } from './vbCable';

const SPEAKERS = { deviceId: 'spk', label: 'Speakers (Realtek(R) Audio)' };
const CABLE = { deviceId: 'cable', label: 'CABLE Input (VB-Audio Virtual Cable)' };
const win = { electron: true, windows: true, devicesLoaded: true };

describe('vbCablePresence', () => {
  it('does not apply outside Windows Electron', () => {
    expect(vbCablePresence({ ...win, windows: false, outputs: [SPEAKERS] })).toBe('not-applicable');
    expect(vbCablePresence({ ...win, electron: false, outputs: [SPEAKERS] })).toBe('not-applicable');
  });

  it('is unknown until the device list has loaded', () => {
    expect(vbCablePresence({ ...win, devicesLoaded: false, outputs: [] })).toBe('unknown');
  });

  it('is unknown while every label is empty, before media permission', () => {
    expect(vbCablePresence({ ...win, outputs: [{ deviceId: 'a', label: '' }, { deviceId: 'b', label: '' }] })).toBe('unknown');
  });

  it('is present when the routing would find a virtual device, and missing otherwise', () => {
    expect(vbCablePresence({ ...win, outputs: [SPEAKERS, CABLE] })).toBe('present');
    expect(vbCablePresence({ ...win, outputs: [SPEAKERS] })).toBe('missing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/audio/vbCable.test.ts`
Expected: FAIL with "Failed to resolve import ./vbCable".

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/audio/vbCable.ts
import { findVirtualSpeaker } from './virtualSpeaker';

/**
 * Whether VB-CABLE, Windows' virtual microphone, is there (spec 2026-10-17 §4).
 * `present` is the routing's own test (`findVirtualSpeaker`), so a prompt shows
 * exactly when the translation has no virtual device to go to.
 */
export type VbCablePresence = 'not-applicable' | 'unknown' | 'present' | 'missing';

export interface VbCablePresenceInput {
  electron: boolean;
  windows: boolean;
  devicesLoaded: boolean;
  outputs: readonly { deviceId: string; label: string }[];
}

export function vbCablePresence({ electron, windows, devicesLoaded, outputs }: VbCablePresenceInput): VbCablePresence {
  if (!electron || !windows) return 'not-applicable';
  // Before media permission every label is empty and no device can be told apart.
  if (!devicesLoaded || outputs.every((device) => !device.label)) return 'unknown';
  return findVirtualSpeaker(outputs) ? 'present' : 'missing';
}

export const VB_AUDIO_URL = 'https://vb-audio.com/Cable/';
export const VB_CABLE_SETUP_FILE = 'VBCABLE_Setup_x64.exe';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/audio/vbCable.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/vbCable.ts src/lib/audio/vbCable.test.ts
git commit -m "feat(audio): read VB-CABLE's presence from the device list"
```

---

### Task 5: The VB-CABLE store

**Files:**
- Create: `src/stores/vbCableStore.ts`
- Test: `src/stores/vbCableStore.test.ts`

**Interfaces:**
- Consumes: `vbCablePresence`, `VbCablePresence` (Task 4); `useAudioStore` (`devicesLoaded`, `audioMonitorDevices`, `syncDevices`); `persistSetting`; `ServiceFactory.getSettingsService().getSetting`; IPC `get-distribution-channel`, `install-vbcable` (Task 3).
- Produces:
  - Types: `DistributionChannel = 'website' | 'store'`; `VbCableAttempt = 'none' | 'running' | 'failed' | 'succeeded'`.
  - `useVbCableStore` with state `{ channel: DistributionChannel | null; introSeen: boolean | null; attempt: VbCableAttempt; readyDismissed: boolean }` and actions `load(): Promise<void>`, `install(): Promise<void>`, `checkAgain(): Promise<void>`, `dismissReady(): void`, `markIntroSeen(): void`.
  - `useVbCablePresence(): VbCablePresence`; `VB_CABLE_INTRO_SEEN_KEY = 'audio.vbCableIntroSeen'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/vbCableStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stored = vi.hoisted(() => new Map<string, unknown>());
const getSetting = vi.hoisted(() => vi.fn(async (key: string, fallback: unknown) => (stored.has(key) ? stored.get(key) : fallback)));
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting,
      setSetting: async (key: string, value: unknown) => { stored.set(key, value); return { success: true }; },
    }),
  },
}));
const report = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
vi.mock('../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/diagnostics/report')>()),
  reportError: report.error,
  reportWarning: report.warning,
}));

type Invoke = (channel: string, data?: unknown) => Promise<unknown>;
const invoke = vi.fn<Invoke>();

/** A fresh module per test: `load()` remembers its first run. */
async function fresh() {
  vi.resetModules();
  const store = await import('./vbCableStore');
  const audio = (await import('./audioStore')).default;
  const syncDevices = vi.fn(async () => {});
  audio.setState({ syncDevices } as never);
  return { ...store, syncDevices };
}

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  report.error.mockClear();
  report.warning.mockClear();
  invoke.mockReset();
  invoke.mockImplementation(async (channel) => (channel === 'get-distribution-channel' ? 'website' : { ok: true }));
  (window as unknown as { electron: { invoke: Invoke } }).electron = { invoke };
});

describe('vbCableStore.load', () => {
  it('reads the channel and the seen flag once, however often it is asked', async () => {
    const { useVbCableStore } = await fresh();
    await Promise.all([useVbCableStore.getState().load(), useVbCableStore.getState().load()]);
    expect(useVbCableStore.getState()).toMatchObject({ channel: 'website', introSeen: false });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('assumes the Store build when the channel cannot be read, so no install is offered', async () => {
    invoke.mockRejectedValue(new Error('IPC down'));
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    expect(useVbCableStore.getState().channel).toBe('store');
    expect(report.warning).toHaveBeenCalledTimes(1);
  });

  it('assumes seen when the flag cannot be read', async () => {
    getSetting.mockRejectedValueOnce(new Error('storage'));
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    expect(useVbCableStore.getState().introSeen).toBe(true);
  });

  it('remembers a seen introduction', async () => {
    stored.set('audio.vbCableIntroSeen', true);
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    expect(useVbCableStore.getState().introSeen).toBe(true);
  });
});

describe('vbCableStore.install', () => {
  it('runs while the IPC is out, succeeds on ok, and re-reads the devices', async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementation((channel) => (channel === 'install-vbcable' ? new Promise((r) => { finish = r; }) : Promise.resolve('website')));
    const { useVbCableStore, syncDevices } = await fresh();
    await useVbCableStore.getState().load();
    const done = useVbCableStore.getState().install();
    expect(useVbCableStore.getState().attempt).toBe('running');
    finish({ ok: true });
    await done;
    expect(useVbCableStore.getState().attempt).toBe('succeeded');
    expect(syncDevices).toHaveBeenCalledTimes(1);
  });

  it('starts one install however often it is clicked', async () => {
    invoke.mockImplementation((channel) => (channel === 'install-vbcable' ? new Promise(() => {}) : Promise.resolve('website')));
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    void useVbCableStore.getState().install();
    void useVbCableStore.getState().install();
    expect(invoke.mock.calls.filter(([c]) => c === 'install-vbcable')).toHaveLength(1);
  });

  it('records a failure, but not a declined administrator prompt', async () => {
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    invoke.mockResolvedValueOnce({ ok: false, reason: 'cancelled' });
    await useVbCableStore.getState().install();
    expect(useVbCableStore.getState().attempt).toBe('failed');
    expect(report.error).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: false, reason: 'not-detected' });
    await useVbCableStore.getState().install();
    expect(report.error).toHaveBeenCalledTimes(1);
  });

  it('never installs in the Store build', async () => {
    invoke.mockImplementation(async (channel) => (channel === 'get-distribution-channel' ? 'store' : { ok: true }));
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    await useVbCableStore.getState().install();
    expect(invoke.mock.calls.filter(([c]) => c === 'install-vbcable')).toHaveLength(0);
    expect(useVbCableStore.getState().attempt).toBe('none');
  });
});

describe('vbCableStore flags', () => {
  it('persists the introduction as seen, and dismisses the ready notice for this session only', async () => {
    const { useVbCableStore } = await fresh();
    useVbCableStore.getState().markIntroSeen();
    useVbCableStore.getState().dismissReady();
    expect(useVbCableStore.getState()).toMatchObject({ introSeen: true, readyDismissed: true });
    await vi.waitFor(() => expect(stored.get('audio.vbCableIntroSeen')).toBe(true));
    expect(stored.has('audio.vbCableReadyDismissed')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/vbCableStore.test.ts`
Expected: FAIL with "Failed to resolve import ./vbCableStore".

- [ ] **Step 3: Write the implementation**

```ts
// src/stores/vbCableStore.ts
//
// VB-CABLE on Windows (spec 2026-10-17 §4): which build this is, an install
// Sokuji started this session, and whether the one-time introduction was seen.
// The device's presence is not stored here: it is read from audioStore's list,
// the same one the routing reads.
import { create } from 'zustand';
import { ServiceFactory } from '../services/ServiceFactory';
import { persistSetting } from '../services/persistSetting';
import { describeCause, reportError, reportWarning } from '../lib/diagnostics/report';
import { vbCablePresence, type VbCablePresence } from '../lib/audio/vbCable';
import { isElectron, isWindows } from '../utils/environment';
import useAudioStore from './audioStore';

export const VB_CABLE_INTRO_SEEN_KEY = 'audio.vbCableIntroSeen';

export type DistributionChannel = 'website' | 'store';
/** An install Sokuji started this session; `succeeded` is main's word, the device list may lag. */
export type VbCableAttempt = 'none' | 'running' | 'failed' | 'succeeded';

export interface VbCableState {
  /** null until loaded. */
  channel: DistributionChannel | null;
  /** null until loaded; persisted. */
  introSeen: boolean | null;
  attempt: VbCableAttempt;
  /** The ready notice's ×: this session only. */
  readyDismissed: boolean;
  load: () => Promise<void>;
  install: () => Promise<void>;
  checkAgain: () => Promise<void>;
  dismissReady: () => void;
  markIntroSeen: () => void;
}

type Electron = { invoke: (channel: string, data?: unknown) => Promise<unknown> };
const electron = () => (window as unknown as { electron?: Electron }).electron;

let loading: Promise<void> | null = null;

export const useVbCableStore = create<VbCableState>()((set, get) => ({
  channel: null,
  introSeen: null,
  attempt: 'none',
  readyDismissed: false,

  load: () => {
    loading ??= (async () => {
      // Fail closed: a build that cannot say what it is offers no install.
      let channel: DistributionChannel = 'store';
      try {
        if ((await electron()?.invoke('get-distribution-channel')) === 'website') channel = 'website';
      } catch (error) {
        reportWarning('VbCableStore', `Could not read which build this is, so VB-CABLE is only linked: ${describeCause(error)}`, { cause: error });
      }
      // Fail closed again: an unreadable flag is a seen introduction, not a nag.
      let introSeen = true;
      try {
        introSeen = (await ServiceFactory.getSettingsService().getSetting<boolean | null>(VB_CABLE_INTRO_SEEN_KEY, null)) === true;
      } catch (error) {
        reportWarning('VbCableStore', `Could not read whether the VB-CABLE introduction was shown: ${describeCause(error)}`, { cause: error });
      }
      set({ channel, introSeen });
    })();
    return loading;
  },

  install: async () => {
    if (get().channel !== 'website' || get().attempt === 'running') return;
    set({ attempt: 'running', readyDismissed: false });
    let result: { ok?: boolean; reason?: string } | undefined;
    try {
      result = (await electron()?.invoke('install-vbcable')) as typeof result;
    } catch (error) {
      reportError('VbCableStore', `VB-CABLE could not be installed: ${describeCause(error)}`, { cause: error });
    }
    if (result?.ok) {
      set({ attempt: 'succeeded' });
    } else {
      set({ attempt: 'failed' });
      // A declined administrator prompt is the user's choice, not a failure.
      if (result && result.reason !== 'cancelled') reportError('VbCableStore', `VB-CABLE was not installed: ${result.reason ?? 'no reason given'}`);
    }
    await useAudioStore.getState().syncDevices();
  },

  checkAgain: () => useAudioStore.getState().syncDevices(),

  dismissReady: () => set({ readyDismissed: true }),

  markIntroSeen: () => {
    set({ introSeen: true });
    void persistSetting(VB_CABLE_INTRO_SEEN_KEY, true);
  },
}));

/** VB-CABLE's presence, following the device list. */
export function useVbCablePresence(): VbCablePresence {
  const devicesLoaded = useAudioStore((s) => s.devicesLoaded);
  const outputs = useAudioStore((s) => s.audioMonitorDevices);
  return vbCablePresence({ electron: isElectron(), windows: isWindows(), devicesLoaded, outputs });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/vbCableStore.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS (9 tests + the ledger).

- [ ] **Step 5: Commit**

```bash
git add src/stores/vbCableStore.ts src/stores/vbCableStore.test.ts
git commit -m "feat(stores): VB-CABLE channel, install attempt and introduction flag"
```

---

### Task 6: Copy in 30 catalogs

**Files:**
- Modify: `src/locales/*/translation.json` (all 30)
- Test: `src/locales/locales.consistency.test.ts` (existing)

**Interfaces:**
- Produces: the `vbCable.*` keys the next two tasks render: `title, body, install, about, adminOnce, installingTitle, installingBody, installingBusy, failedTitle, failedBody, retry, installYourself, readyTitle, readyBody, storeStep1, storeStep2, storeStep3, openWebsite, checkAgain, picksUp, notNow`.

- [ ] **Step 1: Add the English and Simplified Chinese blocks**

Insert `vbCable` as a top-level object directly after `audioSystem` in `src/locales/en/translation.json`:

```json
"vbCable": {
  "title": "Let the other side hear the translation",
  "body": "Meeting apps take the spoken translation through a virtual microphone. On Windows that is VB-CABLE, a free driver from VB-Audio. Everything else in Sokuji works without it.",
  "install": "Install VB-CABLE",
  "about": "About VB-CABLE",
  "adminOnce": "Windows asks for administrator permission once.",
  "installingTitle": "Installing VB-CABLE…",
  "installingBody": "Approve the Windows prompt, then click \"Install Driver\" in the VB-CABLE window. Sokuji picks it up as soon as it is installed.",
  "installingBusy": "Installing…",
  "failedTitle": "VB-CABLE wasn't installed",
  "failedBody": "The installation was cancelled or didn't finish. Try again, or install it yourself from VB-Audio's website.",
  "retry": "Try again",
  "installYourself": "Install it yourself",
  "readyTitle": "VB-CABLE is ready.",
  "readyBody": "In your meeting app, choose \"{{mic}}\" as the microphone.",
  "storeStep1": "Download the VB-CABLE pack (zip) from VB-Audio's website.",
  "storeStep2": "Unzip it, right-click <code>{{file}}</code> and choose \"Run as administrator\".",
  "storeStep3": "Click \"Install Driver\", then restart your PC.",
  "openWebsite": "Open VB-Audio website",
  "checkAgain": "Check again",
  "picksUp": "Sokuji picks it up automatically once it is installed.",
  "notNow": "Not now"
}
```

And in `src/locales/zh_CN/translation.json`, at the same place:

```json
"vbCable": {
  "title": "让对方听到翻译",
  "body": "会议软件通过虚拟麦克风接收翻译语音。在 Windows 上，这需要 VB-CABLE——VB-Audio 提供的免费驱动。不装它，Sokuji 的其他功能照常可用。",
  "install": "安装 VB-CABLE",
  "about": "了解 VB-CABLE",
  "adminOnce": "Windows 会请求一次管理员权限。",
  "installingTitle": "正在安装 VB-CABLE…",
  "installingBody": "请在 Windows 的提示中点“是”，然后在 VB-CABLE 的窗口里点 “Install Driver”。装好后 Sokuji 会立刻识别。",
  "installingBusy": "正在安装…",
  "failedTitle": "VB-CABLE 没有装上",
  "failedBody": "安装被取消，或者没有完成。可以重试，也可以去 VB-Audio 官网自己安装。",
  "retry": "重试",
  "installYourself": "自己安装",
  "readyTitle": "VB-CABLE 已就绪。",
  "readyBody": "在会议软件里，把麦克风选为 “{{mic}}”。",
  "storeStep1": "在 VB-Audio 官网下载 VB-CABLE 安装包（zip）。",
  "storeStep2": "解压后，右键 <code>{{file}}</code>，选“以管理员身份运行”。",
  "storeStep3": "点 “Install Driver”，然后重启电脑。",
  "openWebsite": "打开 VB-Audio 官网",
  "checkAgain": "重新检测",
  "picksUp": "装好后 Sokuji 会自动识别。",
  "notNow": "以后再说"
}
```

Insert with a script that keeps each file's key order and formatting. The script must not reformat a file it did not need to change:

```bash
node -e '
const fs = require("fs");
const [file, blockFile] = process.argv.slice(1);
const text = fs.readFileSync(file, "utf8");
const data = JSON.parse(text);
if (JSON.stringify(data, null, 2) + "\n" !== text) { console.error("not canonical 2-space JSON:", file); process.exit(1); }
const out = {};
for (const [k, v] of Object.entries(data)) { out[k] = v; if (k === "audioSystem") out.vbCable = JSON.parse(fs.readFileSync(blockFile, "utf8")); }
fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
' src/locales/en/translation.json "$CLAUDE_JOB_DIR/tmp/vbcable.en.json"
```

(Write each block above to `$CLAUDE_JOB_DIR/tmp/vbcable.<locale>.json` first, or to any temp directory outside the repo. If a catalog is "not canonical", insert the block by hand after `audioSystem`'s closing brace instead.)

- [ ] **Step 2: Translate into the other 28 catalogs**

Use the same keys for `ar bn de es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_TW`, translated from the English block. Rules:
- Keep `VB-CABLE`, `VB-Audio`, `Install Driver`, `{{mic}}`, `{{file}}` and the `<code>…</code>` tags exactly.
- Write "Run as administrator" as Windows names it in that language:
  - ja: 管理者として実行
  - ko: 관리자 권한으로 실행
  - de: Als Administrator ausführen
  - fr: Exécuter en tant qu'administrateur
  - es: Ejecutar como administrador
  - zh_TW: 以系統管理員身分執行
  - for other languages, the Windows display language's string.
- Match each catalog's existing tone for "Translation the other side hears" (`audioPanel.otherHears`).
- zh_TW: Traditional characters, Taiwan wording (驅動程式, 安裝, 重新偵測).

Write each translated block to `$CLAUDE_JOB_DIR/tmp/vbcable.<locale>.json` and run the Step 1 script for each locale.

- [ ] **Step 3: Run the catalog tests**

Run: `npx vitest run src/locales`
Expected: PASS. `locales.consistency.test.ts` finds every en key in every catalog.

Also run: `git diff --stat src/locales`
Expected: 30 files, each with about 23 added lines and no removed lines.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "feat(i18n): VB-CABLE prompt copy in 30 languages"
```

---

### Task 7: `VbCableNotice`, every state

**Files:**
- Create: `src/components/VbCable/VbCableNotice.tsx`
- Create: `src/components/VbCable/VbCable.scss`
- Test: `src/components/VbCable/VbCableNotice.test.tsx`

**Interfaces:**
- Consumes: `useVbCableStore`, `useVbCablePresence` (Task 5); `VB_AUDIO_URL`, `VB_CABLE_SETUP_FILE` (Task 4); `virtualMicrophoneName()`; `openExternalUrl(url)` (`src/utils/openExternalUrl.ts`); keys from Task 6.
- Produces: `default export VbCableNotice: React.FC<{ variant: 'row' | 'modal'; onNotNow?: () => void }>`. It renders `null` when there is nothing to say.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/VbCable/VbCableNotice.test.tsx
/**
 * Which state VbCableNotice draws (spec 2026-10-17 §4), asserted by key:
 * the copy itself is localised and invisible to a test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { VbCablePresence } from '../../lib/audio/vbCable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}));
const presence = vi.hoisted(() => ({ value: 'missing' as VbCablePresence }));
vi.mock('../../stores/vbCableStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/vbCableStore')>()),
  useVbCablePresence: () => presence.value,
}));
const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl }));

import { useVbCableStore, type VbCableState } from '../../stores/vbCableStore';
import VbCableNotice from './VbCableNotice';

const actions = { load: vi.fn(async () => {}), install: vi.fn(async () => {}), checkAgain: vi.fn(async () => {}), dismissReady: vi.fn(), markIntroSeen: vi.fn() };
const state = (s: Partial<VbCableState>) => useVbCableStore.setState({ channel: 'website', introSeen: false, attempt: 'none', readyDismissed: false, ...actions, ...s });

beforeEach(() => {
  presence.value = 'missing';
  Object.values(actions).forEach((a) => a.mockClear());
  openExternalUrl.mockClear();
  state({});
});

describe('VbCableNotice', () => {
  it('draws nothing where VB-CABLE does not apply, or before the list or the channel is known', () => {
    for (const p of ['not-applicable', 'unknown'] as const) {
      presence.value = p;
      const { container, unmount } = render(<VbCableNotice variant="row" />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    presence.value = 'missing';
    state({ channel: null });
    expect(render(<VbCableNotice variant="row" />).container).toBeEmptyDOMElement();
  });

  it('website, missing: offers the install, a link about it, and says Windows asks once', () => {
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.title')).toBeInTheDocument();
    expect(screen.getByText('vbCable.adminOnce')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.install' }));
    expect(actions.install).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /vbCable\.about/ }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://vb-audio.com/Cable/');
  });

  it('website, running: says what to approve, with a busy button', () => {
    state({ attempt: 'running' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.installingTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /vbCable\.installingBusy/ })).toBeDisabled();
  });

  it('website, main says done but the list has not caught up: Check again instead of a busy button', () => {
    state({ attempt: 'succeeded' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.installingTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.checkAgain' }));
    expect(actions.checkAgain).toHaveBeenCalledTimes(1);
  });

  it('website, failed: try again, or install it yourself', () => {
    state({ attempt: 'failed' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.failedTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.retry' }));
    expect(actions.install).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /vbCable\.installYourself/ }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://vb-audio.com/Cable/');
  });

  it('Store build: steps and a link, never an install button', () => {
    state({ channel: 'store' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.storeStep2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'vbCable.install' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /vbCable\.openWebsite/ }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://vb-audio.com/Cable/');
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.checkAgain' }));
    expect(actions.checkAgain).toHaveBeenCalledTimes(1);
  });

  it('present with no install this session: nothing', () => {
    presence.value = 'present';
    expect(render(<VbCableNotice variant="row" />).container).toBeEmptyDOMElement();
  });

  it('present while the install is still running: ready, not installing', () => {
    presence.value = 'present';
    state({ attempt: 'running' });
    render(<VbCableNotice variant="row" />);
    expect(screen.getByText('vbCable.readyTitle')).toBeInTheDocument();
    expect(screen.queryByText('vbCable.installingTitle')).toBeNull();
  });

  it('ready: a × that dismisses it, and nothing once dismissed', () => {
    presence.value = 'present';
    state({ attempt: 'succeeded' });
    const { unmount } = render(<VbCableNotice variant="row" />);
    fireEvent.click(screen.getByRole('button', { name: 'common.dismiss' }));
    expect(actions.dismissReady).toHaveBeenCalledTimes(1);
    unmount();
    state({ attempt: 'succeeded', readyDismissed: true });
    expect(render(<VbCableNotice variant="row" />).container).toBeEmptyDOMElement();
  });

  it('modal: the dialog carries the prompt title; Not now; no × on ready', () => {
    const onNotNow = vi.fn();
    const { unmount } = render(<VbCableNotice variant="modal" onNotNow={onNotNow} />);
    expect(screen.queryByText('vbCable.title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'vbCable.notNow' }));
    expect(onNotNow).toHaveBeenCalledTimes(1);
    unmount();
    presence.value = 'present';
    state({ attempt: 'succeeded' });
    render(<VbCableNotice variant="modal" onNotNow={onNotNow} />);
    expect(screen.getByText('vbCable.readyTitle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.dismiss' })).toBeNull();
  });

  it('loads the store when it mounts', () => {
    render(<VbCableNotice variant="row" />);
    expect(actions.load).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/VbCable/VbCableNotice.test.tsx`
Expected: FAIL with "Failed to resolve import ./VbCableNotice".

- [ ] **Step 3: Write the component**

```tsx
// src/components/VbCable/VbCableNotice.tsx
import React, { useEffect } from 'react';
import { CheckCircle2, ExternalLink, Info, Loader2, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { VB_AUDIO_URL, VB_CABLE_SETUP_FILE } from '../../lib/audio/vbCable';
import { virtualMicrophoneName } from '../../lib/audio/virtualSpeaker';
import { useVbCablePresence, useVbCableStore } from '../../stores/vbCableStore';
import { openExternalUrl } from '../../utils/openExternalUrl';
import './VbCable.scss';

export interface VbCableNoticeProps {
  /** `row`: under "Translation the other side hears"; `modal`: the one-time introduction, whose dialog carries the title. */
  variant: 'row' | 'modal';
  /** The modal's "Not now". */
  onNotNow?: () => void;
}

function Notice({ title, showTitle, live, children }: { title: string; showTitle: boolean; live?: boolean; children: React.ReactNode }) {
  return (
    <div className="vbcable-notice" role={live ? 'status' : 'note'}>
      <Info size={16} aria-hidden="true" className="vbcable-notice__icon" />
      <div className="vbcable-notice__content">
        {showTitle && <div className="vbcable-notice__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/**
 * VB-CABLE's state on Windows, in one place (spec 2026-10-17 §4): the offer
 * while it is missing (an install in the website's build, a link in the
 * Store's), the install's progress or failure, and the ready line after an
 * install Sokuji started. Nothing otherwise.
 */
const VbCableNotice: React.FC<VbCableNoticeProps> = ({ variant, onNotNow }) => {
  const { t } = useTranslation();
  const presence = useVbCablePresence();
  const channel = useVbCableStore((s) => s.channel);
  const attempt = useVbCableStore((s) => s.attempt);
  const readyDismissed = useVbCableStore((s) => s.readyDismissed);
  const load = useVbCableStore((s) => s.load);
  const install = useVbCableStore((s) => s.install);
  const checkAgain = useVbCableStore((s) => s.checkAgain);
  const dismissReady = useVbCableStore((s) => s.dismissReady);
  useEffect(() => { void load(); }, [load]);

  const inModal = variant === 'modal';
  const primary = 'vbcable-notice__btn vbcable-notice__btn--primary';
  const secondary = 'vbcable-notice__btn vbcable-notice__btn--secondary';
  const notNow = inModal && onNotNow
    ? <button type="button" className={secondary} onClick={onNotNow}>{t('vbCable.notNow', 'Not now')}</button>
    : null;
  const link = (label: string, className = secondary) => (
    <button type="button" className={className} onClick={() => openExternalUrl(VB_AUDIO_URL)}>
      {label}<ExternalLink size={12} aria-hidden="true" />
    </button>
  );
  const checkAgainButton = <button type="button" className={secondary} onClick={() => { void checkAgain(); }}>{t('vbCable.checkAgain', 'Check again')}</button>;
  const promptTitle = t('vbCable.title', 'Let the other side hear the translation');
  const body = <p>{t('vbCable.body')}</p>;

  if (presence === 'present') {
    if (attempt === 'none' || readyDismissed) return null;
    return (
      <div className="vbcable-notice vbcable-notice--ready" role="status">
        <CheckCircle2 size={16} aria-hidden="true" className="vbcable-notice__icon" />
        <span className="vbcable-notice__content">
          <strong>{t('vbCable.readyTitle', 'VB-CABLE is ready.')}</strong>{' '}
          {t('vbCable.readyBody', { mic: virtualMicrophoneName(), defaultValue: 'In your meeting app, choose "{{mic}}" as the microphone.' })}
        </span>
        {!inModal && (
          <button type="button" className="vbcable-notice__close" aria-label={t('common.dismiss', 'Dismiss')} onClick={dismissReady}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }
  if (presence !== 'missing' || channel === null) return null;

  if (channel === 'store') {
    return (
      <Notice title={promptTitle} showTitle={!inModal}>
        {body}
        <ol className="vbcable-notice__steps">
          <li>{t('vbCable.storeStep1')}</li>
          <li><Trans i18nKey="vbCable.storeStep2" values={{ file: VB_CABLE_SETUP_FILE }} components={{ code: <code /> }} /></li>
          <li>{t('vbCable.storeStep3')}</li>
        </ol>
        <div className="vbcable-notice__actions">
          {link(t('vbCable.openWebsite', 'Open VB-Audio website'), primary)}
          {checkAgainButton}
          {notNow}
        </div>
        <p className="vbcable-notice__foot">{t('vbCable.picksUp')}</p>
      </Notice>
    );
  }

  if (attempt === 'running' || attempt === 'succeeded') {
    return (
      <Notice title={t('vbCable.installingTitle', 'Installing VB-CABLE…')} showTitle live>
        <p>{t('vbCable.installingBody')}</p>
        <div className="vbcable-notice__actions">
          {attempt === 'running'
            ? (
              <button type="button" className={`${secondary} vbcable-notice__btn--busy`} disabled>
                <Loader2 size={12} aria-hidden="true" className="spinning" />{t('vbCable.installingBusy', 'Installing…')}
              </button>
            )
            : checkAgainButton}
          {notNow}
        </div>
      </Notice>
    );
  }

  if (attempt === 'failed') {
    return (
      <Notice title={t('vbCable.failedTitle', "VB-CABLE wasn't installed")} showTitle>
        <p>{t('vbCable.failedBody')}</p>
        <div className="vbcable-notice__actions">
          <button type="button" className={primary} onClick={() => { void install(); }}>{t('vbCable.retry', 'Try again')}</button>
          {link(t('vbCable.installYourself', 'Install it yourself'))}
          {notNow}
        </div>
      </Notice>
    );
  }

  return (
    <Notice title={promptTitle} showTitle={!inModal}>
      {body}
      <div className="vbcable-notice__actions">
        <button type="button" className={primary} onClick={() => { void install(); }}>{t('vbCable.install', 'Install VB-CABLE')}</button>
        {link(t('vbCable.about', 'About VB-CABLE'))}
        {notNow}
      </div>
      <p className="vbcable-notice__foot">{t('vbCable.adminOnce')}</p>
    </Notice>
  );
};

export default VbCableNotice;
```

```scss
// src/components/VbCable/VbCable.scss
// The VB-CABLE notice (spec 2026-10-17 §4), in the Settings info-banner's
// colours (Settings.scss `.translate-info-banner .info-banner`).
@use '../Settings/shared/variables' as vars;

.vbcable-notice {
  margin-top: 8px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  background: rgba(vars.$color-primary, 0.1);
  border: 1px solid rgba(vars.$color-primary, 0.3);
  border-radius: 6px;
  font-size: vars.$font-body;
  line-height: 1.45;
  color: vars.$text-secondary;

  &--ready { padding: 10px 12px; }

  &__icon { flex-shrink: 0; margin-top: 2px; color: vars.$color-primary; }
  &__content { flex: 1; min-width: 0; }
  &__title { font-weight: 600; color: vars.$text-primary; margin-bottom: 2px; }
  strong { color: vars.$text-primary; font-weight: 600; }
  p { margin: 0; }
  // Spelled out, not `&__foot`: nested it outranks `p` above (0,2,0 over 0,1,1).
  .vbcable-notice__foot { margin-top: 8px; font-size: vars.$font-caption; color: vars.$text-muted; }

  &__steps {
    margin: 8px 0 0;
    padding-left: 18px;
    li { margin-top: 2px; }
    code { font-family: Consolas, 'Cascadia Mono', monospace; font-size: vars.$font-caption; color: vars.$text-primary; }
  }

  &__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

  &__btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    font: inherit;
    border-radius: vars.$radius-sm;
    border: 1px solid vars.$border-default;
    cursor: pointer;

    &:focus-visible { @include vars.focus-ring; }
    &:disabled { @include vars.disabled-state; }

    &--primary {
      background: vars.$color-primary-fill;
      border-color: vars.$color-primary-fill;
      color: vars.$color-on-primary;
      font-weight: 500;
      &:hover:not(:disabled) { background: vars.$color-primary-fill-hover; border-color: vars.$color-primary-fill-hover; }
    }
    &--secondary {
      background: vars.$bg-control;
      color: vars.$text-primary;
      &:hover:not(:disabled) { background: vars.$bg-elevated; }
    }
  }

  &__close {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin: -1px -4px 0 0;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: vars.$radius-sm;
    color: vars.$text-muted;
    cursor: pointer;

    &:hover { color: vars.$text-primary; background: vars.$bg-control; }
    &:focus-visible { @include vars.focus-ring; }
  }
}
```

- [ ] **Step 4: Run tests and compile the stylesheet**

Run: `npx vitest run src/components/VbCable/VbCableNotice.test.tsx`
Expected: PASS (11 tests).

Run: `npx sass --load-path=node_modules src/components/VbCable/VbCable.scss > /dev/null`
Expected: exit 0. If a token is missing from `vars` (`$color-on-primary`, `$color-primary-fill`, `$bg-elevated`), use it via `@use '../../styles/tokens' as tk;` instead, as `Settings.scss` does.

- [ ] **Step 5: Commit**

```bash
git add src/components/VbCable
git commit -m "feat(settings): VB-CABLE notice for every install state"
```

---

### Task 8: The Speech row, the modal, and the layout mount

**Files:**
- Modify: `src/components/Settings/sections/SpeechOutputSection.tsx`. Imports; the `hasVirtualBus` line (`:130`); the "Translation the other side hears" row's `footer` (`:207`).
- Create: `src/components/VbCable/VbCableIntro.tsx`
- Modify: `src/components/MainLayout/MainLayout.tsx:222`
- Modify: `src/components/MainLayout/MainLayout.setup.test.tsx`, `src/components/MainLayout/MainLayout.keepAlive.test.tsx`. Each gets a mock line.
- Test: `src/components/Settings/sections/SpeechOutputSection.test.tsx` (append), `src/components/VbCable/VbCableIntro.test.tsx`

**Interfaces:**
- Consumes: `VbCableNotice` (Task 7); `useVbCablePresence`, `useVbCableStore` (Task 5); `speechFromStores`, `faceToFaceFromStores` (`src/lib/session/appShape.ts`); `useTour` (`src/components/Tour/TourProvider.tsx`); `Modal` (`src/components/Modal/Modal.tsx`).
- Produces: `default export VbCableIntro: React.FC`, mounted once in `MainLayout`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/Settings/sections/SpeechOutputSection.test.tsx`.
- Mock: add this next to the other `vi.mock` calls at the top of the file, before the imports:

```tsx
vi.mock('../../VbCable/VbCableNotice', () => ({ default: ({ variant }: { variant: string }) => <div data-testid={`vbcable-${variant}`} /> }));
```

- Tests: add at the end of the file:

```tsx
describe('SpeechOutputSection — VB-CABLE on Windows (spec 2026-10-17 §4)', () => {
  const SPEAKERS = { deviceId: 'spk', label: 'Speakers (Realtek(R) Audio)' };
  const CABLE = { deviceId: 'cable', label: 'CABLE Input (VB-Audio Virtual Cable)' };
  const field = () => row('Translation the other side hears').querySelector('.setting-row__field');

  beforeEach(() => { env.os = 'win'; });
  afterEach(() => { useAudioStore.setState({ devicesLoaded: false }); });

  it('missing: no virtual-microphone field, no Passthrough, the notice under the row', () => {
    useAudioStore.setState({ devicesLoaded: true, audioMonitorDevices: [SPEAKERS], selectedMonitorDevice: SPEAKERS });
    mount();
    expect(field()).toBeNull();
    expect(screen.queryByText('Passthrough')).toBeNull();
    expect(within(row('Translation the other side hears')).getByTestId('vbcable-row')).toBeInTheDocument();
  });

  it('present: the field and Passthrough are back, and the notice stays mounted for the ready line', () => {
    useAudioStore.setState({ devicesLoaded: true, audioMonitorDevices: [SPEAKERS, CABLE], selectedMonitorDevice: SPEAKERS });
    mount();
    expect(field()?.textContent).toBe('Virtual microphone · CABLE Output (VB-Audio Virtual Cable)');
    expect(screen.getByText('Passthrough')).toBeInTheDocument();
    expect(screen.getByTestId('vbcable-row')).toBeInTheDocument();
  });

  it('not before the device list is known: the field as before, no notice content decided yet', () => {
    useAudioStore.setState({ devicesLoaded: false, audioMonitorDevices: [] });
    mount();
    expect(field()).not.toBeNull();
  });

  it('nothing while the translation is not spoken', () => {
    useAudioStore.setState({ devicesLoaded: true, audioMonitorDevices: [SPEAKERS], selectedMonitorDevice: SPEAKERS });
    useSettingsStore.setState({ textOnly: true });
    mount();
    expect(screen.queryByTestId('vbcable-row')).toBeNull();
  });

  it('not on macOS, where the virtual microphone is Sokuji\'s own', () => {
    env.os = 'mac';
    useAudioStore.setState({ devicesLoaded: true, audioMonitorDevices: [SPEAKERS], selectedMonitorDevice: SPEAKERS });
    mount();
    expect(screen.queryByTestId('vbcable-row')).toBeNull();
  });
});
```

Create `src/components/VbCable/VbCableIntro.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { VbCablePresence } from '../../lib/audio/vbCable';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const presence = vi.hoisted(() => ({ value: 'missing' as VbCablePresence }));
vi.mock('../../stores/vbCableStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/vbCableStore')>()),
  useVbCablePresence: () => presence.value,
}));
const tour = vi.hoisted(() => ({ active: false }));
vi.mock('../Tour/TourProvider', () => ({ useTour: () => ({ active: tour.active }) }));
const speech = vi.hoisted(() => ({ other: true, faceToFace: false }));
vi.mock('../../lib/session/appShape', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/session/appShape')>()),
  speechFromStores: () => ({ other: speech.other, me: false, them: false }),
  faceToFaceFromStores: () => speech.faceToFace,
}));
vi.mock('./VbCableNotice', () => ({
  default: ({ variant, onNotNow }: { variant: string; onNotNow?: () => void }) => (
    <div data-testid={`notice-${variant}`}><button type="button" onClick={onNotNow}>not-now</button></div>
  ),
}));

import { useVbCableStore, type VbCableState } from '../../stores/vbCableStore';
import VbCableIntro from './VbCableIntro';

const actions = { load: vi.fn(async () => {}), install: vi.fn(async () => {}), checkAgain: vi.fn(async () => {}), dismissReady: vi.fn(), markIntroSeen: vi.fn() };
const state = (s: Partial<VbCableState>) => useVbCableStore.setState({ channel: 'website', introSeen: false, attempt: 'none', readyDismissed: false, ...actions, ...s });
const dialog = () => screen.queryByRole('dialog');

beforeEach(() => {
  presence.value = 'missing';
  tour.active = false;
  speech.other = true;
  speech.faceToFace = false;
  Object.values(actions).forEach((a) => a.mockClear());
  state({});
});

describe('VbCableIntro', () => {
  it('opens once VB-CABLE is missing and the translation is spoken into the virtual microphone', () => {
    render(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByTestId('notice-modal')).toBeInTheDocument();
  });

  it('opens in the Store build too, with the notice deciding what to offer', () => {
    state({ channel: 'store' });
    render(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
  });

  it('stays shut when seen, not yet loaded, or the channel is unknown', () => {
    for (const s of [{ introSeen: true }, { introSeen: null }, { channel: null }] as Partial<VbCableState>[]) {
      state(s);
      const { unmount } = render(<VbCableIntro />);
      expect(dialog()).toBeNull();
      unmount();
    }
  });

  it('stays shut when the translation is not spoken, in face-to-face, or while the list is unknown or VB-CABLE is there', () => {
    speech.other = false;
    let r = render(<VbCableIntro />);
    expect(dialog()).toBeNull();
    r.unmount();
    speech.other = true;
    speech.faceToFace = true;
    r = render(<VbCableIntro />);
    expect(dialog()).toBeNull();
    r.unmount();
    speech.faceToFace = false;
    for (const p of ['unknown', 'present', 'not-applicable'] as const) {
      presence.value = p;
      r = render(<VbCableIntro />);
      expect(dialog()).toBeNull();
      r.unmount();
    }
  });

  it('waits for the tour to end', () => {
    tour.active = true;
    const r = render(<VbCableIntro />);
    expect(dialog()).toBeNull();
    tour.active = false;
    r.rerender(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
  });

  it('stays open when the driver lands during the install', () => {
    const r = render(<VbCableIntro />);
    presence.value = 'present';
    state({ attempt: 'running' });
    r.rerender(<VbCableIntro />);
    expect(dialog()).toBeInTheDocument();
  });

  it('Not now closes it and marks it seen; a ready line it showed is dismissed with it', () => {
    const r = render(<VbCableIntro />);
    fireEvent.click(screen.getByText('not-now'));
    expect(dialog()).toBeNull();
    expect(actions.markIntroSeen).toHaveBeenCalledTimes(1);
    expect(actions.dismissReady).not.toHaveBeenCalled();
    r.unmount();
    const again = render(<VbCableIntro />);
    presence.value = 'present';
    state({ attempt: 'succeeded' });
    // VbCableIntro selects no `attempt`, so only a re-render reads the new presence.
    again.rerender(<VbCableIntro />);
    fireEvent.click(screen.getByText('not-now'));
    expect(actions.dismissReady).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/Settings/sections/SpeechOutputSection.test.tsx src/components/VbCable/VbCableIntro.test.tsx`
Expected: FAIL. VbCableIntro does not exist; the Windows "missing" test still finds the field and Passthrough.

- [ ] **Step 3: Implement**

In `SpeechOutputSection.tsx`, add these imports:

```tsx
import VbCableNotice from '../../VbCable/VbCableNotice';
import { useVbCablePresence } from '../../../stores/vbCableStore';
```

Replace `const hasVirtualBus = platform !== 'web';` with:

```tsx
  const vbCable = useVbCablePresence();
  // On Windows the virtual microphone is VB-CABLE, a driver the user installs: while it is
  // missing there is no device to name and nothing for Passthrough to mix into (spec 2026-10-17 §4).
  const hasVirtualBus = platform !== 'web' && vbCable !== 'missing';
```

Replace the row's `footer={otherOn && <VoiceLine leg="speaker" locked={isSessionActive} />}` with:

```tsx
        footer={otherOn && (
          <>
            {!faceToFace && vbCable !== 'not-applicable' && <VbCableNotice variant="row" />}
            <VoiceLine leg="speaker" locked={isSessionActive} />
          </>
        )}
```

Create `src/components/VbCable/VbCableIntro.tsx`:

```tsx
// src/components/VbCable/VbCableIntro.tsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../Modal/Modal';
import { useTour } from '../Tour/TourProvider';
import { faceToFaceFromStores, speechFromStores } from '../../lib/session/appShape';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useTextOnly } from '../../stores/settingsStore';
import { useVbCablePresence, useVbCableStore } from '../../stores/vbCableStore';
import VbCableNotice from './VbCableNotice';

/**
 * The one-time introduction to VB-CABLE on Windows (spec 2026-10-17 §4). It
 * opens once the translation is spoken into a virtual microphone that is not
 * there, after the tour, and stays open through the install until closed.
 */
const VbCableIntro: React.FC = () => {
  const { t } = useTranslation();
  const { active: tourActive } = useTour();
  const presence = useVbCablePresence();
  const channel = useVbCableStore((s) => s.channel);
  const introSeen = useVbCableStore((s) => s.introSeen);
  const load = useVbCableStore((s) => s.load);
  const markIntroSeen = useVbCableStore((s) => s.markIntroSeen);
  const dismissReady = useVbCableStore((s) => s.dismissReady);
  // Subscribed: who hears what is read from these stores below.
  useTextOnly();
  useAudioStore((s) => s.mode);
  useAudioStore((s) => s.otherSide);
  useProviderStore((s) => s.selected);
  useProviderStore((s) => s.entries);
  useRoutingStore((s) => s.participantSpeech);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (presence !== 'not-applicable') void load();
  }, [presence, load]);

  const wanted = presence === 'missing' && channel !== null && introSeen === false && !tourActive
    && speechFromStores().other && !faceToFaceFromStores();
  useEffect(() => {
    if (wanted) setOpen(true);
  }, [wanted]);

  if (!open) return null;
  const close = () => {
    setOpen(false);
    markIntroSeen();
    // A ready line the user has just read here need not wait for them in the settings.
    if (presence === 'present') dismissReady();
  };
  return (
    <Modal isOpen onClose={close} title={t('vbCable.title', 'Let the other side hear the translation')}>
      <VbCableNotice variant="modal" onNotNow={close} />
    </Modal>
  );
};

export default VbCableIntro;
```

In `MainLayout.tsx`, add `import VbCableIntro from '../VbCable/VbCableIntro';` next to the `TourOverlay` import, and below `{!electronSubtitleTakeover && <TourOverlay />}` add:

```tsx
    {!electronSubtitleTakeover && <VbCableIntro />}
```

In `MainLayout.setup.test.tsx` and `MainLayout.keepAlive.test.tsx`, next to their `TourOverlay` mock, add:

```tsx
vi.mock('../VbCable/VbCableIntro', () => ({ default: () => <div data-testid="vbcable-intro" /> }));
```

In `MainLayout.setup.test.tsx`, inside `describe('MainLayout first-run gating (spec §1.1)', …)`, after `it('drops the tour overlay during an Electron subtitle takeover', …)`, add:

```tsx
  it('mounts the VB-CABLE introduction with the layout, never with the first-run wizard', () => {
    render(<MainLayout />);
    expect(screen.getByTestId('vbcable-intro')).toBeInTheDocument();
    cleanup();
    complete = false;
    render(<MainLayout />);
    expect(screen.queryByTestId('vbcable-intro')).toBeNull();
  });

  it('drops the VB-CABLE introduction during an Electron subtitle takeover', () => {
    flags.electron = true; flags.subtitleActive = true;
    render(<MainLayout />);
    expect(screen.queryByTestId('vbcable-intro')).toBeNull();
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/SpeechOutputSection.test.tsx src/components/VbCable src/components/MainLayout`
Expected: PASS, the existing Speech tests included. The old Windows field test still passes because `devicesLoaded` is false there, so presence is `unknown`.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/SpeechOutputSection.tsx src/components/Settings/sections/SpeechOutputSection.test.tsx src/components/VbCable src/components/MainLayout
git commit -m "feat(settings): offer VB-CABLE in the Speech row and once as a modal"
```

---

### Task 9: CI coverage and the branch check

**Files:**
- Modify: `.github/workflows/build.yml:56-78` (the `test (diagnostics)` file list)

- [ ] **Step 1: Add the new suites to the CI list**

Append after `electron/squirrel-nuspec.consistency.test.js`:

```yaml
          electron/distribution-channel.test.js
          electron/vb-cable-installer.test.js
          electron/vbcable.wiring.test.js
          electron/ipc-channels.test.js
          src/stores/vbCableStore.test.ts
          src/components/VbCable
          src/locales/locales.consistency.test.ts
```

(`src/lib/audio` is already listed, so `vbCable.test.ts` runs.)

- [ ] **Step 2: Run exactly what CI runs, plus the touched neighbours**

Run:

```bash
npx vitest run src/lib/diagnostics src/lib/errorTracking.test.ts src/stores/logStore.test.ts src/stores/sanitizeEvent.test.ts src/components/LogsPanel src/lib/local-inference src/lib/contract src/lib/conversation src/lib/projection src/lib/export src/lib/session src/lib/audio src/lib/provider src/providers src/stores/providerStore.test.ts src/stores/providerStore.readiness.test.ts src/stores/turnModeStore.test.ts src/stores/routingStore.test.ts src/components/providers src/components/dev src/utils/featureGateForwarding.consistency.test.ts electron/squirrel-nuspec.consistency.test.js electron/distribution-channel.test.js electron/vb-cable-installer.test.js electron/vbcable.wiring.test.js electron/ipc-channels.test.js src/stores/vbCableStore.test.ts src/components/VbCable src/locales/locales.consistency.test.ts src/components/Settings/sections/SpeechOutputSection.test.tsx src/components/MainLayout
```

Expected: all PASS. If a file fails, check whether it already fails on `origin/main` (`git worktree add --detach "$CLAUDE_JOB_DIR/tmp/main-check" origin/main`, run the same file there, then `git worktree remove "$CLAUDE_JOB_DIR/tmp/main-check"`). A failure that exists on main is reported, not fixed here.

- [ ] **Step 3: Typecheck the touched files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "vbCable|VbCable|SpeechOutputSection|MainLayout|vbCableStore" || echo "no errors in touched files"`
Expected: `no errors in touched files`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: run the VB-CABLE suites in the diagnostics job"
```

- [ ] **Step 5: Hand over**

Report to the owner in Chinese: the commits, the test runs, and the live-test checklist from the spec ("Live test", items 1-4). Ask before pushing `worktree-vbcable-channels` to `kizuna-ai-lab/sokuji` or opening a PR.
