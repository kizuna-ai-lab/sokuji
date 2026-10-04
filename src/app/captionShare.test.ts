// src/app/captionShare.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { Entry } from '../lib/projection/types';
import type { RunState } from '../lib/session/types';
import { IDLE_STATUS, useCaptionShareStore } from '../stores/captionShareStore';
import { createCaptionShareController } from './captionShare';

vi.mock('../lib/diagnostics/report', () => ({ reportError: vi.fn(), reportWarning: vi.fn(), describeCause: (e: unknown) => String(e) }));

const STATUS = { ...IDLE_STATUS, running: true, port: 7788, selected: '192.168.1.23', addresses: [{ address: '192.168.1.23', label: 'wlan0', kind: 'wifi' as const }] };

function setup(startResult: unknown = STATUS) {
  const receivers = new Map<string, (...args: unknown[]) => void>();
  const ipc = {
    invoke: vi.fn(async (channel: string, _data?: unknown) => {
      if (channel === 'caption-share:start') return startResult;
      if (channel === 'caption-share:stop') return { ...IDLE_STATUS };
      if (channel === 'caption-share:select-address') return { ...STATUS, selected: '10.0.0.2' };
      return undefined;
    }),
    receive: (channel: string, fn: (...args: unknown[]) => void) => { receivers.set(channel, fn); },
  };
  const entries: Entry[] = [];
  const listeners = new Set<() => void>();
  const view = { get: () => ({ entries }), subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); } };
  const run = createStore<RunState>(() => ({ phase: 'running', since: 0, legs: {} }));
  const controller = createCaptionShareController({
    ipc,
    view,
    onReset: () => () => {},
    runState: { getState: () => run.getState(), subscribe: (l) => run.subscribe(() => l()) },
    pair: { get: () => ({ source: 'ja', target: 'zh-CN' }), subscribe: () => () => {} },
    store: useCaptionShareStore,
    uiLanguage: () => 'zh_CN',
    now: () => 5000,
  });
  return { ipc, receivers, controller, run };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The last element (the project's lib is ES2020: no Array.prototype.at). */
const lastOf = <T,>(list: readonly T[]): T | undefined => list[list.length - 1];
const channels = (ipc: { invoke: { mock: { calls: unknown[][] } } }) => ipc.invoke.mock.calls.map((c) => c[0]);

beforeEach(() => {
  useCaptionShareStore.getState().markStopped();
  useCaptionShareStore.setState({ allowSave: false, wifiHint: { enabled: false, ssid: '', password: '' }, error: null, busy: false });
});

describe('caption share controller', () => {
  it('starts the server with the share state, then publishes', async () => {
    const { ipc, controller } = setup();
    expect(await controller.start()).toBe(true);
    await flush();
    expect(ipc.invoke.mock.calls[0]).toEqual(['caption-share:start', { phase: 'live', pair: { source: 'ja', target: 'zh-CN' }, allowSave: false }]);
    expect(channels(ipc)).toContain('caption-share:state');
    expect(useCaptionShareStore.getState().status.running).toBe(true);
    expect(useCaptionShareStore.getState().startedAt).toBe(5000);
  });

  it('keeps the error and does not publish when the server cannot start', async () => {
    const { ipc, controller } = setup({ error: 'ports-busy', reason: 'All share ports are in use' });
    expect(await controller.start()).toBe(false);
    expect(useCaptionShareStore.getState().error).toEqual({ code: 'ports-busy', reason: 'All share ports are in use' });
    expect(channels(ipc)).not.toContain('caption-share:state');
  });

  it('a pushed status that says stopped ends the publisher and the share', async () => {
    const { ipc, receivers, controller, run } = setup();
    await controller.start();
    await flush();
    receivers.get('caption-share:status')?.({ ...IDLE_STATUS });
    const before = ipc.invoke.mock.calls.length;
    run.setState({ phase: 'idle' });
    await flush();
    expect(ipc.invoke.mock.calls.length).toBe(before);
    expect(useCaptionShareStore.getState().startedAt).toBeNull();
  });

  it('sends allowSave through the state, and the Wi-Fi hint only while sharing', async () => {
    const { ipc, controller } = setup();
    controller.setWifiHint({ enabled: true, ssid: 'Guest' });
    expect(channels(ipc)).not.toContain('caption-share:set-wifi');
    await controller.start();
    await flush();
    expect(ipc.invoke.mock.calls.find((c) => c[0] === 'caption-share:set-wifi')?.[1]).toEqual({ wifi: { ssid: 'Guest', password: '' } });
    controller.setAllowSave(true);
    await flush();
    expect(lastOf(ipc.invoke.mock.calls.filter((c) => c[0] === 'caption-share:state'))?.[1]).toMatchObject({ allowSave: true });
    controller.setWifiHint({ enabled: false });
    await flush();
    expect(lastOf(ipc.invoke.mock.calls.filter((c) => c[0] === 'caption-share:set-wifi'))?.[1]).toEqual({ wifi: null });
  });

  it('stops, selects an address and opens the present window over IPC', async () => {
    const { ipc, controller } = setup();
    await controller.start();
    await controller.selectAddress('10.0.0.2');
    expect(useCaptionShareStore.getState().status.selected).toBe('10.0.0.2');
    await controller.openPresent();
    await controller.stop();
    expect(channels(ipc)).toEqual(expect.arrayContaining(['caption-share:select-address', 'caption-share:present', 'caption-share:stop']));
    expect(useCaptionShareStore.getState().status).toEqual(IDLE_STATUS);
  });

  // PR #597 review: a stop the main process did not carry out must not show
  // sharing as off while the server still serves the captions to the network.
  it('keeps sharing, and publishing, when the stop did not go through', async () => {
    const { ipc, controller, run } = setup();
    await controller.start();
    await flush();
    ipc.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'caption-share:stop') throw new Error('stop failed');
      return undefined;
    });
    await controller.stop();
    expect(useCaptionShareStore.getState().status.running).toBe(true);
    expect(useCaptionShareStore.getState().startedAt).toBe(5000);
    const before = ipc.invoke.mock.calls.length;
    run.setState({ phase: 'idle' });
    await flush();
    expect(channels(ipc).slice(before)).toContain('caption-share:state');
  });

  it("opens the present window in Sokuji's UI language", async () => {
    const { ipc, controller } = setup();
    await controller.start();
    await controller.openPresent();
    expect(ipc.invoke).toHaveBeenCalledWith('caption-share:present', { lang: 'zh_CN' });
  });
});
