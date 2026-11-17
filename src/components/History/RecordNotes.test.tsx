// A record's notes beside its transcript: each state, the filter, the versions and the way into the transcript.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import '../../locales';
import type { HistoryNotes, HistoryRecord } from '../../lib/history/types';
import RecordNotes, { type RecordNotesProps } from './RecordNotes';
import { FINAL_CODES } from '../../lib/notes/relayChat';
import { useSettingsStore } from '../../stores/settingsStore';

const A = 'run-000a-aaaa';
const record = (notes: HistoryRecord['notes'] = []): HistoryRecord => ({
  id: A, startedAt: 0, endedAt: 60_000, state: 'closed', mode: 'both', myLanguage: 'zh', targetLanguage: 'ja', title: null, titleByUser: false,
  binnedAt: null, sentences: 9, hasRecording: false, notesVersions: notes.length, notesState: null, notesComplete: false, audioBytes: 0,
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
    names: [
      { written: 'Soku G', likely: 'Sokuji', sentences: [4] },
      { written: 'Tanaka-san', likely: null, sentences: [7], dismissed: true },
      { written: 'Ozaka', likely: 'Osaka', sentences: [9] },
    ],
  },
};

const props = (over: Partial<RecordNotesProps> = {}): RecordNotesProps => ({
  record: record([{ id: 7, transcriptId: 1, language: 'en', createdAt: 0, state: 'complete' }]), notes: complete, writing: false, tooShort: false,
  languages: [{ code: 'zh', name: 'Chinese' }, { code: 'ja', name: 'Japanese' }],
  onWrite: vi.fn(), onCancel: vi.fn(), onShowVersion: vi.fn(), onJump: vi.fn(), onDismissName: vi.fn(), onAddName: vi.fn(async () => 'added' as const),
  explainWith: null, onExplained: vi.fn(), latest: null, ...over,
});
afterEach(() => cleanup());

describe("a record's notes", () => {
  it('shows the title, the overview, and each topic with its points, kinds, owner and date', () => {
    render(<RecordNotes {...props()} />);
    expect(screen.getByRole('heading', { name: 'Supplier sync' })).toBeInTheDocument();
    expect(screen.getByText('Delivery and packaging.')).toBeInTheDocument();
    const todo = screen.getByRole('button', { name: /Send the tracking number/ }).closest('li') as HTMLElement;
    expect(within(todo).getByText('To do')).toBeInTheDocument();
    expect(within(todo).getByText('Your side · Tuesday')).toBeInTheDocument();
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Risk')).toBeInTheDocument();
  });

  // Review: a stored body from elsewhere can leave out a point's kinds.
  it('shows a stored point with no kinds as a plain point', () => {
    const bare = { ...complete, body: { ...complete.body!, points: [{ topic: 0, text: 'Ships next Tuesday' }] } } as unknown as HistoryNotes;
    render(<RecordNotes {...props({ notes: bare })} />);
    expect(screen.getByRole('button', { name: 'Ships next Tuesday' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'To-dos' }));
    expect(screen.queryByRole('button', { name: 'Ships next Tuesday' })).toBeNull();
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

  // Owner, 2026-11-17: a long point is one run of text, its bullet at its first line and its kinds right after its last
  // word. A <button> is laid out as a block of its own, which put the bullet at its last line and the kinds on a line
  // of their own.
  it('lets a point\'s text run inline, its kinds straight after it, and still go to its sentence from the keyboard', () => {
    const p = props();
    render(<RecordNotes {...p} />);
    const point = screen.getByRole('button', { name: /Customs may hold it/ });
    expect(point.tagName).toBe('SPAN');
    expect(point.tabIndex).toBe(0);
    expect(point.nextElementSibling?.className).toBe('record-notes__marks');
    expect(point.nextElementSibling?.tagName).toBe('SPAN');
    fireEvent.keyDown(point, { key: 'Enter' });
    fireEvent.keyDown(point, { key: ' ' });
    fireEvent.keyDown(point, { key: 'a' });
    expect(vi.mocked(p.onJump).mock.calls).toEqual([[8], [8]]);
  });

  it('takes a point to its sentence and a topic to its first', () => {
    const p = props();
    render(<RecordNotes {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Customs may hold it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Packaging' }));
    expect(vi.mocked(p.onJump).mock.calls).toEqual([[8], [5]]);
  });

  // Review: a click on a topic or point also starts the recording there; it is said under the filter.
  it('says what a click on a topic or point does: with a recording it plays from there too', () => {
    const { unmount } = render(<RecordNotes {...props()} />);
    expect(screen.getByText('Click a topic or point to go to its sentence.')).toBeInTheDocument();
    unmount();
    const track = { source: 'participant' as const, file: 'participant.opus', format: 'ogg-opus' as const, durationMs: 60_000, bytes: 10, offsetMs: 0, goneAt: null };
    const recorded = { ...record([{ id: 7, transcriptId: 1, language: 'en', createdAt: 0, state: 'complete' }]), hasRecording: true, tracks: [track] };
    render(<RecordNotes {...props({ record: recorded })} />);
    expect(screen.getByText('Click a topic or point to go to its sentence and play from there.')).toBeInTheDocument();
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

  // Each kind on its own; a topic with nothing of that kind is left out.
  it('filters to the decisions alone and to the risks alone', () => {
    render(<RecordNotes {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decisions' }));
    expect(screen.getByRole('button', { name: /Ships next Tuesday/ })).toBeInTheDocument();
    for (const other of [/Send the tracking number/, /The boxes were redone/, /Customs may hold it/]) expect(screen.queryByRole('button', { name: other })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Packaging' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Risks' }));
    expect(screen.getByRole('button', { name: /Customs may hold it/ })).toBeInTheDocument();
    for (const other of [/Ships next Tuesday/, /Send the tracking number/, /The boxes were redone/]) expect(screen.queryByRole('button', { name: other })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delivery' })).toBeNull();
  });

  // A new version, beside the notes already there, in the other language of the record.
  it('writes a new version in the language chosen beside the notes already there', () => {
    const p = props();
    render(<RecordNotes {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language of the notes' }), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write a new version' }));
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'ja', name: 'Japanese' });
  });

  // The language list holds only the record's two languages now; a version written earlier in another
  // language stays in the versions, named by its language, and opens.
  it('keeps a version written earlier in a language the record no longer offers, and opens it', () => {
    const p = props({ record: record([
      { id: 7, transcriptId: 1, language: 'en', createdAt: 2000, state: 'complete' },
      { id: 3, transcriptId: 1, language: 'fr', createdAt: 1000, state: 'complete' },
    ]) });
    render(<RecordNotes {...p} />);
    const versions = screen.getByRole('combobox', { name: 'Version' });
    expect(within(versions).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('English'), expect.stringContaining('French')]);
    expect(within(screen.getByRole('combobox', { name: 'Language of the notes' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Chinese', 'Japanese']);
    fireEvent.change(versions, { target: { value: '3' } });
    expect(p.onShowVersion).toHaveBeenCalledWith(3);
    cleanup();
    render(<RecordNotes {...props({ record: p.record, notes: { ...complete, id: 3, language: 'fr' } })} />);
    expect(screen.getByRole('heading', { name: 'Supplier sync' })).toBeInTheDocument();
    expect((screen.getByRole('combobox', { name: 'Version' }) as HTMLSelectElement).value).toBe('3');
  });

  it('offers to write notes when there are none, in a language of the record', () => {
    const p = props({ record: record(), notes: null });
    render(<RecordNotes {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language of the notes' }), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write notes' }));
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'ja', name: 'Japanese' });
  });

  it('says on the screen that the language is the notes\' language, with the select and the button kept together after it', () => {
    render(<RecordNotes {...props({ record: record(), notes: null })} />);
    const select = screen.getByLabelText('Language of the notes');
    expect(select.tagName).toBe('SELECT');
    expect(select.getAttribute('aria-label')).toBeNull();
    const label = screen.getByText('Language of the notes');
    expect(label.tagName).toBe('LABEL');
    const group = label.closest('.record-notes__write')!;
    const pick = select.closest('.record-notes__pick')!;
    expect(group.contains(pick)).toBe(true);
    expect(within(pick as HTMLElement).getByRole('button', { name: 'Write notes' })).toBeInTheDocument();
    // The label first, then the select and the button.
    expect([...group.children]).toEqual([label, pick]);
  });

  // Owner, 2026-11-17: the select is at least as wide as its longest language name. The app's selects draw their own
  // picker (appearance: base-select), which is only as wide as the chosen name, so the width is measured.
  it('makes the select at least as wide as its longest language name', () => {
    const measureText = (text: string) => ({ width: text.length * 10 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ font: '', measureText }) as unknown as CanvasRenderingContext2D);
    render(<RecordNotes {...props({ record: record(), notes: null })} />);
    const select = screen.getByLabelText('Language of the notes') as HTMLSelectElement;
    const longest = Math.max(...[...select.options].map((o) => (o.textContent ?? '').length));
    expect(parseFloat(select.style.getPropertyValue('--language-min'))).toBeGreaterThanOrEqual(longest * 10);
  });

  // Review: measured before the app's font has come in, the names are measured in a fallback font; measured again
  // once fonts are ready, the select is wide enough in the font it shows.
  it('measures the names again once the fonts have come in', async () => {
    let fontIn = false;
    const measureText = (text: string) => ({ width: text.length * (fontIn ? 20 : 10) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ font: '', measureText }) as unknown as CanvasRenderingContext2D);
    let loaded!: () => void;
    const ready = new Promise<void>((resolve) => { loaded = resolve; });
    const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
    try {
      render(<RecordNotes {...props({ record: record(), notes: null })} />);
      const select = screen.getByLabelText('Language of the notes') as HTMLSelectElement;
      const longest = Math.max(...[...select.options].map((o) => (o.textContent ?? '').length));
      expect(parseFloat(select.style.getPropertyValue('--language-min'))).toBeLessThan(longest * 20);
      fontIn = true;
      await act(async () => { loaded(); await ready; });
      expect(parseFloat(select.style.getPropertyValue('--language-min'))).toBeGreaterThanOrEqual(longest * 20);
    } finally {
      if (fonts) Object.defineProperty(document, 'fonts', fonts); else delete (document as { fonts?: unknown }).fonts;
    }
  });

  it('keeps the same group for a new version of notes already written', () => {
    render(<RecordNotes {...props()} />);
    const pick = screen.getByLabelText('Language of the notes').closest('.record-notes__pick') as HTMLElement;
    expect(within(pick).getByRole('button', { name: 'Write a new version' })).toBeInTheDocument();
    expect(screen.getByText('Language of the notes').tagName).toBe('LABEL');
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

  it('lists the names that may be written wrong, leaves out dismissed ones, and dismisses or jumps on request', () => {
    const p = props();
    render(<RecordNotes {...p} />);
    const names = screen.getByRole('region', { name: 'Names to check' });
    expect(within(names).getAllByRole('listitem')).toHaveLength(2);
    expect(within(names).queryByText(/Tanaka-san/)).toBeNull();
    fireEvent.click(within(names).getByRole('button', { name: 'Soku G → Sokuji' }));
    expect(p.onJump).toHaveBeenCalledWith(4);
    fireEvent.click(within(names).getAllByRole('button', { name: 'Dismiss' })[1]);
    expect(p.onDismissName).toHaveBeenCalledWith(2);
  });

  it('adds a name with a suggestion to the word list at once, and asks for the spelling of one without', async () => {
    const p = props({ notes: { ...complete, body: { ...complete.body!, names: [
      { written: 'Soku G', likely: 'Sokuji', sentences: [4] }, { written: 'Mr Kawase', likely: null, sentences: [7] },
    ] } } });
    render(<RecordNotes {...p} />);
    const names = screen.getByRole('region', { name: 'Names to check' });
    fireEvent.click(within(names).getAllByRole('button', { name: 'Add to word list' })[0]);
    expect(p.onAddName).toHaveBeenCalledWith(0, 'Sokuji');
    fireEvent.click(within(names).getAllByRole('button', { name: 'Add to word list' })[1]);
    const spelling = within(names).getByLabelText('How it is spelled');
    // The settings' own text field, as every other field in the app.
    expect(spelling).toHaveClass('settings-input');
    fireEvent.change(spelling, { target: { value: 'Mr Kawase' } });
    fireEvent.click(within(names).getByRole('button', { name: 'Add' }));
    expect(p.onAddName).toHaveBeenCalledWith(1, 'Mr Kawase');
  });

  it('says when a name was already in the word list', async () => {
    const p = props({ onAddName: vi.fn(async () => 'known' as const) });
    render(<RecordNotes {...p} />);
    const names = screen.getByRole('region', { name: 'Names to check' });
    await act(async () => { fireEvent.click(within(names).getAllByRole('button', { name: 'Add to word list' })[0]); });
    expect(screen.getByRole('status')).toHaveTextContent('“Sokuji” is already in the word list.');
  });

  it('keeps saying what happened when the last name to check was added and its list is gone', async () => {
    const one = { ...complete, body: { ...complete.body!, names: [{ written: 'Soku G', likely: 'Sokuji', sentences: [4] }] } };
    const p = props({ notes: one, onAddName: vi.fn(async () => 'added' as const) });
    const { rerender } = render(<RecordNotes {...p} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add to word list' })); });
    rerender(<RecordNotes {...p} notes={{ ...one, body: { ...one.body!, names: [{ ...one.body!.names[0], dismissed: true }] } }} />);
    expect(screen.queryByRole('region', { name: 'Names to check' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('“Sokuji” was added to the word list.');
  });

  it('keeps the complete notes in view when a newer attempt failed, and says so above them', () => {
    const p = props({ record: record([
      { id: 9, transcriptId: 1, language: 'ja', createdAt: 2000, state: 'failed' },
      { id: 7, transcriptId: 1, language: 'en', createdAt: 1000, state: 'complete' },
    ]), latest: { ...complete, id: 9, state: 'failed', failure: 'notes:no-service', body: null } });
    render(<RecordNotes {...p} />);
    expect(screen.getByRole('heading', { name: 'Supplier sync' })).toBeInTheDocument();
    expect(screen.getByText('The latest attempt could not be written: No notes service is set up. Choose one in Languages and line-up and add its key.')).toBeInTheDocument();
  });

  // A newer attempt stopped (the app quit while writing, or Stop) is said above the notes kept, as a failed
  // one is, with a way to write it again in its language.
  it('keeps the complete notes in view when a newer attempt was stopped, says so above them, and offers to try again', () => {
    const p = props({ record: record([
      { id: 9, transcriptId: 1, language: 'ja', createdAt: 2000, state: 'cancelled' },
      { id: 7, transcriptId: 1, language: 'en', createdAt: 1000, state: 'complete' },
    ]), latest: { ...complete, id: 9, language: 'ja', state: 'cancelled', failure: null, body: null } });
    render(<RecordNotes {...p} />);
    expect(screen.getByRole('heading', { name: 'Supplier sync' })).toBeInTheDocument();
    expect(screen.getByText('The latest attempt was stopped.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'ja', name: 'Japanese' });
  });

  // No network.
  it('says a version failed because the notes service could not be reached, with a way to try again', () => {
    const p = props({ notes: { ...complete, state: 'failed', failure: 'notes:network', body: null, language: 'zh' } });
    render(<RecordNotes {...p} />);
    expect(screen.getByText('The notes could not be written: The notes service could not be reached.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'zh', name: 'Chinese' });
  });

  it("words the program's own reasons in the interface's language, and shows a service's as it is", () => {
    const failed = (failure: string): HistoryNotes => ({ ...complete, state: 'failed', failure, body: null });
    render(<RecordNotes {...props({ notes: failed('notes:refused:503') })} />);
    expect(screen.getByText('The notes could not be written: The service refused the request (503).')).toBeInTheDocument();
    cleanup();
    render(<RecordNotes {...props({ notes: failed('Incorrect API key provided.') })} />);
    expect(screen.getByText('The notes could not be written: Incorrect API key provided.')).toBeInTheDocument();
  });

  // A refusal from Kizuna AI's notes service once came out as its code (`notes:sign-in`). Every code the notes calls
  // can give has words; a code not known yet has general words.
  it('words every reason Kizuna AI can give, and never shows a code', () => {
    const failed = (failure: string): HistoryNotes => ({ ...complete, state: 'failed', failure, body: null });
    const words: Record<string, string> = {
      'sign-in': 'Sign in to Kizuna AI to write notes with it.',
      unavailable: 'Notes by Kizuna AI are not available yet.',
      'no-balance': 'Your Kizuna AI balance has run out.',
      'daily-limit': 'Today\'s limit for notes by Kizuna AI is reached. Try again tomorrow.',
      'wallet-frozen': 'Your Kizuna AI wallet is frozen.',
      'not-member': 'You are no longer a member of the organization that pays for Kizuna AI.',
      'too-large': 'This record is too long for Kizuna AI to write notes from.',
      'update-required': 'Update Sokuji to write notes with Kizuna AI.',
    };
    for (const code of new Set([...Object.values(FINAL_CODES), 'sign-in', 'unavailable'])) {
      render(<RecordNotes {...props({ notes: failed(`notes:${code}`) })} />);
      expect(words[code], code).toBeDefined();
      expect(screen.getByText(`The notes could not be written: ${words[code]}`)).toBeInTheDocument();
      cleanup();
    }
    for (const unknown of ['notes:something-new', 'notes:constructor', 'notes:toString']) {
      render(<RecordNotes {...props({ notes: failed(unknown) })} />);
      expect(screen.getByText('The notes could not be written: The notes service refused the request.'), unknown).toBeInTheDocument();
      cleanup();
    }
  });

  it('leads to the account for a reason the user can change there, and nowhere for the others', () => {
    const failed = (failure: string): HistoryNotes => ({ ...complete, state: 'failed', failure, body: null });
    for (const code of ['sign-in', 'no-balance', 'wallet-frozen', 'not-member']) {
      useSettingsStore.setState({ settingsNavigationTarget: null });
      render(<RecordNotes {...props({ notes: failed(`notes:${code}`) })} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open Accounts and keys' }));
      expect(useSettingsStore.getState().settingsNavigationTarget, code).toBe('user-account');
      cleanup();
    }
    // Notes already written, and a newer attempt failed for one of these: the line above the notes leads there too.
    useSettingsStore.setState({ settingsNavigationTarget: null });
    render(<RecordNotes {...props({ latest: { ...complete, id: 9, state: 'failed', failure: 'notes:no-balance', body: null } })} />);
    expect(screen.getByText('The latest attempt could not be written: Your Kizuna AI balance has run out.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Accounts and keys' }));
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('user-account');
    cleanup();
    for (const code of ['unavailable', 'daily-limit', 'too-large', 'update-required', 'network']) {
      render(<RecordNotes {...props({ notes: failed(`notes:${code}`) })} />);
      expect(screen.queryByRole('button', { name: /^Open / }), code).toBeNull();
      cleanup();
    }
  });

  it('shows an owner and a date only on a point that is still a to-do', () => {
    const body = { ...complete.body!, points: [{ topic: 0, text: 'Book the room', sentences: [2], kinds: [], was: ['todo'], owner: 'Bob', due: 'Friday' }], names: [] };
    render(<RecordNotes {...props({ notes: { ...complete, body } })} />);
    expect(screen.queryByText('Bob · Friday')).toBeNull();
  });

  it('explains that the text goes through Kizuna AI to OpenAI when Kizuna AI writes the notes', () => {
    render(<RecordNotes {...props({ record: record(), notes: null, explainWith: 'kizunaai' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Write notes' }));
    const explained = screen.getByRole('group', { name: 'Before notes are written' });
    expect(within(explained).getByText(/go through Kizuna AI’s server to OpenAI/)).toBeInTheDocument();
  });

  it('explains once what is sent where before the first notes written from a record', () => {
    const p = props({ record: record(), notes: null, explainWith: 'openai' });
    render(<RecordNotes {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Write notes' }));
    const explained = screen.getByRole('group', { name: 'Before notes are written' });
    expect(within(explained).getByText(/sent to OpenAI with your own key/)).toBeInTheDocument();
    expect(p.onWrite).not.toHaveBeenCalled();
    fireEvent.click(within(explained).getByRole('button', { name: 'Write notes' }));
    expect(p.onExplained).toHaveBeenCalled();
    expect(p.onWrite).toHaveBeenCalledWith({ code: 'zh', name: 'Chinese' });
  });
});

describe('RecordNotes styles: the language and the button', () => {
  // B-49 (owner, 2026-11-17): first the label takes a line of its own; when the select and the button still do not fit
  // side by side, the button goes on to the next line, under the select, rather than out of the notes column.
  it('wraps the label on to a line of its own first, then the button under the select, never out of the column', async () => {
    const { compile } = await import('sass');
    const { resolve } = await import('node:path');
    const css = compile(resolve(__dirname, 'History.scss')).css;
    const write = css.match(/\.record-notes__write\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(write).toMatch(/flex-wrap:\s*wrap/);
    const pick = css.match(/\.record-notes__pick\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(pick).toMatch(/display:\s*flex/);
    expect(pick).toMatch(/flex-wrap:\s*wrap/);
    expect(pick).not.toMatch(/flex-wrap:\s*nowrap/);
    // The button keeps its words on one line, and is never wider than the column.
    const button = css.match(/\.record-notes__pick \.history-button\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(button).toMatch(/flex:\s*none/);
    expect(button).toMatch(/white-space:\s*nowrap/);
    expect(button).toMatch(/max-width:\s*100%/);
  });

  // Owner, 2026-11-17: the select as wide as its longest language name (not capped, not stretched), and as tall as the
  // button beside it.
  it('makes the select as wide as its longest name and as tall as the button', async () => {
    const { compile } = await import('sass');
    const { resolve } = await import('node:path');
    const css = compile(resolve(__dirname, 'History.scss')).css;
    const select = css.match(/\.record-notes__pick select\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(select).toMatch(/width:\s*auto/);
    expect(select).not.toMatch(/max-width:\s*160px/);
    // The measured width, and never more than most of the row in a narrow column (its button stays beside it).
    expect(select).toMatch(/min-width:\s*min\(var\(--language-min, 0px\), 55cqw\)/);
    expect(css).toMatch(/\.record-notes\s*\{[^}]*container-type:\s*inline-size/);
    const height = (body: string) => body.match(/(?:^|;|\s)height:\s*([^;]+);/)?.[1]?.trim();
    const button = css.match(/\.record-notes__pick \.history-button\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(height(select)).toBe('30px');
    expect(height(button)).toBe('30px');
    expect(select).toMatch(/box-sizing:\s*border-box/);
    expect(button).toMatch(/box-sizing:\s*border-box/);
    // Held to the button's height, its words and its arrow sit in the middle: no padding above and below to push them
    // down (owner, 2026-11-17).
    expect(select).toMatch(/padding-block:\s*0/);
    expect(select).toMatch(/align-items:\s*center/);
    // Opened, its list is exactly as wide as the select (owner, 2026-11-17).
    const picker = css.match(/\.record-notes__pick select::picker\(select\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(picker).toMatch(/width:\s*anchor-size\(width\)/);
    expect(picker).toMatch(/box-sizing:\s*border-box/);
  });
});
