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
  startMs: n * 1000, endMs: n * 1000 + 900, text, language: null, timeKind: 'given', ...over,
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
    titleByUser: false, binnedAt: null, sentences: 3, hasRecording: false, notesVersions: 0, audioBytes: 0,
    services: { provider: 'soniox', models: {} }, appVersion: '1.2.3', textBytes: 2048, legs: [], tracks: [], notes: [],
    transcripts: [{ id: 1, origin: { service: 'soniox', kind: 'live' }, textKind: 'original', createdAt: START, sentences: 3 }],
  };
  port = fakePort();
  env.port = port;
  store = createHistoryPageStore(port, createVirtualClock(0), () => 'That did not work.');
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  vi.mocked(downloadFile).mockClear();
  vi.mocked(copyToClipboard).mockClear();
});
afterEach(() => cleanup());

const openExport = () => fireEvent.click(screen.getByRole('button', { name: 'Export' }));

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
    expect(screen.getByText('1:05')).toBeInTheDocument();
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

  it('renames a speaker and moves one sentence to a new speaker', async () => {
    await renderRecord();
    const panel = screen.getByRole('region', { name: 'Speakers' });
    expect(within(panel).getByText('2 sentences')).toBeInTheDocument();
    expect(within(panel).getByText('1 sentence')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Rename Other' }));
    const field = within(panel).getByRole('textbox', { name: 'Name' });
    fireEvent.change(field, { target: { value: 'Mina' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(calls('renameSpeaker')).toEqual([{ transcriptId: 1, side: 'other', speaker: '1.1', name: 'Mina' }]);

    const second = document.querySelector('[data-n="2"]') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: 'Change speaker' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New speaker' }));
    await settle();
    expect(calls('reassignSentence')).toEqual([{ transcriptId: 1, n: 2, speaker: 'u1' }]);
  });

  it("exports the same text as today's exporter on the stored conversation", async () => {
    await renderRecord();
    const expectedTxt = conversationExporter({
      entries: createProjector().project(legs, DEFAULT_PROJECTION), legs, info: { provider: 'soniox', models: {} },
      words: exportWords(i18n.t.bind(i18n) as never), appVersion: '1.2.3', now: () => START,
    }).text(FULL_SCOPE, true);
    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as .txt' }));
    expect(downloadFile).toHaveBeenCalledWith(expectedTxt, 'sokuji-conversation-20260115-090000.txt', 'text/plain;charset=utf-8');

    openExport();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text' }));
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
});
