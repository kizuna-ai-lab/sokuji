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

  const previewButton = (v: VoiceEntry) => {
    if (!onPreview || !canAuditionVoice(v)) return null;
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
          // Abort whatever the previous click started, then hand THIS click a
          // controller whose signal actually reaches an abort() call: parked
          // in previewAbortRef, aborted by the next click or by unmount.
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
    const dims: Array<[keyof VoiceFacetCriteria, string]> = [
      ['gender', t('voiceLibrary.filter.genderLabel', 'Gender')],
      ['age', t('voiceLibrary.filter.ageLabel', 'Age')],
      ['accent', t('voiceLibrary.filter.accentLabel', 'Accent')],
    ];
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
              value={(criteria[dim] as string | undefined) ?? ''}
              onChange={(e) => setCriteria((c) => ({ ...c, [dim]: e.target.value || null }))}
            >
              <option value="">{label}</option>
              {values.map((val) => (
                <option key={val} value={val}>{humanizeFacetValue(val)}</option>
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
        <FloatingFocusManager context={context} modal={false} returnFocus>
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
          <div role="grid" aria-label={t('voiceLibrary.voice', 'Voice')} className="voice-pop__grid">
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
            {clones.map(row)}
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
                      {t('voiceLibrary.filterCount', '{shown} of {total}')
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
            {shownPresets.map(row)}
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
