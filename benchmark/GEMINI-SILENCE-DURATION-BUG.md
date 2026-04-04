# Bug Report: `silenceDurationMs` in `automaticActivityDetection` ignored on Gemini 3.1

## Summary

The `silenceDurationMs` parameter in `realtimeInputConfig.automaticActivityDetection` is completely ignored by `gemini-3.1-flash-live-preview`. The same parameter works correctly on `gemini-2.5-flash-native-audio-latest`. Regardless of the value set (50ms, 100ms, 3000ms, 5000ms), the 3.1 model uses the same internal silence threshold for end-of-speech detection and turn splitting.

## Environment

- **SDK**: `@google/genai` (JavaScript/TypeScript)
- **Models tested**:
  - `gemini-3.1-flash-live-preview` — **BUG: parameter ignored**
  - `gemini-2.5-flash-native-audio-latest` — works correctly
- **Platform**: Node.js

## Reproduction

### Test audio

A 9.69s WAV file (24kHz, 16-bit PCM, mono) with the structure:

```
[speech 3.85s] + [silence 2.0s] + [speech 3.85s]
```

Both speech segments are identical: "Ask not what your country can do for you, ask what you can do for your country."

Generate with:

```bash
ffmpeg -y \
  -i speech.wav \
  -f s16le -ar 24000 -ac 1 -t 2 -i /dev/zero \
  -i speech.wav \
  -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]" \
  -map "[out]" -ar 24000 -ac 1 -sample_fmt s16 \
  test-speech-silence-speech.wav
```

### Minimal reproduction script

See [`test-silence-duration.mjs`](./test-silence-duration.mjs) in this directory.

```bash
GEMINI_API_KEY=<key> GEMINI_MODEL=<model> node test-silence-duration.mjs <silenceDurationMs>
```

### Configuration sent

```json
{
  "setup": {
    "realtimeInputConfig": {
      "turnCoverage": "TURN_INCLUDES_ONLY_ACTIVITY",
      "automaticActivityDetection": {
        "disabled": false,
        "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH",
        "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
        "silenceDurationMs": 5000,
        "prefixPaddingMs": 100
      }
    }
  }
}
```

## Expected behavior

`silenceDurationMs` controls the minimum silence duration before end-of-speech is committed (per [API documentation](https://ai.google.dev/api/live)):

> "The required duration of detected non-speech (e.g. silence) before end-of-speech is committed."

With the test audio containing a **2-second silence gap** and `silenceDurationMs=5000`:

- 2000ms gap < 5000ms threshold → **should NOT split** → 1 turn with both segments

## Actual behavior — model comparison

### gemini-2.5-flash-native-audio-latest: `silenceDurationMs=5000` ✓ WORKS

```
[0.20s] Sending 9.7s of audio...
[2.93s] inputTranscription: " as"
[3.07s] inputTranscription: "k"
...                                    ← streaming word-by-word transcription
[6.01s] inputTranscription: "."
                                       ← 2s silence gap passes (< 5000ms threshold, no split)
[8.20s] inputTranscription: " As"
[8.40s] inputTranscription: "k"
...                                    ← second segment transcribed in SAME turn
[11.89s] inputTranscription: "."
[22.29s] turnComplete #1

RESULT: 1 turn ✓ — silenceDurationMs respected, 2s gap did not cause split
```

### gemini-3.1-flash-live-preview: `silenceDurationMs=5000` ✗ IGNORED

```
[0.10s] Sending 9.7s of audio...
[5.15s] inputTranscription: "Ask not what your country can do for you, ask what you can do for your country."
[6.34s] turnComplete #1              ← SPLIT at 2s gap despite 5000ms threshold!
[11.14s] inputTranscription: "Ask not what your country can do for you, ask what you can do for your country."
[20.21s] turnComplete #2

RESULT: 2 turns ✗ — silenceDurationMs ignored, 2s gap caused split anyway
```

### gemini-3.1 with explicit turnCoverage: still ✗ IGNORED

Also tested with `turnCoverage: "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO"` (3.1 default) — same result: 2 turns. The `turnCoverage` setting does not affect this behavior.

## Additional behavioral differences between 2.5 and 3.1

| Behavior | gemini-2.5 | gemini-3.1 |
|----------|-----------|-----------|
| `inputTranscription` delivery | Streaming, word-by-word | Batch, full sentence at once |
| `silenceDurationMs` | Respected | Ignored |
| Turn splitting | Controlled by `silenceDurationMs` | Fixed internal threshold |
| Default `turnCoverage` | `TURN_INCLUDES_ONLY_ACTIVITY` | `TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO` |

## Additional test: single speech segment

Using a single 3.85s speech clip (no silence gap), measuring time from end of speech to `turnComplete`:

| Model | `silenceDurationMs` | Silence→turnComplete |
|-------|---------------------|----------------------|
| 3.1 | 50 | ~11163ms |
| 3.1 | 3000 | ~10995ms |

Both produce virtually identical latency on 3.1. If `silenceDurationMs=3000` were working, there should be at minimum a 3-second delay.

## Impact

Applications using `gemini-3.1-flash-live-preview` that rely on `silenceDurationMs` to control turn splitting sensitivity (e.g., real-time translation, meeting transcription) cannot tune this behavior. The parameter is accepted without error but has no observable effect. This forces developers to either:

1. Fall back to `gemini-2.5` models where the parameter works
2. Implement client-side VAD with manual `activityStart`/`activityEnd` signals
3. Accept the model's fixed internal turn splitting behavior

## SDK code path verification

Verified in the SDK source ([`src/converters/_live_converters.ts`](https://github.com/googleapis/js-genai/blob/main/src/converters/_live_converters.ts)) that `realtimeInputConfig` is passed through to the WebSocket setup message without transformation — the config reaches the server exactly as specified. This is a **server-side / model-specific issue**, not an SDK serialization bug.
