# Soniox Voice Catalog Expansion + Session Background (context.text) — Design

**Date**: 2026-07-31
**Status**: Approved (brainstormed with user; SDK/docs facts verified 2026-07-31)
**Tracking**: follow-up to issue #342 (API-surface audit)

## Summary

Two additive Soniox provider changes: (1) expand the built-in TTS voice list
from the original 12 to the current official 28, and (2) expose the STT
`context.text` field as an optional "Session Background" free-text setting,
folded into the existing serialized-context budget with text as the first
thing trimmed. Explicitly **not** included, with reasons on record:
`language_hints_strict` (live-probed: zero measurable delta over the hints we
already send — four accent/ambiguity materials behaved byte-identically with
and without it) and `context.general` (free-form `{key, value}` pairs per
both official SDKs — no enum or schema; user chose `text` as the single
context extension).

## Verified facts (2026-07-31)

- Official voice catalog (https://soniox.com/docs/tts/voices): 28 voices —
  the original 12 (Adrian, Claire, Daniel, Emma, Grace, Jack, Kenji, Maya,
  Mina, Nina, Noah, Owen) all still listed, plus 16 accented ones in four
  groups of four: Spanish (Rafael, Mateo, Lucia, Sofia), British (Oliver,
  Arthur, Isla, Victoria), Australian (Cooper, Mason, Ruby, Elise), Indian
  (Arjun, Rohan, Priya, Meera). Any voice works with any language.
- No test or code depends on the voice count or the exact set (audited);
  `defaultSonioxSettings.voice = 'Maya'` unaffected; the Kizuna managed twin
  inherits `voices` via `super.getConfig()`.
- `context.text` is a single free-form string (docs + both official SDKs:
  `@soniox/client` 2.2.0 `TranscriptionContext.text?: string`, Python
  `soniox` 2.8.0 `StructuredContext.text: str | None`). Documented influence
  ranks below `general`/`terms`. The whole `context` object shares one
  ~8,000-token (~10,000-char) limit.

## Decisions

| Decision | Choice |
|---|---|
| Voice list | Static table 12 → 28; update the two stale "12 voices" comments; no dynamic fetching (single-model era, YAGNI) |
| context.text setting | `contextText: string` (default `''`) on `SonioxSettings`; own settings section "Session Background" with one textarea; disabled while a session is active; editable on the managed twin |
| Wire | `context.text` sent only when non-empty after trim (default-neutral: existing users' wire unchanged) |
| Length policy | Textarea `maxLength={4000}` (consistent with the two vocabulary textareas). The serialized-context budget guard (`fitContextToBudget`, 9,000 chars over the wire shape) now includes `text`, and trims in this order: **truncate `text` first** (character-level, weakest evidence), then drop `translation_terms` from the tail, then `terms` from the tail; console.warn on any trim. A session always starts; vocabulary survives preferentially |
| i18n | ~4 new keys (section title, tooltip, placeholder — plus label if the markup needs one) × 30 locales; #339 convention (machine translate + native pass for de/ja/zh_CN/zh_TW) |
| Not doing | `language_hints_strict` (probe: no delta vs existing hints); `context.general` (user decision; free-form pairs add nothing over `text` for our UX) |

## Architecture

- `SonioxProviderConfig`: `contextText` field + default; `buildSessionConfig`
  passes the trimmed text through `fitContextToBudget` (now
  `(terms, translationTerms, text)`) and emits
  `context: { terms?, translationTerms?, text? }` — the whole `context` key
  still omitted when all three are empty.
- `SonioxSessionConfig.context` gains `text?: string`.
- `SonioxSttStream`'s wire-shaped `context` type gains `text?: string`;
  `SonioxClient` maps it through alongside the camel→snake term mapping
  (text needs no rename).
- UI: new section after Custom Vocabulary, same textarea pattern
  (`system-instructions` class, aria-label, maxLength, `disabled={isSessionActive}`),
  writes via `updateActiveSonioxSettings`.

## Testing

- Voices: `getConfig().voices` has 28 unique entries and still contains the
  original 12 (guards accidental deletion).
- Budget guard: text-first truncation (oversized text truncated, vocab
  untouched); combined overflow (all three large → text truncated, then
  translations tail-dropped); under-budget untouched; whitespace-only text →
  no `context.text` key.
- Wire: `context.text` present when set, absent otherwise (existing
  presence/omission pattern).
- `buildSessionConfig` mapping and legacy-slice (missing field) tolerance.
- UI wiring: mutation-verified store write + maxLength attribute + managed
  twin routing (existing harness).

## Known limitations

- Trimming the background text is silent apart from a console warning —
  acceptable: the session must always start, and `text` is the least
  load-bearing context field.
- Like all Soniox settings, applies from the next session (connect-time
  config).
