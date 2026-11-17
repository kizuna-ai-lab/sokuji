// The History list on the app's own history store (not a fake): the counts beside the navigation follow what the
// store really keeps. Test checklist A15.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { createVirtualClock } from '../../lib/contract/clock';
import { createHistoryPageStore } from '../../lib/history/historyPageStore';
import { realStorePort, type RealStorePort } from '../../lib/history/testing/realStorePort';
import '../../locales';
import { HistoryPageContext } from './historyContext';
import HistoryList from './HistoryList';

const A = 'run-0001-aaaa';
const START = new Date(2026, 0, 15, 9, 0, 0).getTime();

let real: RealStorePort;
let store: ReturnType<typeof createHistoryPageStore>;
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
  store = createHistoryPageStore(real.port, createVirtualClock(0), (e) => `failed: ${(e as Error).message}`);
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
