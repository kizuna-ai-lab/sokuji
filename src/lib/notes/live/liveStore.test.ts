// The live notes the screen shows.
import { describe, it, expect, beforeEach } from 'vitest';
import { useLiveNotes } from './liveStore';

const RECORD = 'run-0001-aaaa';
beforeEach(() => useLiveNotes.getState().begin(RECORD));

describe('what the live notes used', () => {
  it('sums each update\'s usage for the session on screen, and starts again with the next session', () => {
    const store = useLiveNotes.getState();
    store.begin('run-a');
    store.addUsage('run-a', { prompt_tokens: 9000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 8000 } });
    store.addUsage('run-a', { prompt_tokens: 1000, completion_tokens: 100 });
    store.addUsage('run-other', { prompt_tokens: 5, completion_tokens: 5 });
    store.balanceAfter('run-a', 80_000);
    expect(useLiveNotes.getState()).toMatchObject({ used: { input: 10_000, cached: 8000, output: 400 }, balanceMicroUsd: 80_000 });
    useLiveNotes.getState().begin('run-b');
    expect(useLiveNotes.getState()).toMatchObject({ used: { input: 0, cached: 0, output: 0 }, balanceMicroUsd: null });
  });
});

describe('the live notes on screen', () => {
  it('begin with nothing, follow the loop, and end', () => {
    expect(useLiveNotes.getState()).toMatchObject({ recordId: RECORD, state: null, running: true, ended: false });
    useLiveNotes.getState().update(RECORD, { title: 'T', topics: [] });
    useLiveNotes.getState().setHint(RECORD, true);
    useLiveNotes.getState().end(RECORD);
    expect(useLiveNotes.getState()).toMatchObject({ state: { title: 'T' }, running: false, ended: true, hint: false });
  });

  it('take nothing from another record: its late update, hint, end or switch-off', () => {
    useLiveNotes.getState().update(RECORD, { title: 'Mine', topics: [] });
    useLiveNotes.getState().update('run-0000-old', { title: 'Old', topics: [] });
    useLiveNotes.getState().setHint('run-0000-old', true);
    useLiveNotes.getState().end('run-0000-old');
    useLiveNotes.getState().turnedOff('run-0000-old');
    expect(useLiveNotes.getState()).toMatchObject({ recordId: RECORD, state: { title: 'Mine' }, hint: false, running: true, ended: false, off: false });
  });

  it('Clear empties what is shown and keeps a running loop running', () => {
    useLiveNotes.getState().update(RECORD, { title: 'T', topics: [] });
    useLiveNotes.getState().clear();
    expect(useLiveNotes.getState()).toMatchObject({ recordId: RECORD, state: null, running: true });
  });

  it('Clear after the session leaves nothing, the line saying live notes are off included', () => {
    useLiveNotes.getState().turnedOff(RECORD);
    useLiveNotes.getState().clear();
    expect(useLiveNotes.getState()).toMatchObject({ recordId: null, state: null, running: false, off: false, ended: false });
    useLiveNotes.getState().begin(RECORD);
    useLiveNotes.getState().update(RECORD, { title: 'T', topics: [] });
    useLiveNotes.getState().end(RECORD);
    useLiveNotes.getState().clear();
    expect(useLiveNotes.getState()).toMatchObject({ recordId: null, state: null, ended: false });
  });

  it('reset forgets the last session, so its late answer finds no record to land in', () => {
    useLiveNotes.getState().update(RECORD, { title: 'T', topics: [] });
    useLiveNotes.getState().reset();
    useLiveNotes.getState().update(RECORD, { title: 'Late', topics: [] });
    expect(useLiveNotes.getState()).toMatchObject({ recordId: null, state: null, running: false, off: false, ended: false });
  });

  it('say when they were turned off', () => {
    useLiveNotes.getState().turnedOff(RECORD);
    expect(useLiveNotes.getState()).toMatchObject({ running: false, off: true });
  });
});
