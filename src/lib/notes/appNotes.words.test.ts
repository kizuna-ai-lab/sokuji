// The notes read the word list's spellings as they stand when a version is written, a name added from
// the notes included.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const captured = vi.hoisted(() => ({ deps: null as null | { names?(): readonly unknown[] } }));
vi.mock('./runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runner')>()),
  createNotesRunner: (deps: { names?(): readonly unknown[] }) => { captured.deps = deps; return {} as never; },
}));
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

import { appNotesRunner } from './appNotes';
import { addWord, useWordList } from '../words/list';
import { notesNames } from './prompts';

beforeEach(() => {
  useWordList.setState({ entries: [{ written: 'Kizuna AI', heardAs: 'kizuna eye' }], background: '', loaded: true });
});

describe('notes reuse the word list spellings', () => {
  it("gives the notes runner the word list's spellings, read again for each version", async () => {
    appNotesRunner();
    const names = () => notesNames(captured.deps!.names!() as never);
    expect(names()).toEqual([{ written: 'Kizuna AI', heard_as: 'kizuna eye' }]);
    // A name added from "names to check" (historyPageStore.addName does this) is in the next version's names.
    await addWord({ written: 'Sokuji', heardAs: 'Soku G' });
    expect(names()).toEqual([{ written: 'Kizuna AI', heard_as: 'kizuna eye' }, { written: 'Sokuji', heard_as: 'Soku G' }]);
  });
});
