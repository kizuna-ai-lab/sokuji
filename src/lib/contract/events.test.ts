import { describe, it, expect } from 'vitest';
import { eventsFrom, recordEvents, type AdapterEvent } from './events';

describe('eventsFrom', () => {
  it('forwards every method as a tagged event, in call order', () => {
    const log: AdapterEvent[] = [];
    const events = eventsFrom((e) => log.push(e));
    events.segmentOpened({ ref: 1, side: 'source' });
    events.segmentText({ ref: 1, text: 'hello' });
    events.reconnecting();
    events.busy(true);
    expect(log).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'hello' } },
      { kind: 'reconnecting', payload: undefined },
      { kind: 'busy', payload: true },
    ]);
  });
});

describe('recordEvents', () => {
  it('keeps a log the test can assert on', () => {
    const { events, log } = recordEvents();
    events.closed({ reason: 'stopped' });
    expect(log).toEqual([{ kind: 'closed', payload: { reason: 'stopped' } }]);
  });
});
