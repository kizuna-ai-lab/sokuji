# Engine Page UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the act of choosing a model a place of its own — an Engine page that shows both translation directions with in-place slot expansion — and make the language pair read as a sentence in the user's terms.

**Architecture:** A push-capable `EngineSurface` hosts three pages (Engine / Library / Storage) inside the provider tab for the two local providers, and as an overlay in simple mode. The Engine page renders both directions' slots from `resolve()` output through a small per-provider `EngineAdapter`; the Library reuses the existing model-management sections constrained to one stage; the Storage page owns deletion with resolver-computed consequence previews. `LanguageSection` gains mode-verb sentence labels and renders `ResolutionNote`s.

**Tech Stack:** React 19 + TypeScript (strict), Zustand, SCSS (colocated), i18next, Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-22-engine-model-selection-design.md` — this plan implements stages **S0 + S4–S7** (Parts 3–4, the chips row, and the inherited data-layer item "textOnly still resolves TTS"). Stages S1–S3 landed as `docs/superpowers/plans/2026-08-22-selection-storage-and-resolution.md` (PR #436).

## Global Constraints

- **English only** in all code, comments, identifiers (CLAUDE.md). New user-facing copy lands in `src/locales/en/translation.json`; other locales fall back to English — do NOT hand-edit 40 locale files.
- **TDD**: failing test first for every behavioral change. Component tests follow the repo's jsdom + testing-library idioms; copy the nearest sibling's markup and class names — class names are unchecked by TS and tests alike (memory: match-sibling-markup).
- **Plan-1 APIs (verbatim, already merged — consume, do not redefine):**
  - `useModelStore.getState().resolve(src, tgt, selections): DirectionResult`, same on `useNativeModelStore` (native reads `catalog`/`statuses` internally)
  - `DirectionResult = { asr, translation, tts: Resolved | null, notes: ResolutionNote[], prunes: Array<{direction, stage}> }`
  - `Resolved = { modelId: string, variant?: string, source: 'explicit' | 'auto' }`
  - `ResolutionNote = { direction, stage, from: string|null, to: string|null, reason: 'not-in-catalog'|'lang-incompatible'|'not-downloaded'|'hardware-gated'|'needs-key'|'no-candidate' }`
  - `useLastResolutionNotes()` (modelStore), `useNativeLastResolutionNotes()` (nativeModelStore)
  - `directionKey(src, tgt)`, `emptyDirection()`, `type Selections`, `type Stage` from `src/lib/local-inference/selection/types`
  - `wasmCandidates({modelStatuses, webgpuAvailable, deviceFeatures})` / `nativeCandidates({catalog, statuses})` — CandidateSource with `.pool(stage, src, tgt)` (language-filtered; contains un-ready candidates with `ready`/`hardwareOk` flags)
  - Selection writes: `selections[directionKey(src,tgt)] = { ...current, [stage]: { modelId } }` via `updateLocalInference` / `updateLocalNative`; sibling stages and sibling directions are always preserved (spread pattern), and displaying an auto result NEVER writes.
- **Spec invariants that bind every UI task:** the `auto ·` prefix is required, not decorative; slots default collapsed, single-open; the Library holds every model for its stage grouped by compatibility, never filtered by it; incompatible models offer Download but never Use; the browse affordance carries no count; pushed pages put back in the content area (PanelBar untouched) and inherit the `sessionActiveNotice` banner; all model controls `disabled={isSessionActive}`.
- Direction conventions: speaker = `${sourceLanguage}→${targetLanguage}`, participant = `${targetLanguage}→${sourceLanguage}`.
- Full suite baseline in this worktree: **12 files / 7 tests failing** (pre-existing Vite "Denied ID" rnnoise worklet env errors) — compare failing FILE NAMES, never bare counts. `npx tsc --noEmit` ≤ 337 errors. `npm run build` clean.
- Run tests with `npm run test -- <path>`. Commit per task, Conventional Commits.

## File Structure

| File | Responsibility |
|---|---|
| `src/components/Settings/sections/LanguageSection.tsx` (modify) | S0: mode-verb sentence labels, both-mode mirror line, ResolutionNote rendering |
| `src/components/Settings/engine/resolutionNotes.ts` (new) | Pure note→copy mapping (`describeResolutionNote`) shared by LanguageSection and future surfaces |
| `src/components/Settings/engine/EngineTypes.ts` (new) | `EngineAdapter` contract + `SlotId` — the seam that keeps EnginePage provider-free |
| `src/components/Settings/engine/SlotRow.tsx` (new) | One slot row + its expanded picker (presentational; single-open state lives in EnginePage) |
| `src/components/Settings/engine/EnginePage.tsx` (new) | Both direction blocks + storage row, driven by an EngineAdapter |
| `src/components/Settings/engine/EngineSurface.tsx` (new) | Push host: Engine / Library / Storage pages, in-content back row, banner inheritance |
| `src/components/Settings/engine/useWasmEngineAdapter.ts` (new) | LOCAL_INFERENCE adapter over modelStore + localInference slice |
| `src/components/Settings/engine/useNativeEngineAdapter.ts` (new) | LOCAL_NATIVE adapter over nativeModelStore + localNative slice (device control, engine gate, memory row) |
| `src/components/Settings/engine/StoragePage.tsx` (new) | Flat downloaded list, in-use badges, resolver-preview delete confirms, Clear all, Import |
| `src/components/Settings/engine/Engine.scss` (new) | Styles for the engine surface family |
| `src/components/Settings/sections/ModelManagementSection.tsx` (modify) | Gains `stageFilter`/`compatibilitySplit` props → becomes the WASM Library body |
| `src/components/Settings/sections/NativeModelManagementSection.tsx` (modify) | Same for native |
| `src/components/Settings/sections/ProviderSpecificSettings.tsx` (modify) | Local branches render `EngineSurface` where the management sections were |
| `src/components/Settings/SimpleSettings/SimpleSettings.tsx` + `src/components/Settings/Settings.tsx` (modify) | Simple-mode overlay host + slot targeting |
| `src/components/Settings/sections/ProviderSection.tsx` (modify) | Chips target slots; OTHER row + participantModelHint deleted |
| `src/stores/settingsStore.ts` (modify) | `engineSlotTarget` one-shot signal |
| `src/stores/modelStore.ts` / `nativeModelStore.ts` (modify) | textOnly skips TTS resolution notes (inherited item) |
| `src/locales/en/translation.json` (modify) | New `engine.*`-adjacent keys under `settings.*`/`models.*`; dead keys removed |

---

### Task 1: `describeResolutionNote` — one note, one sentence

**Files:**
- Create: `src/components/Settings/engine/resolutionNotes.ts`
- Test: `src/components/Settings/engine/resolutionNotes.test.ts`
- Modify: `src/locales/en/translation.json` (add the keys below)

**Interfaces:**
- Consumes: `ResolutionNote` from `src/lib/local-inference/selection/types`.
- Produces: `describeResolutionNote(note: ResolutionNote, t: TFunction, displayName: (id: string) => string): string` — later tasks (3, 5) call it verbatim.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/Settings/engine/resolutionNotes.test.ts
import { describe, it, expect } from 'vitest';
import { describeResolutionNote } from './resolutionNotes';
import type { ResolutionNote } from '../../../lib/local-inference/selection/types';

// A t() that renders the defaultValue with {{interpolation}} — the same contract
// i18next provides — so tests pin the real copy without loading i18n.
const t = (_key: string, opts: Record<string, unknown>): string =>
  String(opts.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));

const name = (id: string) => ({ 'sensevoice-int8': 'SenseVoice', 'opus-mt-ja-en': 'Opus-MT (ja→en)' }[id] ?? id);

const N = (over: Partial<ResolutionNote>): ResolutionNote => ({
  direction: 'ja→en', stage: 'translation', from: 'opus-mt-ja-en', to: 'sensevoice-int8',
  reason: 'not-downloaded', ...over,
});

describe('describeResolutionNote', () => {
  it('not-downloaded names the pick and the substitute', () => {
    expect(describeResolutionNote(N({}), t as never, name))
      .toBe('Opus-MT (ja→en) is not downloaded — using SenseVoice instead. Download it again to use it.');
  });

  it('lang-incompatible says the pick does not fit this direction', () => {
    expect(describeResolutionNote(N({ reason: 'lang-incompatible' }), t as never, name))
      .toBe('Opus-MT (ja→en) does not support this direction — using SenseVoice instead. It returns when the direction does.');
  });

  it('hardware-gated blames the machine, not the user', () => {
    expect(describeResolutionNote(N({ reason: 'hardware-gated' }), t as never, name))
      .toBe('Opus-MT (ja→en) cannot run on this device — using SenseVoice instead.');
  });

  it('not-in-catalog is terminal copy', () => {
    expect(describeResolutionNote(N({ reason: 'not-in-catalog', to: null }), t as never, name))
      .toBe('Opus-MT (ja→en) is no longer available in this version.');
  });

  it('no-candidate names the missing stage, with no from', () => {
    expect(describeResolutionNote(N({ reason: 'no-candidate', from: null, to: null, stage: 'asr' }), t as never, name))
      .toBe('No speech recognition model is available for this direction.');
  });

  it('falls back to a substitute-free sentence when to is null', () => {
    expect(describeResolutionNote(N({ to: null }), t as never, name))
      .toBe('Opus-MT (ja→en) is not downloaded. Download it again to use it.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/Settings/engine/resolutionNotes.test.ts`
Expected: FAIL — `Failed to resolve import "./resolutionNotes"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/Settings/engine/resolutionNotes.ts
import type { TFunction } from 'i18next';
import type { ResolutionNote, Stage } from '../../../lib/local-inference/selection/types';

/** Stage nouns reuse the chip vocabulary so the copy cannot drift per surface. */
const stageKey: Record<Stage, [string, string]> = {
  asr: ['notes.stageAsr', 'speech recognition'],
  translation: ['notes.stageTranslation', 'translation'],
  tts: ['notes.stageTts', 'speech output'],
};

/**
 * One ResolutionNote → one user-facing sentence. Pure: the caller supplies
 * t() and a displayName lookup (WASM manifest names vs native catalog names
 * differ, so the mapping cannot live here).
 */
export function describeResolutionNote(
  note: ResolutionNote,
  t: TFunction,
  displayName: (id: string) => string,
): string {
  const from = note.from ? displayName(note.from) : '';
  const to = note.to ? displayName(note.to) : '';
  const stage = t(stageKey[note.stage][0], stageKey[note.stage][1]);

  switch (note.reason) {
    case 'not-downloaded':
      return note.to
        ? t('notes.notDownloadedWithSub', '{{from}} is not downloaded — using {{to}} instead. Download it again to use it.', { from, to })
        : t('notes.notDownloaded', '{{from}} is not downloaded. Download it again to use it.', { from });
    case 'lang-incompatible':
      return note.to
        ? t('notes.langIncompatibleWithSub', '{{from}} does not support this direction — using {{to}} instead. It returns when the direction does.', { from, to })
        : t('notes.langIncompatible', '{{from}} does not support this direction. It returns when the direction does.', { from });
    case 'hardware-gated':
      return note.to
        ? t('notes.hardwareGatedWithSub', '{{from}} cannot run on this device — using {{to}} instead.', { from, to })
        : t('notes.hardwareGated', '{{from}} cannot run on this device.', { from });
    case 'needs-key':
      return t('notes.needsKey', '{{from}} needs a signed-in account to use.', { from });
    case 'not-in-catalog':
      return t('notes.notInCatalog', '{{from}} is no longer available in this version.', { from });
    case 'no-candidate':
      return t('notes.noCandidate', 'No {{stage}} model is available for this direction.', { stage });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/Settings/engine/resolutionNotes.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the en locale keys**

In `src/locales/en/translation.json`, add a top-level `"notes"` object (alphabetical position beside `"models"`):

```json
"notes": {
  "stageAsr": "speech recognition",
  "stageTranslation": "translation",
  "stageTts": "speech output",
  "notDownloaded": "{{from}} is not downloaded. Download it again to use it.",
  "notDownloadedWithSub": "{{from}} is not downloaded — using {{to}} instead. Download it again to use it.",
  "langIncompatible": "{{from}} does not support this direction. It returns when the direction does.",
  "langIncompatibleWithSub": "{{from}} does not support this direction — using {{to}} instead. It returns when the direction does.",
  "hardwareGated": "{{from}} cannot run on this device.",
  "hardwareGatedWithSub": "{{from}} cannot run on this device — using {{to}} instead.",
  "needsKey": "{{from}} needs a signed-in account to use.",
  "notInCatalog": "{{from}} is no longer available in this version.",
  "noCandidate": "No {{stage}} model is available for this direction."
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/engine/resolutionNotes.ts src/components/Settings/engine/resolutionNotes.test.ts src/locales/en/translation.json
git commit -m "feat(engine): map resolution notes to user-facing sentences"
```

---

### Task 2: S0 — the language pair reads as a sentence

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx` (the `language-pair-row` block, currently labels `simpleConfig.yourLanguage` / `simpleConfig.targetLanguage`)
- Test: `src/components/Settings/sections/LanguageSection.sentence.test.tsx` (new)
- Modify: `src/locales/en/translation.json`

**Interfaces:**
- Consumes: `useAudioStore((s) => s.mode)` — `AudioMode = 'speaker' | 'participant' | 'both'` (`src/stores/audioStore.ts:10`, state field `:101`, default `'speaker'`).
- Produces: no exports — the sentence markup and its i18n keys, which Task 3's note rendering sits beneath.

The spec's table (Part 3): the two selectors are the SAME two fields in every mode — first selector is always MY language (`sourceLanguage`), second always THEIRS (`targetLanguage`); only the verbs change. `both` adds one derived plain-text mirror line, never a second pair of controls.

| Mode | first label | glyph | second label |
|---|---|---|---|
| `speaker` | I speak | → | they hear |
| `participant` | I read | ← | they speak |
| `both` | I speak | → | they hear, plus mirror line |

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Settings/sections/LanguageSection.sentence.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import LanguageSection from './LanguageSection';
import { useAudioStore } from '../../../stores/audioStore';
import useSettingsStore from '../../../stores/settingsStore';
import { Provider } from '../../../types/Provider';

// Follow this file's siblings (LanguageSection.soniox.test.tsx) for the
// standard providers/i18n test wrapper; reuse their render helper if exported.

describe('LanguageSection — mode-verb sentence labels', () => {
  beforeEach(() => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useSettingsStore.getState().updateLocalInference({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  it('speaker mode: I speak → they hear, selectors bound to source/target', () => {
    useAudioStore.setState({ mode: 'speaker' });
    render(<LanguageSection />);
    expect(screen.getByText('I speak')).toBeInTheDocument();
    expect(screen.getByText('they hear')).toBeInTheDocument();
    expect(screen.queryByText('I read')).not.toBeInTheDocument();
    // The first selector is MY language in every mode — the regression guard
    // for the ordering decision (spec Part 3, property 1). Scope to the
    // languages block: the component may render other selects (UI language).
    const pair = within(document.getElementById('languages-section')!);
    const selects = pair.getAllByRole('combobox');
    expect((selects[0] as HTMLSelectElement).value).toBe('ja');
    expect((selects[1] as HTMLSelectElement).value).toBe('en');
  });

  it('participant mode: I read ← they speak, same two fields in the same order', () => {
    useAudioStore.setState({ mode: 'participant' });
    render(<LanguageSection />);
    expect(screen.getByText('I read')).toBeInTheDocument();
    expect(screen.getByText('they speak')).toBeInTheDocument();
    const pair = within(document.getElementById('languages-section')!);
    const selects = pair.getAllByRole('combobox');
    expect((selects[0] as HTMLSelectElement).value).toBe('ja');
    expect((selects[1] as HTMLSelectElement).value).toBe('en');
  });

  it('both mode: speaker line plus a plain-text mirror, no third combobox', () => {
    useAudioStore.setState({ mode: 'both' });
    render(<LanguageSection />);
    expect(screen.getByText('I speak')).toBeInTheDocument();
    // The mirror is derived text, not controls: still exactly two comboboxes
    // inside the languages block.
    const pair = within(document.getElementById('languages-section')!);
    expect(pair.getAllByRole('combobox')).toHaveLength(2);
    const mirror = screen.getByTestId('language-mirror-line');
    expect(mirror.textContent).toContain('They speak');
    expect(mirror.textContent).toContain('I read');
  });

  it('speaker/participant modes render no mirror line', () => {
    useAudioStore.setState({ mode: 'speaker' });
    render(<LanguageSection />);
    expect(screen.queryByTestId('language-mirror-line')).not.toBeInTheDocument();
  });
});
```

Adapt the wrapper/beforeEach to this test file's actual siblings (`LanguageSection.soniox.test.tsx`, `LanguageSection.textOnly.test.tsx`) — their mocking of services/i18n wins over this sketch; the assertions stand.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/Settings/sections/LanguageSection.sentence.test.tsx`
Expected: FAIL — `Unable to find an element with the text: I speak` (current labels are "Your Language"/"Target language").

- [ ] **Step 3: Implement**

In `LanguageSection.tsx`:

```tsx
import { useAudioStore } from '../../../stores/audioStore';
// inside the component:
const audioMode = useAudioStore((s) => s.mode);
const myLabel = audioMode === 'participant'
  ? t('settings.langSentence.iRead', 'I read')
  : t('settings.langSentence.iSpeak', 'I speak');
const theirLabel = audioMode === 'participant'
  ? t('settings.langSentence.theySpeak', 'they speak')
  : t('settings.langSentence.theyHear', 'they hear');
```

Replace the two `<label>` contents in the `language-pair-row` (`{t('simpleConfig.yourLanguage')}` → `{myLabel}`, `{t('simpleConfig.targetLanguage')}` → `{theirLabel}`) **only for the local providers** — non-local providers keep today's labels (their mode semantics differ; the spec scopes the sentence to the engine's vocabulary). Gate: `const sentenceLabels = provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE;` and pick label text accordingly.

The direction glyph: the swap button's icon stays (it is a control); add `aria-label` unchanged. After the pair row, add the mirror line:

```tsx
{sentenceLabels && audioMode === 'both' && (
  <div className="language-mirror-line" data-testid="language-mirror-line">
    {t('settings.langSentence.mirror', 'They speak {{their}} → I read {{mine}}', {
      their: targetLanguageName, mine: sourceLanguageName,
    })}
  </div>
)}
```

where `sourceLanguageName`/`targetLanguageName` come from the already-computed language option lists (`providerConfig.languages.find(l => l.value === currentProviderSettings.sourceLanguage)?.name ?? currentProviderSettings.sourceLanguage`, same for target against `targetLanguages`).

SCSS (append to the section's existing stylesheet, matching its class conventions):

```scss
.language-mirror-line {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary, #9aa0a6);
  font-style: italic;
}
```

en keys (inside the existing `"settings"` object):

```json
"langSentence": {
  "iSpeak": "I speak",
  "iRead": "I read",
  "theyHear": "they hear",
  "theySpeak": "they speak",
  "mirror": "They speak {{their}} → I read {{mine}}"
}
```

Copy stays aligned with `modePicker.desc*` vocabulary ("Your voice → translated for the other side") — same actors, same verbs, no new metaphors.

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/components/Settings/sections/LanguageSection.sentence.test.tsx src/components/Settings/sections/LanguageSection.soniox.test.tsx src/components/Settings/sections/LanguageSection.textOnly.test.tsx`
Expected: PASS — new file green, existing LanguageSection tests untouched (non-local providers keep old labels).

- [ ] **Step 5: Commit**

```bash
git add -A src/components/Settings/sections src/locales/en/translation.json
git commit -m "feat(language): state the pair as a mode-verb sentence for the local providers"
```

---

### Task 3: S0 — resolution notes render under the language pair

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx`
- Test: append to `src/components/Settings/sections/LanguageSection.sentence.test.tsx`

**Interfaces:**
- Consumes: `useLastResolutionNotes()` (`src/stores/modelStore.ts`), `useNativeLastResolutionNotes()` (`src/stores/nativeModelStore.ts`), `describeResolutionNote` (Task 1), `getManifestEntry` (WASM display names), `useNativeCatalog()` (native display names).
- Produces: the `language-resolution-notes` block later referenced by nothing — it is a leaf.

- [ ] **Step 1: Write the failing test**

```tsx
// append to LanguageSection.sentence.test.tsx
describe('LanguageSection — resolution notes', () => {
  it('renders one line per note for the local provider, via describeResolutionNote', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'translation', from: 'opus-mt-en-ja', to: 'qwen-x', reason: 'lang-incompatible' },
      ],
    });
    render(<LanguageSection />);
    const notes = screen.getByTestId('language-resolution-notes');
    expect(notes.textContent).toContain('does not support this direction');
  });

  it('renders nothing when there are no notes', () => {
    useModelStore.setState({ lastResolutionNotes: [] });
    render(<LanguageSection />);
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });

  it('non-local providers never render the block', () => {
    useSettingsStore.setState({ provider: Provider.OPENAI });
    useModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'asr', from: null, to: null, reason: 'no-candidate' },
      ],
    });
    render(<LanguageSection />);
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/Settings/sections/LanguageSection.sentence.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="language-resolution-notes"]`.

- [ ] **Step 3: Implement**

In `LanguageSection.tsx`, below the mirror line / pair row:

```tsx
const wasmNotes = useLastResolutionNotes();
const nativeNotes = useNativeLastResolutionNotes();
const notes =
  provider === Provider.LOCAL_INFERENCE ? wasmNotes
  : provider === Provider.LOCAL_NATIVE ? nativeNotes
  : [];
const nativeCatalog = useNativeCatalog();
const noteName = (id: string): string =>
  provider === Provider.LOCAL_NATIVE
    ? (nativeCatalog[id]?.name ?? id)
    : (getManifestEntry(id)?.name ?? id);
```

```tsx
{notes.length > 0 && (
  <div className="language-resolution-notes" data-testid="language-resolution-notes">
    {notes.map((n, i) => (
      <div key={`${n.direction}-${n.stage}-${i}`} className="language-warning">
        <AlertTriangle size={12} />
        <span>{describeResolutionNote(n, t, noteName)}</span>
      </div>
    ))}
  </div>
)}
```

`language-warning` is this section's existing warning row class — reuse it, no new styles needed beyond a wrapper margin if the sibling rows have one.

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/components/Settings/sections/LanguageSection.sentence.test.tsx`
Expected: PASS (7 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add -A src/components/Settings/sections
git commit -m "feat(language): surface resolution notes where the language change happens"
```

---

### Task 4: textOnly stops resolving TTS (inherited data-layer item)

**Files:**
- Modify: `src/stores/modelStore.ts` (`ensureSelectionReady`), `src/stores/nativeModelStore.ts` (`ensureSelectionReady`)
- Test: append to `src/stores/ensureSelectionReady.test.ts`

Now that notes render (Task 3), a spurious `no-candidate` TTS note under `textOnly` becomes visible noise. The spec's Session gate table: TTS "is not resolved at all when textOnly is on".

**Interfaces:**
- Consumes: the `textOnly` common setting (both stores' `ensureSelectionReady` already read settings via dynamic import; `textOnly` lives on the common settings — read `useSettingsStore.getState().textOnly` in the same block).
- Produces: unchanged signatures; under `textOnly`, the speaker result's `tts` is `null` and NO tts-stage note is emitted for either direction.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/stores/ensureSelectionReady.test.ts
it('does not resolve TTS at all under textOnly — no tts notes, still ready', async () => {
  useSettingsStore.setState({ textOnly: true } as never);
  // Downloaded: ASR + translation for ja→en, NO tts anywhere.
  useModelStore.setState({
    modelStatuses: downloadOnly([...pickIds('asr'), ...pickIds('translation')]),
  });
  const r = await useModelStore.getState().ensureSelectionReady();
  expect(r.ready).toBe(true);
  expect(r.notes.some((n) => n.stage === 'tts')).toBe(false);
});

it('resolves TTS again when textOnly is off', async () => {
  useSettingsStore.setState({ textOnly: false } as never);
  useModelStore.setState({
    modelStatuses: downloadOnly([...pickIds('asr'), ...pickIds('translation')]),
  });
  const r = await useModelStore.getState().ensureSelectionReady();
  expect(r.notes.some((n) => n.stage === 'tts' && n.reason === 'no-candidate')).toBe(true);
});
```

(`downloadOnly`/`pickIds` already exist in this file.)

- [ ] **Step 2: Run to verify the first fails**

Run: `npm run test -- src/stores/ensureSelectionReady.test.ts`
Expected: FAIL — a tts `no-candidate` note is present under textOnly.

- [ ] **Step 3: Implement**

In both stores' `ensureSelectionReady`, read `textOnly` alongside the slice in the existing dynamic-import block, and after resolving each direction, filter under textOnly:

```ts
const stripTts = (r: DirectionResult): DirectionResult =>
  ({ ...r, tts: null, notes: r.notes.filter((n) => n.stage !== 'tts') });
const speaker0 = get().resolve(sourceLanguage, targetLanguage, selections);
const speaker = textOnly ? stripTts(speaker0) : speaker0;
// same for participant
```

(Participant TTS is never resolved into configs anyway, but its notes flow through — strip those too.) The gate formula is untouched (`ready` never depended on tts). Keep the guard application (WASM) ordered as it is: guard first, then strip.

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/stores/ensureSelectionReady.test.ts src/stores/nativeModelStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores
git commit -m "fix(models): skip TTS resolution entirely under textOnly"
```

---

### Task 5: Engine primitives — `EngineAdapter`, `SlotRow`, `Engine.scss`

**Files:**
- Create: `src/components/Settings/engine/EngineTypes.ts`, `src/components/Settings/engine/SlotRow.tsx`, `src/components/Settings/engine/Engine.scss`
- Test: `src/components/Settings/engine/SlotRow.test.tsx`

**Interfaces:**
- Consumes: `Resolved`, `Stage` from selection types; `describeResolutionNote` NOT consumed here (notes render in LanguageSection and the gate copy, not per row).
- Produces (verbatim for Tasks 6–8):

```ts
// EngineTypes.ts
import type { ReactNode } from 'react';
import type { Stage, Resolved } from '../../../lib/local-inference/selection/types';
// (the two ReactNode-typed members below use this import)

export interface SlotCandidate {
  id: string;
  name: string;
  sizeLabel?: string;          // "234 MB" — provider formats it
}

export interface SlotId { dir: string; stage: Stage }   // dir = "ja→en"

export interface EngineAdapter {
  /** The two live directions, speaker first. */
  directions: Array<{ dir: string; src: string; tgt: string }>;
  /** Resolved view of one slot (null = nothing usable). */
  resolved(slot: SlotId): Resolved | null;
  /** Display name for a model id (chips/library share it). */
  displayName(id: string): string;
  /** READY implementations only — the short list an expanded slot shows. */
  readyCandidates(slot: SlotId): SlotCandidate[];
  /** Write an explicit pick ('' = back to auto). */
  select(slot: SlotId, modelId: string): void | Promise<void>;
  /** Per-stage extra controls row (native compute device); absent for WASM. */
  stageExtras?(slot: SlotId): ReactNode;
  /** Gate banner above the blocks (native engine bundle); absent for WASM. */
  gate?: ReactNode;
  /** Storage summary line for the storage row. */
  storageSummary: string;
  /** Which stages a direction renders (participant hides tts today). */
  stagesFor(dir: string, isSpeaker: boolean): Stage[];
  disabled: boolean;           // isSessionActive
}
```

`SlotRow` props: `{ slot: SlotId; label: string; resolved: Resolved | null; displayName(id: string): string; expanded: boolean; onToggle(): void; children?: ReactNode }` — the collapsed row shows `label` + value (`auto · Name` when `source === 'auto'`, bare `Name` when explicit, an em-dash when null); `children` is the expanded picker, rendered only when `expanded`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Settings/engine/SlotRow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlotRow } from './SlotRow';

const resolvedAuto = { modelId: 'sensevoice-int8', source: 'auto' as const };
const resolvedExplicit = { modelId: 'opus-mt-ja-en', source: 'explicit' as const };

describe('SlotRow', () => {
  it("prefixes an auto result with 'auto ·' — required, not decorative", () => {
    render(<SlotRow slot={{ dir: 'ja→en', stage: 'asr' }} label="ASR" resolved={resolvedAuto}
      displayName={() => 'SenseVoice'} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText('auto · SenseVoice')).toBeInTheDocument();
  });

  it('shows an explicit pick bare — no auto prefix', () => {
    render(<SlotRow slot={{ dir: 'ja→en', stage: 'translation' }} label="MT" resolved={resolvedExplicit}
      displayName={() => 'Opus-MT (ja→en)'} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText('Opus-MT (ja→en)')).toBeInTheDocument();
    expect(screen.queryByText(/auto ·/)).not.toBeInTheDocument();
  });

  it('shows an em-dash when nothing resolves', () => {
    render(<SlotRow slot={{ dir: 'ja→en', stage: 'tts' }} label="TTS" resolved={null}
      displayName={() => ''} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders children only when expanded, and toggles via the header', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <SlotRow slot={{ dir: 'ja→en', stage: 'asr' }} label="ASR" resolved={resolvedAuto}
        displayName={() => 'SenseVoice'} expanded={false} onToggle={onToggle}>
        <div data-testid="picker" />
      </SlotRow>);
    expect(screen.queryByTestId('picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ASR/ }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(
      <SlotRow slot={{ dir: 'ja→en', stage: 'asr' }} label="ASR" resolved={resolvedAuto}
        displayName={() => 'SenseVoice'} expanded={true} onToggle={onToggle}>
        <div data-testid="picker" />
      </SlotRow>);
    expect(screen.getByTestId('picker')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/Settings/engine/SlotRow.test.tsx`
Expected: FAIL — missing import.

- [ ] **Step 3: Implement**

```tsx
// src/components/Settings/engine/SlotRow.tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Resolved } from '../../../lib/local-inference/selection/types';
import type { SlotId } from './EngineTypes';
import './Engine.scss';

/**
 * One slot of one direction. Collapsed: label + resolved value ("auto · Name"
 * marks a machine pick — the provenance marker the No-migration design leans
 * on). Expanded (single-open, owned by EnginePage): the caller's picker.
 */
export const SlotRow: React.FC<{
  slot: SlotId;
  label: string;
  resolved: Resolved | null;
  displayName: (id: string) => string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}> = ({ slot, label, resolved, displayName, expanded, onToggle, children }) => {
  const { t } = useTranslation();
  const value = resolved
    ? (resolved.source === 'auto'
        ? t('engineUi.autoValue', 'auto · {{name}}', { name: displayName(resolved.modelId) })
        : displayName(resolved.modelId))
    : '—';
  return (
    <div className="engine-slot" data-slot={`${slot.dir}:${slot.stage}`}>
      <button type="button" className="engine-slot__header" onClick={onToggle} aria-expanded={expanded}>
        <span className="engine-slot__chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="engine-slot__label">{label}</span>
        <span className={`engine-slot__value ${resolved ? '' : 'engine-slot__value--missing'}`}>{value}</span>
      </button>
      {expanded && <div className="engine-slot__body">{children}</div>}
    </div>
  );
};
```

`EngineTypes.ts` exactly as in the Interfaces block above. `Engine.scss` — dark-theme styles matching the settings sections' conventions (`config-section` palette, 12–14px text, `#10a37f` accent):

```scss
.engine-slot {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  &__header {
    display: flex; align-items: center; gap: 8px; width: 100%;
    background: none; border: none; padding: 8px 4px; cursor: pointer;
    color: inherit; text-align: left;
  }
  &__label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #9aa0a6; min-width: 42px; }
  &__value { font-size: 13px; font-family: ui-monospace, monospace; }
  &__value--missing { color: #e74c3c; }
  &__body { padding: 4px 8px 10px 26px; }
}
.engine-direction {
  &__title { font-size: 12px; color: #9aa0a6; margin: 12px 0 2px; }
}
.engine-storage-row, .engine-back-row {
  display: flex; align-items: center; gap: 8px; padding: 10px 4px; cursor: pointer;
  background: none; border: none; color: inherit; width: 100%; text-align: left; font-size: 13px;
}
.engine-back-row { font-weight: 600; }
.engine-picker__option {
  display: flex; align-items: center; gap: 8px; padding: 6px 4px; width: 100%;
  background: none; border: none; color: inherit; cursor: pointer; font-size: 13px;
  &.is-selected { color: #10a37f; }
  &:disabled { opacity: 0.5; cursor: default; }
}
.engine-picker__meta { margin-left: auto; font-size: 11px; color: #9aa0a6; }
.engine-picker__browse { color: #9aa0a6; }
```

en keys — the existing `engine.*` namespace belongs to the sidecar bundle card, so these live under a new top-level `"engineUi"` object (binding everywhere in this plan):

```json
"engineUi": {
  "autoValue": "auto · {{name}}",
  "autoOption": "Auto (currently {{name}})",
  "autoOptionNone": "Auto",
  "browseLibrary": "Browse library",
  "storageRow": "Storage",
  "back": "Back",
  "titleEngine": "Translation engine",
  "titleLibrary": "Library · {{stage}}",
  "titleStorage": "Storage",
  "speakerHeading": "{{src}} → {{tgt}}",
  "inUse": "In use",
  "subtitlesOnly": "Subtitles only"
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/components/Settings/engine/SlotRow.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/engine src/locales/en/translation.json
git commit -m "feat(engine): slot row primitive with the required auto-provenance prefix"
```

---

### Task 6: `EnginePage` + `EngineSurface` — the pages and the push host

**Files:**
- Create: `src/components/Settings/engine/EnginePage.tsx`, `src/components/Settings/engine/EngineSurface.tsx`
- Test: `src/components/Settings/engine/EnginePage.test.tsx`

**Interfaces:**
- Consumes: `EngineAdapter`, `SlotId`, `SlotRow`, `SlotCandidate` (Task 5).
- Produces (Tasks 7–11 rely on these exactly):
  - `EnginePage: React.FC<{ adapter: EngineAdapter; expandedSlot: SlotId | null; onToggleSlot(slot: SlotId): void; onBrowse(slot: SlotId): void; onStorage(): void }>`
  - `EngineSurface: React.FC<{ adapter: EngineAdapter; renderLibrary(slot: SlotId): React.ReactNode; renderStorage(): React.ReactNode; initialSlot?: SlotId | null }>` — owns `pushed: null | {page:'library', slot: SlotId} | {page:'storage'}` and the single-open `expandedSlot` state; renders the in-content back row (`engineUi.back`) on pushed pages; consumes `initialSlot` once to expand a slot on mount (chips deep-linking).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Settings/engine/EnginePage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EngineSurface } from './EngineSurface';
import type { EngineAdapter } from './EngineTypes';

const adapter = (over: Partial<EngineAdapter> = {}): EngineAdapter => ({
  directions: [
    { dir: 'ja→en', src: 'ja', tgt: 'en' },
    { dir: 'en→ja', src: 'en', tgt: 'ja' },
  ],
  resolved: ({ stage }) => (stage === 'tts' ? null : { modelId: 'm1', source: 'auto' }),
  displayName: (id) => (id === 'm1' ? 'Model One' : id),
  readyCandidates: () => [{ id: 'm1', name: 'Model One', sizeLabel: '10 MB' }, { id: 'm2', name: 'Model Two' }],
  select: vi.fn(),
  storageSummary: '796 MB used',
  stagesFor: (_dir, isSpeaker) => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
  disabled: false,
  ...over,
});

const surface = (a = adapter()) => render(
  <EngineSurface adapter={a}
    renderLibrary={(slot) => <div data-testid="library">{slot.stage}</div>}
    renderStorage={() => <div data-testid="storage" />} />);

describe('EngineSurface / EnginePage', () => {
  it('renders both directions, speaker with 3 slots, participant with 2', () => {
    surface();
    expect(screen.getByText('ja → en')).toBeInTheDocument();
    expect(screen.getByText('en → ja')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /ASR/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /TTS/ })).toHaveLength(1);
  });

  it('single-open: expanding one slot collapses the previously open one', () => {
    surface();
    const [asrSpeaker, asrParticipant] = screen.getAllByRole('button', { name: /ASR/ });
    fireEvent.click(asrSpeaker);
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0); // picker open
    fireEvent.click(asrParticipant);
    // still exactly one expanded body
    expect(document.querySelectorAll('.engine-slot__body')).toHaveLength(1);
  });

  it('the expanded picker lists ready candidates + the Auto row, and writes a pick', () => {
    const a = adapter();
    surface(a);
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    expect(screen.getByRole('radio', { name: /Auto/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Model Two/ }));
    expect(a.select).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' }, 'm2');
  });

  it('the browse affordance carries no count', () => {
    surface();
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    const browse = screen.getByRole('button', { name: /Browse library/ });
    expect(browse.textContent).not.toMatch(/\d/);
  });

  it('browse pushes the library with an in-content back row; back returns', () => {
    surface();
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Browse library/ }));
    expect(screen.getByTestId('library')).toHaveTextContent('asr');
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.queryByTestId('library')).not.toBeInTheDocument();
    expect(screen.getByText('ja → en')).toBeInTheDocument();
  });

  it('the storage row pushes the storage page', () => {
    surface();
    fireEvent.click(screen.getByRole('button', { name: /Storage/ }));
    expect(screen.getByTestId('storage')).toBeInTheDocument();
  });

  it('disabled adapter renders pickers disabled', () => {
    surface(adapter({ disabled: true }));
    fireEvent.click(screen.getAllByRole('button', { name: /ASR/ })[0]);
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/components/Settings/engine/EnginePage.test.tsx`
Expected: FAIL — missing imports.

- [ ] **Step 3: Implement**

```tsx
// src/components/Settings/engine/EnginePage.tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, HardDrive } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import { SlotRow } from './SlotRow';
import './Engine.scss';

const STAGE_LABEL_KEY: Record<string, [string, string]> = {
  asr: ['providers.local_inference.modelAsr', 'ASR'],
  translation: ['providers.local_inference.modelTranslation', 'MT'],
  tts: ['providers.local_inference.modelTts', 'TTS'],
};

/** The Engine overview: both directions, three slots each, nothing else. */
export const EnginePage: React.FC<{
  adapter: EngineAdapter;
  expandedSlot: SlotId | null;
  onToggleSlot: (slot: SlotId) => void;
  onBrowse: (slot: SlotId) => void;
  onStorage: () => void;
}> = ({ adapter, expandedSlot, onToggleSlot, onBrowse, onStorage }) => {
  const { t } = useTranslation();
  const isOpen = (s: SlotId) =>
    expandedSlot?.dir === s.dir && expandedSlot?.stage === s.stage;
  return (
    <div className="engine-page">
      {adapter.gate}
      {adapter.directions.map(({ dir, src, tgt }, i) => (
        <div key={dir} className="engine-direction">
          <div className="engine-direction__title">
            {t('engineUi.speakerHeading', '{{src}} → {{tgt}}', { src, tgt })}
          </div>
          {adapter.stagesFor(dir, i === 0).map((stage) => {
            const slot: SlotId = { dir, stage };
            const resolved = adapter.resolved(slot);
            return (
              <SlotRow key={stage} slot={slot} label={t(STAGE_LABEL_KEY[stage][0], STAGE_LABEL_KEY[stage][1])}
                resolved={resolved} displayName={adapter.displayName}
                expanded={isOpen(slot)} onToggle={() => onToggleSlot(slot)}>
                {adapter.stageExtras?.(slot)}
                <div role="radiogroup">
                  <button type="button" role="radio" aria-checked={!resolved || resolved.source === 'auto'}
                    className={`engine-picker__option ${!resolved || resolved.source === 'auto' ? 'is-selected' : ''}`}
                    disabled={adapter.disabled}
                    onClick={() => adapter.select(slot, '')}>
                    {resolved && resolved.source === 'auto'
                      ? t('engineUi.autoOption', 'Auto (currently {{name}})', { name: adapter.displayName(resolved.modelId) })
                      : t('engineUi.autoOptionNone', 'Auto')}
                  </button>
                  {adapter.readyCandidates(slot).map((c) => (
                    <button key={c.id} type="button" role="radio"
                      aria-checked={resolved?.source === 'explicit' && resolved.modelId === c.id}
                      className={`engine-picker__option ${resolved?.source === 'explicit' && resolved.modelId === c.id ? 'is-selected' : ''}`}
                      disabled={adapter.disabled}
                      onClick={() => adapter.select(slot, c.id)}>
                      {c.name}
                      {c.sizeLabel && <span className="engine-picker__meta">{c.sizeLabel}</span>}
                    </button>
                  ))}
                </div>
                <button type="button" className="engine-picker__option engine-picker__browse"
                  onClick={() => onBrowse(slot)}>
                  {t('engineUi.browseLibrary', 'Browse library')}
                  <ChevronRight size={14} />
                </button>
              </SlotRow>
            );
          })}
        </div>
      ))}
      <button type="button" className="engine-storage-row" onClick={onStorage}>
        <HardDrive size={14} />
        {t('engineUi.storageRow', 'Storage')}
        <span className="engine-picker__meta">{adapter.storageSummary}</span>
        <ChevronRight size={14} />
      </button>
    </div>
  );
};
```

```tsx
// src/components/Settings/engine/EngineSurface.tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import { EnginePage } from './EnginePage';

type Pushed = null | { page: 'library'; slot: SlotId } | { page: 'storage' };

/**
 * Push host for the engine family. Back lives HERE, in the content area —
 * PanelBar already carries three tabs + the mode toggle + close in ~360px and
 * has no room for a fourth cluster (spec Part 4).
 */
export const EngineSurface: React.FC<{
  adapter: EngineAdapter;
  renderLibrary: (slot: SlotId) => React.ReactNode;
  renderStorage: () => React.ReactNode;
  initialSlot?: SlotId | null;
}> = ({ adapter, renderLibrary, renderStorage, initialSlot = null }) => {
  const { t } = useTranslation();
  const [expandedSlot, setExpandedSlot] = useState<SlotId | null>(initialSlot);
  const [pushed, setPushed] = useState<Pushed>(null);

  const toggle = (slot: SlotId) =>
    setExpandedSlot((cur) =>
      cur && cur.dir === slot.dir && cur.stage === slot.stage ? null : slot);

  if (pushed) {
    return (
      <div className="engine-surface">
        <button type="button" className="engine-back-row" onClick={() => setPushed(null)}>
          <ArrowLeft size={14} />
          {pushed.page === 'library'
            ? t('engineUi.titleLibrary', 'Library · {{stage}}', { stage: pushed.slot.stage })
            : t('engineUi.titleStorage', 'Storage')}
        </button>
        {pushed.page === 'library' ? renderLibrary(pushed.slot) : renderStorage()}
      </div>
    );
  }
  return (
    <div className="engine-surface">
      <EnginePage adapter={adapter} expandedSlot={expandedSlot} onToggleSlot={toggle}
        onBrowse={(slot) => setPushed({ page: 'library', slot })}
        onStorage={() => setPushed({ page: 'storage' })} />
    </div>
  );
};
```

Note: the back-row label doubles as the pushed page's title (spec: full-width is the only place a complete title fits). The `sessionActiveNotice` banner renders ABOVE the surface in both hosts (SimpleSettings/AdvancedSettings already render it at their top — pushed pages inherit it because the surface is INSIDE that container; no extra code, but Task 9's test pins it).

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/components/Settings/engine/EnginePage.test.tsx src/components/Settings/engine/SlotRow.test.tsx`
Expected: PASS (11 total).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/engine
git commit -m "feat(engine): engine page and push surface — accordion slots, library/storage escapes"
```

---

### Task 7: WASM adapter + Library/Storage bodies + wiring into the provider tab

**Files:**
- Create: `src/components/Settings/engine/useWasmEngineAdapter.ts`, `src/components/Settings/engine/StoragePage.tsx`
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx` (add `stageFilter?: Stage` + `compatibilitySplit?: boolean` props), `src/components/Settings/sections/ProviderSpecificSettings.tsx` (LOCAL_INFERENCE branch)
- Test: `src/components/Settings/engine/useWasmEngineAdapter.test.ts`, `src/components/Settings/engine/StoragePage.test.tsx`

**Interfaces:**
- Consumes: `wasmCandidates`, `useModelStore` (`resolve`, `modelStatuses`, `storageUsedMb`, `deleteModel`, `deleteAllModels`, `downloads`), `useSettingsStore().localInference`, `getManifestEntry`, `getModelSizeMb`, `directionKey`, `emptyDirection`.
- Produces:
  - `useWasmEngineAdapter(): EngineAdapter`
  - `StoragePage: React.FC<{ provider: 'wasm' | 'native' }>` — flat downloaded list with in-use badges, per-model delete with resolver-preview confirm, Clear all (moved from `ModelStorageFooter`), Import (WASM only, reusing `ModelImportModal`).
  - `ModelManagementSection` with `stageFilter` renders ONLY that stage's group; with `compatibilitySplit` it renders two groups — "Supports {{lang}}" expanded (ASR keys on src, TTS on tgt, translation on the pair — the spec's per-stage language table) and "Other languages" collapsed — instead of Recommended/Others at the top level.

**Key behaviors to encode (from the spec, binding):**
- `readyCandidates` = `wasmCandidates(...).pool(stage, src, tgt).filter(c => c.ready && c.hardwareOk)` mapped to `SlotCandidate` (name from `getManifestEntry(id)?.name ?? id`, sizeLabel from `getModelSizeMb`).
- `select(slot, id)` writes `selections[slot.dir] = { ...(selections[slot.dir] ?? emptyDirection()), [slot.stage]: { modelId: id } }` via `updateLocalInference` — and NOTHING on rendering.
- Library incompatible group: cards offer Download, never Use — the existing MMS click-guard already blocks incompatible selects; `compatibilitySplit` must ALSO show, after a download completes in the other-languages group, the line `t('engineUi.availableWhenLang', 'Downloaded. Available when your language is {{lang}}.')` (add the key).
- StoragePage delete confirm: preview by re-running `resolveDirection` for both live directions against `wasmCandidates({...ctx, modelStatuses: {...statuses, [id]: 'not_downloaded'}})` and rendering the diff — `t('engineUi.deleteFallsBack', 'Deleting {{name}}: {{stage}} falls back to {{to}}.')` / `t('engineUi.deleteNoModel', 'Deleting {{name}}: no {{stage}} model remains — sessions cannot start.')`; Clear-all confirm keeps `models.confirmClearAll` and adds `t('engineUi.clearAllKeepsPicks', 'Your selections are remembered and return when models are downloaded again.')`.
- In-use badge: id ∈ resolved stages of either live direction.

- [ ] **Step 1: Write the failing adapter test**

```ts
// src/components/Settings/engine/useWasmEngineAdapter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWasmEngineAdapter } from './useWasmEngineAdapter';
import { useModelStore } from '../../../stores/modelStore';
import useSettingsStore from '../../../stores/settingsStore';
import { getManifestByType } from '../../../lib/local-inference/modelManifest';

const jaAsr = () => getManifestByType('asr').filter(m => m.multilingual || m.languages.includes('ja'));

describe('useWasmEngineAdapter', () => {
  beforeEach(async () => {
    await useSettingsStore.getState().updateLocalInference({
      sourceLanguage: 'ja', targetLanguage: 'en', selections: {},
    });
    useModelStore.setState({ modelStatuses: {}, webgpuAvailable: true });
  });

  it('directions are speaker-first ja→en then en→ja', () => {
    const { result } = renderHook(() => useWasmEngineAdapter());
    expect(result.current.directions.map(d => d.dir)).toEqual(['ja→en', 'en→ja']);
  });

  it('readyCandidates lists only downloaded/usable implementations', () => {
    const first = jaAsr()[0];
    useModelStore.setState({ modelStatuses: { [first.id]: 'downloaded' } });
    const { result } = renderHook(() => useWasmEngineAdapter());
    const ids = result.current.readyCandidates({ dir: 'ja→en', stage: 'asr' }).map(c => c.id);
    expect(ids).toContain(first.id);
    // an un-downloaded ja-capable ASR is absent
    const notDownloaded = jaAsr().find(m => m.id !== first.id && !m.isCloudModel);
    if (notDownloaded) expect(ids).not.toContain(notDownloaded.id);
  });

  it('select writes an explicit pick preserving sibling stages, and "" restores auto', async () => {
    const { result } = renderHook(() => useWasmEngineAdapter());
    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
    const sel = useSettingsStore.getState().localInference.selections['en→ja'];
    expect(sel.translation.modelId).toBe('some-model');
    expect(sel.asr.modelId).toBe('');
    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, ''));
    expect(useSettingsStore.getState().localInference.selections['en→ja']).toBeUndefined();
  });

  it('participant direction renders asr+translation only', () => {
    const { result } = renderHook(() => useWasmEngineAdapter());
    expect(result.current.stagesFor('en→ja', false)).toEqual(['asr', 'translation']);
    expect(result.current.stagesFor('ja→en', true)).toEqual(['asr', 'translation', 'tts']);
  });
});
```

(Selecting `''` on the only-explicit stage empties the direction → the adapter deletes the emptied direction entry, mirroring `applyPrunes`' "no information" rule.)

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement the adapter**

```ts
// src/components/Settings/engine/useWasmEngineAdapter.ts
import { useMemo } from 'react';
import { useModelStore } from '../../../stores/modelStore';
import useSettingsStore from '../../../stores/settingsStore';
import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
import { directionKey, emptyDirection, type Stage } from '../../../lib/local-inference/selection/types';
import { getManifestEntry, getModelSizeMb } from '../../../lib/local-inference/modelManifest';
import type { EngineAdapter, SlotId } from './EngineTypes';

/** LOCAL_INFERENCE's EngineAdapter — resolve() for display, selections for writes. */
export function useWasmEngineAdapter(isSessionActive = false): EngineAdapter {
  const { sourceLanguage, targetLanguage, selections } = useSettingsStore((s) => s.localInference);
  const updateLocalInference = useSettingsStore((s) => s.updateLocalInference);
  const modelStatuses = useModelStore((s) => s.modelStatuses);
  const webgpuAvailable = useModelStore((s) => s.webgpuAvailable);
  const deviceFeatures = useModelStore((s) => s.deviceFeatures);
  const storageUsedMb = useModelStore((s) => s.storageUsedMb);

  return useMemo<EngineAdapter>(() => {
    const speaker = directionKey(sourceLanguage, targetLanguage);
    const participant = directionKey(targetLanguage, sourceLanguage);
    const source = wasmCandidates({ modelStatuses, webgpuAvailable, deviceFeatures });
    const split = (dir: string): [string, string] => {
      const i = dir.indexOf('→');
      return [dir.slice(0, i), dir.slice(i + 1)];
    };
    return {
      directions: [
        { dir: speaker, src: sourceLanguage, tgt: targetLanguage },
        { dir: participant, src: targetLanguage, tgt: sourceLanguage },
      ],
      resolved: (slot) => {
        const [src, tgt] = split(slot.dir);
        return useModelStore.getState().resolve(src, tgt, selections)[slot.stage];
      },
      displayName: (id) => getManifestEntry(id)?.name ?? id,
      readyCandidates: (slot) => {
        const [src, tgt] = split(slot.dir);
        return source.pool(slot.stage, src, tgt)
          .filter((c) => c.ready && c.hardwareOk && c.autoEligible)
          .map((c) => {
            const entry = getManifestEntry(c.id);
            return {
              id: c.id,
              name: entry?.name ?? c.id,
              sizeLabel: entry && !entry.isCloudModel ? `${getModelSizeMb(entry, deviceFeatures)} MB` : undefined,
            };
          });
      },
      select: async (slot, modelId) => {
        const current = selections[slot.dir] ?? emptyDirection();
        const nextDir = { ...current, [slot.stage]: { modelId } };
        const next = { ...selections, [slot.dir]: nextDir };
        if (!nextDir.asr.modelId && !nextDir.translation.modelId && !nextDir.tts.modelId) {
          delete next[slot.dir]; // all-auto directions carry no information
        }
        await updateLocalInference({ selections: next });
      },
      storageSummary: `${storageUsedMb} MB`,
      stagesFor: (_dir, isSpeaker): Stage[] => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
      disabled: isSessionActive,
    };
  }, [sourceLanguage, targetLanguage, selections, modelStatuses, webgpuAvailable, deviceFeatures, storageUsedMb, updateLocalInference, isSessionActive]);
}
```

- [ ] **Step 4: StoragePage — failing test first**

```tsx
// src/components/Settings/engine/StoragePage.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoragePage } from './StoragePage';
import { useModelStore } from '../../../stores/modelStore';
import useSettingsStore from '../../../stores/settingsStore';
import { getManifestByType } from '../../../lib/local-inference/modelManifest';

// Real-manifest ids that can serve ja→en, mirroring ensureSelectionReady.test.ts.
const asrId = () => getManifestByType('asr')
  .find(m => (m.multilingual || m.languages.includes('ja')) && !m.isCloudModel)!.id;
const trIds = () => getManifestByType('translation')
  .filter(m => !m.isCloudModel).map(m => m.id);

describe('StoragePage (wasm)', () => {
  beforeEach(async () => {
    await useSettingsStore.getState().updateLocalInference({
      sourceLanguage: 'ja', targetLanguage: 'en', selections: {},
    });
  });

  it('lists downloaded models with an in-use badge on resolved ones', () => {
    useModelStore.setState({
      modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" />);
    const row = screen.getByTestId(`storage-row-${asrId()}`);
    expect(row).toHaveTextContent('In use'); // resolved ASR for ja→en
  });

  it('delete confirm previews the fallback via the resolver', () => {
    const [tr1, tr2] = trIds();
    useModelStore.setState({
      modelStatuses: { [asrId()]: 'downloaded', [tr1]: 'downloaded', [tr2]: 'downloaded' },
      webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" />);
    fireEvent.click(screen.getByTestId(`storage-delete-${tr1}`));
    // With a second translation model downloaded, the preview names a fallback,
    // not a dead end.
    expect(screen.getByTestId('storage-confirm').textContent).toMatch(/falls back to/);
  });

  it('deleting the last translation model warns sessions cannot start', () => {
    const tr = trIds()[0];
    useModelStore.setState({
      modelStatuses: { [asrId()]: 'downloaded', [tr]: 'downloaded' }, webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" />);
    fireEvent.click(screen.getByTestId(`storage-delete-${tr}`));
    expect(screen.getByTestId('storage-confirm').textContent).toMatch(/sessions cannot start/);
  });

  it('Clear all says selections are remembered — and does not touch them', async () => {
    await useSettingsStore.getState().updateLocalInference({
      selections: { 'ja→en': { asr: { modelId: asrId() }, translation: { modelId: '' }, tts: { modelId: '' } } },
    });
    useModelStore.setState({ modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true });
    render(<StoragePage provider="wasm" />);
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    expect(screen.getByTestId('storage-confirm').textContent)
      .toMatch(/selections are remembered/i);
    expect(useSettingsStore.getState().localInference.selections['ja→en'].asr.modelId).toBe(asrId());
  });

  it('Import is present for wasm and absent for native', () => {
    const { unmount } = render(<StoragePage provider="wasm" />);
    expect(screen.getByRole('button', { name: /Import/ })).toBeInTheDocument();
    unmount();
    render(<StoragePage provider="native" />);
    expect(screen.queryByRole('button', { name: /Import/ })).not.toBeInTheDocument();
  });
});
```

Adapt the store seeding to this suite's actual sibling mocks (`ModelManagementSection.test.tsx` mocks `ServiceFactory` — copy its top-of-file mock block verbatim). The assertions stand. Then implement `StoragePage.tsx`: rows = ids with `modelStatuses[id] === 'downloaded'` (wasm) / `statuses[id] === 'ready'` (native), `data-testid="storage-row-<id>"`, each with `displayName`, size, an `engineUi.inUse` badge when the id appears in either live direction's resolved stages, and a delete button `data-testid="storage-delete-<id>"` → an inline `data-testid="storage-confirm"` block whose copy comes from re-running `resolveDirection` for both directions against `wasmCandidates({...ctx, modelStatuses: {...statuses, [id]: 'not_downloaded'}})` (native: `nativeCandidates({catalog, statuses: {...statuses, [id]: 'absent'}})`) and diffing against the current resolution (`engineUi.deleteFallsBack` / `engineUi.deleteNoModel` per changed stage). Clear all + Import relocated from `ModelStorageFooter`/`ModelImportModal` (the footer component itself stays — the management sections still render it when used standalone as the Library body; do not delete it).

- [ ] **Step 5: Wire the LOCAL_INFERENCE provider branch**

In `ProviderSpecificSettings.tsx`, hoist the hook above the return (hooks must run unconditionally):

```tsx
const wasmAdapter = useWasmEngineAdapter(isSessionActive);
```

then in the LOCAL_INFERENCE branch replace the `<ModelManagementSection … />` element with:

```tsx
<EngineSurface
  adapter={wasmAdapter}
  renderLibrary={(slot) => (
    <ModelManagementSection isSessionActive={isSessionActive}
      stageFilter={slot.stage} compatibilitySplit />
  )}
  renderStorage={() => <StoragePage provider="wasm" />}
/>
```

`TtsSpeedControl`/`SpeechModeControl`/`TranslationPromptControl`/`VadControl` stay below, unchanged. Add the `stageFilter`/`compatibilitySplit` props to `ModelManagementSection`: `stageFilter` renders only the matching `ModelGroup` (its `defaultExpanded` true); `compatibilitySplit` replaces the group's `RecommendedOthers` with the two compatibility groups (compatible via each stage's existing language predicate; the second group in a collapsed `ModelGroup` titled `t('engineUi.otherLanguages', 'Other languages')` — add the key), and renders `engineUi.availableWhenLang` under a just-downloaded incompatible card (track via the existing download-completion state the section already has; if none exists, render the line statically under every DOWNLOADED incompatible card — the simpler truth).

- [ ] **Step 6: Run the component tests + full suite**

Run: `npm run test -- src/components/Settings/engine src/components/Settings/sections/ModelManagementSection.test.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`
Expected: PASS. Then full suite — baseline file set only.

- [ ] **Step 7: Commit**

```bash
git add -A src/components src/locales/en/translation.json
git commit -m "feat(engine): WASM engine surface — adapter, storage page, library wiring"
```

---

### Task 8: Native adapter + wiring

**Files:**
- Create: `src/components/Settings/engine/useNativeEngineAdapter.ts` (+ test)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (same `stageFilter`/`compatibilitySplit` props), `src/components/Settings/sections/ProviderSpecificSettings.tsx` (LOCAL_NATIVE branch)

**Interfaces:**
- Consumes: `nativeCandidates`, `useNativeModelStore` (`resolve`, `catalog`, `statuses`, `sizes`), `useSettingsStore().localNative`, `EngineSection` (the existing sidecar-bundle gate component), the per-stage compute-device segmented control currently rendered by NMMS group headers.
- Produces: `useNativeEngineAdapter(isSessionActive): EngineAdapter` with `gate` = `<EngineSection />` (rendered at the top of the Engine page per spec) and `stageExtras(slot)` = the compute device segmented control for that stage (moved from the NMMS group header into the expanded slot; NMMS keeps rendering it too when used standalone as the Library — the control is a shared subcomponent, extract it if it is currently inline).

The adapter, in full (the shape parallels Task 7's; every native difference is in this code):

```ts
// src/components/Settings/engine/useNativeEngineAdapter.ts
import React, { useMemo } from 'react';
import { useNativeModelStore } from '../../../stores/nativeModelStore';
import useSettingsStore from '../../../stores/settingsStore';
import { nativeCandidates } from '../../../lib/local-inference/selection/candidates.native';
import { directionKey, emptyDirection, type Stage } from '../../../lib/local-inference/selection/types';
import { EngineSection } from '../sections/EngineSection';
import type { EngineAdapter } from './EngineTypes';

const fmtBytes = (b?: number): string | undefined =>
  b && b > 0 ? `${Math.round(b / 1_048_576)} MB` : undefined;

/** LOCAL_NATIVE's EngineAdapter — sidecar catalog + statuses, EngineSection gate. */
export function useNativeEngineAdapter(isSessionActive = false): EngineAdapter {
  const { sourceLanguage, targetLanguage, selections } = useSettingsStore((s) => s.localNative);
  const updateLocalNative = useSettingsStore((s) => s.updateLocalNative);
  const catalog = useNativeModelStore((s) => s.catalog);
  const statuses = useNativeModelStore((s) => s.statuses);

  return useMemo<EngineAdapter>(() => {
    const speaker = directionKey(sourceLanguage, targetLanguage);
    const participant = directionKey(targetLanguage, sourceLanguage);
    const source = nativeCandidates({ catalog, statuses });
    const split = (dir: string): [string, string] => {
      const i = dir.indexOf('→');
      return [dir.slice(0, i), dir.slice(i + 1)];
    };
    const storageBytes = Object.entries(statuses)
      .filter(([, s]) => s === 'ready')
      .reduce((sum, [id]) => sum + (catalog[id]?.sizeBytes ?? 0), 0);
    return {
      directions: [
        { dir: speaker, src: sourceLanguage, tgt: targetLanguage },
        { dir: participant, src: targetLanguage, tgt: sourceLanguage },
      ],
      resolved: (slot) => {
        const [src, tgt] = split(slot.dir);
        return useNativeModelStore.getState().resolve(src, tgt, selections)[slot.stage];
      },
      displayName: (id) => catalog[id]?.name ?? id,
      readyCandidates: (slot) => {
        const [src, tgt] = split(slot.dir);
        return source.pool(slot.stage, src, tgt)
          .filter((c) => c.ready && c.hardwareOk)
          .map((c) => ({ id: c.id, name: catalog[c.id]?.name ?? c.id, sizeLabel: fmtBytes(catalog[c.id]?.sizeBytes) }));
      },
      select: async (slot, modelId) => {
        const current = selections[slot.dir] ?? emptyDirection();
        const prev = current[slot.stage];
        // Spec rule: a variant pin survives only while its model does.
        const variant = prev.modelId === modelId ? prev.variant : undefined;
        const nextDir = { ...current, [slot.stage]: { modelId, ...(variant ? { variant } : {}) } };
        const next = { ...selections, [slot.dir]: nextDir };
        if (!nextDir.asr.modelId && !nextDir.translation.modelId && !nextDir.tts.modelId) {
          delete next[slot.dir];
        }
        await updateLocalNative({ selections: next });
      },
      // The sidecar bundle gate renders at the top of the Engine page; while
      // the sidecar is starting/absent, the catalog is empty and every ready
      // list is naturally empty — EngineSection carries the messaging.
      gate: React.createElement(EngineSection),
      stageExtras: (slot) => nativeDeviceControl(slot.stage), // extracted in Step 3b below
      storageSummary: fmtBytes(storageBytes) ?? '0 MB',
      stagesFor: (_dir, isSpeaker): Stage[] => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
      disabled: isSessionActive,
    };
  }, [sourceLanguage, targetLanguage, selections, catalog, statuses, updateLocalNative, isSessionActive]);
}
```

Step 3b: `nativeDeviceControl(stage)` — extract the per-stage compute-device segmented control from `NativeModelManagementSection`'s group headers into a shared subcomponent (same file or a small `NativeDeviceControl.tsx` beside it) that reads/writes `asrDevice`/`translationDevice`/`ttsDevice` on the localNative slice exactly as the header control does today; NMMS keeps using it in its headers (standalone Library use), the adapter reuses it in `stageExtras`. Verify the control's current markup in NMMS before extracting and keep it byte-identical.

Adapter tests mirror Task 7's four (directions order / ready-only filtering / select-preserves-siblings-and-clears-emptied-direction / participant stages), built on the `M()` fixture-catalog idiom from `nativeModelStore.test.ts`, PLUS one test pinning the variant rule:

```ts
it('select keeps the variant pin only when the modelId is unchanged', async () => {
  await useSettingsStore.getState().updateLocalNative({
    selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: 'qwen2.5-0.5b', variant: 'fp8' }, tts: { modelId: '' } } },
  });
  const { result } = renderHook(() => useNativeEngineAdapter());
  await act(() => result.current.select({ dir: 'ja→en', stage: 'translation' }, 'qwen2.5-0.5b'));
  expect(useSettingsStore.getState().localNative.selections['ja→en'].translation.variant).toBe('fp8');
  await act(() => result.current.select({ dir: 'ja→en', stage: 'translation' }, 'other-model'));
  expect(useSettingsStore.getState().localNative.selections['ja→en'].translation.variant).toBeUndefined();
});
```

Wire the LOCAL_NATIVE branch of `ProviderSpecificSettings.tsx` the same way (EngineSection moves INTO the adapter's `gate` — remove the branch's standalone `<EngineSection />`), with `renderLibrary` → `NativeModelManagementSection stageFilter compatibilitySplit`, `renderStorage` → `<StoragePage provider="native" />`.

Run the native section/component tests + full suite; commit:

```bash
git add -A src/components
git commit -m "feat(engine): native engine surface — adapter with gate, device extras, variant-preserving select"
```

---

### Task 9: Simple-mode host + banner inheritance

**Files:**
- Modify: `src/components/Settings/SimpleSettings/SimpleSettings.tsx`, `src/components/Settings/Settings.tsx`, `src/stores/settingsStore.ts`
- Test: `src/components/Settings/SimpleSettings/SimpleSettings.engine.test.tsx` (new)

**Interfaces:**
- Produces: `engineSlotTarget: { dir: string; stage: Stage } | null` + `setEngineSlotTarget(t)` on settingsStore (NOT persisted — add to the never-persist ephemeral fields; follow how `settingsNavigationTarget` is declared). Consumed by SimpleSettings (below) and Task 10's chips.

Behavior: when `engineSlotTarget` is set and `uiMode === 'basic'` and the provider is local, SimpleSettings renders the `EngineSurface` (with `initialSlot` = the target, then clears the target) INSTEAD of its section list, prefixed by its existing `session-warning` banner block — pushed pages inherit the banner because it renders above the surface. A back affordance ABOVE the surface (`engine-back-row` with `engineUi.titleEngine` as label) returns to the section list (clears a local `open` state). In advanced mode the target is consumed by the provider tab (Task 10).

Tests: (1) setting the target in basic mode renders the surface with that slot expanded; (2) the banner renders above it when `isSessionActive`; (3) back returns to the normal section list; (4) non-local providers ignore the target.

Implementation sketch (SimpleSettings):

```tsx
const engineSlotTarget = useSettingsStore((s) => s.engineSlotTarget);
const setEngineSlotTarget = useSettingsStore((s) => s.setEngineSlotTarget);
const [engineOpen, setEngineOpen] = useState<SlotId | null>(null);
useEffect(() => {
  if (engineSlotTarget && isLocalProvider) {
    setEngineOpen(engineSlotTarget);
    setEngineSlotTarget(null);
  }
}, [engineSlotTarget, isLocalProvider, setEngineSlotTarget]);
```

Render branch: `engineOpen ? <banner/> + backRow + <EngineSurface adapter={…} initialSlot={engineOpen} …/> : <existing sections/>`. The adapter is chosen by provider (both hooks called unconditionally, per hooks rules). Commit:

```bash
git commit -am "feat(engine): simple-mode engine host with slot deep-linking"
```

---

### Task 10: S7 — chips target slots; the flip-workflow artifacts die

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx` (both local chip blocks + the OTHER row), `src/components/Settings/Settings.tsx` (drop the model-* rows from `NAVIGATION_TAB_MAP` if now unused), `src/locales/en/translation.json`
- Test: `src/components/Settings/sections/ProviderSection.chips.test.tsx` (new)

**Interfaces:**
- Consumes: `setEngineSlotTarget` (Task 9), `setActiveTab` context if the section has access — chips in ADVANCED mode call `setEngineSlotTarget({dir: speakerDir, stage})` AND navigate to the provider tab via the existing `navigateToSettings('provider-section')`-style mechanism; in SIMPLE mode `setEngineSlotTarget` alone (Task 9's host reacts). The `setUIMode('advanced')` + `setTimeout` jump is deleted.

Chip click handler (replacing all three `onClick`s in each local block):

```tsx
const openSlot = (stage: Stage) => {
  const dir = directionKey(settingsForProvider.sourceLanguage, settingsForProvider.targetLanguage);
  setEngineSlotTarget({ dir, stage });
  if (!isSimpleMode) navigateToSettings('provider-section'); // tab switch only; no mode switch
};
```

(Consult how the component learns `isSimpleMode` — it reads `uiMode` from the store; the provider tab consumes `engineSlotTarget` by passing it as `initialSlot` to `EngineSurface` in `ProviderSpecificSettings` and clearing it — add that consumption in the same edit.)

Deletions in the same task:
- The `OTHER` participant chip block (`settings.participantModelHint` render) — the whole region.
- `settings.participantModelHint` from `src/locales/en/translation.json` (leave other locales' dead copies — they are unreachable once en drops the render; a locale sweep is Task 11).

Tests: (1) chip click in advanced sets `engineSlotTarget` with the speaker dir + right stage and does NOT call `setUIMode`; (2) chip click in simple sets the target and nothing else; (3) the OTHER row no longer renders for LOCAL_INFERENCE; (4) chips still display resolved names (`auto`-agnostic — chips show the model name, the provenance lives on the Engine page).

Commit:

```bash
git commit -am "feat(engine): chips deep-link to their slot; the flip-the-pair workflow artifacts are gone"
```

---

### Task 11: Locale sweep + dead keys + final verification

**Files:**
- Modify: `src/locales/en/translation.json` (+ the locale-consistency test if one guards key parity)
- Modify: whatever the sweep finds

Steps:
- [ ] Remove now-dead keys from `en`: `settings.participantModelHint`, `providers.local_inference.participant`, and re-grep the three keys the spec flagged as dead pre-branch (`settings.missingModelsWarning`, `settings.downloadModelType`, `settings.modelTypeAsr|Translation|Tts`) — delete any with zero `src/` references, from `en` only.
- [ ] `grep -rn "setUIMode('advanced')" src/components/Settings/sections/ProviderSection.tsx` → must be empty.
- [ ] `grep -rn "participantModelHint" src/ --include="*.tsx" --include="*.ts"` → must be empty.
- [ ] Hardcoded-English check on new surfaces: every user-visible string in `src/components/Settings/engine/` goes through `t()` (the spec called out `"In use"` / `"Estimated"` as pre-existing violations — fix them in ProviderSection while touching it, keys `engineUi.inUse` / `engineUi.estimated`).
- [ ] Full suite (baseline file set), `npx tsc --noEmit` ≤ 337, `npm run build` clean.
- [ ] Commit: `chore(engine): locale sweep and dead-key removal`

---

## Final verification

- [ ] `npm run test` — same 12-file baseline set, nothing new
- [ ] `npx tsc --noEmit` ≤ 337; `npm run build` exit 0
- [ ] Manual render check (memory: settle UI decisions by rendering): `npm run dev`, open Settings → provider tab with LOCAL_INFERENCE — Engine page shows both directions; expand each slot; push Library and Storage and back; switch to simple mode and click each chip; switch AudioMode through speaker/participant/both and watch the sentence.
- [ ] The spec's S4–S7 rows and Part 3 sentence table each map to a shipped surface.
