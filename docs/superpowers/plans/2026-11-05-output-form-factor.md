# Output Device Form Factor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The renderer can ask, for any output device it plays to, whether the system calls it headphones, speakers or neither, and how it is connected, on the desktop app on macOS, Windows and Linux (the extension answers `unknown`), with no behavior change.

**Architecture:** Each platform's raw facts come from a short-lived reader: the existing audio-host helpers gain a `--devices` command on macOS and Windows, and Linux reads `pactl`. Pure parsers in the main process map those facts to an answer per spec §4; `get-output-devices` hands the answer to the renderer, which joins it into the existing device list by exact label (§5), reads it again only on events (§6), and treats anything stale as `unknown`.

**Tech Stack:** Swift (Core Audio), C++17 (WASAPI / MMDevice property store), Electron main (CommonJS, `child_process.spawn`), React + zustand renderer (TypeScript), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-output-form-factor-design.md`

## Rulings made while planning

The code differs from the spec in a few places; the plan follows the code, and Task 6 corrects the spec text.

- **The extension does import `src/`** (`extension/fullpage.html` loads `shared/index.tsx`, which imports `src/App`; `extension/vite.config.ts` aliases `@src`). Spec §7 says it does not. The outcome stays the spec's: the native reader is started only when `isElectron()` and `window.electron` are both true, so in the extension every output reads `unknown`.
- **The browser's `default` and `communications` entries never reach the store** (`devices.ts` filters them out), and `resolveOutlet` turns "no device" into `selectedMonitorDevice?.deviceId`, a concrete id. So an outlet almost always has a concrete sink. The answer for the browser default (no device, `''` or `default`) is kept as its own store field, `defaultOutputForm`.
- **The browser's default, among same-named devices** (plan review): a concrete browser output whose `groupId` equals the `groupId` of the browser's `default` entry is the browser default. It takes the native default's answer when the native default's label equals its own, even if another native device shares that label. This is a statement from the browser, not a guess. Without it, two identical headsets would both be `unknown`, the default one included.
- **A default-output change on Linux** (plan review): `pactl subscribe` reports a new default sink as `Event 'change' on server`, not as a sink event. The watcher pushes on it too. On Windows and macOS the spec says Chromium fires `devicechange` when the default changes; Task 8 measures that.
- **Linux, a typed port that says neither** (`HDMI`, `Line`, `Unknown`, …): an HDMI port is `unknown` whatever `device.form_factor` says. Any other port type that says neither falls through to the port name, then to `device.form_factor`, as an untyped port does.
- **macOS terminal types** are applied to Bluetooth outputs only, as §4's table says. `hdph`, `0x0302` (USB Headphones) and `0x0402` (USB Headset) give `headphones`; `spkr` and `0x0301` (USB Speaker) give `speakers`. Bluetooth measurement (§9.3) may change this set.
- **The diagnostic log** writes one line per outlet when a session starts, as a baseline. After that it writes an outlet's line only when its (label, form factor, transport) changes, whether or not a session is running.
- **Field names, timeouts and backoff** (spec §10, left to the builder): as written in Tasks 2–5.

## Global Constraints

- No behavior change. Nothing reads `formFactor` / `transport` except the diagnostic log (§2 non-goals).
- No guessing from names. A browser device matches a native device only when its cleaned label equals exactly one native label; anything the system does not state plainly is `unknown` (§2 anti-goals, §5).
- No new long-lived listening surface (no socket, no port) and no new permission prompt. The helpers stay short-lived stdio filters. The Linux `pactl subscribe` watcher is a child process read over stdio (§2, §6).
- Never awaited on the session start path. The answer is read ahead and cached (§2).
- Native reads happen only on events: first use, `devicechange`, a push from main (a `pactl` sink change, `powerMonitor` `resume`), and `visibilitychange` to visible. The 3-second poll in `deviceWatch.ts` never starts one. A failed read is retried after 1 s, 5 s and 30 s, and a success ends the retries (§6).
- Stale is `unknown`, never a remembered answer (§6).
- One native read takes at most 3 s, then the child is killed and the read is `{ ok: false, reason: 'timeout' }` (§7).
- `raw` holds at most 12 keys. Its string values are cut to 120 characters before they cross IPC (§7).
- The macOS helper stays built for `arm64-apple-macosx14.2` / `x86_64-apple-macosx14.2` (`native/audio-host/mac/build.sh`).
- Electron wiring rules the repo enforces:
  - A new `electron/*.js` main module goes into the entry map in `vite.config.ts` (`electron/entry-map.consistency.test.js`).
  - An invoke channel goes into `INVOKE_CHANNELS` in `electron/ipc-channels.js`, with an `ipcMain.handle('<name>'` the scan in `ipc-channels.test.js` finds.
  - A push channel goes into `validReceiveChannels` in `electron/preload.js`.
- Main-process tests inject `spawn` / `exec` / `powerMonitor` fakes. They never `vi.mock` `child_process` (`electron/pulseaudio-utils.appaudio.test.js:3-5`).
- Every commit message is `feat(audio): … (#691)`, or `docs(audio)` / `test(audio)`, and ends with the `Co-Authored-By` trailer of the model that wrote it.
- The repository is public. Code, comments, fixtures and commit messages carry no people's names, machine names, chat channels or user data. Fixtures are captured from our own test machines and are scrubbed of serial numbers and MAC addresses.

## Review Focus

1. **`pactl` in a non-English locale:** a German or Japanese system prints `pactl list sinks` text with translated keys, and the text parser must still work. Every `pactl` call runs with `LC_ALL=C` (Task 5 test `linux reads run pactl with LC_ALL=C`).
2. **An event arriving while a native read is in flight:** that read's result predates the event, so it must not count as current. The reader reads again before the answer is current (Task 6 test `an event during a read is not answered by that read`).
3. **A laptop switching its Linux port from speakers to headphones:** the sink id and label stay the same, so `syncDevices` must still replace the list, because only `formFactor` changed (Task 6 test `a form factor change alone replaces the output list`).
4. **A helper that hangs or prints a flood:** it is killed at 3 s and the answer stays `unknown`, and an oversized `raw` is capped (Task 5 tests `a helper that never exits is killed at 3 s` and `raw is capped`).
5. **Two native devices with the same name** (two identical USB headsets): both read `unknown`, and neither is picked by order (Task 1 test `two native devices with the same label match neither`).

---

### Task 1: The answer's types and the label matcher

**Files:**
- Create: `src/lib/audio/formFactor.ts`
- Test: `src/lib/audio/formFactor.test.ts`

**Interfaces:**
- Produces:
  - `export type FormFactor = 'headphones' | 'speakers' | 'unknown'`
  - `export type Transport = 'builtin' | 'usb' | 'bluetooth' | 'hdmi' | 'virtual' | 'unknown'`
  - `export interface OutputDeviceInfo { label: string; isDefault: boolean; formFactor: FormFactor; transport: Transport; raw: Record<string, string | number | boolean> }`
  - `export type NativeOutputsResult = { ok: true; devices: OutputDeviceInfo[] } | { ok: false; reason: string }`
  - `export interface OutputForm { formFactor: FormFactor; transport: Transport }`
  - `export const UNKNOWN_FORM: OutputForm`, which is `{ formFactor: 'unknown', transport: 'unknown' }`
  - `export function cleanOutputLabel(label: string): string`: trims the label and removes a leading `Default - ` or `Communications - `.
  - `export function matchOutputForm(sinkDeviceId: string | undefined, browserLabel: string | undefined, native: readonly OutputDeviceInfo[] | null, labelsKnown: boolean, isBrowserDefault = false): OutputForm`. When `isBrowserDefault` is true and the native default's cleaned label equals the cleaned browser label, the native default's answer is returned, before the uniqueness rule.

- [ ] **Step 1: Write the failing tests** in `src/lib/audio/formFactor.test.ts`. `n(label, form, isDefault=false)` builds an `OutputDeviceInfo` with `transport: 'builtin'` and `raw: {}`.
  - `no native list is unknown`: `matchOutputForm('id1', 'Speakers', null, true)` equals `UNKNOWN_FORM`.
  - `the default sink is the native default`: for each of `undefined`, `''` and `'default'` as the id, with `[n('A', 'speakers'), n('B', 'headphones', true)]`, the result is `{ formFactor: 'headphones', transport: 'builtin' }`. The default is found even when `labelsKnown` is `false`.
  - `no default or two defaults is unknown`.
  - `communications is unknown`, even when a native default exists.
  - `labels not known is unknown`: id `'x'`, label `'A'`, native `[n('A', 'speakers')]`, `labelsKnown: false`.
  - `an exact label matches`: `'Speakers (Realtek(R) Audio)'` against the same native label gives `speakers`.
  - `prefixes and outer spaces are removed before matching`: `'  Default - Headphones (USB)  '` matches the native `'Headphones (USB)'`, and so does `'Communications - Headphones (USB)'`.
  - `two native devices with the same label match neither`: `[n('USB Headset', 'headphones'), n('USB Headset', 'headphones')]` gives `UNKNOWN_FORM`.
  - `the browser default among same-named devices is the native default`: the same pair with the second one `isDefault`, and `isBrowserDefault: true`, gives that device's answer. With `isBrowserDefault: false` it gives `UNKNOWN_FORM`. With `isBrowserDefault: true` but a native default named differently, it gives `UNKNOWN_FORM`.
  - `no fuzzy match`: `'Headphones'` against native `'Headphones (USB)'` is unknown, and so is `'headphones (usb)'` against `'Headphones (USB)'`.
  - `an undefined browser label is unknown`.

- [ ] **Step 2: Run** `npx vitest run src/lib/audio/formFactor.test.ts`. Expected: it fails because the module is not found.

- [ ] **Step 3: Implement** the types, `UNKNOWN_FORM`, `cleanOutputLabel` and `matchOutputForm` in `src/lib/audio/formFactor.ts`. Native labels are trimmed before the comparison. The function returns copies, never a native object.

- [ ] **Step 4: Run** the same command. Expected: all pass.

- [ ] **Step 5: Commit** `feat(audio): the output form factor's types and label matcher (#691)`.

### Task 2: Linux: map `pactl` output (JSON and text)

**Files:**
- Create: `electron/output-form-factor-parse.js` (CommonJS, pure functions only)
- Create: `electron/__fixtures__/output-devices/linux-hdmi.json`, captured by `LC_ALL=C pactl -f json list sinks` on a Linux machine with an HDMI output only. Also `linux-hdmi.txt`, from `LC_ALL=C pactl list sinks` on the same machine.
- Test: `electron/output-form-factor-parse.test.js` (`// @vitest-environment node`)

**Interfaces:**
- Consumes: the `OutputDeviceInfo` shape from Task 1 (in JS, same field names).
- Produces:
  - `capRaw(raw: object): Record<string, string|number|boolean>`: keeps the first 12 keys whose values are strings, numbers or booleans, and cuts strings to 120 characters.
  - `parsePactlSinksJson(text: string, defaultSinkName: string | null): OutputDeviceInfo[] | null`: `null` when the text is not a JSON array.
  - `parsePactlSinksText(text: string, defaultSinkName: string | null): OutputDeviceInfo[]`
  - `parsePactlDefaultSink(text: string, json: boolean): string | null`: reads `default_sink_name` from `pactl -f json info`, or the `Default Sink: ` line from `pactl info`.
  - `MAX_RAW_KEYS = 12`, `MAX_RAW_STRING = 120`

The per-sink rule, used by both parsers:
- **Label:** the sink's `description`. `isDefault` is `name === defaultSinkName`.
- **Form factor, first rule that applies:**
  1. A null sink (`properties['factory.name'] === 'support.null-audio-sink'`) is `unknown`.
  2. The active port's type `Headphones` or `Headset` gives `headphones`; `Speaker` gives `speakers`.
  3. The active port's name `analog-output-headphones` gives `headphones`; `analog-output-speaker` gives `speakers`.
  4. An HDMI active port (type `HDMI`, or a name starting with `hdmi-output`) is `unknown`.
  5. `device.form_factor` `headphone`, `headset`, `hands-free` or `handset` gives `headphones`; `speaker` gives `speakers`.
  6. Anything else is `unknown`.
- **Transport:** a null sink is `virtual`. An HDMI active port is `hdmi`. Otherwise `device.bus` decides: `pci` is `builtin`, `usb` is `usb`, `bluetooth` is `bluetooth`, and anything else (including no bus) is `unknown`.
- **`raw`:** `{ name, activePort, portType, formFactor: device.form_factor, bus: device.bus, factory: factory.name }`, keeping only the keys present.

- [ ] **Step 1: Capture the fixtures.** Run both commands above on a Linux machine. Remove any `device.serial`, `api.alsa.card.longname` serial numbers and MAC addresses, then save the files.

- [ ] **Step 2: Write the failing tests:**
  - `the captured HDMI sink is unknown over hdmi`: `parsePactlSinksJson` on `linux-hdmi.json` gives one device. Its label is the fixture's description, `formFactor` is `'unknown'` and `transport` is `'hdmi'`. The text fixture gives the same through `parsePactlSinksText`.
  - `rule order` uses an inline sink literal per row of the rule list. Cover these, at least:
    - a typed `Headphones` port over `device.form_factor: 'speaker'` gives `headphones`;
    - an untyped `analog-output-speaker` gives `speakers`;
    - an untyped port with another name plus `form_factor: 'headset'` gives `headphones`;
    - a typed `Line` port plus `form_factor: 'speaker'` gives `speakers`;
    - an HDMI port plus `form_factor: 'speaker'` is `unknown`;
    - a null sink is `unknown` over `virtual`;
    - `form_factor: 'internal'` alone is `unknown`.
  - `transport from the bus`: `pci`, `usb`, `bluetooth` and none.
  - `isDefault follows the default sink name`.
  - `not JSON is null`: `parsePactlSinksJson('pactl: invalid option', null)` and `('{}', null)` are both `null`.
  - `the text parser reads ports without a type` (old PulseAudio text where a port line has no `type:`).
  - `parsePactlDefaultSink reads both forms`.
  - `raw is capped`: an object with 20 keys and a 500-character string comes back with 12 keys and a 120-character string. Nested objects are dropped.

- [ ] **Step 3: Run** `npx vitest run electron/output-form-factor-parse.test.js`. Expected: it fails because the module is not found.

- [ ] **Step 4: Implement** the functions. The text parser works on `LC_ALL=C` output:
  - `Sink #N` starts a block.
  - Top-level keys sit at one tab: `Name:`, `Description:`, `Active Port:`.
  - Properties sit at two tabs, as `key = "value"`.
  - Port lines sit under `Ports:` at two tabs, as `name: Desc (type: T, priority: …)`, where `type:` is optional.

- [ ] **Step 5: Run** the tests. Expected: all pass.

- [ ] **Step 6: Commit** `feat(audio): read the output form factor from pactl (#691)`.

### Task 3: macOS: the helper's `--devices` and its mapping

**Files:**
- Modify: `native/audio-host/mac/main.swift`, adding the `--devices` branch next to `--list` (around :839-883) and in the usage text (:877-882).
- Modify: `native/audio-host/mac/verify.sh`, adding a `--devices` shape check.
- Modify: `electron/output-form-factor-parse.js`, adding `parseMacDevices`.
- Test: `electron/output-form-factor-parse.test.js`

**Interfaces:**
- Consumes: `capRaw` (Task 2).
- Produces:
  - **Helper output:** `--devices` prints one JSON array and exits 0, or exits 1 with an error on stderr. Each row is `{"id": <AudioObjectID>, "uid": "<kAudioDevicePropertyDeviceUID>", "label": "<kAudioObjectPropertyName>", "isDefault": <bool>, "transport": <code>, "dataSource": <code|null>, "terminalType": <code|null>}`.
    - A code is the 4-character string when all four bytes are printable ASCII (`"bltn"`, `"usb "`), and the number otherwise.
    - Only devices with at least one output stream are listed.
    - `isDefault` compares with `kAudioHardwarePropertyDefaultOutputDevice`.
    - `dataSource` is `kAudioDevicePropertyDataSource` in the output scope when `AudioObjectHasProperty` says it exists, else `null`.
    - `terminalType` is `kAudioStreamPropertyTerminalType` of the first output stream, else `null`.
  - **JS:** `parseMacDevices(text: string): OutputDeviceInfo[] | null`, `null` when the text is not a JSON array.
    - Transport: codes are compared trimmed. `bltn` is `builtin`; `blue` and `blea` are `bluetooth`; `hdmi` and `dprt` are `hdmi`; `usb` is `usb`; `virt` and `grup` are `virtual`. Anything else, `airp` included, is `unknown`.
    - Form factor: for `builtin`, dataSource `hdpn` gives `headphones`, `ispk` gives `speakers`, and anything else is `unknown`. For `bluetooth`, terminalType `hdph`, `0x0302` or `0x0402` gives `headphones`, and `spkr` or `0x0301` gives `speakers`. Every other case is `unknown`.
    - `raw`: `{ uid, transport, dataSource, terminalType }`, codes as strings.

- [ ] **Step 1: Write the failing JS tests** with inline helper rows, one per table row of spec §4 macOS plus the Bluetooth terminal cases:
  - `External Headphones` (`bltn` / `hdpn`) gives headphones over builtin;
  - `MacBook Pro Speakers` (`bltn` / `ispk`) gives speakers;
  - `bltn` with a `null` data source is unknown;
  - `blue` with `hdph` gives headphones; `blue` with `spkr` gives speakers; `blue` with `0` is unknown;
  - `hdmi` is unknown over hdmi;
  - `usb ` (with its space) is unknown over usb;
  - `grup` is virtual; `airp` is unknown over unknown;
  - not JSON gives null.

- [ ] **Step 2: Run** `npx vitest run electron/output-form-factor-parse.test.js`. Expected: the new tests fail.

- [ ] **Step 3: Implement `parseMacDevices`**, then run the tests. Expected: all pass.

- [ ] **Step 4: Implement `--devices`** in `main.swift`. Reuse `globalAddress`, `objectIDs`, `stringProp` and `scopedAddress` (:100-140, :221) and `jsonEscape` (:84-98). Print with one `FileHandle.standardOutput.write`, as `runList()` does.

- [ ] **Step 5: Build and verify on an Apple Silicon Mac running macOS 14.2 or later:**
  - `bash native/audio-host/mac/build.sh`. Expected: both architectures build.
  - `out/sokuji-audio-host-darwin-arm64 --devices | python3 -m json.tool`. Expected: an array that lists the built-in speakers.
  - `bash native/audio-host/mac/verify.sh`. Expected: `VERIFY OK`, including the new `--devices` check (the output parses as an array, every row has the seven keys, and exactly one row has `isDefault: true`).

- [ ] **Step 6: Commit** `feat(audio): the macOS helper lists output devices with their transport and data source (#691)`.

### Task 4: Windows: the helper's `--devices` and its mapping

**Files:**
- Modify: `native/audio-host/win/main.cpp`. Add the includes for the property keys (`<functiondiscoverykeys_devpkey.h>`, preceded by `<initguid.h>` if the link needs it) and a `ListDevices()` next to `ListSources()` (:277-391). Add the `--devices` branch in `wmain` (:553-582).
- Modify: `native/audio-host/win/build.bat` (link `propsys` only if `PropVariantToString` is used) and `native/audio-host/win/verify.ps1` (a `--devices` shape check next to the `--list` one at :103).
- Modify: `electron/output-form-factor-parse.js`, adding `parseWinDevices`.
- Test: `electron/output-form-factor-parse.test.js`

**Interfaces:**
- Consumes: `capRaw` (Task 2).
- Produces:
  - **Helper output:** `--devices` prints one JSON array and exits 0, or exits 1. Each row is `{"id": "<IMMDevice::GetId>", "label": "<PKEY_Device_FriendlyName>", "isDefault": <bool>, "formFactor": <PKEY_AudioEndpoint_FormFactor as a number | null>, "enumerator": "<PKEY_Device_EnumeratorName> | null"}`.
    - The rows cover `EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)`.
    - `isDefault` compares ids with `GetDefaultAudioEndpoint(eRender, eConsole)`.
  - **JS:** `parseWinDevices(text: string): OutputDeviceInfo[] | null`.
    - Form factor: `1` (Speakers) gives `speakers`. `3` (Headphones), `5` (Headset) and `6` (Handset) give `headphones`. Every other value is `unknown`.
    - Transport, from the enumerator upper-cased: `BTHENUM` and `BTHHFENUM` are `bluetooth`; `USB` is `usb`; `HDAUDIO` is `hdmi` when the form factor is `9`, else `builtin`; `SWD` and `ROOT` are `virtual`; anything else is `unknown`.
    - `raw`: `{ id, formFactor, enumerator }`.

- [ ] **Step 1: Write the failing JS tests** with inline rows:
  - `Speakers (Realtek(R) Audio)` (1 / `HDAUDIO`) gives speakers over builtin;
  - `Headphones (Realtek(R) Audio)` (3 / `HDAUDIO`) gives headphones;
  - a Bluetooth headset (5 / `BTHHFENUM`) gives headphones over bluetooth;
  - a monitor (9 / `HDAUDIO`) is unknown over hdmi;
  - `CABLE Input (VB-Audio Virtual Cable)` (10 / `ROOT`) is unknown over virtual;
  - a USB DAC (2 / `USB`) is unknown over usb;
  - a `null` form factor is unknown;
  - not JSON gives null.

- [ ] **Step 2: Run** `npx vitest run electron/output-form-factor-parse.test.js`. Expected: the new tests fail.

- [ ] **Step 3: Implement `parseWinDevices`**, then run the tests. Expected: all pass.

- [ ] **Step 4: Implement `ListDevices()`.** Use `OpenPropertyStore(STGM_READ)` and read the three keys, with `PropVariantClear` after each. Print with the existing `JsonEscape` / `Utf8` (:53-78). A failure to create the enumerator prints nothing and exits 1.

- [ ] **Step 5: Build and verify on Windows 10 or 11:**
  - `native\audio-host\win\build.bat`. Expected: it builds with no warnings at the existing flags.
  - `out\sokuji-audio-host.exe --devices | ConvertFrom-Json`. Expected: an array.
  - `powershell -ExecutionPolicy Bypass -File native\audio-host\win\verify.ps1`. Expected: it passes, including the new check (an array, every row has the five keys, and at most one row has `isDefault: true`).
  - If no Windows build machine is at hand, the PR's `build (windows)` CI job (`.github/workflows/build.yml:268-280`) is the build check, and the run on a machine moves to Task 8.

- [ ] **Step 6: Commit** `feat(audio): the Windows helper lists render endpoints with their form factor (#691)`.

### Task 5: Main process: the reader, the Linux watcher and the IPC

**Files:**
- Create: `electron/output-form-factor.js`
- Modify: `electron/ipc-channels.js` (`'get-output-devices'` in `INVOKE_CHANNELS`), `electron/preload.js` (`'output-devices:changed'` in `validReceiveChannels`), `vite.config.ts` (entry `'output-form-factor': 'electron/output-form-factor.js'` and `'output-form-factor-parse': 'electron/output-form-factor-parse.js'`), and `electron/main.js` (call `registerOutputFormFactor` once in `app.whenReady`, around :535)
- Test: `electron/output-form-factor.test.js` (`// @vitest-environment node`)

**Interfaces:**
- Consumes:
  - `parseMacDevices`, `parseWinDevices`, `parsePactlSinksJson`, `parsePactlSinksText`, `parsePactlDefaultSink` and `capRaw` (Tasks 2–4);
  - `resolveAudioHostPath()` from `electron/audio-host-path.js`.
- Produces:
  - `getOutputDevices(deps?: { platform?: string; spawn?: typeof spawn; resolvePath?: () => string | null; timeoutMs?: number }): Promise<{ ok: true, devices } | { ok: false, reason: string }>`. It never rejects. The default timeout is `READ_TIMEOUT_MS = 3000`.
    - Reasons: `'no_helper'`, `'spawn_failed'`, `'exit_<code>'`, `'timeout'`, `'unparsable'`, `'unsupported_platform'`.
    - macOS and Windows: `spawn(helper, ['--devices'])`.
    - Linux: `pactl -f json info` and `pactl -f json list sinks`. If either exits non-zero or does not parse, it falls back to `pactl info` and `pactl list sinks`. Every `pactl` gets `env: { ...process.env, LC_ALL: 'C' }`.
    - Stdout is collected up to 1 MiB, and past that the child is killed and the read is `'unparsable'`.
  - `createSinkWatcher(deps: { spawn; onChange: () => void; warn: (msg: string) => void; backoffMs?: number[]; setTimeout?; clearTimeout? }): { start(): void; stop(): void }`.
    - It runs `pactl subscribe` with `LC_ALL=C`, and calls `onChange` on each line matching `/^Event 'change' on (sink #\d+|server)/`. The `server` change is how a new default sink is reported.
    - Changes within 200 ms of each other give one `onChange`.
    - `start` is idempotent: at most one child.
    - A child that exits while started is restarted after `backoffMs` (default `[1000, 5000, 30000, 60000]`, staying on the last). `warn` is called once per `start`.
    - `stop` kills the child and cancels a pending restart.
  - `registerOutputFormFactor(deps: { ipcMain; powerMonitor; app; getWindows: () => BrowserWindow[]; platform?; spawn?; resolvePath? }): void`.
    - It handles `'get-output-devices'`. On Linux the first call starts the watcher.
    - It sends `'output-devices:changed'` to every window's `webContents` on a watcher change and on `powerMonitor` `'resume'`.
    - It stops the watcher on `app` `'window-all-closed'` and `'before-quit'`.

- [ ] **Step 1: Write the failing tests**, with a `fakeChild()` EventEmitter like `electron/audio-host.test.js:6-12`:
  - `macOS runs the helper's --devices and maps it`: a fake spawn emits a mac row, and the result is `{ ok: true, devices: [one headphones row] }`.
  - `no helper path is no_helper`.
  - `a non-zero exit is exit_<code>`.
  - `unparsable output is unparsable`.
  - `a helper that never exits is killed at 3 s`: use fake timers and a child that never closes. After 3000 ms, `kill('SIGKILL')` was called and the result is `{ ok: false, reason: 'timeout' }`.
  - `an empty array is a real answer`: `{ ok: true, devices: [] }`.
  - `linux reads run pactl with LC_ALL=C`: every spawn's `options.env.LC_ALL` is `'C'`.
  - `linux falls back to text when -f json fails`: the json `list sinks` exits 1, and the text call's output is parsed.
  - `raw is capped`: a helper row with 20 extra keys yields `raw` with at most 12 keys.
  - `an unsupported platform is unsupported_platform`.
  - `the watcher pushes once for a burst of sink changes`.
  - `a default sink change pushes`: `Event 'change' on server` gives one push.
  - `the watcher ignores other events`: `Event 'new' on source #3` gives no push.
  - `the watcher restarts with backoff and warns once`.
  - `start twice keeps one child`.
  - `stop kills the child and no restart follows`.
  - `register: get-output-devices starts the watcher on Linux only; resume and a sink change push output-devices:changed to every window; window-all-closed stops the watcher`.

- [ ] **Step 2: Run** `npx vitest run electron/output-form-factor.test.js`. Expected: it fails because the module is not found.

- [ ] **Step 3: Implement** `electron/output-form-factor.js`, then the four wiring edits listed under Files. The module does not `require('electron')` at top level: `registerOutputFormFactor` receives `ipcMain`, `powerMonitor` and `app` from `main.js`, so Step 5's plain `node` run works.

- [ ] **Step 4: Run** `npx vitest run electron/output-form-factor.test.js electron/output-form-factor-parse.test.js electron/ipc-channels.test.js electron/entry-map.consistency.test.js electron/undeclared-names.consistency.test.js`. Expected: all pass.

- [ ] **Step 5: Run it on Linux:** `node -e "require('./electron/output-form-factor').getOutputDevices().then(r => console.log(JSON.stringify(r, null, 1)))"`. Expected: `ok: true` with this machine's sinks.

- [ ] **Step 6: Commit** `feat(audio): read output devices in the main process and push their changes (#691)`.

### Task 6: Renderer: read on events, join into the device list, look up an outlet

**Files:**
- Create: `src/lib/audio/nativeOutputs.ts`
- Modify:
  - `src/lib/audio/formFactor.ts`: add `getOutputFormFactor` and `useOutputFormFactor`.
  - `src/lib/audio/devices.ts`: `listAudioDevices` joins the forms and returns `defaultOutput`.
  - `src/stores/audioStore.ts`: `AudioDevice` gains `formFactor?` and `transport?`; the store gains `defaultOutputForm`; `sameDevices` compares both fields; `syncDevices` and `refreshDevices` set `defaultOutputForm`.
  - `src/routes/Home.tsx`: start the reader in Electron only, and call `requestForSync` in the `watchDevices` `sync`.
  - `src/electron.d.ts`, if `receive` needs a typed remover.
  - `docs/superpowers/specs/2026-11-05-output-form-factor-design.md`: correct §7's extension bullet per this plan's first ruling.
- Test: `src/lib/audio/nativeOutputs.test.ts`, `src/lib/audio/formFactor.test.ts`, `src/lib/audio/devices.test.ts` and `src/stores/audioStore.test.ts` (extend the existing ones where they exist)

**Interfaces:**
- Consumes: `matchOutputForm`, `UNKNOWN_FORM`, `OutputForm` and `NativeOutputsResult` (Task 1); the IPC names (Task 5).
- Produces:
  - `export type NativeReadReason = 'first' | 'devicechange' | 'push' | 'visible'`
  - `export const RETRY_DELAYS_MS = [1000, 5000, 30000]`
  - `export function createNativeOutputReader(deps: { read: () => Promise<NativeOutputsResult>; now: () => number; setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void; onUpdate: () => void }): { request(reason: NativeReadReason): void; current(): readonly OutputDeviceInfo[] | null; dispose(): void }`. Its rules:
    - `request` records the event's time and cancels a pending retry. It starts a read, unless one is in flight; then it starts another one after that read.
    - A read is current only if it **started** at or after the most recent event. A successful read that started before the most recent event does not make the answer current; another read follows at once.
    - `current()` returns the devices while the answer is current, else `null`.
    - A failed read schedules the next retry delay. The first failure is retried after 1 s, the second after 5 s and the third after 30 s; when that third retry fails too, no more reads happen until the next `request`.
    - `onUpdate` is called whenever `current()` would return something different (fresh becoming stale, or new devices).
  - `export function startNativeOutputs(onUpdate: () => void, deps?: { ipc?: { invoke; receive; removeListener? }; doc?: Document }): { request(reason: NativeReadReason): void; dispose(): void }`. It defaults to `window.electron` and `document`. It uses `ipc.invoke('get-output-devices')`, subscribes `ipc.receive('output-devices:changed')` (giving `request('push')`) and the document's `visibilitychange` (giving `request('visible')` when the page becomes visible), and calls `request('first')`.
  - `export function requestForSync(native: { request(r: NativeReadReason): void } | null, reason: 'change' | 'poll'): void`: a `'change'` requests `'devicechange'`, and a `'poll'` requests nothing. `Home.tsx` calls it inside the `watchDevices` `sync`, and starts the reader only when `isElectron()` and `window.electron` are both true.
  - `export function currentNativeOutputs(): readonly OutputDeviceInfo[] | null`: what the started reader holds, or `null` when none was started (the extension, tests).
  - `DeviceLists` gains `defaultOutput: OutputForm`. Each output gets `formFactor` and `transport` from `matchOutputForm(device.deviceId, <the browser's own label, before the placeholder>, currentNativeOutputs(), outputLabelsKnown, <its groupId is non-empty and equals the groupId of the unfiltered `default` audiooutput entry>)`. `defaultOutput` is `matchOutputForm(undefined, undefined, …)`.
  - `export function getOutputFormFactor(sinkDevice?: string): OutputForm` and `export function useOutputFormFactor(sinkDevice?: string): OutputForm` in `formFactor.ts`:
    - `undefined`, `''` and `'default'` give the store's `defaultOutputForm`;
    - `'communications'` gives `UNKNOWN_FORM`;
    - any other id gives that `audioMonitorDevices` entry's form, or `UNKNOWN_FORM` when it is absent.

- [ ] **Step 1: Write the failing reader tests** in `src/lib/audio/nativeOutputs.test.ts`, with a manual clock and a controllable `read`:
  - `never read is null`;
  - `a success makes it current`;
  - `an event after the last good read makes it stale until the re-read succeeds`;
  - `an event during a read is not answered by that read`: a read starts at t=0, the event comes at t=5, the read resolves ok at t=6, `current()` is `null`, and a second read has started;
  - `a failed read retries after 1 s, 5 s and 30 s, then stops`;
  - `a success ends the retries`;
  - `a request cancels a pending retry and reads now`;
  - `onUpdate fires on fresh → stale and on new devices, not on an identical re-read`;
  - `dispose cancels timers`.

- [ ] **Step 2: Write the failing join and store tests:**
  - `listAudioDevices joins each output's form` (a native list stubbed through the reader's `current`);
  - `without a reader every output is unknown` (the extension case);
  - `an output with an empty browser label is unknown`;
  - `the output sharing the default entry's groupId is the browser default`: two same-named outputs, one sharing the `default` entry's `groupId`; that one gets the native default's answer and the other is `unknown`;
  - `defaultOutput comes from the native default`;
  - `a form factor change alone replaces the output list`: `sameDevices` returns `false` when only `formFactor` or `transport` differs, and `syncDevices` sets the new array;
  - `getOutputFormFactor covers default, communications, a listed id and an absent id`.

- [ ] **Step 3: Write the failing wiring tests** in `src/lib/audio/nativeOutputs.test.ts`, with a fake `ipc` and document:
  - `startNativeOutputs reads once at start`;
  - `a push and a return to visible each request a read`;
  - `requestForSync: change requests devicechange, poll requests nothing`: after a `'poll'`, no further `invoke('get-output-devices')` follows;
  - `dispose removes the listeners`.

- [ ] **Step 4: Run** `npx vitest run src/lib/audio/nativeOutputs.test.ts src/lib/audio/formFactor.test.ts src/lib/audio/devices.test.ts src/stores/audioStore.test.ts`. Expected: the new tests fail.

- [ ] **Step 5: Implement** in the files above. `onUpdate` calls `useAudioStore.getState().syncDevices()`, which re-lists and re-joins. Nothing on the session start path awaits the reader.

- [ ] **Step 6: Run** the same tests plus `npx vitest run src/lib/audio src/stores src/routes`. Expected: all pass, and the existing device-watch tests are unchanged.

- [ ] **Step 7: Commit** `feat(audio): join each output's form factor into the device list, read on events only (#691)`, with the spec correction in the same commit.

### Task 7: The diagnostic log line

**Files:**
- Create: `src/lib/audio/formFactorLog.ts`
- Modify: `src/lib/audio/appAudio.ts`, extracting `outletContext(audio, faceToFace)` from `readRouting` (:45-62) and using it there; `src/app/session.ts`, wiring the logger in `attach()` next to the `runner.state` subscription (:179, :301-340).
- Test: `src/lib/audio/formFactorLog.test.ts`, and `src/lib/audio/appAudio.test.ts` unchanged and passing.

**Interfaces:**
- Consumes:
  - `getOutputFormFactor` (Task 6);
  - `resolveOutlet`, `OUTLET_NAMES` and `OutletName` from `src/lib/audio/outlets.ts`;
  - `useLogStore.getState().addLog(message, 'info')`, which does nothing while diagnostic logs are off.
- Produces:
  - `export function outletContext(audio: Pick<AudioState, 'selectedMonitorDevice' | 'audioMonitorDevices'>, faceToFace: boolean): OutletContext` in `appAudio.ts`.
  - `export function createFormFactorLog(log: (line: string) => void): { baseline(audio: AudioState): void; update(audio: AudioState): void }`. The line is exactly ``Output form factor: ${outlet} → "${label}" ${formFactor}/${transport}``. The label is the outlet device's store label, or `(system default)` when the outlet has no device.
    - `baseline` logs every outlet.
    - `update` logs an outlet only when its (label, formFactor, transport) differs from what it last logged.

- [ ] **Step 1: Write the failing tests:**
  - `baseline logs every outlet once`;
  - `update logs only an outlet whose triple changed`;
  - `a re-read that changes nothing logs nothing`;
  - `an outlet with no device logs (system default) with the default form`;
  - `nothing reaches the log store while diagnostic logs are off`, using the real `addLog` with `enabled: false`.

- [ ] **Step 2: Run** `npx vitest run src/lib/audio/formFactorLog.test.ts`. Expected: it fails.

- [ ] **Step 3: Implement** the logger and the `outletContext` extraction. In `attach()`:
  - `idle → starting` calls `baseline(useAudioStore.getState())`;
  - a `useAudioStore.subscribe` on `audioMonitorDevices`, `defaultOutputForm`, `outlets` and `selectedMonitorDevice` calls `update`;
  - the unsubscribe joins `attach()`'s cleanup.

- [ ] **Step 4: Run** `npx vitest run src/lib/audio src/app`. Expected: all pass.

- [ ] **Step 5: Commit** `feat(audio): log each outlet's form factor when diagnostics are on (#691)`.

### Task 8: Measure on real machines and pin captured fixtures

Someone at each machine plugs and unplugs by hand. This task changes code only where a measurement contradicts a mapping, and every such change is a new failing test first.

**Files:**
- Create: `electron/__fixtures__/output-devices/mac-applesilicon.json` and `win.json`, from the helpers' `--devices`, plus `linux-jack.json` and `linux-jack.txt`, from `pactl` with headphones plugged in and a second capture with them out. All are scrubbed as in Task 2.
- Modify: `electron/output-form-factor-parse.test.js`, adding one test per fixture that asserts the measured answer.

- [ ] **Step 1: Spec §9.1, labels.** On each platform, in the dev app with diagnostic logs on, compare every `audiooutput` label from `enumerateDevices` with the native labels, including the `Default - ` entry and the macOS default. Also check that the `default` entry's `groupId` equals the real default device's. Record the outcome per platform. If a platform's labels never match, its answer stays `unknown`: record that in the PR, and do not loosen the matcher.

- [ ] **Step 2: Spec §9.2–§9.5.** Check each of these:
  - Apple Silicon: plugging into the jack fires `devicechange`;
  - Bluetooth `terminalType` on macOS: record the codes seen for headphones and for a speaker;
  - Linux: a port switch gives a `pactl subscribe` sink `change`;
  - Windows: a jack-detecting codec fires `devicechange`;
  - Windows and macOS: changing the default output in the system settings fires `devicechange` (the spec's §6 assumption); Linux: it gives `Event 'change' on server`.

  A result that contradicts this plan gets a failing test and a fix in this task, or a follow-up issue where the spec says so (§6, §9.2).

- [ ] **Step 3: Spec §8.** On each machine, in a session, plug and unplug. Each change shows in the log line, a wake from sleep re-reads, and the extension logs `unknown`.
  - A platform nobody measured by hand is listed in the PR as **not verified on a real machine**, with what is untested. It is never described as working. Its unit tests are not a substitute.

- [ ] **Step 4: Run the whole check:**
  - `npx vitest run`. Expected: all pass, except the 4 Japanese-reading test files if `lindera-wasm` is not installed locally, which fail the same way on `main`.
  - `npx tsc --noEmit`. Expected: no errors in files this branch changed.

- [ ] **Step 5: Scrub the branch for the public repository:**
  - no people's names, machine names or chat channels in the spec, this plan, code, fixtures or commit messages (`git log origin/main..HEAD`);
  - no serial numbers or MAC addresses in fixtures.

  Fix the spec and the plan with a docs commit. Commit history is not rewritten; if a commit message carries such a name, stop and ask.

- [ ] **Step 6: Commit** `test(audio): pin the form factor answers measured on real machines (#691)`.
