# Add textOnly Support for Remaining AI Clients

**Issue**: [#143](https://github.com/kizuna-ai-lab/sokuji/issues/143)
**Date**: 2026-03-25

## Summary

Add `textOnly` flag support to VolcengineST, VolcengineAST2, and LocalInference clients. PalabraAI is excluded — its API does not support text-only output. Introduce `textOnlyCapability` enum to `ProviderCapabilities` and wire the UI toggle to it.

## Background

The `textOnly` flag in `BaseSessionConfig` tells clients to produce text-only output (no TTS audio). It is used in two contexts:

- **Participant audio** — the second client created for participant/system audio capture always sets `textOnly: true` via `createParticipantSessionConfig()` in `MainPanel.tsx:296`
- **User toggle** — the textOnly toggle in `LanguageSection.tsx` sets `textOnly` in `settingsStore`, which is applied to session configs via `createSessionConfig()`

Previously, only OpenAI clients (3) and GeminiClient handled this flag. The remaining clients ignored it, causing unnecessary TTS generation.

## Scope

| Client | Action | Approach |
|--------|--------|----------|
| **VolcengineST** | Mark as inherently text-only | `textOnlyCapability: 'always'` in provider config |
| **VolcengineAST2** | Implement textOnly | Use `s2t` mode + omit `targetAudio` when `textOnly: true` |
| **LocalInference** | Implement textOnly | Skip TTS engine initialization and step when `textOnly: true` |
| **PalabraAI** | No change | `textOnlyCapability: 'never'`; API only supports `audio` output |

## Detailed Design

### Provider Capability: `textOnlyCapability`

Add `textOnlyCapability: 'always' | 'optional' | 'never'` to `ProviderCapabilities` in `src/services/providers/ProviderConfig.ts`:

- `'always'` — Provider is inherently text-only (VolcengineST). Toggle hidden.
- `'optional'` — Provider supports text-only mode (OpenAI, Gemini, AST2, LocalInference, etc.). Toggle shown.
- `'never'` — Provider cannot suppress TTS (PalabraAI). Toggle hidden.

The UI toggle in `LanguageSection.tsx` renders when `textOnlyCapability === 'optional'`.

### 1. VolcengineST — Inherently Text-Only Provider

Set `textOnlyCapability: 'always'`. No client code changes needed — VolcengineST already produces no audio.

### 2. VolcengineAST2 — Server-Side s2t Mode

In `sendStartSession()`, check `this.currentConfig.textOnly`:
- If `true`: set `request.mode` to `'s2t'`, omit `targetAudio` field entirely
- If `false`: keep current behavior (`'s2s'` with `targetAudio`)

Additionally:
- Guard TTS event handlers: `TTSResponse`, `TTSSentenceStart`, `TTSSentenceEnd`, `TTSEnded` — skip processing when textOnly
- Update realtime event log to reflect actual mode
- `validateApiKeyAndFetchModels` intentionally left unchanged (validation call, not a session)

**API support**: Volcengine AST2 API officially supports `s2t` mode ([docs](https://www.volcengine.com/docs/6561/1756902)). In this mode, `targetAudio` is optional. The server only sends subtitle events (650-655), no TTS events (350-352).

**Mid-session changes**: Mode is set at connection start. Changing textOnly mid-session requires reconnection.

### 3. LocalInference — Skip TTS Step

In `connect()`: when `textOnly: true`, skip TTS engine initialization entirely. This saves memory and worker startup time.

**Relationship with `ttsModelId`**: `textOnly` flag takes precedence — TTS is skipped regardless of model configuration.

### 4. PalabraAI — No Change

Set `textOnlyCapability: 'never'`. API only supports `output_stream.content_type: "audio"`. Participant audio path discards audio deltas client-side.

## Testing

- **VolcengineST**: Verify `textOnlyCapability: 'always'`, toggle hidden, sessions work as before
- **VolcengineAST2**:
  - Toggle textOnly ON → verify `s2t` mode, no TTS audio, subtitles work
  - Toggle textOnly OFF → verify `s2s` mode, TTS plays
  - Participant audio → second client uses `s2t` mode
- **LocalInference**:
  - Toggle textOnly ON → no TTS engine initialized, text appears
  - Toggle textOnly OFF with TTS model → TTS plays
  - No TTS model → existing behavior preserved
- **PalabraAI**: Verify toggle hidden

## Out of Scope

- PalabraAI textOnly support (API limitation)
- Any changes to OpenAI or Gemini clients (already implemented)
- `validateApiKeyAndFetchModels` in VolcengineAST2 (validation call, not a session)
