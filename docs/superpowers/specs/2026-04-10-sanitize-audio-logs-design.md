# Strip Audio Payloads from Logs

**Issue**: [#189](https://github.com/kizuna-ai-lab/sokuji/issues/189)
**Date**: 2026-04-10

## Problem

The existing `sanitizeEvent` function in `logStore.ts` fails to strip Gemini audio data. Gemini encodes audio as base64 in `event.data.parts[].inlineData.data`, but `sanitizeEvent` only checks a hardcoded list of field names (`audio`, `audioData`, `delta`, etc.) and misses this path entirely.

Real-world impact from a sample Gemini session log:
- Total log size: **896KB**
- After removing base64 audio: **44KB**
- Audio data accounts for **95%** of the log volume

The `delta` field is also problematic: it's in the strip list, but `delta` is used for both audio deltas (base64) and text deltas (readable text), causing potential false positives on text content.

## Solution: Three-Layer Sanitization

Replace the current field-name-only approach with a layered strategy.

### Layer 1: Structure-Aware Detection (Gemini)

Detect objects that contain both `mimeType` and `data` keys where `mimeType` indicates audio content (`audio/`). Replace the `data` value with a size placeholder.

**Before:**
```json
{
  "inlineData": {
    "mimeType": "audio/pcm;rate=24000",
    "data": "FADN/wkA0P/v/8r/2P/2/83/3v/K/83/..."
  }
}
```

**After:**
```json
{
  "inlineData": {
    "mimeType": "audio/pcm;rate=24000",
    "data": "<audio:45.0KB>"
  }
}
```

### Layer 2: Generic Base64 Detection (Catch-All)

For any string value longer than 200 characters, test whether it is likely base64-encoded data. A string is considered base64 if it consists predominantly of `[A-Za-z0-9+/=]` characters (>90% of the string).

Matched strings are replaced with `<base64:NNKB>` showing the estimated decoded byte count (`string.length * 3 / 4`).

This layer catches:
- Future provider audio formats with unknown field names
- Any base64-encoded binary data that slips past Layer 1 and Layer 3
- OpenAI audio deltas in the `delta` field (previously caught by field name, now caught by content)

### Layer 3: Field-Name Rules (Existing, Refined)

Keep the existing field-name checks for known audio fields:
- `audio`, `audioData`, `audio_data`, `pcmData`, `buffer`, `wav`, `pcm`

**Remove `delta` from the list** because it is too generic and causes false positives on text delta events. Audio deltas are now handled by Layer 2's base64 detection.

For matched fields:
- `ArrayBuffer` / `TypedArray` values: replace with `<binary:NNKB>`
- Arrays with length > 1000: replace with `<binary:NNKB>`
- Strings longer than 200 chars: replace with `<audio:NNKB>`
- Other values: recurse normally

### Placeholder Format

All placeholders include a human-readable byte estimate:

| Placeholder | When Used |
|---|---|
| `<audio:45.0KB>` | Known audio field or audio mimeType detected |
| `<base64:2.5KB>` | Generic base64 string detected |
| `<binary:12.0KB>` | ArrayBuffer or TypedArray detected |

Byte size is calculated as:
- Base64 strings: `Math.ceil(string.length * 3 / 4)`
- ArrayBuffer: `byteLength`
- TypedArray: `byteLength`
- Arrays: `length * 4` (rough estimate for numeric arrays)

Formatting: bytes < 1024 = `NB`, otherwise `N.NKB`, otherwise `N.NMB`.

### Execution Order

Within `sanitizeEvent`, for each object being sanitized:
1. Check Layer 1 (structure-aware): before iterating keys, check if the object itself has both a `mimeType` string starting with `audio/` and a `data` key — if so, replace `data` with placeholder and copy other keys normally
2. Check Layer 3 (field-name): if key matches known audio field names, apply field-specific rules
3. For string values, check Layer 2 (base64 detection) before recursing
4. Otherwise recurse normally

Layer 1 takes priority because it's the most precise. Layer 2 acts as a safety net.

## Scope

### Files Modified
- `src/stores/logStore.ts` — rewrite `sanitizeEvent` function (~60 lines)

### Files Created
- `src/stores/__tests__/sanitizeEvent.test.ts` — unit tests

### Not Changed
- `handleCopyLogs` in `LogsPanel.tsx` — not needed, store data is already sanitized
- Event component rendering — same reason
- Sanitization timing — stays at `addRealtimeEvent` (store entry)

## Test Plan

Unit tests for `sanitizeEvent` covering:

1. **Gemini audio** (`serverContent.modelTurn` with `inlineData.data`): audio replaced, `mimeType` preserved, text/thought parts untouched
2. **Gemini mixed parts**: event with both text part and audio part in same `parts` array
3. **OpenAI audio delta** (`response.audio.delta` with base64 `delta` field): audio replaced
4. **OpenAI text delta** (`response.text.delta` with text `delta` field): text preserved (no false positive)
5. **Palabra audio** (`output_audio_data` / `input_audio_data`): audio replaced
6. **Deeply nested base64**: base64 string buried several levels deep in an unknown structure
7. **Short strings not stripped**: base64-looking strings under 200 chars survive
8. **Non-audio inlineData**: `inlineData` with non-audio mimeType (e.g., `image/png`) — base64 still stripped by Layer 2
9. **Passthrough**: events with no audio data pass through unchanged
10. **Placeholder format**: verify byte count accuracy and human-readable formatting
