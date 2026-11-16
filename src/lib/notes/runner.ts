// src/lib/notes/runner.ts
//
// Writing a record's notes in the background, one version at a time per record. A version is written from the
// record's newest transcript and saved when it ends: complete, failed with what went wrong, or cancelled. Nothing is
// saved for a transcript too short to write notes from. The store names the record after complete notes unless the
// user named it (History store, saveNotes), so the runner leaves the title alone.
import type { WordEntry } from '../words/list';
import type { HistoryPort } from '../history/port';
import type { HistoryNotesInput, HistoryRecord, HistorySentence, HistorySentenceSide } from '../history/types';
import type { ChatPort } from './chat';
import { activePrompts } from './promptSource';
import { NOTES_MIN_MS, writeNotes } from './write';

export interface NotesLanguage { code: string; name: string }

export interface NotesRunnerDeps {
  port: HistoryPort;
  /** The notes service and the model it uses, for the record written (a hosted service bills that meeting); null when none is set up. */
  chatFor(recordId: string): Promise<{ chat: ChatPort; model: string } | null>;
  /** The language notes are written in when none is asked for: the record's "my language", or the interface's. */
  language(record: HistoryRecord): NotesLanguage;
  /** The word list: spellings the notes are asked to prefer (stage 5); none when absent. */
  names?(): readonly WordEntry[];
  report?(message: string, cause: unknown): void;
}

export interface NotesRunner {
  /** Starts a version for the record, unless one is being written for it already. */
  /** A version from `transcriptId` when the record has it, else from its newest transcript. */
  start(recordId: string, language?: NotesLanguage, transcriptId?: number): void;
  /** Stops the record's version; it is saved as cancelled. */
  cancel(recordId: string): void;
  /** The records whose notes are being written. */
  running(): string[];
  subscribe(listener: () => void): () => void;
}

/** The failure stored when no notes service is set up (worded by the page). */
export const NO_NOTES_SERVICE = 'notes:no-service';

/**
 * How the notes model hears the speakers: by the name the user gave, else by side, numbered when a side has several
 * (in the order they first speak). The side words are the prompt's own ("My side", "Other side").
 */
export function notesSpeakerLabel(sentences: readonly HistorySentence[]): (s: HistorySentence) => string {
  const who = (s: HistorySentence) => s.speakerByUser ?? s.speaker;
  const order: Record<HistorySentenceSide, string[]> = { mine: [], other: [] };
  const names = new Map<string, string>();
  for (const s of sentences) {
    if (!order[s.side].includes(who(s))) order[s.side].push(who(s));
    if (s.speakerName) names.set(`${s.side}\u0000${who(s)}`, s.speakerName);
  }
  return (s) => {
    const name = names.get(`${s.side}\u0000${who(s)}`);
    if (name) return name;
    const side = s.side === 'mine' ? 'My side' : 'Other side';
    return order[s.side].length >= 2 ? `${side} ${order[s.side].indexOf(who(s)) + 1}` : side;
  };
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function createNotesRunner(d: NotesRunnerDeps): NotesRunner {
  const runs = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of listeners) l(); };
  const report = (message: string, cause: unknown) => d.report?.(message, cause);

  async function run(recordId: string, asked: NotesLanguage | undefined, controller: AbortController, transcriptId?: number): Promise<void> {
    const record = await d.port.getRecord(recordId);
    const newest = record?.transcripts.find((t) => t.id === transcriptId)
      ?? [...(record?.transcripts ?? [])].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).pop();
    if (!record || !newest) return;
    const language = asked ?? d.language(record);
    const sentences = await d.port.getSentences({ transcriptId: newest.id });
    // Too little to write notes from: nothing is called and nothing is saved, set up or not.
    const span = sentences.length > 0
      ? Math.max(...sentences.map((s) => s.endMs)) - Math.min(...sentences.map((s) => s.startMs)) : 0;
    if (span < NOTES_MIN_MS) return;
    const service = await d.chatFor(recordId);
    const requestIds: string[] = [];
    // One set of prompts for the whole version; its number is what the version stores.
    const prompts = activePrompts().notes;
    const base = {
      recordId, transcriptId: newest.id, language: language.code,
      writtenBy: { kind: 'sokuji' as const, promptVersion: prompts.version, model: service?.model ?? '' },
    };
    const save = (rest: Pick<HistoryNotesInput, 'state' | 'failure' | 'body'>) => d.port.saveNotes({ ...base, ...rest, requestIds: [...requestIds] });
    if (!service) {
      await save({ state: 'failed', failure: NO_NOTES_SERVICE, body: null });
      return;
    }
    let result;
    try {
      result = await writeNotes({
        sentences, speakerLabel: notesSpeakerLabel(sentences), language, chat: service.chat, signal: controller.signal, requestIds,
        names: d.names?.() ?? [], prompts,
      });
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) {
        await save({ state: 'cancelled', failure: null, body: null });
        return;
      }
      throw error;
    }
    // Cancelled just as the last answer came in: the user asked to stop, so the version is cancelled.
    if (controller.signal.aborted) {
      await save({ state: 'cancelled', failure: null, body: null });
      return;
    }
    if (result.ok) await save({ state: 'complete', body: result.body });
    else if ('failure' in result) await save({ state: 'failed', failure: result.failure, body: null });
  }

  return {
    start(recordId, language, transcriptId) {
      if (runs.has(recordId)) return;
      const controller = new AbortController();
      runs.set(recordId, controller);
      notify();
      void run(recordId, language, controller, transcriptId)
        .catch((error) => report(`The notes of ${recordId} could not be written`, error))
        .finally(() => {
          runs.delete(recordId);
          notify();
        });
    },
    cancel(recordId) {
      runs.get(recordId)?.abort();
    },
    running: () => [...runs.keys()],
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
