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
  titleByUser: false, binnedAt: null, sentences: 0, hasRecording: false, notesVersions: 0, notesState: null, notesComplete: false, audioBytes: 0, ...over,
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
let usageBytes: number;
function fakePort(): Fake {
  const calls: [string, unknown][] = [];
  const answer = <T,>(name: string, value: () => T) => async (arg?: unknown) => { calls.push([name, arg]); return value(); };
  return {
    calls,
    status: answer('status', () => status),
    listRecords: answer('listRecords', () => records),
    usage: answer('usage', () => ({ dbBytes: usageBytes, audioBytes: 0, records: records.length, binned: bin.length })),
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
    rowOf(A, { title: 'Weekly sync', endedAt: START + 3_723_000, sentences: 3, notesVersions: 1, notesState: 'complete', notesComplete: true }),
    rowOf(B, { state: 'open', endedAt: null }),
  ];
  bin = [];
  found = [];
  usageBytes = 1_572_864;
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
    // Said as a length: under a day heading the start time is a clock time too.
    expect(within(row).getByText('Length 1:02:03')).toBeInTheDocument();
    // The rows' session translated both sides: each way (languageDirection.ts).
    expect([...row.querySelectorAll('.language-pair-text bdi')].map((b) => b.textContent)).toEqual(['Chinese', 'English']);
    expect(within(row).getByRole('img', { name: 'translated both ways' })).toHaveClass('lucide-arrow-right-left');
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

  it('says when notes are being written for a record, and when its newest notes failed', async () => {
    records = [
      rowOf(A, { title: 'Weekly sync', sentences: 3, notesVersions: 2, notesState: 'failed', notesComplete: false }),
      rowOf(C, { title: 'Demo', sentences: 3, notesVersions: 1, notesState: 'complete', notesComplete: true }),
      rowOf(D, { title: 'Retro', sentences: 3, notesVersions: 2, notesState: 'cancelled', notesComplete: true }),
    ];
    await renderList();
    expect(within(rowWith('Weekly sync')).getByText('Notes failed')).toBeInTheDocument();
    expect(within(rowWith('Weekly sync')).queryByText('Notes')).toBeNull();
    expect(within(rowWith('Retro')).getByText('Notes')).toBeInTheDocument();
    act(() => { store.setState({ notesRunning: [C] }); });
    expect(within(rowWith('Demo')).getByText('Writing notes')).toBeInTheDocument();
    expect(within(rowWith('Demo')).queryByText('Notes')).toBeNull();
  });

  it('shows checkboxes only after Select, and moves the selected records to the bin', async () => {
    await renderList();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select records' }));
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

  it('names what Select selects, with a quiet button right after the heading', async () => {
    await renderList();
    const button = screen.getByRole('button', { name: 'Select records' });
    expect(button.className).toContain('history-button--quiet');
    const head = screen.getByRole('heading', { level: 2, name: 'All records' }).parentElement!;
    expect(head.contains(button)).toBe(true);
    expect(head.firstElementChild).toBe(screen.getByRole('heading', { level: 2, name: 'All records' }));
    expect(head.children[1]).toBe(button);
  });

  it('in Select, turns the heading row into the actions: the heading stays, the count beside it, no bar at the bottom', async () => {
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Select records' }));
    const heading = screen.getByRole('heading', { level: 2, name: 'All records' });
    const head = heading.parentElement!;
    expect(within(head).getByText('0 selected')).toBeInTheDocument();
    expect(within(head).getByRole('button', { name: 'Move to bin' })).toBeDisabled();
    expect(within(head).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Select records' })).toBeNull();
    expect(document.querySelector('.history-select-bar')).toBeNull();
    expect(head.closest('header')!.className).toContain('is-selecting');
    fireEvent.click(screen.getByText('Weekly sync'));
    expect(within(head).getByText('1 selected')).toBeInTheDocument();
    expect(within(head).getByRole('button', { name: 'Move to bin' })).toBeEnabled();
    fireEvent.click(within(head).getByRole('button', { name: 'Cancel' }));
    expect(head.closest('header')!.className).not.toContain('is-selecting');
  });

  it('leaves Select without a change', async () => {
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Select records' }));
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

  // Owner, 2026-11-17: with the only record in the bin, "All records" said 1 and showed none. The store's `records`
  // counts every stored record, the binned ones too; "All records" lists those not in the bin.
  it('counts under "All records" only what it lists: the records not in the bin', async () => {
    bin = [rowOf(A, { binnedAt: START })];
    records = [];
    port.usage = async () => ({ dbBytes: usageBytes, audioBytes: 0, records: 1, binned: 1 });
    await renderList();
    expect(screen.getByRole('button', { name: /^All records/ })).toHaveTextContent(/^All records0$/);
    expect(screen.getByRole('button', { name: /^Bin/ })).toHaveTextContent(/^Bin1$/);
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

  it("shows the recording's size in its tag", async () => {
    records = [rowOf(A, { title: 'Weekly sync', endedAt: START + 60_000, hasRecording: true, audioBytes: 1_572_864 })];
    await renderList();
    expect(within(rowWith('Weekly sync')).getByText('Recording · 1.5 MB')).toBeInTheDocument();
  });

  it('says once, when History passes 1 GiB, how to make room', async () => {
    localStorage.removeItem('history.spaceNoticeDismissed');
    usageBytes = 1_200 * 1024 * 1024;
    await renderList();
    expect(screen.getByText(/^History now takes 1\.2 GB\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/^History now takes/)).toBeNull();
    cleanup();
    await renderList();
    expect(screen.queryByText(/^History now takes/)).toBeNull();
    localStorage.removeItem('history.spaceNoticeDismissed');
  });

  it('says nothing about space below 1 GiB', async () => {
    localStorage.removeItem('history.spaceNoticeDismissed');
    await renderList();
    expect(screen.queryByText(/^History now takes/)).toBeNull();
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

describe('importing from the list', () => {
  const jobs = () => ({
    service: async () => ({ service: 'soniox' as const, apiKey: 'k', region: 'us' as const, languages: ['en', 'zh'] }),
    sessionRunning: () => false,
    importFile: vi.fn(() => new Promise<never>(() => {})),
    transcribe: vi.fn(() => new Promise<never>(() => {})),
    notesAfterImport: vi.fn(),
  });

  it('offers an import when files can be imported: the chosen file is asked about first', async () => {
    store = createHistoryPageStore(port, clock, () => 'That did not work.', null, jobs() as never);
    store.getState().follow();
    await renderList();
    // A real button a keyboard reaches; it opens the hidden file chooser.
    const button = screen.getByRole('button', { name: 'Import a file' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const chooser = vi.spyOn(input, 'click');
    fireEvent.click(button);
    expect(chooser).toHaveBeenCalled();
    expect(input.accept).toBe('audio/*,video/*');
    const file = new File([new Uint8Array(1)], 'Interview.m4a', { type: 'audio/mp4' });
    fireEvent.change(input, { target: { files: [file] } });
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Import “Interview.m4a”' });
    // The panel takes the focus, and Escape closes the panel, not History.
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Import “Interview.m4a”' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers no import where files cannot be imported', async () => {
    await renderList();
    expect(screen.queryByRole('button', { name: 'Import a file' })).toBeNull();
  });

  it('tags a record that keeps a recording but has no transcript', async () => {
    records = [rowOf(A, { title: 'Imported talk', sentences: 0, hasRecording: true, audioBytes: 2048 })];
    await renderList();
    expect(within(rowWith('Imported talk')).getByText('Not transcribed')).toBeTruthy();
  });
});

describe('HistoryList styles: Select', () => {
  it('keeps the heading row, with its actions, at the top of the list while it scrolls in Select', async () => {
    const { compile } = await import('sass');
    const { resolve } = await import('node:path');
    const css = compile(resolve(__dirname, 'History.scss')).css;
    const rule = css.match(/\.history-content > header\.is-selecting\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*0/);
    expect(rule).toMatch(/background:/);
    // The count and the two buttons stay together; they wrap as a group on a narrow page.
    const actions = css.match(/\.history-content__actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(actions).toMatch(/margin-left:\s*auto/);
    expect(css).not.toMatch(/\.history-select-bar/);
  });
});
