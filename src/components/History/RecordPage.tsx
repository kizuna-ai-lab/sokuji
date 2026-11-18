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

/** From this width of the page the notes stand beside the transcript; narrower, each has its tab. */
const NOTES_WIDE_PX = 1000;

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

  // The notes: beside the transcript on a wide page, in a tab of their own on a narrow one.
  const notesRunning = useStore(store, (s) => s.notesRunning);
  const pageRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [pageWidth, setPageWidth] = useState(0);
  // Wide: the notes column's width, dragged at the divider, and whether it is shown, from a switch in the toolbar; both
  // kept for the next record (owner, 2026-11-17; B-31, B-40). Hidden, the transcript takes the whole width.
  const [notesOpen, setNotesOpen] = useState(readNotesOpen);
  const [notesWidth, setNotesWidth] = useState(readNotesWidth);
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
  const [pane, setPane] = useState<'notes' | 'transcript'>('transcript');
  // A search hit opens on its own tab: the notes for a hit in the notes, else the transcript.
  const hitKind = open?.at?.kind;
  useEffect(() => {
    if (!hitKind) return;
    setPane(hitKind === 'notes' ? 'notes' : 'transcript');
    // A hit in the notes shows them on a wide page too; the closed choice stays saved for ordinary openings.
    if (hitKind === 'notes') setNotesOpen(true);
  }, [open?.record.id, hitKind]);
  const [jumpTo, setJumpTo] = useState<{ n: number } | null>(null);
  useEffect(() => {
    const el = pageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(() => {
      setWide(el.clientWidth >= NOTES_WIDE_PX);
      setPageWidth(el.clientWidth);
    });
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
  // The width shown fits this page; the one kept stays as the user left it, for a wider window later.
  const shownNotesWidth = notesWidthWithin(notesWidth, pageWidth);
  const title = record.title ?? formatDateTime(record.startedAt, language);
  const live = record.state === 'open';

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
  const sideShown = speakerCount > 0 && (wide || pane === 'transcript');
  // Hiding the side panel with a name being typed saves it first, a newer one typed while an earlier save ran as well
  // (review); a name that fails to save, or is still unsaved, keeps the panel open with it.
  const toggleSide = async () => {
    if (sideOpen) {
      for (let i = 0; i < 3 && (nameDraftRef.current || nameSave.current); i += 1) {
        if (!(await saveName())) return;
      }
      if (nameDraftRef.current) return;
    }
    writeSideOpen(!sideOpen);
    setSideOpen(!sideOpen);
  };
  // The two panels' switches, together in the toolbar before Export: the icon says which side, the pressed state that
  // the panel is shown, the tooltip what a click does (design review, 2026-11-17; B-40).
  const panelSwitches = (wide || sideShown) && (
    <span className="record-page__panels" data-compact={switchWords ? undefined : ''}>
      {wide && (
        <button type="button" className="history-button record-page__panel-switch" aria-label={t('history.notes', 'Notes')}
          title={notesOpen ? t('history.hideNotes', 'Hide the notes') : t('history.showNotes', 'Show the notes')}
          aria-pressed={notesOpen} aria-controls={notesId} onClick={() => { writeNotesOpen(!notesOpen); setNotesOpen(!notesOpen); }}>
          <PanelLeft size={16} aria-hidden="true" />
          <span className="record-page__panel-word">{t('history.notes', 'Notes')}</span>
        </button>
      )}
      {sideShown && (
        <button type="button" className="history-button record-page__panel-switch" aria-label={t('history.sidePanel', 'Side panel')}
          title={sideOpen ? t('history.closeSidePanel', 'Close the side panel') : t('history.openSidePanel', 'Open the side panel')}
          aria-pressed={sideOpen} aria-controls={sideId} onClick={() => void toggleSide()}>
          <PanelRight size={16} aria-hidden="true" />
          <span className="record-page__panel-word">{t('history.sidePanel', 'Side panel')}</span>
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
            {record.mode !== 'import' && <span>{languageDirection(record, language)}</span>}
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
                  disabled={busy || live}
                  title={live ? t('history.binWhenEnded', 'A record can move to the bin once its session has ended.') : undefined}
                  onClick={() => { setMoreOpen(false); void actions.binRecord(record.id); }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {t('history.moveOneToBin', 'Move to bin')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy || live || !hasPlayer}
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
      {!wide && (
        <div className="record-page__panes" role="tablist">
          <button type="button" role="tab" aria-selected={pane === 'notes'} onClick={() => setPane('notes')}>{t('history.notes', 'Notes')}</button>
          <button type="button" role="tab" aria-selected={pane === 'transcript'} onClick={() => setPane('transcript')}>{t('history.transcript', 'Transcript')}</button>
        </div>
      )}
      {/* The columns, in a frame that does not scroll: the speakers' drawer stays put over them. */}
      <div className="record-page__body">
      <div
        className={`record-page__columns${wide ? ' is-wide' : ''}`}
        style={wide ? { gridTemplateColumns: notesOpen ? `${shownNotesWidth}px ${DIVIDER_PX}px minmax(0, 1fr)` : 'minmax(0, 1fr)' } : undefined}
      >
        <div className="record-page__notes-col" hidden={wide ? !notesOpen : pane !== 'notes'}>
          <div className="record-page__notes" id={notesId} hidden={wide && !notesOpen}>{notesView}</div>
        </div>
        {wide && notesOpen && (
          <PanelResizer
            side="left"
            width={shownNotesWidth}
            min={NOTES_MIN_PX}
            max={notesWidthWithin(Number.POSITIVE_INFINITY, pageWidth)}
            onResize={(next) => setNotesWidth(notesWidthWithin(next, pageWidth))}
            onCommit={(next) => {
              const width = notesWidthWithin(next, pageWidth);
              setNotesWidth(width);
              writeNotesWidth(width);
            }}
          />
        )}
        <div className="record-page__transcript" ref={transcriptRef} hidden={!wide && pane !== 'transcript'}>
          <TranscriptAsked />
          {transcript}
        </div>
      </div>
        {/* The side panel over the transcript (owner, 2026-11-17): the speakers have no column of their own. Closing it
            while a name is typed saves the name, as a click elsewhere does. */}
        {sideShown && (
          <RecordSidePanel
            id={sideId}
            open={sideOpen}
            // A name or the title being typed: Escape is the field's, not the panel's.
            editing={nameDraft !== null || titleDraft !== null}
            onToggle={toggleSide}
          >
            <section className="record-side__part" aria-label={t('history.speakers', 'Speakers')}>
              <h3>{t('history.speakers', 'Speakers')}</h3>
              <p className="record-side__hint">
                {t('history.speakersHint', 'Click a name to rename the speaker. To give one sentence to someone else, use the “Change speaker” button beside it in the transcript.')}
              </p>
              {speakersPanel}
            </section>
          </RecordSidePanel>
        )}
      </div>
      <div className="record-page__player">
        {hasPlayer && <RecordPlayer recordId={record.id} tracks={record.tracks} onPosition={setPosition} seekRef={seekRef} />}
      </div>
    </div>
  );
};

export default RecordPage;
