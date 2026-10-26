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
| 60 min locked (Wi-Fi) |  |  |  |  |  |  |  |
| airplane 30 s (locked) |  |  |  |  |  |  |  |
| other app in front 5 min |  |  |  |  |  |  |  |
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
