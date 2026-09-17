import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { canAuditionVoice } from '../../../lib/voiceLibrary/voicePreviewable';
import './VoicePicker.scss';

/**
 * The two facet dimensions whose CRITERIA are arrays (`VoiceFacetCriteria`
 * mirrors Soniox's `GET /v1/shared-voices`, which takes several tags per
 * dimension and ANDs them — see `voiceFacets.ts`'s `hasEvery`), even though
 * this single-select control only ever writes one element into either. Fix
 * round 1: an earlier version of `facetRow()` read/wrote every dimension
 * through one `string | undefined` cast, which silently dropped `useCase`
 * and `style` (typed `string[]`) from the filter — this set is what keeps
 * that from recurring.
 */
const ARRAY_DIMS = new Set<keyof VoiceFacetCriteria>(['useCase', 'style']);

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
 * Why the floating wrapper is `role="dialog"` and the grid inside it is
 * `role="grid"`, not `role="grid"` on the wrapper alone: Settings' own
 * PanelBar keeps a document-level Escape listener that collapses the whole
 * settings panel, and it only stands down when it finds a `role="dialog"`
 * ancestor with no `display: none` in the way (see `isVisibleDialogOpen` in
 * PanelBar.tsx). floating-ui's `useDismiss` Escape handler stops propagation
 * but never calls `preventDefault`, so PanelBar's own listener — bound to the
 * same `document` — still runs. Without the dialog role here, opening this
 * popover and pressing Escape once would close the popover AND collapse the
 * settings panel behind it. `SubtitleBar.tsx` and `MainPanel.tsx` use the
 * same `role="dialog"`-on-the-floating-wrapper pattern for the same reason.
 * The grid role stays on the inner element: a dialog CONTAINING a grid is
 * well-formed ARIA, and Task 4's keyboard model targets the grid and its
 * `role="row"` / `role="gridcell"` children, not the dialog wrapper.
 */
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
  // The one in-flight (or last-finished) preview request's controller. A
  // single ref, not one per row: only one preview can be loading/playing at
  // a time (playingId/loadingId are singular, owned by the parent), so
  // starting a new one always supersedes whatever this held.
  const previewAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    previewAbortRef.current?.abort();
  }, []);
  // Fix round 3: closing the popover must cancel an in-flight preview too,
  // not just the next click or the whole component unmounting — a
  // synthesized sample is billed to the user, and a request abandoned
  // mid-flight must never be left to resolve and start playback into a
  // popover that is already gone, with no reachable Stop control.
  // `VoiceLibrarySection.tsx`'s `togglePreview` already listens for this
  // same signal's `abort` event (its other, previously-unreachable half —
  // see its own comment). `open` starts `false` on the very first render,
  // which is harmless: `previewAbortRef.current` is still `null` then, so
  // `?.abort()` no-ops.
  useEffect(() => {
    if (!open) previewAbortRef.current?.abort();
  }, [open]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    // `fixed` + the FloatingPortal below are load-bearing, not taste:
    // `Settings.scss` sets `overflow: hidden` on the panel (lines 10 and 15)
    // and `overflow-y: auto` on the scrolling body, so an absolutely
    // positioned popover inside that subtree is clipped by the panel and
    // scrolls away from its own trigger. `ModeDevicePopover.tsx` and
    // `ExportButton.tsx` are the existing precedent in this repo and both do
    // exactly this pair.
    strategy: 'fixed',
    middleware: [
      offset(4),
      flip(),
      shift({ padding: 8 }),
      // Clamp to the space available so a 200-row roster scrolls inside the
      // popover instead of running off-screen.
      size({
        padding: 8,
        apply({ availableHeight, availableWidth, rects, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(160, Math.min(320, availableHeight))}px`,
            minWidth: `${rects.reference.width}px`,
            // Without a maxWidth the popover's width is unbounded by the
            // window: it grows to its widest row, and `shift` cannot rescue a
            // box wider than the viewport. Measured headlessly at a 400px
            // window (the browser-extension side panel's shape, where Settings
            // does render): 583px wide in en/de, hanging 191px outside the
            // viewport, and 792px in ja. `minWidth` still wins in CSS below a
            // ~316px window, which is an acceptable floor.
            //
            // No unit test covers this and none can: jsdom has no layout, so
            // getBoundingClientRect returns zeros and this apply() never sees
            // a real availableWidth. The evidence is the Task 10 geometry
            // harness (see task-10-geometry.md), not the suite.
            maxWidth: `${availableWidth}px`,
          });
        },
      }),
    ],
  });
  // `useClick` gives the trigger Enter/Space activation and toggling for free;
  // `useDismiss` closes on outside press AND on Escape (its `escapeKey` option
  // defaults to true — do NOT hand-roll an Escape branch); `useRole` stamps
  // `role="dialog"` on the floating wrapper via `getFloatingProps()` — see the
  // module doc comment for why it is `dialog` and not `grid` here.
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);

  const presets = useMemo(() => voices.filter((v) => v.group === 'builtin'), [voices]);
  const clones = useMemo(() => voices.filter((v) => v.group === 'custom'), [voices]);
  const [activeRow, setActiveRow] = useState(0);
  const [activeCell, setActiveCell] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Type-ahead buffer: cleared after 700ms of no typing, the interval the APG
  // grid pattern uses for multi-character matching.
  const typed = useRef({ text: '', at: 0 });
  // Whether an arrow/Home/End/type-ahead key has moved focus into the grid
  // since it opened. `FloatingFocusManager`'s `initialFocus={gridRef}` lands
  // DOM focus on the grid CONTAINER, not a cell, so the first arrow press
  // must ENTER at the already-active cell (0,0) rather than move past it —
  // otherwise the very first `ArrowDown` after opening skips row 0 entirely.
  const enteredRef = useRef(false);
  // Whether `focusActive` has actually RUN (not merely been scheduled) since
  // open. This is a separate question from `enteredRef` above: `enteredRef`
  // is about LOGICAL row/cell index math and flips the instant a key is
  // processed; this is about DOM-focus timing, and must only flip once a
  // frame has genuinely fired. floating-ui's own `initialFocus={gridRef}`
  // handling is a ONE-TIME action tied to the open transition (a microtask
  // into its own `requestAnimationFrame`, wholly outside our control), not to
  // any particular key press — it is "still in flight" for as long as it
  // takes real time to resolve, regardless of how many of our OWN key presses
  // land before then. Every `go()` call while this is still `false` must
  // defer its own focus() call by an extra frame so floating-ui's pending
  // action — whenever it actually fires — is guaranteed to resolve first;
  // once this flips `true`, that race is over for good and later presses
  // only need one frame.
  const pastInitialFocusRaceRef = useRef(false);
  // requestAnimationFrame handle still pending from the MOST RECENT key
  // press's focus-scheduling in `onGridKeyDown`'s `go()` — never more than
  // one at a time (both scheduling branches assign a single handle, and the
  // outer callback in the two-frame path REPLACES this rather than adding to
  // it), hence `number | null` rather than an array. A fast second press —
  // two keydowns with no yield in between, which real browsers can deliver
  // within one frame via OS key-repeat or fast typing, and which this file's
  // own tests do deliberately (`fireEvent.keyDown` has no built-in delay) —
  // can otherwise have an EARLIER press's still-pending frame resolve after a
  // LATER press's, overwriting the correct final focus with a stale target
  // (this happens even between two presses that both still need the
  // two-frame defer above: cancel-and-reschedule, not just "fewer frames",
  // is what keeps them from racing each other). Canceling whatever is still
  // pending before scheduling a new frame makes the LAST key press always
  // win, regardless of how many frames either one was deferred by.
  const pendingFocusFramesRef = useRef<number | null>(null);
  // Every fresh open starts the grid's roving tabindex back at the first
  // cell of the first row, rather than wherever a previous session left it.
  useEffect(() => {
    if (open) {
      setActiveRow(0);
      setActiveCell(0);
      enteredRef.current = false;
      pastInitialFocusRaceRef.current = false;
      // Not just time-aged (`:377`'s 700ms window): without this, typing
      // 'v', closing, and reopening within 700ms would have the next 'i'
      // match against a stale 'v' left over from the PREVIOUS open, jumping
      // to 'vi' instead of the fresh 'i'.
      typed.current = { text: '', at: 0 };
    }
    // Closing (or unmounting) mid-flight must not let a still-pending focus
    // frame from before the close fire afterwards, against a popover that is
    // no longer open.
    return () => {
      if (pendingFocusFramesRef.current != null) cancelAnimationFrame(pendingFocusFramesRef.current);
      pendingFocusFramesRef.current = null;
    };
  }, [open]);
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

  // Flat row order as rendered: clones, then the shown presets. (The add row
  // is a `.voice-row` too, but `focusActive` excludes it separately — see its
  // comment below — so it never appears in this list.) Keyboard order must
  // match visual order, so this is derived from the same arrays the JSX maps
  // over rather than from `voices`.
  const rowOrder = useMemo(
    () => [...clones, ...shownPresets].map((v) => v.id),
    [clones, shownPresets],
  );

  const selected = voices.find((v) => v.id === selectedId);

  /** `female · calm · soft` — R2's row subtitle, built from the raw facet tags
   *  the roster already carries. Deliberately NOT humanized here: this is a
   *  scan line meant to be read at a glance across many rows, unlike the
   *  facet dropdown's individual option labels (which do humanize, since each
   *  is read on its own). Clones carry no facets, so they get the group
   *  marker instead. */
  const rowSubtitle = (v: VoiceEntry): string => {
    if (v.group === 'custom') return t('voiceLibrary.myVoices', 'My Voices');
    const f = v.meta?.facets;
    const parts = [f?.gender, ...(f?.style ?? [])].filter(Boolean) as string[];
    if (parts.length === 0 && v.meta?.language) return v.meta.language;
    return parts.slice(0, 3).join(' · ');
  };

  const commitRename = async (id: string) => {
    const name = editName.trim();
    setEditingId(null);
    if (name && onRename) await onRename(id, name);
  };

  // `[role="row"].voice-row` and not every `[role="row"]`: the grid also
  // contains HEADER rows (the "My Voices" / "Presets" group labels, each a
  // `role="row"` holding one `role="columnheader"`, with the refresh button
  // inside the Presets one). Selecting by the `.voice-row` class excludes
  // them, so arrow keys move between voices only. The add row is excluded
  // separately because it is a `.voice-row` but not a voice. Shared by
  // `focusActive` (which cell to move DOM focus to) and `onGridKeyDown`'s
  // `go()` (how many cells the TARGET row actually has, to clamp
  // `activeCell` against — see `go()`'s comment on why that clamp lives in
  // state, not only in `focusActive`'s own `.focus()` call).
  const gridCellsForRow = (rowIdx: number): NodeListOf<HTMLElement> | undefined => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    const rows = Array.from(grid.querySelectorAll('[role="row"].voice-row')).filter(
      (r) => !r.classList.contains('voice-row--add'),
    );
    return rows[rowIdx]?.querySelectorAll<HTMLElement>('[role="gridcell"]');
  };

  // The control INSIDE a gridcell — the element every column except the name
  // column actually focuses (see `focusActive`'s comment on that one
  // exception). Used only to check whether a cell's control is `disabled`;
  // not used to decide what `focusActive` itself focuses.
  const controlOf = (cell: Element | undefined): HTMLButtonElement | HTMLInputElement | null | undefined =>
    cell?.querySelector<HTMLButtonElement | HTMLInputElement>('button, input');

  // Column 0 (the name cell) is never counted as "disabled" here even when
  // its OWN button is (`v.disabled` / `isSessionActive`): its roving-tabindex
  // focus target is the `gridcell` div itself (see `focusActive`), which has
  // no `disabled` concept, and it doubles as the safety-net destination
  // `go()` falls back to below — that fallback must always be reachable, or
  // a row whose every OTHER control happens to be disabled would have
  // nowhere left to go.
  const isCellDisabled = (cells: NodeListOf<HTMLElement> | undefined, idx: number): boolean =>
    idx !== 0 && (controlOf(cells?.[idx])?.disabled ?? false);

  /** Move DOM focus to the active cell after a render that changed it. */
  const focusActive = (rowIdx: number, cellIdx: number) => {
    const gridcells = gridCellsForRow(rowIdx);
    if (!gridcells) return;
    const idx = Math.min(cellIdx, gridcells.length - 1);
    const cell = gridcells[idx];
    // Cell 0 (the name cell) is the one place the roving tabindex targets the
    // `role="gridcell"` wrapper itself rather than the `<button>` inside it.
    // That is not a styling choice: the name cell's content IS a `<button>`
    // (`onSelect` on click), and this same `onGridKeyDown`'s `Enter` case
    // ALSO calls `onSelect` for the active row. If real DOM focus sat on that
    // button, a user's Enter would fire the browser's native
    // button-activation click (invoking the button's own `onClick`) AND
    // bubble as a keydown to this handler (calling `onSelect` a second time)
    // — the same double-fire class of bug as the trigger's double-toggle
    // fixed in Task 3 (see the trigger's `onClick` comment above). Focusing
    // the DIV instead sidesteps it: a plain `<div>` has no native
    // Enter-activation, so only this handler's `Enter` case fires `onSelect`,
    // once. Every OTHER cell (▶ / rename / delete) focuses its own `<button>`
    // instead, for the opposite reason — a button must receive Enter and
    // Space NATIVELY to be operable by keyboard, and this handler's `Enter`
    // case only acts on `activeCell === 0`, so it never contends with them.
    // The tests confirm which element each column expects:
    // `getByRole('gridcell', { name }).toHaveFocus()` for the name column,
    // `getAllByRole('button', { name: /play/i })` for the preview column.
    // Both cells carry `tabIndex` (see `row()`) matching whichever element is
    // targeted here.
    const el = idx === 0 ? cell : cell?.querySelector<HTMLElement>('button, input');
    el?.focus();
  };

  // Hand-rolled rather than floating-ui's `useListNavigation`: that hook's
  // `cols` option models a UNIFORM grid, and these rows are ragged — a preset
  // row has two cells (name, ▶) while a clone row has four (name, ▶, rename,
  // delete). `ExportButton.tsx` uses `useListNavigation` because its menu is a
  // plain one-cell-per-row list; this control is not that.
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    // While an inline rename is open, the grid keyboard model is INERT: the
    // `<input>` owns every key — Enter commits the rename, ArrowLeft/
    // ArrowRight move the text caret, and letters type instead of triggering
    // type-ahead. Without this bailout, those keys leak out of the text
    // field into row/cell navigation and the type-ahead buffer. The input's
    // own `onKeyDown` deliberately does NOT call `stopPropagation` on Enter
    // (that would be the wrong layer to fix this in, and would mask any
    // other ancestor that legitimately wants to see the key), so this
    // bailout — not `stopPropagation` — is what keeps its bubbled Enter from
    // reaching the `Enter` case below.
    if (editingId != null) return;
    const last = rowOrder.length - 1;
    if (last < 0) return;
    // The first navigation key since open ENTERS the grid at whatever cell is
    // already marked active, rather than moving relative to it — see
    // `enteredRef`'s comment above. Home/End/type-ahead are unaffected: they
    // always jump to an absolute row, so there is no delta to suppress.
    // (The SEPARATE question of how many animation frames `go()` defers its
    // focus() call by is driven by `pastInitialFocusRaceRef`, not this flag —
    // see its comment above for why those two are not the same thing.)
    // Captured here, before `go()` flips `enteredRef.current`, so the flag
    // reflects "was this THE entering press", not "is a row now active".
    const entering = !enteredRef.current;
    const go = (rowIdx: number, cellIdx = 0) => {
      e.preventDefault();
      const r = Math.max(0, Math.min(last, rowIdx));
      const cells = gridCellsForRow(r);
      // Clamp the CELL the same way the row above is clamped, against the
      // TARGET row's actual cell count (a preset row has 2 cells, a clone row
      // up to 4) — NOT the row being left. `cellIdx` arrives pre-computed
      // relative to the CURRENT row (e.g. `activeCell + 1` from ArrowRight,
      // or a preserved `activeCell` from ArrowDown/Up — see the column
      // preservation comment below), so it can overshoot a narrower target
      // row. Left unclamped, `cellTabIndex()` in `row()` would match NOTHING
      // in that row (every cell computes -1): the row ends up with ZERO tab
      // stops, and the next arrow key is a dead press (decrementing from an
      // out-of-range value lands back on the cell already focused).
      // `focusActive`'s own `.focus()` call clamps too, but only for THAT
      // call — this is what keeps the clamped value in STATE, so `tabIndex`
      // agrees with where focus actually is.
      let c = Math.max(0, Math.min((cells?.length ?? 1) - 1, cellIdx));
      // A second, independent safety net: if the cell this lands on has a
      // disabled control (e.g. a ▶ mid-synthesis), it can never actually
      // receive focus (`.focus()` on a `disabled` button is a no-op), so it
      // must not be left as the row's only tab stop either. Column 0 is
      // always a valid fallback — see `isCellDisabled`'s comment on why.
      if (isCellDisabled(cells, c)) c = 0;
      setActiveRow(r);
      setActiveCell(c);
      enteredRef.current = true;
      // A press still in flight from BEFORE this one (see
      // `pendingFocusFramesRef`'s comment above) must never be allowed to
      // resolve after this one and overwrite it, so cancel it first.
      if (pendingFocusFramesRef.current != null) cancelAnimationFrame(pendingFocusFramesRef.current);
      pendingFocusFramesRef.current = null;
      // Focus after the state commit so the row that is about to be active is
      // the one we reach into. Two nested frames while
      // `pastInitialFocusRaceRef` is still `false` (see its comment above):
      // `FloatingFocusManager`'s own `initialFocus={gridRef}` handling may
      // STILL be in flight (its layout effect defers through a microtask into
      // its own requestAnimationFrame call), and if it lands in the same
      // animation-frame batch as a single rAF here, it fires AFTER us and
      // steals focus back onto the grid container. Deferring one extra frame
      // guarantees that already-queued action — if it is still pending at
      // all — resolves before ours does. Once our own focus() call has
      // actually landed once, that race is over for good and every later
      // press only pays for one frame.
      const runFocus = () => {
        pendingFocusFramesRef.current = null;
        pastInitialFocusRaceRef.current = true;
        focusActive(r, c);
      };
      if (pastInitialFocusRaceRef.current) {
        pendingFocusFramesRef.current = requestAnimationFrame(runFocus);
      } else {
        const outer = requestAnimationFrame(() => {
          pendingFocusFramesRef.current = requestAnimationFrame(runFocus);
        });
        pendingFocusFramesRef.current = outer;
      }
    };
    switch (e.key) {
      // ArrowDown/Up PRESERVE the active column instead of resetting it to 0
      // (the brief's sketch was `go(activeRow + 1)`, whose `cellIdx` defaults
      // to 0) — deliberately: the APG grid pattern moves along one axis at a
      // time, holding the other fixed, so descending from, say, the rename
      // column should land on the rename column of the row below, not jump
      // back to the name column. `go()`'s own cell clamp (see its comment
      // above) is what keeps this safe when the target row has fewer cells
      // than the one being left.
      case 'ArrowDown': return go(entering ? activeRow : activeRow + 1, activeCell);
      case 'ArrowUp': return go(entering ? activeRow : activeRow - 1, activeCell);
      case 'ArrowRight': {
        if (entering) return go(activeRow, activeCell);
        // Skip past any disabled control in the direction of travel, rather
        // than landing the tab stop somewhere it can never receive focus —
        // `go()`'s own fallback below would otherwise just snap it straight
        // back to column 0 instead of the next reachable column.
        const cells = gridCellsForRow(activeRow);
        const count = cells?.length ?? 1;
        let c = activeCell + 1;
        while (c <= count - 1 && isCellDisabled(cells, c)) c += 1;
        return go(activeRow, c);
      }
      case 'ArrowLeft': {
        if (entering) return go(activeRow, activeCell);
        const cells = gridCellsForRow(activeRow);
        let c = Math.max(0, activeCell - 1);
        while (c > 0 && isCellDisabled(cells, c)) c -= 1;
        return go(activeRow, c);
      }
      case 'Home': return go(0);
      case 'End': return go(last);
      case 'Enter': {
        const id = rowOrder[activeRow];
        // `activeCell === 0` alone is not enough: `activeRow`/`activeCell`
        // are only ever updated by `go()`, i.e. by KEYBOARD navigation, so a
        // user who reaches a control by MOUSE (clicking Rename, clicking ▶)
        // without arrow-navigating first leaves them at their post-open
        // default (0, 0) regardless of what is actually focused — a stale
        // coordinate `onGridKeyDown` cannot tell apart from a genuine "the
        // name cell is active" state. Requiring the event's REAL target to
        // be a `role="gridcell"` element closes that gap without consulting
        // `document.activeElement`: column 0's focus target is deliberately
        // the gridcell div itself (see `focusActive`'s comment on why), so
        // this rejects a bubbled Enter from the rename `<input>` and from an
        // action `<button>` (▶ / rename / delete) alike — neither carries
        // `role="gridcell"` — while still accepting a genuine Enter on the
        // name cell reached via arrow keys.
        const target = e.target;
        const onGridcell = target instanceof HTMLElement && target.getAttribute('role') === 'gridcell';
        if (id && activeCell === 0 && !isSessionActive && onGridcell) {
          e.preventDefault();
          onSelect(id);
          setOpen(false);
        }
        return;
      }
      // Deliberately NO `Escape` branch. `useDismiss` closes on Escape by
      // default and the `FloatingFocusManager` from Task 3 returns focus to
      // the trigger; handling it here too would fight both.
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

  const previewButton = (v: VoiceEntry, rowIdx: number, cellIdx: number) => {
    if (!onPreview || !canAuditionVoice(v)) return null;
    const tabIndex = rowIdx === activeRow && cellIdx === activeCell ? 0 : -1;
    if (previewUnavailableReason) {
      return (
        <div role="gridcell">
          <button type="button" className="voice-row__btn" disabled
            tabIndex={tabIndex}
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
          tabIndex={tabIndex}
          aria-label={label}
          title={label}
          // Abort whatever the previous click started, then hand THIS click a
          // controller whose signal actually reaches an abort() call: parked
          // in previewAbortRef, aborted by the next click, by unmount, or by
          // the popover closing (the effect right after previewAbortRef's
          // declaration above).
          // (A controller built and dropped in the same expression, as an
          // earlier version of this did, hands the parent a signal that can
          // never fire — a fake cancellation channel.)
          onClick={() => {
            previewAbortRef.current?.abort();
            const controller = new AbortController();
            previewAbortRef.current = controller;
            void onPreview(v.id, controller.signal).catch(() => {
              // Not this component's failure to report: Tasks 7/8 own
              // surfacing voiceLibrary.previewFailed. Caught only so a
              // rejection here is neither an unhandled rejection nor a
              // crash — there is no local failure state to swallow it into.
            });
          }}
        >
          {loading ? <span className="voice-row__spinner" aria-hidden="true" />
            : playing ? <Square size={13} /> : <Play size={13} />}
        </button>
      </div>
    );
  };

  const row = (v: VoiceEntry, rowIdx: number) => {
    const isSelected = v.id === selectedId;
    // A single running counter, not a fixed cell-index-per-control: a preset
    // row has two cells (name, ▶) while a clone row has four (name, ▶,
    // rename, delete), so which counter value the rename/delete buttons land
    // on depends on whether ▶ was rendered at all for this voice.
    let cell = 0;
    const cellTabIndex = () => (rowIdx === activeRow && cell === activeCell ? 0 : -1);
    if (editingId === v.id) {
      return (
        <div role="row" className="voice-row" key={v.id}>
          <div role="gridcell">
            <input
              autoFocus
              tabIndex={cellTabIndex()}
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
    const nameTabIndex = cellTabIndex(); cell += 1;
    const preview = previewButton(v, rowIdx, cell);
    if (preview) cell += 1;
    const showRename = v.removable && !!onRename;
    const renameTabIndex = showRename ? cellTabIndex() : -1;
    if (showRename) cell += 1;
    const deleteTabIndex = v.removable ? cellTabIndex() : -1;
    return (
      <div role="row" className={`voice-row${isSelected ? ' is-selected' : ''}`} key={v.id}>
        {/* A div wrapping a real <button>, like every other cell in this row
            — NOT role="gridcell" on the button itself. Two reasons: Task 4's
            planned cell selector (`[role="gridcell"] button, [role="gridcell"]
            input`) is a descendant combinator and would never match a button
            that IS its own gridcell, silently skipping the row's primary
            control; and overriding a <button>'s implicit role to "gridcell"
            suppresses its "button" announcement to assistive tech, while the
            row's other three controls keep announcing as buttons — an
            inconsistency within one row. Disabled-state checks (e.g.
            `toBeDisabled()`) target the button directly, which is a real form
            control regardless of which element carries the gridcell role. */}
        {/* `tabIndex` lives on THIS div, not the button inside: the name cell
            is the one place the roving tabindex targets the `gridcell`
            wrapper itself (see `focusActive`), matching how the picker's
            tests query it — `getByRole('gridcell', { name }).toHaveFocus()`,
            not the button. The button keeps a fixed `tabIndex={-1}` so it is
            never independently reachable by Tab; it stays a normal click
            target regardless. */}
        <div role="gridcell" aria-selected={isSelected} tabIndex={nameTabIndex}>
          <button
            type="button"
            className="voice-row__pick"
            disabled={isSessionActive || v.disabled}
            tabIndex={-1}
            aria-label={v.label}
            onClick={() => { onSelect(v.id); setOpen(false); }}
          >
            <span className="voice-row__name">
              {v.label}
              {/* Fix round 1 addendum: Task 6's stylesheet note said this tag
                  "moved to the picker", but nothing ever rendered it here —
                  the class moved, the warning did not. */}
              {v.meta?.unstable && (
                <span className="voice-unstable-tag">{t('voiceLibrary.unstable', 'unstable')}</span>
              )}
            </span>
            <span className="voice-row__sub">{rowSubtitle(v)}</span>
          </button>
        </div>
        {preview}
        {showRename && (
          <div role="gridcell">
            <button type="button" className="voice-row__btn"
              tabIndex={renameTabIndex}
              aria-label={t('voiceLibrary.rename', 'Rename')} title={t('voiceLibrary.rename', 'Rename')}
              onClick={() => { setEditingId(v.id); setEditName(v.label); }}>
              <Pencil size={13} />
            </button>
          </div>
        )}
        {v.removable && (
          <div role="gridcell">
            <button type="button" className="voice-row__btn voice-row__btn--danger"
              tabIndex={deleteTabIndex}
              aria-label={t('voiceLibrary.delete', 'Delete')} title={t('voiceLibrary.delete', 'Delete')}
              onClick={() => onAskDelete(v.id, v.label)}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    );
  };

  /** Single-select value for a dimension, regardless of whether its criteria
   *  slot is a scalar or a one-element array. */
  const facetValue = (dim: keyof VoiceFacetCriteria): string =>
    ARRAY_DIMS.has(dim)
      ? (criteria[dim] as string[] | undefined)?.[0] ?? ''
      : (criteria[dim] as string | null | undefined) ?? '';

  /** Writes a single chosen value back into whichever shape the dimension's
   *  criteria slot actually is. A single-element array is exactly what
   *  `matchesVoiceFacets`'s `hasEvery` expects for `useCase`/`style`: ALL
   *  listed tags must be present, and there is one. */
  const setFacetValue = (dim: keyof VoiceFacetCriteria, val: string) =>
    setCriteria((c) => ({
      ...c,
      [dim]: ARRAY_DIMS.has(dim) ? (val ? [val] : undefined) : (val || null),
    }));

  const facetRow = () => {
    if (!facetsOn) return null;
    const dims: Array<[keyof VoiceFacetCriteria, string, string]> = [
      ['gender', t('voiceLibrary.filter.genderLabel', 'Gender'), t('voiceLibrary.filter.anyGender', 'Any gender')],
      ['age', t('voiceLibrary.filter.ageLabel', 'Age'), t('voiceLibrary.filter.anyAge', 'Any age')],
      ['accent', t('voiceLibrary.filter.accentLabel', 'Accent'), t('voiceLibrary.filter.anyAccent', 'Any accent')],
      ['useCase', t('voiceLibrary.filter.useCaseLabel', 'Use case'), t('voiceLibrary.filter.anyUseCase', 'Any use case')],
      ['style', t('voiceLibrary.filter.styleLabel', 'Style'), t('voiceLibrary.filter.anyStyle', 'Any style')],
    ];
    return (
      <div className="voice-pop__facets">
        {dims.map(([dim, label, anyLabel]) => {
          const values = (vocabulary as Record<string, string[] | undefined>)[dim] ?? [];
          if (values.length === 0) return null;
          return (
            <select
              key={dim}
              className="select-dropdown voice-pop__facet"
              aria-label={label}
              value={facetValue(dim)}
              onChange={(e) => setFacetValue(dim, e.target.value)}
            >
              {/* The neutral option reads "Any gender", not "Gender" — the
                  dimension's own `any*` key, not its field label. */}
              <option value="">{anyLabel}</option>
              {values.map((val) => (
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
        ref={refs.setReference}
        className="voice-picker__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={isSessionActive && !onPreview}
        // `useClick(context)` already toggles `open` on click via
        // `onOpenChange` — an extra onClick handler here would run in the
        // SAME event after useClick's, reading the just-applied `true` and
        // flipping it straight back to `false` (a self-cancelling double
        // toggle). `getReferenceProps()` alone is the ExportButton.tsx /
        // ModeDevicePopover.tsx precedent.
        {...getReferenceProps()}
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
            `ModeDevicePopover.tsx` and `ExportButton.tsx` — the precedent this
            plan's Global Constraints name — portal for the same reason.
            `FloatingFocusManager` owns focus: it moves focus in on open and
            `returnFocus` puts it back on the trigger when `useDismiss` closes
            on Escape or outside press. Task 4 adds `initialFocus={gridRef}`
            here and must NOT hand-roll an Escape branch. */}
        <FloatingFocusManager context={context} modal={false} returnFocus initialFocus={gridRef}>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="voice-pop"
          {...getFloatingProps()}
        >
          {facetRow()}
          {/* ARIA's `grid` role only allows `row` (or `rowgroup`) direct
              children — no bare headers, no stray messages. Each group label
              is its own row with a single `columnheader` cell (the label
              plus, on the Presets row, the count and the refresh button all
              live inside that one cell — Task 4's grid selects rows by
              `[role="row"].voice-row`, so these header rows, which never
              carry that class, are excluded from its keyboard model without
              any extra filtering). The "no imported voices" hint isn't a row
              at all — it renders as a sibling below the grid instead. */}
          <div
            ref={gridRef}
            role="grid"
            aria-label={t('voiceLibrary.voice', 'Voice')}
            className="voice-pop__grid"
            tabIndex={-1}
            onKeyDown={onGridKeyDown}
          >
            <div role="row" className="voice-pop__group">
              <div role="columnheader">{t('voiceLibrary.myVoices', 'My Voices')}</div>
            </div>
            {onAddVoice && (
              <div role="row" className="voice-row voice-row--add">
                <div role="gridcell">
                  <button type="button" className="voice-row__add" onClick={onAddVoice}>
                    <Plus size={13} /> {t('voiceLibrary.addVoice', 'Add a voice…')}
                  </button>
                </div>
              </div>
            )}
            {clones.map((v, i) => row(v, i))}
            <div role="row" className="voice-pop__group">
              <div role="columnheader">
                {t('voiceLibrary.presets', 'Presets')}
                {facetsOn && presets.length > 0 && (
                  <span className="voice-pop__count">
                    {' · '}
                    {/* A nested element, not a sibling text node: the group
                        label above shares this span with the ` · ` separator,
                        and a query for the count text alone (e.g. "1 of 2")
                        must find an element whose OWN text is exactly that —
                        not that text glued to the separator in front of it. */}
                    <span className="voice-pop__count-value">
                      {/* Fix round 1 addendum: the shipped section rendered
                          `filter.empty` in place of the count when an active
                          filter matched nothing — this is the count's
                          replacement, not the DIFFERENT "no imported voices
                          yet" case below, which is about the My Voices group
                          having no clones at all. */}
                      {hasActiveFacets(criteria) && matched.length === 0
                        ? t('voiceLibrary.filter.empty', 'No voices match these filters.')
                        : t('voiceLibrary.filterCount', '{shown} of {total}')
                            .replace('{shown}', String(matched.length))
                            .replace('{total}', String(presets.length))}
                    </span>
                  </span>
                )}
                {onRefresh && (
                  <button type="button" className="voice-pop__refresh" onClick={onRefresh}
                    aria-label={t('voiceLibrary.refreshList', 'Refresh voice list')} disabled={refreshing}>
                    <RefreshCw size={12} />
                  </button>
                )}
              </div>
            </div>
            {shownPresets.map((v, i) => row(v, clones.length + i))}
          </div>
          {clones.length === 0 && !onAddVoice && (
            <div className="voice-pop__empty">{t('voiceLibrary.emptyHint', 'No imported voices yet.')}</div>
          )}
        </div>
        </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
};

export default VoicePicker;
