# Provider refactor, step 1: before/after comparison

2026-11-22. Linux (arm64) desktop with a network connection; the E2E build of each side.
- "Before": `main` at ca1259850.
- "After": this branch at e57f70bab.

## This device + Bing + Edge (Japanese → English)

**Method.** Each run uses the same user-data directory, so the same downloaded recognition model (SenseVoice int8) serves both sides. Each run:
1. starts the line-up transcription `local_inference`, translation `bing`, speech `edge`;
2. plays the repository's eight recorded Japanese sentences twice (16 utterances) into the microphone, with the usual pauses;
3. stops.

What each column means:
- *Rows* are the source and translation segments in the stored record.
- *Latency* is the time from a source row opening to its translation row opening.
- *Rows read aloud* counts rows whose replay button was enabled at the end.

| Run | Rows (source / translation) | Latency median | Latency p90 | Latency max | Rows read aloud |
|---|---|---|---|---|---|
| before 1 | 12 / 12 | 864 ms | 1090 ms | 2604 ms | 11 |
| after 1 | 12 / 12 | 895 ms | 2257 ms | 2321 ms | 11 |
| before 2 | 12 / 12 | 917 ms | 1083 ms | 1142 ms | 12 |
| after 2 | 12 / 12 | 841 ms | 954 ms | 1332 ms | 12 |
| before 3 | 12 / 12 | 933 ms | 1333 ms | 1448 ms | 11 |
| after 3 | 12 / 12 | 803 ms | 995 ms | 1384 ms | 12 |

**Results:**
- **Segmentation:** the same row segmentation in every run. Sixteen utterances became twelve rows on both sides, because the recognition model's voice-activity detection joins some short sentences. The sentence cutter of the composite path did not split or join rows differently.
- **Latency:** comparable. The median is 904 ms before and 846 ms after, averaged over three runs each. The one high p90 after (run 1) is a single slow Bing answer.
- **Speech:** every row or all but one was read aloud on both sides. The occasional miss is an Edge connection refusal, which happens on both sides.
- **Record:** the same on both sides. It names `local_inference`, `bing`, `edge` and the models `sensevoice-int8`, `bing-translator`, `edge-tts`.

## Other line-ups on this branch

- Soniox (own key) + Edge: `real-mixed-line-up.spec.ts` "Soniox with an own key is read aloud by Edge…" passes.
- Soniox (own key) + Bing + Edge: `real-mixed-line-up.spec.ts` "…Bing translates what it heard, and Edge reads it aloud…" passes.
- All local models (local translation and local voice): not run, because no local translation or speech model was downloaded for this comparison. The all-local line-up still composes into the local provider's whole unit, as pinned by `src/providers/localInference/provider.test.ts`.

## Edge settings migration

The app was started with these stored local settings, and with the line-up local + Bing + Edge:
- `settings.localInference.voices` = `{"ja→en": {"edge": "en-US-GuyNeural", "speaker": 2}}`
- `settings.localInference.ttsSpeed` = `1.3`

Results:
- Edge's card in Languages and line-up shows the voice "Guy (Male, en-US)" and the speed 1.3x.
- Nothing was written under `settings.edge.*`, and the local keys are unchanged.

## Not verified

- macOS and Windows.
- The extension build.
