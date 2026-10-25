# Karaoke timing probe

Evidence and acceptance for `docs/superpowers/specs/2026-10-25-karaoke-provisional-ranges-design.md`:
how soon, and how accurately, karaoke lights on providers whose ranges are filled in late.

- `soniox.mts` runs the app's own Soniox adapter against the real service with recorded speech
  at real-time pace and logs every adapter event and TTS frame with its arrival time. Billed to
  the key's owner: the four runs together are about 3 minutes of speech, about US$0.03. Ask first.
- `simulate.mts` replays logs through the app's own code (`QwenSegments` on Qwen's raw wire
  frames, the logged Soniox adapter events, `ClipQueue`, `nextLit`) on a simulated clock and
  measures each method against where the voice really is.
- `words.py` makes that ground truth: faster-whisper word timestamps on a run's output audio.
- `fixtures/`: the 9 Qwen probe logs of 2026-10-12/13 (server frames only), the 4 Soniox logs of
  2026-10-25 (recorded before provisional ranges), word timestamps for all 13, and
  `manifest.json`. No audio is committed.

In `summary.jsonl`, method `A` is the log as recorded, `B` and its variants add the simulated
estimate, `C` is the ceiling (exact ranges from the first chunk).

## Re-measure the committed recordings

    npx tsx scripts/dev/karaoke-probe/simulate.mts

Qwen's logs are raw wire frames, so `A` runs whatever `QwenSegments` the checkout has: after the
change it is the new code. The committed Soniox logs are adapter events from before the change,
so their `A` stays the old behaviour.

## Acceptance run (Soniox)

1. With the owner's go-ahead and a key from them, record the four sessions on the new code:

       for r in ja-en ja-zh zhja-en zh-ja; do
         SONIOX_API_KEY_FILE=<key file> npx tsx scripts/dev/karaoke-probe/soniox.mts $r --region <region>
       done

   Each run writes `<stamp>-<run>.jsonl`, `.out.wav` and `.in.wav` to
   `.superpowers/karaoke-probe/soniox/` (ignored by git).
2. Word timestamps for each `.out.wav` with `words.py` (see its header for the one-time setup).
3. A manifest listing the four new runs (`kind: "soniox"`, `target` the run's target language,
   `log`, `words`, and `wav` for playback files), then
   `npx tsx scripts/dev/karaoke-probe/simulate.mts <manifest> <outDir>`.
4. Per provider, method `A` against method `C` of the same runs: unlit share within 1 point of
   `C`'s, largest-step median ≤ 10%, highlight-vs-voice p90 within 100 ms of `C`'s.
