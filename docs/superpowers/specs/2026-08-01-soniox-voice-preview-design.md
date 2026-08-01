# Soniox Cloned-Voice Preview (TTS Audition) — Design

**Date**: 2026-08-01
**Status**: Approved (brainstormed with user; API facts live-probed + OpenAPI-verified 2026-08-01)
**Tracking**: issue #375 (descends from #372 voice cloning, #342 API-surface audit)

## Summary

After cloning a voice, the only way to hear the result today is to start a full
translation session. Add a preview button to each **ready** cloned voice in the
Soniox "Manage imported voices" list: one click synthesizes a short sample
sentence with that voice over the Soniox TTS REST endpoint and plays it back
locally, with a spinner while the round-trip is in flight and errors in the
section's existing banner.

Scope is BYOK cloned voices only. The 28 built-ins are deliberately out of
scope (they live inside a `<select>` as `<option>`s, which cannot host a
button — covering them needs a different affordance and is a separate change).

## Verified facts (live probes + OpenAPI, 2026-08-01)

- **REST endpoint**: `POST https://tts-rt.soniox.com/tts`, `Authorization:
  Bearer <key>`, `Content-Type: application/json`. Returns **raw audio bytes**
  with a `Content-Type` matching the requested `audio_format` (PCM formats →
  `audio/pcm`).
- **Payload** (`CreateTTSPayload` in <https://soniox.com/docs/openapi.yaml>):
  required `model`, `language`, `voice`, `audio_format`, `text`; optional
  `sample_rate` (8000|16000|24000|44100|48000), `bitrate`, `speed`
  (0.7–1.3, default 1.0), `client_reference_id`. The `voice` field is
  documented verbatim as "a built-in voice name (for example `Adrian`) **or the
  ID of a cloned voice**".
- **CORS is open**: live preflight `OPTIONS https://tts-rt.soniox.com/tts`
  returns `204` with `access-control-allow-origin: *` and
  `access-control-allow-headers: Content-Type, Authorization`. A browser
  `fetch` from the extension/renderer works with no proxy.
- **Extension CSP gap**: `extension/manifest.json` `connect-src` currently
  lists `wss://tts-rt.soniox.com` but **not** `https://tts-rt.soniox.com`.
  Without adding it the REST call is blocked in the extension while working
  fine in Electron — a silent, platform-specific failure.
- **Error body**: `TTSApiError` = `{error_code, error_type, error_message}`.
  `SonioxVoicesClient.throwApiError` already reads `body.error_type` and
  `body.message ?? body.error_message`, so the existing `SonioxVoicesError`
  shape carries TTS errors unchanged.
- **Sample-rate/format parity**: `pcm_s16le` @ 24000 matches what
  `SonioxTtsStream` already requests for session audio.
- **`disabled` on `VoiceEntry`**: repo-wide, only `SonioxVoiceSection` ever
  sets it (processing/failed clones and the "(deleted voice)" placeholder).
  Native/WASM voice adapters never do — so gating the preview button on
  `!v.disabled` is a zero-behavior-change for them.
- **Soniox target languages**: 60, plain ISO-639-1 codes
  (`SonioxProviderConfig.LANGUAGES`). The app ships 30 UI locales, which map
  onto 28 distinct Soniox codes (`fil→tl`, `pt_BR`/`pt_PT→pt`,
  `zh_CN`/`zh_TW→zh`); all 28 are in Soniox's 60.

## Decisions

| Decision | Choice |
| --- | --- |
| Coverage | Cloned voices only; built-ins are a separate follow-up |
| Synthesis path | One-shot REST `POST /tts` with the permanent BYOK key |
| Audio format | `pcm_s16le` @ 24000 — raw PCM, no `decodeAudioData`, no container parsing, deterministic sample rate |
| Sample text | Follows the configured `targetLanguage`; code-side `{language → sentence}` table, English fallback — **not** i18n (it is TTS input keyed by TTS language, not UI copy keyed by UI locale) |
| UI seam | Generalize the existing `onPreview` prop rather than adding a parallel `onAudition` |
| Speed | Honors the user's `ttsSpeed`; omitted from the wire when `1.0` (same rule as `SonioxTtsStream.openStream`) |
| During an active session | Preview stays available |
| Repeat clicks | Cached per `(voiceId, language, speed)` for the component's lifetime |
| Cost disclosure | A `setting-description` line under the manage block, not a tooltip |
| Not doing | Built-in voice preview, managed mode, user-supplied preview text, cross-session cache persistence |

Two decisions with non-obvious reasoning:

- **Preview stays available during an active session.** `VoiceLibrarySection`'s
  established contract is that import / rename / delete remain open mid-session
  "so users can stage voices for their next session", and the existing native
  preview button is already un-gated. Preview audio plays through the
  component's own `AudioContext` to the default output, not through
  `ModernAudioPlayer`'s selected (possibly virtual) device, so it cannot leak
  into a meeting. Consistency beats special-casing.
- **Results are cached.** TTS output for a fixed text is effectively
  deterministic, so a second listen carries no new information but would spend
  the user's tokens again. Changing `targetLanguage` or `ttsSpeed` changes the
  cache key and re-synthesizes.

## Architecture

### New: `src/services/clients/SonioxTtsRest.ts`

Sits beside `SonioxTtsStream.ts`; a single function:

```ts
synthesizeOnce(opts: {
  apiKey: string; voice: string; language: string;
  text: string; speed?: number; signal?: AbortSignal;
}): Promise<{ audio: Float32Array; sampleRate: number }>
```

Posts `{model:'tts-rt-v1', voice, language, text, audio_format:'pcm_s16le',
sample_rate:24000, ...(speed !== 1.0 && {speed})}`, converts the response's
Int16 PCM to `Float32Array`, and rejects with `SonioxVoicesError` on HTTP
errors, transport failures, timeout, and on a zero-byte body (a silent empty
response would otherwise read to the user as "the button does nothing").

It is a separate module from `SonioxVoicesClient` on purpose: that client is
the `api.soniox.com/v1/voices` CRUD surface with the invariant "permanent key
only". TTS lives on a different host and accepts temporary keys too; merging
them would blur that invariant.

### New: `src/components/Settings/sections/sonioxPreviewSample.ts`

```ts
previewSampleFor(language: string): { text: string; language: string }
```

Returns a **pair**, never a bare string — so no caller can construct the
"English text, `language: 'ja'`" combination that would make Soniox read the
sentence with the wrong phonology. Seeded with the 28 Soniox codes the app's
UI locales map onto (the actual user-base distribution); every other target
language falls back to `{ text: <English sentence>, language: 'en' }`.

The sentences are **authored per language as literals in this module**, not
translated at runtime and not sourced from i18n: the key is the TTS target
language, which is independent of the user's UI language.

The sentence is neutral (it does not say "cloned"), ~10–15 words / 2–3 seconds
— short enough to be cheap and fast, and reusable if built-in preview lands
later.

### Changed: `src/components/Settings/sections/VoiceLibrarySection.tsx`

1. **`onPreview` contract generalized** from "fetch the stored reference clip"
   to "fetch a playable sample of this voice (a stored clip, or synthesized on
   demand)". Signature gains an optional second parameter:
   `(id: string, signal?: AbortSignal) => Promise<{audio, sampleRate} | null>`.
   Native adapters ignore the new parameter and are otherwise untouched.
2. **Busy state**: a `previewLoadingId` set on dispatch and cleared when the
   promise settles. While busy the row button renders the repo's existing
   `<span className="spinner" />` and is `disabled`, so a second click cannot
   fire a second synthesis.
3. **Abort**: the existing monotonic `previewTokenRef` is joined by an
   `AbortController` ref that `stopPreview()` aborts. Switching rows (or
   unmounting) now cancels an in-flight synthesis instead of paying for it and
   discarding the result. The token counter stays — it still guards against a
   stale resolution starting playback over a newer one.
4. **Gating**: the render condition becomes
   `onPreview && v.removable && !v.disabled`, so processing / failed clones and
   the "(deleted voice)" placeholder show no button.

Errors continue to be swallowed inside the component (unchanged); reporting is
the parent's job, which keeps native behavior byte-identical.

### Changed: `src/components/Settings/sections/SonioxVoiceSection.tsx`

- Prop type widens from `{voice, apiKey}` to `{voice, apiKey, targetLanguage,
  ttsSpeed}`. The call site in `ProviderSpecificSettings.tsx` already passes
  the full `activeSonioxSettings` object — no change there.
- `handlePreview(id, signal)`: cache lookup on `` `${id}|${language}|${speed}` ``
  → miss → `synthesizeOnce` → store → return. Wrapped in try/catch that maps
  the failure into `captureError` and returns `null`.
- `mapTtsError` (new, separate from `mapCreateError`, whose branches are all
  voices-CRUD specific): `401`/`unauthenticated` → invalid API key;
  `429`/`limit_exceeded` → quota reached; `timeout` → timed out, retry;
  otherwise pass `error_message` through. **`AbortError` returns `null`
  silently** — a user-initiated cancel is not an error and must not reach the
  banner.
- `onPreview` is passed only when `client` is non-null, so no-key and managed
  renders show no preview affordance at all.
- A `setting-description` line under the manage block states that previewing
  synthesizes a short clip against the user's own Soniox quota.

### Data flow

```
click ▶ on a ready clone
  → VoiceLibrarySection.togglePreview(id)      [existing: stop previous, bump token]
  → new AbortController; setPreviewLoadingId(id)
  → onPreview(id, signal)
  → SonioxVoiceSection.handlePreview
      → cache hit? return it
      → previewSampleFor(targetLanguage) → {text, language}
      → synthesizeOnce({apiKey, voice: id, text, language, speed: ttsSpeed, signal})
  → {audio, sampleRate} → component AudioContext → default output
```

### Changed: `extension/manifest.json`

`connect-src` gains `https://tts-rt.soniox.com`.

## Testing

| File | Coverage |
| --- | --- |
| `SonioxTtsRest.test.ts` (new) | URL / method / headers / every body field; `speed === 1.0` omitted from the wire; Int16→Float32 conversion including negative-value rounding; HTTP error → `SonioxVoicesError` shape; timeout; zero-byte body rejects |
| `sonioxPreviewSample.test.ts` (new) | All 28 seeded keys exist in `SonioxProviderConfig.LANGUAGES` (cross-assertion that fails loudly if the language list drifts); unknown language falls back to the `en` pair; returned `language` always equals the pair's own |
| `VoiceLibrarySection.test.tsx` (extend) | Spinner appears and clears; button disabled while busy; no button on `disabled: true` entries; switching rows aborts the prior request; unmount aborts; native path (implementation ignoring `signal`) unchanged |
| `SonioxVoiceSection.test.tsx` (extend) | Button present on ready clones, absent on processing / failed / placeholder; call carries the `targetLanguage` pair and `ttsSpeed`; second click on the same voice hits the cache with no second fetch; changing `targetLanguage` re-synthesizes; mapped error reaches the banner; `AbortError` leaves the banner empty |
| `manifest.consistency.test.ts` (extend) | `connect-src` contains `https://tts-rt.soniox.com` — the failure mode without it is Electron-works / extension-silently-fails, which local development will not surface |

## Known limitations

- The preview spends the user's own Soniox TTS tokens per synthesis (cached
  after the first play for a given voice/language/speed).
- Target languages outside the seeded 28 preview in English. The timbre is
  still representative — cloned voices are officially any-voice-any-language —
  but it is not literally what the session will speak.
- The cache is per component mount; collapsing and reopening the settings panel
  may re-synthesize.
- `speed` is honored, but no other session-time TTS parameter is; a preview is
  a timbre check, not a full session rehearsal.

## Future work

- Extend previewing to the 28 built-in voices. Needs a different affordance
  (the built-ins are `<option>`s inside a `<select>`) — most likely a single
  "preview the selected voice" button next to the dropdown.
- Managed (Kizuna) mode, once managed users can create clones (#372 Phase 2).
