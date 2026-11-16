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

  it('appendTrack sends its piece on its own channel', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: { bytes: 3 } }));
    const data = new Uint8Array([1, 2, 3]);
    const a = { recordId: 'run-0001-aaaa', source: 'speaker' as const, offsetMs: 0, durationMs: 20, data };
    await expect(electronHistoryPort(invoke).appendTrack(a)).resolves.toEqual({ bytes: 3 });
    expect(invoke).toHaveBeenCalledWith('history:append-track', a);
  });

  it('saveTrack asks main to save a recording, and says whether it was saved', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: { saved: false } }));
    const a = { recordId: 'run-0001-aaaa', source: 'speaker', title: 'Save the recording', defaultName: 'r-me.opus' };
    await expect(electronHistoryPort(invoke).saveTrack(a)).resolves.toEqual({ saved: false });
    expect(invoke).toHaveBeenCalledWith('history:save-track', a);
  });

  it('rejects with the code when main refuses', async () => {
    const port = electronHistoryPort(async () => ({ ok: false, error: 'no', code: 'RECORD_CLOSED' }));
    const refused = port.putSegments({ recordId: 'run-0001-aaaa', leg: 'speaker', segments: [] });
    await expect(refused).rejects.toBeInstanceOf(HistoryUnavailable);
    await expect(refused).rejects.toMatchObject({ message: 'no', code: 'RECORD_CLOSED' });
  });

  // Review: a call the bridge itself refuses (a blocked channel, an argument that cannot be copied) is the same error.
  it('rejects with HistoryUnavailable when the call itself fails', async () => {
    const port = electronHistoryPort(async () => { throw new Error('An object could not be cloned.'); });
    const failed = port.listRecords({});
    await expect(failed).rejects.toBeInstanceOf(HistoryUnavailable);
    await expect(failed).rejects.toMatchObject({ message: 'An object could not be cloned.' });
  });

  it('every port method has a channel, and every page-facing channel a method', () => {
    const port = electronHistoryPort(async () => ({ ok: true }));
    // `history:status` and `history:save-track` are answered by main itself, not by a store method.
    const own = new Set(['history:status', 'history:save-track', 'history:recognize', 'history:recognize-cancel', 'history:recognize-status']);
    const pairs = Object.fromEntries(HISTORY_PORT_CHANNELS.filter(([, channel]) => !own.has(channel)).map(([method, channel]) => [channel, method]));
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
    expect(await nullHistoryPort.saveTrack({ recordId: 'run-0001-aaaa', source: 'speaker', title: '', defaultName: '' })).toEqual({ saved: false });
    expect(await nullHistoryPort.recognize({ recordId: 'run-0001-aaaa', service: 'soniox', source: 'speaker', apiKey: 'k', region: 'us', languageHints: [], jobId: 'j' })).toEqual({ tokens: [], audioMs: 0 });
    expect(await nullHistoryPort.cancelRecognition({ jobId: 'j' })).toBe(false);
    expect(await nullHistoryPort.recognitionStatus({ jobId: 'j' })).toBeNull();
    expect(Object.keys(nullHistoryPort).sort()).toEqual(HISTORY_PORT_CHANNELS.map(([method]) => method).sort());
  });
});
