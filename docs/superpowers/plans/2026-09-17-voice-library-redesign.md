# Voice Library Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the voice `<select>` with a self-drawn popover list where every voice — preset or cloned — can be auditioned from its own row, and move voice creation and delete confirmation into their own modals.

**Architecture:** `VoiceLibrarySection` becomes a thin composition root over three new components: `VoicePicker` (trigger + popover, APG grid keyboard model, per-row play/rename/delete, facet row, `＋ Add a voice…`), `VoiceCreateModal` (transcript + import + record + drop, carrying the capture code that lives in the section today) and `VoiceDeleteModal` (confirmation, replacing `window.confirm`). Auditionability becomes a per-entry flag so each provider adapter decides which of its voices have a ▶; Soniox previews presets through its existing managed/BYOK path, Local Native previews them per-voice-language on its dedicated sidecar connection, and Supertonic gets no ▶.

**Tech Stack:** React 19 + TypeScript, `@floating-ui/react` 0.27 (already a dependency), SCSS modules per component, Vitest + @testing-library/react, i18next with 30 JSON catalogs.

**Spec:** `docs/superpowers/specs/2026-09-16-voice-library-redesign-design.md`

## Global Constraints

- **English only** in code, comments, docstrings and commit messages. Chat stays Chinese; the repo stays English.
- **TDD.** Write the failing test, run it, see it fail for the stated reason, then implement. A test that passes before the implementation is a *guard* and this plan labels it as such.
- **`fireEvent`, never `@testing-library/user-event`.** That package is NOT a dependency of this project — it is absent from root `package.json` and from `node_modules`, and no file in `src` imports it. 64 existing suites use `fireEvent` from `@testing-library/react`. The idioms, taken from those suites and from `VoicePicker.test.tsx` (which ports this plan's own first suite and passes): open the picker with `fireEvent.click(screen.getByRole('button', { expanded: false }))`; type with `fireEvent.change(input, { target: { value: 'x' } })`; commit an inline edit with `fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })`; choose a facet with `fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'male' } })`; press a key with `fireEvent.keyDown(el, { key: 'ArrowDown' })`. `fireEvent` is synchronous, so drop the `await`s a `userEvent` version would need — EXCEPT where the code under test defers work (a `requestAnimationFrame`, a promise), which needs `await vi.waitFor(() => expect(…))`. Fire `Escape` at the node whose listener you mean: `document` for floating-ui's `useDismiss` (`AuthOverlay.test.tsx:71`), `window` for the two modals, which add their own listener the way `ModelImportModal.test.tsx:114` does.
- **Error handling policy** (`CLAUDE.md`): never add `console.error` / `console.warn` to `src/components`; existing `console.warn` calls that MOVE with code keep their exact text and count (`src/lib/diagnostics/consoleLedger.consistency.test.ts` pins per-file counts — moving a call between files means updating that ledger in the same commit).
- **`previewable` semantics** (spec §4.1): the component renders ▶ iff `onPreview && entry.previewable && !entry.disabled`. Absent = inherit the group default: `custom` → true, `builtin` → false.
- **Removed capability fields** (spec §2.7, §4.2): `presentation` and `curation` disappear from `VoiceLibraryCapability`; so do `renderRow`, the show-all expander, `showAll`/`showFewer` copy, and `supportsBaseSelect` usage *in this component* (`ProviderSection` keeps its own).
- **Retired copy** (spec §8): `voiceLibrary.showAll`, `voiceLibrary.showFewer`, `voiceLibrary.manageImported`, `voiceLibrary.deleteConfirm`. Of those four, only `manageImported` (`VoiceLibrarySection.tsx:861`) and `deleteConfirm` (`:377`) are still read by any code; `showAll`/`showFewer` are already dead keys, so retiring them touches no rendering at all. **New copy** — SIX keys, not seven: `addVoice`, `addVoiceTitle`, `deleteTitle`, `deleteBody`, `previewFailed`, `filterCount`. There is deliberately no `voiceLibrary.cancel`: `common.cancel` already exists, and both modal siblings in this very directory render it as `t('common.cancel', 'Cancel')` (`ModelImportModal.tsx:343`, `SonioxCloneConfirmModal.tsx:223`) — Tasks 5 and 6 do the same. All six are added to **all 30** catalogs under `src/locales/<lang>/translation.json`, because `src/locales/locales.consistency.test.ts` asserts every catalog's flattened key set equals `en`'s exactly, with matching `{placeholders}` and no empty strings.
- **Keyboard contract** (spec §7): popover is `role="grid"`, rows are `role="row"`, controls are `role="gridcell"`; `↑`/`↓` move rows, `←`/`→` move within a row, `Home`/`End` jump, letters type-ahead, `Enter` selects + closes, `Esc` closes and returns focus to the trigger, outside click dismisses. Positioning and dismissal reuse `@floating-ui/react` the way `ModeDevicePopover` does — and that means ALL of what it does: `useFloating` + `useDismiss` **inside a `FloatingPortal`** (`ModeDevicePopover.tsx:234`). The portal is not optional here: `Settings.scss` sets `overflow: hidden` on the panel (lines 10, 15) and `overflow-y: auto` on the scrolling body, so an in-place popover is clipped by the panel and scrolls away from its trigger. Task 3 therefore also uses `strategy: 'fixed'` and wraps the floating element in `FloatingFocusManager` (`returnFocus`), which is what makes `Esc` return focus to the trigger — so no task hand-rolls an Escape branch (`useDismiss`'s `escapeKey` defaults to true). The installed version is 0.27.19 and types `AriaRole` as `'tooltip'|'dialog'|'alertdialog'|'menu'|'listbox'|'grid'|'tree'`, so `useRole(context, { role: 'grid' })` is available. The two-axis grid navigation and type-ahead are new code: floating-ui's `useListNavigation` (used by `ExportButton.tsx` for its one-cell-per-row menu) models a uniform grid via `cols`, and these rows are ragged — 2 cells for a preset, 4 for a clone.
- **No test in this repo can prove a translation key is used** (learned in Task 6, and it is why six localisation regressions passed every gate). The suites never initialise `react-i18next` with resources, so `t(key, default)` returns `default` for EVERY key — a passing assertion about translated copy proves only that the inline English default was rendered, and is indistinguishable from code that ignores the key entirely. Consequences: (1) never claim a test covers localisation unless that test supplies its own keyed `t` mock; (2) when a key lookup is the behaviour under test, put it in a small dedicated file with such a mock, rather than mocking `react-i18next` file-wide inside a suite other tasks depend on (`VoicePicker.facetTranslation.test.tsx` is the precedent); (3) when auditing whether the redesign kept shipped copy, compare the KEYS referenced by the old and new code — the tests cannot tell you.
- **Querying the picker from a test** (learned in Task 4, applies to every task that re-points a suite at this control). Three things bite:
  1. **A row's `gridcell` accessible name includes everything in the cell**, so a row with a subtitle reads as `"Mine My Voices"`, not `"Mine"` — `getByRole('gridcell', { name: 'Mine' })` silently finds NOTHING. The builtin fixtures have empty subtitles, which is why exact-name queries worked in Tasks 3 and 4. Use a regex, or `within(row)`, whenever the row has a subtitle. **The same trap applies to the TRIGGER button** (learned in Task 7): its accessible name concatenates the selected voice's label with its subtitle, so a regex meant to match one row can match the trigger too. Scope row queries with `within(screen.getByRole('grid'))` rather than searching the whole document.
  2. **Focus is deliberately split**: column 0 (the name cell) focuses the `[role="gridcell"]` element itself, while action columns (▶ / rename / delete) focus their own control. A focus assertion must target accordingly. The reason is double-fire avoidance — see Task 4.
  3. **`Enter` only acts when the event target's role is `gridcell`**, so a test must dispatch `Enter` on the focused CELL, never on the grid container. Arrow keys may be fired on the container.
- **Modal precedent**: both modals mirror `ModelImportModal` — a fixed overlay that closes on backdrop click, an inner `role="dialog" aria-modal="true"` with `onClick={(e) => e.stopPropagation()}`, an Escape listener, and a `&__x` close button.
- **Client gates**, run from the worktree root before each commit: `npx vitest run src/components/Settings/sections/` green; `npx tsc --noEmit 2>&1 | grep -E "VoicePicker|VoiceCreateModal|VoiceDeleteModal|VoiceLibrarySection|SonioxVoiceSection|NativeVoiceSection|LocalInferenceVoiceSection|VoiceLibrary"` adds NO LINE that was not already there. It does not print nothing, and expecting that is wrong: at Task 1's commit this grep already prints **10** pre-existing lines — 9 in `SonioxVoiceSection.test.tsx` (an unused import, `Element` narrowing, mock prop-shape mismatches) and 1 at `VoiceLibrarySection.tsx:190` (a `Float32Array<ArrayBufferLike>` vs `<ArrayBuffer>` generic mismatch). The gate is therefore a DIFF against that baseline: capture the grep's output before you start, compare after, and report any line your task added. Fixing the 10 is out of scope. (The repo also carries ~313 `tsc` errors outside this filter — ignore those entirely.); `npx vitest run src/locales/locales.consistency.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts` green.
- **Conventional commits**, one per task unless a task says otherwise. Do not push: the branch is PR #542 and the user pushes when the whole feature is done.
- **Baseline at plan time**: `VoiceLibrarySection.tsx` 948 lines, `VoiceLibrarySection.scss` 399 lines; suites `VoiceLibrarySection.test.tsx` 18, `…facets.test.tsx` 17, `…optgroupLabel.test.tsx` 2, `SonioxVoiceSection.test.tsx` 61, `NativeVoiceSection.test.tsx` 21, `LocalInferenceVoiceSection.test.tsx` 4; `src/components/Settings/sections/` as a directory 413 tests.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/components/Settings/sections/VoicePicker.tsx` | Trigger + popover. Renders rows from `VoiceEntry[]`, owns open/close, grid keyboard navigation, type-ahead, inline rename, and the facet row. Calls props for everything else; no data fetching, no audio. |
| `src/components/Settings/sections/VoicePicker.scss` | Popover, rows, row buttons, facet row (moved from `VoiceLibrarySection.scss`). |
| `src/components/Settings/sections/VoicePicker.test.tsx` | Rows, ▶ gating, selection, facets, keyboard, dismissal. |
| `src/components/Settings/sections/VoiceCreateModal.tsx` | Transcript field, Import/Record controls, drop zone, `manageNote`. Owns the capture code moved out of the section (recording graph, countdown, `handleFiles`). |
| `src/components/Settings/sections/VoiceCreateModal.scss` | Overlay + dialog + toolbar + drop zone. |
| `src/components/Settings/sections/VoiceCreateModal.test.tsx` | `importModes` gating, transcript gating, drop, `multipleImport`, Escape/backdrop, note. |
| `src/components/Settings/sections/VoiceDeleteModal.tsx` | Name, consequence sentence, Cancel / Delete. |
| `src/components/Settings/sections/VoiceDeleteModal.test.tsx` | Names the voice; Cancel calls nothing; Delete calls `onDelete` once. |

**Modified**

| File | Change |
|---|---|
| `src/types/VoiceLibrary.ts` | Drop `presentation` and `curation` from `VoiceLibraryCapability`. |
| `src/components/Settings/sections/VoiceLibrarySection.tsx` | Composition root: audio playback state, which modal is open, and the three children. Deletes the `<select>`/`<optgroup>` block, `renderRow`, `renderManageRow`, the `<details>` manage block, `showAll`, `richSelect`, the capture code (moved) and the `window.confirm` delete. |
| `src/components/Settings/sections/VoiceLibrarySection.scss` | Keeps section/info/capture-error/selected-description; loses manage-block, group, select-btn, show-all, manage-list/row, name-edit rules; facet + row rules move to `VoicePicker.scss`. |
| `src/components/Settings/sections/VoiceLibrarySection.test.tsx` | Rewritten to the composition root's surface (the row/keyboard/modal cases live in the new files' suites). |
| `src/components/Settings/sections/VoiceLibrarySection.facets.test.tsx` | Re-pointed at `VoicePicker`'s facet row; its 17 filtering cases keep their assertions. |
| `src/components/Settings/sections/SonioxVoiceSection.tsx` | `previewable: true` on presets; capability loses two fields; `handlePreview` no longer assumes a clone. |
| `src/components/Settings/sections/NativeVoiceSection.tsx` | `previewable: true` on presets; `handlePreview` accepts `builtin:` ids and resolves the sample per voice language; capability loses two fields. |
| `src/components/Settings/sections/LocalInferenceVoiceSection.tsx` | Capability loses two fields; presets keep no ▶. |
| `src/lib/local-inference/native/nativeVoiceStores.ts` | Capability literal loses `presentation`. |
| `src/locales/<lang>/translation.json` (30) | 7 keys added, 4 retired. |
| `src/lib/diagnostics/consoleLedger.consistency.test.ts` | Per-file `console.warn` counts follow the code that moved. |

**Deleted**

| File | Why |
|---|---|
| `src/components/Settings/sections/VoiceLibrarySection.optgroupLabel.test.tsx` | Pins `<legend>` inside `<optgroup>` for a `<select>` this redesign removes. |

---

## Task 1: Capability shrinks and every entry declares auditionability

**Files:**
- Create: `src/lib/voiceLibrary/voicePreviewable.ts`
- Create: `src/lib/voiceLibrary/voicePreviewable.test.ts`
- Modify: `src/types/VoiceLibrary.ts` (`VoiceLibraryCapability`)
- Modify: `src/components/Settings/sections/VoiceLibrarySection.tsx` (`VoiceEntry`, the `isDropdown`/`curation` reads)
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx:846-860`, `src/components/Settings/sections/LocalInferenceVoiceSection.tsx:88`, `src/components/Settings/sections/NativeVoiceSection.tsx:87-89`, `src/lib/local-inference/native/nativeVoiceStores.ts:148-153`
- Test: `src/components/Settings/sections/VoiceLibrarySection.test.tsx`

**Interfaces:**
- Produces: `VoiceEntry.previewable?: boolean`; `VoiceLibraryCapability` without `presentation` / `curation`. Every later task consumes both.

This task is deliberately first and deliberately mechanical: it makes the type
change that `npx tsc --noEmit` then turns into the worklist for Tasks 2–8.
While `presentation` is gone the section still renders its dropdown branch —
that code dies in Task 6. Keep it compiling by reading the removed flags as
constants (`const isDropdown = true;`) with a comment pointing at Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/voiceLibrary/voicePreviewable.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canAuditionVoice } from './voicePreviewable';

describe('canAuditionVoice', () => {
  it('lets a clone audition by default — a clip or a cloned voice stands behind it', () => {
    expect(canAuditionVoice({ group: 'custom' })).toBe(true);
  });

  it('refuses a preset by default — most providers publish no way to synthesize one', () => {
    expect(canAuditionVoice({ group: 'builtin' })).toBe(false);
  });

  it('honours an explicit flag in both directions', () => {
    expect(canAuditionVoice({ group: 'builtin', previewable: true })).toBe(true);
    expect(canAuditionVoice({ group: 'custom', previewable: false })).toBe(false);
  });

  it('refuses a disabled entry whatever it declares — nothing playable stands behind it', () => {
    expect(canAuditionVoice({ group: 'custom', disabled: true })).toBe(false);
    expect(canAuditionVoice({ group: 'builtin', previewable: true, disabled: true })).toBe(false);
  });
});
```

Why a pure helper and not a rendering assertion here: in the CURRENT UI a ▶
renders only inside the manage list, which by definition lists removable
voices — so a preset cannot show one until `VoicePicker` exists (Task 3, whose
suite has exactly that rendering case). Widening the manage list now would put
a ▶ on all 200 Soniox presets in a surface Task 6 deletes, and it breaks 14 of
21 `NativeVoiceSection` cases and 26 of 61 `SonioxVoiceSection` cases on
duplicate-text queries. The helper is also what keeps the default rule in ONE
place: Task 3's picker imports it rather than restating it.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/voiceLibrary/voicePreviewable.test.ts`
Expected: FAIL at import — `Failed to resolve import "./voicePreviewable"`.

- [ ] **Step 3: Add the field and shrink the capability**

In `src/types/VoiceLibrary.ts`, delete the `curation` and `presentation` members of `VoiceLibraryCapability` (keep every other field and its docstring).

In `src/components/Settings/sections/VoiceLibrarySection.tsx`, add to `VoiceEntry` after `disabled`:

```ts
  /** Whether THIS entry can be auditioned. Absent = inherit the group default:
   *  a `custom` entry can (a clip or a cloned voice stands behind it), a
   *  `builtin` entry cannot. A provider whose presets are auditionable sets it
   *  true on those entries (Soniox, Local Native); one whose presets are not
   *  leaves it alone (Supertonic). Auditionability is a property of the VOICE,
   *  not of the provider: Local Native's clip-required families have clones
   *  that cannot speak yet, and a future Palabra roster mixes builtins that
   *  publish a sample URL with clones still processing. */
  previewable?: boolean;
```

Create `src/lib/voiceLibrary/voicePreviewable.ts` — the default rule, in one
place, so the section and (Task 3) the picker cannot drift apart:

```ts
/**
 * Whether a voice can be auditioned.
 *
 * `previewable` absent means "inherit the group default": a cloned voice can
 * (a clip or a cloned voice stands behind it), a preset cannot (most providers
 * publish no way to synthesize one). A provider whose presets ARE auditionable
 * sets the flag on those entries — Soniox, whose preset id is the TTS
 * request's `voice` field, and Local Native, which synthesizes a preset on its
 * dedicated preview connection. A disabled entry never auditions: a clone
 * still processing or a "(deleted voice)" placeholder has nothing playable
 * behind it.
 *
 * Takes the fields it reads rather than a whole `VoiceEntry` so it stays a
 * pure function with no dependency on the component module.
 */
export function canAuditionVoice(v: {
  group: 'builtin' | 'custom';
  previewable?: boolean;
  disabled?: boolean;
}): boolean {
  if (v.disabled) return false;
  return v.previewable ?? v.group === 'custom';
}
```

Import it in `VoiceLibrarySection.tsx` and use it in `renderPreviewButton`'s
guard, replacing the `v.removable` test:

```ts
    if (!onPreview || !canAuditionVoice(v)) return null;
```

This changes no rendering today: the only rows that exist are the manage
list's, which are removable and therefore auditionable under the same rule.
Presets get their ▶ when `VoicePicker` renders them (Task 3).

Replace the two removed capability reads:

```ts
  // `presentation` is gone from the capability: there is one presentation now.
  // The dropdown branch below is deleted in Task 6, which is when this and the
  // list branch both disappear.
  const isDropdown = true;
```

and delete the `curatedBuiltins` / `hiddenBuiltins` memos plus the `showAll` state and its button (they are list-mode-only and unreachable once `isDropdown` is constant).

- [ ] **Step 4: Follow the type errors to the four capability sites**

Run: `npx tsc --noEmit 2>&1 | grep -E "VoiceLibrary|VoiceSection|nativeVoiceStores"`

Remove `presentation: 'dropdown'` and `curation: false` from each site it names:
`SonioxVoiceSection.tsx` (~line 848–852), `LocalInferenceVoiceSection.tsx:88`,
`NativeVoiceSection.tsx:87–89` (`DEFAULT_LIBRARY_CAPABILITY`), and
`nativeVoiceStores.ts:148–153`. Change nothing else at those sites.

- [ ] **Step 5: Mark the presets that can be auditioned**

In `SonioxVoiceSection.tsx`, inside `entries`' `builtin` map (~line 719), add `previewable: true,` beside `removable: false,` with the comment:

```ts
      // A Soniox voice id IS the `voice` field of the TTS request for presets
      // and clones alike, so a preset auditions through the same path (spec §6.1).
      previewable: true,
```

In `NativeVoiceSection.tsx`, inside `toBuiltin` (~line 310), add:

```ts
      // Presets audition in THEIR OWN language on the dedicated preview
      // connection (spec §6.2); Task 5 teaches handlePreview the `builtin:` id.
      previewable: true,
```

Leave `LocalInferenceVoiceSection.tsx` alone: Supertonic presets stay without ▶ (spec §10).

- [ ] **Step 6: Run the tests and the gates**

Run: `npx vitest run src/components/Settings/sections/` → green (the new case passes; `…optgroupLabel.test.tsx` and the rest still pass — nothing there reads the removed fields).
Run: `npx tsc --noEmit 2>&1 | grep -E "VoicePicker|VoiceCreateModal|VoiceDeleteModal|VoiceLibrarySection|SonioxVoiceSection|NativeVoiceSection|LocalInferenceVoiceSection|VoiceLibrary"` → no output.

- [ ] **Step 7: Commit**

```bash
git add src/types/VoiceLibrary.ts src/components/Settings/sections/VoiceLibrarySection.tsx src/components/Settings/sections/VoiceLibrarySection.test.tsx src/components/Settings/sections/SonioxVoiceSection.tsx src/components/Settings/sections/LocalInferenceVoiceSection.tsx src/components/Settings/sections/NativeVoiceSection.tsx src/lib/local-inference/native/nativeVoiceStores.ts
git commit -m "feat(voice): entries declare auditionability; drop the dead presentation and curation flags"
```

---

## Task 2: The copy

**Files:**
- Modify: `src/locales/en/translation.json` and the other 29 catalogs under `src/locales/*/translation.json`
- Test: `src/locales/locales.consistency.test.ts` (existing; it is the gate, not a new test)

**Interfaces:**
- Produces: SIX keys — `voiceLibrary.addVoice`, `.addVoiceTitle`, `.deleteTitle`, `.deleteBody` (`{name}`), `.previewFailed`, `.filterCount` (`{shown}`, `{total}`). There is deliberately NO `.cancel`: `common.cancel` already exists in every catalog and Tasks 5 and 6 render that instead (`ModelImportModal.tsx:343` and `SonioxCloneConfirmModal.tsx:223` are the precedents). Tasks 3, 5, 6, 7 and 8 read these keys; Task 4 is keyboard-only and reads none.

Copy lands before the UI that reads it so no task has to ship an untranslated
string. The retired keys go in the same commit: leaving them would leave the
30 catalogs carrying copy nothing renders.

- [ ] **Step 1: Run the consistency test to see it green first**

Run: `npx vitest run src/locales/locales.consistency.test.ts`
Expected: PASS. This is the baseline — it must be green before you start so a failure later is unambiguously yours.

- [ ] **Step 2: Add the six keys to `en`, remove the four retired ones**

In `src/locales/en/translation.json`, inside `"voiceLibrary"`, add:

```json
    "addVoice": "Add a voice…",
    "addVoiceTitle": "Add a voice",
    "deleteTitle": "Delete voice",
    "deleteBody": "Delete \"{name}\"? This also removes the reference recording stored on this device.",
    "previewFailed": "Could not synthesize a preview for this voice.",
    "filterCount": "{shown} of {total}",
```

and delete `"showAll"`, `"showFewer"`, `"manageImported"`, `"deleteConfirm"`.

- [ ] **Step 3: Watch the consistency test fail**

Run: `npx vitest run src/locales/locales.consistency.test.ts`
Expected: FAIL — "locale catalogs stay in lockstep with en" reports 29 catalogs whose key set no longer equals `en`'s.

- [ ] **Step 4: Mirror the change into the other 29 catalogs**

Translate, do not copy English through. Placeholders must survive verbatim
(`{name}`, `{shown}`, `{total}`) — the same test checks them. The Japanese,
Chinese (both), Korean and German strings, for reference:

| Key | ja | zh_CN | zh_TW | ko | de |
|---|---|---|---|---|---|
| `addVoice` | `音声を追加…` | `添加声音…` | `新增聲音…` | `음성 추가…` | `Stimme hinzufügen…` |
| `addVoiceTitle` | `音声を追加` | `添加声音` | `新增聲音` | `음성 추가` | `Stimme hinzufügen` |
| `deleteTitle` | `音声を削除` | `删除声音` | `刪除聲音` | `음성 삭제` | `Stimme löschen` |
| `deleteBody` | `「{name}」を削除しますか？この端末に保存された参照音声も削除されます。` | `删除「{name}」？这台设备上保存的参考录音也会被删除。` | `刪除「{name}」？這台裝置上儲存的參考錄音也會被刪除。` | `"{name}"을(를) 삭제하시겠습니까? 이 기기에 저장된 참조 녹음도 삭제됩니다.` | `„{name}" löschen? Die auf diesem Gerät gespeicherte Referenzaufnahme wird ebenfalls gelöscht.` |
| `previewFailed` | `この音声のプレビューを合成できませんでした。` | `无法为这个声音合成试听。` | `無法為這個聲音合成試聽。` | `이 음성의 미리 듣기를 합성할 수 없습니다.` | `Für diese Stimme konnte keine Hörprobe erzeugt werden.` |
| `filterCount` | `{total} 件中 {shown} 件` | `{total} 个中的 {shown} 个` | `{total} 個中的 {shown} 個` | `{total}개 중 {shown}개` | `{shown} von {total}` |

For the remaining **24** languages, write the same **six** strings in that language, keeping the placeholders and the `…` ellipsis character. The roster is exactly: ar, bn, es, fa, fi, fil, fr, he, hi, id, it, ms, nl, pl, pt_BR, pt_PT, ru, sv, ta, te, th, tr, uk, vi. Verify it against the directory rather than trusting this list (`find src/locales -name translation.json` returns 30: these 24, plus `en` and the five tabled above — ja, zh_CN, zh_TW, ko, de). There is no `hu`, `no` or `ro` catalog in this repo; do not create one. `fil`, `ta` and `te` DO exist and are easy to miss. Remove the four retired keys from every catalog.

- [ ] **Step 5: Run the consistency test to verify it passes**

Run: `npx vitest run src/locales/locales.consistency.test.ts`
Expected: PASS — key sets equal, placeholders aligned, no empty strings.

- [ ] **Step 6: Confirm nothing still reads the retired keys**

Run: `grep -rn "showAll\|showFewer\|manageImported\|deleteConfirm" src/ --include=*.ts --include=*.tsx`
Expected: only `VoiceLibrarySection.tsx`'s soon-to-be-deleted dropdown/list code (Task 6) and its current tests. Note what it prints in your report; do not fix those here.

- [ ] **Step 7: Commit**

```bash
git add src/locales
git commit -m "i18n(voice): copy for the voice picker's add and delete modals"
```

---

## Task 3: `VoicePicker` — trigger, rows and selection

**Files:**
- Create: `src/components/Settings/sections/VoicePicker.tsx`
- Create: `src/components/Settings/sections/VoicePicker.scss`
- Create: `src/components/Settings/sections/VoicePicker.test.tsx`

**Interfaces:**
- Consumes: `VoiceEntry` (with `previewable`) and `VoiceLibraryCapability` from Task 1; `voiceLibrary.addVoice` / `.filterCount` from Task 2; `matchesVoiceFacets`, `facetVocabulary`, `hasActiveFacets`, `humanizeFacetValue` from `src/lib/voiceLibrary/voiceFacets`.
- Produces:

```ts
export interface VoicePickerProps {
  voices: VoiceEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Row ▶. Resolves to the audio to play, or null when there is nothing to play. */
  onPreview?: (id: string, signal?: AbortSignal) => Promise<{ audio: Float32Array; sampleRate: number } | null>;
  /** Disabled-with-a-reason state for every ▶ (a live session, no sample sentence). */
  previewUnavailableReason?: string;
  /** Which row is mid-synthesis, and which row is currently sounding. Owned by
   *  the parent because the AudioContext lives there. */
  playingId: string | null;
  loadingId: string | null;
  onRename?: (id: string, name: string) => Promise<void>;
  /** Opens the delete modal; the picker never deletes directly. */
  onAskDelete: (id: string, label: string) => void;
  /** Opens the create modal. Absent → no `＋ Add a voice…` row. */
  onAddVoice?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  capability: VoiceLibraryCapability;
  isSessionActive?: boolean;
}
```

Task 4 adds keyboard navigation to this component; Task 6 wires it into the
section. Row markup lands here in its final shape so Task 4 only adds focus
management.

- [ ] **Step 1: Write the failing tests**

Create `src/components/Settings/sections/VoicePicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
// STALE — DO NOT COPY THE INTERACTIONS BELOW. Task 3 is complete, and its
// committed suite (`src/components/Settings/sections/VoicePicker.test.tsx`)
// drives everything with `fireEvent`, because `@testing-library/user-event` is
// not a dependency of this project. The assertions in this block are the ones
// that shipped; only the interaction mechanism differs. Read the committed file
// for the real idioms, and see this plan's Global Constraints. Left here
// unrewritten on purpose: the code is the record for a finished task, and
// editing 21 dead lines would only invite a diff nobody needs.
import userEvent from '@testing-library/user-event';
import VoicePicker from './VoicePicker';

const base = {
  selectedId: 'builtin:Grace',
  onSelect: vi.fn(),
  onAskDelete: vi.fn(),
  playingId: null,
  loadingId: null,
  capability: { importModes: [] as ('upload' | 'record')[] },
};

const GRACE = {
  id: 'builtin:Grace', label: 'Grace', group: 'builtin' as const, removable: false, previewable: true,
  meta: { facets: { gender: 'female', style: ['calm', 'soft'], description: 'Unhurried American guide voice.' } },
};
const ALEX = { id: 'builtin:Alex', label: 'Alex', group: 'builtin' as const, removable: false };
const MINE = { id: 'custom:1', label: 'Mine', group: 'custom' as const, removable: true };

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('VoicePicker', () => {
  it('shows the selected voice on the trigger and no rows until it is opened', () => {
    render(<VoicePicker {...base} voices={[GRACE, ALEX]} />);
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('Grace');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('opens on click and renders name plus facets for a preset (R2) and a marker for a clone', async () => {
    render(<VoicePicker {...base} voices={[GRACE, MINE]} />);
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText(/female · calm · soft/)).toBeInTheDocument();
    expect(within(grid).getByText('Grace')).toBeInTheDocument();
    expect(within(grid).getByText('Mine')).toBeInTheDocument();
  });

  it('renders a play control only where onPreview and previewable and not disabled all hold', async () => {
    render(
      <VoicePicker
        {...base}
        voices={[GRACE, ALEX, MINE, { ...MINE, id: 'custom:2', label: 'Busy', disabled: true }]}
        onPreview={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    // Grace (opted in) and Mine (clone default) — not Alex, not the disabled clone.
    expect(screen.getAllByRole('button', { name: /play/i })).toHaveLength(2);
  });

  it('selects and closes on the name, and does neither on play', async () => {
    const onSelect = vi.fn();
    const onPreview = vi.fn().mockResolvedValue(null);
    render(<VoicePicker {...base} voices={[GRACE, ALEX]} onSelect={onSelect} onPreview={onPreview} />);
    await userEvent.click(screen.getByRole('button', { expanded: false }));

    await userEvent.click(screen.getAllByRole('button', { name: /play/i })[0]);
    expect(onPreview).toHaveBeenCalledWith('builtin:Grace', expect.anything());
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('grid')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('gridcell', { name: 'Alex' }));
    expect(onSelect).toHaveBeenCalledWith('builtin:Alex');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('shows a spinner on the row being synthesized and a replay icon once it has played', async () => {
    const { rerender } = render(<VoicePicker {...base} voices={[GRACE]} onPreview={vi.fn()} loadingId="builtin:Grace" />);
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { name: /synthesiz/i })).toBeDisabled();
    rerender(<VoicePicker {...base} voices={[GRACE]} onPreview={vi.fn()} playingId="builtin:Grace" />);
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('disables every play control with the given reason', async () => {
    render(<VoicePicker {...base} voices={[GRACE, MINE]} onPreview={vi.fn()} previewUnavailableReason="Stop the session to preview this voice." />);
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    const buttons = screen.getAllByRole('button', { name: 'Stop the session to preview this voice.' });
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b).toBeDisabled());
  });

  it('renames a clone in place and never offers rename or delete on a preset', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onAskDelete = vi.fn();
    render(<VoicePicker {...base} voices={[GRACE, MINE]} onRename={onRename} onAskDelete={onAskDelete} />);
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getAllByRole('button', { name: /rename/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /delete/i })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /rename/i }));
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');
    expect(onRename).toHaveBeenCalledWith('custom:1', 'Renamed');
  });

  it('asks the parent to delete rather than deleting or confirming itself', async () => {
    const onAskDelete = vi.fn();
    render(<VoicePicker {...base} voices={[MINE]} onAskDelete={onAskDelete} />);
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onAskDelete).toHaveBeenCalledWith('custom:1', 'Mine');
  });

  it('offers the add row only when a parent handed it a handler', async () => {
    const onAddVoice = vi.fn();
    const { rerender } = render(<VoicePicker {...base} voices={[GRACE]} />);
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByRole('button', { name: /add a voice/i })).not.toBeInTheDocument();

    rerender(<VoicePicker {...base} voices={[GRACE]} onAddVoice={onAddVoice} />);
    await userEvent.click(screen.getByRole('button', { name: /add a voice/i }));
    expect(onAddVoice).toHaveBeenCalledTimes(1);
  });

  it('narrows presets by facet without touching clones, and counts what it shows', async () => {
    render(
      <VoicePicker
        {...base}
        voices={[GRACE, { ...ALEX, meta: { facets: { gender: 'male' } } }, MINE]}
        capability={{ importModes: [], facetFilter: true }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    await userEvent.selectOptions(screen.getByLabelText(/gender/i), 'male');
    const grid = screen.getByRole('grid');
    expect(within(grid).queryByText('Grace')).not.toBeInTheDocument();
    expect(within(grid).getByText('Alex')).toBeInTheDocument();
    expect(within(grid).getByText('Mine')).toBeInTheDocument();     // clones never filtered
    expect(within(grid).getByText('1 of 2')).toBeInTheDocument();
  });

  it('keeps the selected preset listed even when the filter excludes it', async () => {
    render(
      <VoicePicker
        {...base}
        voices={[GRACE, { ...ALEX, meta: { facets: { gender: 'male' } } }]}
        capability={{ importModes: [], facetFilter: true }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    await userEvent.selectOptions(screen.getByLabelText(/gender/i), 'male');
    expect(within(screen.getByRole('grid')).getByText('Grace')).toBeInTheDocument();
  });

  it('disables selection while a session is active but still allows auditioning', async () => {
    const onSelect = vi.fn();
    render(<VoicePicker {...base} voices={[GRACE]} onSelect={onSelect} onPreview={vi.fn()} isSessionActive />);
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('gridcell', { name: 'Grace' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /play/i })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run them and watch every case fail**

Run: `npx vitest run src/components/Settings/sections/VoicePicker.test.tsx`
Expected: FAIL at import — `Failed to resolve import "./VoicePicker"`.

- [ ] **Step 3: Write the component**

Create `src/components/Settings/sections/VoicePicker.tsx`:

```tsx
import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, Pencil, Trash2, Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import {
  useFloating, useClick, useDismiss, useRole, useInteractions,
  FloatingPortal, FloatingFocusManager,
  autoUpdate, offset, flip, shift, size,
} from '@floating-ui/react';
import type { VoiceEntry } from './VoiceLibrarySection';
import type { VoiceLibraryCapability, VoiceFacetCriteria } from '../../../types/VoiceLibrary';
import {
  matchesVoiceFacets, facetVocabulary, hasActiveFacets, humanizeFacetValue,
} from '../../../lib/voiceLibrary/voiceFacets';
import './VoicePicker.scss';

/**
 * The voice picker: a trigger that reads like a <select>, and a popover that
 * behaves like a grid.
 *
 * Why not a <select>: an <option> may not contain interactive content, so a
 * per-row ▶ (the point of this control) is impossible in one — and the
 * extension's Chrome 116 floor has no `appearance: base-select` at all, so
 * even rich option markup would flatten there. Going custom makes both moot:
 * Electron and the extension run this same code.
 *
 * Why `role="grid"` and not `role="listbox"`: a row carries a primary action
 * (select) plus up to three buttons. An `option` with buttons inside is not a
 * listbox, so this is the APG grid pattern — rows of cells, two-axis arrow
 * movement (Task 4). Keeping listbox semantics would have meant moving the
 * actions out of the row, which is the one thing this redesign exists to do.
 */
export interface VoicePickerProps {
  voices: VoiceEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  onPreview?: (id: string, signal?: AbortSignal) => Promise<{ audio: Float32Array; sampleRate: number } | null>;
  previewUnavailableReason?: string;
  playingId: string | null;
  loadingId: string | null;
  onRename?: (id: string, name: string) => Promise<void>;
  onAskDelete: (id: string, label: string) => void;
  onAddVoice?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  capability: VoiceLibraryCapability;
  isSessionActive?: boolean;
}

const VoicePicker: React.FC<VoicePickerProps> = ({
  voices, selectedId, onSelect, onPreview, previewUnavailableReason,
  playingId, loadingId, onRename, onAskDelete, onAddVoice, onRefresh, refreshing,
  capability, isSessionActive = false,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [criteria, setCriteria] = useState<VoiceFacetCriteria>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    // `fixed` + the FloatingPortal below are load-bearing, not taste:
    // `Settings.scss` sets `overflow: hidden` on the panel (lines 10 and 15)
    // and `overflow-y: auto` on the scrolling body, so an absolutely
    // positioned popover inside that subtree is clipped by the panel and
    // scrolls away from its own trigger. `ExportButton.tsx` is the existing
    // precedent in this repo and does exactly this pair.
    strategy: 'fixed',
    middleware: [
      offset(4),
      flip(),
      shift({ padding: 8 }),
      // Clamp to the space available so a 200-row roster scrolls inside the
      // popover instead of running off-screen.
      size({
        padding: 8,
        apply({ availableHeight, rects, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(160, Math.min(320, availableHeight))}px`,
            minWidth: `${rects.reference.width}px`,
          });
        },
      }),
    ],
  });
  // `useClick` gives the trigger Enter/Space activation and toggling for free;
  // `useDismiss` closes on outside press AND on Escape (its `escapeKey` option
  // defaults to true — do NOT hand-roll an Escape branch); `useRole` stamps the
  // ARIA relationship — and `'dialog'`, not `'grid'`, is deliberate.
  //
  // `PanelBar` (the Settings panel's own bar, rendered by `Settings.tsx:161`)
  // keeps a document-level Escape listener that COLLAPSES THE WHOLE PANEL. It
  // stands down in exactly two cases: `e.defaultPrevented`, or
  // `isVisibleDialogOpen()` finding an element with `role="dialog"` that has no
  // `display: none` ancestor (`PanelBar.tsx:21-30, 37-39`). floating-ui's
  // `useDismiss` satisfies NEITHER: its Escape handler calls
  // `event.stopPropagation()` but never `preventDefault()`
  // (`floating-ui.react.mjs:2629,2644`), and stopPropagation does not silence a
  // sibling listener on the same node — both are on `document`. So with
  // `role="grid"` on the floating element, one Escape would close this popover
  // AND collapse the settings panel behind it. This is the first floating
  // popover in `src/components/Settings/`, so nothing existing exercises it.
  //
  // `role="dialog"` on the floating WRAPPER is how this repo already solves it
  // (`SubtitleBar.tsx:146`, `MainPanel.tsx:786` both say so). The grid
  // semantics are unaffected: the wrapper is a dialog that CONTAINS the facet
  // row and the `role="grid"` element below, which is well-formed ARIA. Do not
  // hand-roll an Escape handler to get the same effect.
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);

  const presets = useMemo(() => voices.filter((v) => v.group === 'builtin'), [voices]);
  const clones = useMemo(() => voices.filter((v) => v.group === 'custom'), [voices]);
  const facetsOn = !!capability.facetFilter;
  const vocabulary = useMemo(() => facetVocabulary(presets), [presets]);
  const matched = useMemo(
    () => (facetsOn ? presets.filter((v) => matchesVoiceFacets(v, criteria)) : presets),
    [presets, facetsOn, criteria],
  );
  // The selected preset is never filtered out: a picker whose value names no
  // visible row reads as "my voice is gone" rather than "it does not match".
  const shownPresets = useMemo(() => {
    if (!facetsOn) return presets;
    const keep = new Set(matched.map((v) => v.id));
    return presets.filter((v) => keep.has(v.id) || v.id === selectedId);
  }, [presets, matched, facetsOn, selectedId]);

  const selected = voices.find((v) => v.id === selectedId);

  /** `female · calm · soft` — R2's row subtitle, from metadata the roster
   *  already carries. Clones carry none, so they get the group marker. */
  const rowSubtitle = (v: VoiceEntry): string => {
    if (v.group === 'custom') return t('voiceLibrary.myVoices', 'My Voices');
    const f = v.meta?.facets;
    const parts = [f?.gender, ...(f?.style ?? [])].filter(Boolean) as string[];
    if (parts.length === 0 && v.meta?.language) return v.meta.language;
    return parts.slice(0, 3).map((p) => humanizeFacetValue(p)).join(' · ');
  };

  const commitRename = async (id: string) => {
    const name = editName.trim();
    setEditingId(null);
    if (name && onRename) await onRename(id, name);
  };

  const previewButton = (v: VoiceEntry) => {
    if (!onPreview || !canAudition(v)) return null;
    if (previewUnavailableReason) {
      return (
        <div role="gridcell">
          <button type="button" className="voice-row__btn" disabled
            aria-label={previewUnavailableReason} title={previewUnavailableReason}>
            <Play size={13} />
          </button>
        </div>
      );
    }
    const loading = loadingId === v.id;
    const playing = playingId === v.id;
    const label = loading
      ? t('voiceLibrary.synthesizing', 'Synthesizing…')
      : playing ? t('voiceLibrary.stopPreview', 'Stop') : t('voiceLibrary.play', 'Play');
    return (
      <div role="gridcell">
        <button
          type="button"
          className={`voice-row__btn${playing ? ' is-playing' : ''}`}
          // Disabled while synthesizing so a second click cannot start a
          // second synthesis (which would spend the user's money twice).
          disabled={loading}
          aria-label={label}
          title={label}
          onClick={() => { void onPreview(v.id, undefined); }}
        >
          {loading ? <span className="voice-row__spinner" aria-hidden="true" />
            : playing ? <Square size={13} /> : <Play size={13} />}
        </button>
      </div>
    );
  };

  const row = (v: VoiceEntry) => {
    const isSelected = v.id === selectedId;
    if (editingId === v.id) {
      return (
        <div role="row" className="voice-row" key={v.id}>
          <div role="gridcell">
            <input
              autoFocus
              className="voice-row__edit"
              value={editName}
              aria-label={t('voiceLibrary.rename', 'Rename')}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => void commitRename(v.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(v.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
            />
          </div>
        </div>
      );
    }
    return (
      <div role="row" className={`voice-row${isSelected ? ' is-selected' : ''}`} key={v.id}>
        <div role="gridcell" aria-selected={isSelected}>
          <button
            type="button"
            className="voice-row__pick"
            disabled={isSessionActive || v.disabled}
            aria-label={v.label}
            onClick={() => { onSelect(v.id); setOpen(false); }}
          >
            <span className="voice-row__name">{v.label}</span>
            <span className="voice-row__sub">{rowSubtitle(v)}</span>
          </button>
        </div>
        {previewButton(v)}
        {v.removable && onRename && (
          <div role="gridcell">
            <button type="button" className="voice-row__btn"
              aria-label={t('voiceLibrary.rename', 'Rename')} title={t('voiceLibrary.rename', 'Rename')}
              onClick={() => { setEditingId(v.id); setEditName(v.label); }}>
              <Pencil size={13} />
            </button>
          </div>
        )}
        {v.removable && (
          <div role="gridcell">
            <button type="button" className="voice-row__btn voice-row__btn--danger"
              aria-label={t('voiceLibrary.delete', 'Delete')} title={t('voiceLibrary.delete', 'Delete')}
              onClick={() => onAskDelete(v.id, v.label)}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    );
  };

  const facetRow = () => {
    if (!facetsOn) return null;
    // ALL FIVE dimensions the facet model supports, single-select each. The
    // shipped section filters on five and that is jiangzhuo's settled decision;
    // an earlier draft of this sketch listed only gender/age/accent, which was
    // not a design choice but an accident of this loop — `useCase` and `style`
    // are `string[]` in `VoiceFacetCriteria` while the other three are
    // `string | null`, so they did not fit the single cast below and were
    // quietly dropped. Dropping a shipped filter is not this plan's call.
    const dims: Array<[keyof VoiceFacetCriteria, string]> = [
      ['gender', t('voiceLibrary.filter.genderLabel', 'Gender')],
      ['age', t('voiceLibrary.filter.ageLabel', 'Age')],
      ['accent', t('voiceLibrary.filter.accentLabel', 'Accent')],
      ['useCase', t('voiceLibrary.filter.useCaseLabel', 'Use case')],
      ['style', t('voiceLibrary.filter.styleLabel', 'Style')],
    ];
    // Read and write through these rather than casting, because two of the
    // five are arrays. A single-select over an array dimension stores exactly
    // one element, which is what `matchesVoiceFacets`'s `hasEvery` wants: ALL
    // listed tags must be present on the voice, and there is one.
    const ARRAY_DIMS = new Set<keyof VoiceFacetCriteria>(['useCase', 'style']);
    const readDim = (dim: keyof VoiceFacetCriteria): string =>
      ARRAY_DIMS.has(dim)
        ? ((criteria[dim] as string[] | undefined)?.[0] ?? '')
        : ((criteria[dim] as string | null | undefined) ?? '');
    const writeDim = (dim: keyof VoiceFacetCriteria, val: string) =>
      setCriteria((c) => ({
        ...c,
        [dim]: ARRAY_DIMS.has(dim) ? (val ? [val] : undefined) : (val || null),
      }));
    return (
      <div className="voice-pop__facets">
        {dims.map(([dim, label]) => {
          const values = (vocabulary as Record<string, string[] | undefined>)[dim] ?? [];
          if (values.length === 0) return null;
          return (
            <select
              key={dim}
              className="select-dropdown voice-pop__facet"
              aria-label={label}
              value={readDim(dim)}
              onChange={(e) => writeDim(dim, e.target.value)}
            >
              {/* The neutral option is the dimension's own `any*` string, not
                  its label: the shipped section renders "Any gender", and
                  `anyGender`/`anyAge`/`anyAccent`/`anyUseCase`/`anyStyle` are
                  already translated in all 30 catalogs. Using the label here
                  regresses that copy and leaves five keys dead. */}
              <option value="">{anyLabel(dim)}</option>
              {values.map((val) => (
                // Facet VALUES are translated per dimension — the shipped
                // section does `t('voiceLibrary.filter.<dim>.<value>')` with
                // `humanizeFacetValue` only as the fallback, and the catalogs
                // carry 3 genders, 3 ages, 18 accents, 5 use cases and 16
                // styles. Calling `humanizeFacetValue` alone renders every
                // option in English in all 30 locales and orphans ~45 strings
                // per catalog. (The ROW SUBTITLE is different and stays raw
                // lower-case per R2 — that surface was settled deliberately.)
                <option key={val} value={val}>
                  {t(`voiceLibrary.filter.${dim}.${val}`, humanizeFacetValue(val))}
                </option>
              ))}
            </select>
          );
        })}
        {hasActiveFacets(criteria) && (
          <button type="button" className="voice-pop__clear" onClick={() => setCriteria({})}>
            {t('voiceLibrary.filter.clear', 'Clear filters')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="voice-picker">
      <button
        type="button"
        ref={(el) => { triggerRef.current = el; refs.setReference(el); }}
        className="voice-picker__trigger"
        aria-expanded={open}
        aria-haspopup="grid"
        disabled={isSessionActive && !onPreview}
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
      >
        <span className="voice-picker__value">
          {selected?.label ?? selectedId}
          <span className="voice-picker__value-sub">{selected ? rowSubtitle(selected) : ''}</span>
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <FloatingPortal>
        {/* The portal and `strategy: 'fixed'` are load-bearing, not polish:
            `Settings.scss` sets `overflow: hidden` on the panel (lines 10, 15)
            and `overflow-y: auto` on its scrolling body, so a popover rendered
            in place is clipped by the panel and scrolls away from its trigger.
            `ModeDevicePopover.tsx:234` — the precedent this plan's Global
            Constraints name — portals for the same reason.
            `FloatingFocusManager` owns focus: it moves focus in on open and
            `returnFocus` puts it back on the trigger when `useDismiss` closes
            on Escape. Task 4 adds `initialFocus={gridRef}` here and must NOT
            hand-roll an Escape branch. */}
        <FloatingFocusManager context={context} modal={false} returnFocus>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="voice-pop"
          {...getFloatingProps()}
        >
          {facetRow()}
          <div role="grid" aria-label={t('voiceLibrary.voice', 'Voice')} className="voice-pop__grid">
            <div className="voice-pop__group">{t('voiceLibrary.myVoices', 'My Voices')}</div>
            {onAddVoice && (
              <div role="row" className="voice-row voice-row--add">
                <div role="gridcell">
                  <button type="button" className="voice-row__add" onClick={onAddVoice}>
                    <Plus size={13} /> {t('voiceLibrary.addVoice', 'Add a voice…')}
                  </button>
                </div>
              </div>
            )}
            {clones.length === 0 && !onAddVoice && (
              <div className="voice-pop__empty">{t('voiceLibrary.emptyHint', 'No imported voices yet.')}</div>
              {/* TWO empty states, not one. `emptyHint` is "no clones yet";
                  `voiceLibrary.filter.empty` ("No voices match these filters.")
                  is what the shipped section rendered when the facets filtered
                  the roster to nothing, and it must render on that condition —
                  active criteria plus an empty filtered list. Narrowing ~200
                  Soniox presets to zero and seeing no message at all is the
                  regression; both strings already exist in all 30 catalogs. */}
            )}
            {clones.map(row)}
            <div className="voice-pop__group">
              {t('voiceLibrary.presets', 'Presets')}
              {facetsOn && presets.length > 0 && (
                <span className="voice-pop__count">
                  {' · '}
                  {t('voiceLibrary.filterCount', '{shown} of {total}')
                    .replace('{shown}', String(matched.length))
                    .replace('{total}', String(presets.length))}
                </span>
              )}
              {onRefresh && (
                <button type="button" className="voice-pop__refresh" onClick={onRefresh}
                  aria-label={t('voiceLibrary.refreshList', 'Refresh voice list')} disabled={refreshing}>
                  <RefreshCw size={12} />
                </button>
              )}
            </div>
            {shownPresets.map(row)}
          </div>
        </div>
        </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
};

export default VoicePicker;
```

- [ ] **Step 4: Write the stylesheet**

Create `src/components/Settings/sections/VoicePicker.scss`. **COPY** the
facet-bar rules from `VoiceLibrarySection.scss` (`.voice-facet-bar`,
`.voice-facet-fields`, `.voice-facet-field`, `.voice-facet-label`,
`.voice-facet-select`, `.voice-facet-status`, `.voice-facet-count`,
`.voice-facet-empty`, `.voice-facet-clear`, and `@keyframes
voice-preview-spin`) and rename them onto this component's classes; keep every
declaration value as it is today so the visual result does not drift.

**Copy, do not move, and leave `VoiceLibrarySection.scss` untouched by this
task.** Two independent reasons:

1. Nothing renders `VoicePicker` until Task 6. Until then the SECTION still
   renders its own facet bar, so deleting those rules now would ship three
   intermediate commits (Tasks 3, 4, 5) with a visibly unstyled filter bar.
2. `voiceFacetStyles.test.ts` compiles `VoiceLibrarySection.scss` — and only
   that file — then asserts nine of those exact classes are styled in it, plus
   a `.voice-facet-bar { … margin … }` rule. Removing them turns 10 of that
   file's 11 assertions red, and this task's own gate expects it green.

The duplication is deliberate and temporary: Task 6 deletes the originals when
it deletes the markup that uses them. A duplicated `@keyframes
voice-preview-spin` in two stylesheets is harmless — both compile to separate
CSS with identical content, and the section's `.voice-preview-spinner` still
needs the original until Task 6.

Do NOT touch `.voice-selected-description`. It appears in that test's list too,
but it belongs to the section, stays there permanently, and is on Task 6's keep
list.

Because this task no longer edits `VoiceLibrarySection.scss`, that path may
legitimately show no diff at commit time; stage it anyway (harmless) or drop it
from the `git add`.

The stylesheet invariant goes in the EXISTING test
`src/components/Settings/sections/voiceFacetStyles.test.ts` — do not create a
second one. That test compiles the SCSS with `sass` and asserts on the emitted
selector, which is the only way this repo checks a stylesheet: never walk the
source text looking for braces, and when you write a selector matcher use
`(?![\w-])` rather than `\b`, because `-` is a word character to a regex and
`\b` would let `.voice-row` match `.voice-row-btn`.

The classes this task introduces:

```scss
// `../shared/variables` and not `../../../styles/tokens`: the tokens module
// carries only the 14 accent/status colours, NOT $color-error, $bg-page,
// $border-*, $radius-* or the spacing scale. Settings/shared/_variables.scss
// defines those AND re-exports the accent ($color-primary), so one namespace
// covers everything this stylesheet needs — the same import
// ModelImportModal.scss uses.
@use '../shared/variables' as vars;

.voice-picker { position: relative; }

.voice-picker__trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
}

.voice-picker__value { flex: 1; min-width: 0; }
.voice-picker__value-sub { display: block; font-size: 11px; opacity: 0.7; }

.voice-pop {
  z-index: 40;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.voice-pop__facets { display: flex; gap: 6px; padding: 8px; flex-wrap: wrap; }
.voice-pop__facet { flex: 1 1 30%; min-width: 0; }
.voice-pop__clear { flex: none; }
.voice-pop__grid { overflow-y: auto; }
.voice-pop__group { display: flex; align-items: center; gap: 6px; position: sticky; top: 0; }
.voice-pop__count { font-variant-numeric: tabular-nums; }
.voice-pop__refresh { margin-left: auto; }
.voice-pop__empty { padding: 10px 9px; }

.voice-row { display: flex; align-items: center; gap: 6px; }
.voice-row.is-selected { box-shadow: inset 2px 0 0 vars.$color-primary; }
.voice-row__pick { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left; }
.voice-row__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.voice-row__sub { font-size: 11px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.voice-row__btn { flex: none; }
.voice-row__btn--danger:hover { color: vars.$color-error; }
.voice-row__add { color: vars.$color-primary; width: 100%; text-align: left; }
.voice-row__edit { flex: 1; min-width: 0; }
.voice-row__spinner { animation: voice-preview-spin 0.8s linear infinite; }
```

Fill in the colours, paddings, borders and radii by copying the corresponding
declarations from the rules you are moving (`.voice-manage-row`,
`.voice-row-btn`, `.voice-name-edit`, `.voice-facet-*`) so this stays a move,
not a redesign of the visual details.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/VoicePicker.test.tsx`
Expected: 12 PASS.

- [ ] **Step 6: Add the style invariant test**

Append to `src/components/Settings/sections/voiceFacetStyles.test.ts` a second
`describe` that compiles `VoicePicker.scss` and asserts the same
"class is styled where the element lives" property for the new classes.

APPEND only. Leave the file's existing `const css = compile(… 'VoiceLibrarySection.scss')`
and its `describe('facet filter bar styling')` exactly as they are: those 11
assertions are still live and still true, because Step 4 copied the rules rather
than moving them. Reuse the file's existing `styled()` helper rather than
writing a second matcher — it already encodes the `(?![\w-])` rule.

```ts
const pickerCss = compile(resolve(__dirname, 'VoicePicker.scss')).css;

describe('voice picker styling', () => {
  it.each([
    'voice-picker',
    'voice-picker__trigger',
    'voice-pop',
    'voice-pop__facets',
    'voice-pop__grid',
    'voice-row',
    'voice-row__pick',
    'voice-row__btn',
    'voice-row__add',
  ])('styles .%s where the element lives', (cls) => {
    expect(pickerCss).toMatch(styled(cls));
  });
});
```

Run: `npx vitest run src/components/Settings/sections/voiceFacetStyles.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/sections/VoicePicker.tsx src/components/Settings/sections/VoicePicker.scss src/components/Settings/sections/VoicePicker.test.tsx src/components/Settings/sections/voiceFacetStyles.test.ts src/components/Settings/sections/VoiceLibrarySection.scss
git commit -m "feat(voice): a self-drawn voice picker with per-row audition"
```

---

## Task 4: The picker's keyboard model

**Files:**
- Modify: `src/components/Settings/sections/VoicePicker.tsx`
- Test: `src/components/Settings/sections/VoicePicker.test.tsx`

**Interfaces:**
- Consumes: Task 3's component and its row markup.
- Produces: no new exports. Focus behaviour only.

This is its own task because it is the component's riskiest code and a reviewer
can reject it without rejecting the row markup.

- [ ] **Step 1: Write the failing tests**

Append to `VoicePicker.test.tsx`:

```tsx
describe('VoicePicker keyboard', () => {
  const THREE = [
    { id: 'builtin:Grace', label: 'Grace', group: 'builtin' as const, removable: false, previewable: true },
    { id: 'builtin:Isla', label: 'Isla', group: 'builtin' as const, removable: false, previewable: true },
    { id: 'builtin:Victoria', label: 'Victoria', group: 'builtin' as const, removable: false, previewable: true },
  ];

  it('moves between rows with the arrow keys and lands on the name cell', async () => {
    render(<VoicePicker {...base} voices={THREE} onPreview={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Grace' })).toHaveFocus());
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Isla' })).toHaveFocus());
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Grace' })).toHaveFocus());
  });

  it('moves within a row with left and right', async () => {
    render(<VoicePicker {...base} voices={THREE} onPreview={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name: /play/i })[0]).toHaveFocus());
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Grace' })).toHaveFocus());
  });

  it('jumps to the first and last row with Home and End', async () => {
    render(<VoicePicker {...base} voices={THREE} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'End' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Victoria' })).toHaveFocus());
    fireEvent.keyDown(grid, { key: 'Home' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Grace' })).toHaveFocus());
  });

  it('jumps to a row by typing its first letters — the search box we did not build', async () => {
    render(<VoicePicker {...base} voices={THREE} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    // One keyDown per character: the buffer is what turns 'v' + 'i' into a
    // two-character match, so a single synthetic event would not exercise it.
    fireEvent.keyDown(grid, { key: 'v' });
    fireEvent.keyDown(grid, { key: 'i' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Victoria' })).toHaveFocus());
  });

  it('selects with Enter and closes', async () => {
    const onSelect = vi.fn();
    render(<VoicePicker {...base} voices={THREE} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    // Enter is dispatched on the CELL that actually has focus, not on the grid
    // container. The `Enter` case requires a `[role="gridcell"]` target — the
    // same guard that stops a mouse-focused ▶ from selecting row 0 — so firing
    // on the container would be rejected, and a test that fired there would be
    // asserting a path no real keypress can take. The arrow cases above may
    // still fire on the container, because only `Enter` carries the guard.
    const cell = screen.getByRole('gridcell', { name: 'Isla' });
    await vi.waitFor(() => expect(cell).toHaveFocus());
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('builtin:Isla');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    render(<VoicePicker {...base} voices={THREE} />);
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    // `document`, not the grid: this Escape is handled by floating-ui's
    // `useDismiss`, which binds its listener to the document.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Note what `await vi.waitFor(…)` is doing in every focus assertion above, and do
not "simplify" it away: `focusActive` moves DOM focus inside a
`requestAnimationFrame` (so the row that is about to be active is the one it
reaches into), while `fireEvent` returns synchronously. A bare
`expect(...).toHaveFocus()` therefore runs before the frame callback and fails
for a reason that has nothing to do with the keyboard model.

Run: `npx vitest run src/components/Settings/sections/VoicePicker.test.tsx -t keyboard`
Expected: 5 of 6 FAIL on focus, and read the sixth carefully. Nothing takes
focus on `ArrowDown`/`ArrowUp`/`ArrowRight`/`ArrowLeft`/`Home`/`End`, so those
assertions receive `document.body`. The Escape case is the one to watch:
`useDismiss`'s `escapeKey` option defaults to TRUE, so the popover already
closes — `queryByRole('grid')` is already null — and that case fails only on
`expect(trigger).toHaveFocus()`, which the `FloatingFocusManager` added in
Task 3 is what satisfies. If Escape does NOT close, stop and report it: it
means Task 3 configured `useDismiss` differently than the plan says.

- [ ] **Step 3: Implement the grid navigation**

In `VoicePicker.tsx`, add the focus model. Rows get a stable order, each row's
cells get a tabindex of -1 except the active cell, and the popover owns one
`onKeyDown`:

```tsx
  // Flat row order as rendered: the add row first (when present), then clones,
  // then the shown presets. Keyboard order must match visual order, so this is
  // derived from the same arrays the JSX maps over rather than from `voices`.
  const rowOrder = useMemo(
    () => [...clones, ...shownPresets].map((v) => v.id),
    [clones, shownPresets],
  );
  const [activeRow, setActiveRow] = useState(0);
  const [activeCell, setActiveCell] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Type-ahead buffer: cleared after 700ms of no typing, the interval the APG
  // grid pattern uses for multi-character matching.
  const typed = useRef({ text: '', at: 0 });

  /** Move DOM focus to the active cell after a render that changed it. */
  const focusActive = (rowIdx: number, cellIdx: number) => {
    const grid = gridRef.current;
    if (!grid) return;
    // `[role="row"].voice-row` and not every `[role="row"]`: the grid also
    // contains HEADER rows (the "My Voices" / "Presets" group labels, each a
    // `role="row"` holding one `role="columnheader"`, with the refresh button
    // inside the Presets one). Selecting by the `.voice-row` class excludes
    // them, so arrow keys move between voices only. The add row is excluded
    // separately because it is a `.voice-row` but not a voice.
    const rows = Array.from(grid.querySelectorAll('[role="row"].voice-row')).filter(
      (r) => !r.classList.contains('voice-row--add'),
    );
    const cells = rows[rowIdx]?.querySelectorAll<HTMLElement>('[role="gridcell"] button, [role="gridcell"] input');
    const el = cells?.[Math.min(cellIdx, (cells?.length ?? 1) - 1)];
    el?.focus();
  };

  // Hand-rolled rather than floating-ui's `useListNavigation`: that hook's
  // `cols` option models a UNIFORM grid, and these rows are ragged — a preset
  // row has two cells (name, ▶) while a clone row has four (name, ▶, rename,
  // delete). `ExportButton.tsx` uses `useListNavigation` because its menu is a
  // plain one-cell-per-row list; this control is not that.
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    // While an inline rename is open the grid model is INERT: the input owns
    // Enter (commit), the arrows (caret movement) and letters (typing, not
    // type-ahead). Without this, every key in the text field also drives the
    // grid, because the input's own handler does not stop propagation.
    if (editingId != null) return;
    const last = rowOrder.length - 1;
    if (last < 0) return;
    const go = (rowIdx: number, cellIdx = 0) => {
      e.preventDefault();
      const r = Math.max(0, Math.min(last, rowIdx));
      setActiveRow(r);
      setActiveCell(cellIdx);
      // Focus after the state commit so the row that is about to be active is
      // the one we reach into.
      requestAnimationFrame(() => focusActive(r, cellIdx));
    };
    switch (e.key) {
      case 'ArrowDown': return go(activeRow + 1);
      case 'ArrowUp': return go(activeRow - 1);
      case 'ArrowRight': return go(activeRow, activeCell + 1);
      case 'ArrowLeft': return go(activeRow, Math.max(0, activeCell - 1));
      case 'Home': return go(0);
      case 'End': return go(last);
      case 'Enter': {
        // Act on REAL focus, not on remembered coordinates. `activeRow` and
        // `activeCell` are only ever written by `go()`, which only runs from
        // keyboard navigation — a mouse click never updates them. So without
        // this guard, clicking ▶ (or Rename) with the mouse and then pressing
        // Enter activates that control natively AND falls through to here with
        // `activeCell` still 0 from the open, selecting `rowOrder[0]` and
        // closing the popover. Column 0's focus target is the cell element
        // itself while action columns focus their own control, so requiring a
        // `gridcell` target rejects both a `<button>` and an `<input>` target.
        const target = e.target as HTMLElement | null;
        if (target?.getAttribute('role') !== 'gridcell') return;
        const id = rowOrder[activeRow];
        if (id && activeCell === 0 && !isSessionActive) {
          e.preventDefault();
          onSelect(id);
          setOpen(false);
        }
        return;
      }
      // Deliberately NO `Escape` branch. `useDismiss` closes on Escape by
      // default and the `FloatingFocusManager` from Task 3 returns focus to
      // the trigger; handling it here too would fight both. If `triggerRef`
      // is now unused in this file, delete it with this task.
      default: break;
    }
    // Type-ahead: printable single characters only, so modifier combinations
    // and Tab keep their meaning.
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    const now = Date.now();
    typed.current = {
      text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(),
      at: now,
    };
    const all = [...clones, ...shownPresets];
    const hit = all.findIndex((v) => v.label.toLowerCase().startsWith(typed.current.text));
    if (hit >= 0) go(hit);
  };
```

Two invariants the sketch above does NOT enforce, and which the implementation
must. The sketch clamps the ROW (`Math.max(0, Math.min(last, rowIdx))`) but
passes `cellIdx` through raw, and clamping it only inside `focusActive` fixes
where focus lands while leaving `activeCell` out of range in state:

1. **`activeCell` is clamped in `go()` against the TARGET row's cell count.**
   Rows are ragged — a preset row has 2 cells, a clone 4 — so ArrowRight off a
   row's last cell, or a column-preserving ArrowDown from a clone onto a
   preset, otherwise puts `activeCell` past the end. `cellTabIndex()` then
   matches no cell and the row is left with ZERO tab stops (name div and every
   button all at `-1`), which breaks the roving-tabindex model and makes the
   next ArrowLeft a dead keypress.
2. **Every row has exactly one FOCUSABLE tab stop.** A `disabled` button cannot
   take focus, so it must not be the cell carrying `tabIndex={0}`: horizontal
   movement skips cells whose control is disabled, and if the active cell's
   control is disabled anyway the tab stop falls back to cell 0.

Vertical movement PRESERVES the column where the target row has that cell
(rather than the sketch's implicit reset to cell 0). That is the APG-correct
behaviour and it is deliberate; comment it as such, and make sure no test title
claims arrow-down always "lands on the name cell".

Wire it: put `ref={gridRef}` and `onKeyDown={onGridKeyDown}` on the
`role="grid"` element and give it `tabIndex={-1}`. Initial focus is NOT a
`useEffect` here — add `initialFocus={gridRef}` to the `FloatingFocusManager`
that Task 3 wrapped the popover in, so opening, Escape-closing and focus
return all stay in one place. (If TypeScript rejects the
`MutableRefObject<HTMLDivElement | null>` against the prop's
`MutableRefObject<HTMLElement | null>`, fall back to a `useEffect` on `open`
that calls `gridRef.current?.focus()` and say so in your report.) Give each
cell's control
`tabIndex={rowIdx === activeRow && cellIdx === activeCell ? 0 : -1}` — pass the
indices into `row()` by mapping with the index and threading a cell counter.
Reset `activeRow`/`activeCell` to 0 whenever `open` flips to true.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/VoicePicker.test.tsx`
Expected: all PASS (12 from Task 3 + 6 here).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/VoicePicker.tsx src/components/Settings/sections/VoicePicker.test.tsx
git commit -m "feat(voice): grid keyboard navigation and type-ahead in the voice picker"
```

---

## Task 5: `VoiceCreateModal` — the capture code moves

**Files:**
- Create: `src/components/Settings/sections/VoiceCreateModal.tsx`
- Create: `src/components/Settings/sections/VoiceCreateModal.scss`
- Create: `src/components/Settings/sections/VoiceCreateModal.test.tsx`
- Modify: `src/lib/diagnostics/consoleLedger.consistency.test.ts`

**Interfaces:**
- Consumes: `VoiceLibraryCapability` (Task 1); `voiceLibrary.addVoiceTitle` (Task 2) and the pre-existing shared `common.cancel` / `common.close` — there is no `voiceLibrary.cancel` and Task 2 does not create one.
- Produces:

```ts
export interface VoiceCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport?: (file: File, transcript?: string) => Promise<void>;
  onRecord?: (clip: Float32Array, sampleRate: number, transcript?: string) => Promise<void>;
  capability: VoiceLibraryCapability;
  note?: React.ReactNode;
}
```

The recording graph, the countdown, the generation guard, `handleFiles` and the
three drag handlers move here **verbatim** from `VoiceLibrarySection.tsx`
(lines ~244–261, ~312–360, ~405–485). Moving them unchanged is the point: they
carry hard-won behaviour (raw capture so the cloner does not learn the
browser's echo canceller, an auto-stop at the model's clip limit, a generation
counter that invalidates a `getUserMedia` still in flight, single-import
adapters keeping only the first dropped file). THREE `console.warn` calls move
with them, which is why the console ledger changes in this task — and get the
arithmetic right, because `consoleLedger.consistency.test.ts` pins exact
per-file counts:

`VoiceLibrarySection.tsx` holds five today, and its ledger row (line 144) says
5: `:339` `'Voice import failed:'`, `:372` `'Rename failed:'`, `:380`
`'Delete failed:'`, `:449` `'Recording failed to start:'`, `:480`
`'Recording handler failed:'`. Only the three inside the ranges above — `:339`,
`:449`, `:480` — move into this modal. Rename and delete stay in the section on
purpose: the picker receives `onRename` and `onAskDelete` as props and the
delete modal receives `onConfirm`, so the `try/catch` that logs those two
failures belongs to the composition root, which the section becomes in Task 6.

So THIS task adds a `VoiceCreateModal.tsx` row of **3** and leaves
`VoiceLibrarySection.tsx` at **5** — the section still contains its copies
until Task 6 deletes them, so lowering the row here would fail the test on a
count that is still accurate. Task 6 lowers the section's row from 5 to 2 in
the same commit that deletes the capture code. Keep each moved call's text
byte-for-byte identical; `CLAUDE.md` forbids ADDING `console.warn` to
`src/components`, and what makes these legal is that they are moves.

- [ ] **Step 1: Write the failing tests**

Create `src/components/Settings/sections/VoiceCreateModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import VoiceCreateModal from './VoiceCreateModal';

const base = { isOpen: true, onClose: vi.fn(), capability: { importModes: ['upload'] as ('upload' | 'record')[] } };

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('VoiceCreateModal', () => {
  it('renders nothing when closed', () => {
    render(<VoiceCreateModal {...base} isOpen={false} onImport={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers only the controls the capability allows', () => {
    const { rerender } = render(<VoiceCreateModal {...base} onImport={vi.fn()} />);
    expect(screen.getByRole('button', { name: /import voice/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record/i })).not.toBeInTheDocument();

    rerender(<VoiceCreateModal {...base} capability={{ importModes: ['record'] }} onRecord={vi.fn()} />);
    expect(screen.getByRole('button', { name: /record/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import voice/i })).not.toBeInTheDocument();
  });

  it('gates import and record behind a non-empty transcript when the model needs one', async () => {
    render(
      <VoiceCreateModal
        {...base}
        capability={{ importModes: ['upload', 'record'], transcriptRequired: true }}
        onImport={vi.fn()}
        onRecord={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /import voice/i })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /transcript/i }), { target: { value: 'hello there' } });
    expect(screen.getByRole('button', { name: /import voice/i })).toBeEnabled();
  });

  it('sends a dropped file to onImport', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<VoiceCreateModal {...base} onImport={onImport} />);
    const file = new File([new Uint8Array([1, 2, 3])], 'voice.wav', { type: 'audio/wav' });
    const zone = screen.getByTestId('voice-create-drop');
    // jsdom has no DataTransfer, so construct the shape the handler reads and
    // dispatch the drop directly.
    const dataTransfer = { files: [file], types: ['Files'] } as unknown as DataTransfer;
    zone.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toBe(file);
  });

  it('keeps only the first file when the adapter stages one clip at a time', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<VoiceCreateModal {...base} capability={{ importModes: ['upload'], multipleImport: false }} onImport={onImport} />);
    const a = new File([new Uint8Array([1])], 'a.wav', { type: 'audio/wav' });
    const b = new File([new Uint8Array([2])], 'b.wav', { type: 'audio/wav' });
    const zone = screen.getByTestId('voice-create-drop');
    const dataTransfer = { files: [a, b], types: ['Files'] } as unknown as DataTransfer;
    zone.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toBe(a);
  });

  it('closes on Escape, on the backdrop, and on Cancel — but not on a click inside', async () => {
    const onClose = vi.fn();
    render(<VoiceCreateModal {...base} onClose={onClose} onImport={vi.fn()} />);
    // A click INSIDE the dialog must not close it. Note that this is the inner
    // panel, NOT the backdrop — the backdrop is its parent, and asserting the
    // backdrop by clicking the dialog would pass for the wrong reason and stay
    // green if the overlay's handler were deleted.
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    // The real backdrop. Reached through the dialog's parent rather than a
    // test-only attribute on production markup.
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    // `window`, not `document`: this modal adds its own Escape listener the way
    // `ModelImportModal` does (`ModelImportModal.test.tsx:114` fires it the same
    // way). Nothing here goes through floating-ui.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders the provider note', () => {
    render(<VoiceCreateModal {...base} onImport={vi.fn()} note="Previewing is charged to your balance." />);
    expect(screen.getByText(/charged to your balance/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/components/Settings/sections/VoiceCreateModal.test.tsx`
Expected: FAIL at import — `Failed to resolve import "./VoiceCreateModal"`.

- [ ] **Step 3: Write the modal**

Create `VoiceCreateModal.tsx` with the `ModelImportModal` skeleton (overlay
closing on backdrop click, inner `role="dialog" aria-modal="true"` stopping
propagation, an `Escape` listener in a `useEffect`, a `&__x` close button) and
move the capture code in. The pieces, in the order they appear in the file:

```tsx
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Mic, Square, X } from 'lucide-react';
import type { VoiceLibraryCapability } from '../../../types/VoiceLibrary';
import './VoiceCreateModal.scss';

/**
 * Adding a voice: the import/record surface, in its own modal.
 *
 * It lives here rather than in the settings panel because the panel is 300px
 * wide and the picker is the only thing that belongs there permanently (design
 * 2026-09-16 §5). The capture code — the recording graph, the countdown, the
 * generation guard, the drop handling — moved here VERBATIM from
 * VoiceLibrarySection; every comment in it explains a behaviour that was paid
 * for once already.
 */
```

State and refs (moved): `isRecording`, `recordSecondsLeft`, `transcript`,
`isDragging`, `fileInputRef`, `recRef`, `recTimerRef`, `stopRecordingRef`,
`recGenerationRef`, `clearRecTimer`, plus `transcriptInputId` from `useId()`.

Derived (moved): `canUpload`, `canRecord`, `transcriptMissing`.

Handlers (moved verbatim, only `capability`/`onImport`/`onRecord` now coming
from props): `handleFiles`, `onDrop`, `onDragOver`, `onDragLeave`,
`startRecording`, `stopRecording`, the `useEffect` that keeps
`stopRecordingRef` current, and the unmount effect that releases the microphone
(bump `recGenerationRef` and stop tracks).

Add one behaviour the section did not need: close means stop. A modal that
closes mid-recording must not leave the graph running, so:

```tsx
  // Closing mid-recording DISCARDS the capture. Do not reach for
  // `stopRecording` here: that is the SUBMITTING path — it awaits `onRecord` —
  // so calling it from `close()` uploads the half-finished clip the user just
  // cancelled, and because `onClose()` runs while it is suspended on
  // `await ctx.close()`, `onRecord` resolves after the modal is gone and its
  // errors reach nothing but a `console.warn`.
  //
  // Discarding means exactly what the section's unmount effect does: clear the
  // countdown timer, release the microphone and close the audio context, and
  // bump the generation counter so a `getUserMedia` still in flight cannot
  // resurrect the capture. Factor that teardown so `close()` and the unmount
  // path share it, using the section's own identifiers and ordering, and leave
  // `stopRecording` as the only caller of `onRecord`.
  const close = () => {
    if (isRecording) discardRecording();
    onClose();
  };
```

and use `close` for the backdrop, the `&__x` button, Cancel and Escape.

Render: overlay → dialog → head (`addVoiceTitle` + close) → body (transcript
field when `capability.transcriptRequired`; the Import button when `canUpload`;
the Record/Stop button when `canRecord`, showing `recordSecondsLeft`; the drop
zone carrying `data-testid="voice-create-drop"` and the three drag handlers when
`canUpload`; the hidden file input with `accept={capability.accept ?? 'application/json,.json'}`
and `multiple={capability.multipleImport !== false}`; `note`) → foot (Cancel).

Copy keys: `addVoiceTitle`, `importVoice`, `recordVoice`, `stopRecording`,
`transcript`, `transcriptHint`, `transcriptPlaceholder`, `dropHint` — all under
`voiceLibrary.` — plus the two SHARED ones: `common.cancel` for the foot button
and `common.close` for the `&__x`. There is deliberately no
`voiceLibrary.cancel` and Task 2 does not create one: `ModelImportModal.tsx:343`
and `SonioxCloneConfirmModal.tsx:223`, the two modal siblings in this
directory, both render `t('common.cancel', 'Cancel')`.

- [ ] **Step 4: Write the stylesheet**

Create `VoiceCreateModal.scss` starting with the same import
`ModelImportModal.scss` uses — `@use '../shared/variables' as vars;`, which is
where `$bg-page`, `$border-strong`, `$border-subtle`, `$radius-lg` (8px),
`$text-primary`, `$color-error` (#ff4444) and the `$space-*` scale live (the
`styles/tokens` module has none of them; the precedent also takes
`$text-muted`, `$text-disabled`, `$font-body` and
`$weight-normal`/`$weight-medium`/`$weight-semibold` from `vars` for its head,
sub and hint text, so use those rather than writing literals, and its
`&__body` is `max-height: 62vh; overflow-y: auto` — mirror that value for a
form this tall) — and mirror that file's overlay and
panel (fixed inset, `rgba(0, 0, 0, 0.62)` + `backdrop-filter: blur(2px)`,
`z-index: 1000`, centred with `padding: 40px 16px`; panel `max-width: 420px`,
`vars.$bg-page`, `vars.$border-strong`, `vars.$radius-lg`, the same box-shadow
and 0.16s ease-out entry) and move the toolbar-ish rules
(`.voice-transcript-field`, `.voice-transcript-label`, `.voice-transcript-input`,
`.voice-transcript-hint`, `.voice-import-btn`, `.voice-library-drop-hint`) out of
`VoiceLibrarySection.scss` under this component's names.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/VoiceCreateModal.test.tsx`
Expected: 7 PASS.

- [ ] **Step 6: Move the console-ledger counts**

Run: `npx vitest run src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: FAIL — `VoiceLibrarySection.tsx`'s recorded count is now too high and `VoiceCreateModal.tsx` is unlisted.

Update the ledger: subtract the calls that left `VoiceLibrarySection.tsx` (the
`Recording failed to start:` and `Recording handler failed:` warns, plus
`Voice import failed:`) and add `VoiceCreateModal.tsx` with exactly that count.
Re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/sections/VoiceCreateModal.tsx src/components/Settings/sections/VoiceCreateModal.scss src/components/Settings/sections/VoiceCreateModal.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts
git commit -m "feat(voice): add-a-voice modal carrying the capture code"
```

---

## Task 6: `VoiceDeleteModal` and the section becomes a composition root

**Files:**
- Create: `src/components/Settings/sections/VoiceDeleteModal.tsx`
- Create: `src/components/Settings/sections/VoiceDeleteModal.test.tsx`
- Modify: `src/components/Settings/sections/VoiceLibrarySection.tsx`
- Modify: `src/components/Settings/sections/VoiceLibrarySection.scss`
- Modify: `src/components/Settings/sections/VoiceLibrarySection.test.tsx`
- Modify: `src/components/Settings/sections/VoiceLibrarySection.facets.test.tsx`
- Modify: `src/lib/diagnostics/consoleLedger.consistency.test.ts`
- Delete: `src/components/Settings/sections/VoiceLibrarySection.optgroupLabel.test.tsx`

**Interfaces:**
- Consumes: `VoicePicker` (Tasks 3–4), `VoiceCreateModal` (Task 5), copy (Task 2).
- Produces:

```ts
export interface VoiceDeleteModalProps {
  /** The voice to delete, or null when the modal is closed. */
  target: { id: string; label: string } | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}
```
plus `VoiceLibrarySection`'s unchanged public props.

- [ ] **Step 1: Write the delete modal's failing tests**

Create `src/components/Settings/sections/VoiceDeleteModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import VoiceDeleteModal from './VoiceDeleteModal';

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('VoiceDeleteModal', () => {
  it('renders nothing without a target', () => {
    render(<VoiceDeleteModal target={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the voice and warns that the local recording goes too', () => {
    render(<VoiceDeleteModal target={{ id: 'custom:1', label: 'Mine' }} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Mine');
    expect(screen.getByRole('dialog')).toHaveTextContent(/reference recording stored on this device/i);
  });

  it('deletes once on confirm and not at all on cancel', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { rerender } = render(
      <VoiceDeleteModal target={{ id: 'custom:1', label: 'Mine' }} onClose={onClose} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<VoiceDeleteModal target={{ id: 'custom:1', label: 'Mine' }} onClose={onClose} onConfirm={onConfirm} />);
    // `/^delete$/i` and not `/delete/i`: the dialog's own accessible name is
    // "Delete voice", so a loose matcher hits two elements and throws.
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalledWith('custom:1');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/Settings/sections/VoiceDeleteModal.test.tsx`
Expected: FAIL at import.

- [ ] **Step 3: Write the delete modal**

```tsx
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import './VoiceCreateModal.scss';

/**
 * Deleting a voice, with the consequence spelled out.
 *
 * Replaces a `window.confirm`, which could not say that the on-device
 * reference recording goes with the voice, and looked nothing like the rest of
 * the app. Shares VoiceCreateModal's stylesheet: same overlay, same dialog
 * frame, one less body.
 */
export interface VoiceDeleteModalProps {
  target: { id: string; label: string } | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

const VoiceDeleteModal: React.FC<VoiceDeleteModalProps> = ({ target, onClose, onConfirm }) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  return (
    <div className="voice-modal-overlay" onClick={onClose}>
      <div className="voice-modal" role="dialog" aria-modal="true"
        aria-label={t('voiceLibrary.deleteTitle', 'Delete voice')}
        onClick={(e) => e.stopPropagation()}>
        <div className="voice-modal__head">
          <h3>{t('voiceLibrary.deleteTitle', 'Delete voice')}</h3>
          <button className="voice-modal__x" onClick={onClose} aria-label={t('common.close', 'Close')}>
            <X size={17} />
          </button>
        </div>
        <div className="voice-modal__body">
          {t('voiceLibrary.deleteBody', 'Delete "{name}"? This also removes the reference recording stored on this device.')
            .replace('{name}', target.label)}
        </div>
        <div className="voice-modal__foot">
          <button type="button" className="voice-modal__btn" onClick={onClose}>
            {/* `common.cancel`, not a new `voiceLibrary.cancel`: the key
                already exists and both modal siblings in this directory
                render it this way (`ModelImportModal.tsx:343`,
                `SonioxCloneConfirmModal.tsx:223`). */}
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="button" className="voice-modal__btn voice-modal__btn--danger"
            onClick={() => { void onConfirm(target.id); }}>
            {t('voiceLibrary.delete', 'Delete')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceDeleteModal;
```

Rename Task 5's overlay/dialog classes — it shipped them as
`voice-create-modal__*` — to this shared `voice-modal*` set so both modals use
one frame, and add `&__foot`, `&__btn`, `&__btn--danger`.

That rename has a gate attached, and it is easy to miss: the third `describe`
in `voiceFacetStyles.test.ts` (added by Task 5, compiling
`VoiceCreateModal.scss`) lists those `voice-create-modal__*` names, so it fails
the moment the stylesheet stops emitting them. Re-point it in the SAME commit
and add the delete modal's classes to it — see Step 6's note for why that file
is the only thing standing between a typo and an unstyled control.

- [ ] **Step 4: Rewrite the section as a composition root**

`VoiceLibrarySection.tsx` keeps: the `VoiceEntry` type and its props interface
(both exported, at `:20` and `:54`), the AudioContext playback — `playingId`
(`:137`), `previewTokenRef` (`:145`), `previewAbortRef` (`:149`), `stopPreview`
(`:151`), `togglePreview` (`:165`) and the unmount effect. Read the loading
state off the file rather than from this sentence: an earlier draft called it
`loadingId`, but the setter is `setPreviewLoadingId` (`:182`) and the state is
named to match, so grep before you wire it into the picker's `loadingId` prop.

**`togglePreview` must HONOUR the picker's abort signal, not merely accept it.**
`VoicePicker`'s `onPreview` is `(id, signal?) => Promise<…>` while the section's
`togglePreview` is `(id) => Promise<void>`, so it has to gain the parameter to
type-check — and adding `_signal?` and ignoring it is the trap. The picker
aborts its controller on unmount (`VoicePicker.tsx:91-94`) and on the next click
(`:516`), so a section that ignores the signal loses cancellation at both of
those points. The request
runs on, resolves, the token still matches, and playback starts into a dismissed
popover with no reachable Stop — and for a managed voice that preview was billed.
Wire the passed signal into the same path `stopPreview()` takes (bump the token,
abort the section's own controller, stop playback) and remove the listener on
every exit including the error path.
Also kept: the
capture-error-free render, and now three children plus two pieces of modal
state:

```tsx
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
```

It deletes: the `<select>`/`<optgroup>` block, `renderRow`, `renderManageRow`,
`renderPreviewButton`, `renderFacetBar`, the `<details>` manage block,
`isDropdown`, `richSelect`/`supportsBaseSelect`, `startEdit`/`commitEdit`,
`confirmAndDelete` (the `window.confirm`), every capture handler and ref moved
in Task 5, the facet state and memos moved in Task 3, and the now-unused
imports.

Its render becomes:

```tsx
  return (
    <div className="voice-library-section">
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('voiceLibrary.voice', 'Voice')}</span>
        </div>
        <VoicePicker
          voices={voices}
          selectedId={selectedId}
          onSelect={onSelect}
          onPreview={onPreview ? togglePreview : undefined}
          previewUnavailableReason={previewUnavailableReason}
          playingId={playingId}
          loadingId={previewLoadingId}
          onRename={onRename}
          onAskDelete={(id, label) => setDeleteTarget({ id, label })}
          onAddVoice={canCreate ? () => setCreating(true) : undefined}
          onRefresh={onRefresh}
          refreshing={refreshing}
          capability={capability}
          isSessionActive={isSessionActive}
        />
        {selectedDescription && (
          <div className="voice-selected-description">{selectedDescription}</div>
        )}
      </div>

      <VoiceCreateModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        onImport={onImport}
        onRecord={onRecord}
        capability={capability}
        note={manageNote}
      />
      <VoiceDeleteModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async (id) => { setDeleteTarget(null); await onDelete(id); }}
      />
    </div>
  );
```

with `const canCreate = capability.importModes.length > 0;` and
`selectedDescription` the one-line description the old
`renderSelectedDescription` produced (`voices.find(...)?.meta?.facets?.description`).

`togglePreview` keeps its current body but now also sets `previewLoadingId`
before awaiting and clears it after, since the picker renders the spinner from
that prop rather than from internal state.

- [ ] **Step 5: Rewrite the section's own suite and re-point the facets suite**

`VoiceLibrarySection.test.tsx` keeps the Web Audio stub and covers only what the
composition root owns: `onPreview` resolving audio starts playback and a second
click stops it; a preview that resolves `null` plays nothing; `previewable`
gating reaches the picker (the Task 1 case); the add row appears iff
`importModes` is non-empty; `onAskDelete` opens the delete modal and confirming
calls `onDelete` once; opening the create modal renders the dialog. Delete every
case that asserted on the `<select>`, the optgroups, the manage block or the
show-all expander.

`VoiceLibrarySection.facets.test.tsx`: change its renders to open the picker
first (`fireEvent.click(screen.getByRole('button', { expanded: false }))`)
and query inside `screen.getByRole('grid')`. Keep all 17 assertions: they are
about filtering semantics, which did not change.

Delete `VoiceLibrarySection.optgroupLabel.test.tsx`.

- [ ] **Step 6: Strip the stylesheet**

From `VoiceLibrarySection.scss` delete `.voice-library-manage`,
`.voice-library-manage-count`, `.voice-library-manage-body`,
`.voice-library-manage-toolbar`, `.voice-library-empty`,
`.voice-library-manage-note`, `.voice-library-group`,
`.voice-library-group-label`, `.voice-select-btn`, `.voice-show-all-btn`,
`.voice-manage-list`, `.voice-manage-row`, `.voice-manage-row.selected`,
`.voice-row-btn`, `.voice-name-edit`, `.voice-unstable-tag` (whose CLASS moved
to the picker in Task 3 — but check the picker actually renders
`t('voiceLibrary.unstable', …)` on rows whose `meta.unstable` is set. Moving a
class without its label is how the warning silently disappeared once already),
picker), `.voice-preview-spinner` together with the
`&:disabled:not(:has(.voice-preview-spinner))` opacity rule that guards it, and
the rules COPIED in Tasks 3 and 5 — Task 3 duplicated the `.voice-facet-*`
rules and `@keyframes voice-preview-spin` into `VoicePicker.scss` rather than
moving them (the section kept rendering its own facet bar until this task, and
`voiceFacetStyles.test.ts` asserts those rules exist in
`VoiceLibrarySection.scss`), so deleting the originals is THIS task's job. When
you do, re-point that test's FIRST `describe` (`'facet filter bar styling'`,
the one compiling `VoiceLibrarySection.scss`) at whatever still lives in the
section — `.voice-selected-description` stays, the `.voice-facet-*` cases move
to the picker block Task 3 appended — and keep its `.voice-facet-bar` margin
assertion only if the rule it checks survives.

`voiceFacetStyles.test.ts` now has THREE describes, not two, and the third is
this task's problem as well. Task 5 appended one compiling
`VoiceCreateModal.scss` over its `voice-create-modal__*` class names. When you
rename those classes to the shared `voice-modal*` set below, that describe's
`it.each` list still names the old ones, so it fails on classes the stylesheet
no longer emits. Re-point it in the SAME commit as the rename, and add the
delete modal's own classes to it — this file is the only check that a class
someone typed is actually styled, so a rename that skips it silently removes
that protection for both modals.

`.voice-preview-spinner` is easy to miss because Task 3 does not move it — it
supersedes it, emitting `.voice-row__spinner` in `VoicePicker.scss` off the same
`@keyframes voice-preview-spin`. So the old rules (today at
`VoiceLibrarySection.scss:247–280`) are left behind by that rename, and this is
the task that removes them. Leaving them would keep styling for markup this
component no longer renders. Keep `.voice-library-section`,
`.voice-library-info`, `.voice-capture-error`, `.voice-selected-description`.

- [ ] **Step 6b: Settle the console ledger in this same commit**

Step 4 deleted the capture code, and with it three of the section's five
`console.warn` calls — `'Voice import failed:'`, `'Recording failed to start:'`
and `'Recording handler failed:'`, which Task 5 already copied into
`VoiceCreateModal.tsx`. In `src/lib/diagnostics/consoleLedger.consistency.test.ts`
lower the `src/components/Settings/sections/VoiceLibrarySection.tsx` row (line
144) from **5 to 2**.

Two is the right number, not zero: `'Rename failed:'` and `'Delete failed:'`
stay in the section on purpose, because the picker takes `onRename`/`onAskDelete`
and the delete modal takes `onConfirm` as props — the `try/catch` that logs
those failures belongs to the composition root this section has become. The
ledger pins exact per-file counts, so this edit must land in THIS commit:
Step 7's gate fails otherwise, and `CLAUDE.md` requires the ledger to move in
the same diff as the calls.

- [ ] **Step 7: Run everything**

Run: `npx vitest run src/components/Settings/sections/`
Expected: green. `VoiceLibrarySection.test.tsx` is smaller than its 18 cases,
`VoicePicker.test.tsx` has 18, the two modals have 7 and 3, and the three
section suites still pass unchanged — they render through the new picker but
assert on voice names and buttons, not on `<option>`s. Any that do assert on
`<option>`s are Task 7's and Task 8's to fix; note them in your report rather
than fixing them here.

Run the full gate grep from the Global Constraints, not a narrowed one — this
task rewrites the section every other voice surface renders through, so an
error landing in `SonioxVoiceSection` or `NativeVoiceSection` must not slip
past:

`npx tsc --noEmit 2>&1 | grep -E "VoicePicker|VoiceCreateModal|VoiceDeleteModal|VoiceLibrarySection|SonioxVoiceSection|NativeVoiceSection|LocalInferenceVoiceSection|VoiceLibrary"` → no output.

Also run `npx vitest run src/locales/locales.consistency.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts` → green, which is what proves Step 6b's count.

- [ ] **Step 8: Commit**

```bash
git add src/components/Settings/sections/VoiceDeleteModal.tsx src/components/Settings/sections/VoiceDeleteModal.test.tsx src/components/Settings/sections/VoiceCreateModal.scss src/components/Settings/sections/VoiceLibrarySection.tsx src/components/Settings/sections/VoiceLibrarySection.scss src/components/Settings/sections/VoiceLibrarySection.test.tsx src/components/Settings/sections/VoiceLibrarySection.facets.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts
git rm src/components/Settings/sections/VoiceLibrarySection.optgroupLabel.test.tsx
git commit -m "feat(voice): delete-confirm modal; the voice section becomes a composition root"
```

---

## Task 7: Soniox — presets audition, and the confirm modal follows the create modal

**Files:**
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx`
- Test: `src/components/Settings/sections/SonioxVoiceSection.test.tsx`

**Interfaces:**
- Consumes: Task 1's `previewable`, Task 6's composition root.
- Produces: no new exports.

`handlePreview` already treats the id opaquely and resolves the sample with
`resolvePreviewSample(settings.targetLanguage, null)`, which is correct for
presets too (spec §6.1) — so this task is mostly test work plus one comment
correction, and the sequential confirm-modal flow (spec §6.3) needs no code
change either: `onRecord`/`onImport` still stage `pending`, and the create modal
closes itself when its handler resolves.

- [ ] **Step 1: Write the failing tests**

Add to `SonioxVoiceSection.test.tsx`:

```tsx
  it('auditions a preset through the same mint-and-report path as a clone', async () => {
    // … render the section with a managed source stub whose sessionKey and
    // previewDone are spies, open the picker, click the ▶ on a preset row …
    expect(client.sessionKey).toHaveBeenCalledWith({ mode: 'voice_preview' });
    expect(synthesize.mock.calls[0][0]).toMatchObject({ voice: 'Grace', language: 'ja' });
    expect(client.previewDone).toHaveBeenCalledTimes(1);
  });

  // This case has TWO halves and an earlier draft of this step specified only
  // the first, leaving a title that overclaimed: clicking twice at the SAME
  // language and speed proves the cache HIT and says nothing whatever about the
  // KEYING. Assert both — a same-key repeat synthesizes once, and a repeat with
  // one key component changed (a different target language, or a different
  // speed) synthesizes again. If this suite's fixtures cannot vary a key
  // component, retitle the case to the half it actually checks rather than
  // leaving the claim standing.
  it('caches a preset audition by language and speed: the same key reuses, a different language re-synthesizes', async () => {
    // … click ▶ twice on the same preset row …
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('stages the clip and opens the confirm modal after the create modal closes', async () => {
    // … open the create modal from the picker, drop a clip, assert the create
    // dialog is gone and SonioxCloneConfirmModal's naming field is present …
  });
```

Write each case out in full against this file's existing fixtures (it already
builds managed and BYOK sources with stubbed clients — follow the nearest
existing preview case rather than inventing a new harness).

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/components/Settings/sections/SonioxVoiceSection.test.tsx -t "preset"`
Expected: FAIL — the ▶ on a preset row is not found until Task 1's `previewable: true` is in place (it is, from Task 1) and the picker is wired (Task 6), so the likely failure is the missing `language`/`voice` expectations if the section still shortcuts presets; confirm the failure reason before implementing.

- [ ] **Step 3: Correct the comment and any clone-only assumption**

In `handlePreview`, the comment that says a cloned Soniox voice is
"documented any-voice-any-language" now covers presets too:

```ts
    // `null`: a Soniox voice — preset or clone — is documented
    // any-voice-any-language, so the language rule collapses to the target
    // language with English then the table as fallbacks. A preset id IS the
    // `voice` field of the TTS request, so nothing here needs to know which
    // kind it is.
```

Check the managed path's balance-floor and 402/409 arms still read correctly for
a preset (they are keyed on the error, not the voice kind) and leave them alone.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run src/components/Settings/sections/SonioxVoiceSection.test.tsx`
Expected: all PASS (61 + 3).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/SonioxVoiceSection.tsx src/components/Settings/sections/SonioxVoiceSection.test.tsx
git commit -m "feat(voice): audition Soniox presets through the existing preview path"
```

---

## Task 8: Local Native — presets audition in their own language

**Files:**
- Modify: `src/components/Settings/sections/NativeVoiceSection.tsx`
- Test: `src/components/Settings/sections/NativeVoiceSection.test.tsx`

**Interfaces:**
- Consumes: Task 1's `previewable`; `resolvePreviewSample` and `previewCacheKey` as already imported (they live in `src/lib/tts/previewSample.ts`, not under `src/lib/voiceLibrary/`); `PreviewTtsHandle.synthesize({ modelId, language, text, speed, voice })` from `src/lib/local-inference/native/nativePreviewTts.ts`, where `voice` is `{ kind: 'name'; name: string }` for a preset.
- Already done for you: Task 1 set `previewable: true` inside `toBuiltin` (`NativeVoiceSection.tsx:317`), so every Native preset is already marked auditionable. Do NOT re-add that field — this task changes only the preview LOGIC.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Add to `NativeVoiceSection.test.tsx`:

```tsx
  it('auditions a preset with the sentence for THAT voice language, not the target language', async () => {
    // target language 'en', a preset whose meta.language is 'ja'
    // … open the picker, click ▶ on the Japanese preset …
    expect(synthesize.mock.calls[0][0]).toMatchObject({
      language: 'ja',
      voice: { kind: 'name', name: 'jp-voice' },
    });
  });

  it('re-inits the engine when the next audition is in another language', async () => {
    // … audition an 'en' preset, then a 'ja' preset …
    expect(initCalls).toEqual(['en', 'ja']);
  });

  it('reports a failed preset audition instead of playing a clip', async () => {
    // synthesize rejects; the preset has no clip to fall back to
    expect(await screen.findByText(/could not synthesize a preview/i)).toBeInTheDocument();
    expect(playedAudio()).toBeNull();
  });

  it('still falls back to the reference clip when a CLONE fails to synthesize', async () => {
    // guard for the existing behaviour — a clone keeps its fallback
  });
```

Write them out fully against this file's existing store/TTS fakes.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx -t preset`
Expected: FAIL — `handlePreview` returns `null` for a `builtin:` id, so nothing is synthesized and the first assertion receives no calls.

- [ ] **Step 3: Teach `handlePreview` about presets**

First, a two-line correction Task 1 left behind. The comment it wrote above
`previewable: true` reads "Presets audition in THEIR OWN language on the
dedicated preview connection (spec §6.2); Task 5 teaches handlePreview the
`builtin:` id." The task number is wrong — teaching `handlePreview` about
preset ids is THIS task. Do not renumber it to "Task 8" either: that file
already carries seven stale `Task N` references from an older, finished plan
(lines 36–52 and 324), and a bare task number means nothing to a reader who
does not have that plan open. Replace the second sentence with what the code
actually does, e.g. "the `builtin:` branch of `handlePreview` below resolves the
name against `builtinVoices` and synthesizes in that voice's own language."

Then replace the section-level `previewSample` memo with a per-voice resolver
and branch `handlePreview` on the id's prefix:

```ts
  /** The sample sentence for ONE voice: a preset speaks its own language, a
   *  clone speaks the target language. Both are still gated on the model
   *  actually speaking it (`ttsLanguages`), so a voice whose language this
   *  model cannot speak has no sample and no ▶. */
  const sampleFor = useCallback(
    (language?: string) =>
      resolvePreviewSample(language || targetLanguage, (l) => supportsLanguage({ languages: ttsLanguages }, l)),
    [targetLanguage, ttsLanguages],
  );
```

Keep the existing `previewSample` (now `sampleFor(undefined)`) for
`previewUnavailableReason`, and add the preset branch at the top of
`handlePreview`:

```ts
    if (id.startsWith('builtin:')) {
      const name = id.slice('builtin:'.length);
      const voice = builtinVoices.find((v) => v.name === name);
      const sample = sampleFor(voice?.language);
      // No sentence in a language this model speaks: nothing to synthesize,
      // and no clip to fall back on — a preset has no reference audio.
      if (!sample) return null;
      const cacheKey = previewCacheKey(`native:${ttsModelId}`, id, sample.language, PREVIEW_SPEED);
      const cached = getCachedPreview(cacheKey);
      if (cached) return signal?.aborted ? null : cached;
      if (!previewTtsRef.current) previewTtsRef.current = createPreviewTts();
      if (synthInFlightRef.current) return null;
      synthInFlightRef.current = true;
      try {
        const result = await previewTtsRef.current.synthesize({
          modelId: ttsModelId,
          // The sidecar stores the language on the engine at init, so a
          // language change re-inits — seconds, not milliseconds. The row's
          // spinner covers it.
          language: sample.language,
          text: sample.text,
          speed: PREVIEW_SPEED,
          voice: { kind: 'name', name },
        });
        setCachedPreview(cacheKey, result);
        return signal?.aborted ? null : result;
      } catch {
        setCaptureError(t('voiceLibrary.previewFailed', 'Could not synthesize a preview for this voice.'));
        return null;
      } finally {
        synthInFlightRef.current = false;
      }
    }
```

The clone branch below keeps its clip fallback verbatim.

- [ ] **Step 4: Run to verify**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx`
Expected: all PASS (21 + 4, minus any record-flow case Task 5/6 moved — re-point those rather than deleting them).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/NativeVoiceSection.tsx src/components/Settings/sections/NativeVoiceSection.test.tsx
git commit -m "feat(voice): audition Local Native presets in their own language"
```

---

## Task 9: Supertonic keeps no ▶, and the whole directory is green

**Files:**
- Modify: `src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx`
- Modify: whichever section suites still assert on removed markup (found in Step 1)

**Interfaces:**
- Consumes: every earlier task.
- Produces: a green `src/components/Settings/sections/` and green consistency suites.

- [ ] **Step 1: Find what the redesign broke**

Run: `npx vitest run src/components/Settings/sections/ 2>&1 | tail -40`
Write the failing list into your report before touching anything.

- [ ] **Step 2: Add the Supertonic guard**

In `LocalInferenceVoiceSection.test.tsx`:

```tsx
  it('offers no audition control for Supertonic presets', () => {
    // `{...base}` and `ttsModel`, copied from this file's own cases at lines 47
    // and 55. There is NO `engine` prop on `LocalInferenceVoiceSection` — its
    // props are `ttsModel`, `edgeVoices`/`edgeVoiceStatus`/`edgeTtsVoice`,
    // `supertonicVoices`/`supertonicSelectedId`, the three voice callbacks and
    // `ttsSpeakerId`; the component derives which engine's UI to render FROM
    // `ttsModel`. An earlier draft of this step passed `engine="supertonic"`,
    // which would not compile and would not select Supertonic either.
    render(<LocalInferenceVoiceSection {...base} ttsModel="super-model" />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByRole('button', { name: /play/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Re-point the rest**

Fix each failure by querying the new markup (open the picker, then query inside
`role="grid"`), never by weakening an assertion. A case that asserted on
`<option>` elements becomes one that asserts on a row; a case that asserted the
manage block asserts the create modal instead.

- [ ] **Step 4: Run every gate**

```bash
npx vitest run src/components/Settings/sections/
npx vitest run src/locales/locales.consistency.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts
npx tsc --noEmit 2>&1 | grep -E "VoicePicker|VoiceCreateModal|VoiceDeleteModal|VoiceLibrarySection|SonioxVoiceSection|NativeVoiceSection|LocalInferenceVoiceSection|VoiceLibrary"
```
Expected: the first two green, the third silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections
git commit -m "test(voice): re-point the section suites at the new picker"
```

---

## Task 10: See it in the real app

**Files:** none (verification only; any fix found here belongs to the task that owns the file)

**Interfaces:**
- Consumes: the finished feature.

The suites cannot see a popover clipped by the settings panel, a row whose
subtitle overflows in German, or a modal that opens behind the panel. This task
is one pass with real eyes, per the repo's "settle UI decisions by rendering"
rule.

- [ ] **Step 1: Run the app**

Run: `npm run electron:dev`

- [ ] **Step 2: Walk the surface at the narrow panel width**

With the settings panel at its narrowest, for the **Soniox** provider (a managed
account, so previews charge — one or two is enough):
open the picker; confirm the popover is not clipped and scrolls; filter by
gender and watch the count update; audition two presets back to back (the second
must not 409 — backend #71 is live); select one and confirm the trigger and the
description line update; rename and delete a clone; add a voice through the
modal and confirm the confirm-modal follows it.

- [ ] **Step 3: Repeat for Local Native**

Pick a TTS model with presets, audition a preset in the target language and one
in another language (the second re-inits — confirm the spinner covers it and the
audio is right), then audition a clone and confirm the clip fallback still works
when synthesis fails.

- [ ] **Step 4: Check one non-Latin locale**

Switch the UI to Japanese and re-open the picker: the row subtitles, the group
headers, the add row and both modals must fit without clipping at the 300px
panel width.

- [ ] **Step 5: Report**

Write what you saw into your report — including anything you did NOT fix — and
stop. Fixes land in the owning task's file with their own test.

---

## Self-review

**Spec coverage.** §2.1 packaging → this plan lands on the #542 branch (no task
needed). §2.2 preset preview scope → Tasks 7 (Soniox), 8 (Native), 9
(Supertonic guard). §2.3 self-drawn picker → Tasks 3–4. §2.4 filters inside, no
search → Task 3 Step 3 (facet row inside the popover) and Task 4 (type-ahead
instead of a search box). §2.5 creation and delete modals → Tasks 5–6. §2.6 R2
rows → Task 3 (`rowSubtitle`). §2.7 delete the list presentation → Tasks 1 and
6. §4.1 `previewable` → Task 1. §4.2 capability → Task 1. §4.3 `manageNote`
into the modal and `onRefresh` into the popover → Tasks 5 and 3. §5 file
structure → this plan's File Structure. §6.1/§6.2/§6.3 → Tasks 7, 8, 7 Step 3.
§7 keyboard → Task 4, plus the modal Escape cases in Tasks 5 and 6. §8 copy →
Task 2. §9 testing → every task's test steps plus Task 9. §10 out-of-scope →
nothing implemented for Supertonic preview, Palabra, #43's gallery, server-side
samples or CI scope. §11 risks → Task 10 is the "200 rows in a popover" and
"re-init feels slow" measurement pass.

**Placeholder scan.** One deliberate shortfall: Tasks 7 and 8 describe their new
test cases with a leading comment line instead of the full fixture setup, because
both suites build their doubles through file-local helpers (managed/BYOK source
stubs; store and TTS fakes) that a verbatim snippet would duplicate wrongly.
Each such step names the existing case to copy from. Task 2's translation table
gives five languages in full and instructs the same six strings for the rest —
the alternative, 25 more table rows, would be padding rather than plan.

**Type consistency.** `previewable?: boolean` (Task 1) is read by `canAudition`
in Tasks 1 and 3 with the same default rule. `VoicePickerProps` (Task 3) is
consumed with exactly those names in Task 6's render. `VoiceCreateModalProps`
(Task 5) and `VoiceDeleteModalProps` (Task 6) match their call sites.
`PreviewTtsHandle.synthesize`'s argument in Task 8 matches the real signature
(`modelId`, `language`, `text`, `speed`, `voice`), and `voice: { kind: 'name',
name }` matches `PreviewVoice`'s name variant. `previewCacheKey(source, id,
language, speed)` keeps its four-argument order in Task 8. The copy keys in
Tasks 3, 5, 6 and 8 are exactly the six Task 2 adds plus existing ones (`common.cancel` and `common.close` among them).
