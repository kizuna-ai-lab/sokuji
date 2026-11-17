// src/lib/notes/quitQuestion.ts
//
// The question asked when the app is closed while notes are being written (ruling 7): quit, and the notes are
// stored as cancelled, or stay. The session asks; a dialog at the top of the page shows the question and answers it.
import { create } from 'zustand';

export type QuitAnswer = 'quit' | 'stay';

/** A record whose notes are being written, as the question names it: by its title, or, with none, by when it started. */
export interface QuitRecord {
  title: string | null;
  startedAt: number;
}

interface QuitQuestionState {
  /** The question being asked: the records whose notes are being written. */
  asking: { records: readonly QuitRecord[]; answer(answer: QuitAnswer): void } | null;
}

export const useQuitQuestion = create<QuitQuestionState>(() => ({ asking: null }));

/** Asks, and resolves with the user's answer. */
export function askQuitWhileNotes(records: readonly QuitRecord[]): Promise<QuitAnswer> {
  return new Promise((resolve) => {
    useQuitQuestion.setState({
      asking: {
        records,
        answer(answer) {
          useQuitQuestion.setState({ asking: null });
          resolve(answer);
        },
      },
    });
  });
}
