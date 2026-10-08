# Soniox Speaker Labels and Face-to-Face — Design

**Date**: 2026-10-08
**Status**: Approved section by section in chat (owner, 2026-10-08); written spec pending review.
**Scope**: Soniox and Kizuna AI's managed Soniox (`kizunaai_soniox`), plus the sokuji-backend
work managed participant speech needs.
**Evidence**: a live-API spike on 2026-10-08 (owner's dedicated key, throwaway scripts, about
$0.13; numbers below and on kizuna-ai-lab/sokuji#580); UI mockups on the canvas artifact
https://claude.ai/artifact/M7MNE6XyrpnnunWwr6H5W6 (boards 1–6).
**Related**: `docs/superpowers/specs/2026-07-30-soniox-diarization-attribution-design.md` (shared
Both attribution, which this extends); `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`
"Managed participant speech — turning it on" (slice 3 carries it out); #580 (client-side cuts, deferred
there); #579 (participant TTS).

## Summary

Three slices, one spec, each slice mergeable on its own:

1. **Both defaults to split; one-way legs hint both languages.** `bothModeSharedSession` defaults to
   `false`. A one-way Soniox leg sends `language_hints: [source, target]` instead of `[source]`.
2. **Person labels.** The participant one-way leg turns diarization on. Segments carry a `person`
   label; a leg that has had two people shows "Speaker N" in the conversation, the subtitle window,
   the LAN viewer and the exports.
3. **Face-to-face.** Both mode gains a second place for the other side: "beside me", on the same
   microphone. The shared two_way socket with diarization attributes each utterance by speaker label
   and language; each person hears the translation into their own language in one ear. Managed
   Soniox gets participant speech (`par_tts`) from the backend so it can speak both ways.

Out of scope: TTS emotion tags; `two_way` in Others mode; Soniox endpoint detection off with
client-side cuts (#580); one TTS socket carrying two streams.

## Evidence (spike, 2026-10-08)

All runs on `stt-rt-v5`, production config unless stated.

| Question | Result |
|---|---|
| one_way → ja on en/ja/zh speech | en and zh translated; ja (the target) arrives `translation_status: 'none'`, untranslated. Hints `[en]`, `[en, ja]`, none: identical on clean audio |
| two_way ja↔en on a third language | zh arrives `'none'` — not translated. Others stays one_way |
| Face-to-face, one mic, two_way + diarization | attribution by language alone 10/12 and 8/11; by label + language 12/12 and 10/11. The labels fix code-switched lines |
| Two people, 0.15 s between turns | two turns merge into one utterance with one label; no endpoint knob fixes it (sensitivity 1.0, max delay 500 ms: no change; sensitivity 1.0 + latency level 3 over-splits and mints a phantom label). Endpoint detection off fixes it but drops `<end>` — #580 |
| Labels inside an utterance | never change while endpoint detection is on (jp_conv: 7–21 % of utterances hold two people, 0 split) |
| Partial → final label flips | 0.3–1.9 % of tokens |
| Multi-person meetings (AMI 4 people, jp_conv 4-party) | 2–5 labels for 4 people, purity 0.46–0.66; speaker changes found 60–82 % (precision 64–78 %). Who is wrong more often than when |
| One person, natural speech | one label throughout (AMI headset 44/44 utterances, CALLHOME ja 64/64). Stitched emotional studio clips split (42 %) |
| Diarization's cost | no latency (first seen p50 645 vs 638 ms, final 1094 vs 1114 ms); bundled in the price; transcript differences within run-to-run noise (0.936 vs 0.959 word similarity) |
| One TTS socket, two concurrent streams | works (ja + en in parallel); not used — see D9 |

## Decisions

| # | Decision | Owner's ruling |
|---|---|---|
| D1 | Both's default | split (`bothModeSharedSession: false`); stored per field, so everyone who never touched the switch moves |
| D2 | One-way hints | `[source, target]`, source first; auto source sends none; deduplicated after wire mapping |
| D3 | `two_way` in Others | no — one_way already translates every language into mine; two_way drops a third language |
| D4 | Diarization | on for the participant one-way leg and every shared socket; off for the speaker leg |
| D5 | Labels in Others | shown, accepting merged people in large meetings (option C) |
| D6 | When a label shows | once a leg has had two people; until then the leg reads "Other" as today |
| D7 | Where labels show | main conversation, subtitle window (expanded and compact), LAN viewer, JSON and TXT export, auto-save |
| D8 | Face-to-face's place | a Both "other side" choice, "beside me (same microphone)" (option C); not a fourth mode, not a Me switch; the setup wizard offers it |
| D9 | Face-to-face speech | the existing participant-speech path: each leg its own TTS socket and key |
| D10 | Ears | left = me, right = the other person, swappable; route by the translation's language; a translation into the speaker's own language is not played |
| D11 | Managed Soniox | the backend mints `par_tts` inside slice 3 (option b); managed and own-key face-to-face ship speaking together |
| D12 | The participant's voice | a new built-in-only "other party's voice" setting, default a built-in voice unlike mine (option a) |
| D13 | Endpoint detection | stays on in v1; client-side cuts belong to #580 |
| D14 | "Not played" mark | a small icon-only tag; the reason on hover |

## Slice 1 — Both defaults to split; both-language hints

**Default.** `SONIOX_DEFAULTS.bothModeSharedSession = false` (`src/providers/soniox/settings.ts`). A
stored boolean is kept; anything else falls to the default, as `migrateSonioxSettings` already does.
No migration code (the owner's standing rule).

**Hints.** `SonioxSession.sttConfig()` (`src/providers/soniox/adapter.ts`) sends, for a one-way leg:

- `language_hints: [toWire(source), toWire(target)]`, source first, when the source is not `AUTO`;
- nothing when the source is `AUTO` — hinting only the target would pull an unknown speaker toward
  the other side's language;
- one entry when both map to the same wire code.

The shared two_way config is unchanged (it already sends both). Managed Soniox follows: it builds
on the same adapter.

**Elsewhere.** sokuji-backend's cost calculator says "Leave this off unless you turned the shared
session off in Sokuji" (`dashboard.wallet.pricing.calcSplitHint`), and its checkbox defaults to
shared. Both move to the new default in slice 3's backend PR.

**Tests.** `settings.test.ts` (the default, a wrong-typed value's fallback), `lease.test.ts` (shared
cases state `bothModeSharedSession: true` instead of leaning on the default), `adapter.test.ts`
(two hints, source first; none for auto; dedupe), `adapter.both.test.ts` (split legs, each its own
order).

## Slice 2 — Person labels

### Wire

`enable_speaker_diarization: true` on the participant leg's one_way config (Others; Both split's
participant leg) as well as on every shared socket. The speaker leg's config is unchanged.

### Contract

`AdapterEvents.segmentOpened` and `segmentText` (`src/lib/contract/adapter.ts`) gain
`person?: string`. Not `speaker`: that word is the speaker leg (`LegName`).

- Same life as `language`: set at open, replaced by a later defined value, never cleared.
- A source segment and its translation carry the same `person`.
- An adapter that has no labels leaves it out; nothing changes for other providers.
- The conformance suite needs no new rule.

### Soniox adapter

- The utterance takes its label at its first original token (`begin()`), as its leg is taken today.
  Each `segmentText` re-sends the majority label of the utterance's final original tokens, so an
  early flip corrects itself.
- The value is scoped to the socket: `${socketEpoch}.${label}`. A reconnect (`adapter.ts`, the
  resume path that calls `utterances.abandon()` and `tracker.reset()`) starts a new epoch, because
  Soniox numbers from 1 again on a new socket and cannot say who is who across sockets.
- Translation tokens carry `speaker` too (spike: every one); the translation segment takes the
  utterance's label.

### L1 and L2

- `Segment` (`src/lib/conversation/types.ts`) gains `person?: string`; `Conversation.ts` sets it on
  open and in `replaceText` like `language`, and the no-change early return compares it.
- `Row` (`src/lib/projection/types.ts`) gains `person?: string`; `cut.ts` copies it and `sameRow`
  (`project.ts`) compares it.
- Groups need no change: Soniox's stated `origin` is one utterance, so one group is one person.

### Numbering

One pure function over L2's entries, `people(entries)`, used by every surface so their numbers
agree:

- per leg, the distinct `person` values in order of first appearance → 1, 2, 3, …;
- `labelled(leg)`: true once that leg has two;
- a reconnect's new epoch counts as new people (4, 5, …): honest, since nobody knows.

### Surfaces

| Surface | Change |
|---|---|
| Main conversation (`ConversationList.tsx`, `view/filter.ts`) | a labelled leg's header shows a numbered avatar in the leg's colour family and "Speaker N"; a header also opens when the person changes inside a leg (`filter.ts:87` compares the leg only today). Board 3 |
| Subtitle window, expanded | the same list: nothing more |
| Subtitle window, compact (`lib/subtitle/bands.ts`, `SubtitleBands.tsx`, `SubtitleStream.scss`) | a run carries its person; where a labelled leg's person changes between runs, a numbered dot is drawn before the run, the same number in the source band and the translation band; it scales with the font size. Board 6 |
| LAN viewer (`lib/share/types.ts` `ViewerRow`, `viewerEntry.ts`, `viewer/text.ts`, `viewer/CaptionList.tsx`) | the publisher sends the display number when the leg is labelled; the viewer renders "Speaker N" from its own strings. Board 5 |
| JSON export (`lib/export/transcript.ts`) | a group of a labelled leg carries `person: N`; additive, so the format stays `sokuji-conversation/2` |
| TXT export and auto-save | a group's header reads `[10:02:11] Speaker 2` instead of `Other` when its leg is labelled |

Words: one key, "Speaker {{n}}", in the 30 catalogs, reused by the export; its `viewer.*` twin, then
`node scripts/gen-viewer-strings.mjs`.

### Tests

The adapter turns diarization on only where D4 says, sends the majority label and the epoch; L1
keeps the latest `person`; L2 carries and compares it; `people()` numbers by first appearance and
labels at two; the list opens a header on a person change; the compact bands draw the dot only at a
change of a labelled leg; the viewer shows the label; the JSON and TXT exports and the auto-save
write it.

## Slice 3 — Face-to-face

### The setting and who offers it

- `audioStore` gains `otherSide: 'meeting' | 'beside'`, default `'meeting'`, persisted like the
  other audio choices.
- A provider definition gains a capability, `faceToFace?: boolean`, beside `participantSpeech`
  (`src/lib/provider/types.ts`). Soniox and Kizuna Soniox declare it.
- The choice shows only in Both mode under a provider that declares it; otherwise it is hidden (the
  standing rule for unavailable controls) and the run is ordinary Both. The stored value is kept.
- `routingStore` gains `faceToFaceSwap: boolean`, default `false` (left = me), persisted.
- The setup wizard (`src/lib/setup/scenarios.ts`, `StepScenario.tsx`) adds two scenarios, "Face-to-face
  conversation" (voice and subtitles) and "Face-to-face conversation, subtitles only", that set Both,
  `otherSide: 'beside'` and text-only accordingly. They look like every other card (no badge, no
  provider note); `providerFits` offers only providers that declare `faceToFace`. Board 4.

### The run

Face-to-face is Both: two legs, nothing new in the runner.

- **Capture.** `appCapture.open('participant')` returns a silent source when `otherSide` is
  `'beside'`: it never emits pcm and stops at once. This works on every platform, the web included,
  since no system audio is needed.
- **Shape.** Soniox's builder forces `sharedBoth: true` (the shared-session switch shows disabled,
  with the reason); the run forces participant speech on unless text-only; the meeting route (speaker
  → virtual) is off.
- **Lease.** Managed Soniox asks for the shared roles and, when the participant speaks, `par_tts`
  (below).

### The adapter

- Diarization on (the shared socket already has it).
- Attribution without the energy tier: the participant channel is silent, so energy would hand
  every utterance to the speaker. In face-to-face the side tracker takes its votes from each
  utterance's language (the pair's source → speaker, target → participant) into the
  label → side map; a label with an established side decides; language decides before that. This
  is the spike's 12/12 rule.
- **A leg speaks only translations into its own target.** When a translation's language is the leg's
  source (someone code-switched), the leg does not speak it. This holds in every mode: in shared Both
  today a line I say in the other language comes back in mine and is spoken into the meeting.

### Speech and the participant's voice

- D9: the participant leg speaks through its own TTS socket, as participant speech already does.
  Own-key Soniox opens a second socket on the same key; managed Soniox uses `par_tts`.
- `SonioxSettings` gains `participantVoice` (built-in voices only; one field, since built-in voices
  are not per region), default `'Grace'`; when it equals the user's voice for the region, the builder
  uses `'Adrian'` instead, so the two never sound alike by default. The builder gives the participant
  leg's speech this voice (`config.ts` gives both legs the region's voice today). The field shows
  only when the participant speaks.
- The voice claim stays the speaker's (`voiceClaim.ts`): the participant never speaks in a clone.

### Ears

- `routes.ts`'s `Edge` gains `pan?: -1 | 1`; `graph.ts` puts a `StereoPannerNode` on such an edge. The
  real bus is already stereo.
- Face-to-face routes: speaker → real, panned to the other person's ear (right by default);
  participant → real, panned to mine (left by default); `faceToFaceSwap` mirrors both. Speaker →
  virtual is off.
- With the adapter's "own target only" rule, routing by leg is routing by language.

### UI (boards 1, 2, 4)

- The Both popover (`ModeDevicePopover.tsx`): the "Other's audio" row becomes "Other side: In a
  meeting / Beside me"; under "Beside me", the output row reads "Headphones" and an ears block shows
  each ear's language and listener (colour follows the person), a preview per ear (the test tone
  panned), "Swap left and right", and a hint that speakers feed the translation back into the
  microphone.
- The mode picker shows a small "Face-to-face" tag on Both.
- No person labels in face-to-face: each side is one person, so `labelled()` is false for both legs
  whatever the labels say (a phantom label must not show "Speaker 2").
- The conversation: each spoken translation row carries an ear tag (L/R, the listener's colour); a
  translation not spoken under the "own target" rule carries a small icon-only tag whose tooltip
  says why (D14); the status bar holds an ears legend.
- All new words in the 30 catalogs.

### Managed participant speech (sokuji-backend, then the client)

The roadmap's "Managed participant speech — turning it on", carried out:

1. **sokuji-backend**: `expandStreamRoles` accepts the request's `participantSpeech` and adds
   `par_tts` when the participant speaks — participant-only, split Both and shared Both (face-to-face
   included); `computeSessionBudget` gets its start floor and TTS concurrency; the admin sessions view
   lists the role; the docs site's cost calculator and scenarios gain participant speech and a
   face-to-face scenario, and drop the shared-by-default wording (slice 1). Its PR deploys production
   on merge: opened and merged only on the owner's word.
2. The client confirms the request field (`PARTICIPANT_SPEECH_FIELD`, `'participantSpeech'`).
3. `KIZUNA_PARTICIPANT_SPEECH = true` (`src/providers/soniox/kizuna.ts`).
4. `kizunaBudget.test.ts`'s floor parity moves to the backend's floors for `par_tts`.
5. The live items: participant speech under managed Soniox in split Both, shared Both and
   participant-only; face-to-face both ways; the floors in Start and the account dot.

### Tests

The silent source; the face-to-face shape (forced shared, forced participant speech, no meeting
route); attribution by language votes with no energy; the "own target only" rule in every mode; the
pan on edges and the swap; the participant voice default and its swap away from mine; the popover,
the ear and "not played" tags, the wizard's scenarios and `providerFits`; the managed lease asking for
`par_tts`.

## Risks

- **Speakers instead of earphones** feed each translation back into the microphone. The popover says
  so; the existing echo watch may also catch it. No automatic block.
- **Labels in large meetings** merge people (D5 accepts it); the label is a number, never a name.
- **Quick turns** merge two people into one utterance with one label (about 1 in 12 in the spike's
  tight case); #580's client-side cuts are the fix.
- **Hints** showed no effect on clean audio; their benefit in real multilingual meetings is unproven.
- **Default split** doubles managed Both's per-minute cost and raises its start floor for everyone who
  never chose shared.

## Delivery

Slice 1, slice 2, slice 3 in order, each its own PR on kizuna-ai-lab/sokuji; slice 3's backend PR on
kizuna-ai-lab/sokuji-backend before its client half. The implementation plan follows this spec.
