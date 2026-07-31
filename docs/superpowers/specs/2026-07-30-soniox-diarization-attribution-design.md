# Soniox Speaker-Diarization Attribution — Design

**Date**: 2026-07-30
**Status**: Approved (brainstormed with user; grounded in the live-API spike reported on issue #342)
**Tracking**: issue #342 item 4
**Depends on**: PR #368 (`feat/soniox-advanced-settings`) — this branch is stacked on it; rebase onto main after #368 merges.

## Summary

Use Soniox speaker diarization to make Both-shared-session side attribution
robust in the case the current language-based inference structurally cannot
handle: both sides speaking the same language. Enable
`enable_speaker_diarization` only for the shared bidirectional session, and
replace the single-evidence side inference with a three-tier chain — mixer
energy evidence (primary bootstrap), a persistent speaker-label→side map
(cluster memory), and the existing language method (fallback). No UI changes,
no new settings, no billing impact.

## Spike evidence (2026-07-30, live API — full report on #342)

- Same-language two-speaker material: diarization token accuracy **1.000**
  under the production endpoint config (6/6 segments, 0 flips); the language
  method scored 0.495 there (coin flip, as predicted).
- The aggressive production endpoint config (`max_endpoint_delay_ms: 500`)
  did NOT hurt diarization — it beat endpoint-off in every scored material.
  No endpoint changes are needed or made.
- Labels are ordinal and session-stable ("1" = whoever spoke first) — they
  cluster reliably but carry no mic/far-end identity, hence the bootstrap.
- Translation tokens carry `speaker` too (274/274 in the spike).
- Overlap: attribution had zero cross-talk, but single-stream mixing still
  degrades overlapped ASR quality — the two-client fallback toggle keeps its
  reason to exist.

## Decisions

| Decision | Choice |
|---|---|
| Scope | Both shared session only (`bidirectional=true`); one_way sessions know their direction and don't enable diarization |
| speaker→side mapping | Hybrid: energy evidence (primary) + label-map memory + language fallback |
| Bubble granularity | Per-utterance (unchanged): side decided at the first original token, reset at `<end>`. Token-level splitting on mid-utterance speaker change is a possible follow-up, not v1 |
| User setting | None. Always on for the shared session; the existing shared-session toggle is the escape hatch |
| Multi-speaker far end | All far-end labels map to `participant` (their audio is on the B channel, so energy voting produces this naturally); no per-person UI |
| Wire compatibility | `enable_speaker_diarization` sent only when enabled — non-shared sessions stay byte-identical (the #368 default-neutral convention) |

## Architecture

### 1. Wire (`SonioxSttStream`)

`SonioxSttConfig` gains `enableSpeakerDiarization?: boolean`; the first-frame
config includes `enable_speaker_diarization: true` only when truthy (falsy →
key absent, wire unchanged). `SonioxClient.connect` sets it iff the session is
bidirectional.

### 2. Energy timeline (`PcmMixer` → `SonioxClient`)

- `PcmMixer`'s `onFrame` callback signature becomes
  `(mixed: Int16Array, energyA: number, energyB: number)` — per-frame
  mean-absolute level of each channel, computed inside the existing mix loop
  (internal class; only SonioxClient and tests consume it).
- SonioxClient records `(energyA, energyB)` into a bounded ring buffer **at
  the send site** — only for frames actually sent (`stt.isOpen()`), because
  dropped frames don't advance the server's audio clock. Frame index × 100 ms
  is therefore the server audio timeline, directly comparable to
  `token.start_ms`/`end_ms`.
- Ring capacity: 600 frames (60 s). A token window outside the retained range
  is a timeline miss → next tier.

### 3. Side inference (three-tier chain, one function)

Evaluated where `utteranceSide` is decided today (first original token of an
utterance; also the translation-token fallback path):

Within one `inferSide` call the order is: compute the energy verdict first
(it needs no `speaker`), cast its vote when both a verdict and a `speaker`
are present, then answer by the highest tier available:

1. **Label map**: if `speakerSideMap` holds an established side for
   `token.speaker` (checked after any vote from this same call — the arriving
   evidence counts toward establishment immediately), use it.
2. **Energy evidence**: sum `energyA` vs `energyB` over the frames covered by
   `[token.start_ms, token.end_ms]`; if the ratio ≥ 2× (constant, tunable),
   that channel's side wins — and, when the token carries a `speaker`, casts
   one vote into `speakerSideMap[token.speaker]`. A label's side is
   *established* at a rolling net majority of ≥ 2 votes; votes keep
   accumulating without a cap (no lock-in), so a mis-bootstrapped label can
   be flipped by sustained later evidence while deep history absorbs single
   glitches. A window whose older frames were already evicted from the ring
   is a miss — no verdict and no vote from partial windows.
3. **Language fallback**: no usable evidence from tiers 1-2 (ambiguous energy
   — echo, cross-talk, overlap — with no established label; or missing
   speaker/timing) → the existing language-comparison logic, verbatim.
   Language-derived sides are used for display only and never vote into the
   map (in the same-language case the language method is precisely the
   unreliable witness).

If `speaker` is absent from a token, the label tiers never engage and no
votes accrue, but a lone energy verdict still attributes the utterance; with
neither `speaker` nor usable timing, behavior degrades to today's language
method. `<end>` still resets `utteranceSide`; the map and timeline persist
across utterances and are cleared on disconnect/reset.

### 4. Consumers

- `item.source`, `detectedLanguage`, and the bubble pipeline consume
  `utteranceSide` unchanged.
- `feedTts`'s direction gate (v1 speaks only me→other) switches from per-token
  `source_language` comparison to the current `utteranceSide`. The
  `audioItemSide` snapshot mechanism for trailing audio stays as is.

## Testing

- `PcmMixer`: per-frame energy values on the extended callback (silence → 0,
  known amplitudes → expected means, starved-channel zero-fill → 0 energy).
- `SonioxSttStream`: `enable_speaker_diarization` present when configured,
  absent otherwise (the #368 presence/omission test pattern).
- `SonioxClient` scenario tests (mock streams + injected energy frames):
  - same-language both sides → correct attribution where the language method
    would misattribute (the spike's key case, reproduced as a unit test);
  - cold start: first utterance attributed correctly from energy alone;
  - overlap (both channels hot) → established label map takes over;
  - missing `speaker` fields → language fallback, behavior identical to today;
  - map flip protection: net-majority voting corrects an early wrong vote;
  - TTS gate: participant-side translations are not fed to TTS.
- Existing Both-mode suites pass unchanged.

## Known limitations

- Real meetings (noise, similar voices, echo leakage) will be harder than the
  spike's clean TTS material; the tier chain guarantees the worst case equals
  today's behavior.
- The 2× energy-ratio threshold and the 60 s ring are starting constants,
  centralized for tuning.
- The side is decided once per utterance, at its first token (the approved
  per-utterance granularity). If that first token carried no usable
  diarization evidence, the language-derived side sticks for the rest of the
  utterance even when later tokens bring evidence — accepted: re-attribution
  mid-utterance would flip the bubble and the TTS gate mid-stream, and
  production first partials were live-verified (2026-07-31) to already carry
  `speaker` + `start_ms`, so the window is theoretical.
- Mid-utterance speaker changes still merge into one bubble (as today);
  overlapped speech still degrades single-stream ASR quality — the two-client
  toggle remains the answer for overlap-heavy calls.
