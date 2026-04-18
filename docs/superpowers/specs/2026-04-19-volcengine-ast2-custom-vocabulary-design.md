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
- No plain-correction field (`correct_table_id`, proto tag 6). The
  AST 2.0 API docs only reference `regex_correct_table_id` under the
  自学习平台 → 替换词 concept, so that's what we use. `correct_table_id`
  exists in the proto but isn't documented for this endpoint.
- No corresponding feature for Volcengine ST (separate provider, separate
  WebSocket protocol, separate hot-word shape — ST already has
  `HotWordList: Array<{Word, Scale}>` wired client-side but unused; that is a
  separate spec.)

## Terminology → proto field mapping

The mapping below drives every layer of the implementation. Proto source of
truth: `src/services/clients/volcengine-ast2/protos/products/understanding/base/au_base.proto`
lines 179–200 (`message Corpus`).

| Volcengine console tab | Purpose | AST 2.0 API field | Proto tag |
|---|---|---|---|
| 热词 (hot words) | ASR recognition bias — boost likelihood of specific terms being transcribed correctly | `boosting_table_id` | 2 |
| 替换词 (replacement) | Post-transcription text substitution (regex replacement list) | `regex_correct_table_id` | 12 |
| 术语词 (glossary) | Translation enforcement — source→target bilingual term pairs | `glossary_table_id` | 14 |

All three are `string` proto fields; empty string = "not set".

**Source:** Confirmed end-to-end against the AST 2.0 API spec at
<https://www.volcengine.com/docs/6561/1756902> (rendered via Playwright —
the page is a JS SPA that `curl` / `WebFetch` can't fully load). The
doc's `corpus` sample payload uses exactly these three field names for
the table-reference variants. Note the proto file has both
`correct_table_id` (tag 6) and `regex_correct_table_id` (tag 12) as
separate fields; only the latter is documented for AST 2.0, so that's
what we send.

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
  hotWordTableId: string;      // NEW — boosting_table_id;     '' = disabled
  replacementTableId: string;  // NEW — regex_correct_table_id; '' = disabled
  glossaryTableId: string;     // NEW — glossary_table_id;      '' = disabled
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
if (hotId) corpus.boostingTableId = hotId;
if (replaceId) corpus.regexCorrectTableId = replaceId;
if (glossaryId) corpus.glossaryTableId = glossaryId;
if (Object.keys(corpus).length > 0) {
  requestPayload.request.corpus = corpus;
}
```

Property names are **camelCase** because protobuf.js encodes from the
generated binding's JS property names (see `ast2-proto.d.ts`: `boostingTableId`,
`regexCorrectTableId`, `glossaryTableId`). The snake_case names in the
Volcengine API doc are the on-wire JSON form; protobuf.js performs the
conversion during encoding.

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
`setting-item` rows — one per library type. Each row has:

- A **label** consisting of the field title, an inline `ⓘ` help icon
  (hover tooltip explaining what the library does), and a "Manage ↗" link
  to that library's specific console page.
- A **text input** on the next line bound to the corresponding settings
  field.

The three library types live on separate pages in the Volcengine console,
so each row needs its own console link — a single shared link at the
bottom would be wrong.

```
┌─ Custom Vocabulary (自学习平台) ──────────────────┐
│                                                   │
│  Hot Words Library ID  ⓘ     [Manage hot words ↗] │
│  [                                             ]  │
│                                                   │
│  Replacement Library ID  ⓘ  [Manage replacement ↗]│
│  [                                             ]  │
│                                                   │
│  Glossary Library ID  ⓘ      [Manage glossary ↗]  │
│  [                                             ]  │
│                                                   │
│  Leave any field empty to disable it.             │
└───────────────────────────────────────────────────┘
```

The `ⓘ` icon follows the existing pattern in this file (see the
"Automatic Turn Detection" section at `ProviderSpecificSettings.tsx:1242–1250`):
a `<CircleHelp size={14}>` from `lucide-react` wrapped in `<Tooltip
content={...} position="top">`. Hover contents per field:

- **Hot Words** — "Boost recognition of specific terms."
- **Replacement** — "Post-transcription text substitution."
- **Glossary** — "Source→target bilingual term pairs."

Per-field console URLs (placeholders — exact deep-links to be confirmed
during implementation by logging into the console and copying the address
bar URL; fall back to `https://console.volcengine.com/speech/app` for any
that can't be deep-linked):

- **Hot Words** (热词 / 热词管理) — console path under 自学习平台 → 热词管理
- **Replacement** (替换词) — console path under 自学习平台 → 替换词
- **Glossary** (术语词) — console path under 自学习平台 → 术语词

All three links open in a new tab (`target="_blank" rel="noopener noreferrer"`).

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
- Each row has its own "Manage ↗" link to the corresponding console page
  (three distinct URLs — see the Layout section above for the per-type
  mapping). Exact URLs confirmed during implementation.
- No real-time validation, no loading states, no badges. Empty is valid;
  non-empty is passed through.

### i18n

New keys in `src/locales/*/translation.json`. English defaults inlined at
the `t()` call sites (existing pattern in this file — see
`settings.volcengineAST2Info` at line 1272):

| Key | English default |
| --- | --- |
| `settings.volcengineAST2CustomVocabulary` | `Custom Vocabulary (自学习平台)` |
| `settings.volcengineAST2HotWordLibraryId` | `Hot Words Library ID` |
| `settings.volcengineAST2HotWordLibraryTooltip` | `Boost recognition of specific terms.` |
| `settings.volcengineAST2HotWordManage` | `Manage hot words` |
| `settings.volcengineAST2ReplacementLibraryId` | `Replacement Library ID` |
| `settings.volcengineAST2ReplacementLibraryTooltip` | `Post-transcription text substitution.` |
| `settings.volcengineAST2ReplacementManage` | `Manage replacement` |
| `settings.volcengineAST2GlossaryLibraryId` | `Glossary Library ID` |
| `settings.volcengineAST2GlossaryLibraryTooltip` | `Source→target bilingual term pairs.` |
| `settings.volcengineAST2GlossaryManage` | `Manage glossary` |
| `settings.volcengineAST2CustomVocabularyFooter` | `Leave any field empty to disable it.` |

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
    `boostingTableId`, `regexCorrectTableId`, `glossaryTableId` set to
    the exact values passed
  - only glossary ID → decoded request has `request.corpus` with only
    `glossaryTableId`; other fields are empty-string defaults (protobuf
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

1. ~~**Field-name mapping** needs end-to-end confirmation.~~ **RESOLVED.**
   Confirmed against the AST 2.0 API spec page (1756902) rendered via
   Playwright: the documented `corpus` sample uses
   `boosting_table_id` / `regex_correct_table_id` / `glossary_table_id`.
   Fixed the replacement mapping from `correct_table_id` → `regex_correct_table_id`.
2. ~~**Three console deep-link URLs.**~~ **RESOLVED.**
   Confirmed:
   - 热词 → `https://console.volcengine.com/speech/hotword`
   - 替换词 → `https://console.volcengine.com/speech/correctword`
   - 术语词 → `https://console.volcengine.com/speech/glossary`
3. **Empty-string vs. absent semantics on the wire** — the design above
   sends the field absent when empty. If Volcengine actually requires an
   empty string for "disable previous value" (unusual but possible), a
   later follow-up can switch to `corpus.boostingTableId = hotId || ''`.
   No evidence this is needed today; start with "absent when empty".
