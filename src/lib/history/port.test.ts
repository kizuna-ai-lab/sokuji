// The page's side of History: one port method per store method the page uses, over the history:* channels.
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { electronHistoryPort, nullHistoryPort, HISTORY_PORT_CHANNELS, HistoryUnavailable } from './port';

const nodeRequire = createRequire(import.meta.url);
const { HISTORY_CHANNELS } = nodeRequire('../../../electron/history-ipc.js') as { HISTORY_CHANNELS: Record<string, string> };

describe('the history port', () => {
  it('calls the channel for the method and resolves with the value', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: [{ id: 'run-0001-aaaa' }] }));
    expect(await electronHistoryPort(invoke).listRecords({ binned: true })).toEqual([{ id: 'run-0001-aaaa' }]);
    expect(invoke).toHaveBeenCalledWith('history:list-records', { binned: true });
  });

  it('getRecord and getLegs send the id as an object; usage and status send an empty one', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: null }));
    const port = electronHistoryPort(invoke);
    await port.getRecord('run-0001-aaaa');
    await port.getLegs('run-0001-aaaa');
    await port.usage();
    await port.status();
    expect(invoke.mock.calls).toEqual([
      ['history:get-record', { id: 'run-0001-aaaa' }],
      ['history:get-legs', { id: 'run-0001-aaaa' }],
      ['history:usage', {}],
      ['history:status', {}],
    ]);
  });

  it('rejects with the code when main refuses', async () => {
    const port = electronHistoryPort(async () => ({ ok: false, error: 'no', code: 'RECORD_CLOSED' }));
    const refused = port.putSegments({ recordId: 'run-0001-aaaa', leg: 'speaker', segments: [] });
    await expect(refused).rejects.toBeInstanceOf(HistoryUnavailable);
    await expect(refused).rejects.toMatchObject({ message: 'no', code: 'RECORD_CLOSED' });
  });

  it('every port method has a channel, and every page-facing channel a method', () => {
    const port = electronHistoryPort(async () => ({ ok: true }));
    const pairs = Object.fromEntries(HISTORY_PORT_CHANNELS.filter(([, channel]) => channel !== 'history:status').map(([method, channel]) => [channel, method]));
    expect(pairs).toEqual(HISTORY_CHANNELS);
    for (const [method] of HISTORY_PORT_CHANNELS) expect(typeof (port as unknown as Record<string, unknown>)[method], method).toBe('function');
    expect(Object.keys(port).sort()).toEqual(HISTORY_PORT_CHANNELS.map(([method]) => method).sort());
  });

  it('the null port holds nothing and never throws', async () => {
    await nullHistoryPort.openRecord({ id: 'run-0001-aaaa' } as never);
    expect(await nullHistoryPort.listRecords({})).toEqual([]);
    expect(await nullHistoryPort.getRecord('run-0001-aaaa')).toBeNull();
    expect(await nullHistoryPort.search({ query: 'x' })).toEqual([]);
    expect(await nullHistoryPort.usage()).toEqual({ dbBytes: 0, audioBytes: 0, records: 0, binned: 0 });
    expect(await nullHistoryPort.status()).toEqual({ available: false, dir: '' });
    expect(Object.keys(nullHistoryPort).sort()).toEqual(HISTORY_PORT_CHANNELS.map(([method]) => method).sort());
  });
});
