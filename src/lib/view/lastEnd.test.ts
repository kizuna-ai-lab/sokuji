import { describe, it, expect } from 'vitest';
import { lastEndItem } from './lastEnd';

describe('lastEndItem', () => {
  it('says why the last start was refused, as an error notice after the list', () => {
    expect(lastEndItem({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no_provider', message: 'No provider is chosen, or it has not loaded.' } } })).toEqual({
      kind: 'notice',
      notice: { kind: 'notice', id: 'last-end', leg: 'speaker', severity: 'error', code: 'no_provider', message: 'No provider is chosen, or it has not loaded.', at: 0 },
    });
  });

  it("keeps a failed start's leg and detail", () => {
    const item = lastEndItem({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', message: 'socket closed', leg: 'participant' } } });
    expect(item?.kind === 'notice' && item.notice).toMatchObject({ leg: 'participant', code: 'start_failed', message: 'socket closed' });
  });

  it('says nothing while a run is on, after a stop, or for an end its legs already record', () => {
    expect(lastEndItem({ phase: 'running', since: 0, legs: {} })).toBeNull();
    expect(lastEndItem({ phase: 'idle' })).toBeNull();
    expect(lastEndItem({ phase: 'idle', lastEnd: { reason: 'user' } })).toBeNull();
    expect(lastEndItem({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'leg_failed', message: 'x' } } })).toBeNull();
  });
});
