# Karaoke from the first sound: provisional ranges

Date: 2026-10-25. Status: design, approved direction (owner, 2026-10-25).

## Why

Three providers learn which characters a chunk of speech speaks only once a
sentence's speech is complete: Soniox (own key, and Kizuna AI, which wraps it),
Palabra, and Qwen LiveTranslate (own key, and Kizuna AI's managed Qwen, which
wraps it). Their audio plays as it arrives, rangeless, and their karaoke lights
only when the fill-in (`speechRanges`, contract spec "A range known only later
is filled in") lands. By then playback is often half way through the sentence,
so the highlight appears late and jumps.

Measured on real recordings (see "Evidence"):

- Soniox: for 46% of the time a translation is audibly playing, nothing is lit;
  the highlight first appears a median 1.4 s after the voice starts; its
  largest single step covers a median 55% of the sentence. Soniox TTS streams its audio at
  about playback speed, so a segment's last chunk, and with it the fill-in,
  arrives around the time the segment finishes playing.
- Qwen LiveTranslate: 66% unlit; in 8 of 20 sentences the karaoke never lights
  at all, and a ninth lights only in its last 2%. Qwen sends a phrase's audio in a burst, but `response.audio.done` and
  `response.audio_transcript.done` arrive after playback has ended, so the last
  phrase's fill-in always lands too late ("Ranges that land after the queue has
  played the clip out light nothing live").
- Palabra has the same shape (tiled at `last_chunk`); it was not measured.

**Owner's ruling (2026-10-25):** progress from the first sound matters more than
exact progress. After seeing the test below, the owner
approved this direction.

## The idea

Give each chunk a provisional range the moment it arrives: the phrase's text
divided by an estimated speech rate (learned from this session's own fill-ins,
a per-script prior before the first). The existing fill-in then replaces the
provisional ranges with exact ones, as it already would. Karaoke never steps
back within a sentence, so a correction that lands behind what is lit just
holds until the voice catches up.

## Evidence

Simulated over real recordings with the app's own code (`QwenSegments`, the
events the Soniox adapter emitted, `ClipQueue`, `nextLit`) on a simulated
clock, at the recorded arrival times; the voice's real position comes from
faster-whisper word timestamps aligned onto the subtitle text (99% of English
letters, over 95% of Chinese and Japanese characters matched). Data: Qwen's 9
probe runs of 2026-10-12/13 (20 sentences, into English) and 4 new Soniox
sessions on a Japan-region key (ja→en, ja→zh, zh→ja, zh+ja→en; 19 TTS
segments). Listening page with both methods side by side:
https://claude.ai/artifact/VTQuDbhpY6BjFUogWt8NB9. Scripts:
`scripts/dev/karaoke-probe/` (`soniox.mts` records, `simulate.mts` replays and
measures).

| Both providers, 39 segments, 123 s | Today | Provisional | Ceiling |
|---|---|---|---|
| Unlit while the voice plays | 57% | 1.6% | 1.5% |
| First sound to first light, median / p90 | 1.7 s / 4.1 s | 25 ms / 100 ms | 25 ms / 100 ms |
| Largest single step, share of sentence, median / max | 44% / 98% | 5% / 18% | 3% / 14% |
| Highlight vs voice, p50 / p90 | 86 / 356 ms | 85 / 291 ms | 71 / 245 ms |
| Lit time >150 ms ahead / behind the voice | 8% / 27% | 16% / 17% | 10% / 17% |

"Ceiling" is the exact ranges known from the first chunk: the best that
splitting text by sample count can do. The simulated estimate used a cap (no
provisional range past 85% of the phrase before the fill-in); removing it
changed nothing measurable (Soniox never reached it; Qwen p90 289 ms vs 291 ms),
so this design has no cap. A prior wrong by −40% / +60% raised the p90 to
418 / 377 ms in these short (1–9 sentence) sessions.

Measured speech rates, seconds per letter, digit or CJK character, Soniox's
default voice at speed 1.0: English 0.065–0.091 (mean 0.075), Japanese
0.14–0.18 (mean 0.16), Chinese 0.21–0.31 (mean 0.25). Qwen's rates were not
measured separately. The simulation used guessed priors (English 0.07,
Japanese 0.14, Chinese 0.22); this design sets them to the measured means.

## Goals

- On Soniox, Kizuna AI (Soniox), Palabra, Qwen LiveTranslate and Kizuna AI
  (Qwen), live karaoke lights from a sentence's first chunk.
- Corrections stay small and never run backward on screen.
- Once a fill-in has landed, every range is the exact one it is today, so
  replay after a sentence finishes is unchanged.
- Acceptance numbers (see "Verification") reproduce the "Provisional" column.

## Non-goals

- Doubao AST 2.0: one whole clip per sentence, ranged when its subtitle closes;
  a different shape, not measured.
- Providers that already range each chunk on arrival (OpenAI Realtime, OpenAI
  Translate, OpenAI Live, Gemini) and LocalInference: their ranges are
  untouched. They do get the never-step-back rule, which changes nothing for
  them because their ranges already ascend.
- Local Native (old `IClient` path until kizuna-ai-lab/sokuji#578).
- Remembering a learned speech rate across sessions.
- Word-level timing from provider timestamps.
- Changing how a fill-in tiles text (still `tileSpan`, by sample count).

## Anti-goals

- Holding audio back to wait for ranges: playback latency does not change.
- A highlight that visibly moves backward within a sentence.
- Any change to segment text, retention, or what L1 stores beyond ranges.

## Design

### 1. The estimate (shared)

A small module beside `tileSpan` in `src/lib/contract/ranges.ts` (providers
never import each other's folders; this is where the shared fill-in already
lives). One instance per spoken leg per session.

- **Unit:** samples per skeleton character, counted with `countSkeleton`
  (`src/lib/segmentation/sealCursor.ts`, letters and digits by `\p{L}\p{N}`).
- **Prior**, by the phrase's own text (no language parameter needed):
  - any kana in it: 0.16 s per character;
  - otherwise, Han characters at least half of its letters: 0.25 s;
  - otherwise, Hangul at least half: 0.17 s (a guess; not measured);
  - otherwise: 0.075 s.
  Divided by the provider's speaking-speed setting where one exists (Soniox
  `ttsSpeed`, 0.7–1.3).
- **Learning:** each fill-in reports its span's text and its chunks' samples.
  The rate becomes (measured samples + prior × 10) / (measured characters + 10),
  the prior here in samples per character (seconds × 24 000 ÷ speed) for the
  phrase being estimated. Before any fill-in, the prior alone. This is what
  was simulated.
- **A chunk's provisional range:** with the phrase spanning [a, b) of the
  segment text, `cum` the phrase's samples so far including this chunk, and
  `prevEnd` the previous provisional end (a for the first chunk):
  `[prevEnd, min(b, max(prevEnd, a + round((b − a) × cum / (skeleton(text[a, b)) × rate))))]`,
  with the end moved past a surrogate pair as `tileSpan` does. An empty phrase,
  or one with no letters, places nothing: the chunk stays rangeless, as today.
  No cap.

### 2. Each adapter

Each emits the provisional range on its `audio` event and keeps its existing
fill-in, which now also feeds the estimate's learning.

- **Soniox (`src/providers/soniox/speech.ts`, `ttsStream.ts`).** The phrase is
  a TTS segment (one stream). `ttsStream` already keeps the union of the spans
  sent to each stream (`segments` → `record.span`); it reports that span with
  each audio chunk (`SonioxTtsAudioInfo`). `LegSpeech.onAudio` computes the
  range from it and the chunk texts it already holds (`texts`). A segment's text
  can still grow after its audio starts (the clause-wait rule); the range uses
  the span sent so far. `onSegmentEnd` keeps its `tileSpan` fill-in and calls
  the learning. One estimate per `LegSpeech`, so each leg in Both mode, shared
  socket or not, learns its own voice.

  A segment that ends uncleanly (a 408 kill, a dropped socket, or Translation
  I hear switched off mid-sentence, #595, which drops the live segment and
  reports it unclean) is closed out the same way: its span is tiled over the
  chunks that did arrive, with the same `tileSpan`, and stated by
  `speechRanges`. It does not feed the learning: its audio was cut short. This
  ends the karaoke hold the way a normal fill-in does (owner's choice,
  2026-10-25; see "Unfinished sentences"). A session's own end (`close()`)
  states nothing: Stop clears the queue anyway.
- **Palabra (`src/providers/palabraai/items.ts`).** The phrase is a
  translation part: span [0, the part's text length when the chunk arrives].
  A chunk that arrives before any text stays rangeless. `fill` keeps its tiling
  and calls the learning. Chunks after `ranged` play with no range, as today.
- **Qwen LiveTranslate (`src/providers/qwen_livetranslate/segments.ts`).** The
  phrase is the current one: span [`phraseText`, the shown text's length as
  each chunk arrives]. Words after audio still begin the next phrase, so the
  span normally stays put once audio starts; audio before any words joins the
  first phrase, whose words then grow it and light it. Provisional ranges go
  into `it.ranges`, so `restate` (a final text shorter than the deltas) also
  covers them; a chunk after such a text starts no further than its end.
  Once the last phrase is filled, a stray chunk plays rangeless, as today.
  `fill` keeps its tiling and calls the learning.

### 3. Karaoke never steps back (`src/lib/view/karaoke.ts`)

In `nextLit`, on a live queue: when the sample would light fewer characters of
the same segment than are lit now, keep what is lit (clamped to the segment's
current text length) until playback catches up. Unchanged:

- a cleared queue (Stop) ends the hold, as today;
- a letters-changed rewrite that drops every range of the segment ends it, as
  today;
- another segment starts from its own position;
- replay keeps its own path (`litFor` per sample) and is not held.

Forward corrections (the estimate was slow) are drawn as they come; measured
largest step median 5%, max 18% of a sentence.

#### Unfinished sentences

The hold keeps a segment lit while its speech may continue: the segment is
open, or its ranges stop short of its last letter (`hold` in `karaoke.ts`).
Today a segment whose fill-in never lands has no ranges and never lights.
With provisional ranges it would light part way and then stay lit, as the
playing row, after the voice has stopped, until that queue plays another clip
or Stop clears it. The hold cannot tell this from the ordinary gap between two
TTS segments of one row, and karaoke decides from L1's data, never a timer.

Owner's choice (2026-10-25): the adapter closes such a sentence out where it
knows the speech ended. Soniox does, for every unclean segment end (section 2).
The rare cases with no end signal keep the frozen highlight until the next clip
or Stop: a Qwen turn that never gets `response.audio.done`, a Palabra part
that never gets `last_chunk`. A new L0 "speech ended" signal was considered and
not chosen.

### 4. Contract and spec

- No type change in L0. A provisional range is an ordinary `audio.range`; a
  later `speechRanges` replaces it. L1 already takes the last range named for
  an entry (`Conversation.ranges`, "An entry named twice takes the last range"),
  and the conformance suite already checks only the latest range per entry.
  Provisional ranges satisfy its rules as they stand: within the text the
  adapter last sent, ascending without overlap.
- A Soniox segment that ended uncleanly is tiled over the chunks that arrived,
  so its replay sweeps the segment's text across its truncated audio, where
  today it shows no karaoke.
- Amend `docs/superpowers/specs/2026-09-22-client-contract-design.md`:
  - D4 and "Risks → Karaoke's honesty": a fourth stated exception, estimated
    ranges replaced by the fill-in, by the owner's ruling of 2026-10-25;
  - "A range known only later is filled in": audio no longer plays rangeless
    before the fill-in; describe the provisional range and the step-back hold;
  - "Provider capability": the Soniox, Palabra and Qwen LiveTranslate rows.

### 5. Verification

- Unit tests for the estimate: prior selection by script, speed scaling, the
  learning blend, the range formula, an empty or letterless phrase, surrogate
  pairs.
- Adapter tests: Soniox `speech`, Palabra `items`, Qwen `segments` and
  `segments.replay`: audio now carries ascending provisional ranges; the
  fill-in replaces them; an unclean Soniox segment end (kill, socket drop,
  speech switched off) tiles the span over the chunks that arrived and does not
  feed the learning; conformance passes.
- `karaoke.ts` tests: no step back within a segment; Stop, a range-dropping
  rewrite and a new segment behave as today; replay is not held; a Soniox
  sentence ended uncleanly un-highlights once its last clip has played.
- Acceptance, before merge, per provider: `simulate.mts` on the Qwen fixtures
  (raw wire frames, fed through the new `QwenSegments`), and one fresh
  `soniox.mts` run of the four sessions (about 3 minutes, about US$0.03, on a
  key the owner provides). The as-recorded column (now the new code) is held
  against the same run's ceiling, since a new Soniox run is new speech: unlit
  share within 1 point of the ceiling's, largest-step median ≤ 10%,
  highlight-vs-voice p90 within 100 ms of the ceiling's. On a miss the priors
  and the prior weight may be tuned on the Qwen fixtures (free); any further
  live Soniox run needs the owner's go-ahead first; if it still misses, stop
  and report the numbers.
- Live test in the app: Soniox (own key) and Kizuna AI, one session each; the
  highlight starts with the voice and never runs backward; switching
  Translation I hear off mid-sentence leaves no row lit.

## Decided by the builder (calls made in this document, flagged for review)

1. No cap on provisional ranges (the data showed no benefit).
2. Priors set from the measured Soniox rates; Hangul unmeasured.
3. The never-step-back hold applies to every provider's live karaoke.
4. No L0 flag marks a range as provisional.
5. Learning per leg per session, never persisted; an unclean segment end does
   not feed it.
6. The acceptance gate is per provider and relative to the same run's
   ceiling, with the miss policy above.
7. Everything the acceptance run needs lands in the repo before any code
   change, under `scripts/dev/karaoke-probe/`: the probe and simulation
   scripts, the faster-whisper word-timestamp script (`words.py`, medium,
   int8, CPU, decoding the wav itself) and the run manifest with repo-relative
   paths, and as fixtures the 9 Qwen probe logs (server frames only), the 4
   Soniox logs of 2026-10-25 (the old behaviour, for the record) and the word
   timestamps of all 13 runs; no audio. The acceptance's Soniox logs come from
   a fresh run. Rebuilt from these fixtures alone, `simulate.mts` reproduces
   the "Evidence" numbers exactly.

## Left to the builder

- Names, and where the estimate object sits inside each adapter.
- Script detection details within the rules above.
- Whether the development-only fake provider (`src/providers/fake`) gets a
  Soniox-shaped script with provisional ranges.
- How the Soniox probe's log and the fixtures are trimmed.
