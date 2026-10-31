# Output context sinks: echo cancellation that hears Sokuji

Date: 2026-10-31. Status: design, direction approved by the owner (2026-10-30, thread `#sokuji:41eff143`).

## Why

Echo cancellation in "Sokuji only" mode (`echoCancellation: true`) does not remove
Sokuji's own translated speech. On Linux, where Chromium has no `'all'`, nothing
removes it. The owner saw this on Windows and on LittleBlack.

The cause is the playback path. Chromium's canceller takes output from an
`AudioContext` as its reference, and does not take output from an `<audio>` element,
whether the element plays a `MediaStream` or a blob. PR #61 (commit `eb26b1bc4`,
merged 2025-07-25, released in v0.9.2) moved playback from `AudioContext.destination`
to `<audio>`, on the belief recorded in issue #55 that `AudioContext` output cannot be
a reference. The measurements say the opposite, and they say so on Electron 34, the
runtime of that time, as well as today. `graph.ts` still claims the `<audio>` elements
are there "so the browser's echo canceller sees it".

## Evidence

Measured with `getUserMedia` on a digital loopback, nothing audible: VB-Cable on
Windows, SokujiVirtualAudio on macOS, a null sink on Linux. Mic level in dBFS; about
-29 means nothing was removed. Bridge is the design below.

| Output | `true`, Windows, Electron 44.5.1 | `'all'`, same | `true`, Windows, Electron 34 | `true`, Linux, Electron 34 | `true`, macOS, Chrome 156 (two runs) |
|---|---|---|---|---|---|
| `<audio>`, MediaStream (today) | -29.2 | -96.5 | -29.2 | -29.7 | -29.8, -29.8 |
| `<audio>`, blob | -29.4 | -75.8 | -29.3 | -29.3 | -29.3, -29.3 |
| `AudioContext.destination` | -96.6 | -96.8 | -96.8 | -96.9 | -60.5, -86.9 |
| Bridge | -96.9 | -97.2 | -97.6 | -96.8 | -86.5, -59.8 |

The sink on Windows was not the default device, so a non-default sink is covered.

Latency and dropouts, Electron 44.5.1 (macOS: Chrome 156). Click latency includes the
same capture chain in every row, so only differences mean anything. Dropouts come from
a continuous 1 kHz tone, 240 seconds for bridge and `<audio>`, 60 for direct.

| | Direct `AudioContext` | Bridge | `<audio>` (today) |
|---|---|---|---|
| Windows, ms, start → end | 120.5 → 120.6 | 142.8 → 138.5 | 189.4 → 302.2 |
| Linux, ms, start → end | 49.2 → 49.8 | 75.5 → 71.7 | 86.8 → 197.8 |
| macOS, ms, start → end | 18.4 → 16.3 | 33.0 → 31.7 | 85.2 → 195.4 |
| Dropouts | 0 everywhere | 0 everywhere | 27 on Windows, 0 elsewhere |

The bridge drifts when its two contexts sit on devices with different clocks. Windows,
30 minutes, first context on Realtek and sink on VB-Cable: 3 dropouts of about 10 ms,
latency 138.9 → 172.6 ms in steps. Same-device drift was not measured past 4 minutes
(Linux, none).

The delay the bridge builds up clears by itself. After backing the stream up on
purpose, suspending the first context for 3 seconds and resuming it brought latency
back (Linux 149.7 → 74.3 ms, Windows 181.4 → 142.7 ms). So did a new source node and a
new sink context. A 400 ms back-up added only about 80 ms on Linux and 40 ms on Windows,
so the buffer looks bounded.

Not measured: real speakers with a real microphone on any platform, and Electron on
macOS (npm Electron needs a microphone grant clicked on the machine). Raw logs are
outside the repo, with the agent that ran them.

## Goals

1. With `echoCancellation: true`, Sokuji's own speech leaves the microphone on Windows,
   macOS and Linux, on the same Electron the app ships.
2. `'all'` removes it as well as it does today.
3. The user's own voice never enters the canceller's reference.
4. Latency is no worse than today.
5. An output device that vanishes recovers as well as it does today (#246). One the
   first context is not on takes down only its own outlet.

## Non-goals

- Changing the default mode (`'all'`), or the modes themselves.
- The mobile app, and `TabAudioRecorder`, which already plays through
  `AudioContext.destination`.
- The tooltip's "Browser only" sentence about meeting tabs. Nothing here measured it.
- A setting or remote flag to go back to `<audio>`. A revert is the rollback (the
  author's call, because two live paths would each need the device handling below).

## Anti-goals

The change has failed if, even though echo is gone:

- the user's own voice gets cancelled;
- losing a device other than the OS default stops the taps, the meters, the clip queues,
  the virtual microphone or another outlet;
- a clip that was playing or queued on a healthy outlet is lost that way;
- the user has anything new to set.

## Design

### The bridge

The three real outlets (`other`, `me`, `them`) leave through one `AudioContext` each.
The graph is unchanged up to the `MediaStreamAudioDestinationNode` each bus already
ends in. A sink context takes that stream with `createMediaStreamSource` and connects
it to its own `destination`, on the outlet's device.

The virtual bus stays on an `<audio>` element. It carries the user's voice (passthrough)
into the meeting. `routesFor` sends passthrough nowhere else, so with that bus outside
the reference, goal 3 holds by construction. A test pins it.

The direct alternative, one context on the sink with no stream between, was measured
and rejected. A context has one destination, the outlets each have a device, and nodes
cannot cross contexts, so it would mean a graph per device, joined by streams anyway.
It saves 15 to 25 ms and removes drift, at the price of rewriting feeds, routes, queues,
taps and meters, and of every chosen device being able to take a whole graph with it.

### The seam

`createSink` in `appAudio.ts` already hands a stream to something shaped like
`SinkElement`. It becomes `createSink(stream, bus)`: `virtual` gets the `<audio>` it gets
today, an outlet gets a context sink. `graph.ts` otherwise keeps working unchanged:
`switchBus`, its deadline, `rebuild`'s `srcObject` swap and `close()` all talk to
`SinkElement`.

A new module, `src/lib/audio/contextSink.ts`, implements `SinkElement` on an
`AudioContext`:

- `srcObject`: setting a stream makes a source node on the current context and drops
  the old one. Setting `null` tears the sink down: the context is closed and never
  awaited, because a wedged one may never settle (#246).
- `paused`: true while the context is not `running`. `play()` calls `resume()` again,
  so a sink that was refused before the first user gesture starts on the next call.
  `play()` never hangs on a `resume()` that does not settle (#246).
- `setSinkId(id)`: builds a new context on the device, starts it, moves the stream to
  it, and only then closes the old one. On a failure the new context is closed, the old
  one keeps playing and the call rejects, which is what `switchBus` expects of an
  element ("keeps playing wherever it was"). A new context rather than `setSinkId` on
  the running one, because a wedged context can report success (#246), and because
  switching a running sink was not measured.
- Contexts run at `SAMPLE_RATE` with the default `latencyHint`, the measured setup.

### A device that vanishes (#246)

The graph's wedge watch sees only the first context, so each sink gets its own, of the
same shape and with the same constants (`WEDGE_GRACE_MS`, `RESUME_DEADLINE_MS`,
`MAX_REBUILDS`): a context that leaves `running` unasked waits out the grace, is told to
resume, and past the deadline is replaced by a new context on the same device. Rebuilds
in a row stop at the cap, reported once. A device that never comes back recovers the way
it does today: `deviceWatch` resolves another device, `setSinks` calls `setSinkId`, and
that builds a fresh context. None of this touches the first context, the queues or the
taps.

The first context has no device of its own: it sits on the OS default. So when the lost
device is the OS default, as with a headset that is both the default and the chosen
output, that context wedges too, the graph rebuilds as it does today, `onReset` clears
the queues, passthrough and the preview, and `rebuild` hands every sink the new stream.
That is today's behaviour, and this change leaves it as it is (the author's call). Taking
the first context off the hardware (`sinkId: { type: 'none' }`) would put every session
on the drift accepted below for two devices, unmeasured, and making the queues survive a
rebuild reworks `ClipQueue` and the playback. Neither belongs to an echo fix.

### Drift

Nothing extra. The first context already rests 5 seconds after the last session goes
quiet (`QUIET_MS`, `graph.suspend()`), and resuming it clears what the bridge built up
(measured above). The owner accepted the cost during a long session on two different
devices: a dropout of about 10 ms roughly every 10 minutes and a few tens of milliseconds
of latency, still better than `<audio>`. The reset at session start proposed in the
thread is therefore dropped.

### Comments and text

- `graph.ts`: the header comment and the `SinkElement` doc stop saying `<audio>` is what
  the canceller sees.
- `CLAUDE.md`, the outlets line: the outlets leave through sink contexts, the virtual
  bus through an element.
- The tooltip stays. "Sokuji only — Removes Sokuji's translated speech" was false and
  becomes true, so the 30 catalogs need no change. This replaces the rewrite proposed in
  the thread.

### What else moves, and does not

- The echo monitor reads the tap in the first context against the post-AEC microphone.
  Output latency falls, which moves its lags down inside the 20–600 ms band of `tts-echo`.
  The 0–40 ms `routing-loop` band demands rho ≥ 0.9, which acoustic bleed does not reach.
  No change needed. `tts-echo` notices in "Sokuji only" mode should become rarer, which
  is right.
- The extension shares `appAudio.ts`, so it gets the same outputs and the same fix.
  `minimum_chrome_version` 116 is above `AudioContext.setSinkId` (110).
- Nothing in `src/` compensates for output latency, so no constant changes.

## Testing

Unit, with fakes in the style of `graph.test.ts`:

- `contextSink`: the stream is connected on creation; `play` resumes and retries;
  `paused` follows the state; a switch keeps the old context until the new one runs; a
  failed switch closes the new context, keeps the old and rejects; a stale switch does
  not win; `srcObject` swap and `null`; the wedge watch (grace, resume, deadline, new
  context, the cap, the reset on `running`); a hanging `resume()` or `close()` holds
  nothing.
- `graph`: `createSink` receives each bus; a rebuild swaps every sink's stream.
- `appAudio`: `virtual` gets an element, the outlets get context sinks.
- Passthrough reaches no outlet (`routesFor`).

On real machines, before the PR is called ready. Windows is BigBlack, macOS LittleSilver,
Linux LittleBlack, on a build of the branch:

1. "Sokuji only" (Linux: the only mode), speakers and a real microphone, speech playing:
   the translation does not come back into the transcript. This is the owner's original
   report, and the owner is the judge of it.
2. "All sounds" on Windows and macOS: as good as today.
3. Switch the output device mid-session, and change the OS default mid-session.
4. Unplug a USB or Bluetooth output mid-session. A device that is not the OS default:
   that outlet recovers on another device, and other outlets, the virtual microphone and
   the queues carry on. The OS default: the graph rebuilds as it does today and every
   outlet comes back.
5. Face-to-face on two devices with pans: each side hears its own.
6. The extension in Chrome: outputs play on the chosen device.
7. The digital loopback probe on the shipped Electron on macOS, which only a clicked
   microphone grant allows, or the app itself in its place.

## Left to the builder

The file layout inside `contextSink.ts`, whether the watch shares code with the graph's
or repeats its small shape, how a sink is told its clock and its reporting, and how
`appAudio.ts` chooses by bus. Whether a sink context for an outlet nothing is routed to
is built lazily, as long as today's behaviour of a fresh device choice holds.
