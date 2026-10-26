# Gate A record

Spec §6, Gate A. Pass: 60 and 120 min locked without a gap longer than one
reconnect; the airplane-mode drop recovers with a fresh lease and the lines
already shown are kept; capture and the socket survive 5 min with another app in front.
Battery, heat and the 120 min cellular run moved to Gate B. The first version records
from the phone microphone only, even with a Bluetooth headset (no HFP input).

Build: development client (debug JS bundle from Metro). Battery and heat on a
debug build are an upper bound, not the release figure.

Checked before the runs:
- iOS `Info.plist`: `UIBackgroundModes` = `audio`; audio session category `record`.
- Android manifest: foreground service type `mediaPlayback|microphone`, with
  `FOREGROUND_SERVICE_MICROPHONE`.

## iPhone 11 (iOS 18.0)

| run | date | drops (count) | longest gap (s) | battery start→end (%) | heat (cool / warm / hot) | pass? | log pasted below |
|---|---|---|---|---|---|---|---|
| 60 min locked (Wi-Fi) | 2026-10-26 | 0 | 0 | not measured (plugged in) | not noted | pass (dev build; Release rerun pending) | yes |
| airplane 30 s (locked) | 2026-10-26 | 1 | 118.9 (phone offline at least 93 s; retry cadence 15 s) | not measured | not noted | pass (Release) | yes |
| other app in front 5 min | 2026-10-26 | 0 | 0 | not measured | not noted | pass (Release) | yes |
| BT headset in/out (optional) |  |  |  |  |  |  |  |
| incoming call (optional) |  |  |  |  |  |  |  |

## Pixel 9a (Android 17)

| run | date | drops (count) | longest gap (s) | battery start→end (%) | heat (cool / warm / hot) | pass? | log pasted below |
|---|---|---|---|---|---|---|---|
| 60 min locked (Wi-Fi) |  |  |  |  |  |  |  |
| airplane 30 s (locked) |  |  |  |  |  |  |  |
| other app in front 5 min |  |  |  |  |  |  |  |
| BT headset in/out (optional) |  |  |  |  |  |  |  |
| incoming call (optional) |  |  |  |  |  |  |  |

## Logs

<!-- Paste each run's "Copy log" output under a heading naming the phone and the run. -->

### iPhone — 60 min locked, Wi-Fi (development build, 2026-10-26)

```
2026-10-26T14:58:01.849Z first buffer: 16000 Hz, 1600 samples
2026-10-26T16:00:29.568Z close 1000  — 0.1s since last token   (Stop pressed)
```

### iPhone — airplane mode and Notes in front (Release build `proto r3`, 2026-10-26)

```
2026-10-26T16:14:47.759Z first buffer: 16000 Hz, 1600 samples
2026-10-26T16:14:48.783Z lease granted: 300.0 min
2026-10-26T16:15:03.988Z error socket_error [object Object]
2026-10-26T16:15:03.988Z close 1006 The operation couldn't be completed. Socket is not connected — 0.3s since last token
2026-10-26T16:15:05.622Z session-end gave up after 1634 ms (1634 ms since drop)
2026-10-26T16:15:05.634Z connect failed (#1): fetch failed: The Internet connection appears to be offline. — retrying in 2 s
2026-10-26T16:15:07.651Z connect failed (#2): ... — retrying in 5 s
2026-10-26T16:15:12.671Z connect failed (#3): ... — retrying in 10 s
...
2026-10-26T16:15:52.723Z connect failed (#6): ... — retrying in 15 s
2026-10-26T16:16:07.741Z connect failed (#7): ... — retrying in 15 s
2026-10-26T16:16:22.759Z connect failed (#8): ... — retrying in 15 s
2026-10-26T16:16:37.775Z connect failed (#9): ... — retrying in 15 s
2026-10-26T16:17:00.764Z lease granted: 300.0 min
2026-10-26T16:17:00.764Z new lease 116776 ms after the drop
2026-10-26T16:17:02.049Z reconnected after 118061 ms
2026-10-26T16:17:02.931Z first tokens 118943 ms after the drop
```
(Lines #4 and #5 were above the visible area of the screenshots. Then listening through 5 min with Notes in front.)
