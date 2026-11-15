// The History list: records, search, the bin and the space used.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { createVirtualClock, type VirtualClock } from '../../lib/contract/clock';
import type { HistoryPort } from '../../lib/history/port';
import type { HistoryRecord, HistoryRecordRow, HistorySearchResult, HistoryStatus } from '../../lib/history/types';
import { createHistoryPageStore } from '../../lib/history/historyPageStore';

const env = vi.hoisted(() => ({ port: null as unknown }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true,
}));
vi.mock('../../lib/history/port', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/history/port')>()),
  historyPort: () => env.port,
}));

import '../../locales';
import { HistoryPageContext } from './historyContext';
import { dayLabel, formatDateTime, formatTime } from './format';
import HistoryList from './HistoryList';
import HistoryPage from './HistoryPage';

const A = 'run-000a-aaaa';
const B = 'run-000b-bbbb';
const C = 'run-000c-cccc';
const D = 'run-000d-dddd';
const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 12, 1, 0, 0);
const rowOf = (id: string, over: Partial<HistoryRecordRow> = {}): HistoryRecordRow => ({
  id, startedAt: START, endedAt: START + 60_000, state: 'closed', mode: 'both', myLanguage: 'zh', targetLanguage: 'en', title: null,
  titleByUser: false, binnedAt: null, sentences: 0, hasRecording: false, notesVersions: 0, audioBytes: 0, ...over,
});
const recordOf = (id: string): HistoryRecord => ({
  ...rowOf(id), services: { provider: 'soniox', models: {} }, appVersion: '1', textBytes: 0, legs: [], tracks: [], notes: [],
  transcripts: [{ id: 1, origin: { service: 'soniox', kind: 'live' }, textKind: 'original', createdAt: 0, sentences: 1 }],
});

type Fake = HistoryPort & { calls: [string, unknown][] };
let status: HistoryStatus;
let records: HistoryRecordRow[];
let bin: HistoryRecordRow[];
let found: HistorySearchResult[];
function fakePort(): Fake {
  const calls: [string, unknown][] = [];
  const answer = <T,>(name: string, value: () => T) => async (arg?: unknown) => { calls.push([name, arg]); return value(); };
  return {
    calls,
    status: answer('status', () => status),
    listRecords: answer('listRecords', () => records),
    usage: answer('usage', () => ({ dbBytes: 1_572_864, audioBytes: 0, records: records.length, binned: bin.length })),
    search: answer('search', () => found),
    binRecords: answer('binRecords', () => ({ changed: 1 })),
    restoreRecords: answer('restoreRecords', () => ({ changed: 1 })),
    purgeRecords: answer('purgeRecords', () => ({ purged: [], failed: [] })),
    renameRecord: answer('renameRecord', () => undefined),
    getRecord: answer('getRecord', () => recordOf(A)),
    getLegs: answer('getLegs', () => []),
    getSentences: answer('getSentences', () => []),
    getSpeakers: answer('getSpeakers', () => []),
  } as unknown as Fake;
}
// The bin's rows answer a listing of the bin.
const binAware = (p: Fake) => {
  p.listRecords = async (arg) => { p.calls.push(['listRecords', arg]); return arg?.binned ? bin : records; };
};

let port: Fake;
let clock: VirtualClock;
let store: ReturnType<typeof createHistoryPageStore>;
let onClose: ReturnType<typeof vi.fn<() => void>>;
const calls = (name: string) => port.calls.filter((c) => c[0] === name).map((c) => c[1]);
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

async function renderList() {
  render(
    <HistoryPageContext.Provider value={{ store, onClose }}>
      <HistoryList />
    </HistoryPageContext.Provider>,
  );
  await act(() => store.getState().load());
}
const rowWith = (text: string) => screen.getByText(text).closest('[data-record]') as HTMLElement;

beforeEach(() => {
  status = { available: true, dir: '/home/u/History' };
  records = [
    rowOf(A, { title: 'Weekly sync', endedAt: START + 3_723_000, sentences: 3, notesVersions: 1 }),
    rowOf(B, { state: 'open', endedAt: null }),
  ];
  bin = [];
  found = [];
  port = fakePort();
  binAware(port);
  env.port = port;
  clock = createVirtualClock(0);
  store = createHistoryPageStore(port, clock, () => 'That did not work.');
  onClose = vi.fn<() => void>();
});
afterEach(() => cleanup());

describe('the History list', () => {
  it('lists records by day with their title, time, length, languages and what they have in words', async () => {
    records.push(rowOf(D, { title: 'Earlier call', startedAt: START - 2 * DAY, endedAt: START - 2 * DAY + 65_000, sentences: 1 }));
    await renderList();
    expect(await screen.findByText('Weekly sync')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      dayLabel(START, Date.now(), 'en'), dayLabel(START - 2 * DAY, Date.now(), 'en'),
    ]);
    const row = rowWith('Weekly sync');
    expect(within(row).getByText(formatTime(START, 'en'))).toBeInTheDocument();
    expect(within(row).getByText('1:02:03')).toBeInTheDocument();
    expect(within(row).getByText(/Chinese.*→.*English/)).toBeInTheDocument();
    expect(within(row).getByText('Transcript')).toBeInTheDocument();
    expect(within(row).getByText('Notes')).toBeInTheDocument();
    expect(within(row).queryByText('Recording')).toBeNull();
    expect(screen.getByText('1.5 MB in 3 records')).toBeInTheDocument();
  });

  it('names an untitled record by its start time under its day, and shows "In progress" for one being written', async () => {
    await renderList();
    const row = rowWith('In progress');
    const when = `Session at ${formatTime(START, 'en')}`;
    expect(within(row).getByText(when)).toBeInTheDocument();
    expect(within(row).queryByText(formatTime(START, 'en'))).toBeNull();
    expect(within(row).queryByText(formatDateTime(START, 'en'))).toBeNull();
    fireEvent.click(within(row).getByText(when));
    await settle();
    expect(calls('getRecord')).toEqual([B]);
  });

  it('shows checkboxes only after Select, and moves the selected records to the bin', async () => {
    await renderList();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(within(rowWith('In progress')).queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByText('Weekly sync'));
    expect(calls('getRecord')).toEqual([]);
    expect(within(rowWith('Weekly sync')).getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move to bin' }));
    await settle();
    expect(port.calls).toContainEqual(['binRecords', { ids: [A] }]);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('leaves Select without a change', async () => {
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByText('Weekly sync'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(store.getState().selected.size).toBe(0);
    expect(calls('binRecords')).toEqual([]);
  });

  it('asks before deleting for good and does nothing on Cancel', async () => {
    bin = [rowOf(C, { title: 'Old call', binnedAt: START + 1 })];
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: /^Bin/ }));
    await settle();
    expect(screen.getByRole('heading', { level: 2, name: 'Bin' })).toBeInTheDocument();
    expect(screen.getByText('Records in the bin are deleted for good after 30 days.')).toBeInTheDocument();
    const row = rowWith('Old call');
    // The bin has no day headings: its rows carry their date.
    expect(within(row).getByText(formatDateTime(START, 'en'))).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Delete for good' }));
    expect(screen.getByText('Delete 1 record for good? Its transcript and recording cannot be brought back.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(calls('purgeRecords')).toEqual([]);
    expect(screen.queryByText(/for good\?/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Empty bin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await settle();
    expect(calls('purgeRecords')).toEqual([{ ids: [C] }]);
  });

  it('keeps the navigation while searching, opens a result at its first hit, and the bin ends the search', async () => {
    found = [{ recordId: A, title: 'Weekly sync', startedAt: START, hits: 2, first: { kind: 'sentence', transcriptId: 1, n: 1, text: '我们先看一下这个视频的进度' } }];
    await renderList();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search History' }), { target: { value: '视频' } });
    await act(async () => { clock.advance(250); });
    await settle();
    expect(calls('search')).toEqual([{ query: '视频' }]);
    expect(screen.getByRole('heading', { level: 2, name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All records/ })).toBeInTheDocument();
    expect(screen.getByText('我们先看一下这个视频的进度')).toBeInTheDocument();
    expect(screen.getByText('2 matches')).toBeInTheDocument();
    expect(screen.queryByText('In progress')).toBeNull();
    fireEvent.click(screen.getByText('我们先看一下这个视频的进度'));
    await settle();
    expect(store.getState().open?.at).toEqual({ kind: 'sentence', transcriptId: 1, n: 1 });

    act(() => store.getState().closeRecord());
    fireEvent.click(screen.getByRole('button', { name: /^Bin/ }));
    await settle();
    expect(screen.getByRole('searchbox', { name: 'Search History' })).toHaveValue('');
  });

  it('says so when nothing is found', async () => {
    await renderList();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search History' }), { target: { value: 'zzz' } });
    await act(async () => { clock.advance(250); });
    await settle();
    expect(screen.getByText('Nothing found for “zzz”.')).toBeInTheDocument();
  });

  it('says why when History cannot be opened', async () => {
    status = { available: false, reason: 'newer', dir: '' };
    await renderList();
    expect(screen.getByText('This History was written by a newer version of Sokuji. Update Sokuji to open it.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the session' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape in the search box clears it and stays on the page', async () => {
    render(<HistoryPage onClose={onClose} />);
    await settle();
    const box = screen.getByRole('searchbox', { name: 'Search History' });
    fireEvent.change(box, { target: { value: 'abc' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('going back from a record finds the list as it was left', async () => {
    render(<HistoryPage onClose={onClose} />);
    await settle();
    const list = screen.getByTestId('history-list');
    const scroller = list.querySelector('.settings-page__content') as HTMLElement;
    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);
    fireEvent.click(screen.getByText('Weekly sync'));
    await settle();
    expect(screen.getByRole('button', { name: 'Back to the list' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(screen.getByTestId('history-list')).toBe(list);
    expect(scroller.scrollTop).toBe(120);
    expect(list).toBeVisible();
  });

  it('shows older records on request', async () => {
    await renderList();
    expect(screen.queryByRole('button', { name: 'Show older records' })).toBeNull();
    act(() => store.setState({ more: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Show older records' }));
    await settle();
    expect(calls('listRecords').some((a) => (a as { before?: number }).before === START)).toBe(true);
  });

  it('an Escape or Enter that ends an input method composition is left to it', async () => {
    render(<HistoryPage onClose={onClose} />);
    await settle();
    const box = screen.getByRole('searchbox', { name: 'Search History' });
    fireEvent.change(box, { target: { value: 'しん' } });
    fireEvent.keyDown(box, { key: 'Escape', isComposing: true });
    expect(box).toHaveValue('しん');
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens the folder', async () => {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as { electron: unknown }).electron = { invoke };
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(invoke).toHaveBeenCalledWith('open-directory', '/home/u/History');
    delete (window as unknown as { electron?: unknown }).electron;
  });
});
