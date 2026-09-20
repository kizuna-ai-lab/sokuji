# Sentence segmentation — slice 5 phase 2 carry-forward (2026-09-20)

Phase 2 of Amendment A2: Auto becomes a value a client acts on, and a server's
definite segment can be cut inside. Plan:
`docs/superpowers/plans/2026-09-20-sentence-segmentation-5b-auto-and-splitting.md`.
Phase 1's note is beside this one and still holds.

| commit | what |
|---|---|
| `5de1a1c7` | a silence timer no longer cuts a sentence in half |
| `72e96261` | the size control always shows, and Delete lives with the models |
| `3727b1df` | Auto is a value a client receives, not one the resolver hides |
| `65cd184e` | Auto keeps the length gate it would otherwise switch off |
| `3d8fb0e4` | a definite segment can be split |
| `5fcf28de` | Auto on the local engines |

The first two came out of the owner's live test of phase 1 and are listed here
because phase 1's note was written before them.

## The capability table, closed

| provider | offers |
|---|---|
| OpenAI Live, OpenAI Translate (+ Kizuna twin), Gemini | pause, 1-5 |
| Soniox (+ twin), Volcengine ST, Volcengine AST2 (+ twin), Palabra, Zoom | **Auto, 1-5** |
| OpenAI Realtime GA, OpenAI-Compatible | Auto only |
| Local Inference, Local Native | **Auto**, 1-5 |

Three `true`s, exactly as the plan's table asked. Every provider whose
boundaries someone else decides now offers Auto, including the two local
engines, where the boundary is the VAD utterance. Every provider that can be
split offers 1-5.

**OpenAI Realtime GA stays Auto alone, and always will.** Its audio arrives as
deltas keyed to the server's own item id, and `formatted.audio` accumulates per
item; cutting the text into N bubbles would leave the audio on one of them with
no per-sentence timing to cut it on. A one-option control is hidden, so the word
"Auto" never appears there — honest, since there is no choice to show.

## The two shapes, and why they are exclusive

A size of 0 and a size of 1-5 are not two settings of one mechanism. They are
two mechanisms, and a session picks one at connect:

- **1-5 is the stream shape.** A `SentenceStream` counts sentence ends and seals
  every Nth. This is what slices 2-4 built.
- **0 is the fill-in shape.** No `SentenceStream` is ever constructed. The
  utterance's final text goes through `punctuateDefinite` — the same helper the
  server-definite clients use — and the streaming partials stay raw.

The local clients say which in a `sessionShape: 'off' | 'stream' | 'fill-in'`
field beside the frozen `sessionSegmentation`. `ensureStream()` refuses *before*
constructing anything under fill-in: slice 4 lost a session's transcripts to a
stream that existed but never sealed, and `SentenceStream`'s "no runtime means
no sealing at all" would do it again.

The invariant that matters on `LocalInferenceClient`: **exactly one layer seals.**
Its ASR worker has its own punctuation endpoint, and the expression is
`punctuationEndpoint: this.sessionShape !== 'stream'` — on under Off (nothing
above it exists), off under the stream shape (the stream seals), on under Auto
(nothing above it seals, and the boundary Auto promises to keep is the one the
worker and the VAD decide between them). Anyone changing that line should check
all three shapes, not just the one they came for.

## Splitting: what it does and does not touch

`punctuateAndSplitDefinite` fills the punctuation in and then cuts after every
Nth offset from `sentenceEnds` — the one rule the whole stage counts with, so an
abbreviation is not a cut. A size of 0, or a segment with fewer sentence ends
than N, returns exactly one piece, byte-identical to what `punctuateDefinite`
returns. `splitDefinite` is the synchronous half, used by `SegmentLane.flush()`
so a Stop inside the fill-in wait still honours the size where the text allows.

The pieces rejoin to the segment in order: no merge, no reorder, and the outer
edges stay exactly where the server put them. A2's rule holds.

All of a segment's pieces are written inside ONE queued lane work item, so the
lane still orders segments against each other and the next segment cannot land
between two pieces. `disconnect()`'s flush writes every piece, not the first.

### Translation pairing

No client pairs a source item with its translation item. `ConversationItem` has
no such field and nothing downstream reads one, so a source that splits into
three beside a translation that splits into two breaks no link. The local
engines' Auto emits exactly one piece, so they stay 1 bubble : 1 translation job
exactly as the stage-off path always was.

### Ordering

`createdAt + i` off a base stamp captured before the await. MainPanel sorts by
`createdAt`; equal keys keep insertion order only while nothing else lands
between them, and the next utterance's item may already be listed by the time a
deferred write runs. **Palabra has no `createdAt` at all** and lists items
synchronously, so its later pieces are spliced in behind the first rather than
pushed. This is a convention, not a guarantee — worth knowing before a sixth
client joins the splittable set.

## Decisions taken inside the slice

- **Replay audio stays on the FIRST piece.** Three of the five splittable
  clients attach it — Soniox's `formatted.audio`, AST2's `decodeTTSAndPlay`
  target, and *not* Palabra, whose PCM rides a synthetic envelope keyed to the
  client instance and never touches an item. Volcengine ST and Zoom write text
  only. Where there is audio it is the whole segment's, with no per-sentence
  timing to cut it on, so it stays on the piece a user reaches for and the later
  pieces have none. `keepReplayAudio` is off by default, so in the default
  configuration this is unobservable. **Ruled by the owner on 2026-09-20: leave
  it.** Replay audio is already partly unusable and gets its own refactor later.
  Recorded in full under "The audio/bubble problem" below, because the design
  discussion happened and should not be re-derived.
- **`translation_count` and `translation_completed` fire per piece.** MainPanel
  increments on every completed assistant update, so a split translation reports
  more than one. **Ruled: accepted, not fixed.** The metric is already a function
  of each provider's own segmentation granularity, and is already recorded as
  unreliable for Soniox; splitting is opt-in and `sentence_segmentation_active`
  on the session-start event lets an analyst separate it.
- **Live playback is unaffected by splitting.** Audio goes to the shared
  `ai-assistant` track and the item id is ordering metadata, not a routing key.
  Nothing a user hears changes.
- **Karaoke is unaffected.** None of the five splittable clients carries
  `asrTiming` — that is a local-engine field, and the local engines emit one
  piece under Auto.

## The audio/bubble problem, stated once so it is not re-derived

Splitting exposed that `ConversationItem` is three things at once: a display
bubble, a unit of provider text, and an audio container. They used to coincide.
Three distinct relationships exist in the codebase today:

| | who decides the audio's granularity | where it attaches |
|---|---|---|
| OpenAI Realtime/Translate/Live, Gemini | the server, per its own item | the server's item id |
| Soniox, Volcengine AST2, local TTS | us (Soniox feeds `SonioxTtsStream` one clause-sized burst of final tokens at a time) | accumulated onto one item |
| Palabra | a continuous track | nowhere — no item |

The systematic fix, **not** attempted here: give `ConversationItem` an
`utteranceId` defaulting to its own id, and make audio, replay, timing and
latency analytics key on the utterance while text keys on the bubble. That would
also make OpenAI Realtime GA splittable, since the only reason it is excluded is
per-item audio. Beyond that, where we control both the text cut and the TTS
chunk (Soniox, AST2, local), the segmentation stage's seal could *become* the
TTS feed unit, making bubble and audio the same unit by construction instead of
two independent chunkers that usually agree.

Deferred by the owner to a separate refactor. Nothing in this slice depends on
it.

## Rendered, looked at, and fine

Every catalog (30), four provider families, every mode, at 300 px and 450 px,
from the compiled stylesheet, with the probe in
`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/render/`:

- **No overflow anywhere** except the pause sliders' 4 px, which a control
  measurement of the app's own pre-existing `.slider` reports identically
  (Chromium's default `input[type=range]` margin). Phase 1 ruled on it; it is
  not ours.
- The new widest row is **Auto plus 1-5, six options**, and it fits on one line
  at 300 px in German and Japanese as well as English.
- Selecting Auto swaps the effect line to
  `sentenceSegmentationChunkAutoEffect` ("Bubbles are cut where they are today;
  only the missing punctuation is added."), present in all 30 catalogs. German
  is the longest and wraps to three lines cleanly at 300 px.

## What is still open

- **Real-environment validation** (slice 4's Task 7) has never run: the whole
  stage has been exercised against recordings and unit tests plus the owner's
  own live GPT-Live and Gemini sessions, but not across the fleet.
- **Under Auto on an offline local ASR model** there are no partials, so nothing
  is on screen until the utterance completes — and then the bubble can appear up
  to the 1 s fill-in budget later. The same trade the five server-definite
  clients already make, but more visible there because nothing preceded it.
- **A sixth splittable client** would inherit the `createdAt + i` convention and
  Palabra's splice exception. Read the Ordering section above first.
- **The audio/bubble refactor** above, whenever it is scheduled.
