// src/lib/notes/runner.ts
//
// Writing a record's notes in the background, one version at a time per record. A version is written from the
// record's newest transcript and saved when it ends: complete, failed with what went wrong, or cancelled. Nothing is
// saved for a transcript too short to write notes from. The store names the record after complete notes unless the
// user named it (History store, saveNotes), so the runner leaves the title alone.
import type { HistoryPort } from '../history/port';
import type { HistoryNotesInput, HistoryRecord, HistorySentence, HistorySentenceSide } from '../history/types';
import type { ChatPort } from './chat';
import { NOTES_PROMPT_VERSION } from './prompts';
import { writeNotes } from './write';

export interface NotesLanguage { code: string; name: string }

export interface NotesRunnerDeps {
  port: HistoryPort;
  /** The notes service with the user's key, and the model it uses; null when none is set up. */
  chatFor(): Promise<{ chat: ChatPort; model: string } | null>;
  /** The language notes are written in when none is asked for: the record's "my language", or the interface's. */
  language(record: HistoryRecord): NotesLanguage;
  report?(message: string, cause: unknown): void;
}

export interface NotesRunner {
  /** Starts a version for the record, unless one is being written for it already. */
  start(recordId: string, language?: NotesLanguage): void;
  /** Stops the record's version; it is saved as cancelled. */
  cancel(recordId: string): void;
  /** The records whose notes are being written. */
  running(): string[];
  subscribe(listener: () => void): () => void;
}

export const NO_NOTES_SERVICE = 'No notes service is set up: choose one and add its key in the settings.';

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

  async function run(recordId: string, asked: NotesLanguage | undefined, controller: AbortController): Promise<void> {
    const record = await d.port.getRecord(recordId);
    const newest = [...(record?.transcripts ?? [])].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).pop();
    if (!record || !newest) return;
    const language = asked ?? d.language(record);
    const service = await d.chatFor();
    const sentences = await d.port.getSentences({ transcriptId: newest.id });
    const base = {
      recordId, transcriptId: newest.id, language: language.code,
      writtenBy: { kind: 'sokuji' as const, promptVersion: NOTES_PROMPT_VERSION, model: service?.model ?? '' },
    };
    const save = (rest: Pick<HistoryNotesInput, 'state' | 'failure' | 'body'>) => d.port.saveNotes({ ...base, ...rest });
    if (!service) {
      await save({ state: 'failed', failure: NO_NOTES_SERVICE, body: null });
      return;
    }
    let result;
    try {
      result = await writeNotes({ sentences, speakerLabel: notesSpeakerLabel(sentences), language, chat: service.chat, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) {
        await save({ state: 'cancelled', failure: null, body: null });
        return;
      }
      throw error;
    }
    if (result.ok) await save({ state: 'complete', body: result.body });
    else if ('failure' in result) await save({ state: 'failed', failure: result.failure, body: null });
  }

  return {
    start(recordId, language) {
      if (runs.has(recordId)) return;
      const controller = new AbortController();
      runs.set(recordId, controller);
      notify();
      void run(recordId, language, controller)
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
