# Volcengine Doubao AST 2.0 — Custom Vocabulary (自学习平台) Library Reference

**Status:** Design approved (2026-04-19)
**Scope:** Provider `volcengine_ast2` only. Volcengine ST is out of scope.

## Summary

Expose Volcengine Doubao AST 2.0's three 自学习平台 (self-learning) library types —
**热词 (hot words)**, **替换词 (replacement)**, and **术语词 (glossary/terminology)** —
as three optional library-ID inputs in the AST 2.0 provider settings. The IDs are
passed through verbatim to the server at session start via the existing proto
`Corpus` message carried on `ReqParams.corpus`.

Users create and manage the library contents in the Volcengine console
(自学习平台 → 热词管理 / 替换词 / 术语词); sokuji only stores the library IDs
and references them per session.

## Non-goals

- No inline entries. `glossary_list: map<string, string>`, `hot_words_list`,
  `correct_words`, and the `context` JSON blob are **not** populated.
- No client-side ID validation, format sniffing, or management-API probes.
  The server is the source of truth; invalid IDs surface as session-start
  errors via the existing error channel.
- No library browser / picker UI. Three plain text inputs.
- No library-name inputs (`*_table_name`). IDs are unambiguous; names would
  be redundant.
- No regex-correction field (`regex_correct_table_id`). Skipped for YAGNI;
  trivially additive later if needed.
- No corresponding feature for Volcengine ST (separate provider, separate
  WebSocket protocol, separate hot-word shape — ST already has
  `HotWordList: Array<{Word, Scale}>` wired client-side but unused; that is a
  separate spec.)

## Terminology → proto field mapping

The mapping below drives every layer of the implementation. Proto source of
truth: `src/services/clients/volcengine-ast2/protos/products/understanding/base/au_base.proto`
lines 179–200 (`message Corpus`).

| Volcengine console tab | Purpose | Proto field | Tag | Format of library contents |
|---|---|---|---|---|
| 热词 (hot words) | ASR recognition bias — boost likelihood of specific terms being transcribed correctly | `boosting_table_id` | 2 | TXT |
| 替换词 (replacement) | Post-transcription text substitution (standard replacement list) | `correct_table_id` | 6 | TXT |
| 术语词 (glossary) | Translation enforcement — source→target bilingual term pairs | `glossary_table_id` | 14 | JSON |

All three are `string` proto fields; empty string = "not set".

**Confidence note:** Proto field names come directly from Volcengine's
published `.proto` definitions and follow their standard naming. The
tab→field mapping is consistent with Volcengine's documented library types
but was not end-to-end confirmed against a rendered docs page (docs site is
a JS SPA that neither `curl` nor `WebFetch` could fully render). Any
mismatch surfaces as a server error at `StartSession`. See Open Questions.

## Data model

### 1. Settings store — `src/stores/settingsStore.ts`

Extend `VolcengineAST2Settings` (currently at line 116):

```ts
export interface VolcengineAST2Settings {
  appId: string;
  accessToken: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Auto' | 'Push-to-Talk';
  hotWordTableId: string;      // NEW — boosting_table_id; '' = disabled
  replacementTableId: string;  // NEW — correct_table_id;   '' = disabled
  glossaryTableId: string;     // NEW — glossary_table_id;  '' = disabled
}
```

Defaults (`defaultVolcengineAST2Settings`, currently at line 280):
all three new fields default to `''`.

Persistence requires no new code: the generic per-key flow at
`settingsStore.ts:871–879` (`updateVolcengineAST2`) already persists every
field under `settings.volcengineAST2.<key>`. The `loadSettings` path at
`settingsStore.ts:1245` uses `defaultVolcengineAST2Settings` as the second
argument to `loadProviderSettings`, which fills in missing keys — so users
upgrading with existing persisted settings get `''` for the new fields
automatically (no migration step).

### 2. Session config — `src/services/interfaces/IClient.ts`

Extend `VolcengineAST2SessionConfig` (currently at line 112):

```ts
export interface VolcengineAST2SessionConfig extends BaseSessionConfig {
  provider: 'volcengine_ast2';
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode?: 'Auto' | 'Push-to-Talk';
  hotWordTableId?: string;     // NEW
  replacementTableId?: string; // NEW
  glossaryTableId?: string;    // NEW
}
```

Optional (`?`) because callers that don't care about vocab shouldn't have
to think about these fields.

### 3. Session config builder — `src/stores/settingsStore.ts`

`createVolcengineAST2SessionConfig` (currently at line 490) passes each ID
only when non-empty after trimming:

```ts
function createVolcengineAST2SessionConfig(
  settings: VolcengineAST2Settings,
  systemInstructions: string
): VolcengineAST2SessionConfig {
  const hotWordTableId = settings.hotWordTableId?.trim() || undefined;
  const replacementTableId = settings.replacementTableId?.trim() || undefined;
  const glossaryTableId = settings.glossaryTableId?.trim() || undefined;

  return {
    provider: 'volcengine_ast2',
    model: 'ast-v2-s2s',
    instructions: systemInstructions,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    turnDetectionMode: settings.turnDetectionMode,
    hotWordTableId,
    replacementTableId,
    glossaryTableId,
  };
}
```

Trimming happens once here. Storage stays as the user typed (avoid surprise
on edit). An all-whitespace input is treated as "not set".

### 4. Client — `src/services/clients/VolcengineAST2Client.ts`

Inside `sendStartSession` (currently at line 311), build a `corpus` object
once from the trimmed IDs and attach it only if at least one is set:

```ts
const corpus: Record<string, string> = {};
const hotId = this.currentConfig.hotWordTableId?.trim();
const replaceId = this.currentConfig.replacementTableId?.trim();
const glossaryId = this.currentConfig.glossaryTableId?.trim();
if (hotId) corpus.boosting_table_id = hotId;
if (replaceId) corpus.correct_table_id = replaceId;
if (glossaryId) corpus.glossary_table_id = glossaryId;
if (Object.keys(corpus).length > 0) {
  requestPayload.request.corpus = corpus;
}
```

Two behaviors this enforces:

1. **All-empty case is indistinguishable from today's payload** — no
   `corpus` key is added, so the wire format is byte-identical for users who
   don't use the feature. Server sees no change.
2. **Any subset works** — user can set only 1 of 3, only 2 of 3, or all 3;
   each field is independent.

The encoded protobuf already knows `ReqParams.corpus` and every field in
the `Corpus` message (see `ast2-proto.d.ts` / `.js`), so no proto regen.

**Logging:** Extend the `start_session.sent` realtime-event payload (same
block, around line 358) to include `corpus: { hotWordTableId, replacementTableId, glossaryTableId }`
with the same non-empty-only rule, so the logs panel shows which libraries
were actually referenced.

## UI

### Placement

Inside `renderVolcengineAST2Settings` in
`src/components/Settings/sections/ProviderSpecificSettings.tsx` (currently
at line 1177), insert one new `settings-section` block between the existing
"Turn Detection" section and the "Doubao AST 2.0 Info" section (i.e.
between current lines 1269 and 1271).

### Layout

One section titled "Custom Vocabulary (自学习平台)" containing three
`setting-item` rows — one per library type — each with a label and a text
input. A short info notice at the bottom of the section links to the
Volcengine console.

```
┌─ Custom Vocabulary (自学习平台) ──────────────────┐
│                                                   │
│  Hot Words Library ID                             │
│  [                                             ]  │
│                                                   │
│  Replacement Library ID                           │
│  [                                             ]  │
│                                                   │
│  Glossary Library ID                              │
│  [                                             ]  │
│                                                   │
│  ⓘ Leave any field empty to disable. Manage       │
│    libraries in the Volcengine console.           │
│    [Open Volcengine console ↗]                    │
└───────────────────────────────────────────────────┘
```

### Behavior

- Each input is a plain `<input type="text">` bound to the corresponding
  settings field. `onChange` calls
  `updateVolcengineAST2Settings({ [key]: e.target.value })` directly — the
  existing generic `handleProviderSettingChange` at
  `ProviderSpecificSettings.tsx:221–225` also works but the direct call
  matches the per-section pattern already used in this file.
- `disabled={isSessionActive}` on each input, matching the pattern of every
  other AST2 input in the same file (mid-session mutation is not
  supported — changing vocab requires reconnection, same as source/target
  language).
- The console link target: `https://console.volcengine.com/speech/app`
  (confirm exact deep-link to 自学习平台 during implementation; the generic
  `/speech/app` URL is a safe fallback).
- No real-time validation, no loading states, no badges. Empty is valid;
  non-empty is passed through.

### i18n

New keys in `src/locales/*/translation.json`. English defaults inlined at
the `t()` call sites (existing pattern in this file — see
`settings.volcengineAST2Info` at line 1272):

| Key | English default |
|---|---|
| `settings.volcengineAST2CustomVocabulary` | `Custom Vocabulary (自学习平台)` |
| `settings.volcengineAST2HotWordLibraryId` | `Hot Words Library ID` |
| `settings.volcengineAST2ReplacementLibraryId` | `Replacement Library ID` |
| `settings.volcengineAST2GlossaryLibraryId` | `Glossary Library ID` |
| `settings.volcengineAST2CustomVocabularyHint` | `Leave any field empty to disable. Manage libraries in the Volcengine console.` |
| `settings.volcengineAST2OpenConsole` | `Open Volcengine console` |

Only English defaults ship in the first pass; `i18next` fallback handles
the 35+ other locales until someone translates them. This matches how
existing AST2 strings (`volcengineAST2Info`, `volcengineAST2InfoText`,
`volcengineAST2TurnDetectionTooltip`) are handled in the file.

### Styling

Reuses existing classes — `settings-section`, `setting-item`,
`setting-label`, `text-input` (or the existing bare `<input>` convention
used in this file — check the App / Access Token inputs for the AST2
credentials panel and match that). No new SCSS.

## Error handling

- **All three empty / whitespace-only** → `corpus` is omitted entirely.
  Request is byte-identical to today's. No change in server behavior.
- **Subset set** → only the non-empty fields are present in `corpus`.
  Empty ones are absent (not sent as empty strings).
- **Invalid ID** (nonexistent library, wrong-appid library, wrong-language
  library) → Volcengine returns an error response at `StartSession`. The
  existing `handleMessage` path in `VolcengineAST2Client` surfaces the
  error as a conversation error item and as a realtime log event. No new
  error handling code is added; existing paths are sufficient because the
  failure mode is "session never starts" — same shape as an invalid app key.
- **Whitespace handling** — `.trim()` is applied exactly once, at session
  config build time. The stored value is what the user typed.

## Testing

### Unit

- `createVolcengineAST2SessionConfig` in `settingsStore.test.ts`
  (or new file `settingsStore.volcengineAST2.test.ts` if a test for this
  function doesn't exist today):
  - all three IDs empty → all three config fields are `undefined`
  - one ID set, two empty → only that one is a defined string
  - all three set with leading/trailing whitespace → all three are trimmed
  - all three set to pure whitespace → all three are `undefined`

- `VolcengineAST2Client.sendStartSession` in a new
  `VolcengineAST2Client.test.ts` (pattern: mock `this.websocket.send`,
  capture the `Uint8Array`, decode with `TranslateRequest.decode`):
  - no IDs → decoded request has no `request.corpus`
  - all three IDs → decoded request has `request.corpus` with
    `boosting_table_id`, `correct_table_id`, `glossary_table_id` set to
    the exact values passed
  - only glossary ID → decoded request has `request.corpus` with only
    `glossary_table_id`; other fields are empty-string defaults (protobuf
    3 default for unset `string`)

Existing tests for Volcengine AST2 are minimal; if a client test file
doesn't exist, creating one is acceptable scope.

### Manual

- With real Volcengine credentials and a real terminology library:
  create a term like `Sokuji → そくじ` in the console, start a session
  referencing the library ID, speak the source term, confirm the
  translation uses the mapped target. Repeat for hot words (improved
  recognition of a proper noun) and replacement (post-transcription
  substitution).
- With a bogus ID: confirm the session fails at start with a clear error
  in the logs panel and an error conversation item.
- With mixed (one real, two bogus): confirm per-field error behavior.

### Regression

- With all three fields empty: confirm session behavior is unchanged from
  the current release (byte-identical `StartSession` payload).

## Rollout

Single PR. No feature flag. Backward-compatible because:
- New settings fields default to `''` and are purely additive.
- Session config fields are optional.
- Client behavior when all fields empty is byte-identical to current.

## Open Questions

1. **Field-name mapping** for 热词→`boosting_table_id` and
   替换词→`correct_table_id` needs end-to-end confirmation during
   implementation. Verification plan: create one library of each type in
   the Volcengine console, reference each by ID in a session, and confirm
   the server either accepts the referenced library or returns a specific
   error naming the field. If either mapping is wrong, adjust the three
   lines in `sendStartSession` accordingly; no other code changes needed.
2. **Console deep-link URL** — `https://console.volcengine.com/speech/app`
   is a safe landing page, but a direct link to 自学习平台 would be better.
   Locate during implementation by logging into the console.
3. **Empty-string vs. absent semantics on the wire** — the design above
   sends the field absent when empty. If Volcengine actually requires an
   empty string for "disable previous value" (unusual but possible), a
   later follow-up can switch to `corpus.boosting_table_id = hotId || ''`.
   No evidence this is needed today; start with "absent when empty".
