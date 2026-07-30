# Soniox Advanced API Features — Design

**Date**: 2026-07-30
**Status**: Approved (brainstormed with user; API facts verified against official docs 2026-07-30)
**Tracking**: issue #342

## Summary

Expose three documented-but-unused Soniox real-time API features as Soniox provider settings: a custom vocabulary (STT `context.terms` + `context.translation_terms`), endpoint tuning (`endpoint_sensitivity` + `endpoint_latency_adjustment_level`), and TTS speaking rate (`speed`). A fourth #342 item, speaker diarization, is **not** productized in this round — it gets a throwaway live-API spike first (see "Diarization spike"); its product design is a follow-up decision driven by the spike data.

All three shipped features are additive and default-neutral: with default settings the wire config is byte-identical to today.

## Scope decisions

| #342 item | This round | Rationale |
|---|---|---|
| 1. `context` — terms + translation_terms | **Ship** | Only feature that improves translation quality (core product value); first in-app-editable glossary in Sokuji (AST2's is console-ID-based) |
| 2. `endpoint_sensitivity` / `endpoint_latency_adjustment_level` | **Ship** (user decision; assistant recommended deferring) | Advanced knobs, no demand signal yet, but landing cost is two controls on an existing hardcoded config site |
| 3. TTS `speed` | **Ship** | Cheapest certain win; slider component and locale keys already exist |
| 4. `enable_speaker_diarization` | **Spike only** | Real-time diarization has documented accuracy caveats and an adverse interaction with endpoint detection; speaker→side mapping is unsolved for our mixed mono stream |
| `context.general` / `context.text` | Out of scope | Vague value, doubles locale keys |

## Verified API facts (official docs, fetched 2026-07-30)

- **`context`** (https://soniox.com/docs/stt/concepts/context): `terms` is a string array; `translation_terms` is an array of `{source, target}` objects; `general` is `[{key, value}]`; `text` is a string. Whole context capped at ~8,000 tokens (~10,000 chars; wire error "Context is too long (max length 10000)"). Supported in the real-time WebSocket config, **not** v5-only. Billed as input text tokens ($4.00/1M real-time → ~$0.01 per connection at full cap; negligible). `translation_terms` guidance is advisory ("only valuable for translation, otherwise use terms") — not a hard gate.
- **Endpoint tuning** (https://soniox.com/docs/stt/rt/endpoint-detection + WS API reference): `endpoint_sensitivity` range -1.0..1.0, default 0.0 — higher = endpoints more likely (lower latency, more `<end>` events); lower = waits longer before finalizing. `endpoint_latency_adjustment_level` 0..3, default 0 — levels 1..3 progressively "lower latency than default", 3 = "most aggressive latency reduction". **Both are v5-only** (we use `stt-rt-v5`, fine). `max_endpoint_delay_ms` (we hardcode 500; official default 2000, range 500..3000) remains the hard cap and is not v5-gated; it stays hardcoded this round.
- **TTS `speed`** (https://soniox.com/docs/api-reference/tts/websocket-api): optional top-level field of the per-stream config, range **0.7..1.3**, default 1.0. Immutable within a stream; our streams are per-utterance so a new value naturally applies from the next stream.
- **Diarization** (https://soniox.com/docs/stt/concepts/speaker-diarization): `enable_speaker_diarization: true`; token `speaker` is a numeric **string** ("1", "2", …); up to 15 speakers; no extra billing (bundled). Can be combined with translation (official examples enable both). Documented caveats: real-time attribution errors are higher than async, speaker labels can flip temporarily before stabilizing, and **endpoint detection / manual finalization reduce diarization accuracy** — we hardcode aggressive endpointing (`max_endpoint_delay_ms: 500`).
- **Config immutability**: all STT parameters go in the single first-frame JSON config; the protocol has no mid-session reconfigure (client may only send audio frames, `finalize`, `keepalive`, or the empty closing frame). Therefore all new settings take effect at next session start; controls are disabled while a session is active (existing convention).

## Data model

`SonioxSettings` (`src/services/providers/SonioxProviderConfig.ts`) gains five fields, all with defaults, persisted automatically by the generic slice machinery; the `kizunaSoniox` managed twin inherits them via its existing `{...defaultSonioxSettings}` spread:

```ts
vocabularyTerms: string;                 // raw textarea text, one term per line, default ''
vocabularyTranslations: string;          // raw textarea text, one "source=target" per line, default ''
endpointSensitivity: number;             // -1.0..1.0, default 0
endpointLatencyAdjustmentLevel: number;  // 0 | 1 | 2 | 3, default 0
ttsSpeed: number;                        // 0.7..1.3, default 1.0
```

Raw strings (not parsed arrays) are stored so the textarea round-trips user formatting and the persistence layer keeps its all-scalar invariant.

### Parsing (in `buildSessionConfig`)

- **Terms**: split on newlines, trim, drop empties, dedupe.
- **Translations**: split on newlines; each line splits on the **first** `=`; keep only lines where both sides are non-empty after trim; lines without `=` are ignored.
- Numbers are clamped to their documented ranges (`endpointSensitivity` to [-1, 1], level to integer 0..3, `ttsSpeed` to [0.7, 1.3]) as defense against hand-edited storage.

`SonioxSessionConfig` (`src/services/interfaces/IClient.ts`) gains the structured, all-optional result:

```ts
context?: { terms?: string[]; translationTerms?: Array<{ source: string; target: string }> };
endpointSensitivity?: number;
endpointLatencyAdjustmentLevel?: number;
ttsSpeed?: number;
```

All-optional keeps the existing `BASE_CONFIG` fixtures in `SonioxClient.test.ts` / `SonioxClient.managed.test.ts` untouched.

## Wire changes

### STT (`SonioxSttStream`)

`SonioxSttConfig` gains `context?`, `endpointSensitivity?`, `endpointLatencyAdjustmentLevel?`. The first-frame config conditionally includes, **only when non-default**:

- `context: { terms?, translation_terms? }` — omitted entirely when both lists are empty; each sub-key omitted when its list is empty.
- `endpoint_sensitivity` — omitted when 0.
- `endpoint_latency_adjustment_level` — omitted when 0.

Non-default-only sending keeps existing users' wire traffic identical and leaves the field-by-field assertion in `SonioxSttStream.test.ts` unchanged (new cases assert presence when set, absence when default).

### TTS (`SonioxTtsStream`)

`SonioxTtsOptions` gains `speed?: number`; `openStream()` includes `speed` in the per-stream config only when ≠ 1.0. `SonioxClient.createTtsStream()` passes it from the session config — one site covers both the initial `connect()` and the `ensureTts()` reconnect path.

### Overflow guard

Both textareas get `maxLength={4000}` as a first-line cap on raw input, but that alone does not bound the WIRE size: many short `source=target` lines expand into `{source, target}` objects whose JSON scaffolding dominates (1,000 four-char lines ≈ 26 KB serialized). `buildSessionConfig` therefore budgets the wire-shaped serialization to 9,000 chars (headroom under Soniox's 10,000-char limit) and drops entries from the tail — translation pairs first, then terms, earlier lines win — logging a console warning, so a session always starts and the "Context is too long" error stays unreachable.

## Settings UI (`renderSonioxSettings` in `ProviderSpecificSettings.tsx`)

All controls follow existing conventions (numeric → slider with live value, small enum → select, help → `Tooltip` + `CircleHelp`) and are `disabled={isSessionActive}`. Section order after the existing generic voice dropdown:

1. **TTS speed** — reuse `TtsSpeedControl` (`LocalSettingsControls.tsx`), adding optional `min`/`max`/`step` props (defaults 0.5/2.0/0.1 preserve the two local-provider call sites); Soniox passes 0.7/1.3/0.1. Reuses the existing `settings.ttsSpeed` locale keys — zero new translations for this control.
2. **Custom Vocabulary** section — two textareas: *Terms* (one per line) and *Preferred Translations* (one `source=target` per line), each with a label, per-line format hint, and tooltip. The translations tooltip notes that entries are directional (in `two_way`, add a reverse line if both directions need forcing).
3. **Endpoint tuning** — `endpointSensitivity` slider (-1.0..1.0, step 0.1, live value) and `endpointLatencyAdjustmentLevel` select with four options (0 = Default, 1/2/3 = progressively lower latency), following the OpenAI semantic-eagerness select precedent.
4. Existing `bothModeSharedSession` pill (unchanged).

**Managed (Kizuna Soniox)**: all five settings stay editable (unlike `bothModeSharedSession`, which is forced for managed); `updateActiveSonioxSettings` already routes writes to the correct slice.

## i18n

17 new keys (vocabulary section title + tooltip, two labels + two placeholders + two tooltips, endpoint section title, sensitivity label + tooltip, latency-level label + tooltip + four option labels) × 30 locales. `locales.consistency.test.ts` enforces lockstep; runtime is safe on missing translations (`fallbackLng: 'en'`). Per the #339 convention: machine-translate all locales, then a native-quality pass for de/ja/zh_CN/zh_TW.

## Testing

- **Stream layer**: `SonioxSttStream.test.ts` — config frame includes `context` / `endpoint_sensitivity` / `endpoint_latency_adjustment_level` when set, omits them at defaults. `SonioxTtsStream` test — `speed` present in stream config iff ≠ 1.0.
- **Parsing**: unit tests for the line parsers — empty lines, whitespace, missing `=`, multiple `=` (first wins), duplicate terms, clamping of out-of-range numbers.
- **`buildSessionConfig`**: raw setting strings → structured session config.
- **UI wiring**: mutation-verified wiring tests for the new fields through `updateActiveSonioxSettings` (the #339 lesson: per-provider switches with no `default` fail silently; only real write-path tests catch them).
- Full suite green locally (CI does not run tests).

## Diarization spike (separate from the PR; no product code)

A throwaway Python script (job tmp, following the earlier `soniox_diar_exp.py` approach) against the live API:

- **Material**: regenerate two-voice test WAVs with Soniox TTS — sequential dialogue, overlapping speech, and the key new case: **both speakers using the same language** (where the current language-based `utteranceSide` inference structurally fails and misattributes the participant as the speaker).
- **Matrix**: `enable_speaker_diarization: true` × {production config: endpoint detection on, `max_endpoint_delay_ms: 500`} vs {endpoint detection off} — quantifies the documented "endpointing reduces diarization accuracy" interaction.
- **Metrics**: mid-utterance speaker-label flip rate; cross-utterance consistency of label↔voice mapping; same-language attribution accuracy vs the current language-based method (which scores 0 by construction there).
- **Prerequisite**: a user-provided Soniox API key (the previous one was shredded after use).
- **Output**: a findings report; the diarization product design (speaker→side mapping, multi-speaker UI, whether to relax endpointing during diarization) is decided afterwards on that data.

## Delivery

Items 1–3 land as **one branch / one PR** (they share every touchpoint: `SonioxSettings`, `SonioxSessionConfig`, `buildSessionConfig`, `renderSonioxSettings`, 30 locale files; splitting would triple the locale churn). The spike runs independently and does not block the PR.

## Known limitations

- All settings are connect-time only (protocol has no mid-session reconfigure); changes apply from the next session.
- `translation_terms` entries are directional; `two_way` users must add explicit reverse entries.
- `max_endpoint_delay_ms` stays hardcoded at 500 this round; if endpoint tuning proves insufficient, exposing it is a one-line follow-up on the same config site.
