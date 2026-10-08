# Voxtral Mini 4B Realtime — why Sokuji appends "ished", and what fixes it

Research note, 2026-10-08, on `main` at `a7758923` (v0.43.2 + #604/#608/#609). Probe scripts:
`scripts/dev/voxtral-realtime-probe/` (CPU, onnxruntime-node, the same `@huggingface/transformers`
4.2.0 code the worker runs). Primary-source notes behind §2 were collected the same day from the
model card, the paper (arXiv 2602.11298v3), `mistral-common`, vLLM, transformers and transformers.js;
URLs are given inline.

---

## 1. The symptom

Users of the local `Voxtral Mini 4B Realtime (WebGPU)` ASR see the string `ished` in their
transcripts: glued to the end of a sentence (`"today,ished"`), or as the whole text of a short
segment. One report from the feedback form on 2026-10-08 (Mac, v0.43.2, en→zh: "总是会出现 ished");
@flug's #522 ("transcript truncated to `ished`", the trigger behind #528); and our own GB10 harness
runs for #536, whose logs hold `"And so, my fellow Americans,ished"` and
`"And so, my fellow Americans,ous"` for the first VAD segment of ggml's `jfk.wav`.

Three facts narrowed the search before any experiment:

- `ished` is ONE token of the Tekken vocabulary — id 3473, a word-piece suffix with no leading
  space. So is `ous` (1718). Each appearance is a single greedy argmax at a single 80 ms step, not a
  cut word that was transcribed faithfully. (Mid-word VAD cuts do exist, but they produce varied
  fragments, not the same string every time.)
- It is glued to the previous text without a space, which is what a suffix token decodes to.
- It is always at the END of a segment's text, and the Silero context fix (#601) and the pre-speech
  padding (#603), both already in the reporter's build, did not change it.

## 2. How the model works (the parts that matter)

Sources: model card <https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602>; paper
<https://arxiv.org/abs/2602.11298>; `mistral_common/tokens/tokenizers/audio.py`; transformers
`models/voxtral_realtime/`; transformers.js `models/voxtral_realtime/` (the ONNX path we ship).

- **Stream-synchronous decoder.** A causal audio encoder turns every 80 ms (1280 samples, 8 mel
  frames) into one audio embedding. The 3.4 B text decoder (Ministral 3B) runs ONE step per audio
  token; its input at step *t* is `audio_embed[t] + text_embed(token sampled at t−1)`, and it emits
  exactly one token: a text piece, `[STREAMING_PAD]` (id 32, the paper's `[P]`) when nothing is due,
  or `</s>`. The model also emits `[STREAMING_WORD]` (33) before each word; our accumulator drops
  it as a special id.
- **Delayed emission.** Text for a word is emitted only after the word has acoustically ended AND
  the configured delay has elapsed (480 ms = 6 tokens on this export; the delay is baked into the
  ONNX decoder through the Ada-RMSNorm time embedding and the 6 extra `[STREAMING_PAD]`s of the
  prefix). In the probe, `" Americans"` ends at 3.08 s of fed audio and is emitted at the step that
  has seen 3.52 s — 440 ms later, as designed.
- **Prefill.** Every session starts with `[BOS] + 38×[STREAMING_PAD]` on the text side, matched by
  32 tokens (2.56 s) of digital zeros plus 562.5 ms (9000 samples) of real audio = 39 audio tokens.
  Digital zeros are the designed silence (the paper: "We pad the audio stream with zeros").
- **End of stream, reference behaviour.** `mistral-common` appends 17 tokens (1.36 s) of zeros:
  6 (delay) + 1 (BOS) + 10 ("we must always add a buffer of max word length to the audio in the
  end"). vLLM does this automatically; transformers' Python example pads by hand. transformers.js
  never pads. Nobody feeds an end marker: a session ends when the audio runs out.
- **Python transformers never decodes without audio.** After each step it pulls the next chunk
  from the generator; on `StopIteration` it sets `_stream_exhausted` and `_has_unfinished_sequences`
  returns False, so the loop ends before another forward
  (`modeling_voxtral_realtime.py`, `_update_model_kwargs_for_generation` / `_has_unfinished_sequences`).

## 3. What Sokuji feeds

`src/lib/local-inference/workers/voxtral-webgpu.worker.ts` with `_shared/streaming-generation.ts`:

1. Silero VAD (0.3/0.15, 1.4 s redemption, 0.4 s min speech, 0.8 s pre-speech pad) segments the
   16 kHz stream. `SpeechStart` starts one `generate()` run per utterance, from a fresh prefill;
   the first chunk is the 0.8 s pre-roll, later chunks follow the live audio.
2. `SpeechEnd` (or a PTT flush, or the 35 s cap) calls `requestFinish(7 tokens × 1280 samples of
   zeros)`: the feed is padded with 0.56 s of silence (`TAIL_PAD_TOKENS = 7`, "delay + 1") and the
   chunk generator ends once that padding has been consumed.
3. The streamer receives every sampled token; `StreamingTextAccumulator` skips special ids and
   appends the rest; `end()` publishes the text as the segment's result.

## 4. The defect: one decoder step with no audio

In transformers.js (`modeling_voxtral_realtime.js`, identical on upstream `main` as of 2026-10-08):

- `forward()` first calls `fillAudioBuffer(audio_consumed + current_len)`, which pulls chunks from
  our generator **until the iterator reports `done`**; that step sets `stream_exhausted`.
- It then calls `addAudioEmbeddings()`, which **returns without adding anything when the queue is
  empty** (`if (s.audio_embed_queue.length === 0) return;`), and runs the decoder on the text
  embedding alone.
- `generate()`'s loop is forward → sample → `streamer.put(token)` → evaluate stopping criteria.
  `AudioExhaustedCriteria` only fires after that step, so **the token sampled from the audio-less
  step is kept and streamed.**

So every Sokuji utterance ends with one decoder step whose input is the text embedding of the
previous token with no audio vector — an input the model never saw in training (every training
position has audio + text summed). With nothing to listen to, the step behaves like a text-only
language model continuing its last token: after a word it wants punctuation (`,` at −0.27 nats in
the sweep's 2.40 s cut, where `" Americans"` had just come out); after a `[STREAMING_PAD]`, which
is the usual case once the tail silence has been consumed, it is a near-tie between
`[STREAMING_PAD]`, punctuation, and a handful of frequent English word-piece suffixes. Whichever
wins by a few tenths of a nat is appended, glued to the last real text because suffix tokens carry
no leading space.

How it shows up depends on the accumulator's punctuation endpoint (on for Local Inference while
sentence segmentation is held off): when the utterance's last sentence ended in `.`/`?`/`!`, that
sentence was already published as a result, so the junk token becomes a result of its own — a
one-word segment `ished` (#522, and the "it always appears" of an en→zh user whose every English
sentence ends in a period). Otherwise it is glued to the last words (`…Americans,ished`). A segment
that produced no real text at all gives the same one-word result.

Python transformers cannot produce this step (§2). vLLM feeds zero audio embeddings after the
stream ends (PR #54516: the model "may continue generating blank tokens until EOS"), but only after
its 17-token tail, and its own issue tracker records the same lottery from the other side: a
"blank-token rut" in which `[STREAMING_PAD]` keeps winning over real speech (vLLM #47614).

## 5. Evidence

CPU replay of the worker's loop (q4 export, greedy, deterministic) on ggml's `jfk.wav`
("And so, my fellow Americans, [0.7 s pause] ask not what your country…"), with a 0.5 s zero
pre-roll standing in for the 0.8 s pre-speech pad. "audio-less step" is the last forward, the one
with no audio embedding; its top-5 are log-probs.

| case | audio fed | text as shipped | audio-less step top-5 (nats) | with the fix (§6 R1) |
|---|---|---|---|---|
| A pause cut | speech to 3.08 s (0.5 s into the pause) + 7 tok zeros | `…Americans,` | `[PAD]` −1.14 · `ous` −2.17 · `,` −2.41 · `ished` −2.68 · `.` −3.65 | `…Americans,` |
| B onset cut | speech to 3.36 s (80 ms of "ask" included) + 7 tok zeros | `…Americans,ished` | **`ished` −1.52** · `[PAD]` −2.36 · `ous` −2.57 · `ized` −2.85 · `,` −3.31 | `…Americans,` |
| C word-end cut | speech to 2.60 s + 7 tok zeros | `…Americans,` | `[PAD]` −1.68 · `ous` −1.78 · `,` −2.31 · `ished` −2.91 · `ists` −3.22 | `…Americans,` |
| D full clip | all 11 s + 7 tok zeros | `…for your country.ch` | **`ch` −1.73** · `.` −1.80 · `ous` −1.95 · `[PAD]` −2.16 · `ished` −2.82 | full sentence, clean |
| E onset cut, 17-tok tail | as B, reference 17 tok zeros | `…Americans,` | `[PAD]` −0.00 · `</s>` −7.95 | — |
| F onset cut, no tail | as B, no padding at all | `…Americans,ished` | **`ished` −1.90** · `[PAD]` −1.91 · `ous` −2.23 · `,` −2.50 | — |
| H zeros only | 3.0 s of zeros, no speech | `` | `[PAD]` −0.73 · `.` −1.36 · `ho` −3.13 · `ch` −3.26 | `` |
| I onset cut, noise tail | as B, tail = white noise at 0.002 | `…Americans,ished` | **`ished` −0.97** · `ous` −2.68 · `ized` −2.90 · `[PAD]` −3.46 | — |
| J mid-word cut | speech to 2.30 s (inside "Americans") + 7 tok zeros | `…my fellowites` | **`ites` −1.50** · `.` −1.98 · `ous` −2.13 · `ists` −2.99 | `…my fellow` |
| K pause cut + 1.4 s silence | as A, then 1.4 s zeros, then 7 tok zeros | `…Americans,` | `[PAD]` −1.11 · `,` −2.31 · `.` −2.51 · `ous` −2.69 | — |

For contrast, an ordinary silence step inside the same runs looks like `[PAD]` −0.01 · `</s>` −4.5
· next −9 or worse: the audio-less step is recognisable by its collapsed distribution alone.

What the table says:

- The tail's CONTENT is irrelevant (B, F, I: zeros, nothing, noise — same junk). Only the audio-less
  step matters, and it exists in every run.
- Whether junk wins is a near-tie decided by the decoder state. Recent speech (an onset, a word
  end, a sentence end) tips it to a suffix (B, D, F, I, J); a second or more of silence before the
  end tips it to `[PAD]` (A, C, K, E) — but only by 0.3–1.2 nats, and §5.1 shows the longer
  tail does not make it reliable. That is why the artefact is intermittent for us and frequent for
  a speaker whose segments end soon after speech, and why #536's harness saw it only on the first
  jfk segment.
- The junk vocabulary is small and English-looking regardless of language: `ished`, `ous`, `ized`,
  `ists`, `ites`, `ch`, `.`, `,`. The exact winner moves with the state (and will move with the
  quantisation: the reporter's Mac runs q4f16, the probe q4).
- Stopping before the audio-less step (R1) removes the junk in every one of these English cases
  without losing a word (D's full sentence survives; J loses only the word the VAD had cut in
  half, which the model never completed). §5.1 shows where R1 alone is not enough.

### 5.1 Cut-point sweep

`sweep.mjs` moves the VAD cut point along a clip, feeds `pre-roll + speech[0:cut] + tail` and
reports the audio-less step, shipped behaviour ("raw") and R1 ("fixed").

**jfk.wav, 7-token tail (today's `TAIL_PAD_TOKENS`), 16 cuts from 2.40 s to 3.60 s in 80 ms steps**
("Americans," ends ≈ 2.58 s, the pause runs to ≈ 3.28 s, "ask" starts there):

| cut (s) | audio-less step → | raw text ends | fixed text ends |
|---|---|---|---|
| 2.40 | `,` −0.27 (`.` −1.43) | `Americans,` | `Americans` (the comma was the guess) |
| 2.48 | `</s>` −0.00 | `Americans,` | `Americans,` |
| 2.56 · 2.64 · 2.72 | **`ous`** −1.7 / −1.4 / −1.5 (`[PAD]` −1.8 / −2.1 / −1.9) | `Americans,ous` | `Americans,` |
| 2.80 → 3.20 (6 cuts) | `[PAD]` −1.05 … −1.56; `ous`/`ished`/`,` 0.4–1.2 nats behind | `Americans,` | `Americans,` |
| 3.28 · 3.36 · 3.44 | **`ished`** −1.2 / −1.5 / −1.6 (`[PAD]` −1.8 / −2.4 / −2.3) | `Americans,ished` | `Americans,` |
| 3.52 · 3.60 | `[PAD]` −1.66 / −1.44 (`ished` −1.94 / `ous` −2.04 next) | `Americans,` | `Americans,` |

Six of sixteen cut points ship junk (`ous` ×3, `ished` ×3); every other cut is a `[PAD]` or `</s>`
that won by 0.3–1.2 nats over the same suffixes. Nothing in the 80 ms grid separates the two
outcomes but the decoder state.

**ja-cv2.wav (「いくら山を掘り返しても、どこかで見たような…」), 7-token tail, cuts every 0.5 s:**

| cut (s) | audio-less step → | raw | fixed (R1 alone) |
|---|---|---|---|
| 1.50 | `り` −0.00 | `…山を掘り` | `…山を掘` — **loses り** |
| 2.00 | `も` −0.00 | `…返しても` | `…返して` — **loses も** |
| 2.50 · 3.00 · 4.00 · 5.00 | `[PAD]` −0.25 / −0.79 / −0.50 / −0.25 | same | same |
| 3.50 | `み` −0.00 | `…面白み` | `…面白` — **loses み** |
| 4.50 | `。` −0.42 (`[PAD]` −1.47) | `…なかった。` | `…なかった` |

So the audio-less step is not only a junk source. When the segment ends while a word is still
being spelled out — CJK text is one or two tokens per character, and the cut lands mid-word at
these grid points — the model is still "owed" the word's last pieces when the 7-token tail runs
out, and the audio-less step is where the last owed piece comes out, confidently (−0.00), from
the text context and the audio it already holds in its KV cache. With a 7-token tail, three of
eight Japanese cuts and eight of thirteen Chinese cuts are in that state. Dropping the step alone (R1)
would therefore lose a real character in exactly the cases where a user ends a segment on a word:
PTT release, the 35 s cap, a short `minSilenceDuration`, or Smart Turn's 0.3 s check (#604).

**zh-fleurs1852.wav, 7-token tail, cuts every 1 s from 2 s to 14 s:** eight of thirteen cuts
leave an owed piece for the audio-less step (`变` −0.22, `网` −0.25, `下` −0.00, `别` −0.84, the
last byte of `忆` −0.00 — R1 leaves `回�`, which `end()` drops to `回` — and three times a lone
continuation byte, which the accumulator's U+FFFD guard drops either way); the other five end on
`[PAD]`. No suffix junk at these cuts — Chinese word pieces are what is owed, and R1 alone would
drop one character at each of the eight.

**17-token tail (the reference `num_right_pad_tokens`), same cuts:**

- ja-cv2.wav: all eight cuts end on `[PAD]` (−0.06 … −0.45, next candidate ≥ 2.3 nats behind);
  raw and fixed texts identical at every cut; every owed character is out before the tail ends
  (2.00 s → `…返しても、`). The cut-word completions the model invents at a mid-word cut
  (`掘り返すか` at 1.50 s) are the model's own and appear in any implementation.
- jfk.wav: the owed comma now comes out during the tail (2.40 s → `Americans,` with R1 too), but
  the audio-less step still ships junk at **6 of 16** cuts (`ous` at 2.40–2.64, `ished` at
  3.52/3.60), the same rate as with 7 tokens — the extra silence only moves which cuts lose the
  lottery. With R1 the text is `…Americans,` at all 16.

So the 10-token "max word length" buffer is exactly the room the owed pieces need, and it does
nothing for the junk: the audio-less step stays a lottery however long the silence before it.

## 6. Remedies

The two findings of §5 call for two changes together: the tail must be long enough that every owed
piece comes out during real (silent) audio steps, and the audio-less step must not be streamed.
Both are implemented on this branch: `TAIL_PAD_TOKENS` is 17, and `AudioPositionBudget`
(`_shared/streaming-generation.ts`) backs a `StoppingCriteria` the worker hands to `generate()`;
`audioPositionBudget.consistency.test.ts` holds the wiring in place.
Either alone is wrong — R1 alone loses owed CJK characters (8 of 13 Chinese cuts, 3 of 8
Japanese), R3 alone still streams the lottery step (6 of 16 English cuts junk, with 7 or 17
tokens alike).

**R1 — stop before the audio-less step (the bug).** Mirror Python transformers in the worker: once
`requestFinish()` fixes the feed's length, the chunk generator knows which chunk is the last; count
audio tokens (39 for the first chunk, `frames / 8` per later chunk) and pass `generate()` a
`StoppingCriteria` that fires when `38 + generated ≥ audioTokens` (the prefill consumes 39
positions and samples the first token; each later token consumes one more). The probe's `FIX=1`
path is exactly this. Off by one matters: `39 + generated` stops one step early and drops the
token of the last real audio position (it cost `" Americans"` in the sweep before it was
corrected). Cost: none — it removes a decoder step. `StoppingCriteria` has to be added to the
`_shared/transformers-all` pin. Scope: the Voxtral Realtime worker only; `voxtral-3b` is an
offline model on another path.

**R3 — tail = 17 tokens (the reference `num_right_pad_tokens`).** `TAIL_PAD_TOKENS = 7` is
"delay + 1"; `mistral-common` adds 10 more because "the model is delayed by delay + word length".
§5.1 shows that buffer doing real work: with 7 tokens, a segment that ends on a word leaves its
last pieces for the audio-less step; with 17, every owed piece is out during real steps, and what
the audio-less step then does is R1's problem. After a normal VAD endpoint the 1.4 s redemption already supplies that silence, so the
cost of 17 (10 more decode steps, ~0.1–0.3 s per utterance on a GPU) buys nothing there — but the
worker cannot tell a VAD endpoint from a PTT flush, the 35 s cap or a Smart Turn end (#604), and
those are exactly the endpoints that fall on a word. The simplest correct change is 17 everywhere;
a cheaper variant pads to 17 only when `finishGenerate()` is reached by `handleFlush`/the cap, or
when `[STREAMING_WORD]` was seen in the last 17 steps without its word's pieces following.

**R2 — upstream transformers.js.** The library should pull the next chunk after each step and stop
when the iterator is exhausted, as Python does, or at least drop the token of the audio-less step.
Filing that is an outward act and needs a go; R1 does not depend on it.

**R4 — not a fix: filtering `ished`.** The junk set is open-ended (`ch`, `ites`, `.` …) and the
same step can emit a plausible word; a post-filter treats the symptom. #528's downstream gate still
has its own reasons (real mid-word VAD cuts), independent of this.

Not involved: Silero's context (#601), the pre-speech pad (#603), the VAD thresholds, the chunk size
(`MAX_AUDIO_TOKENS_PER_ENCODER_CALL`), digital zeros as silence (the reference uses them too).

## 7. Open questions

- q4f16 (what Apple-silicon Macs load) was not run: the CPU execution provider has no fp16 path for
  this graph. The mechanism is dtype-independent; the exact winner at the audio-less step is not.
- The Chinese clip was swept with the 7-token tail only; the 17-token claim for CJK rests on the
  Japanese sweep.
- The junk rate (6/16 cuts on one English clip) is a property of this clip's decoder states, not a
  population estimate.
- "Always", as the reporter put it: the sweep gives a rate for one English clip; a sweep over the
  reporter's own audio would say how often the near-tie falls on a suffix for their voice and
  segment shape.
- `[STREAMING_WORD]` (33) is emitted before every word and skipped by `skip_special_tokens`; its
  presence could be used as a cheap "a word is pending" signal for the tail-length decision in R3.

## 8. Reproduction

```sh
mkdir /tmp/vx && cd /tmp/vx && npm i onnxruntime-node @huggingface/transformers@4.2.0
mkdir -p models/onnx-community && ln -s ~/.cache/huggingface/hub/models--onnx-community--Voxtral-Mini-4B-Realtime-2602-ONNX/snapshots/<sha> \
  models/onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX
P=<repo>/scripts/dev/voxtral-realtime-probe
VX_MODEL_DIR=$PWD/models/ VX_CLIP=jfk.wav node $P/probe.mjs B_onset_cut          # shipped behaviour
FIX=1 VX_MODEL_DIR=$PWD/models/ VX_CLIP=jfk.wav node $P/probe.mjs B_onset_cut    # R1
VX_MODEL_DIR=$PWD/models/ node $P/sweep.mjs jfk.wav 2.40 3.60 0.08 7             # §5.1
```

A 4.4 s case takes ~15 s on a 20-core GB10 CPU (q4 decoder, 50 steps); the model loads in 3 s.
