# Volcengine Doubao AST 2.0 — Custom Vocabulary Library Reference: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire three optional library-ID inputs (热词, 替换词, 术语词) through settings → session config → proto `Corpus` message for the Volcengine Doubao AST 2.0 provider.

**Architecture:** Purely additive, pass-through. Three new `string` fields in the AST2 settings block (empty = disabled). A pure helper builds a `corpus: Record<string, string>` at session start, omitting keys for empty fields and omitting `corpus` entirely when all three are empty. The existing generated protobuf (`TranslateRequest` / `Corpus`) already carries the target fields — no proto regen.

**Tech Stack:** TypeScript, React, Zustand (settings store), Vitest, protobuf.js (pre-generated bindings), `lucide-react` `<CircleHelp>` icon + existing `<Tooltip>` component.

**Spec:** `docs/superpowers/specs/2026-04-19-volcengine-ast2-custom-vocabulary-design.md`

---

## Proto field mapping (fixed — use exactly these names)

| Console tab | Settings field | JS property (what we emit) | Wire field |
| --- | --- | --- | --- |
| 热词 (Hot Words) | `hotWordTableId` | `boostingTableId` | `boosting_table_id` |
| 替换词 (Replacement) | `replacementTableId` | `regexCorrectTableId` | `regex_correct_table_id` |
| 术语词 (Glossary) | `glossaryTableId` | `glossaryTableId` | `glossary_table_id` |

All three are `string`. Empty string = "not set" → omit from wire payload.

> **Post-hoc corrections** — two fixes landed after this plan was written:
> (a) the Replacement mapping was changed from `correct_table_id` to
> `regex_correct_table_id` after verifying against the AST 2.0 API doc at
> <https://www.volcengine.com/docs/6561/1756902>; (b) the `buildCorpusFromConfig`
> helper emits **camelCase** JS property names because `TranslateRequest.encode()`
> reads properties from the generated binding (`ast2-proto.d.ts`), which is
> camelCase — snake_case keys were silently dropped in the original draft. The
> Task 3 snippets below still show snake_case; treat them as historical and use
> the camelCase JS property names from the table above when writing code.

---

## File Structure

Files touched by this plan:

- **Modify** `src/services/interfaces/IClient.ts` — add 3 optional fields to `VolcengineAST2SessionConfig`.
- **Modify** `src/stores/settingsStore.ts` — add 3 fields to `VolcengineAST2Settings`, 3 defaults, update `createVolcengineAST2SessionConfig`.
- **Modify** `src/stores/settingsStore.test.ts` — add builder test cases.
- **Modify** `src/services/clients/VolcengineAST2Client.ts` — export `buildCorpusFromConfig` helper; call it in `sendStartSession`.
- **Create** `src/services/clients/VolcengineAST2Client.test.ts` — unit tests for `buildCorpusFromConfig`.
- **Modify** `src/components/Settings/sections/ProviderSpecificSettings.tsx` — add Custom Vocabulary section to `renderVolcengineAST2Settings`.
- **Modify** `src/locales/en/translation.json` — add 10 i18n keys under `settings.*`.

Testing uses Vitest (`npm run test`). Single-file runs via `npx vitest run <path>`.

---

## Task 1: Extend session config interface

**Files:**
- Modify: `src/services/interfaces/IClient.ts` (current definition at lines 111–117)

No test in this task — this is a pure type addition with no runtime behavior. Type safety is verified implicitly when Task 3 consumes the fields. Commit is small and independent so the diff stays readable.

- [ ] **Step 1: Add the three optional fields to `VolcengineAST2SessionConfig`**

Open `src/services/interfaces/IClient.ts`. Replace the existing `VolcengineAST2SessionConfig` interface (lines 111–117) with:

```ts
/**
 * Volcengine AST 2.0 session configuration (s2s mode)
 */
export interface VolcengineAST2SessionConfig extends BaseSessionConfig {
  provider: 'volcengine_ast2';
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode?: 'Auto' | 'Push-to-Talk';
  /** Boost recognition of specific terms (Volcengine 自学习平台 → 热词). Library ID only; empty string or undefined = not set. */
  hotWordTableId?: string;
  /** Post-transcription text substitution (Volcengine 自学习平台 → 替换词). Library ID only; empty string or undefined = not set. */
  replacementTableId?: string;
  /** Source→target bilingual term pairs (Volcengine 自学习平台 → 术语词). Library ID only; empty string or undefined = not set. */
  glossaryTableId?: string;
}
```

- [ ] **Step 2: Run the typechecker**

Run: `npx tsc --noEmit`
Expected: PASS (zero errors). The fields are optional, so no existing callers break.

- [ ] **Step 3: Commit**

```bash
git add src/services/interfaces/IClient.ts
git commit -m "feat(volcengine_ast2): add custom vocabulary fields to session config

Adds optional hotWordTableId, replacementTableId, and glossaryTableId
to VolcengineAST2SessionConfig. Pure type addition; no runtime behavior
yet."
```

---

## Task 2: Settings type, defaults, and store builder

**Files:**
- Modify: `src/stores/settingsStore.ts` (interface at lines 116–122, defaults at lines 280–286, builder at lines 490–502)
- Test: `src/stores/settingsStore.test.ts` (add new `describe` block at end)

This task is the largest — it bundles the settings-store changes and their tests. The three parts (interface, defaults, builder) live within a few tens of lines of each other and land together in one commit so the tests pass immediately after the code change.

- [ ] **Step 1: Write the failing test block**

Open `src/stores/settingsStore.test.ts`. Scroll to the end of the file (just before the closing `});` that ends the outer `describe('settingsStore', ...)`). Add this new `describe` block:

```ts
  describe('Volcengine AST 2.0 custom vocabulary', () => {
    const volcBase = {
      appId: 'app-id',
      accessToken: 'token',
      sourceLanguage: 'zh' as const,
      targetLanguage: 'en' as const,
      turnDetectionMode: 'Auto' as const,
    };

    it('omits all three corpus fields when values are empty strings', () => {
      useSettingsStore.setState({
        provider: Provider.VOLCENGINE_AST2,
        volcengineAST2: {
          ...volcBase,
          hotWordTableId: '',
          replacementTableId: '',
          glossaryTableId: '',
        },
      } as any);

      const config = useSettingsStore.getState().createSessionConfig('sys');
      expect(config.provider).toBe('volcengine_ast2');
      expect((config as any).hotWordTableId).toBeUndefined();
      expect((config as any).replacementTableId).toBeUndefined();
      expect((config as any).glossaryTableId).toBeUndefined();
    });

    it('omits fields that contain only whitespace', () => {
      useSettingsStore.setState({
        provider: Provider.VOLCENGINE_AST2,
        volcengineAST2: {
          ...volcBase,
          hotWordTableId: '   ',
          replacementTableId: '\t\n',
          glossaryTableId: ' ',
        },
      } as any);

      const config = useSettingsStore.getState().createSessionConfig('sys');
      expect((config as any).hotWordTableId).toBeUndefined();
      expect((config as any).replacementTableId).toBeUndefined();
      expect((config as any).glossaryTableId).toBeUndefined();
    });

    it('trims and passes through set IDs; leaves others undefined', () => {
      useSettingsStore.setState({
        provider: Provider.VOLCENGINE_AST2,
        volcengineAST2: {
          ...volcBase,
          hotWordTableId: '  hot-abc  ',
          replacementTableId: '',
          glossaryTableId: 'gloss-1',
        },
      } as any);

      const config = useSettingsStore.getState().createSessionConfig('sys');
      expect((config as any).hotWordTableId).toBe('hot-abc');
      expect((config as any).replacementTableId).toBeUndefined();
      expect((config as any).glossaryTableId).toBe('gloss-1');
    });

    it('trims all three when all are set', () => {
      useSettingsStore.setState({
        provider: Provider.VOLCENGINE_AST2,
        volcengineAST2: {
          ...volcBase,
          hotWordTableId: '\thot-1\t',
          replacementTableId: ' rep-2 ',
          glossaryTableId: 'gloss-3',
        },
      } as any);

      const config = useSettingsStore.getState().createSessionConfig('sys');
      expect((config as any).hotWordTableId).toBe('hot-1');
      expect((config as any).replacementTableId).toBe('rep-2');
      expect((config as any).glossaryTableId).toBe('gloss-3');
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/stores/settingsStore.test.ts`
Expected: FAIL. Two shapes of failure are both fine:
- Type error ("Object literal may only specify known properties, and 'hotWordTableId' does not exist") — because `VolcengineAST2Settings` hasn't been extended yet.
- OR the tests run and fail with `expect(undefined).toBe('hot-abc')` because the builder doesn't emit the fields.

Either way, that's the expected "red" state.

- [ ] **Step 3: Extend `VolcengineAST2Settings` in `settingsStore.ts`**

In `src/stores/settingsStore.ts`, replace the interface at lines 116–122 with:

```ts
// Volcengine AST 2.0 Settings
export interface VolcengineAST2Settings {
  appId: string;
  accessToken: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Auto' | 'Push-to-Talk';
  /** Library ID for 自学习平台 → 热词. Empty = disabled. */
  hotWordTableId: string;
  /** Library ID for 自学习平台 → 替换词. Empty = disabled. */
  replacementTableId: string;
  /** Library ID for 自学习平台 → 术语词. Empty = disabled. */
  glossaryTableId: string;
}
```

- [ ] **Step 4: Extend `defaultVolcengineAST2Settings`**

Replace the defaults block at lines 280–286 with:

```ts
const defaultVolcengineAST2Settings: VolcengineAST2Settings = {
  appId: '',
  accessToken: '',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  turnDetectionMode: 'Auto',
  hotWordTableId: '',
  replacementTableId: '',
  glossaryTableId: '',
};
```

- [ ] **Step 5: Update `createVolcengineAST2SessionConfig`**

Replace the function at lines 490–502 with:

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

Rationale for the `trim() || undefined` pattern: `''.trim()` returns `''` which is falsy, so the expression evaluates to `undefined`. For whitespace-only input, `'   '.trim()` also returns `''` → `undefined`. Non-empty trimmed content passes through unchanged.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/stores/settingsStore.test.ts`
Expected: PASS (all four new test cases green, plus existing tests still green).

- [ ] **Step 7: Run full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS. If anything else depends on `VolcengineAST2Settings` having exactly the old shape, fix those call sites now. Prior scans showed no such callers outside the files this plan already touches.

- [ ] **Step 8: Commit**

```bash
git add src/services/interfaces/IClient.ts src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "feat(volcengine_ast2): thread custom vocabulary IDs through settings store

Adds hotWordTableId, replacementTableId, and glossaryTableId to
VolcengineAST2Settings with empty-string defaults, and updates the
session-config builder to trim and forward only non-empty values."
```

(Note: Task 1's `IClient.ts` change is included here only if it wasn't committed separately. If Task 1 was already committed, replace the first file with nothing and keep just the store + test.)

---

## Task 3: Pure helper `buildCorpusFromConfig` with unit tests

**Files:**
- Modify: `src/services/clients/VolcengineAST2Client.ts` (add named export)
- Create: `src/services/clients/VolcengineAST2Client.test.ts`

The helper is a ~10-line pure function. Extracting it keeps the wire-payload logic testable without the WebSocket setup dance.

- [ ] **Step 1: Write the failing test file**

Create `src/services/clients/VolcengineAST2Client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// Mock i18n (the client module imports it transitively via some paths).
vi.mock('../../locales', () => ({
  default: { t: (key: string) => key }
}));

// Dynamic import after mocks
const { buildCorpusFromConfig } = await import('./VolcengineAST2Client');

const baseConfig = {
  provider: 'volcengine_ast2' as const,
  model: 'ast-v2-s2s',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  turnDetectionMode: 'Auto' as const,
};

describe('buildCorpusFromConfig', () => {
  it('returns undefined when all three IDs are absent', () => {
    expect(buildCorpusFromConfig({ ...baseConfig })).toBeUndefined();
  });

  it('returns undefined when all three IDs are empty strings', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: '',
      replacementTableId: '',
      glossaryTableId: '',
    })).toBeUndefined();
  });

  it('returns undefined when all three IDs are whitespace only', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: '   ',
      replacementTableId: '\t',
      glossaryTableId: '\n',
    })).toBeUndefined();
  });

  it('emits only the set fields and uses correct proto names', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: 'hot-1',
      replacementTableId: '',
      glossaryTableId: 'gloss-3',
    })).toEqual({
      boosting_table_id: 'hot-1',
      glossary_table_id: 'gloss-3',
    });
  });

  it('emits all three when all are set', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: 'hot-1',
      replacementTableId: 'rep-2',
      glossaryTableId: 'gloss-3',
    })).toEqual({
      boosting_table_id: 'hot-1',
      correct_table_id: 'rep-2',
      glossary_table_id: 'gloss-3',
    });
  });

  it('trims whitespace from IDs', () => {
    expect(buildCorpusFromConfig({
      ...baseConfig,
      hotWordTableId: '  hot-1  ',
      replacementTableId: '\trep-2\t',
      glossaryTableId: ' gloss-3 ',
    })).toEqual({
      boosting_table_id: 'hot-1',
      correct_table_id: 'rep-2',
      glossary_table_id: 'gloss-3',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/services/clients/VolcengineAST2Client.test.ts`
Expected: FAIL with `buildCorpusFromConfig is not a function` or `undefined`.

- [ ] **Step 3: Add the helper to `VolcengineAST2Client.ts`**

Open `src/services/clients/VolcengineAST2Client.ts`. Just above the `export class VolcengineAST2Client` declaration (currently around line 54), add this named export:

```ts
/**
 * Build the `Corpus` payload attached to `ReqParams.corpus` in the
 * StartSession request. Returns `undefined` when the user has not set
 * any library IDs, so the caller can omit the `corpus` key entirely.
 *
 * Volcengine 自学习平台 → proto field mapping:
 *   热词   (hot words)   → boosting_table_id
 *   替换词 (replacement) → correct_table_id
 *   术语词 (glossary)    → glossary_table_id
 */
export function buildCorpusFromConfig(
  config: VolcengineAST2SessionConfig
): Record<string, string> | undefined {
  const corpus: Record<string, string> = {};
  const hotId = config.hotWordTableId?.trim();
  const replaceId = config.replacementTableId?.trim();
  const glossaryId = config.glossaryTableId?.trim();
  if (hotId) corpus.boosting_table_id = hotId;
  if (replaceId) corpus.correct_table_id = replaceId;
  if (glossaryId) corpus.glossary_table_id = glossaryId;
  return Object.keys(corpus).length > 0 ? corpus : undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/services/clients/VolcengineAST2Client.test.ts`
Expected: PASS (all six cases green).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/VolcengineAST2Client.ts src/services/clients/VolcengineAST2Client.test.ts
git commit -m "feat(volcengine_ast2): add buildCorpusFromConfig helper with tests

Pure function that builds the Corpus proto payload from session config,
mapping hotWordTableId → boosting_table_id, replacementTableId →
correct_table_id, glossaryTableId → glossary_table_id. Returns undefined
when all three are empty so the caller can omit the corpus key."
```

---

## Task 4: Wire `buildCorpusFromConfig` into `sendStartSession`

**Files:**
- Modify: `src/services/clients/VolcengineAST2Client.ts` (function at lines 311–368)

- [ ] **Step 1: Call the helper in `sendStartSession` and attach `corpus` conditionally**

In `src/services/clients/VolcengineAST2Client.ts`, locate `sendStartSession` (starts at line 311). Find the `requestPayload` assignment (currently ends around line 342 with the closing `};` before the `if (!isTextOnly)` block that adds `targetAudio`). Immediately after the closing `};` of `requestPayload` and before `if (!isTextOnly)`, insert:

```ts
    // Attach custom-vocabulary library IDs when the user has set any.
    const corpus = buildCorpusFromConfig(this.currentConfig);
    if (corpus) {
      requestPayload.request.corpus = corpus;
    }
```

Note: `buildCorpusFromConfig` is defined in the same file, so no import statement is needed.

- [ ] **Step 2: Extend the `start_session.sent` log event**

Within the same `sendStartSession` function, find the existing `this.eventHandlers.onRealtimeEvent?.({ ... 'start_session.sent' ... })` block (around lines 356–367). Add a `corpus` field to its `data` payload:

```ts
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'start_session.sent',
        data: {
          sessionId: this.sessionId,
          sourceLanguage: this.currentConfig.sourceLanguage,
          targetLanguage: this.currentConfig.targetLanguage,
          mode: isTextOnly ? 's2t' : 's2s',
          corpus: corpus ?? null,
        }
      }
    });
```

`null` (not omission) when unset, so the logs panel makes the "no custom vocabulary" state explicit to anyone debugging.

- [ ] **Step 3: Run the typechecker**

Run: `npx tsc --noEmit`
Expected: PASS. The proto binding's `request` sub-object is typed loosely (`any` in places), so setting `requestPayload.request.corpus = corpus` compiles.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (existing tests still green; the helper test from Task 3 still green).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/VolcengineAST2Client.ts
git commit -m "feat(volcengine_ast2): attach custom vocabulary corpus to StartSession

sendStartSession now calls buildCorpusFromConfig and attaches the result
to requestPayload.request.corpus when non-empty. Also surfaces the
corpus shape in the start_session.sent realtime-log event for debugging."
```

---

## Task 5: i18n keys

**Files:**
- Modify: `src/locales/en/translation.json`

10 new keys under the existing `settings.*` object. Other locales inherit the English text via i18next fallback — no other translation files need touching in this PR.

- [ ] **Step 1: Add the new keys**

Open `src/locales/en/translation.json`. Find the existing `"volcengineAST2TurnDetectionTooltip"` key (currently around line 165 inside the `"settings": { ... }` block). Immediately after that line, before the next existing key, insert:

```json
    "volcengineAST2CustomVocabulary": "Custom Vocabulary (自学习平台)",
    "volcengineAST2HotWordLibraryId": "Hot Words Library ID",
    "volcengineAST2HotWordLibraryTooltip": "Boost recognition of specific terms.",
    "volcengineAST2HotWordManage": "Manage hot words",
    "volcengineAST2ReplacementLibraryId": "Replacement Library ID",
    "volcengineAST2ReplacementLibraryTooltip": "Post-transcription text substitution.",
    "volcengineAST2ReplacementManage": "Manage replacement",
    "volcengineAST2GlossaryLibraryId": "Glossary Library ID",
    "volcengineAST2GlossaryLibraryTooltip": "Source→target bilingual term pairs.",
    "volcengineAST2GlossaryManage": "Manage glossary",
    "volcengineAST2CustomVocabularyFooter": "Leave any field empty to disable it.",
```

Ensure trailing commas match surrounding JSON style (the file is pretty-printed with 4-space indentation and uses trailing commas only where valid JSON requires them — i.e. every entry except the last in its object has a comma).

- [ ] **Step 2: Validate JSON**

Run: `python3 -c "import json; json.load(open('src/locales/en/translation.json'))"`
Expected: no output (silent success). Any exit-with-trace means the JSON is malformed — fix the comma or quote issue before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "i18n(en): add Volcengine AST 2.0 custom vocabulary strings

Adds the 11 new English strings for the Custom Vocabulary section
(section title + per-field label/tooltip/manage-link + footer).
Other locales fall back to English via i18next."
```

---

## Task 6: UI section

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (`renderVolcengineAST2Settings` currently at lines 1177–1289)

No component test — the file has no existing component tests and adding one for this single section is out of scope per the spec ("No UI component tests today for `ProviderSpecificSettings`; follow existing convention and skip.").

- [ ] **Step 1: Confirm `CircleHelp` and `Tooltip` are already imported**

Open `src/components/Settings/sections/ProviderSpecificSettings.tsx`. Verify these imports already exist (they do — don't re-add):
- `import Tooltip from '../../Tooltip/Tooltip';` (current line 37)
- `import { ChevronDown, ChevronRight, RotateCw, Info, CircleHelp } from 'lucide-react';` (current line 36)

- [ ] **Step 2: Add the Custom Vocabulary section to `renderVolcengineAST2Settings`**

Still in `ProviderSpecificSettings.tsx`. Locate the existing `renderVolcengineAST2Settings` function (starts at line 1177). Find the "Doubao AST 2.0 Info" section (currently at line 1271 — starts with `<div className="settings-section">` containing `<h2>{t('settings.volcengineAST2Info', 'Doubao AST 2.0 Info')}</h2>`).

Immediately **before** that "Doubao AST 2.0 Info" section (i.e. between the closing `</div>` of the Turn Detection section at line 1269 and the opening `<div className="settings-section">` of the Info section at line 1271), insert this new section:

```tsx
        <div className="settings-section">
          <h2>{t('settings.volcengineAST2CustomVocabulary', 'Custom Vocabulary (自学习平台)')}</h2>

          {/* Hot Words */}
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.volcengineAST2HotWordLibraryId', 'Hot Words Library ID')}</span>
              <Tooltip
                content={t('settings.volcengineAST2HotWordLibraryTooltip', 'Boost recognition of specific terms.')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
              </Tooltip>
              <a
                href="https://console.volcengine.com/speech/app"
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 'auto', fontSize: '12px' }}
              >
                {t('settings.volcengineAST2HotWordManage', 'Manage hot words')} ↗
              </a>
            </div>
            <input
              type="text"
              className="text-input"
              value={volcengineAST2Settings.hotWordTableId}
              onChange={(e) => updateVolcengineAST2Settings({ hotWordTableId: e.target.value })}
              disabled={isSessionActive}
              placeholder=""
            />
          </div>

          {/* Replacement */}
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.volcengineAST2ReplacementLibraryId', 'Replacement Library ID')}</span>
              <Tooltip
                content={t('settings.volcengineAST2ReplacementLibraryTooltip', 'Post-transcription text substitution.')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
              </Tooltip>
              <a
                href="https://console.volcengine.com/speech/app"
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 'auto', fontSize: '12px' }}
              >
                {t('settings.volcengineAST2ReplacementManage', 'Manage replacement')} ↗
              </a>
            </div>
            <input
              type="text"
              className="text-input"
              value={volcengineAST2Settings.replacementTableId}
              onChange={(e) => updateVolcengineAST2Settings({ replacementTableId: e.target.value })}
              disabled={isSessionActive}
              placeholder=""
            />
          </div>

          {/* Glossary */}
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.volcengineAST2GlossaryLibraryId', 'Glossary Library ID')}</span>
              <Tooltip
                content={t('settings.volcengineAST2GlossaryLibraryTooltip', 'Source→target bilingual term pairs.')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
              </Tooltip>
              <a
                href="https://console.volcengine.com/speech/app"
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: 'auto', fontSize: '12px' }}
              >
                {t('settings.volcengineAST2GlossaryManage', 'Manage glossary')} ↗
              </a>
            </div>
            <input
              type="text"
              className="text-input"
              value={volcengineAST2Settings.glossaryTableId}
              onChange={(e) => updateVolcengineAST2Settings({ glossaryTableId: e.target.value })}
              disabled={isSessionActive}
              placeholder=""
            />
          </div>

          <div className="setting-item" style={{ fontSize: '12px', color: '#888' }}>
            {t('settings.volcengineAST2CustomVocabularyFooter', 'Leave any field empty to disable it.')}
          </div>
        </div>

```

Notes for the implementer:

- All three `href` values are the safe-fallback URL (`https://console.volcengine.com/speech/app`). The spec's Open Question #2 says to confirm the three deep-links during implementation — if you have Volcengine console access, log in, navigate to 自学习平台 → 热词管理 / 替换词 / 术语词, copy each page's address-bar URL, and substitute it into the corresponding `href`. If you don't have access, leave the fallback URL — the link still lands the user in the right area.
- `text-input` is the existing class used for credential inputs in this file (e.g. the App Key and Access Token inputs higher up in `renderVolcengineAST2Settings`). If that class is not present on the AST2 credential inputs (different pattern), match whatever class they use instead. Do not invent a new class.
- `isSessionActive` is already in scope in `renderVolcengineAST2Settings` — no new variables to pull in.
- `volcengineAST2Settings` and `updateVolcengineAST2Settings` are already destructured at the top of the component (lines 83 and 98).

- [ ] **Step 3: Run the typechecker**

Run: `npx tsc --noEmit`
Expected: PASS. If TS complains that `volcengineAST2Settings.hotWordTableId` doesn't exist, Task 2's settings-type extension wasn't applied — go fix that first.

- [ ] **Step 4: Start the dev server and sanity-check the UI**

Run: `npm run dev`
Open the app in a browser, go to Settings → choose provider Doubao AST 2.0 → verify:
- A new "Custom Vocabulary (自学习平台)" section appears between Turn Detection and the "Doubao AST 2.0 Info" notice.
- Three rows, each with a label, `ⓘ` icon, and "Manage ↗" link.
- Hovering each `ⓘ` shows the correct tooltip text.
- Typing in any of the three inputs persists across a page reload (persistence is covered by existing `updateVolcengineAST2` machinery).
- All three inputs become disabled while a session is active (start a session with any other field and verify).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(volcengine_ast2): add Custom Vocabulary section to AST2 settings

Three text inputs for 热词, 替换词, and 术语词 library IDs, each with
an inline ⓘ tooltip and a per-type 'Manage ↗' link to the Volcengine
console. Inputs are disabled during active sessions."
```

---

## Task 7: Final verification

No commits expected unless a regression surfaces.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS across everything, including the new `settingsStore` cases and the new `VolcengineAST2Client.test.ts`.

- [ ] **Step 2: Run the typechecker**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: builds cleanly. Any new error here that wasn't caught by `tsc --noEmit` is either a Vite/TS-config mismatch or a dead import — fix in place.

- [ ] **Step 4: Manual end-to-end test with real Volcengine credentials**

Requires a Volcengine account with the Doubao AST 2.0 service activated plus at least one glossary library created in 自学习平台 → 术语词. If you lack credentials, skip this step and note "manual E2E pending" in the PR description.

1. Start dev server: `npm run dev`.
2. Configure Doubao AST 2.0 with valid App Key + Access Token.
3. Create a glossary library in the Volcengine console with at least one term pair (e.g. `Sokuji → そくじ`), save, copy the library ID.
4. Paste the ID into the Glossary Library ID input.
5. Start a session with source=zh target=ja (or whatever matches the library), speak the Chinese term for Sokuji, and confirm the translation uses the mapped Japanese output.
6. Repeat with intentionally-wrong IDs in any field → confirm a clear error surfaces in the logs panel and/or as an error conversation item.

- [ ] **Step 5: Manual regression test — all-empty path**

With all three vocabulary fields empty, start an ordinary AST 2.0 session and confirm behavior is unchanged from before this PR (same latency, same output quality, same logs shape — just no `corpus` field in `start_session.sent`).

- [ ] **Step 6: Create PR**

Only if all above steps are green:

```bash
git push -u origin HEAD
gh pr create --title "feat(volcengine_ast2): Custom Vocabulary library references" --body "$(cat <<'EOF'
## Summary
- Adds three optional library-ID inputs to the Doubao AST 2.0 provider settings: Hot Words (热词), Replacement (替换词), and Glossary (术语词)
- Each ID is passed through at StartSession time as the corresponding \`Corpus\` proto field (\`boosting_table_id\`, \`correct_table_id\`, \`glossary_table_id\`)
- Pass-through only — libraries are managed in the Volcengine 自学习平台 console

Spec: \`docs/superpowers/specs/2026-04-19-volcengine-ast2-custom-vocabulary-design.md\`
Plan: \`docs/superpowers/plans/2026-04-19-volcengine-ast2-custom-vocabulary.md\`

## Test plan
- [x] Unit — \`settingsStore\` builder: empty, whitespace, mixed, trimmed-all
- [x] Unit — \`buildCorpusFromConfig\`: six cases covering all empty/whitespace/subset/trim combinations
- [x] Typecheck + full test suite pass
- [x] Manual UI — Custom Vocabulary section renders, tooltips show, inputs persist, disabled during sessions
- [ ] Manual E2E — with a real glossary library, translation respects terminology (requires Volcengine account)
- [x] Manual regression — all-empty path behaves identically to before

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

Checked against spec sections:

1. **Terminology → proto field mapping** (spec §"Terminology → proto field mapping") — covered by Task 3's helper and tests; the proto field names appear verbatim in Step 3 of Task 3 and are asserted in Step 1 of Task 3's test.
2. **Data model** (spec §"Data model → 1. Settings store") — covered by Task 2, Steps 3–4.
3. **Session config interface** (spec §"Data model → 2. Session config") — covered by Task 1.
4. **Session config builder** (spec §"Data model → 3. Session config builder") — covered by Task 2, Step 5.
5. **Client — sendStartSession wiring** (spec §"Data model → 4. Client") — covered by Task 4.
6. **Logging of `start_session.sent`** (spec §"Data model → 4. Client" paragraph on logging) — covered by Task 4, Step 2.
7. **UI placement + layout** (spec §"UI → Placement" and "UI → Layout") — covered by Task 6.
8. **UI behavior: `isSessionActive` disable + `target="_blank"`** (spec §"UI → Behavior") — covered by Task 6.
9. **i18n keys** (spec §"UI → i18n") — covered by Task 5.
10. **Error handling** (spec §"Error handling") — inherent to the helper's undefined-return semantics (Task 3) and the "attach only if non-empty" wire logic (Task 4). No explicit task needed.
11. **Testing plan** (spec §"Testing → Unit") — covered by Task 2 Step 1 (store builder cases) and Task 3 Step 1 (helper cases).
12. **Rollout: backward-compatible** (spec §"Rollout") — new settings fields default to `''`; session-config fields optional; `corpus` omitted when all empty. Verified by Task 7, Step 5.
13. **Non-goals** (spec §"Non-goals") — plan deliberately does not add: `glossary_list` inline map, library browser UI, library-name inputs, `regex_correct_table_id`, ST provider support. No tasks for these.
14. **Open Questions** — field-mapping confirmation is part of Task 7 Step 4; console deep-link URL confirmation is called out inline in Task 6 Step 2.

No placeholders detected. All code steps contain complete code blocks. All commands are exact. Type/field names match across tasks (`hotWordTableId` / `replacementTableId` / `glossaryTableId` everywhere; `boosting_table_id` / `correct_table_id` / `glossary_table_id` everywhere).
