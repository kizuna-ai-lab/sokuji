# Output device form factor: design

Issue: kizuna-ai-lab/sokuji#691 (prerequisite of #688). Status: for review.

## 1. Why

The app plays speech to output devices it knows only by name: the browser layer (`enumerateDevices`, `setSinkId`) gives a device id and a label, nothing about what the device is. #688 wants to skip agent text when the output is clearly headphones, because read-aloud speech in headphones cannot reach the microphone. Other features may later want the same answer (a hint in the audio settings, echo-cancellation defaults). This work gives the app that answer and changes nothing else.

## 2. Goals, non-goals, anti-goals

Goals

- For any output device the app can play to, the renderer can ask: headphones, speakers, or unknown, plus how it is connected.
- The answer follows the hardware during a session on Apple Silicon Macs, Windows and Linux: plugging or unplugging headphones updates it. Intel Macs are not verified: we have none to test on, and the watcher that case might need is not built here (owner ruling).
- Works on the desktop app on macOS, Windows and Linux; the extension answers `unknown`.

Non-goals

- No behavior change. Nothing reads the answer yet except a diagnostic log line; #688 is where it gets used.
- No mobile app work (iOS and Android have their own route APIs; separate issue if wanted).
- No input (microphone) devices.

Anti-goals (would make this a failure even if it works)

- Guessing from names ("AirPods", "Headphones" in a label). A wrong "headphones" would make #688 drop agent text where the speech does echo. Anything the system does not state plainly is `unknown`.
- A new long-lived local listening surface (socket, port) or a new permission prompt. The existing helpers are short-lived filters talking over stdio; this keeps to that.
- Slowing the start of a session: the answer is read ahead and cached, never awaited on the start path.

## 3. The answer

```ts
type FormFactor = 'headphones' | 'speakers' | 'unknown';
type Transport = 'builtin' | 'usb' | 'bluetooth' | 'hdmi' | 'virtual' | 'unknown';

interface OutputDeviceInfo {
  label: string;           // the system's own device name (helper / pactl); the browser's label is only matched against it (§5), never stored here
  isDefault: boolean;      // the system's default output
  formFactor: FormFactor;
  transport: Transport;
  raw: Record<string, string | number | boolean>; // platform values, for diagnostics only
}
```

The system's statement is the answer (owner ruling): whether a device is really worn cannot be known, so when the system says headphones, it is `headphones`. That includes powered speakers plugged into a headphone jack and speakerphones or car kits that report themselves as headsets or hands-free; #688's echo safety net covers those. `headphones` covers headphones, headsets, earbuds and phone-style handsets. `speakers` covers built-in and external speakers. Everything else, including line out, S/PDIF, HDMI and DisplayPort displays, USB interfaces that do not say, virtual devices and our own virtual cables, is `unknown`. `raw` is never read by logic.

## 4. Where each platform's answer comes from

### macOS: the existing `native/audio-host/mac` helper (Swift)

A new `--devices` command lists output devices as one JSON array on stdout and exits, like `--list`.

| Core Audio | Result |
|---|---|
| `kAudioDevicePropertyTransportType` = `bltn` (built-in) | transport `builtin`; the form factor comes from the output data source below |
| built-in output `kAudioDevicePropertyDataSource` = `hdpn` | `headphones` |
| built-in output data source = `ispk` | `speakers` |
| built-in, no data source or another value | `unknown` |
| `blue` / `blea` (Bluetooth / BLE) | transport `bluetooth`; the form factor from the device's Bluetooth class (below) |
| `hdmi`, `dprt` | `unknown`, transport `hdmi` |
| `usb` | `unknown`, transport `usb` |
| `virt`, `grup` (aggregate), `airp` (AirPlay), others | `unknown`, transport `virtual` or `unknown` |

Bluetooth: Core Audio's transport says only "Bluetooth". IOBluetooth could read the device's class, but on current macOS it sits behind the Bluetooth privacy permission, and the helper's requests are charged to Sokuji.app: that would be the new permission prompt §2 rules out. So the helper does not use IOBluetooth. It reads the output stream's `kAudioStreamPropertyTerminalType`, which needs no permission: a headphones or headset terminal type → `headphones`, a speaker type → `speakers`, anything else → `unknown`. If measurement shows Bluetooth devices do not report a useful terminal type, every Bluetooth output on macOS is `unknown` (AirPods included), which #688 treats like today. (My call.) Reading the transport and data source needs no permission (Sophie measured this on LittleSilver).

The helper is built for macOS 14.2 and later (`build.sh`, for the audio tap). On macOS 12 to 14.1 it does not start, `--devices` yields nothing, and every device is `unknown`, as per-application capture already is there. (My call.)

Apple Silicon Macs list the headphone jack as its own device ("External Headphones", built-in, data source `hdpn`); the rules above give it `headphones` without a special case.

### Windows: the existing `native/audio-host/win` helper (C++)

A new `--devices` command enumerates active render endpoints (`IMMDeviceEnumerator::EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)`, which the helper already opens) and the default (`GetDefaultAudioEndpoint(eRender, eConsole)`).

| `PKEY_AudioEndpoint_FormFactor` | Result |
|---|---|
| Speakers | `speakers` |
| Headphones, Headset, Handset | `headphones` |
| LineLevel, SPDIF, DigitalAudioDisplayDevice, UnknownDigitalPassthrough, RemoteNetworkDevice, UnknownFormFactor | `unknown` |

Transport from `PKEY_Device_EnumeratorName`: `BTHENUM` / `BTHHFENUM` → `bluetooth`; `USB` → `usb`; `HDAUDIO` → `builtin`, or `hdmi` when the form factor is DigitalAudioDisplayDevice; `SWD`, `ROOT` and anything else → `virtual` / `unknown` (VB-CABLE, our virtual microphone's bus, enumerates under these). The label is `PKEY_Device_FriendlyName`, the same string Chromium shows ("Speakers (Realtek(R) Audio)").

### Linux: `pactl`, no native code

The main process reads `pactl -f json list sinks`. The app already requires `pactl` on Linux (`electron/main.js` checks for it), and it answers the same on PipeWire (through pipewire-pulse) and on plain PulseAudio, so `pw-dump` is not needed. (My call.) For each sink: the label is `description` (what Chromium shows); the active port is `active_port`, and its entry in `ports` has a `type`; `properties` carry `device.form_factor`, `device.bus` and `factory.name`.

| Source | Result |
|---|---|
| active port type Headphones or Headset, or port name `analog-output-headphones` | `headphones` |
| active port type Speaker, or port name `analog-output-speaker` | `speakers` |
| `device.form_factor` = headphone, headset, hands-free, handset | `headphones` |
| `device.form_factor` = speaker | `speakers` |
| null sinks (`support.null-audio-sink`, including ours), HDMI ports, anything else | `unknown` |

The active port wins over `device.form_factor` (a laptop's `internal` card switches between a speaker and a headphone port). Older PulseAudio versions list ports without a `type`: then the port name decides, and only when the name says neither does `device.form_factor`. A `pactl` too old for `-f json` (Ubuntu 22.04 ships one) is read through the plain `pactl list sinks` text instead, for the same fields (description, active port, port names, the two properties). Transport from `device.bus`: `pci` → `builtin` (or `hdmi` for an HDMI port), `usb`, `bluetooth`; null sinks → `virtual`. Measured on LittleBlack (pactl 16.1): the JSON gives `active_port`, the ports' `type` (`HDMI` there) and `device.form_factor` (`internal`). LittleBlack has an HDMI output only, so the headphone/speaker switch is measured on a Linux machine with a jack (ZZ-164PC under Linux).

### Extension

Chrome gives an extension device names only. Every device is `unknown`, transport `unknown`. No permission is added.

## 5. Matching a sink to a device

The renderer knows an outlet's sink by its `deviceId` (or none: the browser default). It matches through `enumerateDevices` labels:

- No labels: without the microphone permission Chromium gives outputs empty labels. The existing `outputLabelsKnown` (from `listAudioDevices()` in `src/lib/audio/devices.ts`) says so; while it is false every outlet is `unknown`, and the answer is recomputed when the device list is next re-read with labels.
- `default` (and no device) → the native device with `isDefault`. The browser's default is the console default on Windows (`eConsole`), which is what the helper reports.
- `communications` (Windows) → `unknown` (rarely chosen; not worth a second default lookup).
- Otherwise the `audiooutput` entry's label, trimmed and with Chromium's `Default - ` / `Communications - ` prefix removed, is compared with the native labels. Exactly one equal label → that device. None or more than one (two identical USB headsets, two AirPods with the same name) → `unknown`. Nothing fuzzier than that: a looser match would be the guessing §2 rules out.

Label matching is what the browser layer allows: Chromium's device ids are salted hashes that the native side cannot reproduce. If a platform's Chromium labels turn out not to equal the native names at all, that platform answers `unknown` until the matcher is fixed; measuring this comes first (§9).

## 6. Keeping the answer current

When the native list is read. Only on events, never on a timer: on first use, on `navigator.mediaDevices` `devicechange` (devices appearing, disappearing, the default changing, on all three platforms), on a push from the native side (below), when the machine wakes (`powerMonitor` `resume`, forwarded by the main process) and when a window becomes visible again (`visibilitychange`). The existing 3-second poll in `deviceWatch.ts` re-lists the browser's devices but does not start a native read, so the helper is not spawned every few seconds. A failed read is retried after 1 s, 5 s and 30 s; a success ends the retries.

When the answer is stale, and what stale means. An answer is current only if the last successful native read came after the most recent of those events. It is stale, and every outlet reads `unknown`, while either holds: no read has ever succeeded, or an event arrived after the last successful read and the re-read has not succeeded yet. This is the contract #688 relies on: stale is `unknown`, never a remembered `headphones`. There is no time limit beyond that: the hardware's state changes only through those events, and a limit would need the timer this design avoids. The one case it does not cover is a change that produces no event at all (an Intel Mac's jack, see below); there the last answer stays, which #688's echo safety net covers.

Changes the device list does not show:
- Linux: a laptop's port change keeps the same sink. The main process runs `pactl subscribe` and pushes on a sink `change` event. It starts the watcher on the first `get-output-devices` request and stops it when the last window closes, so no subscribe channel is needed; at most one runs. If it exits, it is restarted with a backoff and a warning is logged once; `devicechange` and the other events still work meanwhile.
- macOS: on Apple Silicon the jack is its own device, so plugging in adds a device and `devicechange` fires. On Intel Macs the jack switches the data source on the same "Built-in Output" device, which may fire nothing. No `--watch` mode is built here (owner ruling): it could not be verified without an Intel Mac. If one turns up, it is a follow-up issue.
- Windows: jack detection makes endpoints appear and disappear, which Chromium reports as `devicechange`; no watcher unless measurement shows otherwise.

## 7. Shape in the code

- Main: `electron/output-form-factor.js` with `getOutputDevices()` that dispatches per platform (helper `--devices` on macOS and Windows, `pactl` on Linux), parses, maps per §4 and resolves to `OutputDeviceInfo[]`. It never rejects: a missing helper, a non-zero exit, unparsable output or a 3-second timeout resolve to a failed read, which the renderer treats per §6 (stale until a retry succeeds). Platform parsers are pure functions over the helper's JSON / the `pactl` JSON, unit tested with captured fixtures. `raw` values are capped in length before they cross IPC.
- IPC: an invoke channel (`get-output-devices`) added to `electron/ipc-channels.js`, and a push event (`output-devices:changed`) on the preload's receive allowlist.
- Renderer: no second device list. The existing pipeline (`listAudioDevices()` in `src/lib/audio/devices.ts`, the re-reads in `src/lib/audio/deviceWatch.ts`, the output list in the audio store) stays the one source of truth: each output it lists gains `formFactor` and `transport`, joined in from the native list by the matcher (§5) when the list is read, and a push from the main process triggers the same re-read. `src/lib/audio/formFactor.ts` holds the pure matcher and `getOutputFormFactor(sinkDevice?)` / `useOutputFormFactor(sinkDevice?)`, which look the resolved sink of an outlet up in that list and return `{ formFactor, transport }` (`unknown` while nothing is known).
- Extension: `extension/` is its own Vite project and does not import `src/`, so it has no path to this IPC; its device lists simply carry no form factor and read as `unknown`. Anything that later moves this code into a shared module must keep the Electron IPC out of the extension build.
- Diagnostics: when the diagnostic log is on (Help → diagnostic logs), a session start and each change log one line per outlet with its label, form factor and transport, only when that triple changes (the device list is re-read often). No visible UI. (My call: there is no diagnostics view to put a readout in, and a visible hint is a behavior change this issue excludes.)

## 8. Verification

- Unit tests: each platform's parser and mapping against fixtures captured on real machines (helper JSON from LittleSilver and BigBlack, `pactl` JSON and text from LittleBlack and ZZ-164PC), the matcher (no labels, prefixes, default, duplicates, missing), the stale rule (never read, an event after the last good read, a failed re-read, recovery on retry), the retry schedule, and that the 3-second poll starts no native read.
- The helpers' existing `verify.sh` / `verify.ps1` cover the `--devices` output shape.
- Measured on real machines, each with a headphone output and a speaker output, and a virtual or HDMI output where one exists: macOS (LittleSilver, Sophie), Windows (BigBlack), Linux (ZZ-164PC under Linux, which has a 3.5 mm jack, for the port switch; LittleBlack for HDMI). Each plug and unplug during a session updates the logged value; a wake from sleep re-reads. The extension logs `unknown`. Someone has to plug and unplug by hand on each machine: BigBlack and ZZ-164PC are one dual-boot machine, booted into each system in turn; on ZZ-164PC Andrew can drive the commands remotely and record while someone plugs.

## 9. Open points to measure (before or during the build)

1. Chromium's labels against the native names on each platform, including the `Default - ` entry and macOS's default. This decides whether §5 works at all, so it is measured first.
2. macOS: that plugging into the jack fires `devicechange` on LittleSilver (Apple Silicon). If it does not, a watcher becomes a follow-up issue; it is not added here.
3. macOS Bluetooth: whether `kAudioStreamPropertyTerminalType` tells headphones from a speaker.
4. Linux: that a port change produces a `pactl subscribe` sink change event.
5. Windows: that plugging headphones into a jack-detecting codec fires `devicechange`.

## 10. Left to the builder

Helper flag names, the JSON field names between helper and main, caching details, the watcher's backoff numbers, and the exact read timeout.
