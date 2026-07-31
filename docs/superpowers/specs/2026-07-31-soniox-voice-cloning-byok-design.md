# Soniox Voice Cloning (Phase 1: BYOK) — Design

**Date**: 2026-07-31
**Status**: Approved (brainstormed with user; API facts live-probed 2026-07-31)
**Tracking**: follow-up to issue #342 (API-surface audit, item B4)

## Summary

Let BYOK Soniox users clone their own voice from a short reference clip and
speak translations with it. The voice-selection UI moves from the static
28-entry dropdown to a `VoiceLibrarySection`-based adapter (built-in group +
cloned group) with record/upload, readiness states, and delete. Cloned voices
live at Soniox (`/v1/voices`, project-scoped) — the client stores only the
selected voice id, which the existing TTS pipeline already passes through
verbatim. The Kizuna-managed twin renders the same section read-only
(built-ins only) in this phase; the managed dynamic-slot design is recorded
under Future work.

## Verified facts (live probes + docs + SDKs, 2026-07-31)

- `/v1/voices` CRUD: create is `multipart/form-data` with exactly `name`
  (unique per project, 1-128 chars) + `file` (reference clip, ≤20 s, ≤10 MB);
  no metadata/owner/reference fields exist. List has only `limit`/`cursor` —
  no filters. No rename API. `DELETE` returns 204.
- End-to-end proven on a real BYOK key: create from a 4 s clip →
  `models[{model: 'tts-rt-v1', status}]` reached `ready` in ~10 s → TTS
  synthesis with `voice=<uuid>` works over REST with the permanent key AND
  over WebSocket with a `tts_rt` temporary key. Test voice deleted (204).
- Temporary keys cannot touch `/v1/voices` (live-probed 401); `usage_type`
  enumerates only `transcribe_websocket` | `tts_rt` (server 400 + both
  official SDKs' literal types). Voice MANAGEMENT therefore requires the
  permanent key — which BYOK clients already hold (same key the existing
  validate probe sends to `api.soniox.com`; the extension CSP already allows
  that host).
- **Quota: 20 voices per ORGANIZATION, counted across all projects** (docs
  verbatim). Fine for BYOK (per-user org); the structural ceiling for the
  managed twin — hence phasing.
- Status lifecycle: `not_computed | processing | ready | failed`;
  `voice_failed` is **terminal despite its 503 status** (recreate, don't
  retry); `voice_not_prepared` (409) is the new-model case cured by
  `POST /v1/voices/{id}/recompute`.
- Cloning/storage pricing is undocumented (pricing page has zero voice
  mentions); TTS token pricing does not distinguish voice types.
- Wire: `SonioxTtsStream.openStream` sends `voice` as an opaque string — a
  UUID passes through the whole `settings.voice → buildSessionConfig →
  createTtsStream → wire` chain untouched (code-audited + live-proven).

## Decisions

| Decision | Choice |
|---|---|
| Phase scope | BYOK only. Managed twin: read-only built-ins this phase (creation affordances hidden), same component so Phase 2 only swaps the data source |
| UI | `hasVoiceSettings` → `false` for Soniox (and twin); new `SonioxVoiceSection` embedded in `renderSonioxSettings`, wrapping `VoiceLibrarySection` in `dropdown` presentation: `builtin` group = the 28 static voices, `custom` group = voices fetched from `/v1/voices` |
| Source of truth | Soniox. The list is fetched on section mount (+ manual refresh); nothing but the selected id (`settings.voice`) is persisted locally. No local reference-clip storage |
| Create flow | Record (VoiceLibrarySection's built-in ≤20 s recorder) or upload (`audio/*`, client-side decode validates 3–20 s / ≤10 MB via the `validateVoiceClip` pattern) → consent checkbox ("I confirm I have the right to use this voice") gates the submit → encode WAV → `POST /v1/voices` → poll `GET /v1/voices/{id}` until `ready`/`failed` → auto-select on ready |
| Failure states | `failed` voices render with an error badge and only a delete affordance (terminal per docs). Quota/4xx on create → explicit "organization voice limit reached — delete one and retry" message. A selected UUID missing from the fetched list renders a "(deleted voice)" placeholder and prompts re-selection; the stored setting is never auto-rewritten |
| Not doing | Rename (no API; no local aliases — YAGNI), recompute UI (single-model era; noted for when a new TTS model ships), managed-side CRUD |
| Naming | User-entered display name used as the Soniox `name` verbatim (BYOK org is private to the user); `voice_name_conflict` (409) surfaces as "a voice with this name already exists" |
| Consent | Lightweight checkbox in the create flow (ethics precedent: OmniVoice's license-consent gate); unchecked = create disabled |

## Architecture

- **`SonioxVoicesClient`** (`src/services/clients/SonioxVoicesClient.ts`) —
  protocol piece beside the STT/TTS streams: `list()`, `create(name, blob)`,
  `delete(id)`, `waitUntilReady(id, {timeoutMs})` against
  `https://api.soniox.com/v1/voices` with the BYOK key; WAV encoding helper
  for `Float32Array` recordings (`encodeWavPcm16`). Errors surface
  `error_type` (`voice_name_conflict`, `limit_exceeded`, `voice_failed`…).
- **`SonioxVoiceSection`** (`src/components/Settings/sections/`) — adapter
  mapping built-ins + fetched clones to `VoiceEntry[]`, wiring
  `onSelect → updateActiveSonioxSettings({ voice })`, `onRecord`/`onImport`
  (consent-gated) → create+poll, `onDelete`; readiness/failed/deleted-
  placeholder presentation; read-only under the managed twin
  (`isKizunaManagedProvider`).
- `SonioxProviderConfig.getConfig()`: `hasVoiceSettings: false` (twin
  inherits); the static `VOICES` table stays as the built-in group's data.
- No session-config or wire changes — `voice` is already an opaque string
  end to end.

## Testing

- `SonioxVoicesClient` unit tests with mocked `fetch`: list/create/delete
  request shapes (multipart fields, auth header), error_type mapping,
  `waitUntilReady` polling until ready/failed/timeout, WAV encoder output
  (RIFF header + sample round-trip).
- `SonioxVoiceSection` wiring tests (real store, mocked client module):
  select writes the slice; built-ins render without fetch; clones render
  after fetch; consent checkbox gates create; failed badge; deleted-voice
  placeholder; managed twin hides create/delete affordances.
- Existing suites: descriptor/registry untouched semantics (voices table
  remains), `renderVoiceSettings` no longer renders for Soniox (assert
  absence), TTS pipeline tests unchanged.
- Live smoke (manual): record → ready → hear own voice in a session; quota
  and conflict paths against the real API.

## Known limitations

- Cloned-voice multilinguality is assumed (built-ins are officially
  any-voice-any-language; our probe synthesized zh from a zh reference) —
  manual smoke should try a cloned voice speaking the other direction.
- Cloning/storage billing is undocumented — the UI makes no cost claims.
- Deleting a voice at Soniox while it is selected surfaces only at the next
  session (TTS `voice_not_found`) plus the placeholder in settings.

## Future work (Phase 2 — managed dynamic slots; user-approved direction)

Backend-mediated cloning for the Kizuna twin under the 20-voice org quota:
apply to Soniox for a quota raise (expect modest); store each user's
REFERENCE CLIP backend-side; **create the Soniox voice dynamically at
session start, delete it after the session ends plus a grace window** — so
slots track concurrent (not registered) users; when the pool is exhausted at
start, prompt the user and fall back to a built-in voice; paid persistent
seats later. Frontend reuses `SonioxVoiceSection` with a backend data source
(`/soniox/voices` endpoints); isolation = backend DB ownership + name
namespace (`u_<accountId>_…`) + never listing others' UUIDs (no voice-level
ACL exists at Soniox — any `tts_rt` temp key can use any project UUID).
