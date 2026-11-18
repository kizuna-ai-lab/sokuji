// The record page on the app's own history store (not a fake): what a user changes is what comes back when the record
// is opened again: a rename changes that one speaker and a move that one sentence; the other
// speakers of the same side and the other sentences stay as they were.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
const drawer = () => screen.getByRole('complementary', { name: 'Edit' });
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
afterEach(() => { cleanup(); real.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// The speakers are in the edit panel: a column on a wide page (owner, 2026-11-18), a tab on a narrow one. Wide here.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly cb: () => void) {}
    observe() { this.cb(); }
    unobserve() {}
    disconnect() {}
  });
});

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

describe('an imported record\'s speakers', () => {
  // An imported file holds everyone on one track: who is on which side is not known, and the page names no side.
  it('are numbered, with no side named in the transcript or the side panel', async () => {
    const I = 'import-0001-aaaa';
    real.store.openRecord({ id: I, startedAt: START, mode: 'import', myLanguage: 'en', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
    const transcriptId = real.store.createTranscript({ recordId: I, origin: { service: 'soniox', kind: 'file' } });
    real.store.appendSentences({ transcriptId, sentences: [
      { ...sentence(1, 'other', 'Welcome, everyone.'), sideCertain: false, track: 'other', segmentId: 'f-1' },
      { ...sentence(2, 'other', 'Thanks for having me.', '2'), sideCertain: false, track: 'other', segmentId: 'f-2' },
    ] });
    real.store.closeRecord({ id: I, endedAt: START + 10_000 });
    await act(() => store.getState().openRecord(I));
    await settle();
    expect(speakerOf(1)).toBe('Speaker 1');
    expect(speakerOf(2)).toBe('Speaker 2');
    expect(within(drawer()).getByRole('button', { name: 'Rename Speaker 1' })).toBeInTheDocument();
    expect(within(drawer()).queryByText('The other side')).toBeNull();
    expect(within(drawer()).queryByText('Your side')).toBeNull();
  });

  // A file transcribed with a translation: each turn's translation under its first row, as a session's.
  it('show each turn\u2019s translation under it', async () => {
    const I = 'import-0002-aaaa';
    real.store.openRecord({ id: I, startedAt: START, mode: 'import', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
    const transcriptId = real.store.createTranscript({ recordId: I, origin: { service: 'soniox', kind: 'file', options: { languages: ['en'], translateTo: 'zh' } } });
    real.store.appendSentences({ transcriptId, sentences: [
      { ...sentence(1, 'other', 'Welcome, everyone.'), sideCertain: false, track: 'other', segmentId: 'file-participant-1', translation: '欢迎大家。' },
      { ...sentence(2, 'other', 'Thanks for having me.', '2'), sideCertain: false, track: 'other', segmentId: 'file-participant-2', translation: '谢谢邀请我。' },
    ] });
    real.store.closeRecord({ id: I, endedAt: START + 10_000 });
    await act(() => store.getState().openRecord(I));
    await settle();
    expect(row(1)?.querySelector('.record-row__translation')?.textContent).toBe('欢迎大家。');
    expect(row(2)?.querySelector('.record-row__translation')?.textContent).toBe('谢谢邀请我。');
    // What this version was asked for, at the top of its transcript; no "my language → its language" in the head.
    expect(document.querySelector('.record-page__transcript > .record-page__asked')?.textContent).toBe('Main language: English · Translated into: Chinese');
    expect(document.querySelector('.record-page__head')?.textContent).not.toContain('→');
  });

  it('a session\u2019s transcript says nothing of options, and its head keeps its languages', async () => {
    await act(() => store.getState().openRecord(A));
    await settle();
    expect(document.querySelector('.record-page__asked')).toBeNull();
    expect(document.querySelector('.record-page__head')?.textContent).toContain('English');
    expect([...document.querySelectorAll('.record-page__head .language-pair-text bdi')].map((b) => b.textContent)).toEqual(['English', 'Chinese']);
    expect(document.querySelector('.record-page__head svg.language-pair-text__arrow')).toHaveClass('lucide-arrow-right-left');
  });

  // Face to face, both people on one microphone: the sides were inferred, and still say who spoke.
  it('a session whose sides were only inferred keeps them, under their headings', async () => {
    const F = 'run-0009-ffff';
    real.store.openRecord({ id: F, startedAt: START, mode: 'face-to-face', myLanguage: 'en', targetLanguage: 'zh', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
    const transcriptId = real.store.createTranscript({ recordId: F, origin: { service: 'soniox', kind: 'live' } });
    real.store.appendSentences({ transcriptId, sentences: [
      { ...sentence(1, 'mine', 'Shall we start?'), sideCertain: false },
      { ...sentence(2, 'other', 'Yes, please.'), sideCertain: false },
    ] });
    real.store.closeRecord({ id: F, endedAt: START + 10_000 });
    await act(() => store.getState().openRecord(F));
    await settle();
    expect(speakerOf(1)).toBe('Me');
    expect(speakerOf(2)).toBe('Other');
    expect(within(drawer()).getByText('Your side')).toBeInTheDocument();
    expect(within(drawer()).getByText('The other side')).toBeInTheDocument();
  });
});
