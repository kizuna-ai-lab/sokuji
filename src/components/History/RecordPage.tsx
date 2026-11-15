// src/components/History/RecordPage.tsx
//
// One record: its title (renamed in place), when and how long, its languages and the space it takes; its transcript,
// one block per round and speaker with the translation under it; its speakers, named in place; and its export. A record
// still being written shows how it was when opened, with Refresh. The notes and the player get their places later: the
// side column below the speakers, and a strip along the bottom.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { ArrowLeft, Pencil, RefreshCw, Trash2, UserRoundPen } from 'lucide-react';
import { languageLabel } from '../../lib/language/label';
import type { HitTarget, OpenRecord } from '../../lib/history/historyPageStore';
import { recordRows, type RecordRow, type SpeakerLabels } from '../../lib/history/recordView';
import type { HistorySentenceSide } from '../../lib/history/types';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { useHistoryPageContext } from './historyContext';
import { formatBytes, formatDateTime, formatLength } from './format';
import RecordExportMenu from './RecordExportMenu';
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
  const newest = open.record.transcripts[open.record.transcripts.length - 1];
  if (at.kind === 'sentence') return newest && at.transcriptId === newest.id ? `[data-n="${at.n}"]` : null;
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

export const RecordPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const busy = useStore(store, (s) => s.busy);
  const actions = store.getState();
  const language = i18n.language;

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<{ side: HistorySentenceSide; speaker: string; value: string } | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [hit, setHit] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const markedAt = useRef<HitTarget | null>(null);

  const labels: SpeakerLabels = useMemo(() => {
    const mine = t('history.me', 'Me');
    const other = t('history.other', 'Other');
    return { mine, other, person: (side, n) => t('history.speakerN', '{{side}} {{n}}', { side: side === 'mine' ? mine : other, n }) };
  }, [t]);
  const textKind = open?.record.transcripts[open.record.transcripts.length - 1]?.textKind ?? 'original';
  const rows = useMemo(
    () => (open ? recordRows({ sentences: open.sentences, legs: open.legs, textKind, labels }) : []),
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

  useEffect(() => {
    if (!result) return undefined;
    const timer = window.setTimeout(() => setResult(null), RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [result]);

  if (!open) return null;
  const { record } = open;
  const title = record.title ?? formatDateTime(record.startedAt, language);
  const live = record.state === 'open';

  const saveTitle = () => {
    if (titleDraft === null) return;
    setTitleDraft(null);
    void actions.rename(record.id, titleDraft);
  };
  const onTitleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') saveTitle();
    else if (e.key === 'Escape') {
      // The edit is cancelled; the page does not take this Escape as a way back to the list.
      e.preventDefault();
      setTitleDraft(null);
    }
  };

  // Speakers: the labels the transcript uses, by side, then by label.
  const labelOf = new Map<string, string>();
  for (const r of rows) if (!labelOf.has(speakerKey(r.side, r.speaker))) labelOf.set(speakerKey(r.side, r.speaker), r.speakerLabel);
  const speakersOf = (side: HistorySentenceSide) => open.speakers
    .filter((s) => s.side === side && labelOf.has(speakerKey(s.side, s.speaker)))
    .map((s) => ({ ...s, label: labelOf.get(speakerKey(s.side, s.speaker))! }));
  const saveName = () => {
    if (!nameDraft) return;
    setNameDraft(null);
    void actions.renameSpeaker(nameDraft.side, nameDraft.speaker, nameDraft.value);
  };
  const newSpeaker = (side: HistorySentenceSide) => {
    const used = open.speakers.filter((s) => s.side === side).map((s) => Number(USER_SPEAKER.exec(s.speaker)?.[1] ?? 0));
    return `u${Math.max(0, ...used) + 1}`;
  };
  const moveSentence = (n: number, speaker: string) => {
    setMenuFor(null);
    void actions.reassign(n, speaker);
  };

  const speakersPanel = (
    <section className="record-page__speakers" aria-label={t('history.speakers', 'Speakers')}>
      <h3>{t('history.speakers', 'Speakers')}</h3>
      {(['mine', 'other'] as const).map((side) => {
        const list = speakersOf(side);
        if (list.length === 0) return null;
        return (
          <div key={side} className={`record-speakers record-speakers--${side}`}>
            <h4>{side === 'mine' ? t('history.sideMine', 'Your side') : t('history.sideOther', 'The other side')}</h4>
            <ul>
              {list.map((s) => {
                const editing = nameDraft && nameDraft.side === side && nameDraft.speaker === s.speaker;
                return (
                  <li key={s.speaker}>
                    {editing ? (
                      <input
                        className="record-speakers__field"
                        aria-label={t('history.nameField', 'Name')}
                        autoFocus
                        value={nameDraft.value}
                        placeholder={s.label}
                        onChange={(e) => setNameDraft({ ...nameDraft, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveName();
                          else if (e.key === 'Escape') { e.preventDefault(); setNameDraft(null); }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="record-speakers__name"
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
    </section>
  );

  const sentenceMenu = (row: RecordRow, n: number) => (
    <span className="record-sentence__more">
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
        <span
          className="record-sentence__menu"
          role="menu"
          aria-label={t('history.changeSpeaker', 'Change speaker')}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setMenuFor(null); } }}
        >
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
          className={`record-row record-row--${row.side}${hit === segmentSelector ? ' is-hit' : ''}`}
          data-segment={row.segmentId}
        >
          <div className="record-row__head">
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
    <div className="record-page">
      <header className="record-page__head">
        <button type="button" className="history-list__back" onClick={() => actions.closeRecord()}>
          <ArrowLeft size={14} />
          {t('history.back', 'Back')}
        </button>
        <div className="record-page__heading">
          {titleDraft === null ? (
            <button type="button" className="record-page__title" title={t('history.renameHint', 'Click to rename')} onClick={() => setTitleDraft(record.titleByUser ? record.title ?? '' : '')}>
              {title}
            </button>
          ) : (
            <input
              className="record-page__title-field"
              aria-label={t('history.titleField', 'Title')}
              autoFocus
              value={titleDraft}
              placeholder={title}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={onTitleKey}
            />
          )}
          <span className="history-row__meta">
            <span>{formatDateTime(record.startedAt, language)}</span>
            {live || record.endedAt === null
              ? <span className="history-row__live">{t('history.inProgress', 'In progress')}</span>
              : <span>{formatLength(record.endedAt - record.startedAt)}</span>}
            <span>{`${languageLabel(record.myLanguage, language)} → ${languageLabel(record.targetLanguage, language)}`}</span>
            <span>{formatBytes(record.audioBytes + record.textBytes)}</span>
          </span>
        </div>
        <div className="record-page__actions">
          {result && <span className="record-page__result" role="status">{result}</span>}
          {live ? (
            <button type="button" className="history-button" disabled={busy} onClick={() => void actions.refreshRecord()}>
              <RefreshCw size={14} />
              {t('history.refresh', 'Refresh')}
            </button>
          ) : (
            <button type="button" className="history-button" disabled={busy} onClick={() => void actions.binRecord(record.id)}>
              <Trash2 size={14} />
              {t('history.moveOneToBin', 'Move to bin')}
            </button>
          )}
          <RecordExportMenu record={record} legs={open.legs} rows={rows} onResult={setResult} />
        </div>
      </header>
      <div className="record-page__columns">
        <div className="record-page__transcript" ref={transcriptRef}>{transcript}</div>
        <aside className="record-page__side">{speakersPanel}</aside>
      </div>
      <div className="record-page__player" />
    </div>
  );
};

export default RecordPage;
