# Sentence segmentation — slice 5 phase 1 carry-forward (2026-09-20)

Phase 1 of Amendment A2: the on/off switch becomes a mode. Plan:
`docs/superpowers/plans/2026-09-20-sentence-segmentation-5-modes.md`.

| commit | what |
|---|---|
| `ca35ead1` | one stored mode and size, two resolvers, the settings behind them |
| `365fbc52` | each descriptor declares what it offers, pinned by the registry test |
| `e83b44a5` | the section becomes a mode; the pause sliders move into it |
| `45e9b256` | cancelling the download returns the mode it came from |
| `fef830d0` | the four pause clients read one global pair |
| `eda823cd` | only By sentences runs the stage |

## What a user sees

One control, three choices, each provider showing only what it can do. Off
keeps whatever that provider already produces. By pause is offered by GPT-Live,
OpenAI Translate and Gemini, and carries the two sliders — now one global pair
at 1.5 s rather than three per-provider pairs. By sentences downloads the three
models on first use and offers a size: Auto where a server or a VAD already
decides the boundary, 1–5 where a bubble every N sentences is implementable.

The stored mode defaults to `pause`, which resolves to By pause on those three
and to Off everywhere else — one default, both behaviours, which is what let
the mode be a single global value rather than one per provider.

## Rendered, looked at, and fine

Every catalog, three provider families, three modes, at the 300 px panel
minimum, from the compiled stylesheet. No overflow anywhere except one that is
not ours:

- **The pause sliders overflow their row by 4 px in every locale.** A control
  measurement of the app's own pre-existing `.slider` pattern, through the same
  probe, reports exactly the same 304 > 300: Chromium gives `input[type=range]`
  a default 2 px margin either side and `width: 100%` does not account for it.
  Every slider in Settings has always done this, and the panel's own padding
  absorbs it. Fixing it only here would leave these two sliders 4 px narrower
  than every other slider in the app, so they keep the family behaviour.
- German is the longest set of mode labels and they fit on one line at 300 px;
  the effect line under the size wraps to two, cleanly.

## The one real behaviour change, and what it costs

Off and By pause both leave the clients' silence timers running (see below), so
the mode itself changes nothing on the four pause providers. **The pause values
do.** Three of the four no longer behave as `main`, because one global 1.5/1.5
pair replaced three per-provider defaults:

| provider | source / translation on `main` | now |
|---|---|---|
| OpenAI Translate (and the Kizuna twin) | 1.0 s / **0.5 s** | 1.5 s / 1.5 s |
| OpenAI Live | 1.0 s / 1.5 s | 1.5 s / 1.5 s |
| Gemini | 2.0 s / 2.0 s | 1.5 s / 1.5 s |

The translation side of OpenAI Translate is the largest move: three times
slower to close an assistant item than it was. OpenAI Live carries a second,
derived change — its short-item merge rule is `2 × sourcePause`
(`OpenAILiveClient`, `gap >= 2 * this.userSilenceTimeoutMs`), so the gap that
starts a fresh source item instead of merging into the previous one goes from
2 s to 3 s. Gemini is the only one that gets faster.

The owner chose the single 1.5/1.5 pair with those three defaults in view. What
was **not** decided is the next point.

### No migration — a known loss, not a fixed bug

`settings.openaiTranslate.userSilenceDuration` / `.assistantSilenceDuration`
and the matching OpenAI Live pair are shipped settings on `main`, each with a
live slider a user could and did move. Nothing in this slice copies a tuned
value into the new global pair: the old keys are simply no longer read. So
**every user who ever moved either slider silently reverts to 1.5 s** on their
next launch, with no notice and nothing in the UI that says a value was
dropped.

Recorded here rather than fixed. A migration is writable — read the two old
keys on load, and if either differs from its old default, seed the global pair
from it — but it has to choose which provider's pair wins for a user who tuned
both, and that is the owner's call, not this slice's.

## The two deviations from A2 that phase 1 ships deliberately

Both are in the plan's capability table, and both are phase 2's job:

1. **The local engines offer no Auto.** A2 says a VAD utterance counts as a
   boundary someone else decided, so Local Inference and Local Native should be
   able to punctuate without splitting. They cannot yet: today they always build
   a `SentenceStream`, and Auto means not building one and punctuating the final
   text instead.
2. **Five server-definite providers offer no sizes.** Soniox, both Volcengines,
   Palabra and Zoom can be split — none of them attaches audio to an item — but
   `punctuateDefinite` has never split anything, so 1–5 there is phase 2.

A consequence worth knowing: with sizes absent, Auto is the only size those
providers have, and a one-option control is hidden — so the word "Auto" never
appears on them in phase 1. Phase 2 makes it visible for the five. On OpenAI
Realtime GA it stays hidden forever, which is honest: it attaches audio to its
items, so it will never offer a size, and there is no choice to show.

## Decisions taken inside the slice

- **The clients take the pause pair through `ClientOptions`**, not through each
  provider's `buildSessionConfig`. A descriptor cannot read the settings store —
  the store imports every descriptor, so the reverse edge is a cycle — and a
  global value routed through session configs would need two shells that can
  drift. `ClientOptions` is the one funnel every creation path already goes
  through. The Kizuna Translate twin overrides `createClient` and needed the hop
  too; without it the managed path would have lost the setting silently.
- **The WebRTC transport's single pair timer takes the translation pause.** One
  timer closes both items, but the last delta of a pair is always the
  translation's, so translation-side silence is what it measures. Leaving it
  fixed would make WebRTC the one place the slider does nothing while the same
  provider over WebSocket honours it. The claim that the translation delta lands
  last is behavioural and nothing enforces it.
- **Auto reaching a client resolves to 3, not 0.** The plan asserted Auto could
  not reach a client in phase 1; that was wrong — every default-offer provider
  resolves to it. A 0 would zero `punctuateDefinite`'s length gate and make
  every short segment wait out the fill-in budget. The loud throw is kept for a
  size of 0 on a provider that also offers sizes, which is phase 2's shape and
  unreachable from today's registry.
- **Mid-session changes to the pause pair are gone.** The session-config fields
  were the only path and nothing called `updateSession`; re-adding it would be
  deliberate work.
- **D5's "no timer competes" is about the caps, not the silence timers.** A2's
  D5 reads as though By sentences runs with nothing else cutting the bubble,
  and that is not what ships: the clients' silence timers still run in every
  mode. They have to. They are the only thing that closes an item when speech
  stops, and without them a speaker who goes quiet leaves a bubble open for
  ever. What actually competed with the seal were the *caps* — the clause cap
  and the span cap — and slice 4 removed those. So D5 is satisfied as written
  once "timer" is read as "cap"; the wording is what is wrong, not the code.
  The consequence to keep in mind: **Off and By pause are behaviourally
  identical** on the three providers that offer both. The only difference the
  user can observe is whether the two sliders are reachable. Stated in tests
  rather than left to be inferred — `clientOptions.test.ts`
  ("carries the pause pair with no segmentation runtime"),
  `descriptorRegistry.test.ts` ("hands the pair to a client built in Off") and
  `OpenAITranslateGAClient.test.ts` ("still closes items on silence with the
  segmentation stage off").
- **By pause does nothing on Gemini's dialogue models.** `GeminiClient` arms
  its two segment timers only when `continuousSegmentation` is true, and that
  is set from `isTranslateSession` — so on a Gemini Live *dialogue* model the
  mode reads as By pause, offers both sliders, and neither one moves anything.
  Not fixed: the capability is declared per provider and this is per model,
  so honestly hiding it would mean a per-model offer, which is a shape change
  no other provider needs yet.

## What phase 2 owes

- Auto on the local engines: punctuate an utterance, do not split it.
- Splitting a definite segment every N sentences on the five providers that can
  take it, with the same care slice 4 needed — the write-ordering lane, the
  teardown flush, and the translation pairing.
- The loud throw in `MainPanel`'s size resolution, which phase 2's first
  provider offering both Auto and sizes will hit.
