# History editing, part one: fixing misheard words, editing a sentence, undo

**Date:** 2026-11-19 · **Status:** approved design, implemented in this branch

A finished record's transcript can be corrected. Speech recognition mishears names and terms; until now a record's
title and speakers could be changed, but not its text. This first part fixes a misheard word everywhere at once, edits
one sentence, and lets every change be undone or reverted, keeping what was heard.

Out of scope here: editing the notes' own text, merging speakers, changing the speaker of several sentences at once,
fixing words during a session, and translations (they are left as they are; see Rules).

## Where words are fixed

Words are fixed in **one place**: the edit panel's **Fix words** section. Two other places only hand a word to it:

- a word **selected in the transcript** ("Fix…" above the selection);
- a **name to check** in the notes ("Go fix").

The two are joined to the fix by one narrow call, "open the fix with this heard word, this suggestion, and (for a
selection) this sentence". The notes do not know how fixes are stored, and the fix does not read the notes' structure.
Handing a word over changes nothing; the user confirms in the edit panel.

### Fix words (edit panel, under Speakers)

- **Heard as** and **Change to**, both free to type. While "Heard as" is typed, the count of sentences holding it shows
  ("N places", or "Not found"); "Show each" lists them with their times, and a click shows one in the transcript.
- **Fix in the notes too (N)** shows only when the shown notes version holds the word; ticked by default.
- **Add to the word list**, ticked by default.
- **Change all** is disabled when nothing is found, when "Change to" is empty, or when it equals "Heard as" (a word
  cannot be fixed to nothing; deleting a word goes through editing its sentence).
- **Fixed in this record** lists each fix, "heard → written · N places", newest first, with **Revert**. Reverted fixes
  are not listed.

A word handed over opens the edit panel wherever it is in the layout (its column, the shared column's Edit tab, or the
Edit tab), fills the fields and puts the cursor in "Change to". From a selection, two more choices show: **All N
places** (default) and **Only the selected one**; the latter does not add to the word list. From the notes, a caption
says so.

### A word selected in the transcript

A selection inside one sentence, of at most 40 characters and not only spaces, shows **Fix…** above it. A selection
across sentences shows nothing.

### Names to check (notes)

The list stays in the notes, as part of its version. Each name has **Go fix** and **Dismiss** ("Add to word list" is
gone: fixing adds to the word list). A name whose heard form was in what was heard and is no longer in the shown
transcript shows **Fixed** instead of buttons; this is computed when shown, nothing is stored. A name the notes spell
otherwise than the transcript never shows "Fixed".

### Editing one sentence

Hovering a sentence shows **Edit this sentence** beside **Change speaker**. The sentence becomes a field in place:
Enter saves, Shift+Enter starts a line, Escape cancels, a click elsewhere saves. When the change swaps one word for
another and the heard word shows in other sentences, the field offers **Change everywhere** (default) or **Only this
sentence**, and **Add to the word list** (only when changing everywhere). Letters added to or dropped from a word count
as a swap ("Sok" → "Sokuji"); a whole word added or dropped does not. Any other change touches that sentence only.
An emptied sentence is left as it was.

An edited sentence carries an **Edited** mark; its tooltip shows the original, and a click opens it with **Restore
original**.

### What changed, and undo

After each change a line above the player says what was done, with **Undo**, for 6 seconds: "Changed N places: A → B
(, added to the word list)", "Reverted N places: B → A (K changed since, kept)", "Sentence changed", "Original
restored", "Speaker changed", "Undone". **Ctrl+Z** (⌘Z on a Mac) undoes the last change unless the focus is in a field,
whose own undo it is. Undo covers fixes, reverts, sentence edits, restoring, renaming a speaker and moving a sentence to
another speaker; it keeps 20 steps and is cleared when another record or transcript is shown or the page is left.
Undoing a fix that added to the word list takes out what it added, and nothing added since. Undoing a revert writes the
fix again.

Nothing is offered on a record still running, or while it is being transcribed again.

## Rules

| Question | Rule |
|---|---|
| Matching | Chinese, Japanese and similar text: anywhere. A word written in a script with spaces between words (Latin, Cyrillic, Greek, Armenian) or with a digit at an edge must not touch another such letter or digit there ("Un" is not in "Under", "V3" not in "V30", "кот" not in "который"); these match in any case. Arabic, Hebrew and Korean match anywhere for now. |
| Writing | As typed. |
| Scope | The transcript version shown; with "Fix in the notes too", the notes version shown (title, overview, topics, points and owners; not the names to check). |
| A word inside its correct form | A place already written right is neither counted nor changed: fixing "Sok" to "Sokuji" leaves "Sokuji", "ソク" to "ソクジ" leaves "ソクジ", and a fix of the case only changes the places written otherwise. |
| Revert | Only what that fix wrote goes back; a sentence changed since keeps its change (and the line says how many). The notes go back field by field (title, overview, each topic and point); a field changed since is kept and counted, and the names to check are never touched. Text that was right before the fix is never touched. |
| Record title | A record titled from its notes (not named by the user) follows the notes' title through a fix and its revert. |
| Word list | The entry is "written: B, often heard as: A"; an existing entry gains the heard form. |
| Translations | Unchanged: a session's are the conversation's, a file transcript's come from the service. |
| Search, export, copy | Use the fixed text. |
| Transcribing again | The new version starts without these fixes (re-applying them is later work). |
| Notes being written | The transcript can be fixed; "Fix in the notes too" is not offered for a version being replaced. |

## Storage

The History database moves to version 2 (the file is backed up before the migration):

- each sentence keeps **heard**, what the recognizer gave, from its first change on (null while it reads as heard);
- a **corrections** table keeps each fix: the heard and written forms, and per sentence and for the notes version its
  text before and after, so a revert restores exactly what it wrote; an undone fix is deleted, a reverted one marked.

Undo steps live in memory only.
