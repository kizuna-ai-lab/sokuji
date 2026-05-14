# Volcengine AST 2.0 — Chinese↔English Bidirectional Mode

**Date**: 2026-05-14
**Status**: Approved, ready for implementation
**Tracking issue**: [#229](https://github.com/kizuna-ai-lab/sokuji/issues/229)

## Overview

Expose Doubao AST 2.0's Chinese↔English bidirectional mode (`source_language = target_language = "zhen"`) through the existing source/target language dropdowns. Picking the bidirectional entry on either side atomically syncs the other side to `zhen`, so both `volcengine_ast2` settings (Simple-mode `LanguageSection.tsx` and Advanced-mode `ProviderSpecificSettings.tsx`) always end up in a server-valid state.

When this mode is active and the user speaks Chinese, the server outputs English; when the user speaks English, it outputs Chinese — no further configuration required.

## Motivation

Reported by a classroom user (Youth Night School English learning group) running mixed Chinese/English conversations. The `VolcengineAST2Client` already forwards `sourceLanguage`/`targetLanguage` to the WebSocket `StartSession` request unchanged — the realtime path is already capable of running `zhen/zhen`. The gap is purely in the provider config and UI:

- `VolcengineAST2ProviderConfig.getSourceLanguages()` returns `BIDIRECTIONAL_LANGUAGES` (with `zhen`).
- `VolcengineAST2ProviderConfig.getTargetLanguages()` returns `LANGUAGES` (without `zhen`).
- Neither `LanguageSection.tsx` nor `ProviderSpecificSettings.tsx` coordinates the two sides, so a user who picks `zhen` on the source ends up with `zhen → en` — invalid per the server contract.

## Server contract (authoritative)

Per the [Doubao AST 2.0 API documentation](https://www.volcengine.com/docs/6561/1756902), both `source_language` and `target_language` accept the same set of values:

| value | language |
| ----- | -------- |
| `zh`  | Chinese |
| `en`  | English |
| `ja`  | Japanese |
| `id`  | Indonesian |
| `es`  | Spanish |
| `pt`  | Portuguese |
| `de`  | German |
| `fr`  | French |
| `zhen` | Chinese↔English bidirectional |

Two hard constraints quoted from the doc:

1. **Non-bidirectional mode**: one of `source_language` / `target_language` **must** be `zh` or `en`, otherwise the server returns an error.
2. **Bidirectional mode**: `source_language` **and** `target_language` **must both** be `zhen`. Any mixed combination involving `zhen` is invalid.

`zhen` is currently the only bidirectional value AST 2.0 supports.

## Non-Goals

- **Validation of constraint #1** (non-bidirectional mode requires `zh` or `en` on at least one side). This pre-existing UI gap also affects combinations like `ja → de` and `fr → es`. It is documented as a follow-up — out of scope for this change to keep the diff focused on the reported feature.
- **Generalised bidirectional architecture**. The doc lists exactly one bidirectional value (`zhen`); the design treats it as a single sentinel rather than introducing a generic "bidirectional pair" abstraction.
- **i18n of the `zhen` label**. The native name `中英双语 (zh↔en)` is already in the provider config and is readable across UI languages (mixed CJK + `zh↔en` symbol).
- **Default-value changes**. The provider continues to default to `sourceLanguage: 'zh'`, `targetLanguage: 'en'` — most users do not need bidirectional mode and the unidirectional defaults remain sensible.

## Design

### 1. Provider config (`src/services/providers/VolcengineAST2ProviderConfig.ts`)

Change `getTargetLanguages()` to return `BIDIRECTIONAL_LANGUAGES` instead of `LANGUAGES`. This is the only file-level change to the config layer; the `name` field on the `zhen` entry is already `'中英双语 (zh↔en)'`. `zhen` keeps its position at the end of the list (after the eight single-language entries) — no `optgroup` separator needed for nine entries.

### 2. Sync semantics (core behavior)

When the active provider is `VOLCENGINE_AST2`, source/target updates go through a wrapper that applies the four rules below. The wrapper writes both fields in a **single** `updateVolcengineAST2Settings({...})` call to avoid a transient `zhen / <other>` state that any Zustand subscriber could observe.

| # | User action | Pre-state (src / tgt) | Post-state (src / tgt) |
| - | ----------- | --------------------- | ---------------------- |
| R1 | Picks `zhen` on source | any / any | `zhen` / `zhen` |
| R2 | Picks `zhen` on target | any / any | `zhen` / `zhen` |
| R3 | Picks `X` (X ≠ `zhen`) on source | `zhen` / `zhen` | `X` / `en` |
| R4 | Picks `Y` (Y ≠ `zhen`) on target | `zhen` / `zhen` | `zh` / `Y` |

Reasoning for R3/R4: leaving the other side at `zhen` would produce a server-invalid state. Resetting to the provider's `defaults.sourceLanguage` (`zh`) and `defaults.targetLanguage` (`en`) is the least-surprising recovery and matches what a user picking these languages "from scratch" would get.

**Edge cases not handled here** (intentionally — server returns an error, consistent with current behavior for the same class of bug):

- R3 with `X = 'en'` produces `en / en`. R4 with `Y = 'zh'` produces `zh / zh`. Both are degenerate same-language combinations.
- Any combination where neither side is `zh` or `en` (e.g. `ja / de`) — covered by the non-goal above.

Switching `provider` away from `VOLCENGINE_AST2` requires no cleanup: each provider's settings live in its own store slice and are not cross-touched.

### 3. Simple-mode UI (`src/components/Settings/sections/LanguageSection.tsx`)

The two `<select>` elements render `providerConfig.languages` and `targetLanguages` directly; once §1 is applied they include `zhen` on both sides with no render changes needed.

The `Provider.VOLCENGINE_AST2` branch inside `updateSourceLanguage` and `updateTargetLanguage` is replaced with calls to a shared helper (e.g., `updateAST2LanguagesAtomic({ side: 'source' | 'target', value })`) that implements R1–R4 and issues exactly one store update. The helper is collocated with `LanguageSection.tsx` or pulled to a small utility — either is acceptable.

**Swap button**: currently disabled when `sourceLanguage === 'auto'`. Extend the condition to `=== 'auto' || === 'zhen'` (swapping `zhen / zhen` is a no-op).

**Warnings**: none added. No analogue to `showTranslateParticipantWarning` is needed for `zhen`.

### 4. Advanced-mode UI (`src/components/Settings/sections/ProviderSpecificSettings.tsx`)

`renderVolcengineAST2Settings()` contains two `<select>` elements (around lines 1459 and 1484) whose `onChange` currently writes a single field. Replace each `onChange` body with a call to the same helper used in §3 so the four rules apply identically in Advanced mode. The `getSourceLanguages()` / `getTargetLanguages()` reads pick up the §1 config change automatically — no render-level change.

There is no swap button in Advanced mode, so no additional UI control needs editing.

### 5. Analytics

Existing `language_changed` `trackEvent` calls continue to fire — but in R1/R2/R3/R4 the helper updates two fields. Emit **two** `language_changed` events (one for `source`, one for `target`) with the post-state value so analytics consumers see a coherent picture: e.g. picking `zhen` on the source fires `{to_language: 'zhen', language_type: 'source'}` followed by `{to_language: 'zhen', language_type: 'target'}`.

This adds noise (two events per user action when only one click happened) but matches the actual settings change. Alternative — emitting a single `bidirectional_mode_enabled` event — would require schema additions. Two events is cheaper.

### 6. Testing

**Unit (Vitest)**: a single test file covering the helper applies R1–R4 to a mocked store and asserts the post-state plus that `updateVolcengineAST2Settings` was called **exactly once** per user action.

| case | initial src / tgt | action | expected post-state |
| ---- | ----------------- | ------ | ------------------- |
| R1 | `zh / en` | source → `zhen` | `zhen / zhen` |
| R1' | `ja / zh` | source → `zhen` | `zhen / zhen` |
| R2 | `zh / en` | target → `zhen` | `zhen / zhen` |
| R3 | `zhen / zhen` | source → `ja` | `ja / en` |
| R3 same-lang | `zhen / zhen` | source → `en` | `en / en` (server will reject; UI does not block) |
| R4 | `zhen / zhen` | target → `fr` | `zh / fr` |
| R4 same-lang | `zhen / zhen` | target → `zh` | `zh / zh` (server will reject; UI does not block) |

**Manual**:

- Simple mode: source → `中英双语` ⇒ target auto-updates to `中英双语`; both stay synced.
- Simple mode: target → `中英双语` ⇒ source auto-updates to `中英双语`.
- Simple mode with `zhen / zhen`: change source to `ja` ⇒ resulting `ja / en`.
- Simple mode with `zhen / zhen`: change target to `fr` ⇒ resulting `zh / fr`.
- Simple mode with `zhen / zhen`: swap button is disabled (greyed).
- Repeat the four dropdown-sync checks above in Advanced mode (no swap button exists there, so the swap check is Simple-mode-only).
- Start a new session with `zhen / zhen` pre-selected, speak a Chinese sentence → English audio/text out; without reconnecting, speak an English sentence → Chinese audio/text out (the server switches direction within the same session).

## Files touched

- `src/services/providers/VolcengineAST2ProviderConfig.ts` — `getTargetLanguages()` returns `BIDIRECTIONAL_LANGUAGES`.
- `src/components/Settings/sections/LanguageSection.tsx` — replace `VOLCENGINE_AST2` source/target update branches with the helper; extend swap-button disabled condition.
- `src/components/Settings/sections/ProviderSpecificSettings.tsx` — replace both `onChange` bodies inside `renderVolcengineAST2Settings()` with the helper.
- New: a colocated test file for the helper (final location decided in implementation plan).

No store schema change, no i18n key change, no manifest/version change.
