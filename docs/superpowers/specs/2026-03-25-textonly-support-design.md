# Add textOnly Support for Remaining AI Clients

**Issue**: [#143](https://github.com/kizuna-ai-lab/sokuji/issues/143)
**Date**: 2026-03-25

## Summary

Add `textOnly` flag support to VolcengineST, VolcengineAST2, and LocalInference clients. PalabraAI is excluded — its API does not support text-only output.

## Background

The `textOnly` flag in `BaseSessionConfig` tells clients to produce text-only output (no TTS audio). Currently it is used in one context:

- **Participant audio** — the second client created for participant/system audio capture always sets `textOnly: true` via `createParticipantSessionConfig()` in `MainPanel.tsx:296`

A future user-facing toggle may also set this flag, but that is outside the scope of this issue. The `BaseSessionConfig` interface already defines the `textOnly?: boolean` field — clients just need to respect it.

Currently, only OpenAI clients (3) and GeminiClient handle this flag. The remaining clients ignore it, causing unnecessary TTS generation (especially wasteful for participant audio where audio is always discarded client-side).

## Scope

| Client | Action | Approach |
|--------|--------|----------|
| **VolcengineST** | Mark as inherently text-only | Add `inherentlyTextOnly` to `ProviderCapabilities`; hide UI toggle |
| **VolcengineAST2** | Implement textOnly | Use `s2t` mode + omit `targetAudio` when `textOnly: true` |
| **LocalInference** | Implement textOnly | Skip TTS engine initialization and step when `textOnly: true` |
| **PalabraAI** | No change | API only supports `audio` output; toggle stays hidden per #142 |

## Detailed Design

### 1. VolcengineST — Inherently Text-Only Provider

**Problem**: VolcengineST is a speech-to-text translation service that never generates audio. The textOnly toggle is irrelevant.

**Change**: Add `inherentlyTextOnly: boolean` to the `ProviderCapabilities` interface in `src/services/providers/ProviderConfig.ts`. Set it to `true` for VolcengineST's provider config.

**Consumer**: This flag is consumed by the UI to permanently hide the textOnly toggle, and by `createSessionConfig()` / `createParticipantSessionConfig()` which can use it to always set `textOnly: true` defensively. No client code change is needed — VolcengineST already produces no audio.

**Files**:
- `src/services/providers/ProviderConfig.ts` — add `inherentlyTextOnly` to `ProviderCapabilities`
- VolcengineST provider config file — set `inherentlyTextOnly: true`
- All other provider configs — set `inherentlyTextOnly: false` (default)
- `VolcengineSTClient.ts` — no code changes needed

### 2. VolcengineAST2 — Server-Side s2t Mode

**Problem**: `sendStartSession()` always sends `mode: 's2s'` with `targetAudio`, even when `textOnly: true`. The server generates TTS audio that gets discarded (both for user toggle and participant audio).

**Change**: In `sendStartSession()`, check `this.currentConfig.textOnly`:
- If `true`: set `request.mode` to `'s2t'`, omit `targetAudio` field entirely
- If `false`: keep current behavior (`'s2s'` with `targetAudio`)

Additionally:
- Guard TTS event handlers as a safety measure: `TTSResponse`, `TTSSentenceStart`, `TTSSentenceEnd`, `TTSEnded` — skip processing when textOnly is active
- Update the realtime event log at line 421 to reflect actual mode (`'s2t'` vs `'s2s'`)
- The `validateApiKeyAndFetchModels` static method also sends `mode: 's2s'` — this is intentionally left unchanged as it's a validation call, not a session

**API support**: Volcengine AST2 API officially supports `s2t` mode ([docs](https://www.volcengine.com/docs/6561/1756902)). In this mode, `targetAudio` is optional. The server only sends subtitle events (650-655), no TTS events (350-352).

**Mid-session changes**: The mode is set at `sendStartSession()` time (connection start). Changing textOnly mid-session requires reconnection. This is consistent with how other clients handle it.

**Files**:
- `src/services/clients/VolcengineAST2Client.ts`:
  - `sendStartSession()`: conditional `mode` and `targetAudio` based on `this.currentConfig.textOnly`
  - `handleMessage()`: skip TTS event cases when textOnly
  - Event log in `sendStartSession()`: reflect actual mode

### 3. LocalInference — Skip TTS Step

**Problem**: The local inference pipeline always initializes TTS engine and runs TTS after translation, even when `textOnly: true`.

**Change**:
1. In `connect()`: when `textOnly: true`, skip TTS engine initialization entirely. This saves memory and worker startup time — meaningful optimization for participant audio.
2. In `processPipelineJob()`: check `this.config.textOnly` before running TTS. If true, emit text result directly without invoking the TTS engine.

**Relationship with `ttsModelId`**: A user could have `ttsModelId` configured but `textOnly: true`. The `textOnly` flag takes precedence — TTS is skipped regardless of model configuration.

**Files**:
- `src/services/clients/LocalInferenceClient.ts`:
  - `connect()`: skip TTS engine init when `textOnly: true`
  - `processPipelineJob()`: conditional TTS invocation based on `textOnly` config flag

### 4. PalabraAI — No Change

**Reason**: PalabraAI's API only supports `output_stream.content_type: "audio"`. There is no server-side way to suppress TTS. The UI toggle is already hidden per #142. The participant audio path already discards audio deltas client-side in `createParticipantEventHandlers()`.

## Testing

- **VolcengineST**: Verify sessions work as before (no behavioral change); verify `inherentlyTextOnly` flag is set in provider config
- **VolcengineAST2**:
  - Participant audio enabled → verify second client sends `mode: 's2t'` in protobuf payload (no `targetAudio` field), no TTS audio received, subtitles still work
  - Participant audio disabled, normal session → verify `mode: 's2s'` with `targetAudio`, TTS audio plays normally
  - Check realtime event log shows correct mode value
- **LocalInference**:
  - Participant audio enabled → verify no TTS engine initialized for participant client, translation text appears
  - Normal session with TTS model configured → verify TTS audio plays after translation
  - Normal session without TTS model → verify no TTS (existing behavior preserved)

## Out of Scope

- PalabraAI textOnly support (API limitation)
- User-facing textOnly toggle in UI (future feature; `BaseSessionConfig.textOnly` already defined)
- UI changes to toggle visibility (handled by #142)
- Any changes to OpenAI or Gemini clients (already implemented)
- `validateApiKeyAndFetchModels` in VolcengineAST2 (validation call, not a session)
