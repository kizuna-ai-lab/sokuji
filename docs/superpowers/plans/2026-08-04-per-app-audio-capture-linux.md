# Per-Application Audio Capture — Source Seam + Linux (PipeWire) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user choose *which application's* audio Sokuji captures as participant audio instead of always capturing the whole system, and implement that choice end-to-end on Linux/PipeWire.

**Architecture:** The participant-audio source becomes a user-selectable list instead of the hardcoded `'desktop-audio-loopback'`. On Linux, selecting an application makes the main process create a null sink and `pw-link` that application's output ports to it **in parallel** with the app's existing sink (the app keeps playing to the speakers); the renderer then captures that sink's monitor as an ordinary input device via `getUserMedia`. A new `DeviceCaptureRecorder` implements the existing `IParticipantAudioRecorder` seam for the device-based path, sitting beside the untouched `LoopbackRecorder`.

**Tech Stack:** Electron 40 main process (CommonJS, `electron/*.js`), `pactl` + `pw-link` + `pw-dump` CLIs, TypeScript renderer, Zustand, React 19, Vitest, i18next.

**Issue:** https://github.com/kizuna-ai-lab/sokuji/issues/335

## Global Constraints

- **Scope is the source seam + Linux only.** Windows (WASAPI process loopback) and macOS (Core Audio taps) each get their own follow-up plan and are explicitly out of scope here. Windows/macOS behaviour must not change: they keep returning the single `'desktop-audio-loopback'` source.
- **No new npm dependencies.** Linux capture shells out to `pactl` / `pw-link` / `pw-dump`, which the repo already uses in `electron/pulseaudio-utils.js`.
- The app's existing audio must keep playing to its original sink. Linking is **additive** — never move a stream off its sink.
- All comments and documentation are **English only** (project CLAUDE.md).
- Every user-facing string goes through `t('key', 'English default')`. Any key added to `src/locales/en/translation.json` **must also be added to the other 31 locale directories** — `src/locales/locales.consistency.test.ts` asserts exact key parity and will fail otherwise. (`ls src/locales/ | wc -l` → 32.)
- Adding a renderer→main IPC channel = add its name to `INVOKE_CHANNELS` in `electron/ipc-channels.js`. The allowlist in `preload.js` and the guard in `ipc-channels.test.js` follow automatically. **This plan adds no new channels** — it reuses `list-system-audio-sources`, `connect-system-audio-source`, `disconnect-system-audio-source`, which already exist and are already allowlisted (`electron/ipc-channels.js:44-48`).
- **Do not gate on `tsc`.** The repo has ~113 pre-existing type errors; the build is Vite/esbuild and the correctness gate is Vitest.
- Conventional commit format.
- Run single test files with `npx vitest run <path>` (the `npm run test` script starts watch mode). Main-process tests under `electron/` are also Vitest.
- Every `pactl load-module` in a task must have a matching unload in teardown. A leaked null sink is a user-visible bogus audio device that survives app exit.

## Verified Facts (measured on a live PipeWire box, 2026-08-04)

Do not re-derive these; they were confirmed by experiment and the plan depends on them.

1. An application playing audio appears in `pw-dump` as an object with
   `type === "PipeWire:Interface:Node"` and `info.props["media.class"] === "Stream/Output/Audio"`.
   Useful props: `node.name`, `application.name`, `application.process.binary`,
   `application.process.id`. The object's own numeric `id` is the node id.
2. Ports appear as `type === "PipeWire:Interface:Port"` objects with
   `info.props["node.id"]` pointing at their node, `info.direction` of `"output"` or
   `"input"`, and `info.props["port.name"]` like `output_FL` / `playback_FL`.
3. `pw-link <outputPortId> <inputPortId>` **accepts numeric port ids** and creates the link.
   Numeric ids are required rather than `name:port` strings because two instances of the
   same application share a `node.name` and cannot be told apart by name.
4. Linking an app's output ports to a second sink is **additive**: after linking,
   `pw-link -l` showed `paplay:output_FL` going to *both* `sokuji_probe_sink:playback_FL`
   and `sokuji_capture_sink:playback_FL`. The app kept playing to its original sink.
5. `pactl load-module module-null-sink sink_name=X sink_properties=device.description=Y`
   prints the module id on stdout, and the sink's monitor then appears in
   `pactl list sources short` as `X.monitor` with description `Monitor of Y`.
6. Chromium surfaces that monitor to `navigator.mediaDevices.enumerateDevices()` as an
   `audioinput` whose **label contains the description** (`Monitor of Y`). The opaque
   Chromium `deviceId` cannot be predicted, so the renderer must match on label.

## Prerequisite: install dependencies

This plan is meant to run in a git worktree, and **a fresh worktree has no
`node_modules`** — git does not copy untracked directories. Every `npx vitest`
step below fails with "vitest: not found" until this is done once:

```bash
npm install
```

The root `postinstall` runs `electron-rebuild` and `scripts/copy-ort-wasm.sh`; both are
expected and take a few minutes.

> **Known worktree gotcha:** a fresh `npm install` in a worktree resets permissions on
> Electron's `chrome-sandbox`, and the app will refuse to launch until it is fixed:
> ```bash
> sudo chown root:root node_modules/electron/dist/chrome-sandbox
> sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
> ```
> This only matters for Task 11 (real-app verification). Do **not** work around it by
> passing `--no-sandbox`; the repo disables that flag deliberately.

Verify the baseline with a file untouched by this plan:

```bash
npx vitest run src/lib/modern-audio/ModernBrowserAudioService.test.ts
```

Expected: PASS. If it does not, fix the environment before starting Task 1 — a red
baseline makes every "verify it fails" step meaningless.

---

### Task 1: Parse per-application audio streams out of `pw-dump`

Pure parsing, no PipeWire required to test.

**Files:**
- Create: `electron/pipewire-app-audio.js`
- Test: `electron/pipewire-app-audio.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseAppStreams(dump: object[]) => Array<{ deviceId: string, label: string, nodeId: number, pid: number|null, binary: string|null }>`.
  `deviceId` is `` `app:${nodeId}` ``. Later tasks depend on that exact prefix.

- [ ] **Step 1: Write the failing test**

Create `electron/pipewire-app-audio.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseAppStreams } from './pipewire-app-audio.js';

// Shapes copied from a real `pw-dump` on PipeWire 1.x.
const NODE_STREAM = {
  id: 205,
  type: 'PipeWire:Interface:Node',
  info: {
    props: {
      'media.class': 'Stream/Output/Audio',
      'node.name': 'Chromium',
      'application.name': 'Chromium',
      'application.process.binary': 'chromium',
      'application.process.id': 4242,
    },
  },
};
const NODE_SINK = {
  id: 60,
  type: 'PipeWire:Interface:Node',
  info: { props: { 'media.class': 'Audio/Sink', 'node.name': 'alsa_output.hdmi' } },
};
const PORT = { id: 91, type: 'PipeWire:Interface:Port', info: { direction: 'output', props: { 'node.id': 205 } } };

describe('parseAppStreams', () => {
  it('returns one entry per playback stream, keyed app:<nodeId>', () => {
    expect(parseAppStreams([NODE_STREAM, NODE_SINK, PORT])).toEqual([
      { deviceId: 'app:205', label: 'Chromium', nodeId: 205, pid: 4242, binary: 'chromium' },
    ]);
  });

  it('ignores sinks, ports and non-audio nodes', () => {
    expect(parseAppStreams([NODE_SINK, PORT])).toEqual([]);
  });

  it('falls back to node.name then binary when application.name is absent', () => {
    const noAppName = {
      id: 7, type: 'PipeWire:Interface:Node',
      info: { props: { 'media.class': 'Stream/Output/Audio', 'node.name': 'mpv', 'application.process.binary': 'mpv' } },
    };
    expect(parseAppStreams([noAppName])[0].label).toBe('mpv');
  });

  it('disambiguates two instances of the same app by appending the pid', () => {
    const a = JSON.parse(JSON.stringify(NODE_STREAM));
    const b = JSON.parse(JSON.stringify(NODE_STREAM));
    b.id = 206;
    b.info.props['application.process.id'] = 4243;
    expect(parseAppStreams([a, b]).map(s => s.label))
      .toEqual(['Chromium (4242)', 'Chromium (4243)']);
  });

  it('tolerates malformed objects without throwing', () => {
    expect(parseAppStreams([null, {}, { type: 'PipeWire:Interface:Node' }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/pipewire-app-audio.test.js`
Expected: FAIL — cannot resolve `./pipewire-app-audio.js`.

- [ ] **Step 3: Write minimal implementation**

Create `electron/pipewire-app-audio.js`:

```javascript
/**
 * PipeWire per-application audio capture helpers.
 *
 * Applications that play audio appear in the PipeWire graph as
 * `Stream/Output/Audio` nodes. We tap one by linking its output ports to a
 * dedicated null sink *in addition to* its existing links, so the application
 * keeps playing to whatever sink it was already using.
 */

const STREAM_CLASS = 'Stream/Output/Audio';

/** Extract the selectable per-application audio streams from a `pw-dump` array. */
function parseAppStreams(dump) {
  if (!Array.isArray(dump)) return [];

  const streams = [];
  for (const obj of dump) {
    const props = obj?.info?.props;
    if (!props || obj.type !== 'PipeWire:Interface:Node') continue;
    if (props['media.class'] !== STREAM_CLASS) continue;

    const pidRaw = props['application.process.id'];
    const pid = typeof pidRaw === 'number' ? pidRaw : null;
    const binary = props['application.process.binary'] ?? null;
    const name = props['application.name'] ?? props['node.name'] ?? binary;
    if (typeof obj.id !== 'number' || !name) continue;

    streams.push({ deviceId: `app:${obj.id}`, label: name, nodeId: obj.id, pid, binary });
  }

  // Two windows of the same app produce identical labels; the picker would show
  // two indistinguishable rows. Suffix the pid only for the labels that collide.
  const seen = new Map();
  for (const s of streams) seen.set(s.label, (seen.get(s.label) ?? 0) + 1);
  for (const s of streams) {
    if (seen.get(s.label) > 1 && s.pid !== null) s.label = `${s.label} (${s.pid})`;
  }

  return streams;
}

module.exports = { parseAppStreams };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/pipewire-app-audio.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/pipewire-app-audio.js electron/pipewire-app-audio.test.js
git commit -m "feat(audio): parse per-application streams from pw-dump"
```

---

### Task 2: Resolve a node's ports to numeric port ids

**Files:**
- Modify: `electron/pipewire-app-audio.js`
- Test: `electron/pipewire-app-audio.test.js`

**Interfaces:**
- Consumes: `parseAppStreams` (same module).
- Produces: `resolvePortIds(dump, nodeId, direction) => number[]` — numeric PipeWire port
  ids for that node, sorted by `port.name` so channel order is stable and the FL/FR pairing
  in Task 3 is deterministic.

- [ ] **Step 1: Write the failing test**

Append to `electron/pipewire-app-audio.test.js`:

```javascript
import { resolvePortIds } from './pipewire-app-audio.js';

const port = (id, nodeId, direction, portName) => ({
  id, type: 'PipeWire:Interface:Port',
  info: { direction, props: { 'node.id': nodeId, 'port.name': portName } },
});

describe('resolvePortIds', () => {
  // Real dumps list FR before FL; sorting by port.name is what makes the
  // out[i] -> in[i] pairing in linkNodeToSink() line up channel-for-channel.
  const dump = [
    port(55, 205, 'output', 'output_FR'),
    port(91, 205, 'output', 'output_FL'),
    port(153, 300, 'input', 'playback_FL'),
    port(142, 300, 'input', 'playback_FR'),
    port(99, 999, 'output', 'output_FL'),
  ];

  it('returns this node\'s output port ids sorted by port name', () => {
    expect(resolvePortIds(dump, 205, 'output')).toEqual([91, 55]);
  });

  it('returns this node\'s input port ids sorted by port name', () => {
    expect(resolvePortIds(dump, 300, 'input')).toEqual([153, 142]);
  });

  it('returns an empty array for an unknown node', () => {
    expect(resolvePortIds(dump, 12345, 'output')).toEqual([]);
  });

  it('tolerates a malformed dump', () => {
    expect(resolvePortIds(null, 205, 'output')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/pipewire-app-audio.test.js`
Expected: FAIL — `resolvePortIds is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `electron/pipewire-app-audio.js`, add before `module.exports`:

```javascript
/**
 * Numeric port ids for one node, sorted by port name.
 *
 * pw-link is given numeric ids rather than `name:port` strings because two
 * instances of the same application share a node.name and cannot be told apart
 * by name. Sorting by port name makes out[i] <-> in[i] a stable FL/FR pairing.
 */
function resolvePortIds(dump, nodeId, direction) {
  if (!Array.isArray(dump)) return [];
  return dump
    .filter((o) =>
      o?.type === 'PipeWire:Interface:Port' &&
      o?.info?.direction === direction &&
      o?.info?.props?.['node.id'] === nodeId &&
      typeof o.id === 'number')
    .sort((a, b) =>
      String(a.info.props['port.name']).localeCompare(String(b.info.props['port.name'])))
    .map((o) => o.id);
}
```

Add `resolvePortIds` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/pipewire-app-audio.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/pipewire-app-audio.js electron/pipewire-app-audio.test.js
git commit -m "feat(audio): resolve PipeWire node ports to numeric ids"
```

---

### Task 3: Capture-sink lifecycle (create, link, destroy)

**Files:**
- Modify: `electron/pipewire-app-audio.js`
- Test: `electron/pipewire-app-audio.test.js`

**Interfaces:**
- Consumes: `parseAppStreams`, `resolvePortIds`.
- Produces:
  - `CAPTURE_SINK_NAME = 'sokuji_app_capture'`, `CAPTURE_SINK_DESCRIPTION = 'Sokuji App Capture'`
  - `async connectAppSource(deviceId, deps) => { success: boolean, monitorLabel?: string, error?: string }`
  - `async disconnectAppSource(deps) => { success: boolean }`
  - `async listAppSources(deps) => Array<{deviceId,label}>`

  `deps` is `{ exec }` where `exec(cmd) => Promise<{stdout: string}>`, injected so tests
  never touch a real PipeWire. Production callers pass the module default.

- [ ] **Step 1: Write the failing test**

Append to `electron/pipewire-app-audio.test.js`:

```javascript
import { connectAppSource, disconnectAppSource, listAppSources, CAPTURE_SINK_DESCRIPTION } from './pipewire-app-audio.js';

// A dump with one app (node 205, ports 91/55) and our capture sink (node 300, ports 153/142).
const FULL_DUMP = [
  { id: 205, type: 'PipeWire:Interface:Node', info: { props: {
      'media.class': 'Stream/Output/Audio', 'application.name': 'Chromium',
      'application.process.binary': 'chromium', 'application.process.id': 4242 } } },
  { id: 300, type: 'PipeWire:Interface:Node', info: { props: {
      'media.class': 'Audio/Sink', 'node.name': 'sokuji_app_capture' } } },
  port(91, 205, 'output', 'output_FL'),
  port(55, 205, 'output', 'output_FR'),
  port(153, 300, 'input', 'playback_FL'),
  port(142, 300, 'input', 'playback_FR'),
];

function fakeExec(calls, { dump = FULL_DUMP, moduleId = '536870913' } = {}) {
  return async (cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('pw-dump')) return { stdout: JSON.stringify(dump) };
    if (cmd.includes('load-module')) return { stdout: `${moduleId}\n` };
    return { stdout: '' };
  };
}

describe('connectAppSource', () => {
  it('creates the null sink and links every channel pair by numeric id', async () => {
    const calls = [];
    const r = await connectAppSource('app:205', { exec: fakeExec(calls) });

    expect(r.success).toBe(true);
    expect(r.monitorLabel).toBe(CAPTURE_SINK_DESCRIPTION);
    expect(calls.some(c => c.includes('load-module module-null-sink') && c.includes('sokuji_app_capture'))).toBe(true);
    expect(calls).toContain('pw-link 91 153');
    expect(calls).toContain('pw-link 55 142');
  });

  it('never moves the stream off its existing sink', async () => {
    const calls = [];
    await connectAppSource('app:205', { exec: fakeExec(calls) });
    // move-sink-input would steal the audio from the user's speakers.
    expect(calls.some(c => c.includes('move-sink-input'))).toBe(false);
  });

  it('rejects a deviceId that is not an app: id', async () => {
    const r = await connectAppSource('desktop-audio-loopback', { exec: fakeExec([]) });
    expect(r.success).toBe(false);
  });

  it('tears the sink back down when the target node has no ports', async () => {
    const calls = [];
    const dumpNoPorts = FULL_DUMP.filter(o => o.type !== 'PipeWire:Interface:Port');
    const r = await connectAppSource('app:205', { exec: fakeExec(calls, { dump: dumpNoPorts }) });

    expect(r.success).toBe(false);
    // A leaked null sink shows up as a bogus device in the user's system settings.
    expect(calls.some(c => c.includes('unload-module 536870913'))).toBe(true);
  });
});

describe('disconnectAppSource', () => {
  it('unloads the module recorded by connect and is idempotent', async () => {
    const calls = [];
    const exec = fakeExec(calls);
    await connectAppSource('app:205', { exec });

    expect((await disconnectAppSource({ exec })).success).toBe(true);
    expect(calls.some(c => c.includes('unload-module 536870913'))).toBe(true);

    const before = calls.length;
    expect((await disconnectAppSource({ exec })).success).toBe(true);
    expect(calls.length).toBe(before); // nothing left to unload
  });
});

describe('listAppSources', () => {
  it('returns only playback streams, projected to {deviceId,label}', async () => {
    // The capture sink in FULL_DUMP is an Audio/Sink, so it must not be listed.
    const sources = await listAppSources({ exec: fakeExec([]) });
    expect(sources).toEqual([{ deviceId: 'app:205', label: 'Chromium' }]);
  });

  it('never lists a leaked capture sink from a previous session', async () => {
    // A crashed session can leave a sink behind whose monitor gets re-adopted as
    // a stream; offering it would let the user capture Sokuji's own tap.
    const leaked = { id: 400, type: 'PipeWire:Interface:Node', info: { props: {
      'media.class': 'Stream/Output/Audio', 'application.name': 'Sokuji App Capture' } } };
    const sources = await listAppSources({ exec: fakeExec([], { dump: [...FULL_DUMP, leaked] }) });
    expect(sources.map(s => s.label)).toEqual(['Chromium']);
  });

  it('returns an empty array when pw-dump is unavailable', async () => {
    const exec = async () => { throw new Error('ENOENT'); };
    expect(await listAppSources({ exec })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/pipewire-app-audio.test.js`
Expected: FAIL — `connectAppSource is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `electron/pipewire-app-audio.js`, add before `module.exports`:

```javascript
const { exec: nodeExec } = require('child_process');
const { promisify } = require('util');
const defaultExec = promisify(nodeExec);

const CAPTURE_SINK_NAME = 'sokuji_app_capture';
const CAPTURE_SINK_DESCRIPTION = 'Sokuji App Capture';

// Module id of the null sink created by connectAppSource(), so disconnect can
// unload exactly the module we made rather than pattern-matching the graph.
let captureModuleId = null;

async function dumpGraph(exec) {
  const { stdout } = await exec('pw-dump');
  return JSON.parse(stdout);
}

/** List the applications currently playing audio. */
async function listAppSources({ exec = defaultExec } = {}) {
  try {
    return parseAppStreams(await dumpGraph(exec))
      // Our own capture sink's monitor is not a Stream/Output/Audio node, so it
      // cannot appear here — but a *previous* Sokuji session's leaked sink could
      // still be in the graph, and offering it would create a capture loop.
      .filter((s) => s.label !== CAPTURE_SINK_DESCRIPTION)
      .map(({ deviceId, label }) => ({ deviceId, label }));
  } catch (e) {
    console.warn('[Sokuji] [PipeWire] Failed to list application audio sources:', e.message);
    return [];
  }
}

/**
 * Tap one application's audio.
 *
 * Creates a dedicated null sink and links the application's output ports to it
 * *in addition to* the links it already has, so the user keeps hearing the app.
 */
async function connectAppSource(deviceId, { exec = defaultExec } = {}) {
  const nodeId = Number.parseInt(String(deviceId).replace(/^app:/, ''), 10);
  if (!String(deviceId).startsWith('app:') || Number.isNaN(nodeId)) {
    return { success: false, error: `Not an application source: ${deviceId}` };
  }

  // A previous selection must be torn down first, or its links keep feeding the
  // same capture sink and the user hears/translates both applications at once.
  await disconnectAppSource({ exec });

  try {
    const { stdout } = await exec(
      `pactl load-module module-null-sink sink_name=${CAPTURE_SINK_NAME} ` +
      `sink_properties=device.description="${CAPTURE_SINK_DESCRIPTION}"`
    );
    captureModuleId = stdout.trim();
  } catch (e) {
    return { success: false, error: `Failed to create capture sink: ${e.message}` };
  }

  try {
    const dump = await dumpGraph(exec);
    const sink = dump.find((o) =>
      o?.type === 'PipeWire:Interface:Node' &&
      o?.info?.props?.['node.name'] === CAPTURE_SINK_NAME);

    const outs = resolvePortIds(dump, nodeId, 'output');
    const ins = sink ? resolvePortIds(dump, sink.id, 'input') : [];
    if (outs.length === 0 || ins.length === 0) {
      throw new Error('no ports to link (the application may have stopped playing)');
    }

    for (let i = 0; i < Math.min(outs.length, ins.length); i++) {
      await exec(`pw-link ${outs[i]} ${ins[i]}`);
    }
    return { success: true, monitorLabel: CAPTURE_SINK_DESCRIPTION };
  } catch (e) {
    // Never leave the null sink behind: it would show up as a phantom audio
    // device in the user's system settings and outlive the app.
    await disconnectAppSource({ exec });
    return { success: false, error: `Failed to link application audio: ${e.message}` };
  }
}

/** Remove the capture sink. Links die with it. Safe to call when nothing is connected. */
async function disconnectAppSource({ exec = defaultExec } = {}) {
  if (!captureModuleId) return { success: true };
  try {
    await exec(`pactl unload-module ${captureModuleId}`);
  } catch (e) {
    console.warn('[Sokuji] [PipeWire] Failed to unload capture sink:', e.message);
  }
  captureModuleId = null;
  return { success: true };
}
```

Extend `module.exports` to:

```javascript
module.exports = {
  parseAppStreams, resolvePortIds,
  listAppSources, connectAppSource, disconnectAppSource,
  CAPTURE_SINK_NAME, CAPTURE_SINK_DESCRIPTION,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/pipewire-app-audio.test.js`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/pipewire-app-audio.js electron/pipewire-app-audio.test.js
git commit -m "feat(audio): add PipeWire capture-sink lifecycle for per-app tap"
```

---

### Task 4: Expose per-app sources through the Linux platform module

**Files:**
- Modify: `electron/pulseaudio-utils.js:267-276` (the `listSystemAudioSources` /
  `connectSystemAudioSource` / `disconnectSystemAudioSource` stubs) and its `module.exports`
- Test: `electron/pulseaudio-utils.appaudio.test.js` (new file — `pulseaudio-utils.js`
  has no test file today and this plan does not add coverage for its unrelated exports)

**Interfaces:**
- Consumes: `listAppSources`, `connectAppSource`, `disconnectAppSource` from Task 3.
- Produces: the three platform functions now handle both `'desktop-audio-loopback'` and
  `'app:<nodeId>'`, and each takes an **optional trailing `deps` argument** that is forwarded
  to Task 3. `connectSystemAudioSource(sourceId, deps?)` resolves to
  `{ success: boolean, monitorLabel?: string, error?: string }` — Task 6 reads `monitorLabel`.
  `electron/main.js` calls them with one argument (or none) and therefore gets the real
  `exec`; no change is needed there.

**Why injection rather than `vi.mock`:** `pulseaudio-utils.js` is CommonJS and reaches
`pipewire-app-audio.js` through `require()`. Intercepting a CJS `require()` with `vi.mock` is
unreliable, so these tests thread the same `{ exec }` seam Task 3 already exposes. No module
mocking is involved.

- [ ] **Step 1: Write the failing test**

Create `electron/pulseaudio-utils.appaudio.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  listSystemAudioSources, connectSystemAudioSource, disconnectSystemAudioSource,
} from './pulseaudio-utils.js';

const DUMP = [
  { id: 205, type: 'PipeWire:Interface:Node', info: { props: {
      'media.class': 'Stream/Output/Audio', 'application.name': 'Chromium',
      'application.process.id': 4242 } } },
  { id: 300, type: 'PipeWire:Interface:Node', info: { props: {
      'media.class': 'Audio/Sink', 'node.name': 'sokuji_app_capture' } } },
  { id: 91, type: 'PipeWire:Interface:Port',
    info: { direction: 'output', props: { 'node.id': 205, 'port.name': 'output_FL' } } },
  { id: 153, type: 'PipeWire:Interface:Port',
    info: { direction: 'input', props: { 'node.id': 300, 'port.name': 'playback_FL' } } },
];

let calls;
const exec = async (cmd) => {
  calls.push(cmd);
  if (cmd.startsWith('pw-dump')) return { stdout: JSON.stringify(DUMP) };
  if (cmd.includes('load-module')) return { stdout: '536870913\n' };
  return { stdout: '' };
};

beforeEach(() => { calls = []; });

describe('listSystemAudioSources (Linux)', () => {
  it('keeps whole-system capture first, then the per-application entries', async () => {
    const sources = await listSystemAudioSources({ exec });
    expect(sources[0].deviceId).toBe('desktop-audio-loopback');
    expect(sources.map(s => s.deviceId)).toContain('app:205');
  });
});

describe('connectSystemAudioSource (Linux)', () => {
  it('taps the application and reports the monitor label', async () => {
    const r = await connectSystemAudioSource('app:205', { exec });
    expect(r.success).toBe(true);
    expect(r.monitorLabel).toBe('Sokuji App Capture');
    expect(calls).toContain('pw-link 91 153');
  });

  it('leaves whole-system capture as a no-op with no monitorLabel', async () => {
    const r = await connectSystemAudioSource('desktop-audio-loopback', { exec });
    expect(r.success).toBe(true);
    expect(r.monitorLabel).toBeUndefined();
    expect(calls.some(c => c.startsWith('pw-link'))).toBe(false);
  });

  it('releases a previous tap when switching back to whole-system', async () => {
    await connectSystemAudioSource('app:205', { exec });
    calls = [];
    await connectSystemAudioSource('desktop-audio-loopback', { exec });
    expect(calls.some(c => c.includes('unload-module 536870913'))).toBe(true);
  });
});

describe('disconnectSystemAudioSource (Linux)', () => {
  it('is safe to call when nothing is connected', async () => {
    const r = await disconnectSystemAudioSource({ exec });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/pulseaudio-utils.appaudio.test.js`
Expected: FAIL — `listSystemAudioSources` returns only the single loopback entry, so
`sources.map(...)` does not contain `'app:205'`.

- [ ] **Step 3: Write minimal implementation**

In `electron/pulseaudio-utils.js`, add near the top with the other requires:

```javascript
const { listAppSources, connectAppSource, disconnectAppSource } = require('./pipewire-app-audio.js');
```

Replace the stub block at lines 267-276 with:

```javascript
/**
 * Whole-system capture first (the default, unchanged behaviour), followed by one
 * entry per application currently playing audio.
 *
 * `deps` exists so tests can inject a fake `exec`; production callers omit it.
 */
async function listSystemAudioSources(deps = {}) {
  const system = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
  return [system, ...(await listAppSources(deps))];
}

/**
 * `app:<nodeId>` taps one application via PipeWire. `desktop-audio-loopback`
 * keeps the existing getDisplayMedia path and only has to release a previous tap.
 */
async function connectSystemAudioSource(sourceId, deps = {}) {
  if (String(sourceId).startsWith('app:')) return connectAppSource(sourceId, deps);
  await disconnectAppSource(deps);
  return { success: true };
}

/** Release any per-application tap. Harmless for the whole-system path. */
async function disconnectSystemAudioSource(deps = {}) {
  await disconnectAppSource(deps);
  return { success: true };
}

/** Always supported — electron-audio-loopback works on all desktop platforms */
async function supportsSystemAudioCapture() { return true; }
```

The `module.exports` block already exports all four names; leave it unchanged.

`electron/main.js:858` calls `connectSystemAudioSource(sinkName)` with a single argument, so
`deps` defaults to `{}` and Task 3's `exec = defaultExec` default applies. No change to
`main.js` is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/pulseaudio-utils.appaudio.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify the IPC guard still passes**

`electron/main.js:851-870` already forwards these three channels, and the richer return
value is passed straight through. No handler changes are needed — confirm the guard agrees:

Run: `npx vitest run electron/ipc-channels.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/pulseaudio-utils.js electron/pulseaudio-utils.appaudio.test.js
git commit -m "feat(audio): expose per-application sources on Linux"
```

---

### Task 5: `DeviceCaptureRecorder` — participant capture from a named input device

**Files:**
- Create: `src/lib/modern-audio/DeviceCaptureRecorder.ts`
- Test: `src/lib/modern-audio/DeviceCaptureRecorder.test.ts`

**Interfaces:**
- Consumes: `ParticipantRecorder` (`src/lib/modern-audio/ParticipantRecorder.ts`) and
  `ParticipantAudioOptions` (`src/lib/modern-audio/IParticipantAudioRecorder.ts`, which
  already declares `deviceId?: string`).
- Produces: `class DeviceCaptureRecorder extends ParticipantRecorder`, constructed as
  `new DeviceCaptureRecorder(24000)`. `begin({ deviceId })` acquires that device.

**Why a subclass here and not a standalone implementation:** this path yields a real
`MediaStream`, which is exactly what `ParticipantRecorder` is built around, so subclassing
costs nothing. (The Windows/macOS follow-up plans push raw PCM instead and will implement
`IParticipantAudioRecorder` directly rather than forcing PCM through a synthetic
`MediaStream`.)

- [ ] **Step 1: Write the failing test**

Create `src/lib/modern-audio/DeviceCaptureRecorder.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceCaptureRecorder } from './DeviceCaptureRecorder';

const getUserMedia = vi.fn();
beforeEach(() => {
  getUserMedia.mockReset();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

const fakeStream = () => ({
  getAudioTracks: () => [{ getSettings: () => ({ sampleRate: 24000 }) }],
  getVideoTracks: () => [],
}) as unknown as MediaStream;

describe('DeviceCaptureRecorder.acquireStream', () => {
  it('requests the given device with participant processing disabled', async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    const rec = new DeviceCaptureRecorder(24000);

    await rec['acquireStream']({ deviceId: 'monitor-device-id' });

    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.audio.deviceId).toEqual({ exact: 'monitor-device-id' });
    // Participant audio is already processed upstream; re-processing it degrades ASR.
    expect(constraints.audio.echoCancellation).toBe(false);
    expect(constraints.audio.noiseSuppression).toBe(false);
    expect(constraints.audio.autoGainControl).toBe(false);
    expect(constraints.video).toBeUndefined();
  });

  it('throws a clear error when no deviceId is supplied', async () => {
    const rec = new DeviceCaptureRecorder(24000);
    await expect(rec['acquireStream']({})).rejects.toThrow(/deviceId/i);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('surfaces a helpful message when the device has disappeared', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotFoundError' }));
    const rec = new DeviceCaptureRecorder(24000);
    await expect(rec['acquireStream']({ deviceId: 'gone' })).rejects.toThrow(/no longer available/i);
  });

  it('throws when the acquired stream carries no audio track', async () => {
    getUserMedia.mockResolvedValue({ getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream);
    const rec = new DeviceCaptureRecorder(24000);
    await expect(rec['acquireStream']({ deviceId: 'x' })).rejects.toThrow(/no audio track/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/modern-audio/DeviceCaptureRecorder.test.ts`
Expected: FAIL — cannot resolve `./DeviceCaptureRecorder`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/modern-audio/DeviceCaptureRecorder.ts`:

```typescript
import { ParticipantRecorder } from './ParticipantRecorder';
import { ParticipantAudioOptions } from './IParticipantAudioRecorder';

/**
 * Participant recorder that captures a specific input device.
 *
 * Used for per-application capture on Linux, where the main process links one
 * application's output into a dedicated null sink and we record that sink's
 * monitor. Unlike LoopbackRecorder this never touches getDisplayMedia, so it
 * needs no screen-capture permission and no picker dialog.
 */
export class DeviceCaptureRecorder extends ParticipantRecorder {
  protected getLogPrefix(): string {
    return '[Sokuji] [DeviceCaptureRecorder]';
  }

  /**
   * The captured application is already audible on the user's speakers, so
   * routing this stream to the destination would double it and feed back.
   */
  protected shouldConnectToDestination(): boolean {
    return false;
  }

  protected async acquireStream(options?: ParticipantAudioOptions): Promise<MediaStream> {
    const deviceId = options?.deviceId;
    if (!deviceId) {
      throw new Error(`${this.getLogPrefix()}: a deviceId is required for device capture`);
    }

    console.info(`${this.getLogPrefix()} Capturing input device ${deviceId}`);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...this.getAudioConstraints(), deviceId: { exact: deviceId } },
      });
    } catch (error) {
      // The tap sink disappears if the captured application exits mid-session.
      if (error instanceof Error && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
        throw new Error('The selected application audio source is no longer available.');
      }
      throw error;
    }

    if (stream.getAudioTracks().length === 0) {
      throw new Error('No audio track in the captured device stream.');
    }

    console.info(`${this.getLogPrefix()} Device stream acquired`);
    return stream;
  }

  protected async onCleanup(): Promise<void> {
    console.info(`${this.getLogPrefix()} Cleanup complete`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/modern-audio/DeviceCaptureRecorder.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/modern-audio/DeviceCaptureRecorder.ts src/lib/modern-audio/DeviceCaptureRecorder.test.ts
git commit -m "feat(audio): add DeviceCaptureRecorder for device-scoped participant capture"
```

---

### Task 6: Route the audio service to the right recorder

**Files:**
- Modify: `src/lib/modern-audio/ModernBrowserAudioService.ts` — `connectSystemAudioSource`
  (line 878), `disconnectSystemAudioSource` (line 906), `startSystemAudioRecording` (line 941)
- Test: `src/lib/modern-audio/ModernBrowserAudioService.test.ts` (existing file — append)

**Interfaces:**
- Consumes: `DeviceCaptureRecorder` (Task 5); the `{ success, monitorLabel }` shape from Task 4.
- Produces: a private `resolveMonitorDeviceId(monitorLabel: string): Promise<string|null>`
  and a private field `currentMonitorDeviceId: string | null`. `startSystemAudioRecording`
  uses `DeviceCaptureRecorder` when that field is set and `LoopbackRecorder` otherwise.

**Why label matching:** Chromium's `deviceId` for a PulseAudio monitor is an opaque hash
that the main process cannot predict. The main process only knows the sink description, and
Chromium renders that into the device **label** as `Monitor of <description>` (Verified Fact 6).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/modern-audio/ModernBrowserAudioService.test.ts`:

Reuse the file's existing `setMediaDevices(getUserMedia, enumerateDevices)` helper — it
installs `navigator.mediaDevices` via `Object.defineProperty`, which is what works in this
suite. Do not switch it to `vi.stubGlobal`.

`ServiceFactory.isElectron()` must report true for these paths, and `window.electron.invoke`
must exist; both are set up per test below.

```typescript
import { ServiceFactory } from '../../services/ServiceFactory';

describe('participant source routing', () => {
  function arrange(devices: any[], invokeResult: any = { success: true }) {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue(devices));
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.electron = { invoke: vi.fn().mockResolvedValue(invokeResult) };
    return new ModernBrowserAudioService();
  }

  afterEach(() => vi.restoreAllMocks());

  it('resolves the monitor label to a Chromium input deviceId', async () => {
    const svc = arrange([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in Microphone' },
      { kind: 'audioinput', deviceId: 'mon-9', label: 'Monitor of Sokuji App Capture' },
      // Same label on an output must not win — we need an input to record from.
      { kind: 'audiooutput', deviceId: 'spk-1', label: 'Monitor of Sokuji App Capture' },
    ]);

    expect(await svc['resolveMonitorDeviceId']('Sokuji App Capture')).toBe('mon-9');
  });

  it('returns null when no input device matches the label', async () => {
    const svc = arrange([{ kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in Microphone' }]);

    expect(await svc['resolveMonitorDeviceId']('Sokuji App Capture')).toBeNull();
  });

  it('stores the resolved monitor deviceId for an app source', async () => {
    const svc = arrange(
      [{ kind: 'audioinput', deviceId: 'mon-9', label: 'Monitor of Sokuji App Capture' }],
      { success: true, monitorLabel: 'Sokuji App Capture' },
    );

    await svc.connectSystemAudioSource('app:205');

    expect(svc['currentMonitorDeviceId']).toBe('mon-9');
  });

  it('falls back to whole-system loopback when the monitor cannot be resolved', async () => {
    const svc = arrange([], { success: true, monitorLabel: 'Sokuji App Capture' });

    await svc.connectSystemAudioSource('app:205');

    // Degrading to system-wide audio beats failing the session outright.
    expect(svc['currentMonitorDeviceId']).toBeNull();
    expect(svc.isSystemAudioSourceConnected()).toBe(true);
  });

  it('leaves the monitor unset for whole-system capture', async () => {
    const svc = arrange([], { success: true });

    await svc.connectSystemAudioSource('desktop-audio-loopback');

    expect(svc['currentMonitorDeviceId']).toBeNull();
  });

  it('propagates a main-process failure', async () => {
    const svc = arrange([], { success: false, error: 'pw-link failed' });

    await expect(svc.connectSystemAudioSource('app:205')).rejects.toThrow('pw-link failed');
    expect(svc.isSystemAudioSourceConnected()).toBe(false);
  });

  it('clears the monitor deviceId on disconnect', async () => {
    const svc = arrange([]);
    svc['currentMonitorDeviceId'] = 'mon-9';

    await svc.disconnectSystemAudioSource();

    expect(svc['currentMonitorDeviceId']).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/modern-audio/ModernBrowserAudioService.test.ts`
Expected: FAIL — `resolveMonitorDeviceId is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/modern-audio/ModernBrowserAudioService.ts`:

Add the import beside the existing `LoopbackRecorder` import:

```typescript
import { DeviceCaptureRecorder } from './DeviceCaptureRecorder';
```

Add the field next to `systemAudioRecorder` (line 39):

```typescript
  // Chromium deviceId of the per-application capture monitor, or null when the
  // participant source is whole-system loopback.
  private currentMonitorDeviceId: string | null = null;
```

Add this private method above `connectSystemAudioSource`:

```typescript
  /**
   * Map a capture-sink description to a Chromium input deviceId.
   *
   * The main process cannot know Chromium's opaque deviceId, so it reports the
   * sink description instead and we match on the enumerated label, which
   * Chromium renders as "Monitor of <description>".
   */
  private async resolveMonitorDeviceId(monitorLabel: string): Promise<string | null> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const match = devices.find(
      (d) => d.kind === 'audioinput' && d.label.includes(monitorLabel)
    );
    return match?.deviceId ?? null;
  }
```

In `connectSystemAudioSource`, replace the body of the `try` block (lines 884-892) with:

```typescript
      console.info(`[Sokuji] [ModernBrowserAudio] Connecting system audio source: ${sourceDeviceId}`);
      const result = await window.electron.invoke('connect-system-audio-source', sourceDeviceId);

      if (result?.success === false) {
        throw new Error(result.error || 'Failed to connect system audio source');
      }

      // A monitorLabel means the main process created a per-application tap.
      // If we cannot find the matching input device, degrade to whole-system
      // loopback rather than failing the session outright.
      this.currentMonitorDeviceId = null;
      if (result?.monitorLabel) {
        this.currentMonitorDeviceId = await this.resolveMonitorDeviceId(result.monitorLabel);
        if (!this.currentMonitorDeviceId) {
          console.warn(
            '[Sokuji] [ModernBrowserAudio] Application capture monitor not found; ' +
            'falling back to whole-system audio'
          );
        }
      }

      this.systemAudioSourceConnected = true;
      this.currentSystemAudioSinkId = sourceDeviceId;

      console.info(`[Sokuji] [ModernBrowserAudio] System audio source connected: ${sourceDeviceId}`);
```

In the same method's `catch` block, add `this.currentMonitorDeviceId = null;` beside the
existing resets.

In `disconnectSystemAudioSource`, add beside the existing resets (line 923):

```typescript
    this.currentMonitorDeviceId = null;
```

In `startSystemAudioRecording`, replace the final `await this.startLoopbackRecording(callback);`
(line 951) with:

```typescript
    if (this.currentMonitorDeviceId) {
      await this.startDeviceCaptureRecording(this.currentMonitorDeviceId, callback);
      return;
    }
    await this.startLoopbackRecording(callback);
```

Add this method directly after `startLoopbackRecording`:

```typescript
  /**
   * Record participant audio from a specific input device (per-application capture).
   */
  private async startDeviceCaptureRecording(
    deviceId: string,
    callback: AudioRecordingCallback
  ): Promise<void> {
    try {
      console.info(`[Sokuji] [ModernBrowserAudio] Starting application audio capture from ${deviceId}`);
      this.systemAudioRecorder = new DeviceCaptureRecorder(24000);
      this.systemAudioCallback = callback;

      const success = await this.systemAudioRecorder.begin({ deviceId });
      if (!success) {
        throw new Error('Failed to begin application audio capture');
      }

      await this.systemAudioRecorder.record((data: { mono: Int16Array; raw: Int16Array }) => {
        if (this.systemAudioCallback) {
          this.systemAudioCallback(data);
        }
      });

      this.systemAudioRecordingActive = true;
      console.info('[Sokuji] [ModernBrowserAudio] Application audio capture started');
    } catch (error) {
      console.error('[Sokuji] [ModernBrowserAudio] Failed to start application audio capture:', error);
      await this.stopSystemAudioRecording();
      throw error;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/modern-audio/ModernBrowserAudioService.test.ts`
Expected: PASS, including the 7 new tests and all pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/modern-audio/ModernBrowserAudioService.ts src/lib/modern-audio/ModernBrowserAudioService.test.ts
git commit -m "feat(audio): route participant capture to the selected source"
```

---

### Task 7: Store the selected participant source

**Files:**
- Modify: `src/stores/audioStore.ts`
- Test: `src/stores/audioStore.test.ts` (existing file, 335 lines — append)

**Interfaces:**
- Consumes: `AudioDevice` (already exported from `audioStore.ts`).
- Produces on the store: state `participantSources: AudioDevice[]`,
  `selectedParticipantSource: AudioDevice | null`; actions
  `setParticipantSources(sources: AudioDevice[])`,
  `selectParticipantSource(source: AudioDevice)`; selector hooks
  `useParticipantSources()`, `useSelectedParticipantSource()`,
  `useSelectParticipantSource()`; and a new named export `DEFAULT_PARTICIPANT_SOURCE`.
  `refreshDevices()` additionally populates `participantSources`.

  All three hooks are exported by name (rather than letting the component reach in
  via `useAudioStore((s) => ...)`) because `AudioDeviceSection.test.tsx` mocks the whole
  store module and can only supply named exports — see Task 8.

**Note the import style:** `audioStore.ts` exports the store as a **default** export
(`import useAudioStore from './audioStore'`), with `AudioDevice` as a type-only named
export. The existing tests drive it by injecting a fake service —
`useAudioStore.setState({ audioService: { getDevices: async () => (...) } })` — then
awaiting `refreshDevices()`. Follow that pattern; do not invent a new harness.

**Why enumeration lives in `refreshDevices` and not in the picker component:** the store
already owns the `audioService` and every other device list, so the picker in Task 8 stays a
dumb consumer with no service dependency — which keeps its component test trivial.

- [ ] **Step 1: Write the failing test**

Append to `src/stores/audioStore.test.ts`:

```typescript
import { DEFAULT_PARTICIPANT_SOURCE } from './audioStore';

describe('participant source selection', () => {
  beforeEach(() => {
    useAudioStore.setState({
      participantSources: [],
      selectedParticipantSource: DEFAULT_PARTICIPANT_SOURCE,
    });
  });

  it('defaults to whole-system capture', () => {
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId).toBe('desktop-audio-loopback');
  });

  it('selects a source', () => {
    const chromium: AudioDevice = { deviceId: 'app:205', label: 'Chromium' };
    useAudioStore.getState().selectParticipantSource(chromium);
    expect(useAudioStore.getState().selectedParticipantSource).toEqual(chromium);
  });

  it('reverts to whole-system capture when the selected app disappears', () => {
    useAudioStore.getState().selectParticipantSource({ deviceId: 'app:205', label: 'Chromium' });
    // The app quit; a refresh no longer lists it.
    useAudioStore.getState().setParticipantSources([DEFAULT_PARTICIPANT_SOURCE]);
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId).toBe('desktop-audio-loopback');
  });

  it('refreshDevices populates the participant sources', async () => {
    useAudioStore.setState({
      audioService: {
        getDevices: async () => ({ inputs: [], outputs: [] }),
        getSystemAudioSources: async () => ([
          DEFAULT_PARTICIPANT_SOURCE,
          { deviceId: 'app:205', label: 'Chromium' },
        ]),
      } as any,
    });

    await useAudioStore.getState().refreshDevices();

    expect(useAudioStore.getState().participantSources.map(s => s.deviceId))
      .toEqual(['desktop-audio-loopback', 'app:205']);
  });

  it('refreshDevices survives a service without per-application support', async () => {
    // The browser extension's audio service has no getSystemAudioSources at all.
    useAudioStore.setState({
      audioService: { getDevices: async () => ({ inputs: [], outputs: [] }) } as any,
      participantSources: [],
    });

    await useAudioStore.getState().refreshDevices();

    expect(useAudioStore.getState().participantSources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/audioStore.test.ts`
Expected: FAIL — `DEFAULT_PARTICIPANT_SOURCE` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/stores/audioStore.ts`, add after the `AudioDevice` interface:

```typescript
/** Whole-system capture — the default participant source on every platform. */
export const DEFAULT_PARTICIPANT_SOURCE: AudioDevice = {
  deviceId: 'desktop-audio-loopback',
  label: 'System Audio (All Applications)',
};
```

Add to the `AudioStore` interface, beside the other device state:

```typescript
  participantSources: AudioDevice[];
  selectedParticipantSource: AudioDevice | null;
  setParticipantSources: (sources: AudioDevice[]) => void;
  selectParticipantSource: (source: AudioDevice) => void;
```

Add to the store's initial state:

```typescript
  participantSources: [],
  selectedParticipantSource: DEFAULT_PARTICIPANT_SOURCE,
```

Add the actions to the store implementation:

```typescript
  setParticipantSources: (sources) => set((state) => {
    // A captured application can quit between refreshes; keeping a stale
    // selection would make the next session fail to acquire its source.
    const stillPresent = state.selectedParticipantSource
      && sources.some((s) => s.deviceId === state.selectedParticipantSource!.deviceId);
    return {
      participantSources: sources,
      selectedParticipantSource: stillPresent
        ? state.selectedParticipantSource
        : DEFAULT_PARTICIPANT_SOURCE,
    };
  }),

  selectParticipantSource: (source) => set({ selectedParticipantSource: source }),
```

Inside `refreshDevices` (line 273), after the existing `const devices = await service.getDevices();`
and its `set(...)`, populate the participant sources too:

```typescript
        // Only the Electron audio service implements this; the extension's does
        // not, and a per-application list is meaningless for tab capture anyway.
        if (typeof (service as any).getSystemAudioSources === 'function') {
          try {
            get().setParticipantSources(await (service as any).getSystemAudioSources());
          } catch (e) {
            console.warn('[Sokuji] [AudioStore] Failed to list participant sources:', e);
          }
        }
```

Add the selector hooks beside the existing ones:

```typescript
export const useParticipantSources = () => useAudioStore((s) => s.participantSources);
export const useSelectedParticipantSource = () => useAudioStore((s) => s.selectedParticipantSource);
export const useSelectParticipantSource = () => useAudioStore((s) => s.selectParticipantSource);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/audioStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/audioStore.ts src/stores/audioStore.test.ts
git commit -m "feat(audio): track the selected participant audio source"
```

---

### Task 8: Participant source picker in the audio settings

**Files:**
- Modify: `src/components/Settings/sections/AudioDeviceSection.tsx`
- Modify: `src/locales/en/translation.json` **and the other 31 locale directories**
- Test: `src/components/Settings/sections/AudioDeviceSection.test.tsx` (existing file — append)

**Interfaces:**
- Consumes: `useParticipantSources`, `useSelectedParticipantSource`, `useSelectParticipantSource`
  from Task 7. The component performs **no** enumeration and touches no service — Task 7's
  `refreshDevices` already fills the list.
- Produces: a section rendered only in Electron, locked while a session is active, using the
  same `DeviceList` component the microphone and speaker sections use (line 186).

**Important harness note:** `AudioDeviceSection.test.tsx` mocks the *entire* `audioStore`
module with `vi.mock('../../../stores/audioStore', () => ({ ... }))` and mocks
`react-i18next` so `t(key, def)` returns the inline default. There is no real store in that
test — `useAudioStore.setState` will not work. Extend the existing mock object instead.

That is why Task 7 exports `useSelectParticipantSource()` by name: the component must depend
only on named hooks the test's mock can supply.

**New locale keys** (under the existing `audioPanel` object):
- `audioPanel.participantSource` → `"Participant Audio Source"`
- `audioPanel.participantSourceHint` → `"Choose which application to translate. System Audio captures everything you hear."`

- [ ] **Step 1: Write the failing test**

In `src/components/Settings/sections/AudioDeviceSection.test.tsx`, first extend the existing
`vi.mock('../../../stores/audioStore', ...)` factory with the three new hooks. Declare the
spy and the fixtures **above** the `vi.mock` call — `vi.mock` is hoisted, so anything its
factory closes over must be defined with `var`-like hoisting or referenced lazily. Use a
mutable holder object, which is safe under hoisting:

```typescript
const participantMock = {
  sources: [] as Array<{ deviceId: string; label: string }>,
  selected: null as { deviceId: string; label: string } | null,
  select: vi.fn(),
};
```

Then add to the existing mock factory's returned object:

```typescript
  useParticipantSources: () => participantMock.sources,
  useSelectedParticipantSource: () => participantMock.selected,
  useSelectParticipantSource: () => participantMock.select,
```

Also mock the environment helper, since the section only renders in Electron:

```typescript
vi.mock('../../../utils/environment', () => ({ isElectron: () => true }));
```

Now append the tests:

```typescript
import { fireEvent } from '@testing-library/react';

describe('participant source picker', () => {
  const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
  const CHROMIUM = { deviceId: 'app:205', label: 'Chromium' };

  beforeEach(() => {
    participantMock.sources = [SYSTEM, CHROMIUM];
    participantMock.selected = SYSTEM;
    participantMock.select.mockReset();
  });

  it('lists the available participant sources', () => {
    render(<AudioDeviceSection />);

    expect(screen.getByText('Chromium')).toBeInTheDocument();
    expect(screen.getByText('System Audio (All Applications)')).toBeInTheDocument();
  });

  it('selecting an application calls the store action', () => {
    render(<AudioDeviceSection />);

    fireEvent.click(screen.getByText('Chromium'));

    expect(participantMock.select).toHaveBeenCalledWith(CHROMIUM);
  });

  it('does not switch source while a session is active', () => {
    render(<AudioDeviceSection isSessionActive={true} />);

    fireEvent.click(screen.getByText('Chromium'));

    // Switching the tap mid-session would tear down the live capture.
    expect(participantMock.select).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/AudioDeviceSection.test.tsx`
Expected: FAIL — "Chromium" is never rendered.

- [ ] **Step 3: Write minimal implementation**

In `src/components/Settings/sections/AudioDeviceSection.tsx`, extend the store import on line 8:

```typescript
import {
  useAudioContext, useNoiseSuppressionMode, useSetNoiseSuppressionMode,
  useIsMonitorChannelInScope, NoiseSuppressionMode,
  useParticipantSources, useSelectedParticipantSource, useSelectParticipantSource,
} from '../../../stores/audioStore';
```

Add the environment import at the top of the file:

```typescript
import { isElectron } from '../../../utils/environment';
```

Inside the component, beside the other hooks (near line 72):

```typescript
  const participantSources = useParticipantSources();
  const selectedParticipantSource = useSelectedParticipantSource();
  const selectParticipantSource = useSelectParticipantSource();

  const handleParticipantSourceSelect = (device: AudioDevice) => {
    // Re-linking mid-session would tear down the live capture; the list is
    // rendered disabled too, this is the belt-and-braces guard.
    if (locked) return;
    selectParticipantSource(device);
    trackEvent('participant_source_selected', { deviceId: device.deviceId });
  };
```

The list itself is filled by `refreshDevices()` (Task 7) — the component does no
enumeration and takes no service dependency.

Render the section after the speaker section's closing `</div>` (after line 268's block):

```tsx
      {isElectron() && (
        <div className={`config-section participant-source-section ${className}`} id="participant-source-section">
          <h3>{t('audioPanel.participantSource', 'Participant Audio Source')}</h3>
          <p className="section-hint">
            {t('audioPanel.participantSourceHint',
               'Choose which application to translate. System Audio captures everything you hear.')}
          </p>
          <DeviceList
            devices={participantSources}
            selectedDevice={selectedParticipantSource}
            isDeviceOn={true}
            onSelect={handleParticipantSourceSelect}
            disabled={locked}
            deviceType="input"
            filterVirtual={false}
            showVirtualIndicators={false}
          />
        </div>
      )}
```

Add both keys to `src/locales/en/translation.json` under `audioPanel`, then replicate them
into the other 31 locale directories. English text is acceptable as the placeholder value in
non-English locales — the consistency test asserts key parity, not translation quality.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/Settings/sections/AudioDeviceSection.test.tsx
npx vitest run src/locales/locales.consistency.test.ts
```

Expected: both PASS. If the locale test fails, a locale directory is missing one of the two keys.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/AudioDeviceSection.tsx src/locales
git commit -m "feat(audio): add participant audio source picker"
```

---

### Task 9: Use the selected source when a session starts

**Files:**
- Create: `src/lib/modern-audio/participantSource.ts`
- Test: `src/lib/modern-audio/participantSource.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx:1946` and `:1950` (both hardcode
  `connectSystemAudioSource('desktop-audio-loopback')`)

**Interfaces:**
- Consumes: `AudioDevice` from `src/stores/audioStore`; `useSelectedParticipantSource` (Task 7).
- Produces: `resolveParticipantSourceId(selected: AudioDevice | null | undefined): string`.

**Why a separate module:** `MainPanel.tsx` is ~2300 lines and **has no test file** — there is
no `MainPanel.test.tsx` in the repo and standing one up to drive the full async session-start
path would be a large, brittle harness that this task does not need. The decision worth
testing is "which id do we pass", so it moves into a pure function that is tested directly.
The two-line MainPanel wiring is then covered by the real-app run in Task 11.

- [ ] **Step 1: Write the failing test**

Create `src/lib/modern-audio/participantSource.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveParticipantSourceId } from './participantSource';

describe('resolveParticipantSourceId', () => {
  it('returns the selected application source id', () => {
    expect(resolveParticipantSourceId({ deviceId: 'app:205', label: 'Chromium' })).toBe('app:205');
  });

  it('returns the whole-system id when the selection is the system source', () => {
    expect(resolveParticipantSourceId({ deviceId: 'desktop-audio-loopback', label: 'System Audio' }))
      .toBe('desktop-audio-loopback');
  });

  it('falls back to whole-system capture when nothing is selected', () => {
    expect(resolveParticipantSourceId(null)).toBe('desktop-audio-loopback');
    expect(resolveParticipantSourceId(undefined)).toBe('desktop-audio-loopback');
  });

  it('falls back when the selection carries no deviceId', () => {
    expect(resolveParticipantSourceId({ deviceId: '', label: 'broken' })).toBe('desktop-audio-loopback');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/modern-audio/participantSource.test.ts`
Expected: FAIL — cannot resolve `./participantSource`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/modern-audio/participantSource.ts`:

```typescript
import type { AudioDevice } from '../../stores/audioStore';

/** Whole-system capture — the participant source used when nothing else is chosen. */
export const SYSTEM_PARTICIPANT_SOURCE_ID = 'desktop-audio-loopback';

/**
 * Resolve the participant source id to hand to
 * ModernBrowserAudioService.connectSystemAudioSource().
 *
 * Falling back to whole-system capture rather than throwing keeps a session
 * startable when the previously selected application has quit.
 */
export function resolveParticipantSourceId(
  selected: AudioDevice | null | undefined
): string {
  return selected?.deviceId || SYSTEM_PARTICIPANT_SOURCE_ID;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/modern-audio/participantSource.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into MainPanel**

In `src/components/MainPanel/MainPanel.tsx` add the imports:

```typescript
import { useSelectedParticipantSource } from '../../stores/audioStore';
import { resolveParticipantSourceId } from '../../lib/modern-audio/participantSource';
```

Beside the other store hooks in the component:

```typescript
  const selectedParticipantSource = useSelectedParticipantSource();

  // Read through a ref: the session-start path awaits several times, and a
  // re-render in between must not switch the source mid-acquisition.
  const participantSourceRef = useRef(selectedParticipantSource);
  useEffect(() => {
    participantSourceRef.current = selectedParticipantSource;
  }, [selectedParticipantSource]);
```

Replace **both** occurrences (lines 1946 and 1950) of:

```typescript
await audioServiceRef.current!.connectSystemAudioSource('desktop-audio-loopback');
```

with:

```typescript
await audioServiceRef.current!.connectSystemAudioSource(
  resolveParticipantSourceId(participantSourceRef.current)
);
```

- [ ] **Step 6: Verify nothing regressed**

Run: `npx vitest run src/lib/modern-audio`
Expected: PASS. (There is no MainPanel unit test to run; Task 11 exercises the wiring for real.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/modern-audio/participantSource.ts src/lib/modern-audio/participantSource.test.ts src/components/MainPanel/MainPanel.tsx
git commit -m "feat(audio): start participant capture from the selected source"
```

---

### Task 10: Full suite green

**Files:** none — verification only.

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: PASS with no new failures against the pre-existing baseline.

- [ ] **Step 2: Fix any regression before continuing**

The likeliest breakages are `electron/ipc-channels.test.js` (if a channel name drifted) and
`src/locales/locales.consistency.test.ts` (if a locale is missing a key). Fix, do not skip.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -am "test: fix regressions from participant source selection"
```

---

### Task 11: Real-application verification on Linux

**Files:** none — manual verification. The unit tests all use a fake `exec`, so nothing so
far has proved the feature works against a real PipeWire graph.

- [ ] **Step 1: Fix the sandbox binary if `npm install` was run in this worktree**

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

- [ ] **Step 2: Record the baseline audio graph**

```bash
pactl list sinks short
pactl list sources short | grep -i sokuji || echo "no sokuji sources (expected)"
```

Keep this output; Step 7 compares against it.

- [ ] **Step 3: Start two audio sources**

Play audio in a browser tab (this stands in for the meeting app) **and** a second
application — a music player or `mpv` — so there is unrelated audio to exclude. This is the
exact scenario from issue #335.

- [ ] **Step 4: Launch Sokuji and select the browser**

```bash
npm run electron:dev
```

Open audio settings. The Participant Audio Source list must show
"System Audio (All Applications)" plus one entry per playing application. Select the browser.

- [ ] **Step 5: Verify the tap is additive**

With a session running:

```bash
pactl list sinks short | grep sokuji_app_capture   # the capture sink exists
pw-link -l | grep -A3 "output_FL"                  # browser output goes to BOTH sinks
```

Both audible applications must still be playing through the speakers. If the browser goes
silent, the implementation moved the stream instead of linking it — that is a bug in Task 3.

- [ ] **Step 6: Verify the translation only hears the selected app**

Speak (or play speech) in the browser tab and confirm the participant transcript follows it.
Play speech in the *other* application and confirm it does **not** appear in the transcript.
This is the acceptance criterion for issue #335.

- [ ] **Step 7: Verify teardown leaves no trace**

End the session and quit Sokuji, then:

```bash
pactl list sinks short          # must match the Step 2 baseline
pactl list sources short | grep -i sokuji || echo "clean"
```

A leftover `sokuji_app_capture` sink is a release blocker — it appears in the user's system
sound settings as a phantom device.

- [ ] **Step 8: Verify the fallback path**

Select an application, then quit that application before starting a session. Sokuji must log
the failure and fall back to whole-system capture with the session still starting, rather
than erroring out.

- [ ] **Step 9: Commit any fixes found**

```bash
git commit -am "fix(audio): <what the real-app run exposed>"
```

---

## Out of Scope / Follow-Up Plans

These are deliberately excluded so this plan produces a working, shippable feature on its own:

1. **Windows per-application capture** — specified in
   `docs/superpowers/plans/2026-08-04-per-app-audio-capture-windows.md`.
   That plan was written after the mechanism was proven on real hardware, and two
   assumptions stated earlier in this project turned out to be **wrong** for Windows: process
   loopback lets the caller request 24 kHz mono directly (no resampling), and it delivers a
   continuous stream even while the target application is silent (no wall-clock silence
   filling). Do not carry those steps over.
2. **macOS per-application capture** — Core Audio process taps (macOS 14.2+), same CLI
   contract, plus the "System Audio Recording Only" TCC permission and the packaging
   entitlements.
3. **Non-PipeWire PulseAudio** — this plan's tap needs PipeWire's graph (`pw-dump`,
   `pw-link`). On classic PulseAudio the source list will simply contain only
   "System Audio (All Applications)", which is today's behaviour.

Both follow-up plans consume the picker, the store state, and the
`connectSystemAudioSource` contract built in **Tasks 6–9 of this plan**. Those four tasks are
platform-neutral; whichever plan runs first must land them, and the other then reuses them
unchanged. The Windows plan states this dependency explicitly in its own prerequisites.
