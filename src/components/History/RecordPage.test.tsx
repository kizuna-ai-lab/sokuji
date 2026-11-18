// A record's page: its transcript, title, speakers and export.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { createVirtualClock } from '../../lib/contract/clock';
import type { Leg, Segment } from '../../lib/conversation/types';
import type { HistoryPort } from '../../lib/history/port';
import type { HistoryRecord, HistorySentence, HistorySpeaker } from '../../lib/history/types';
import { createHistoryPageStore, type HitTarget } from '../../lib/history/historyPageStore';
import { conversationExporter, exportWords } from '../../lib/export/exporter';
import { FULL_SCOPE } from '../../lib/export/transcript';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';

const env = vi.hoisted(() => ({ port: null as unknown }));
vi.mock('../../lib/history/port', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/history/port')>()),
  historyPort: () => env.port,
}));
vi.mock('../../utils/conversationExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/conversationExport')>()),
  downloadFile: vi.fn(),
  copyToClipboard: vi.fn(async () => true),
}));

import i18n from '../../locales';
import { copyToClipboard, downloadFile } from '../../utils/conversationExport';
import { HistoryPageContext } from './historyContext';
import RecordPage from './RecordPage';
import HistoryPage from './HistoryPage';

const A = 'run-000a-aaaa';
const START = new Date(2026, 0, 15, 9, 0, 0).getTime();
const when = () => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(START);
const seg = (id: string, side: 'source' | 'translation', text: string, origin: string): Segment => ({
  id, ref: Number(id.split(':').pop()), side, text, final: true, openedAt: START, marks: [], origin, speech: [],
});
const legs: Leg[] = [
  {
    leg: 'speaker', session: A, languages: { source: 'en', target: 'zh' }, notices: [],
    segments: [seg(`${A}:speaker:1`, 'source', 'Yes, we can.', 'u1'), seg(`${A}:speaker:2`, 'translation', '可以，我们能做到。', 'u1')],
  },
  {
    leg: 'participant', session: A, languages: { source: 'zh', target: 'en' }, notices: [],
    segments: [
      seg(`${A}:participant:1`, 'source', '下周三之前能交货吗？', 'u1'), seg(`${A}:participant:2`, 'translation', 'Can you ship by Wednesday?', 'u1'),
      seg(`${A}:participant:3`, 'source', '还有一个问题。', 'u2'), seg(`${A}:participant:4`, 'translation', 'One more question.', 'u2'),
    ],
  },
];
const sentence = (n: number, segmentId: string, text: string, over: Partial<HistorySentence> = {}): HistorySentence => ({
  n, segmentId, side: 'other', sideCertain: true, track: 'other', speaker: '1.1', speakerByUser: null, speakerName: null,
  startMs: n * 1000, endMs: n * 1000 + 900, text, language: null, timeKind: 'given', translation: null, ...over,
});
const sentences: HistorySentence[] = [
  sentence(1, `${A}:participant:1`, '下周三之前能交货吗？', { timeKind: 'estimated' }),
  sentence(2, `${A}:participant:3`, '还有一个问题。'),
  sentence(5, `${A}:speaker:1`, 'Yes, we can.', { side: 'mine', speaker: '1', track: 'microphone' }),
];
const speakers: HistorySpeaker[] = [
  { side: 'mine', speaker: '1', name: null, sentences: 1 },
  { side: 'other', speaker: '1.1', name: null, sentences: 2 },
];
let record: HistoryRecord;

type Fake = HistoryPort & { calls: [string, unknown][] };
function fakePort(): Fake {
  const calls: [string, unknown][] = [];
  const answer = <T,>(name: string, value: () => T) => async (arg?: unknown) => { calls.push([name, arg]); return value(); };
  return {
    calls,
    status: answer('status', () => ({ available: true, dir: '/h' })),
    listRecords: answer('listRecords', () => [record]),
    usage: answer('usage', () => ({ dbBytes: 0, audioBytes: 0, records: 1, binned: 0 })),
    search: answer('search', () => []),
    binRecords: answer('binRecords', () => ({ changed: 1 })),
    renameRecord: answer('renameRecord', () => undefined),
    getRecord: answer('getRecord', () => record),
    getLegs: answer('getLegs', () => legs),
    getSentences: answer('getSentences', () => sentences),
    getSpeakers: answer('getSpeakers', () => speakers),
    renameSpeaker: answer('renameSpeaker', () => undefined),
    reassignSentence: answer('reassignSentence', () => undefined),
    dropTrack: answer('dropTrack', () => undefined),
    saveTrack: answer('saveTrack', () => ({ saved: true })),
  } as unknown as Fake;
}

let port: Fake;
let store: ReturnType<typeof createHistoryPageStore>;
const calls = (name: string) => port.calls.filter((c) => c[0] === name).map((c) => c[1]);
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const scrollIntoView = vi.fn();

async function renderRecord(at: HitTarget | null = null) {
  render(
    <HistoryPageContext.Provider value={{ store, onClose: () => {} }}>
      <RecordPage />
    </HistoryPageContext.Provider>,
  );
  await act(() => store.getState().openRecord(A, at));
}

beforeEach(() => {
  record = {
    id: A, startedAt: START, endedAt: START + 65_000, state: 'closed', mode: 'both', myLanguage: 'en', targetLanguage: 'zh', title: null,
    titleByUser: false, binnedAt: null, sentences: 3, hasRecording: false, notesVersions: 0, notesState: null, notesComplete: false, audioBytes: 0,
    services: { provider: 'soniox', models: {} }, appVersion: '1.2.3', textBytes: 2048, legs: [], tracks: [], notes: [],
    transcripts: [{ id: 1, origin: { service: 'soniox', kind: 'live' }, textKind: 'original', createdAt: START, sentences: 3 }],
  };
  localStorage.clear();
  port = fakePort();
  env.port = port;
  store = createHistoryPageStore(port, createVirtualClock(0), () => 'That did not work.');
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.mocked(downloadFile).mockClear();
  vi.mocked(copyToClipboard).mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const openExport = () => fireEvent.click(screen.getByRole('button', { name: 'Export' }));

/** A page 1200 px wide, as the ResizeObserver the record page watches it with reports: the edit panel is a column there
 *  (owner, 2026-11-18); on a narrow page it is a tab. */
function widePage(width = 1200) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly cb: () => void) {}
    observe() { this.cb(); }
    unobserve() {}
    disconnect() {}
  });
}

describe('a record', () => {
  it('shows the transcript with speakers, times and translations', async () => {
    await renderRecord();
    expect(screen.getByRole('button', { name: 'Back to the list' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(when());
    expect(await screen.findByText('Can you ship by Wednesday?')).toBeInTheDocument();
    expect(screen.getByText('下周三之前能交货吗？')).toBeInTheDocument();
    expect(screen.getByText('~0:01')).toBeInTheDocument();
    expect(screen.getByText('0:05')).toBeInTheDocument();
    expect(screen.getAllByText('Other').length).toBeGreaterThan(0);
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('Length 1:05')).toBeInTheDocument();
  });

  it('renames the record in place and goes back to the automatic title on blank', async () => {
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: when() }));
    const field = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(field, { target: { value: 'Weekly sync' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(calls('renameRecord')).toEqual([{ id: A, title: 'Weekly sync' }]);

    fireEvent.click(screen.getByRole('button', { name: when() }));
    const again = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(again, { target: { value: '   ' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    await settle();
    expect(calls('renameRecord')).toEqual([{ id: A, title: 'Weekly sync' }, { id: A, title: '' }]);
  });

  it('Escape in the title field cancels the edit and stays on the record', async () => {
    render(<HistoryPage onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText(/^Session at /));
    expect(await screen.findByText('Can you ship by Wednesday?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: when() }));
    const field = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(field, { target: { value: 'Something' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.getByText('Can you ship by Wednesday?')).toBeInTheDocument();
    expect(calls('renameRecord')).toEqual([]);
  });

  it('Escape or a click outside closes a sentence menu and stays on the record', async () => {
    render(<HistoryPage onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText(/^Session at /));
    expect(await screen.findByText('Can you ship by Wednesday?')).toBeInTheDocument();
    const second = document.querySelector('[data-n="2"]') as HTMLElement;
    const button = within(second).getByRole('button', { name: 'Change speaker' });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Change speaker' })).toBeNull();
    expect(screen.getByText('Can you ship by Wednesday?')).toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Change speaker' })).toBeNull();
  });

  // Owner, 2026-11-17: an edit says how it ends, without a keyboard: Save and Cancel on its row (the keys in their
  // tooltips), and a click elsewhere saves.
  it('saves the title with its Save button, drops it with its Cancel button, and saves it on a click elsewhere', async () => {
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: when() }));
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('title', 'Save (Enter)');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('title', 'Cancel (Esc)');
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(calls('renameRecord')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: when() }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    expect(calls('renameRecord')).toEqual([{ id: A, title: 'Weekly' }]);
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();

    fireEvent.click(screen.getByRole('heading', { level: 2 }).querySelector('button')!);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Weekly sync' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Title' }), { relatedTarget: document.body });
    await settle();
    expect(calls('renameRecord')).toEqual([{ id: A, title: 'Weekly' }, { id: A, title: 'Weekly sync' }]);
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
  });

  it('keeps the title field and what was typed when saving fails', async () => {
    port.renameRecord = (async () => { throw new Error('disk full'); }) as never;
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: when() }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Weekly');
    expect(store.getState().error).toBe('That did not work.');
  });

  // Review of the edit fields: what is typed while a save runs is kept; Escape from the field's buttons is the edit's.
  it('keeps what is typed into the title while an earlier save of it is still running', async () => {
    let finish: () => void = () => {};
    port.renameRecord = (async () => { await new Promise<void>((resolve) => { finish = resolve; }); }) as never;
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: when() }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Weekly sync' } });
    await act(async () => { finish(); });
    await settle();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Weekly sync');
  });

  it('Escape on the field\'s Save or Cancel button cancels the edit and stays on the record', async () => {
    render(<HistoryPage onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText(/^Session at /));
    expect(await screen.findByText('Can you ship by Wednesday?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: when() }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Something' } });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Save' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.getByText('Can you ship by Wednesday?')).toBeInTheDocument();
    expect(calls('renameRecord')).toEqual([]);
  });

  it('an Enter or Escape that ends an input method composition does not save or cancel the title', async () => {
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: when() }));
    const field = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(field, { target: { value: '週次' } });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Escape', keyCode: 229 });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('週次');
    expect(calls('renameRecord')).toEqual([]);
  });

  // Owner, 2026-11-17: the speakers are not a column of their own any more; a button over the transcript opens them.
  // Owner, 2026-11-17: a side panel over the transcript, for the speakers now and more later; the transcript keeps its
  // width under it. It is shown and hidden from a switch in the page's toolbar (B-40 redone: no handle on its edge).
  const drawer = () => screen.queryByRole('complementary', { name: 'Edit' });
  const toggle = () => screen.getByRole('button', { name: 'Edit' });

  it('keeps the speakers in a side panel shown and hidden from a switch in the toolbar, and gives their column to the transcript', async () => {
    widePage();
    await renderRecord();
    expect(document.querySelector('.record-page__side')).toBeNull();
    expect(document.querySelector('.record-page__transcript-head')).toBeNull();
    expect(document.querySelector('.record-side__handle')).toBeNull();
    // Open the first time (owner, 2026-11-17: what it holds is seen at once); closed here to start from closed.
    fireEvent.click(toggle());
    expect(drawer()).toBeNull();
    expect(toggle()).toHaveAttribute('title', 'Show the edit panel');
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(toggle().querySelector('.lucide-panel-right')).not.toBeNull();
    // The icon and its word, as the title bar's buttons have while there is room (owner, 2026-11-17).
    expect(toggle().textContent).toBe('Edit');
    expect(toggle().closest('.record-page__actions')).not.toBeNull();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('title', 'Hide the edit panel');
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    // The speakers are its first part, under their own heading.
    const speakers = within(drawer()!).getByRole('region', { name: 'Speakers' });
    expect(within(speakers).getByRole('heading', { name: 'Speakers' })).toBeInTheDocument();
    expect(within(speakers).getByText('2 sentences')).toBeInTheDocument();
    // One handle opens and closes it: no close button of its own.
    expect(within(drawer()!).queryByRole('button', { name: /close/i })).toBeNull();
    fireEvent.click(toggle());
    expect(drawer()).toBeNull();
  });

  it('is open the first time, and remembers the last choice for the next record', async () => {
    widePage();
    await renderRecord();
    expect(drawer()).not.toBeNull();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle());
    expect(drawer()).toBeNull();
    cleanup();
    await renderRecord();
    expect(drawer()).toBeNull();
    fireEvent.click(toggle());
    cleanup();
    await renderRecord();
    expect(drawer()).not.toBeNull();
  });

  it('closes the drawer on Escape, but drops only the name while one is typed, and stays on the record', async () => {
    widePage();
    render(<HistoryPage onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText(/^Session at /));
    expect(await screen.findByText('Can you ship by Wednesday?')).toBeInTheDocument();
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(drawer()).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await settle();
    expect(drawer()).toBeNull();
    // The record is still open.
    expect(screen.getByText('Can you ship by Wednesday?')).toBeInTheDocument();
  });

  it('Escape in the title field cancels the title edit and leaves the side panel open', async () => {
    widePage();
    await renderRecord();
    expect(drawer()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: when() }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    // Heard by the panel first: while the title is being typed, the Escape is the title's.
    expect(drawer()).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(drawer()).not.toBeNull();
  });

  it('keeps a name that failed to save, and offers no other rename while one is saving', async () => {
    widePage();
    let fail: () => void = () => {};
    port.renameSpeaker = (async () => { await new Promise<void>((_, reject) => { fail = () => reject(new Error('disk full')); }); }) as never;
    await renderRecord();
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Save' }));
    await settle();
    // Another speaker cannot be renamed while this name is saving.
    for (const b of within(drawer()!).queryAllByRole('button', { name: /^Rename / })) expect(b).toBeDisabled();
    await act(async () => { fail(); });
    await settle();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mina');
  });

  it('stays open, the name kept, when the name being typed fails to save as the panel is closed', async () => {
    widePage();
    port.renameSpeaker = (async () => { throw new Error('disk full'); }) as never;
    await renderRecord();
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    fireEvent.click(toggle());
    await settle();
    expect(drawer()).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mina');
  });

  // Review: a save already under way is waited for, not taken as done.
  it('stays open when closed while a started name save is still running, and that save then fails', async () => {
    widePage();
    let fail: () => void = () => {};
    port.renameSpeaker = (async () => { await new Promise<void>((_, reject) => { fail = () => reject(new Error('disk full')); }); }) as never;
    await renderRecord();
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Save' }));
    fireEvent.click(toggle());
    await settle();
    await act(async () => { fail(); });
    await settle();
    expect(drawer()).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mina');
  });

  // Review: a newer name typed while a save ran is saved too before the panel closes, not left hidden.
  it('saves the newer name as well before closing, when more was typed while a save ran', async () => {
    widePage();
    let finish: () => void = () => {};
    const names: string[] = [];
    port.renameSpeaker = (async (arg: { name: string }) => {
      names.push(arg.name);
      if (names.length === 1) await new Promise<void>((resolve) => { finish = resolve; });
    }) as never;
    await renderRecord();
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Save' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina Lee' } });
    fireEvent.click(toggle());
    await settle();
    await act(async () => { finish(); });
    await settle();
    expect(names).toEqual(['Mina', 'Mina Lee']);
    expect(drawer()).toBeNull();
  });

  // Review: Escape is the open sentence menu's first; the panel closes only on an Escape nothing else took.
  it('Escape in an open sentence menu closes the menu and leaves the side panel open', async () => {
    widePage();
    await renderRecord();
    expect(drawer()).not.toBeNull();
    const second = document.querySelector('[data-n="2"]') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: 'Change speaker' }));
    const item = screen.getByRole('menuitem', { name: 'New speaker' });
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Change speaker' })).toBeNull();
    expect(drawer()).not.toBeNull();
  });

  it('saves a name being typed when the drawer is closed', async () => {
    widePage();
    await renderRecord();
    fireEvent.click(within(drawer()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    fireEvent.click(toggle());
    await settle();
    expect(calls('renameSpeaker')).toEqual([{ transcriptId: 1, side: 'other', speaker: '1.1', name: 'Mina' }]);
  });

  it('renames a speaker and moves one sentence to a new speaker', async () => {
    widePage();
    await renderRecord();
    const panel = drawer()!;
    expect(within(panel).getByText('2 sentences')).toBeInTheDocument();
    expect(within(panel).getByText('1 sentence')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Rename Other' }));
    const field = within(panel).getByRole('textbox', { name: 'Name' });
    fireEvent.change(field, { target: { value: 'Mina' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(calls('renameSpeaker')).toEqual([{ transcriptId: 1, side: 'other', speaker: '1.1', name: 'Mina' }]);

    // A click elsewhere saves a name too; the Save button carries its shortcut in its tooltip. (The fake port keeps the
    // stored name as it was, so the speaker is still "Other" here.)
    fireEvent.click(within(panel).getByRole('button', { name: 'Rename Other' }));
    const again = within(panel).getByRole('textbox', { name: 'Name' });
    expect(within(panel).getByRole('button', { name: 'Save' })).toHaveAttribute('title', 'Save (Enter)');
    fireEvent.change(again, { target: { value: 'Mina S' } });
    fireEvent.blur(again, { relatedTarget: document.body });
    await settle();
    expect(calls('renameSpeaker')).toEqual([
      { transcriptId: 1, side: 'other', speaker: '1.1', name: 'Mina' },
      { transcriptId: 1, side: 'other', speaker: '1.1', name: 'Mina S' },
    ]);

    const second = document.querySelector('[data-n="2"]') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: 'Change speaker' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New speaker' }));
    await settle();
    expect(calls('reassignSentence')).toEqual([{ transcriptId: 1, n: 2, speaker: 'u1' }]);
  });

  it("exports the same text as today's exporter on the stored conversation: started when the record did, exported now", async () => {
    await renderRecord();
    const exportedAt = START + 3_600_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(exportedAt);
    const expectedTxt = conversationExporter({
      entries: createProjector().project(legs, DEFAULT_PROJECTION), legs, info: { provider: 'soniox', models: {}, startedAt: START },
      words: exportWords(i18n.t.bind(i18n) as never), appVersion: '1.2.3', now: () => exportedAt,
    }).text(FULL_SCOPE, true);
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save the conversation (.txt)' }));
    now.mockRestore();
    expect(downloadFile).toHaveBeenCalledWith(expectedTxt, 'sokuji-conversation-20260115-090000.txt', 'text/plain;charset=utf-8');

    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy the conversation' }));
    await settle();
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('Can you ship by Wednesday?'));
  });

  it('saves subtitles from the transcript rows', async () => {
    await renderRecord();
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save subtitles (.srt)' }));
    const [content, name] = vi.mocked(downloadFile).mock.calls[0];
    expect(content.startsWith('1\n00:00:01,000 --> ')).toBe(true);
    expect(name).toBe('sokuji-conversation-20260115-090000.srt');
  });

  it('a transcript cut from the translation shows each sentence once, in the page and in subtitles of the translation', async () => {
    record = { ...record, transcripts: [{ ...record.transcripts[0], textKind: 'translation' }] };
    const cut: HistorySentence[] = [sentence(1, `${A}:participant:2`, 'Can you ship by Wednesday?')];
    port.getSentences = async () => cut;
    await renderRecord();
    expect(screen.getAllByText('Can you ship by Wednesday?')).toHaveLength(1);
    openExport();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Other — Src' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save subtitles (.vtt)' }));
    const [content] = vi.mocked(downloadFile).mock.calls[0];
    expect(content.split('Can you ship by Wednesday?')).toHaveLength(2);
  });

  it('opens at a search hit and marks it', async () => {
    await renderRecord({ kind: 'sentence', transcriptId: 1, n: 2 });
    const hit = document.querySelector('[data-n="2"]') as HTMLElement;
    expect(hit).toHaveClass('is-hit');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts[0]).toBe(hit);
  });

  it('plays from a sentence and highlights the row being played', async () => {
    record = { ...record, tracks: [
      { source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 1000, offsetMs: 0, goneAt: null },
      { source: 'participant', file: 'participant.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 1000, offsetMs: 0, goneAt: null },
    ] };
    await renderRecord();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    const second = document.querySelector('[data-segment="run-000a-aaaa:participant:3"]') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: 'Play from here' }));
    expect(second).toHaveClass('is-playing');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByText('0:02 / 1:00')).toBeInTheDocument();
  });

  it('a sentence beyond the end of its track has no play button', async () => {
    record = { ...record, tracks: [{ source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 3000, bytes: 100, offsetMs: 0, goneAt: null }] };
    await renderRecord();
    const mine = document.querySelector('[data-segment="run-000a-aaaa:speaker:1"]') as HTMLElement;
    expect(within(mine).queryByRole('button', { name: 'Play from here' })).toBeNull();
    const other = document.querySelector('[data-segment="run-000a-aaaa:participant:1"]') as HTMLElement;
    expect(within(other).queryByRole('button', { name: 'Play from here' })).toBeNull();
  });

  it('in a face-to-face record the other person\'s sentences play from the microphone track', async () => {
    record = { ...record, mode: 'face-to-face', tracks: [{ source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 100, offsetMs: 0, goneAt: null }] };
    await renderRecord();
    const other = document.querySelector('[data-segment="run-000a-aaaa:participant:1"]') as HTMLElement;
    expect(within(other).getByRole('button', { name: 'Play from here' })).toBeInTheDocument();
  });

  it('shows no player when the recording was deleted', async () => {
    record = { ...record, tracks: [{ source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 3000, bytes: 100, offsetMs: 0, goneAt: 5 }] };
    await renderRecord();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play from here' })).toBeNull();
  });

  it('deletes only the recording after asking, and nothing on Cancel', async () => {
    record = { ...record, tracks: [
      { source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 1000, offsetMs: 0, goneAt: null },
      { source: 'participant', file: 'participant.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 1000, offsetMs: 0, goneAt: null },
    ] };
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete the recording' }));
    expect(screen.getByText('Delete this record’s recording? Its transcript and notes stay. The recording cannot be brought back.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls('dropTrack')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete the recording' }));
    const files = Array.from(document.querySelectorAll('audio'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // The player lets go of the files before they are deleted (Windows refuses to delete an open file).
    expect(files.every((el) => !el.getAttribute('src'))).toBe(true);
    await settle();
    expect(calls('dropTrack')).toEqual([{ recordId: A, source: 'speaker' }, { recordId: A, source: 'participant' }]);
  });

  it('cannot delete a recording that is not there', async () => {
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Delete the recording' })).toBeDisabled();
  });

  it('saves the recording through the system dialog, one file per track, each titled with its side', async () => {
    record = { ...record, tracks: [
      { source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 3, offsetMs: 0, goneAt: null },
      { source: 'participant', file: 'participant.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 3, offsetMs: 0, goneAt: null },
    ] };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await renderRecord();
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save the recording (.opus)' }));
    await settle();
    expect(calls('saveTrack')).toEqual([
      { recordId: A, source: 'speaker', title: 'Save your side’s recording', defaultName: 'sokuji-recording-20260115-090000-me.opus' },
      { recordId: A, source: 'participant', title: 'Save the other side’s recording', defaultName: 'sokuji-recording-20260115-090000-other.opus' },
    ]);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('names a lone track the recording, and says so when it cannot be saved', async () => {
    record = { ...record, tracks: [{ source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 3, offsetMs: 0, goneAt: null }] };
    port.saveTrack = vi.fn(async () => { throw new Error('disk full'); });
    await renderRecord();
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save the recording (.opus)' }));
    await settle();
    expect(vi.mocked(port.saveTrack).mock.calls.map((c) => c[0].title)).toEqual(['Save the recording']);
    expect(screen.getByText('The recording could not be saved.')).toBeTruthy();
  });

  // Review: on a narrow page a search hit in the notes opened on the transcript tab, the hit out of sight.
  it('opens on the notes tab for a search hit in the notes', async () => {
    record = { ...record, notesVersions: 1, notesState: 'complete', notes: [{ id: 7, transcriptId: 1, language: 'en', createdAt: START, state: 'complete' }] };
    port.getNotes = (async () => ({
      id: 7, recordId: A, transcriptId: 1, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', createdAt: START,
      state: 'complete', failure: null, requestIds: [],
      body: { title: 'Shipping', overview: { text: 'When it ships.', format: 'plain' }, topics: [], points: [], names: [] },
    })) as never;
    await renderRecord({ kind: 'notes', notesId: 7 });
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the notes in their tab; a point takes the transcript to its sentence and plays from it', async () => {
    record = { ...record, notesVersions: 1, notesState: 'complete', tracks: [
      { source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 3, offsetMs: 0, goneAt: null },
    ], notes: [{ id: 7, transcriptId: 1, language: 'en', createdAt: START, state: 'complete' }] };
    port.getNotes = (async () => ({
      id: 7, recordId: A, transcriptId: 1, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', createdAt: START,
      state: 'complete', failure: null, requestIds: [],
      body: { title: 'Shipping', overview: { text: 'When it ships.', format: 'plain' }, topics: [{ title: 'Dates', summary: '', first: 1 }],
        points: [{ topic: 0, text: 'Ships by Wednesday', sentences: [2], kinds: ['decision'] }], names: [] },
    })) as never;
    await renderRecord();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByRole('heading', { name: 'Shipping' })).toBeInTheDocument();
    scrollIntoView.mockClear();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Ships by Wednesday' }));
    await settle();
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.querySelector('[data-n="2"]')).toHaveClass('is-hit');
    expect(play).toHaveBeenCalled();
  });

  // Playback starts at the point's sentence, not at the start of the recording.
  it("plays a point's sentence from its own start", async () => {
    record = { ...record, notesVersions: 1, notesState: 'complete', tracks: [
      { source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 3, offsetMs: 0, goneAt: null },
      { source: 'participant', file: 'participant.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 3, offsetMs: 0, goneAt: null },
    ], notes: [{ id: 7, transcriptId: 1, language: 'en', createdAt: START, state: 'complete' }] };
    port.getNotes = (async () => ({
      id: 7, recordId: A, transcriptId: 1, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', createdAt: START,
      state: 'complete', failure: null, requestIds: [],
      body: { title: 'Shipping', overview: { text: '', format: 'plain' }, topics: [{ title: 'Dates', summary: '', first: 1 }],
        points: [{ topic: 0, text: 'One more question', sentences: [2], kinds: [] }], names: [] },
    })) as never;
    await renderRecord();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'One more question' }));
    await settle();
    expect(play).toHaveBeenCalled();
    expect(document.querySelector(`[data-segment="${A}:participant:3"]`)).toHaveClass('is-playing');
    expect(screen.getByText('0:02 / 1:00')).toBeInTheDocument();
  });

  // Whether a record is too short for notes is worked out from its transcript: under a minute, no way to
  // write them and the reason said; a minute or more, the way to write them.
  it('offers no notes for a transcript under a minute, and offers them for one of a minute or more', async () => {
    // The first sentence starts at 1 s: the last one ending at `endMs` makes the transcript span `endMs - 1000`.
    const notesTabEndingAt = async (endMs: number) => {
      cleanup();
      const spanned = sentences.map((x) => (x.n === 5 ? { ...x, startMs: endMs - 900, endMs } : x));
      port.getSentences = (async () => spanned) as never;
      store = createHistoryPageStore(port, createVirtualClock(0), () => 'That did not work.');
      await renderRecord();
      fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    };
    const tooLittle = 'There is too little in this record to write notes from.';
    await notesTabEndingAt(5_900);
    expect(screen.getByText(tooLittle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write notes' })).toBeNull();
    await notesTabEndingAt(60_999);
    expect(screen.getByText(tooLittle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write notes' })).toBeNull();
    await notesTabEndingAt(61_000);
    expect(screen.queryByText(tooLittle)).toBeNull();
    expect(screen.getByRole('button', { name: 'Write notes' })).toBeInTheDocument();
  });

  // The text file holds what Copy puts on the clipboard, and both hold the same points as the Markdown.
  it('saves the notes as text with what Copy gives, and the same points as the Markdown', async () => {
    record = { ...record, notesVersions: 1, notesState: 'complete', notes: [{ id: 7, transcriptId: 1, language: 'en', createdAt: START, state: 'complete' }] };
    port.getNotes = (async () => ({
      id: 7, recordId: A, transcriptId: 1, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', createdAt: START,
      state: 'complete', failure: null, requestIds: [],
      body: { title: 'Shipping', overview: { text: 'When it ships.', format: 'plain' }, topics: [{ title: 'Dates', summary: 'The date.', first: 1 }],
        points: [
          { topic: 0, text: 'Ships by Wednesday', sentences: [2], kinds: ['decision'] },
          { topic: 0, text: 'Send the tracking number', sentences: [5], kinds: ['todo'], owner: 'My side', due: 'Tuesday' },
        ], names: [] },
    })) as never;
    await renderRecord();
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save notes (.txt)' }));
    const [txt, txtName, txtType] = vi.mocked(downloadFile).mock.calls[0] as [string, string, string];
    expect([txtName, txtType]).toEqual(['sokuji-notes-20260115-090000.txt', 'text/plain;charset=utf-8']);
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy notes' }));
    await settle();
    expect(copyToClipboard).toHaveBeenLastCalledWith(txt);
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save notes (.md)' }));
    const md = vi.mocked(downloadFile).mock.calls[1][0] as string;
    for (const part of ['Shipping', 'When it ships.', 'Dates', 'Ships by Wednesday', 'Send the tracking number', 'Your side', 'Tuesday']) {
      expect(txt).toContain(part);
      expect(md).toContain(part);
    }
  });

  it('exports the shown notes as Markdown or text, or copies them; not without notes', async () => {
    await renderRecord();
    openExport();
    expect(screen.getByRole('menuitem', { name: 'Save notes (.md)' })).toBeDisabled();
    cleanup();
    record = { ...record, notesVersions: 1, notesState: 'complete', notes: [{ id: 7, transcriptId: 1, language: 'en', createdAt: START, state: 'complete' }] };
    port.getNotes = (async () => ({
      id: 7, recordId: A, transcriptId: 1, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', createdAt: START,
      state: 'complete', failure: null, requestIds: [],
      body: { title: 'Shipping', overview: { text: '', format: 'plain' }, topics: [{ title: 'Dates', summary: '', first: 1 }],
        points: [{ topic: 0, text: 'Ships by Wednesday', sentences: [2], kinds: ['decision'] }], names: [] },
    })) as never;
    await renderRecord();
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save notes (.md)' }));
    expect(vi.mocked(downloadFile).mock.calls[0]).toEqual([expect.stringContaining('- Ships by Wednesday — Decision'), 'sokuji-notes-20260115-090000.md', 'text/markdown;charset=utf-8']);
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy notes' }));
    await settle();
    expect(copyToClipboard).toHaveBeenLastCalledWith(expect.stringContaining('  - Ships by Wednesday (Decision)'));
  });

  it('a record still being written can be refreshed and not binned', async () => {
    record = { ...record, state: 'open', endedAt: null };
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Move to bin' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(calls('getRecord')).toEqual([A, A]);
  });

  it('a finished record moves to the bin from its page', async () => {
    await renderRecord();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move to bin' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to bin' }));
    await settle();
    expect(calls('binRecords')).toEqual([{ ids: [A] }]);
    expect(store.getState().open).toBeNull();
  });

  it('offers a new version of the notes in the record\'s own two languages only', async () => {
    record = { ...record, notesVersions: 1, notesState: 'complete', notesComplete: true, notes: [{ id: 7, transcriptId: 1, language: 'en', createdAt: START, state: 'complete' }] };
    port.getNotes = (async () => ({
      id: 7, recordId: A, transcriptId: 1, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', createdAt: START,
      state: 'complete', failure: null, requestIds: [],
      body: { title: 'Shipping', overview: { text: '', format: 'plain' }, topics: [], points: [], names: [] },
    })) as never;
    await renderRecord();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    const choices = within(screen.getByRole('combobox', { name: 'Language of the notes' })).getAllByRole('option').map((o) => o.textContent);
    expect(choices).toEqual(['English', 'Chinese']);
  });
});

describe('a record transcribed again', () => {
  it('offers to transcribe it again from More when it keeps a recording, asking first', async () => {
    record.hasRecording = true;
    record.tracks = [{ source: 'participant', file: 'participant.opus', format: 'ogg-opus', durationMs: 60_000, bytes: 10, offsetMs: 0, goneAt: null }];
    const jobs = {
      service: async () => ({ service: 'soniox' as const, apiKey: 'k', region: 'us' as const, languages: ['en', 'zh'] }),
      sessionRunning: () => false, importFile: vi.fn(), transcribe: vi.fn(() => new Promise<never>(() => {})), notesAfterImport: vi.fn(),
    };
    store = createHistoryPageStore(port, createVirtualClock(0), () => 'That did not work.', null, jobs as never);
    store.getState().follow();
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Transcribe again' }));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Transcribe again' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Transcribe again' })).toBeNull();
  });

  // Owner, 2026-11-18: the version a record is shown in sits at the end of its date-and-length line, not as a bar of its
  // own over the columns (that bar pushed the notes, the transcript and the side panel down, each by a strip).
  it('offers its transcript versions on the line with its date and length, not as a bar over the columns', async () => {
    record.transcripts.push({ id: 2, origin: { service: 'soniox', kind: 'file' }, textKind: 'original', createdAt: START + 1000, sentences: 3 });
    await renderRecord();
    const chooser = screen.getByLabelText('Transcript version').closest('label')!;
    expect(chooser.parentElement?.classList.contains('history-row__meta')).toBe(true);
    expect(chooser.closest('.record-page__heading')).not.toBeNull();
    expect(document.querySelectorAll('.history-file__versions')).toHaveLength(1);
  });

  it('opens a search hit in the older transcript it was found in, and marks it there', async () => {
    record.transcripts.push({ id: 2, origin: { service: 'soniox', kind: 'file' }, textKind: 'original', createdAt: START + 1000, sentences: 3 });
    await renderRecord({ kind: 'sentence', transcriptId: 1, n: 2 });
    expect(store.getState().open?.transcriptId).toBe(1);
    expect(screen.getByLabelText('Transcript version')).toBeTruthy();
    expect(document.querySelector('[data-n="2"]')?.className ?? '').toMatch(/is-hit|hit/);
  });
});

// Owner, 2026-11-17 (B-31): on a wide page the notes column can be dragged wider or narrower and hidden; both are kept.
describe('the notes column on a wide page', () => {
  /** A page this wide, as the ResizeObserver the record page watches it with reports. */
  function widePage(width = 1200) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly cb: () => void) {}
      observe() { this.cb(); }
      unobserve() {}
      disconnect() {}
    });
  }
  const columns = () => document.querySelector('.record-page__columns') as HTMLElement;
  const notes = () => document.querySelector('.record-page__notes') as HTMLElement;
  const drag = (from: number, to: number, done = true) => {
    const sep = within(columns()).getByRole('separator');
    act(() => { sep.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, clientX: from, button: 0 }), { pointerType: 'mouse' })); });
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: to })); });
    if (done) act(() => { window.dispatchEvent(new MouseEvent('pointerup', { clientX: to })); });
  };
  afterEach(() => { vi.unstubAllGlobals(); });
  // The side panel has a column of its own on a wide page too (below); closed here, these are about the notes alone.
  beforeEach(() => { localStorage.setItem('history.sidePanelClosed', '1'); });

  const notesSwitch = () => screen.getByRole('button', { name: 'Notes' });

  // Review: a search hit in the notes shows the notes even when they were closed; the closed choice is kept for
  // ordinary openings.
  it('shows the closed notes for a search hit in them, and keeps them closed for the next record', async () => {
    widePage();
    localStorage.setItem('history.notesClosed', '1');
    record = { ...record, notesVersions: 1, notesState: 'complete', notes: [{ id: 7, transcriptId: 1, language: 'en', createdAt: START, state: 'complete' }] };
    port.getNotes = (async () => ({
      id: 7, recordId: A, transcriptId: 1, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', createdAt: START,
      state: 'complete', failure: null, requestIds: [],
      body: { title: 'Shipping', overview: { text: 'When it ships.', format: 'plain' }, topics: [], points: [], names: [] },
    })) as never;
    await renderRecord({ kind: 'notes', notesId: 7 });
    expect(notes()).not.toHaveAttribute('hidden');
    expect(notesSwitch()).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('history.notesClosed')).toBe('1');
  });

  it('has a divider to drag, and the switch that shows and hides the notes sits in the toolbar with the side panel\'s', async () => {
    widePage();
    await renderRecord();
    expect(within(columns()).getByRole('separator')).toBeInTheDocument();
    expect(document.querySelector('.record-page__notes-handle')).toBeNull();
    expect(notesSwitch()).toHaveAttribute('title', 'Hide the notes');
    expect(notesSwitch()).toHaveAttribute('aria-pressed', 'true');
    expect(notesSwitch().querySelector('.lucide-panel-left')).not.toBeNull();
    // The two switches together, before Export.
    const group = notesSwitch().closest('.record-page__panels')!;
    expect(within(group as HTMLElement).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    const actions = [...document.querySelectorAll('.record-page__actions > *')];
    const exportAt = actions.findIndex((el) => el.textContent?.includes('Export'));
    expect(actions.indexOf(group)).toBeLessThan(exportAt);
    expect(columns().style.gridTemplateColumns).toBe('380px 1px minmax(0, 1fr)');
  });

  it('follows the divider while it is dragged, and opens the next record at the width it was left at', async () => {
    widePage();
    await renderRecord();
    drag(380, 500, false);
    expect(columns().style.gridTemplateColumns).toBe('500px 1px minmax(0, 1fr)');
    act(() => { window.dispatchEvent(new MouseEvent('pointerup', { clientX: 520 })); });
    expect(localStorage.getItem('history.notesWidth')).toBe('520');
    cleanup();
    widePage();
    await renderRecord();
    expect(columns().style.gridTemplateColumns).toBe('520px 1px minmax(0, 1fr)');
  });

  it('leaves the transcript 400px however far the divider goes, and the notes 240px', async () => {
    widePage(1000);
    await renderRecord();
    drag(380, 1900);
    expect(columns().style.gridTemplateColumns).toBe('599px 1px minmax(0, 1fr)');
    drag(599, 0);
    expect(columns().style.gridTemplateColumns).toBe('240px 1px minmax(0, 1fr)');
  });

  it('hiding the notes gives the transcript the whole width, with nothing left in their place, and holds for the next record', async () => {
    widePage();
    await renderRecord();
    fireEvent.click(notesSwitch());
    expect(notes()).toHaveAttribute('hidden');
    expect(within(columns()).queryByRole('separator')).toBeNull();
    expect(columns().style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(notesSwitch()).toHaveAttribute('title', 'Show the notes');
    expect(notesSwitch()).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('history.notesClosed')).toBe('1');
    cleanup();
    widePage();
    await renderRecord();
    expect(notes()).toHaveAttribute('hidden');
    fireEvent.click(notesSwitch());
    expect(notes()).not.toHaveAttribute('hidden');
    expect(notesSwitch()).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('history.notesClosed')).toBeNull();
  });

  it('drops the switches\' words, keeping their icons, when the heading would have too little room beside them', async () => {
    // A wide page whose actions, with their words, would leave the heading less than its 240px.
    widePage(1000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('record-page__actions') ? 900 : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    await renderRecord();
    const group = notesSwitch().closest('.record-page__panels')!;
    expect(group).toHaveAttribute('data-compact');
    expect(notesSwitch()).toHaveAccessibleName('Notes');
    expect(notesSwitch()).toHaveAttribute('title', 'Hide the notes');
  });

  // Review: hidden, the words are not measured; what they would add is kept from when they were last shown, so actions
  // that change while the words are hidden (a button gone) are judged with the words' own width, not a stale total.
  it('brings the switches\' words back when the actions shrink while the words are hidden', async () => {
    const page = 1000;
    let others = 700;
    const observers: (() => void)[] = [];
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => page);
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly cb: () => void) { observers.push(cb); }
      observe() { this.cb(); }
      unobserve() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const compact = document.querySelector('.record-page__panels')?.hasAttribute('data-compact');
      const width = this.classList.contains('record-page__actions') ? others + (compact ? 0 : 100) : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    await renderRecord();
    const group = () => notesSwitch().closest('.record-page__panels')!;
    // 1000 - (700 + 100) leaves the heading 200px: the words go.
    expect(group()).toHaveAttribute('data-compact');
    // A button goes: 1000 - (600 + 100) leaves 300px, room for the words again.
    others = 600;
    act(() => { for (const cb of observers) cb(); });
    expect(group()).not.toHaveAttribute('data-compact');
  });

  // Owner, 2026-11-18: the edit panel is the third tab there, so neither panel has a switch in the toolbar.
  it('on a narrow page keeps the tabs (the edit panel the third), with no divider and no switches', async () => {
    await renderRecord();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Notes', 'Transcript', 'Edit']);
    expect(within(columns()).queryByRole('separator')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

// Owner, 2026-11-18: the side panel is not a drawer over the transcript any more but a column of the page, as the notes
// are: it is to hold tools that edit the transcript, which a drawer would cover. No sliding in; a divider sets its width,
// kept for the next record.
describe("the side panel's column", () => {
  let width = 1200;
  let watchers: (() => void)[] = [];
  function page(px: number) {
    width = px;
    watchers = [];
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly cb: () => void) { watchers.push(cb); }
      observe() { this.cb(); }
      unobserve() {}
      disconnect() {}
    });
  }
  /** The window resized: the page is `px` wide now. */
  const resize = (px: number) => { width = px; act(() => { for (const cb of watchers) cb(); }); };
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const columns = () => document.querySelector('.record-page__columns') as HTMLElement;
  const side = () => screen.queryByRole('complementary', { name: 'Edit' });
  const sideDivider = () => within(columns()).queryByRole('separator', { name: 'Resize the edit panel' });
  const transcript = () => document.querySelector('.record-page__transcript') as HTMLElement;
  const leftColumn = () => document.querySelector('.record-page__notes-col') as HTMLElement;
  const notesPart = () => document.querySelector('.record-page__notes') as HTMLElement;

  it('stands at the right of the transcript, in the page\'s columns, with a divider of its own beside the notes\'', async () => {
    page(1200);
    await renderRecord();
    expect(side()).not.toBeNull();
    expect(side()!.parentElement).toBe(columns());
    expect(transcript().compareDocumentPosition(side()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(columns()).getByRole('separator', { name: 'Resize the notes' })).toBeInTheDocument();
    expect(sideDivider()).toBeInTheDocument();
    expect(columns().style.gridTemplateColumns).toBe('380px 1px minmax(0, 1fr) 1px 300px');
  });

  it('follows its divider, and opens the next record at the width it was left at', async () => {
    page(1200);
    await renderRecord();
    const sep = sideDivider()!;
    act(() => { sep.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, clientX: 900, button: 0 }), { pointerType: 'mouse' })); });
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 820 })); });
    act(() => { window.dispatchEvent(new MouseEvent('pointerup', { clientX: 820 })); });
    expect(columns().style.gridTemplateColumns).toBe('380px 1px minmax(0, 1fr) 1px 380px');
    expect(localStorage.getItem('history.sideWidth')).toBe('380');
    cleanup();
    page(1200);
    await renderRecord();
    expect(columns().style.gridTemplateColumns).toBe('380px 1px minmax(0, 1fr) 1px 380px');
  });

  it('closed, gives its room back to the transcript and leaves nothing in its place', async () => {
    page(1200);
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(side()).toBeNull();
    expect(sideDivider()).toBeNull();
    expect(columns().style.gridTemplateColumns).toBe('380px 1px minmax(0, 1fr)');
  });

  // Owner, 2026-11-19: with room for two columns and not three, the transcript keeps its column and has the one panel
  // switched on beside it, where that panel stands with room for three.
  it('with room for two columns, stands beside the transcript when the notes are hidden', async () => {
    localStorage.setItem('history.notesClosed', '1');
    page(760);
    await renderRecord();
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(side()!.parentElement).toBe(columns());
    expect(sideDivider()).toBeInTheDocument();
    expect(columns().style.gridTemplateColumns).toBe('minmax(0, 1fr) 1px 300px');
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('with room for two columns, leaves the notes beside the transcript when it is hidden', async () => {
    localStorage.setItem('history.sidePanelClosed', '1');
    page(760);
    await renderRecord();
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(side()).toBeNull();
    expect(notesPart()).not.toHaveAttribute('hidden');
    expect(columns().style.gridTemplateColumns).toBe('359px 1px minmax(0, 1fr)');
  });

  // Owner, 2026-11-19: both switched on with room for two columns only: the notes and the edit panel share the left
  // column, a tab each; the transcript keeps its own.
  it('with both switched on and room for two columns, shares the left column with the notes, a tab each', async () => {
    page(760);
    await renderRecord();
    expect(columns().style.gridTemplateColumns).toBe('359px 1px minmax(0, 1fr)');
    expect(sideDivider()).toBeNull();
    expect(within(columns()).getByRole('separator', { name: 'Resize the notes' })).toBeInTheDocument();
    const tabs = within(leftColumn()).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Notes', 'Edit']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(notesPart()).not.toHaveAttribute('hidden');
    expect(side()).toBeNull();
    expect(transcript()).not.toHaveAttribute('hidden');
    // Both switches stay on: each panel is still shown, in its tab.
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(leftColumn()).getByRole('tab', { name: 'Edit' }));
    await settle();
    expect(within(leftColumn()).getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
    expect(side()!.parentElement).toBe(leftColumn());
    expect(notesPart()).toHaveAttribute('hidden');
    expect(transcript()).not.toHaveAttribute('hidden');
    // The edit panel switched off: the notes have the column to themselves again, without tabs.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await settle();
    expect(side()).toBeNull();
    expect(within(leftColumn()).queryAllByRole('tab')).toEqual([]);
    expect(notesPart()).not.toHaveAttribute('hidden');
  });

  it('shows in the shared column the panel just switched on', async () => {
    localStorage.setItem('history.sidePanelClosed', '1');
    page(760);
    await renderRecord();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await settle();
    expect(within(leftColumn()).getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
    expect(side()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    await settle();
    expect(within(leftColumn()).getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    expect(side()).toBeNull();
  });

  it('saves a name being typed before the shared column turns to the notes', async () => {
    page(760);
    await renderRecord();
    fireEvent.click(within(leftColumn()).getByRole('tab', { name: 'Edit' }));
    await settle();
    fireEvent.click(within(side()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    fireEvent.click(within(leftColumn()).getByRole('tab', { name: 'Notes' }));
    await settle();
    expect(calls('renameSpeaker')).toEqual([{ transcriptId: 1, side: 'other', speaker: '1.1', name: 'Mina' }]);
    expect(side()).toBeNull();
  });

  // Review: the edit panel moves between the shared column and its own as the window is resized; a name being typed
  // in it is the page's, and stays typed.
  it('keeps a name being typed when the window is resized from two columns to three and back', async () => {
    page(760);
    await renderRecord();
    fireEvent.click(within(leftColumn()).getByRole('tab', { name: 'Edit' }));
    await settle();
    fireEvent.click(within(side()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    resize(1200);
    await settle();
    expect(side()!.parentElement).toBe(columns());
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mina');
    resize(760);
    await settle();
    expect(side()!.parentElement).toBe(leftColumn());
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mina');
  });

  // Review: a name being typed keeps the edit panel in view whatever layout the window changes to; it is leaving the
  // panel that saves the name, and the window resized is not leaving it.
  it('keeps the edit panel shown, a name typed in it, when the window narrows to two columns with the notes on', async () => {
    page(1200);
    await renderRecord();
    fireEvent.click(within(side()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    resize(760);
    await settle();
    expect(side()!.parentElement).toBe(leftColumn());
    expect(within(leftColumn()).getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mina');
    expect(calls('renameSpeaker')).toEqual([]);
    // Leaving it for the notes saves the name, then shows them.
    fireEvent.click(within(leftColumn()).getByRole('tab', { name: 'Notes' }));
    await settle();
    expect(calls('renameSpeaker')).toEqual([{ transcriptId: 1, side: 'other', speaker: '1.1', name: 'Mina' }]);
    expect(side()).toBeNull();
    expect(notesPart()).not.toHaveAttribute('hidden');
  });

  it('keeps the edit panel shown, a name typed in it, when the window narrows to tabs', async () => {
    page(1200);
    await renderRecord();
    fireEvent.click(within(side()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    resize(600);
    await settle();
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
    expect(side()).not.toBeNull();
    expect(transcript()).toHaveAttribute('hidden');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mina');
  });

  it('keeps the edit panel shown, a name typed in its tab, when the window widens with the panel switched off', async () => {
    localStorage.setItem('history.sidePanelClosed', '1');
    page(600);
    await renderRecord();
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    await settle();
    fireEvent.click(within(side()!).getByRole('button', { name: 'Rename Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mina' } });
    resize(1200);
    await settle();
    expect(side()!.parentElement).toBe(columns());
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mina');
    // Hidden from its switch: the name is saved first, and the panel stays hidden as it was chosen.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await settle();
    expect(calls('renameSpeaker')).toEqual([{ transcriptId: 1, side: 'other', speaker: '1.1', name: 'Mina' }]);
    expect(side()).toBeNull();
    expect(localStorage.getItem('history.sidePanelClosed')).toBe('1');
  });

  // Owner, 2026-11-18/19: on a page too narrow even for two columns, the three are tabs, as the notes and the transcript
  // were: Notes | Transcript | Edit, each taking the page; the toolbar has no switch for them there.
  it('on a narrow page is a third tab, "Edit", taking the page when chosen', async () => {
    page(600);
    await renderRecord();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Notes', 'Transcript', 'Edit']);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(side()).toBeNull();
    expect(columns().style.gridTemplateColumns).toBe('');
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
    expect(side()!.parentElement).toBe(columns());
    expect(transcript()).toHaveAttribute('hidden');
    expect(sideDivider()).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
    expect(side()).toBeNull();
    expect(transcript()).not.toHaveAttribute('hidden');
    // Escape on the Edit tab leaves it for the transcript, as it hides the column on a wide page.
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {});
    expect(side()).toBeNull();
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
  });
});
