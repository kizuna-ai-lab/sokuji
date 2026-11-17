// The record page on the app's own history store (not a fake): what a user changes is what comes back when the record
// is opened again: a rename changes that one speaker and a move that one sentence; the other
// speakers of the same side and the other sentences stay as they were.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { createVirtualClock } from '../../lib/contract/clock';
import { createHistoryPageStore } from '../../lib/history/historyPageStore';
import { realStorePort, type RealStorePort } from '../../lib/history/testing/realStorePort';
import '../../locales';
import { HistoryPageContext } from './historyContext';
import RecordPage from './RecordPage';

const A = 'run-0001-aaaa';
const START = new Date(2026, 0, 15, 9, 0, 0).getTime();
const sentence = (n: number, side: 'mine' | 'other', text: string, speaker = '1') => ({
  n, side, sideCertain: true, track: side === 'mine' ? 'microphone' : 'other', speaker,
  startMs: n * 2000, endMs: n * 2000 + 1500, text, timeKind: 'given',
});

let real: RealStorePort;
let store: ReturnType<typeof createHistoryPageStore>;
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const drawer = () => screen.getByRole('complementary', { name: 'Side panel' });
const row = (n: number) => document.querySelector(`[data-n="${n}"]`)?.closest('.record-row') as HTMLElement | null;
const speakerOf = (n: number) => row(n)?.querySelector('.record-row__speaker')?.textContent;

beforeEach(() => {
  localStorage.clear();
  real = realStorePort();
  const s = real.store;
  s.openRecord({ id: A, startedAt: START, mode: 'both', myLanguage: 'en', targetLanguage: 'zh', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
  const transcriptId = s.createTranscript({ recordId: A, origin: { service: 'soniox', kind: 'live' } });
  s.appendSentences({ transcriptId, sentences: [
    sentence(1, 'mine', 'Can you ship by Wednesday?'),
    sentence(2, 'other', 'Yes, by Wednesday.'),
    sentence(3, 'other', 'And the docs too.'),
    sentence(4, 'other', 'I will check the docs.', '2'),
  ] });
  s.closeRecord({ id: A, endedAt: START + 10_000 });
  store = createHistoryPageStore(real.port, createVirtualClock(0), (e) => `failed: ${(e as Error).message}`);
  render(
    <HistoryPageContext.Provider value={{ store, onClose: () => {} }}>
      <RecordPage />
    </HistoryPageContext.Provider>,
  );
});
afterEach(() => { cleanup(); real.dispose(); });

describe('a record\'s speakers, kept by the store', () => {
  it('keeps a renamed speaker and a sentence given to a new speaker when the record is opened again', async () => {
    await act(() => store.getState().openRecord(A));
    await settle();
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Rename Other 1' }));
    const field = within(drawer()).getByRole('textbox', { name: 'Name' });
    fireEvent.change(field, { target: { value: 'Mina' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    fireEvent.click(within(row(3)!).getByRole('button', { name: 'Change speaker' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New speaker' }));
    await settle();

    // Back to the list, then the same record again: everything is read from the store anew.
    act(() => store.getState().closeRecord());
    await settle();
    expect(row(1)).toBeFalsy();
    await act(() => store.getState().openRecord(A));
    await settle();

    expect(within(drawer()).getByRole('button', { name: 'Rename Mina' })).toBeInTheDocument();
    // Sentence 2 stays Mina's; sentence 3 is the new speaker's; the other side's second speaker and the user's own
    // side keep their own labels.
    expect(speakerOf(1)).toBe('Me');
    expect(speakerOf(2)).toBe('Mina');
    expect(speakerOf(3)).not.toBe('Mina');
    expect(speakerOf(4)).not.toBe('Mina');
    expect(speakerOf(3)).not.toBe(speakerOf(4));
    const speakers = await real.port.getSpeakers({ transcriptId: store.getState().open!.record.transcripts[0].id });
    expect(speakers).toHaveLength(4);
    expect(speakers).toEqual(expect.arrayContaining([
      { side: 'mine', speaker: '1', name: null, sentences: 1 },
      { side: 'other', speaker: '1', name: 'Mina', sentences: 1 },
      { side: 'other', speaker: '2', name: null, sentences: 1 },
      expect.objectContaining({ side: 'other', name: null, sentences: 1 }),
    ]));
  });
});
