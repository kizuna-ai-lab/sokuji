// The live notes the screen shows.
import { describe, it, expect, beforeEach } from 'vitest';
import { useLiveNotes } from './liveStore';

beforeEach(() => useLiveNotes.getState().begin('run-0001-aaaa'));

describe('the live notes on screen', () => {
  it('begin with nothing, follow the loop, and end', () => {
    expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run-0001-aaaa', state: null, running: true, ended: false });
    useLiveNotes.getState().update({ title: 'T', topics: [] });
    useLiveNotes.getState().setHint(true);
    useLiveNotes.getState().end();
    expect(useLiveNotes.getState()).toMatchObject({ state: { title: 'T' }, running: false, ended: true, hint: false });
  });

  it('Clear empties what is shown and keeps a running loop running', () => {
    useLiveNotes.getState().update({ title: 'T', topics: [] });
    useLiveNotes.getState().clear();
    expect(useLiveNotes.getState()).toMatchObject({ state: null, running: true });
  });

  it('say when they were turned off', () => {
    useLiveNotes.getState().turnedOff();
    expect(useLiveNotes.getState()).toMatchObject({ running: false, off: true });
  });
});
