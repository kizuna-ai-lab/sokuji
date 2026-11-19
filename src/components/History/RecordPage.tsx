// src/components/History/RecordPage.tsx
//
// One record: its title (renamed in place), when and how long, its languages and the space it takes; its transcript,
// one block per round and speaker with the translation under it; its speakers, named in place; and its export. A record
// still being written shows how it was when opened, with Refresh. The notes and the player get their places later: the
// side column below the speakers, and a strip along the bottom.
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { AudioLines, ChevronLeft, Ellipsis, MicOff, PanelLeft, PanelRight, Pencil, Play, RefreshCw, Trash2, UserRoundPen } from 'lucide-react';
import { languageDirection } from './languageDirection';
import type { NotesLanguage } from '../../lib/notes/runner';
import { NOTES_MIN_MS } from '../../lib/notes/write';
import type { HitTarget, OpenRecord } from '../../lib/history/historyPageStore';
import { recordRows, type RecordRow, type SpeakerLabels } from '../../lib/history/recordView';
import type { HistorySentenceSide } from '../../lib/history/types';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { useHistoryPageContext } from './historyContext';
import { formatBytes, formatDateTime, formatLength, isComposing } from './format';
import RecordExportMenu from './RecordExportMenu';
import RecordPlayer, { type SeekFn } from './RecordPlayer';
import RecordNotes from './RecordNotes';
import { TranscribePanel, TranscriptAsked, TranscriptChooser } from './FileJobs';
import { notesLanguagesOf } from './notesLanguages';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useNotesExplained, useSetNotesExplained } from '../../stores/settingsStore';
import { audible, playable, rowAt, startFor } from '../../lib/history/playback';
import { notesServiceOf } from '../../lib/notes/notesService';
import { RecordSidePanel } from './RecordSidePanel';
import { InlineEdit } from './InlineEdit';
import PanelResizer from '../MainLayout/PanelResizer';
import { labelsFit } from './panelSwitchFit';
import { DIVIDER_PX, NOTES_MIN_PX, notesWidthWithin, readNotesOpen, readNotesWidth, writeNotesOpen, writeNotesWidth } from './notesColumn';
import { SIDE_MIN_PX, readSideWidth, sideWidthWithin, writeSideWidth } from './sideColumn';
import { layoutFor } from './recordLayout';
import { LanguagePairText } from '../LanguagePairText/LanguagePairText';
import './History.scss';

/** A search hit stays marked this long. */
const HIT_MARK_MS = 2000;
/** A line about a copy stays this long. */
const RESULT_MS = 3000;
/** A speaker the user adds: `u1`, `u2`, … within its side. */
const USER_SPEAKER = /^u(\d+)$/;

/** Chinese and Japanese characters and their punctuation: written without spaces between sentences. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;
const spaceBetween = (before: string, after: string) => {
  const a = [...before].pop();
  const b = [...after][0];
  return !(a && b && UNSPACED.test(a) && UNSPACED.test(b));
};

/** A value inside a quoted attribute selector. */
const quoted = (value: string) => value.replace(/["\\]/g, '\\$&');

const speakerKey = (side: HistorySentenceSide, speaker: string) => `${side}\u0000${speaker}`;

/** Where a hit lands: a sentence by its number, or the row of the round a translation belongs to. */
function hitSelector(at: HitTarget, open: OpenRecord, rows: readonly RecordRow[]): string | null {
  if (at.kind === 'sentence') return at.transcriptId === open.transcriptId ? `[data-n="${at.n}"]` : null;
  if (at.kind !== 'translation') return null;
  for (const e of createProjector().project(open.legs, DEFAULT_PROJECTION)) {
    if (e.kind !== 'exchange' || !e.translation.some((r) => r.segmentId === at.segmentId)) continue;
    const row = rows.find((r) => e.source.some((s) => s.segmentId === r.segmentId));
    if (row) return `[data-segment="${quoted(row.segmentId)}"]`;
  }
  // A transcript cut from the translation numbers the translation's own segments.
  const own = rows.find((r) => r.segmentId === at.segmentId);
  return own ? `[data-segment="${quoted(own.segmentId)}"]` : null;
}

/** The side panel's last state, kept on this computer: open unless it was closed. */
const SIDE_PANEL_KEY = 'history.sidePanelClosed';
const readSideOpen = (): boolean => { try { return localStorage.getItem(SIDE_PANEL_KEY) !== '1'; } catch { return true; } };
const writeSideOpen = (open: boolean): void => {
  try {
    if (open) localStorage.removeItem(SIDE_PANEL_KEY); else localStorage.setItem(SIDE_PANEL_KEY, '1');
  } catch { /* open again next time */ }
};

export const RecordPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const busy = useStore(store, (s) => s.busy);
  const actions = store.getState();
  const language = i18n.language;

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // The side panel at the right of the transcript: the speakers now, more later (owner, 2026-11-17). Open the first time,
  // so what it holds is seen at once; the last choice holds for the records after.
  const [sideOpen, setSideOpen] = useState(readSideOpen);
  // One save of a name at a time: the click that closes the drawer also takes the focus from the name being typed. A
  // second ask while it runs waits for it, and is told how it went (review): running is not saved.
  const nameSave = useRef<Promise<boolean> | null>(null);
  const [nameDraft, setNameDraft] = useState<{ side: HistorySentenceSide; speaker: string; value: string } | null>(null);
  // The name being typed as it is now: a save that finishes later, or a close waiting on one, reads it here.
  const nameDraftRef = useRef(nameDraft);
  nameDraftRef.current = nameDraft;
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [hit, setHit] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const filesOffered = useStore(store, (s) => s.filesOffered);
  const job = useStore(store, (s) => s.job);
  /** The recording is being deleted: the player is taken down first so the files are not held open. */
  const [releasing, setReleasing] = useState(false);
  const cancelDropRef = useRef<HTMLButtonElement>(null);
  /** The player's position, once it has been played or sought. */
  const [position, setPosition] = useState<number | null>(null);
  const seekRef = useRef<SeekFn | null>(null);
  const followed = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const markedAt = useRef<HitTarget | null>(null);

  const labels: SpeakerLabels = useMemo(() => {
    const mine = t('history.me', 'Me');
    const other = t('history.other', 'Other');
    return {
      mine, other, person: (side, n) => t('history.speakerN', '{{side}} {{n}}', { side: side === 'mine' ? mine : other, n }),
      // An imported file's speakers: no side is known, so they are named as the main panel names a person.
      anyone: (n) => t('mainPanel.displayMode.person', 'Speaker {{n}}', { n }),
    };
  }, [t]);
  const textKind = open?.record.transcripts[open.record.transcripts.length - 1]?.textKind ?? 'original';
  const rows = useMemo(
    () => (open
      // An imported file's sides do not say who spoke (everyone is on one track): its speakers are numbered.
      ? recordRows({ sentences: open.sentences, legs: open.legs, textKind, labels, sidesKnown: open.record.mode !== 'import' })
      : []),
    [open, textKind, labels],
  );

  // Opened at a search hit: scrolled into view and marked for a moment, once per opening.
  useEffect(() => {
    const at = open?.at ?? null;
    if (!open || !at || markedAt.current === at) return undefined;
    markedAt.current = at;
    const selector = hitSelector(at, open, rows);
    const el = selector ? transcriptRef.current?.querySelector<HTMLElement>(selector) : null;
    if (!el) return undefined;
    el.scrollIntoView?.({ block: 'center' });
    setHit(selector);
    return undefined;
  }, [open, rows]);

  useEffect(() => {
    if (!hit) return undefined;
    const timer = window.setTimeout(() => setHit(null), HIT_MARK_MS);
    return () => window.clearTimeout(timer);
  }, [hit]);

  useEffect(() => { if (confirmDrop) cancelDropRef.current?.focus(); }, [confirmDrop]);

  // "More" closes on a press anywhere outside it.
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('.record-page__more')) setMoreOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [moreOpen]);

  // A sentence's menu closes on a press anywhere outside it.
  useEffect(() => {
    if (menuFor === null) return undefined;
    const onDown = (e: PointerEvent) => {
      const inside = (e.target as Element | null)?.closest?.('.record-sentence__more');
      if (!inside || inside.getAttribute('data-for') !== String(menuFor)) setMenuFor(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuFor]);

  useEffect(() => {
    if (!result) return undefined;
    const timer = window.setTimeout(() => setResult(null), RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [result]);

  const playingRow = position === null ? null : rowAt(rows, position);
  const playingKey = playingRow ? `${playingRow.segmentId}:${playingRow.sentences[0]?.n}` : null;
  // The row being played is kept in view as it changes; seeking moves the transcript.
  useEffect(() => {
    if (!playingKey || followed.current === playingKey) return;
    followed.current = playingKey;
    transcriptRef.current?.querySelector<HTMLElement>(`[data-row="${quoted(playingKey)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [playingKey]);

  // The notes, the transcript and the edit panel: columns as the page has room for them, else tabs (recordLayout.ts).
  const notesRunning = useStore(store, (s) => s.notesRunning);
  const pageRef = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const layout = layoutFor(pageWidth);
  const columned = layout !== 'tabs';
  // Wide: the notes column's width, dragged at the divider, and whether it is shown, from a switch in the toolbar; both
  // kept for the next record (owner, 2026-11-17; B-31, B-40). Hidden, the transcript takes the whole width.
  const [notesOpen, setNotesOpen] = useState(readNotesOpen);
  const [notesWidth, setNotesWidth] = useState(readNotesWidth);
  // The side panel's column at the right of the transcript, its width dragged too and kept (owner, 2026-11-18).
  const [sideWidth, setSideWidth] = useState(readSideWidth);
  const notesId = useId();
  const sideId = useId();
  // The switches' words, kept while the heading has its room beside the actions (panelSwitchFit.ts).
  const headRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  // The actions' width with the words, measured while they show; once hidden, what the words add to the actions
  // (taken at the first measure without them), so actions that change while the words are hidden are judged right.
  const wordsWidth = useRef(0);
  const wordsAdd = useRef<number | null>(null);
  const [switchWords, setSwitchWords] = useState(true);
  // Tabs: one of the three at a time (owner, 2026-11-18).
  const [pane, setPane] = useState<'notes' | 'transcript' | 'edit'>('transcript');
  // Two columns with both panels switched on: which of the two the left column they share shows (owner, 2026-11-19).
  const [shared, setShared] = useState<'notes' | 'edit'>('notes');
  // A search hit opens on its own tab: the notes for a hit in the notes, else the transcript.
  const hitKind = open?.at?.kind;
  useEffect(() => {
    if (!hitKind) return;
    setPane(hitKind === 'notes' ? 'notes' : 'transcript');
    // A hit in the notes shows them in columns too; the closed choice stays saved for ordinary openings.
    if (hitKind === 'notes') { setNotesOpen(true); setShared('notes'); }
  }, [open?.record.id, hitKind]);
  const [jumpTo, setJumpTo] = useState<{ n: number } | null>(null);
  useEffect(() => {
    const el = pageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(() => setPageWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, [open !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  // Measured again whenever the head or the actions change size (a window resized, a font come in, a button added).
  const wordsShown = useRef(switchWords);
  wordsShown.current = switchWords;
  useLayoutEffect(() => {
    const head = headRef.current;
    const actions = actionsRef.current;
    if (!head || !actions) return undefined;
    const measure = () => {
      const style = getComputedStyle(head);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const gap = parseFloat(style.columnGap) || 0;
      const parts = [...head.children] as HTMLElement[];
      const others = parts.filter((p) => p !== actions && !p.classList.contains('record-page__heading'))
        .reduce((sum, p) => sum + p.getBoundingClientRect().width, 0);
      const width = actions.getBoundingClientRect().width;
      let withWords: number;
      if (wordsShown.current) {
        wordsWidth.current = width;
        wordsAdd.current = null;
        withWords = width;
      } else {
        wordsAdd.current ??= Math.max(0, wordsWidth.current - width);
        withWords = width + wordsAdd.current;
      }
      const fit = labelsFit({ head: head.clientWidth, padding, gaps: gap * Math.max(0, parts.length - 1), others, actions: withWords });
      if (fit !== wordsShown.current) setSwitchWords(fit);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(head);
    watch.observe(actions);
    return () => watch.disconnect();
  }, [switchWords, open !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new language measures its words again.
  useEffect(() => { setSwitchWords(true); }, [language]);
  // A point or topic of the notes: the transcript shows its sentence, marked, and plays from it when there is sound.
  useEffect(() => {
    if (!jumpTo || !open) return;
    setJumpTo(null);
    const selector = `[data-n="${jumpTo.n}"]`;
    transcriptRef.current?.querySelector<HTMLElement>(selector)?.scrollIntoView?.({ block: 'center' });
    setHit(selector);
    const sentence = open.sentences.find((s) => s.n === jumpTo.n);
    if (sentence && playable(open.record.tracks).length > 0) seekRef.current?.(startFor(sentence), true);
  }, [jumpTo, open]);
  // The record's own two languages, mine first (notesLanguages.ts).
  const notesLanguages = useMemo((): NotesLanguage[] => (open ? notesLanguagesOf(open.record, language) : []), [open, language]);
  const notesService = useLineUpStore((s) => notesServiceOf(s.lineUp));
  const notesExplained = useNotesExplained();
  const setNotesExplained = useSetNotesExplained();

  if (!open) return null;
  const { record } = open;
  const span = open.sentences.length > 0
    ? Math.max(...open.sentences.map((s) => s.endMs)) - Math.min(...open.sentences.map((s) => s.startMs)) : 0;
  const notesView = (
    <RecordNotes
      record={record} notes={open.notes} writing={notesRunning.includes(record.id)} tooShort={span < NOTES_MIN_MS} languages={notesLanguages}
      onWrite={(l) => actions.generateNotes(l)} onCancel={() => actions.cancelNotes()} onShowVersion={(id) => void actions.showNotes(id)}
      onJump={(n) => { setPane('transcript'); setJumpTo({ n }); }} onDismissName={(i) => void actions.dismissName(i)} onAddName={(i, spelling) => actions.addName(i, spelling)}
      latest={open.latest ?? null} explainWith={!notesExplained && notesService ? notesService : null}
      onExplained={() => void setNotesExplained(true)}
    />
  );
  const hasPlayer = playable(record.tracks).length > 0 && !releasing;
  const title = record.title ?? formatDateTime(record.startedAt, language);
  const live = record.state === 'open';
  // Its recording is being transcribed: it is not deleted, nor the record moved to the bin, until that ends.
  const inTranscription = job?.kind === 'transcribe' && job.recordId === record.id;
  const whileTranscribed = inTranscription ? t('history.file.blockedTranscribing', 'Available when this record is not being transcribed.') : undefined;

  // A title or a name stays in its field until it is saved: a save that fails keeps what was typed (the page says why).
  const saveTitle = async (): Promise<boolean> => {
    const submitted = titleDraft;
    if (submitted === null) return true;
    await actions.rename(record.id, submitted);
    if (store.getState().error) return false;
    // What was typed while the save ran is kept: the field closes only on the title it saved.
    setTitleDraft((d) => (d === submitted ? null : d));
    return true;
  };

  // Speakers: the labels the transcript uses, by side, then by label.
  const labelOf = new Map<string, string>();
  for (const r of rows) if (!labelOf.has(speakerKey(r.side, r.speaker))) labelOf.set(speakerKey(r.side, r.speaker), r.speakerLabel);
  // A side no row knows (an imported file) is listed without its side's heading.
  const sideKnown = (side: HistorySentenceSide) => rows.some((r) => r.side === side && r.sideKnown);
  const speakersOf = (side: HistorySentenceSide) => open.speakers
    .filter((s) => s.side === side && labelOf.has(speakerKey(s.side, s.speaker)))
    .map((s) => ({ ...s, label: labelOf.get(speakerKey(s.side, s.speaker))! }));
  const saveName = (): Promise<boolean> => {
    if (nameSave.current) return nameSave.current;
    const draft = nameDraftRef.current;
    if (!draft) return Promise.resolve(true);
    const run = (async () => {
      await actions.renameSpeaker(draft.side, draft.speaker, draft.value);
      if (store.getState().error) return false;
      // Saved: no longer the name being typed (unless more was typed meanwhile, which stays to be saved).
      if (nameDraftRef.current === draft) nameDraftRef.current = null;
      setNameDraft((d) => (d === draft ? null : d));
      return true;
    })().finally(() => { nameSave.current = null; });
    nameSave.current = run;
    return run;
  };
  const newSpeaker = (side: HistorySentenceSide) => {
    const used = open.speakers.filter((s) => s.side === side).map((s) => Number(USER_SPEAKER.exec(s.speaker)?.[1] ?? 0));
    return `u${Math.max(0, ...used) + 1}`;
  };
  const moveSentence = (n: number, speaker: string) => {
    setMenuFor(null);
    void actions.reassign(n, speaker);
  };

  const speakerCount = speakersOf('mine').length + speakersOf('other').length;
  // The edit panel (the speakers now, fixing the transcript later; owner, 2026-11-18): in columns, at the right of the
  // transcript, shown and hidden from the toolbar; as tabs, the third tab. Only with speakers to edit.
  const editable = speakerCount > 0;
  // A speaker's name being typed keeps the edit panel in view whatever layout the window changes to: leaving the panel
  // is what saves the name, and a window resized is not leaving it (review).
  const typingName = editable && nameDraft !== null;
  const shownPane = typingName ? 'edit' : pane === 'edit' && !editable ? 'transcript' : pane;
  const editOn = editable && (sideOpen || typingName);
  // Room for two columns and both panels switched on: they share the left column, a tab each (owner, 2026-11-19).
  const sharing = layout === 'two' && notesOpen && editOn;
  const sharedPane = typingName ? 'edit' : shared;
  const notesColumn = columned && notesOpen;
  const sideColumn = columned && editOn && !sharing;
  const notesShown = columned ? notesOpen && (!sharing || sharedPane === 'notes') : shownPane === 'notes';
  const sideShown = columned ? editOn && (!sharing || sharedPane === 'edit') : editable && shownPane === 'edit';
  // The columns as they fit this page; the widths kept stay as the user left them, for a wider window later. The edit
  // panel is fitted first, beside notes at their narrowest, and the notes in what it leaves.
  const sideRoom = Math.max(0, pageWidth - (notesColumn ? NOTES_MIN_PX + DIVIDER_PX : 0));
  const shownSideWidth = pageWidth > 0 ? sideWidthWithin(sideWidth, sideRoom) : Math.max(SIDE_MIN_PX, sideWidth);
  const notesRoom = sideColumn ? pageWidth - shownSideWidth - DIVIDER_PX : pageWidth;
  const shownNotesWidth = notesWidthWithin(notesWidth, notesRoom);
  const tracks = [
    ...(notesColumn ? [`${shownNotesWidth}px`, `${DIVIDER_PX}px`] : []),
    'minmax(0, 1fr)',
    ...(sideColumn ? [`${DIVIDER_PX}px`, `${shownSideWidth}px`] : []),
  ];
  // Leaving the edit panel with a name being typed saves it first, a newer one typed while an earlier save ran as well
  // (review); a name that fails to save, or is still unsaved, keeps the panel open with it.
  const nameSettled = async (): Promise<boolean> => {
    for (let i = 0; i < 3 && (nameDraftRef.current || nameSave.current); i += 1) {
      if (!(await saveName())) return false;
    }
    return !nameDraftRef.current;
  };
  // Nothing being typed or saved: at once, with nothing to wait for.
  const nameBusy = () => Boolean(nameDraftRef.current || nameSave.current);
  // A panel switched on is the one shown where the two share a column. The switch follows the panel as shown.
  const toggleSide = async () => {
    if (editOn) {
      if (nameBusy() && !(await nameSettled())) return;
      writeSideOpen(false);
      setSideOpen(false);
      return;
    }
    writeSideOpen(true);
    setSideOpen(true);
    setShared('edit');
  };
  const toggleNotes = async () => {
    // The notes switched on over the edit panel in the column they then share: a name typed there is saved first.
    if (!notesOpen && layout === 'two' && editOn && nameBusy() && !(await nameSettled())) return;
    writeNotesOpen(!notesOpen);
    setNotesOpen(!notesOpen);
    if (!notesOpen) setShared('notes');
  };
  // Tabs: Escape on the Edit tab, or another tab chosen, leaves it as hiding it does in columns. The tab chosen is the
  // one a shared column shows too, should the page widen.
  const choosePane = async (next: 'notes' | 'transcript' | 'edit') => {
    if (shownPane === 'edit' && next !== 'edit' && nameBusy() && !(await nameSettled())) return;
    setPane(next);
    if (next !== 'transcript') setShared(next);
  };
  const chooseShared = async (next: 'notes' | 'edit') => {
    if (sharedPane === 'edit' && next !== 'edit' && nameBusy() && !(await nameSettled())) return;
    setShared(next);
  };
  // The two panels' switches, together in the toolbar before Export: the icon says which side, the pressed state that
  // the panel is shown, the tooltip what a click does (design review, 2026-11-17; B-40).
  const panelSwitches = columned && (
    <span className="record-page__panels" data-compact={switchWords ? undefined : ''}>
      <button type="button" className="history-button record-page__panel-switch" aria-label={t('history.notes', 'Notes')}
        title={notesOpen ? t('history.hideNotes', 'Hide the notes') : t('history.showNotes', 'Show the notes')}
        aria-pressed={notesOpen} aria-controls={notesId} onClick={() => void toggleNotes()}>
        <PanelLeft size={16} aria-hidden="true" />
        <span className="record-page__panel-word">{t('history.notes', 'Notes')}</span>
      </button>
      {editable && (
        <button type="button" className="history-button record-page__panel-switch" aria-label={t('history.sidePanel', 'Edit')}
          title={editOn ? t('history.closeSidePanel', 'Hide the edit panel') : t('history.openSidePanel', 'Show the edit panel')}
          aria-pressed={editOn} aria-controls={sideId} onClick={() => void toggleSide()}>
          <PanelRight size={16} aria-hidden="true" />
          <span className="record-page__panel-word">{t('history.sidePanel', 'Edit')}</span>
        </button>
      )}
    </span>
  );
  const speakersPanel = (
    <div className="record-page__speakers">
      {(['mine', 'other'] as const).map((side) => {
        const list = speakersOf(side);
        if (list.length === 0) return null;
        return (
          <div key={side} className={`record-speakers record-speakers--${side}`}>
            {sideKnown(side) && <h4>{side === 'mine' ? t('history.sideMine', 'Your side') : t('history.sideOther', 'The other side')}</h4>}
            <ul>
              {list.map((s) => {
                const editing = nameDraft && nameDraft.side === side && nameDraft.speaker === s.speaker;
                return (
                  <li key={s.speaker}>
                    {editing ? (
                      <InlineEdit
                        fieldClassName="record-speakers__field"
                        ariaLabel={t('history.nameField', 'Name')}
                        value={nameDraft.value}
                        placeholder={s.label}
                        onChange={(value) => setNameDraft({ ...nameDraft, value })}
                        onSave={saveName}
                        onCancel={() => setNameDraft(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="record-speakers__name"
                        // One name at a time: while one saves, another is not started (its text is kept if the save fails).
                        disabled={busy}
                        aria-label={t('history.renameSpeaker', 'Rename {{name}}', { name: s.label })}
                        onClick={() => setNameDraft({ side, speaker: s.speaker, value: s.name ?? '' })}
                      >
                        <span>{s.label}</span>
                        <Pencil size={12} />
                      </button>
                    )}
                    <span className="record-speakers__count">{t('history.sentenceCount', '{{count}} sentences', { count: s.sentences })}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );

  const sentenceMenu = (row: RecordRow, n: number) => (
    <span
      className="record-sentence__more"
      data-for={n}
      // Open, the menu takes Escape itself: the side panel leaves it alone (review).
      data-escape-own={menuFor === n ? '' : undefined}
      // Escape closes the menu, from its button or from inside it, and goes no further.
      onKeyDown={(e) => { if (e.key === 'Escape' && menuFor === n && !isComposing(e.nativeEvent)) { e.preventDefault(); setMenuFor(null); } }}
    >
      <button
        type="button"
        className="record-sentence__menu-button"
        aria-label={t('history.changeSpeaker', 'Change speaker')}
        aria-haspopup="menu"
        aria-expanded={menuFor === n}
        onClick={() => setMenuFor(menuFor === n ? null : n)}
      >
        <UserRoundPen size={12} />
      </button>
      {menuFor === n && (
        <span className="record-sentence__menu" role="menu" aria-label={t('history.changeSpeaker', 'Change speaker')}>
          {speakersOf(row.side).filter((s) => s.speaker !== row.speaker).map((s) => (
            <button key={s.speaker} type="button" role="menuitem" disabled={busy} onClick={() => moveSentence(n, s.speaker)}>{s.label}</button>
          ))}
          <button type="button" role="menuitem" disabled={busy} onClick={() => moveSentence(n, newSpeaker(row.side))}>
            {t('history.newSpeaker', 'New speaker')}
          </button>
        </span>
      )}
    </span>
  );

  const transcript = rows.length === 0
    ? <p className="history-list__empty">{t('history.noTranscript', 'Nothing was said in this record.')}</p>
    : rows.map((row) => {
      const segmentSelector = `[data-segment="${quoted(row.segmentId)}"]`;
      return (
        <div
          key={`${row.segmentId}:${row.sentences[0]?.n}`}
          className={`record-row record-row--${row.side}${hit === segmentSelector ? ' is-hit' : ''}${playingRow === row ? ' is-playing' : ''}`}
          data-segment={row.segmentId}
          data-row={`${row.segmentId}:${row.sentences[0]?.n}`}
        >
          <div className="record-row__head">
            {hasPlayer && audible(row, record.tracks, record.mode) && (
              <button type="button" className="record-row__play" aria-label={t('history.playFromHere', 'Play from here')} onClick={() => seekRef.current?.(startFor(row), true)}>
                <Play size={12} aria-hidden="true" />
              </button>
            )}
            <span className="record-row__speaker">{row.speakerLabel}</span>
            <span className="record-row__time">{`${row.timeKind === 'estimated' ? '~' : ''}${formatLength(row.startMs)}`}</span>
          </div>
          <p className="record-row__text">
            {row.sentences.map((s, i) => (
              <React.Fragment key={s.n}>
                {i > 0 && spaceBetween(row.sentences[i - 1].text, s.text) ? ' ' : null}
                <span className={`record-sentence${hit === `[data-n="${s.n}"]` ? ' is-hit' : ''}`} data-n={s.n}>
                  {s.text}
                  {sentenceMenu(row, s.n)}
                </span>
              </React.Fragment>
            ))}
          </p>
          {row.translation && <p className="record-row__translation">{row.translation}</p>}
        </div>
      );
    });

  // The edit panel: a column at the right of the transcript, the left column's second tab when it shares that column
  // with the notes, or a tab of the page. Closing it while a name is typed saves the name, as a click elsewhere does.
  const sidePanel = editable && (
    <RecordSidePanel
      id={sideId}
      open={sideShown}
      // A name or the title being typed: Escape is the field's, not the panel's.
      editing={nameDraft !== null || titleDraft !== null}
      onToggle={columned ? toggleSide : () => choosePane('transcript')}
    >
      <section className="record-side__part" aria-label={t('history.speakers', 'Speakers')}>
        <h3>{t('history.speakers', 'Speakers')}</h3>
        <p className="record-side__hint">
          {t('history.speakersHint', 'Click a name to rename the speaker. To give one sentence to someone else, use the “Change speaker” button beside it in the transcript.')}
        </p>
        {speakersPanel}
      </section>
    </RecordSidePanel>
  );

  return (
    <div className="record-page" ref={pageRef}>
      <header className="record-page__head" ref={headRef}>
        <button type="button" className="settings-page__back" onClick={() => actions.closeRecord()}>
          <ChevronLeft size={14} aria-hidden="true" /> {t('history.backToList', 'Back to the list')}
        </button>
        <div className="record-page__heading">
          {titleDraft === null ? (
            <h2 className="record-page__h">
              <button type="button" className="record-page__title" title={t('history.renameHint', 'Click to rename')} onClick={() => setTitleDraft(record.titleByUser ? record.title ?? '' : '')}>
                <span>{title}</span>
                <Pencil size={13} aria-hidden="true" className="record-page__pencil" />
              </button>
            </h2>
          ) : (
            <InlineEdit
              fieldClassName="record-page__title-field"
              ariaLabel={t('history.titleField', 'Title')}
              value={titleDraft}
              placeholder={title}
              onChange={setTitleDraft}
              onSave={saveTitle}
              onCancel={() => setTitleDraft(null)}
            />
          )}
          <span className="history-row__meta">
            <span>{formatDateTime(record.startedAt, language)}</span>
            {live || record.endedAt === null
              ? <span className="history-row__live">{t('history.inProgress', 'In progress')}</span>
              : <span>{t('history.length', 'Length {{length}}', { length: formatLength(record.endedAt - record.startedAt) })}</span>}
            {/* A session's languages; an imported file's are what each transcript was asked for, said above its transcript. */}
            {record.mode !== 'import' && <span><LanguagePairText {...languageDirection(record, language, t)} /></span>}
            <span>{formatBytes(record.audioBytes + record.textBytes)}</span>
            {/* Which transcript the page shows, when there is more than one: the notes and the speakers follow it, so it
                is the record's, on the record's line (owner, 2026-11-18), not a bar over the columns. */}
            <TranscriptChooser />
          </span>
        </div>
        <div className="record-page__actions" ref={actionsRef}>
          {result && <span className="record-page__result" role="status">{result}</span>}
          {live && (
            <button type="button" className="history-button" disabled={busy} onClick={() => void actions.refreshRecord()}>
              <RefreshCw size={14} />
              {t('history.refresh', 'Refresh')}
            </button>
          )}
          {panelSwitches}
          <RecordExportMenu record={record} legs={open.legs} rows={rows} transcript={record.transcripts.find((x) => x.id === open.transcriptId) ?? null} notes={open.notes} onResult={setResult} />
          <span
            className="record-page__more"
            data-escape-own={moreOpen ? '' : undefined}
            onKeyDown={(e) => { if (e.key === 'Escape' && moreOpen && !isComposing(e.nativeEvent)) { e.preventDefault(); setMoreOpen(false); } }}
          >
            <button
              type="button"
              className="history-button history-button--icon"
              aria-label={t('history.more', 'More')}
              title={t('history.more', 'More')}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <Ellipsis size={16} />
            </button>
            {moreOpen && (
              <span className="record-page__menu" role="menu" aria-label={t('history.more', 'More')}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy || live || inTranscription}
                  title={live ? t('history.binWhenEnded', 'A record can move to the bin once its session has ended.') : whileTranscribed}
                  onClick={() => { setMoreOpen(false); void actions.binRecord(record.id); }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {t('history.moveOneToBin', 'Move to bin')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy || live || inTranscription || !hasPlayer}
                  title={whileTranscribed}
                  onClick={() => { setMoreOpen(false); setConfirmDrop(true); }}
                >
                  <MicOff size={14} aria-hidden="true" />
                  {t('history.dropRecording', 'Delete the recording')}
                </button>
                {filesOffered && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy || live || !hasPlayer}
                    title={!hasPlayer ? t('history.file.blockedNoRecording', 'This record keeps no recording.') : undefined}
                    onClick={() => { setMoreOpen(false); setTranscribing(true); }}
                  >
                    <AudioLines size={14} aria-hidden="true" />
                    {record.transcripts.length > 0 ? t('history.file.transcribeAgain', 'Transcribe again') : t('history.file.transcribe', 'Transcribe')}
                  </button>
                )}
              </span>
            )}
          </span>
        </div>
      </header>
      {confirmDrop && (
        <div
          className="history-confirm record-page__confirm"
          role="alertdialog"
          aria-label={t('history.dropRecording', 'Delete the recording')}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setConfirmDrop(false); } }}
        >
          <p>{t('history.confirmDropRecording', 'Delete this record’s recording? Its transcript and notes stay. The recording cannot be brought back.')}</p>
          <div className="history-confirm__actions">
            <button type="button" className="history-button history-button--danger" disabled={busy} onClick={() => { setConfirmDrop(false); setReleasing(true); void actions.dropRecording().finally(() => setReleasing(false)); }}>
              {t('history.delete', 'Delete')}
            </button>
            <button type="button" ref={cancelDropRef} className="history-button" onClick={() => setConfirmDrop(false)}>
              {t('history.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}
      {transcribing && <TranscribePanel onClose={() => setTranscribing(false)} />}
      {!columned && (
        <div className="record-page__panes" role="tablist">
          <button type="button" role="tab" aria-selected={shownPane === 'notes'} onClick={() => void choosePane('notes')}>{t('history.notes', 'Notes')}</button>
          <button type="button" role="tab" aria-selected={shownPane === 'transcript'} onClick={() => void choosePane('transcript')}>{t('history.transcript', 'Transcript')}</button>
          {editable && (
            <button type="button" role="tab" aria-selected={shownPane === 'edit'} aria-controls={sideId} onClick={() => void choosePane('edit')}>{t('history.sidePanel', 'Edit')}</button>
          )}
        </div>
      )}
      {/* The columns, in a frame that does not scroll: the speakers' drawer stays put over them. */}
      <div className="record-page__body">
      <div
        className={`record-page__columns${columned ? ' has-columns' : ''}`}
        style={columned ? { gridTemplateColumns: tracks.join(' ') } : undefined}
      >
        {/* The left column: the notes, or the notes and the edit panel a tab each when the two share it. */}
        <div className="record-page__notes-col" hidden={columned ? !notesColumn : shownPane !== 'notes'}>
          {sharing && (
            <div className="record-page__panes" role="tablist">
              <button type="button" role="tab" aria-selected={sharedPane === 'notes'} aria-controls={notesId} onClick={() => void chooseShared('notes')}>{t('history.notes', 'Notes')}</button>
              <button type="button" role="tab" aria-selected={sharedPane === 'edit'} aria-controls={sideId} onClick={() => void chooseShared('edit')}>{t('history.sidePanel', 'Edit')}</button>
            </div>
          )}
          <div className="record-page__notes" id={notesId} hidden={!notesShown}>{notesView}</div>
          {sharing && sidePanel}
        </div>
        {notesColumn && (
          <PanelResizer
            side="left"
            width={shownNotesWidth}
            min={NOTES_MIN_PX}
            max={notesWidthWithin(Number.POSITIVE_INFINITY, notesRoom)}
            label={t('history.resizeNotes', 'Resize the notes')}
            onResize={(next) => setNotesWidth(notesWidthWithin(next, notesRoom))}
            onCommit={(next) => {
              const width = notesWidthWithin(next, notesRoom);
              setNotesWidth(width);
              writeNotesWidth(width);
            }}
          />
        )}
        <div className="record-page__transcript" ref={transcriptRef} hidden={!columned && shownPane !== 'transcript'}>
          <TranscriptAsked />
          {transcript}
        </div>
        {/* The edit panel's column at the right of the transcript (owner, 2026-11-18), with its own divider. */}
        {sideColumn && (
          <PanelResizer
            width={shownSideWidth}
            min={SIDE_MIN_PX}
            max={sideWidthWithin(Number.POSITIVE_INFINITY, sideRoom)}
            label={t('history.resizeSidePanel', 'Resize the edit panel')}
            onResize={(next) => setSideWidth(sideWidthWithin(next, sideRoom))}
            onCommit={(next) => {
              const width = sideWidthWithin(next, sideRoom);
              setSideWidth(width);
              writeSideWidth(width);
            }}
          />
        )}
        {!sharing && sidePanel}
      </div>
      </div>
      <div className="record-page__player">
        {hasPlayer && <RecordPlayer recordId={record.id} tracks={record.tracks} onPosition={setPosition} seekRef={seekRef} />}
      </div>
    </div>
  );
};

export default RecordPage;
