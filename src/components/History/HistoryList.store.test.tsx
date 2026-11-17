// The History list on the app's own history store (not a fake): the counts beside the navigation follow what the
// store really keeps, and a search finds what it really holds.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { createVirtualClock, type VirtualClock } from '../../lib/contract/clock';
import { createHistoryPageStore } from '../../lib/history/historyPageStore';
import { realStorePort, type RealStorePort } from '../../lib/history/testing/realStorePort';
import '../../locales';
import { HistoryPageContext } from './historyContext';
import HistoryList from './HistoryList';

const A = 'run-0001-aaaa';
const START = new Date(2026, 0, 15, 9, 0, 0).getTime();

let real: RealStorePort;
let store: ReturnType<typeof createHistoryPageStore>;
let clock: VirtualClock;
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const nav = (name: RegExp) => screen.getByRole('button', { name });
const countOf = (name: RegExp) => nav(name).querySelector('small')?.textContent ?? null;

beforeEach(async () => {
  localStorage.clear();
  real = realStorePort();
  real.store.openRecord({ id: A, startedAt: START, mode: 'both', myLanguage: 'en', targetLanguage: 'zh', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
  // A record closed with nothing in it is dropped: this one has a sentence.
  const transcriptId = real.store.createTranscript({ recordId: A, origin: { service: 'soniox', kind: 'live' } });
  real.store.appendSentences({ transcriptId, sentences: [
    { n: 1, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: 0, endMs: 1500, text: 'Hello.', timeKind: 'given' },
  ] });
  real.store.closeRecord({ id: A, endedAt: START + 10_000 });
  real.store.binRecords({ ids: [A] });
  clock = createVirtualClock(0);
  store = createHistoryPageStore(real.port, clock, (e) => `failed: ${(e as Error).message}`);
  render(
    <HistoryPageContext.Provider value={{ store, onClose: () => {} }}>
      <HistoryList hidden={false} />
    </HistoryPageContext.Provider>,
  );
  await act(() => store.getState().load());
  await settle();
});
afterEach(() => { cleanup(); real.dispose(); });

describe('the bin\'s count', () => {
  it('follows the bin when its only record is deleted for good, and the bin says it is empty', async () => {
    expect(countOf(/^Bin/)).toBe('1');
    expect(countOf(/^All records/)).toBe('0');
    fireEvent.click(nav(/^Bin/));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Delete for good' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete for good' })).getByRole('button', { name: 'Delete' }));
    await settle();
    expect(countOf(/^Bin/)).not.toBe('1');
    expect(screen.getByText('The bin is empty.')).toBeInTheDocument();
    expect(await real.port.getRecord(A)).toBeNull();
  });
});

describe('a search', () => {
  /** A closed record with one sentence; it gives the transcript's id. */
  const recordWith = (id: string, startedAt: number, text: string): number => {
    real.store.openRecord({ id, startedAt, mode: 'both', myLanguage: 'en', targetLanguage: 'zh', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
    const transcriptId = real.store.createTranscript({ recordId: id, origin: { service: 'soniox', kind: 'live' } }) as number;
    real.store.appendSentences({ transcriptId, sentences: [
      { n: 1, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: 0, endMs: 1500, text, timeKind: 'given' },
    ] });
    return transcriptId;
  };
  const search = async (query: string) => {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search History' }), { target: { value: query } });
    await act(async () => { clock.advance(250); });
    await settle();
  };
  const result = (title: RegExp) => screen.getByText(title).closest('[data-record]') as HTMLElement;

  // A word in the title, in a sentence, in a translation and in the notes is each found, says where,
  // counts its matches, and opens the record there; a word in none says so.
  it('finds a word wherever the store keeps it, says where, and opens the record there', async () => {
    recordWith('run-0002-bbbb', START + 1000, 'Nothing to see.');
    real.store.renameRecord({ id: 'run-0002-bbbb', title: 'Kiwi planning' });
    recordWith('run-0003-cccc', START + 2000, 'We ship the mango release on Friday.');
    real.store.renameRecord({ id: 'run-0003-cccc', title: 'Release talk' });
    recordWith('run-0004-dddd', START + 3000, '开会');
    real.store.putLeg({ recordId: 'run-0004-dddd', leg: 'speaker', languages: { source: 'zh', target: 'en' } });
    real.store.putSegments({ recordId: 'run-0004-dddd', leg: 'speaker', segments: [
      { id: 'run-0004-dddd:speaker:2', ref: 1, side: 'translation', text: 'The papaya budget is tight', final: true, openedAt: 5, marks: [] },
    ] });
    real.store.renameRecord({ id: 'run-0004-dddd', title: 'Budget' });
    const notesOf = recordWith('run-0005-eeee', START + 4000, 'Short call.');
    real.store.saveNotes({ recordId: 'run-0005-eeee', transcriptId: notesOf, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', state: 'complete',
      body: { title: 'Weekly', overview: { text: 'The plum supplier first.', format: 'plain' }, topics: [], points: [], names: [] } });
    real.store.renameRecord({ id: 'run-0005-eeee', title: 'Supplier call' });
    for (const id of ['run-0002-bbbb', 'run-0003-cccc', 'run-0004-dddd', 'run-0005-eeee']) real.store.closeRecord({ id, endedAt: START + 60_000 });

    await search('kiwi');
    expect(within(result(/^Kiwi planning$/)).getByText('Found in the title')).toBeInTheDocument();
    expect(within(result(/^Kiwi planning$/)).getByText('1 match')).toBeInTheDocument();

    await search('mango');
    expect(within(result(/^Release talk$/)).getByText(/mango release/)).toBeInTheDocument();
    fireEvent.click(within(result(/^Release talk$/)).getByRole('button'));
    await settle();
    expect(store.getState().open?.record.id).toBe('run-0003-cccc');
    expect(store.getState().open?.at).toEqual(expect.objectContaining({ kind: 'sentence', n: 1 }));
    act(() => store.getState().closeRecord());
    await settle();

    await search('papaya');
    expect(within(result(/^Budget$/)).getByText(/papaya budget/)).toBeInTheDocument();

    await search('plum');
    expect(within(result(/^Supplier call$/)).getByText('Found in the notes')).toBeInTheDocument();
    fireEvent.click(within(result(/^Supplier call$/)).getByRole('button'));
    await settle();
    expect(store.getState().open?.at).toEqual(expect.objectContaining({ kind: 'notes' }));
    act(() => store.getState().closeRecord());
    await settle();

    await search('durian');
    expect(screen.getByText('Nothing found for “durian”.')).toBeInTheDocument();
  });
});
