import { describe, it, expect } from 'vitest';
import { EVENT_KINDS, eventsFrom, recordEvents, type AdapterEvent } from './events';

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

  it('forwards every kind in EVENT_KINDS as its own tagged event', () => {
    for (const kind of EVENT_KINDS) {
      const log: AdapterEvent[] = [];
      const events = eventsFrom((e) => log.push(e));
      const payload = { marker: kind };
      (events[kind] as (p: unknown) => void)(payload);
      expect(log).toEqual([{ kind, payload }]);
    }
  });
});

describe('recordEvents', () => {
  it('keeps a log the test can assert on', () => {
    const { events, log } = recordEvents();
    events.closed({ reason: 'stopped' });
    expect(log).toEqual([{ kind: 'closed', payload: { reason: 'stopped' } }]);
  });
});
