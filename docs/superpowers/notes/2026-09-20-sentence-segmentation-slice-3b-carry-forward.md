# Sentence segmentation — slice 3b carry-forward (2026-09-20)

Slice 3b implements Amendment A1 of
`docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`: the three
punctuation models are one opt-in download, and the stage does nothing until all
three are on disk. Plan:
`docs/superpowers/plans/2026-09-20-sentence-segmentation-3b-download-gate.md`.

Commits, `a1774bf1..`:

| commit | what |
|---|---|
| `b222543e` | the amendment itself, plus slice 4's plan losing its notice task |
| `2ba55ba3` | `sentenceSegmentation` defaults to false; `sentenceSegmentationNoticeShown` deleted |
| `068e7f54` | `segmentationStore` tracks one download instead of three model statuses |
| `db4e8921` | `PunctuationRuntime` loads but never downloads; `enabled` includes the pack and the memory guard |
| `5ed2f956` | both local clients read `enabled` once, at connect |
| `17bb528b` | `SentenceStream` reads it once too, at construction |
| `97cd1f5d` | the section: one toggle, one status line, one confirmation, 30 catalogs |
| `f7507a14` | punctuation models leave the Storage page; Clear all re-checks the pack |

## What the user sees now

Off in a fresh profile. Turning it on opens a confirmation listing FireRedPunc
(155.5 MB), Edge-Punct-Casing (7.3 MB) and SaT 3L-SM (239.4 MB), total 402.2 MB,
with Cancel and "Download 402.2 MB". Confirming turns the setting on and starts
the download; one status line under the toggle carries the progress bar, bytes
done of the total, and a cancel. Cancel turns the setting back off and keeps the
finished files; a failure offers Retry, which resumes; files that are gone offer
Download, which opens the confirmation again. Sentences per bubble stays greyed
until all three are on disk. With the setting off and files present, a "Delete
models (402.2 MB)" link removes them — the one delete path for every provider,
now that the Storage page no longer lists them.

## Rendered, looked at, and fine

Compiled the real SCSS (`SentenceSegmentationSection.scss`, `ToggleSwitch.scss`,
`Modal.scss`, `Settings.scss`) and rendered every state as markup copied from the
components: off-empty, off-with-files, downloading, failed, missing, ready, low
memory, and the confirmation. Two widths — 450 (default panel) and 300
(`PANEL_MIN_WIDTH`) — and four catalogs: de, ru, ja, ar.

Nothing needed changing. Worth recording:

- German is the longest: at 300 px, "172.9 MB von 402.2 MB werden
  heruntergeladen" takes two lines and the failure line takes three. Both wrap
  cleanly, and the cancel and Retry buttons hold their place.
- The confirmation's title wraps to two lines in de and ja at 300 px, and the
  SaT row's name wraps in every locale at that width. Still legible.
- `ar` mirrors correctly: toggle on the right, actions on the left, sizes still
  LTR inside the RTL line.

## Two things this slice deliberately does not solve

1. **The Storage page's total still counts these bytes.** It comes from
   `estimateStorageUsedBytes()`, which measures the whole origin, so a user with
   the pack on disk sees 402 MB of storage they cannot account for in the rows
   above it. Fixing it means either subtracting the punctuation models there or
   listing them read-only; neither is obviously right, and A1 does not decide it.
2. **An interrupted download does not resume by itself.** On the next launch the
   setting is still on, the pack reads `missing`, and the section offers
   Download, which resumes from the files already stored. Nothing fetches without
   a click — deliberate, since "storage cleared on purpose" and "app quit
   mid-download" look identical from disk.

## Known, and left alone

- `refresh()` clears the error, so a failure message survives only while the
  section stays mounted. Reopening Settings after a failure shows `missing` with
  a Download button instead of the message. The next attempt resumes either way.
- `deleteModels()` does not cancel an in-flight download. Unreachable from the
  UI: the delete link only appears with the setting off, and turning it off
  cancels first.
- The status-line cancel is an icon-only button with a `title` and no
  `aria-label`, matching `ModelManagementSection`'s cancel exactly. If that
  precedent is ever fixed, fix both.
- The low-memory guard still reads an absent `navigator.deviceMemory` as 4 GB,
  so a browser that does not report memory cannot turn the feature on. That is
  slice 1's open question, unchanged.

## For slice 4

- `sentence_segmentation_active` (toggle on AND models ready) joins
  `sentence_segmentation_enabled` on `translation_session_start`.
- `segmentation_models_download` `{ size_mb, result, duration_ms }` fires once
  per download, from `segmentationStore.download()` — the runtime no longer has
  a download to report.
- The online providers inherit the same gate for free: they read `enabled`,
  which is now "toggle AND pack ready AND memory guard".
