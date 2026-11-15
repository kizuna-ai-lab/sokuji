// A reconnect numbers people from 1 again: a speaker label carries its connection, so two connections' speaker 3 stay apart.
import { describe, it, expect } from 'vitest';
import { recordEvents } from '../../lib/contract/events';
import { QwenSegments } from './segments';

function personOf(connection: number): string | undefined {
  const { events, log } = recordEvents();
  const s = new QwenSegments({ sink: events, person: true, connection });
  s.heard('item1', 3);
  s.text('item1', 'source', 'Hello');
  const opened = log.find((e) => e.kind === 'segmentOpened');
  return (opened?.payload as { person?: string } | undefined)?.person;
}

describe('Qwen segments — person', () => {
  it("scopes the other side's speaker to its connection", () => {
    expect([personOf(1), personOf(2)]).toEqual(['1.3', '2.3']);
  });
});
