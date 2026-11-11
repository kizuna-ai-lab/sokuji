import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachNetworkDiagnostics } from './networkDiagnostics';
import { NETWORK_STAGE_PATHS } from '../lib/diagnostics/sessionNetwork';
import useLogStore from '../stores/logStore';

function bridge() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const electron = {
    send: vi.fn(), removeAllListeners: vi.fn(),
    invoke: vi.fn(async () => {}),
    receive: vi.fn((channel: string, receive: (...args: unknown[]) => void) => { listeners.set(channel, receive); }),
    removeListener: vi.fn((channel: string, receive: (...args: unknown[]) => void) => {
      if (listeners.get(channel) === receive) listeners.delete(channel);
    }),
  };
  return { electron, listeners, emit: (data: unknown) => listeners.get('session-network:event')?.(data) };
}
const facts = {
  requestId: 12, stage: 'soniox.session-key', phase: 'error', path: '/api/soniox/session-key',
  timestamp: 123456, durationMs: 142, chromiumError: 'net::ERR_CONNECTION_RESET', status: 200,
  cfRay: '0123456789abcdef-NRT',
};
let detach: (() => void) | undefined;
afterEach(() => {
  detach?.();
  detach = undefined;
  useLogStore.getState().setEnabled(false);
});
const events = () => {
  useLogStore.getState().flushPendingLogs();
  return useLogStore.getState().allLogs.flatMap((log) => log.events ?? []);
};

describe('network diagnostics bridge', () => {
  it('follows the existing store switch including rollback and clears captured data on disable', () => {
    useLogStore.getState().setEnabled(false);
    const h = bridge();
    detach = attachNetworkDiagnostics(h.electron);
    expect(h.electron.invoke).toHaveBeenLastCalledWith('session-network:set-enabled', false);
    h.emit(facts);
    expect(events()).toEqual([]);
    useLogStore.getState().setEnabled(true);
    expect(h.electron.invoke).toHaveBeenLastCalledWith('session-network:set-enabled', true);
    h.emit(facts);
    expect(events()).toEqual([expect.objectContaining({ type: 'session.network.error', data: facts })]);
    useLogStore.getState().setEnabled(false);
    h.emit(facts);
    expect(events()).toEqual([]);
    useLogStore.getState().setEnabled(true); // a failed setting write can restore the prior value
    h.emit({ ...facts, stage: 'soniox.reissue', phase: 'completed', path: '/api/soniox/session-key/reissue' });
    expect(events()).toHaveLength(1);
    expect(h.electron.invoke.mock.calls).toEqual([
      ['session-network:set-enabled', false], ['session-network:set-enabled', true],
      ['session-network:set-enabled', false], ['session-network:set-enabled', true],
    ]);
  });

  it('subscribes to settings already loaded, detaches exactly its listener and disables on cleanup', () => {
    useLogStore.getState().setEnabled(true);
    const h = bridge();
    detach = attachNetworkDiagnostics(h.electron);
    expect(h.electron.invoke).toHaveBeenLastCalledWith('session-network:set-enabled', true);
    const receive = h.listeners.get('session-network:event');
    detach();
    detach = undefined;
    expect(h.electron.removeListener).toHaveBeenCalledWith('session-network:event', receive);
    expect(h.listeners.size).toBe(0);
    expect(h.electron.invoke).toHaveBeenLastCalledWith('session-network:set-enabled', false);
    const count = h.electron.invoke.mock.calls.length;
    useLogStore.getState().setEnabled(false);
    useLogStore.getState().setEnabled(true);
    expect(h.electron.invoke).toHaveBeenCalledTimes(count);
  });

  it('retains only structured allowlisted facts at the IPC boundary', () => {
    useLogStore.getState().setEnabled(true);
    const h = bridge();
    detach = attachNetworkDiagnostics(h.electron);
    h.emit({ ...facts, path: 'https://private.test/?token=secret', url: 'private-url',
      body: 'private-body', Authorization: 'private-token', Cookie: 'private-cookie', ip: 'private-ip',
      error: 'private-error', message: 'private-notice', cancellationCause: 'private-cause' });
    const kept = events();
    expect(kept).toEqual([expect.objectContaining({ data: facts })]);
    expect(JSON.stringify(kept)).not.toContain('private');
    h.emit({ ...facts, chromiumError: 'net::ERR_ABORTED private', cfRay: 'private-ray', status: 999 });
    const keptAfterInvalidFields = events();
    const last = keptAfterInvalidFields[keptAfterInvalidFields.length - 1].data;
    expect(last).not.toHaveProperty('chromiumError');
    expect(last).not.toHaveProperty('cfRay');
    expect(last).not.toHaveProperty('status');
  });

  it('maps every known stage to its own allowlisted path, never to a path the payload names', () => {
    useLogStore.getState().setEnabled(true);
    const h = bridge();
    detach = attachNetworkDiagnostics(h.electron);
    for (const [stage, path] of Object.entries(NETWORK_STAGE_PATHS)) {
      h.emit({ requestId: 1, stage, phase: 'completed', path: 'https://private.test/?token=private', timestamp: 1, durationMs: 2 });
      const soFar = events();
      expect(soFar[soFar.length - 1].data).toMatchObject({ stage, path });
    }
    expect(events()).toHaveLength(Object.keys(NETWORK_STAGE_PATHS).length);
    expect(JSON.stringify(events())).not.toContain('private');
  });

  it('drops malformed or unrelated events instead of retaining arbitrary payloads', () => {
    useLogStore.getState().setEnabled(true);
    const h = bridge();
    detach = attachNetworkDiagnostics(h.electron);
    for (const value of [null, 'private', {}, { ...facts, stage: 'auth' }, { ...facts, phase: 'private' },
      { ...facts, requestId: 'private' }, { ...facts, timestamp: NaN }, { ...facts, durationMs: -1 }]) h.emit(value);
    expect(events()).toEqual([]);
  });

  it('does nothing when Electron is unavailable', () => {
    expect(attachNetworkDiagnostics(undefined)).toBeTypeOf('function');
  });
});
