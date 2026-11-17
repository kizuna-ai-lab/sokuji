// src/components/History/RecordExportMenu.tsx
//
// A record's export: the per-side choice of today's export menu, then the text, the JSON and the subtitles. The text
// and JSON are today's exporter run on the stored conversation, or, for a file transcript (an imported file's, or a
// record transcribed again), written from the rows the page shows; the subtitles come from the transcript rows. Files
// are named after the record's start.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, Captions, ChevronDown, Copy, Download, FileJson, FileText } from 'lucide-react';
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, size, useClick, useDismiss, useFloating, useInteractions,
  useListNavigation, useRole,
} from '@floating-ui/react';
import type { Leg } from '../../lib/conversation/types';
import { conversationExporter, exportWords, rowsExporter } from '../../lib/export/exporter';
import { FULL_SCOPE, type TranscriptScope } from '../../lib/export/transcript';
import { recordCues, type RecordRow } from '../../lib/history/recordView';
import { renderSrt, renderVtt } from '../../lib/history/subtitles';
import type { HistoryNotes, HistoryRecord, HistoryTranscriptRow } from '../../lib/history/types';
import { notesMarkdown, notesText, type NotesWords } from '../../lib/notes/exportNotes';
import { readNotesBody } from '../../lib/notes/write';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { copyToClipboard, downloadFile, exportFilename, formatTimestampForFilename } from '../../utils/conversationExport';
import { playable } from '../../lib/history/playback';
import { historyPort } from '../../lib/history/port';
import { modeToToggles, togglesToMode, type ScopeToggles } from '../MainPanel/conversationFilter';
import '../MainPanel/ExportButton.scss';

export interface RecordExportMenuProps {
  record: HistoryRecord;
  legs: readonly Leg[];
  rows: readonly RecordRow[];
  /** The transcript the page shows (the rows'); the record's latest when not given. */
  transcript?: HistoryTranscriptRow | null;
  /** The version of the notes shown on the page: exported as it is. */
  notes?: HistoryNotes | null;
  /** A line about what a copy did, for the page to show. */
  onResult?(message: string): void;
}

/**
 * The scope a transcript's rows are cut to for subtitles. A transcript cut from the translation keeps the translation
 * as its sentences and has no second line: the sides that show the translation show its sentences once.
 */
function cueScope(scope: TranscriptScope, textKind: 'original' | 'translation'): TranscriptScope {
  if (textKind === 'original') return scope;
  const one = (s: TranscriptScope['speaker']) => (s === 'both' || s === 'translation' ? 'source' : 'none');
  return { speaker: one(scope.speaker), participant: one(scope.participant) };
}

export function RecordExportMenu({ record, legs, rows, transcript, notes = null, onResult }: RecordExportMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const [speaker, setSpeaker] = useState<ScopeToggles>(() => modeToToggles(FULL_SCOPE.speaker));
  const [participant, setParticipant] = useState<ScopeToggles>(() => modeToToggles(FULL_SCOPE.participant));
  const scope: TranscriptScope = useMemo(() => ({ speaker: togglesToMode(speaker), participant: togglesToMode(participant) }), [speaker, participant]);
  const shown = transcript ?? record.transcripts[record.transcripts.length - 1] ?? null;
  const textKind = shown?.textKind ?? 'original';
  // A file transcript has no conversation behind it: its text is the rows the page shows.
  const fromFile = shown?.origin.kind === 'file';

  const exporter = useMemo(() => {
    const common = {
      legs,
      words: exportWords(t as Parameters<typeof exportWords>[0]),
      appVersion: record.appVersion,
      // A saved file says when its session started and when it was saved; its name is the session's start (below).
      now: () => Date.now(),
    };
    return fromFile && shown
      ? rowsExporter({ ...common, rows, startedAt: record.startedAt, info: { provider: shown.origin.service, models: {}, startedAt: record.startedAt } })
      : conversationExporter({
        ...common,
        entries: createProjector().project(legs, DEFAULT_PROJECTION),
        info: { provider: record.services.provider, models: record.services.models, startedAt: record.startedAt },
      });
  }, [legs, record, rows, shown, fromFile, t]);

  useEffect(() => { if (isOpen) setActiveIndex(0); }, [isOpen]);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-end',
    middleware: [
      offset(4), flip(), shift({ padding: 8 }),
      size({ padding: 8, apply({ availableHeight, elements }) { Object.assign(elements.floating.style, { maxHeight: `${Math.max(0, availableHeight)}px` }); } }),
    ],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context), useDismiss(context), useRole(context, { role: 'menu' }),
    useListNavigation(context, { listRef, activeIndex, onNavigate: setActiveIndex, loop: true }),
  ]);

  const lines = [
    { key: 'src' as const, label: t('mainPanel.displayMode.source', 'Src') },
    { key: 'trans' as const, label: t('mainPanel.displayMode.translation', 'Trans') },
  ];
  const scopeRows = [
    { key: 'speaker', label: t('mainPanel.displayMode.speaker', 'Me'), toggles: speaker, set: setSpeaker },
    { key: 'participant', label: t('mainPanel.displayMode.participant', 'Other'), toggles: participant, set: setParticipant },
  ];
  const scopeRing = scopeRows.length * lines.length;
  const hasScoped = exporter.hasScopedContent(scope);
  const file = (ext: 'txt' | 'json' | 'srt' | 'vtt') => exportFilename(ext, record.startedAt);
  const recorded = playable(record.tracks);
  // The notes shown, when they are complete: their own items, not narrowed by the choice above.
  const notesBody = notes?.state === 'complete' && notes.body ? readNotesBody(notes.body) : null;
  const notesWords: NotesWords = {
    decision: t('history.notesKind.decision', 'Decision'), todo: t('history.notesKind.todo', 'To do'), risk: t('history.notesKind.risk', 'Risk'),
    mySide: t('history.sideMine', 'Your side'), otherSide: t('history.sideOther', 'The other side'),
  };
  const notesFile = (ext: 'md' | 'txt') => `sokuji-notes-${formatTimestampForFilename(record.startedAt)}.${ext}`;

  const items = [
    {
      // Each item says what it copies or saves, as the subtitles' and the notes' do; copying first (owner, 2026-11-17).
      key: 'copy', label: t('history.copyConversation', 'Copy the conversation'), Icon: Copy,
      run: async () => {
        const ok = await copyToClipboard(exporter.text(scope, false));
        onResult?.(ok ? t('history.copied', 'Copied.') : t('history.copyFailed', 'Could not copy. Check the clipboard permission.'));
      },
    },
    { key: 'txt', label: t('history.saveConversationTxt', 'Save the conversation (.txt)'), Icon: FileText, run: () => downloadFile(exporter.text(scope, true), file('txt'), 'text/plain;charset=utf-8') },
    { key: 'json', label: t('history.saveConversationJson', 'Save the conversation (.json)'), Icon: FileJson, run: () => downloadFile(exporter.json(scope), file('json'), 'application/json') },
    {
      key: 'srt', label: t('history.saveSrt', 'Save subtitles (.srt)'), Icon: Captions,
      run: () => downloadFile(renderSrt(recordCues(rows, cueScope(scope, textKind))), file('srt'), 'application/x-subrip;charset=utf-8'),
    },
    {
      key: 'vtt', label: t('history.saveVtt', 'Save subtitles (.vtt)'), Icon: Captions,
      run: () => downloadFile(renderVtt(recordCues(rows, cueScope(scope, textKind))), file('vtt'), 'text/vtt;charset=utf-8'),
    },
    {
      key: 'notes-copy', label: t('history.copyNotes', 'Copy notes'), Icon: Copy, own: true, enabled: notesBody !== null,
      run: async () => {
        if (!notesBody) return;
        const ok = await copyToClipboard(notesText(notesBody, notesWords));
        onResult?.(ok ? t('history.copied', 'Copied.') : t('history.copyFailed', 'Could not copy. Check the clipboard permission.'));
      },
    },
    {
      key: 'notes-md', label: t('history.saveNotesMd', 'Save notes (.md)'), Icon: FileText, own: true, enabled: notesBody !== null,
      run: () => { if (notesBody) downloadFile(notesMarkdown(notesBody, notesWords), notesFile('md'), 'text/markdown;charset=utf-8'); },
    },
    {
      key: 'notes-txt', label: t('history.saveNotesTxt', 'Save notes (.txt)'), Icon: FileText, own: true, enabled: notesBody !== null,
      run: () => { if (notesBody) downloadFile(notesText(notesBody, notesWords), notesFile('txt'), 'text/plain;charset=utf-8'); },
    },
    {
      // The stored files as they are, one per track (spec §7); not narrowed by the choice above. The main process asks
      // where with the system's Save dialog and copies each file: the page never reads a recording. With two tracks,
      // each dialog names its side, and either can be cancelled on its own.
      key: 'audio', label: t('history.saveRecording', 'Save the recording (.opus)'), Icon: AudioLines, own: true, enabled: recorded.length > 0,
      run: async () => {
        const stamp = formatTimestampForFilename(record.startedAt);
        for (const track of recorded) {
          const mine = track.source === 'speaker';
          const title = recorded.length === 1 ? t('history.saveRecordingTitle', 'Save the recording')
            : mine ? t('history.saveMyRecording', 'Save your side’s recording')
              : t('history.saveOtherRecording', 'Save the other side’s recording');
          try {
            await historyPort().saveTrack({ recordId: record.id, source: track.source, title, defaultName: `sokuji-recording-${stamp}-${mine ? 'me' : 'other'}.opus` });
          } catch {
            onResult?.(t('history.saveRecordingFailed', 'The recording could not be saved.'));
            return;
          }
        }
      },
    },
  ];

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className="history-button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        {...getReferenceProps()}
      >
        <Download size={14} />
        {t('history.export', 'Export')}
        <ChevronDown size={12} />
      </button>
      {isOpen && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div ref={refs.setFloating} className="export-menu" style={{ ...floatingStyles, zIndex: 9999 }} {...getFloatingProps()}>
              <div className="export-scope" role="group" aria-label={t('mainPanel.export.scopeLabel', 'Include')}>
                <div className="export-scope-title">{t('mainPanel.export.scopeLabel', 'Include')}</div>
                {scopeRows.map((row, rowIdx) => (
                  <div className="export-scope-row" key={row.key}>
                    <span className="export-scope-row-label">{row.label}</span>
                    {lines.map((line, lineIdx) => {
                      const ring = rowIdx * lines.length + lineIdx;
                      return (
                        <button
                          key={line.key}
                          type="button"
                          role="menuitemcheckbox"
                          className="export-scope-box"
                          aria-checked={row.toggles[line.key]}
                          aria-label={t('mainPanel.export.scopeItemAria', '{{scope}} — {{line}}', { scope: row.label, line: line.label })}
                          ref={(node) => { listRef.current[ring] = node; }}
                          tabIndex={activeIndex === ring ? 0 : -1}
                          {...getItemProps({ onClick: () => row.set((prev) => ({ ...prev, [line.key]: !prev[line.key] })) })}
                        >
                          {line.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              {!hasScoped && <div className="export-scope-empty">{t('mainPanel.export.scopeEmpty', 'Nothing selected')}</div>}
              {items.map((it, idx) => (
                <button
                  key={it.key}
                  ref={(node) => { listRef.current[scopeRing + idx] = node; }}
                  role="menuitem"
                  type="button"
                  className="export-menu-item"
                  disabled={'own' in it ? !it.enabled : !hasScoped}
                  tabIndex={activeIndex === scopeRing + idx ? 0 : -1}
                  {...getItemProps({ onClick: () => { setIsOpen(false); void it.run(); } })}
                >
                  <it.Icon size={14} />
                  <span>{it.label}</span>
                </button>
              ))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

export default RecordExportMenu;
