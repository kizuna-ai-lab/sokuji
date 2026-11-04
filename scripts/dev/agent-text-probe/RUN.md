# Agent-text probe: how to run it

Step 1 of the Soniox agent text input experiment. The question is whether sending the translation being spoken as
Soniox `agent_text` stops the app's own speech from being recognised as a line when that speech leaks into the
microphone. The second question is whether it hurts a person who talks over the playback.

- **Setup.** Face-to-face: one shared `two_way` STT socket and both voices, built by the app's own `buildSoniox` and
  `createSonioxAdapter`.
- **Echo.** No echo cancellation. The played speech is mixed digitally into the STT input: 120 ms later, at −6 dB.
- **Repeatable.** The human script is the same samples in every run.
- **Files.** `probe.mts` is the CLI. `run.ts` holds the timeline, `agentText.ts` the four conditions, `score.ts` the
  measures and `fakeSoniox.ts` the stand-in for the dry run.

## Before the live runs

- **Node ≥ 22.** The probe needs a global `WebSocket`. This machine has Node 24 under nvm: `nvm use 24`. On Node 20,
  set `NODE_OPTIONS=--experimental-websocket`.
- **A Soniox key of your own, from a file.** The key is read from `SONIOX_API_KEY_FILE`, or from `SONIOX_API_KEY`. It
  is never logged. A run writes it nowhere: the probe replaces it with `<key>` in its logs.
- **Region.** The default is `--region jp`, as the karaoke probe used. Pass the key's own region.
- **Billed to the key's owner.** See "Cost" below. These runs are the only thing in this directory that costs money.
- **Never** run the app, vite or Electron for this. The probe runs the adapter in Node.

```sh
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-stt-v6
nvm use 24
export SONIOX_API_KEY_FILE=/path/to/soniox-key   # never paste the key itself
```

## 0. Dry run (free: no key, no network)

The same pipeline runs on a virtual clock against `FakeSoniox`, so a full run takes about 1.5 s. The stand-in's
recognition and agent-text behaviour are assumptions, there so the scorer has something to tell apart. They predict
nothing about Soniox.

```sh
for p in zh-ja zh-en; do
  for c in none speak enqueue lead; do
    npx tsx scripts/dev/agent-text-probe/probe.mts $p --agent-text $c --fake
  done
  npx tsx scripts/dev/agent-text-probe/probe.mts $p --agent-text none --echo off --fake
done
npx tsx scripts/dev/agent-text-probe/probe.mts --compare .superpowers/agent-text-probe/fake
```

## 1. Smoke run (live, about 30 s, under US$0.01)

Run this one first. It tells three things before any money goes into the full set:

- whether Soniox accepts `enable_agent_text_input` with this key and region;
- whether it accepts an `agent_text` with empty text and `end_of_segment: true`;
- what level the TTS really plays at.

```sh
npx tsx scripts/dev/agent-text-probe/probe.mts zh-ja --agent-text lead --turns 2 --region jp
```

Check three things in its `.summary.json`:

- **`sonioxErrors` is empty.** If an error ends the stream on the segment end, rerun with `--close-segments off`. Use
  that flag in every run after that, and record it.
- **`levels.ttsActiveDbfs`.** The echo gain assumes −20 dBFS. If the measured level is more than about 2 dB off, add
  `--tts-dbfs <that value>` to every run below. That keeps the echo at −6 dB under the voices. Either way,
  `levels.echoToVoiceDb` reports the ratio each run really had.
- **`warnings` is empty.**

## 2. The runs (live): 4 conditions × 2 pairs, plus a clean baseline per pair

```sh
for p in zh-ja zh-en; do
  for c in none speak enqueue lead; do
    npx tsx scripts/dev/agent-text-probe/probe.mts $p --agent-text $c --region jp
  done
  # The floor: the same script with no echo in the microphone (and no agent text).
  npx tsx scripts/dev/agent-text-probe/probe.mts $p --agent-text none --echo off --region jp
done
npx tsx scripts/dev/agent-text-probe/probe.mts --compare .superpowers/agent-text-probe/live
```

What the conditions send:

- **`none`.** Agent text is off; the config frame does not ask for it.
- **`speak`.** At `LegSpeech.speak()`, the text handed to synthesis. `end_of_segment` goes at that voice's
  `endUtterance()`.
- **`enqueue`.** As each audio chunk is queued for playback, the chunk's provisional (karaoke) range of text.
  `end_of_segment` goes when that voice's queue goes idle.
- **`lead`.** The same per-chunk text, sent at the chunk's play time minus `--lead-ms` (default 700). When that time
  has already passed, the text goes at once; `end_of_segment` goes as in `enqueue`.

Optional, 6 more runs. Agent text with no echo stands in for headphones (open question Q10): does sending agent text
hurt a person's recognition when nothing leaks?

```sh
for p in zh-ja zh-en; do for c in speak enqueue lead; do
  npx tsx scripts/dev/agent-text-probe/probe.mts $p --agent-text $c --echo off --region jp
done; done
```

### Other options

| Option | Default | Meaning |
|---|---|---|
| `--echo-delay-ms` | 120 | From play time to the microphone |
| `--echo-gain-db` | −6 | Echo level relative to the voices |
| `--voice-dbfs` | −20 | Active level of every human clip |
| `--tts-dbfs` | −20 | TTS level that the echo gain assumes |
| `--rir-rt60` | 0 (none) | Room response, sparse (`echoSim.makeRir`); set with `--rir-drr-db` (10) and `--rir-seed` (1) |
| `--lead-ms` | 700 | Lead used by the `lead` condition |
| `--close-segments on\|off` | on | Whether `end_of_segment` is sent |
| `--turns N` | all | Play only the first N turns |
| `--out DIR` | `.superpowers/agent-text-probe/<live\|fake>/` | Where output goes (ignored by git) |

Every parameter is written in the run's first log line (`run`). A saved log can be scored again with no new run:
`probe.mts --rescore <log.jsonl>`.

## Output (per run)

`<stamp>-<pair>-<condition>[-echo-off]` followed by:

- **`.jsonl`.** Every adapter event and frame, every STT message (tokens compact), every TTS frame, every agent-text
  send with the server's audio position at that moment, and the play time and echo window of every clip.
- **`.in.wav`.** What the microphone captured: the voices plus the echo. What Soniox got is this at the mixer's 0.5
  gain.
- **`.out.wav`.** What was played, both voices, on the same timeline. The echo in `.in.wav` is this, delayed.
- **`.summary.json`.** Its fields:
  - `echoLines`: lines no person said, each with its text, time, the played text it overlaps, and whether it was
    spoken back. Its counts are `echoLineCount` and `echoTranslatedBack` (the loop).
  - `mergedLines`: a person's line that also holds echo. It is scored as the person's, with the echo counted as
    insertions.
  - `humanWer`: CER for zh and ja, WER for en. Each turn is split into talk-over or clean according to whether its
    speech overlapped an echo. Substitutions, deletions (the person's words lost) and insertions (echo leaking in) are
    counted apart.
  - `agentText`: frames sent and dropped, characters, segment ends, and the planner's counts of sends that interleave
    with the other voice's open segment. It also gives two leads at p10, p50 and p90:
    - `serverLeadMs`: the text's lead over its echo on the STT audio clock. This is what Soniox places the text by.
    - `playLeadMs`: the text's lead over playback.
  - `sonioxErrors`.
  - `inputTextTokens`, read from the final message if it names them. Otherwise a note says the cost must be read in
    the Soniox console.
  - `levels`: the measured TTS level and the echo-to-voice ratio.
  - `warnings`: a resumed socket, lost frames, or an early end.

## Cost

Soniox list prices, read from soniox.com/pricing on 2026-11-04:

- real-time STT: US$0.12 per hour of audio;
- real-time TTS: US$0.70 per hour of generated speech;
- STT input text tokens, which is how agent text is billed: US$4 per 1M tokens.

**Length of one session.** A session lasts the script plus its tail: the tail is 8 s at least, then until the speech
has been quiet for 5 s, and never more than 60 s.

- zh-ja: 166 s of script, so 2.9–3.8 min.
- zh-en: 149 s of script, so 2.6–3.5 min.

**What one run costs:**

- STT: about 3.5 min of audio, about US$0.007.
- TTS: about 75 s of speech, about US$0.015. A baseline run whose echo loops can reach both voices for the whole
  session, about 7.6 min and US$0.09.
- Agent text: about 0.4–1k characters, about 1k tokens, about US$0.004.

| Set | Runs | Audio (min) | Estimate at list price |
|---|---|---|---|
| Smoke run | 1 | ~0.5 | < US$0.01 |
| Core runs (4 conditions × 2 pairs + 2 echo-off) | 10 | ~33–37 | ≈ US$0.40 (STT 0.07 + TTS ≤ 0.30 + agent text 0.03) |
| Optional echo-off with agent text | 6 | ~20 | ≈ US$0.15 |

**Upper bound.** The backend bills managed sessions at deliberately high rates (`kizunaBudget.ts`): STT US$1.10 per
hour per stream and TTS US$1.40 per hour per stream, charged for the whole session. One STT stream plus two TTS
streams for 3.8 min comes to ≤ US$0.25 per run. That is ≤ US$2.5 for the 10 core runs and ≤ US$4 for all 16.

**Where to read the real cost.** Soniox does not document token counts in its responses. Unless `inputTextTokens` is
filled in, read the cost per key in the Soniox console.
