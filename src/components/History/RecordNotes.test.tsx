// A record's notes beside its transcript: each state, the filter, the versions and the way into the transcript.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '../../locales';
import type { HistoryNotes, HistoryRecord } from '../../lib/history/types';
import RecordNotes, { type RecordNotesProps } from './RecordNotes';

const A = 'run-000a-aaaa';
const record = (notes: HistoryRecord['notes'] = []): HistoryRecord => ({
  id: A, startedAt: 0, endedAt: 60_000, state: 'closed', mode: 'both', myLanguage: 'zh', targetLanguage: 'ja', title: null, titleByUser: false,
  binnedAt: null, sentences: 9, hasRecording: false, notesVersions: notes.length, notesState: null, audioBytes: 0,
  services: { provider: 'soniox', models: {} }, appVersion: '1', textBytes: 0, legs: [], tracks: [], transcripts: [], notes,
});
const complete: HistoryNotes = {
  id: 7, recordId: A, transcriptId: 1, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'gpt-6-luna' }, language: 'en', createdAt: 0,
  state: 'complete', failure: null, requestIds: [],
  body: {
    title: 'Supplier sync', overview: { text: 'Delivery and packaging.', format: 'plain' },
    topics: [{ title: 'Delivery', summary: 'The date.', first: 1 }, { title: 'Packaging', summary: 'The fix.', first: 5 }],
    points: [
      { topic: 0, text: 'Ships next Tuesday', sentences: [2], kinds: ['decision'] },
      { topic: 0, text: 'Send the tracking number', sentences: [3], kinds: ['todo'], owner: 'My side', due: 'Tuesday' },
      { topic: 1, text: 'The boxes were redone', sentences: [6], kinds: [] },
      { topic: 1, text: 'Customs may hold it', sentences: [8], kinds: ['risk'] },
    ],
    names: [],
  },
};

const props = (over: Partial<RecordNotesProps> = {}): RecordNotesProps => ({
  record: record([{ id: 7, transcriptId: 1, language: 'en', createdAt: 0, state: 'complete' }]), notes: complete, writing: false, tooShort: false,
  languages: [{ code: 'zh', name: 'Chinese' }, { code: 'ja', name: 'Japanese' }],
  onWrite: vi.fn(), onCancel: vi.fn(), onShowVersion: vi.fn(), onJump: vi.fn(), ...over,
});
afterEach(() => cleanup());

describe("a record's notes", () => {
  it('shows the title, the overview, and each topic with its points, kinds, owner and date', () => {
    render(<RecordNotes {...props()} />);
    expect(screen.getByRole('heading', { name: 'Supplier sync' })).toBeInTheDocument();
    expect(screen.getByText('Delivery and packaging.')).toBeInTheDocument();
    const todo = screen.getByRole('button', { name: /Send the tracking number/ }).closest('li') as HTMLElement;
    expect(within(todo).getByText('To do')).toBeInTheDocument();
    expect(within(todo).getByText('My side · Tuesday')).toBeInTheDocument();
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Risk')).toBeInTheDocument();
  });

  it('filters the points by kind, leaving out topics with nothing left', () => {
    render(<RecordNotes {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'To-dos' }));
    expect(screen.getByRole('button', { name: /Send the tracking number/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ships next Tuesday/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Packaging' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: /The boxes were redone/ })).toBeInTheDocument();
  });

  it('takes a point to its sentence and a topic to its first', () => {
    const p = props();
    render(<RecordNotes {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Customs may hold it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Packaging' }));
    expect(vi.mocked(p.onJump).mock.calls).toEqual([[8], [5]]);
  });

  it('offers the other versions when there are several', () => {
    const p = props({ record: record([
      { id: 7, transcriptId: 1, language: 'en', createdAt: 2000, state: 'complete' },
      { id: 4, transcriptId: 1, language: 'zh', createdAt: 1000, state: 'failed' },
    ]) });
    render(<RecordNotes {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: '4' } });
    expect(p.onShowVersion).toHaveBeenCalledWith(4);
  });

  it('offers to write notes when there are none, in a language of the record', () => {
    const p = props({ record: record(), notes: null });
    render(<RecordNotes {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language of the notes' }), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write notes' }));
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'ja', name: 'Japanese' });
  });

  it('says notes are being written, with a way to stop', () => {
    const p = props({ writing: true });
    render(<RecordNotes {...p} />);
    expect(screen.getByRole('status')).toHaveTextContent('Writing notes…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onCancel).toHaveBeenCalled();
  });

  it('says why a version failed, with a way to try again in its language', () => {
    const failed: HistoryNotes = { ...complete, state: 'failed', failure: 'Incorrect API key provided.', body: null, language: 'zh' };
    const p = props({ notes: failed });
    render(<RecordNotes {...p} />);
    expect(screen.getByText('The notes could not be written: Incorrect API key provided.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'zh', name: 'Chinese' });
  });

  it('says when there is too little to write notes from', () => {
    render(<RecordNotes {...props({ record: record(), notes: null, tooShort: true })} />);
    expect(screen.getByText('There is too little in this record to write notes from.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write notes' })).toBeNull();
  });
});
