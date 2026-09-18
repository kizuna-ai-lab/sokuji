# Voice Library Redesign — Preset Preview and One Consistent Surface — Design

**Date**: 2026-09-16
**Status**: Approved in brainstorming (decisions recorded in §2); spec awaiting jiangzhuo's review
**Repo**: `kizuna-ai-lab/sokuji`, branch `worktree-custom-voice-preview-spec` (the
branch PR #542 already carries)
**Tracking**: issue #43 (voice showcase with audio previews) — this is its first
real step; issue #367 (PalabraAI builtin + cloned voices) is the future provider
the seam is shaped for.

**Supersedes in part**: `2026-08-01-soniox-voice-preview-design.md`, whose scope
note said the built-ins "live inside a `<select>` as `<option>`s, which cannot
host a button — covering them needs a different affordance and is a separate
change." This is that change.

**Builds on**: `2026-09-09-custom-voice-preview-design.md` (phases 1–3: the
preview sample table, the language rule, the app-session preview cache, managed
mint → `preview-done`, per-source serialization and the single 409 retry) and
`kizuna-ai-lab/sokuji-backend#71` (a done preview lease is re-entrant, so
auditioning voice after voice no longer 409s). Both are prerequisites, both
already landed on their respective sides.

## 1. Problem

A user picking a voice cannot hear it first unless it is one they cloned
themselves. Today:

- **Presets** (Soniox 200, Supertonic 10, Local Native per-family) are
  `<option>`s in a native `<select>`. An `<option>` cannot host a button, so
  there is nowhere to put a play control.
- **Cloned voices** get a play button, but only inside the collapsed
  "Manage imported voices" block — a different surface, with different
  affordances, from the one where voices are chosen.

So the two kinds of voice behave differently, and the 200-voice Soniox roster —
the one that most needs auditioning — is the one that cannot be auditioned at
all. Choosing a voice today means starting a full translation session to hear
it.

Two structural facts make this a redesign rather than a patch:

1. **`presentation: 'list'` is dead.** Every production consumer passes
   `'dropdown'` (`SonioxVoiceSection`, `LocalInferenceVoiceSection`,
   `nativeVoiceStores`, and `NativeVoiceSection`'s own default). The list branch
   — `renderRow`, `capability.curation`, the show-all expander — is reachable
   only from `VoiceLibrarySection.test.tsx`.
2. **Roster sizes differ by 40×.** Supertonic has 10 presets, Soniox 200. An
   always-open inline list wastes space on one and overflows the settings panel
   on the other, so the picker must stay collapsed-by-default and size itself to
   its roster.

## 2. Decisions (jiangzhuo, 2026-09-16)

Recorded verbatim in their effect, in the order they were made:

1. **Ship inside PR #542.** The redesign joins the custom-voice-preview PR
   rather than following it. #542's review restarts; that cost is accepted.
2. **Preset preview for Soniox and Local Native.** Supertonic (the WASM
   `local_inference` engine) gets no play control on presets — the seam is
   designed so adding it later is an adapter change, not a component change.
3. **The picker becomes a self-drawn popover list ("D1").** A native
   `<select>` — even Chromium's customizable one — is out: option content is
   non-interactive by design and the extension's floor (Chrome 116) has no
   `appearance: base-select` at all. Going custom also makes the browser-version
   question moot, so the extension and Electron run the same code path.
4. **Filters live inside the popover. No search box.** Type-to-jump keyboard
   behaviour is standard listbox/grid behaviour and is not a search UI.
5. **Creation moves into its own modal, entered from inside the popover ("D").**
   The panel keeps nothing but the picker and one description line: no
   "Manage imported voices" block at all. Delete confirmation also becomes a
   modal, replacing today's `window.confirm`.
6. **Rows show name + facets ("R2").** `Grace  female · calm · soft`, drawn from
   metadata the roster already carries. No new per-voice data, no per-row
   description paragraph.
7. **Delete the dead list presentation.** `presentation`, `capability.curation`,
   `renderRow`, the show-all expander and the `showAll`/`showFewer` strings go
   with it.

Accepted costs, stated when the options were presented and accepted as read:

- Drag-and-drop for voice files lands on the create modal, not the panel — a
  file drop needs the modal open first.
- Local Native's record flow moves from inline toolbar to modal: a behaviour
  change for that provider, and its record/transcript tests change with it.
- Soniox's existing `SonioxCloneConfirmModal` (post-capture playback, naming,
  consent statement) now runs *after* the create modal rather than beside an
  inline toolbar (§6.3).

## 3. Shape

```
┌ Settings panel (≈300–390px wide) ────────────────┐
│ VOICE                                            │
│ ┌ trigger ─────────────────────────────────┐     │   collapsed: two lines, always
│ │ Grace  (female · calm · soft)          ▾ │     │
│ └──────────────────────────────────────────┘     │
│ Unhurried American guide voice, quiet and …      │   selected voice's description
└──────────────────────────────────────────────────┘

open:
┌ popover (anchored to the trigger) ───────────────┐
│ [Female ▾] [Any age ▾] [Warm ▾]                  │  facet row — only when the
├──────────────────────────────────────────────────┤  provider publishes facets
│ MY VOICES                                        │
│ ＋ Add a voice…                                   │  opens the create modal
│ My voice            自定义        ▶  ⋯  ✕        │
│ PRESETS · 23 of 200                              │
│ Grace     female · calm · soft      ▶            │  ← selected row marked
│ Victoria  female · formal · bright  ▶            │
│ …                                      (scrolls) │
└──────────────────────────────────────────────────┘
```

Row behaviour, identical for presets and clones:

| Control | Action |
|---|---|
| name | select this voice, close the popover |
| ▶ | synthesize and play the sample sentence; popover stays open; icon becomes a spinner while in flight and `↻` once played |
| ⋯ (clones only) | rename inline, in place |
| ✕ (clones only) | open the delete-confirm modal |

The popover's height follows its roster: ten rows for Supertonic renders ten
rows and does not scroll; Soniox's filtered roster scrolls inside a fixed
maximum (`max-height`, ~236px ≈ 8 rows at R2 row height).

## 4. Component contract

`VoiceLibrarySection` keeps its name and its place in the three sections that
render it. Its props change as follows.

### 4.1 `VoiceEntry` gains one optional field

```ts
export interface VoiceEntry {
  id: string;                       // opaque; the section owns the scheme
  label: string;
  group: 'builtin' | 'custom';
  removable: boolean;               // rename / delete affordances
  disabled?: boolean;               // listed, not selectable
  /** Whether THIS entry can be auditioned. Absent = inherit the group default:
   *  a `custom` entry can (it has a clip or a cloned voice behind it), a
   *  `builtin` entry cannot. A provider whose presets are auditionable sets it
   *  true on those entries (Soniox, Local Native); one whose presets are not
   *  leaves it alone (Supertonic). The component renders ▶ iff
   *  `onPreview && previewable && !disabled`. */
  previewable?: boolean;
  meta?: {
    gender?: 'M' | 'F';
    unstable?: boolean;
    language?: string;
    facets?: VoiceFacets;
  };
}
```

Why an entry-level flag rather than a capability flag: Local Native's presets
are auditionable while its *clip-required* families' clones are not until a clip
exists, and a future Palabra roster will mix builtins that publish a sample URL
with clones still processing. Auditionability is a property of the voice, not of
the provider. One flag covers every case the three providers and #367 present,
and the component stays ignorant of why.

### 4.2 `VoiceLibraryCapability` loses two fields, keeps the rest

Removed: `presentation` (one presentation now) and `curation` (the show-all
expander was list-mode only).

Kept unchanged: `importModes`, `accept`, `transcriptRequired`, `maxClipSeconds`,
`minClipSeconds`, `facetFilter`, `multipleImport`. `importModes` now decides
what the **create modal** offers rather than what the inline toolbar offers; an
empty `importModes` hides the `＋ Add a voice…` row entirely (that is how
`SonioxVoiceSection` already expresses "no API key yet, so no creating").

### 4.3 Callbacks

Unchanged in shape: `onSelect`, `onImport`, `onRecord`, `onRename`, `onDelete`,
`onPreview`, `onRefresh`, `previewUnavailableReason`, `manageNote`,
`isSessionActive`.

`manageNote` moves inside the create modal (it is provider copy about creating
and about preview cost). `onRefresh`'s button moves into the popover's footer,
where the list it refreshes lives.

## 5. Files

**New**

| File | Responsibility |
|---|---|
| `src/components/Settings/sections/VoicePicker.tsx` | The trigger + popover: rows, facet row, `＋ Add a voice…`, keyboard and focus behaviour. Owns no voice data and no network calls. |
| `src/components/Settings/sections/VoicePicker.scss` | Its styles. |
| `src/components/Settings/sections/VoiceCreateModal.tsx` | Import / record / drop / transcript, plus `manageNote`. Provider-agnostic; takes the same callbacks the section already passes. |
| `src/components/Settings/sections/VoiceCreateModal.scss` | Its styles. |
| `src/components/Settings/sections/VoiceDeleteModal.tsx` | Delete confirmation (name, the "this also deletes the on-device reference clip" consequence, Cancel / Delete). |

**Modified**

| File | Change |
|---|---|
| `VoiceLibrarySection.tsx` | Becomes the composition root: state (open, playing, renaming, which modal), and the three children above. Loses `renderRow`, `renderManageRow`, the `<select>`/`<optgroup>` block, the `<details>` manage block, `showAll`, `richSelect`/`supportsBaseSelect`, the `window.confirm` delete. Target: well under half its current 948 lines. |
| `VoiceLibrarySection.scss` | Loses the manage-block and dropdown rules; keeps the facet-bar rules, relocated into the popover. |
| `types/VoiceLibrary.ts` | `VoiceLibraryCapability`: drop `presentation`, `curation`. |
| `SonioxVoiceSection.tsx` | Marks preset entries `previewable: true`; drops `presentation`/`curation` from its capability; `handlePreview` stops assuming a clone (§6.1); the confirm-modal flow is entered from the create modal (§6.3). |
| `NativeVoiceSection.tsx` | Marks preset entries `previewable: true`; `handlePreview` learns `builtin:` ids and per-voice language (§6.2); record moves into the modal. |
| `LocalInferenceVoiceSection.tsx` | Capability edit only (drop `presentation`); its presets stay without ▶. |
| `src/locales/*/translation.json` (30) | New keys, dead keys removed (§8). |

**Deleted**

`VoiceLibrarySection.optgroupLabel.test.tsx` — it pins `<legend>` inside
`<optgroup>` under `appearance: base-select` for this picker, which no longer
exists here. `ProviderSection`'s own rich-option dual track is untouched, and
`supportsBaseSelect` stays in the repo for it.

## 6. Preview, per provider

The component calls `onPreview(id, signal)` and knows nothing else. Each section
answers it differently, and those differences are the substance of this feature.

### 6.1 Soniox — presets and clones, one path

A Soniox voice id *is* the `voice` field of the TTS request, for both a 200-name
preset and a cloned-voice UUID; nothing needs to know which it is. The language
rule is unchanged from phase 2: Soniox voices are documented any-voice-any-
language, so `resolvePreviewSample(targetLanguage, null)` (target language,
falling back to English, then the table) applies to presets exactly as it does
to clones.

Managed accounts mint a single-use TTS key per preview and report
`preview-done`; BYOK synthesizes on the user's own key. Both already exist and
are unchanged — including the per-source serialization and the single
abort-aware 409 retry, which matter *more* now: browsing 200 presets is exactly
the audition-after-audition pattern backend #71 made cheap.

Cost, unchanged and already disclosed by `previewChargedToBalance`: about
$0.0014 per managed preview, charged from the wallet, and the app-session cache
means the same voice in the same language at the same speed synthesizes once.

### 6.2 Local Native — new work

Today `NativeVoiceSection.handlePreview` returns `null` for anything that is not
a `custom:` id, and resolves ONE sample sentence from the target language for
the whole section. Presets need three changes:

1. **Per-voice language.** Each `NativeVoiceInfo` carries its own `language`;
   the sample sentence must be resolved for THAT language, not the target
   language. So sample resolution moves from a section-level `useMemo` to a
   per-entry function: `resolvePreviewSample(voice.language ?? targetLanguage,
   (l) => supportsLanguage({ languages: ttsLanguages }, l))`.
2. **Re-init on language change.** `nativePreviewTts`'s handle reuses its warm
   engine only while `modelId` AND `language` both match; the sidecar stores the
   language on the engine at init. Auditioning a Japanese preset after an
   English one therefore re-inits — seconds, not milliseconds. The spinner
   already covers it; the row stays disabled while in flight, and the existing
   `synthInFlightRef` guard already refuses an overlapping synthesis on the
   shared connection.
3. **No clip fallback.** A clone that fails to synthesize falls back to replaying
   its reference clip. A preset has no clip: on failure the section surfaces the
   error through `captureError` and plays nothing. `voiceLibrary.previewFailed`
   (new, §8) is that message.

`previewUnavailableReason` keeps its two existing meanings (a live session holds
the sidecar's TTS engine; no sample sentence exists in a language this model
speaks) and both still disable every ▶ in the picker.

A preset roster is only known after a model load for every family except
supertonic, whose ten presets are load-free. That is pre-existing behaviour of
the voice list, not something this redesign changes: the picker shows whatever
`builtinVoices` currently holds.

### 6.3 Creation: one shell, provider steps after it

`VoiceCreateModal` owns step one for every provider: the transcript field when
`transcriptRequired`, the Import and Record controls that `importModes` allows,
the drop zone, and `manageNote`. It calls the same `onImport` / `onRecord`
callbacks the section passes today, then closes.

Soniox's `SonioxCloneConfirmModal` (playback, naming, the consent statement)
stays a separate, *sequential* modal: the create modal closes, the confirm modal
opens on the captured clip. Merging them into one multi-step modal is rejected
for this PR — the confirm modal carries a consent statement and its own error
and busy states, and re-homing it inside a new shell would put the riskiest part
of voice cloning in the same diff as a picker rewrite. Sequential costs the user
one extra transition and costs us nothing structurally.

## 7. Keyboard, focus and semantics

The row is the design's one real accessibility complication: it carries a
primary action (select) plus up to three secondary buttons. That is not a
`listbox` — an `option` may not contain interactive content — so the popover is
built as the APG **grid** pattern:

- The popover is `role="grid"`, one `role="row"` per voice, each control in its
  own `role="gridcell"`.
- `↑`/`↓` move between rows, `←`/`→` between the controls of the focused row,
  `Home`/`End` jump to the first/last row.
- Typing letters jumps to the next row whose label starts with them (standard
  type-ahead; this is what stands in for the search box we deliberately did not
  build).
- `Enter` on the name cell selects and closes; `Esc` closes without selecting
  and returns focus to the trigger; a click outside dismisses
  (`@floating-ui/react`'s `useDismiss`, as `ModeDevicePopover` already does).

What is precedent here and what is new, because the difference is the bulk of
this component's work: the repo's popovers (`ModeDevicePopover`,
`AccountPopover`) supply the *dismissal and positioning* pattern —
`useFloating` + `useDismiss`, and `useRole` where the floating element is a
dialog — and `ModeDevicePopover` does carry a `role="listbox"` device list. But
neither uses `useListNavigation` or `useTypeahead`, and neither implements
two-axis arrow movement. The grid roles, the `↑`/`↓`/`←`/`→` roving focus, the
type-ahead and the focus return are **new code in `VoicePicker`**, each with its
own test in §9 — not something to be copied from an existing file.
- The trigger is `aria-expanded` + `aria-controls`; the selected row carries
  `aria-selected="true"`.

Rejected alternative: keep `role="listbox"` and move the actions out of the row
(a footer that acts on the highlighted voice). It would preserve the simpler
pattern but destroy the thing this redesign exists for — per-row auditioning.

Both modals follow `ModelImportModal`'s existing precedent: `role="dialog"`,
`aria-modal="true"`, Escape closes, focus moves in on open and returns to the
invoking control on close.

## 8. Copy

New keys (added to all 30 catalogs; `locales.consistency.test.ts` requires every
catalog's key set to equal `en`'s exactly, with matching placeholders and no
empty strings):

| Key | English |
|---|---|
| `voiceLibrary.addVoice` | `Add a voice…` |
| `voiceLibrary.addVoiceTitle` | `Add a voice` |
| `voiceLibrary.deleteTitle` | `Delete voice` |
| `voiceLibrary.deleteBody` | `Delete "{name}"? This also removes the reference recording stored on this device.` |
| `voiceLibrary.cancel` | `Cancel` |
| `voiceLibrary.previewFailed` | `Could not synthesize a preview for this voice.` |
| `voiceLibrary.filterCount` | `{shown} of {total}` |

Retired: `voiceLibrary.showAll`, `voiceLibrary.showFewer` (list mode),
`voiceLibrary.manageImported` (no manage block), `voiceLibrary.deleteConfirm`
(replaced by `deleteTitle` + `deleteBody`). `emptyHint` survives: the popover
shows it under `MY VOICES` when a provider can create but has no clones yet.

Reused unchanged: `play`, `stopPreview`, `synthesizing`, `rename`, `delete`,
`importVoice`, `recordVoice`, `stopRecording`, `transcript`, `transcriptHint`,
`transcriptPlaceholder`, `dropHint`, `presets`, `myVoices`, `voice`,
`unstable`, `refreshList`, the `filter.*` group, every `clip*` / `preview*`
error string.

## 9. Testing

The component's own suites are rewritten around the new surface rather than
patched: today's 18 (`VoiceLibrarySection.test.tsx`) + 17
(`…facets.test.tsx`) + 2 (`…optgroupLabel.test.tsx`) become

- `VoicePicker.test.tsx` — opens and closes; rows render name + facets (R2) for
  presets and `自定义` for clones; ▶ renders iff `onPreview && previewable &&
  !disabled` (so: Soniox preset yes, Supertonic preset no, processing clone no);
  clicking the name selects and closes while ▶ does not; `previewUnavailableReason`
  renders the disabled ▶ with that reason as its label; the facet row appears
  only under `facetFilter` and narrows presets without touching clones;
  `＋ Add a voice…` appears only when `importModes` is non-empty; `↑`/`↓`/`←`/`→`,
  type-ahead, `Enter`, `Esc` and outside-click all behave as §7 states.
- `VoiceCreateModal.test.tsx` — `importModes` decides which controls render;
  `transcriptRequired` gates Import/Record on a non-empty transcript; a drop
  reaches `onImport`; `multipleImport: false` keeps only the first file; Escape
  and the backdrop close it; `manageNote` renders.
- `VoiceDeleteModal.test.tsx` — names the voice, Cancel resolves nothing,
  Delete calls `onDelete` once.
- `…facets.test.tsx` — kept, re-pointed at the popover's facet row (its 17 cases
  are about filtering semantics, which do not change).

Section suites: `SonioxVoiceSection.test.tsx` (61) — the picker-shape
assertions move to the new markup, and new cases cover a preset preview minting
a key, reporting `preview-done`, and being cached per language+speed.
`NativeVoiceSection.test.tsx` (21) — record-flow cases move to the modal; new
cases cover a preset previewing in ITS OWN language, a language change
re-initing, and a failed preset preview surfacing `previewFailed` rather than
playing a clip. `LocalInferenceVoiceSection.test.tsx` (4) — presets keep no ▶.

`voiceFacetStyles.test.ts` compiles the SCSS and asserts the emitted selector
(the project's stylesheet-invariant rule); it moves with the facet row into the
popover's stylesheet.

Gates, per the repo's rules: `npx vitest run src/components/Settings/sections/`
green; `npx tsc --noEmit 2>&1 | grep -E "VoicePicker|VoiceCreateModal|VoiceDeleteModal|VoiceLibrarySection|SonioxVoiceSection|NativeVoiceSection"`
prints nothing; `npx vitest run src/lib/diagnostics/consoleLedger.consistency.test.ts`
and `src/locales/locales.consistency.test.ts` green. CI's vitest job still does
not include `src/components/Settings/sections/`, so these are local gates —
widening CI stays the separate follow-up it already was.

## 10. Out of scope

- **Supertonic preset preview.** The seam is `previewable`; adding it later is
  an adapter change in `LocalInferenceVoiceSection`.
- **Palabra (#367).** Its presets publish `tts_sample.url`, so its adapter will
  play a URL instead of synthesizing — the component's contract already allows
  that (it calls `onPreview` and plays what comes back).
- **A full voice showcase page (#43).** This redesign delivers browse + audition
  inside the settings panel; a dedicated gallery page stays open as #43.
- **Pre-rendered or cached-on-server samples.** Previews stay live syntheses,
  per the standing decision (no pre-rendering, not free).
- **Widening CI's vitest scope.** Separate PR, as already recorded.

## 11. Risks

| Risk | Handling |
|---|---|
| The picker rewrite lands in an open, already-reviewed PR (#542) | Accepted (§2.1). The spec's file split keeps the new surface in new files, so the diff reads as addition plus deletion rather than a rewrite of reviewed code. |
| A custom popover is a well-known source of focus and dismissal bugs | Reuse `@floating-ui/react` + `useDismiss` exactly as `ModeDevicePopover` does; §7's behaviours are each a test case. |
| Local Native's re-init makes a preset audition feel slow | The spinner and the in-flight guard already exist; the row disables while in flight. If it proves too slow in practice, the fallback is to keep the engine warm per language, which is a change inside `nativePreviewTts` alone. |
| 200 rows in a popover | `max-height` + native scrolling; R2 row height keeps ~8 rows visible. No virtual scrolling until measurement says it is needed — 200 rows of two spans each is not a performance problem in this panel. |
| Managed previews spend money per click | Unchanged from phase 2: the cost note is in the create modal and the balance floor plus backend's 1.5 s mint gap bound abuse; the app-session cache makes repeats free. |
