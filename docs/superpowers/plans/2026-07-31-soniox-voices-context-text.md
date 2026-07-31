# Soniox Voices + Session Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Soniox TTS voice catalog from 12 to the official 28, and expose STT `context.text` as an optional "Session Background" setting folded into the serialized-context budget (text trimmed first).

**Architecture:** Pure additions along the established Soniox chain: settings field → `buildSessionConfig` (budget guard grows a `text` argument with character-level first-priority truncation) → `SonioxSessionConfig.context.text` → client passthrough → wire `context.text` (default-neutral omission). One new UI section reusing the vocabulary-textarea pattern. Spec: `docs/superpowers/specs/2026-07-31-soniox-voices-context-text-design.md`.

**Tech Stack:** TypeScript, Vitest, i18next (30 locales).

## Global Constraints

- **Branch/worktree:** `feat/soniox-voices-context-text` in `.claude/worktrees/soniox-voices-text` (off origin/main). Never push, never open a PR, no bare `git stash`.
- **Default-neutral wire:** `context.text` appears only when the trimmed setting is non-empty; with defaults the wire is byte-identical to today (existing omission tests must pass unedited).
- **Length policy (exact):** textarea `maxLength={4000}`; `fitContextToBudget` budgets the WIRE-shaped serialization at 9,000 chars and trims in order — truncate `text` (character-level) first, then `translation_terms` tail, then `terms` tail; `console.warn` on any trim.
- **Vitest is the gate:** `npx vitest run <path>`; not tsc (~113 pre-existing errors). This worktree shares the known environmental "Denied ID …?url" failures (no own node_modules) — not regressions.
- **All comments/code in English.** Conventional commits, one per task, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Voice catalog 12 → 28

**Files:**
- Modify: `src/services/providers/SonioxProviderConfig.ts` (`VOICES` at :259, stale comments at :257 and :295)
- Test: `src/services/providers/SonioxProviderConfig.test.ts`

**Interfaces:** none new — `VoiceOption[]` shape unchanged; managed twin inherits via `super.getConfig()`.

- [ ] **Step 1: Write the failing test**

Append a new describe at the end of `src/services/providers/SonioxProviderConfig.test.ts`:

```typescript
describe('SonioxProviderConfig voices', () => {
  it('exposes the full 28-voice catalog, unique, including the original twelve', () => {
    const voices = new SonioxProviderConfig().getConfig().voices.map((v) => v.value);
    expect(voices).toHaveLength(28);
    expect(new Set(voices).size).toBe(28);
    for (const original of ['Adrian', 'Claire', 'Daniel', 'Emma', 'Grace', 'Jack', 'Kenji', 'Maya', 'Mina', 'Nina', 'Noah', 'Owen']) {
      expect(voices).toContain(original);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/providers/SonioxProviderConfig.test.ts`
Expected: FAIL — length 12 ≠ 28.

- [ ] **Step 3: Implement**

Replace the comment at :257-258 and extend the `VOICES` table (keep the original 12 entries first, verbatim):

```typescript
  // Every voice is multilingual — any voice speaks any language (official
  // catalog, 2026-07-31; zh/ja/en live-verified 2026-07-18 for the original
  // twelve) — so one voice serves both two_way directions.
  private static readonly VOICES: VoiceOption[] = [
    { name: 'Adrian', value: 'Adrian' },
    { name: 'Claire', value: 'Claire' },
    { name: 'Daniel', value: 'Daniel' },
    { name: 'Emma', value: 'Emma' },
    { name: 'Grace', value: 'Grace' },
    { name: 'Jack', value: 'Jack' },
    { name: 'Kenji', value: 'Kenji' },
    { name: 'Maya', value: 'Maya' },
    { name: 'Mina', value: 'Mina' },
    { name: 'Nina', value: 'Nina' },
    { name: 'Noah', value: 'Noah' },
    { name: 'Owen', value: 'Owen' },
    // Accented additions (official catalog, 2026-07-31):
    { name: 'Rafael', value: 'Rafael' },     // Spanish accent
    { name: 'Mateo', value: 'Mateo' },       // Spanish accent
    { name: 'Lucia', value: 'Lucia' },       // Spanish accent
    { name: 'Sofia', value: 'Sofia' },       // Spanish accent
    { name: 'Oliver', value: 'Oliver' },     // British accent
    { name: 'Arthur', value: 'Arthur' },     // British accent
    { name: 'Isla', value: 'Isla' },         // British accent
    { name: 'Victoria', value: 'Victoria' }, // British accent
    { name: 'Cooper', value: 'Cooper' },     // Australian accent
    { name: 'Mason', value: 'Mason' },       // Australian accent
    { name: 'Ruby', value: 'Ruby' },         // Australian accent
    { name: 'Elise', value: 'Elise' },       // Australian accent
    { name: 'Arjun', value: 'Arjun' },       // Indian accent
    { name: 'Rohan', value: 'Rohan' },       // Indian accent
    { name: 'Priya', value: 'Priya' },       // Indian accent
    { name: 'Meera', value: 'Meera' },       // Indian accent
  ];
```

Update the capability comment at :295 from `// TTS voice dropdown (12 multilingual voices)` to `// TTS voice dropdown (28 multilingual voices)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/providers/SonioxProviderConfig.test.ts src/services/providers/descriptorRegistry.test.ts`
Expected: PASS (descriptorRegistry has one known environmental failure in this worktree — everything else green, no assertion touches voices).

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/SonioxProviderConfig.ts src/services/providers/SonioxProviderConfig.test.ts
git commit -m "feat(soniox): expand the TTS voice catalog to the official 28 voices

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Provider layer — `contextText` setting, budget with text-first trimming

**Files:**
- Modify: `src/services/providers/SonioxProviderConfig.ts` (`SonioxSettings`/defaults ~:9-40, `fitContextToBudget` ~:80-107, `buildSessionConfig` ~:155-175)
- Modify: `src/services/interfaces/IClient.ts` (`SonioxSessionConfig.context` at ~:196)
- Test: `src/services/providers/SonioxProviderConfig.test.ts`

**Interfaces:**
- Produces: `SonioxSettings.contextText: string` (default `''`); `fitContextToBudget(terms, translationTerms, text)` returning `{ terms, translationTerms, text }`; `SonioxSessionConfig.context` gains `text?: string`. Tasks 3-4 rely on these names.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SonioxProviderConfig.buildSessionConfig', ...)` block (reuse its `build` helper):

```typescript
  it('passes trimmed background text through as context.text', () => {
    const cfg = build({ contextText: '  Quarterly review of the Sokuji roadmap. ' });
    expect(cfg.context).toEqual({ text: 'Quarterly review of the Sokuji roadmap.' });
  });

  it('omits context entirely for whitespace-only background text', () => {
    const cfg = build({ contextText: '   \n\t ' });
    expect(cfg.context).toBeUndefined();
  });

  it('truncates the background text first when the serialized context overflows, keeping vocabulary intact', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // ~200 translation pairs (~6.4 KB serialized) + 4000-char text → overflow
    // where text absorbs the whole cut and translations survive untouched.
    const lines = Array.from({ length: 200 }, (_, i) => `src${String(i).padStart(3, '0')}=tgt${i}`);
    const cfg = build({ vocabularyTranslations: lines.join('\n'), contextText: 'x'.repeat(4000) });
    expect(cfg.context!.translationTerms).toHaveLength(200);
    const text = cfg.context!.text!;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(4000);
    const serialized = JSON.stringify({
      translation_terms: cfg.context!.translationTerms,
      text,
    }).length;
    expect(serialized).toBeLessThanOrEqual(9000);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('sacrifices the text entirely before touching vocabulary on extreme overflow', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 700 pairs (~22 KB serialized) — text goes to zero, then translations trim.
    const lines = Array.from({ length: 700 }, (_, i) => `s${String(i).padStart(3, '0')}=t${i}`);
    const cfg = build({ vocabularyTranslations: lines.join('\n'), contextText: 'y'.repeat(4000) });
    expect(cfg.context!.text).toBeUndefined();          // fully truncated → omitted
    expect(cfg.context!.translationTerms!.length).toBeGreaterThan(0);
    expect(cfg.context!.translationTerms!.length).toBeLessThan(700);
    warn.mockRestore();
  });
```

Also extend the existing legacy-slice test: add `delete legacy.contextText;` alongside the other deletes and assert nothing throws (the existing assertions suffice).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/providers/SonioxProviderConfig.test.ts`
Expected: the four new tests FAIL (`contextText` unknown / `context.text` missing).

- [ ] **Step 3: Implement**

**(a)** `SonioxSettings` gains (after `vocabularyTranslations`):

```typescript
  /** Free-form session background (agenda/topic/notes) → wire context.text. */
  contextText: string;
```

and `defaultSonioxSettings` gains `contextText: '',`.

**(b)** Replace `fitContextToBudget` with the three-argument version (same constant, text truncated first):

```typescript
function fitContextToBudget(
  terms: string[],
  translationTerms: Array<{ source: string; target: string }>,
  text: string
): { terms: string[]; translationTerms: Array<{ source: string; target: string }>; text: string } {
  const serializedSize = (): number =>
    JSON.stringify({
      ...(terms.length ? { terms } : {}),
      ...(translationTerms.length ? { translation_terms: translationTerms } : {}),
      ...(text ? { text } : {}),
    }).length;
  const dropped = { terms: 0, translationTerms: 0, textChars: 0 };
  // Background text is the weakest context evidence: truncate it first,
  // character-wise (removing k chars shrinks the serialization by >= k, so
  // one cut computed from the overflow is always sufficient — or empties it).
  if (text) {
    const over = serializedSize() - SONIOX_CONTEXT_CHAR_BUDGET;
    if (over > 0) {
      const keep = Math.max(0, text.length - over);
      dropped.textChars = text.length - keep;
      text = text.slice(0, keep);
    }
  }
  while (serializedSize() > SONIOX_CONTEXT_CHAR_BUDGET && translationTerms.length) {
    translationTerms = translationTerms.slice(0, -1);
    dropped.translationTerms++;
  }
  while (serializedSize() > SONIOX_CONTEXT_CHAR_BUDGET && terms.length) {
    terms = terms.slice(0, -1);
    dropped.terms++;
  }
  if (dropped.terms || dropped.translationTerms || dropped.textChars) {
    console.warn(
      `[SonioxProviderConfig] Custom vocabulary/background exceeds the Soniox context size limit — ` +
      `truncated ${dropped.textChars} background char(s), dropped ${dropped.translationTerms} translation(s) ` +
      `and ${dropped.terms} term(s) from the end`
    );
  }
  return { terms, translationTerms, text };
}
```

**(c)** `buildSessionConfig`: feed the trimmed setting and emit `text`:

```typescript
    const { terms, translationTerms, text } = fitContextToBudget(
      parseVocabularyTerms(settings.vocabularyTerms ?? ''),
      parseVocabularyTranslations(settings.vocabularyTranslations ?? ''),
      (settings.contextText ?? '').trim()
    );
```

and in the returned object replace the context spread with:

```typescript
      ...(terms.length || translationTerms.length || text
        ? {
            context: {
              ...(terms.length ? { terms } : {}),
              ...(translationTerms.length ? { translationTerms } : {}),
              ...(text ? { text } : {}),
            },
          }
        : {}),
```

**(d)** `src/services/interfaces/IClient.ts` — `SonioxSessionConfig.context` (at ~:196) gains a third optional member:

```typescript
  context?: {
    terms?: string[];
    translationTerms?: Array<{ source: string; target: string }>;
    /** Free-form background text (wire: context.text); absent when empty. */
    text?: string;
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/providers/SonioxProviderConfig.test.ts src/services/clients/SonioxClient.test.ts`
Expected: PASS — all pre-existing budget/vocabulary tests unedited (two-argument call sites no longer exist; only `buildSessionConfig` calls the guard).

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/SonioxProviderConfig.ts src/services/providers/SonioxProviderConfig.test.ts src/services/interfaces/IClient.ts
git commit -m "feat(soniox): session background setting with text-first context budgeting

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire + client passthrough for `context.text`

**Files:**
- Modify: `src/services/clients/SonioxSttStream.ts` (wire context type at :52-55)
- Modify: `src/services/clients/SonioxClient.ts` (`sttContext` mapping at ~:267-273)
- Test: `src/services/clients/SonioxSttStream.test.ts`, `src/services/clients/SonioxClient.test.ts`

**Interfaces:** `SonioxSttConfig.context` gains `text?: string` (wire name identical — no renaming needed).

- [ ] **Step 1: Write the failing tests**

`SonioxSttStream.test.ts` — extend the existing context presence test's config (the one asserting `first.context`) with `text: 'Quarterly sync'` in the passed context and `expect(first.context.text).toBe('Quarterly sync')`; the existing defaults-omission test already proves absence.

`SonioxClient.test.ts` — extend the passthrough describe:

```typescript
  it('passes background text through to the STT wire context', async () => {
    const { stt } = await connectedClient({ context: { text: 'Quarterly sync' } });
    expect((stt.config as { context?: { text?: string } }).context).toEqual({ text: 'Quarterly sync' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/clients/SonioxSttStream.test.ts src/services/clients/SonioxClient.test.ts`
Expected: the extended/new cases FAIL (type error / missing text on the wire).

- [ ] **Step 3: Implement**

`SonioxSttStream.ts` context type:

```typescript
  context?: {
    terms?: string[];
    translation_terms?: Array<{ source: string; target: string }>;
    text?: string;
  };
```

`SonioxClient.ts` — extend the `sttContext` construction with a third spread:

```typescript
          ...(cfg.context.text ? { text: cfg.context.text } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/clients/`
Expected: ALL PASS (including the wire-neutrality omission tests, unedited).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxSttStream.ts src/services/clients/SonioxSttStream.test.ts src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts
git commit -m "feat(soniox): send context.text in the STT config frame

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: UI — Session Background section

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (insert between the vocabulary section's closing `</div>` at ~:1806 and the endpoint section opening at :1807)
- Test: `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`

**Interfaces:** DOM id `soniox-context-text` for tests; three `t()` keys with inline defaults that Task 5's locale table must match byte-for-byte.

- [ ] **Step 1: Write the failing test**

Append to the existing soniox wiring describe:

```typescript
  it('writes the background textarea to soniox.contextText and caps it at 4000 chars', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-context-text') as HTMLTextAreaElement;
    expect(el.getAttribute('maxlength')).toBe('4000');
    fireEvent.change(el, { target: { value: 'Quarterly roadmap sync' } });
    expect(useSettingsStore.getState().soniox.contextText).toBe('Quarterly roadmap sync');
  });
```

(The `beforeEach` slice reset object gains `contextText: '',`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`
Expected: FAIL — `#soniox-context-text` not found.

- [ ] **Step 3: Implement**

Insert a new section between the vocabulary and endpoint sections:

```tsx
        <div className="settings-section" id="soniox-background-section">
          <h2>
            {t('settings.sonioxBackground', 'Session Background')}
            <Tooltip
              content={t('settings.sonioxBackgroundTooltip', 'Free-form background for the next session — agenda, topic, or reference notes. Helps recognition and translation follow the domain. Trimmed first if the combined context exceeds the size limit.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          </h2>
          <div className="setting-item">
            <textarea
              id="soniox-context-text"
              aria-label={t('settings.sonioxBackground', 'Session Background')}
              className="system-instructions"
              placeholder={t('settings.sonioxBackgroundPlaceholder', 'Paste an agenda, topic, or background notes (optional)')}
              maxLength={4000}
              value={activeSonioxSettings.contextText}
              onChange={(e) => updateActiveSonioxSettings({ contextText: e.target.value })}
              disabled={isSessionActive}
            />
          </div>
        </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`
Expected: ALL PASS (including the pre-existing wiring cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx
git commit -m "feat(soniox): session background settings section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Locales — 3 new keys × 30 files

**Files:** `src/locales/<locale>/translation.json` × 30.

The 3 keys (under `settings`, en values byte-identical to Task 4's inline defaults):

| Key | en value |
|---|---|
| `sonioxBackground` | `Session Background` |
| `sonioxBackgroundTooltip` | `Free-form background for the next session — agenda, topic, or reference notes. Helps recognition and translation follow the domain. Trimmed first if the combined context exceeds the size limit.` |
| `sonioxBackgroundPlaceholder` | `Paste an agenda, topic, or background notes (optional)` |

- [ ] **Step 1:** Add the 3 keys to `en/translation.json` immediately after `"sonioxLatencyLevelMost"` (:236); run the locale consistency test (find via `ls src/locales/*.test.ts`) → expect FAIL (29 locales missing keys).
- [ ] **Step 2:** Translate into the 29 non-en locales (native-quality de/ja/zh_CN/zh_TW; reuse each locale's established register from the neighboring soniox* keys), insert after the same anchor via a job-tmp script (the #368 `insert-soniox-keys.mjs` pattern; job tmp dir: `/home/jiangzhuo/.claude/jobs/6639a1cc/tmp/`).
- [ ] **Step 3:** Consistency test → PASS; `git diff --stat src/locales/` = exactly 30 files.
- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "feat(soniox): locale strings for the session background section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1:** `npx vitest run` — expected: only the known environmental "Denied ID …?url" failures (verify any unexpected failure against the branch base `97045697` with an in-place `git checkout <sha> -q` round-trip; tree is clean).
- [ ] **Step 2:** `npm run build` — passes.
- [ ] **Step 3:** `npx vitest run src/services/clients/ src/services/providers/SonioxProviderConfig.test.ts src/locales/` — wire-neutrality + budget + locale lockstep re-check.
- [ ] **Step 4:** Commit only if fixes were needed (`fix(soniox): full-suite fixes for voices/background`, same footer).

## Out of scope

- `language_hints_strict` (probed: zero delta), `context.general` (user decision), any cross-provider auto-detect changes.
- Pushing / PR — user approval required per action.
