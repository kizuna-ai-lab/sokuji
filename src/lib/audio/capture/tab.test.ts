import { describe, it, expect, vi } from 'vitest';
import { TRACK_ENDED } from './core';
import { openTab, type TabCapture, type TabSettings } from './tab';

function fakeTab(o: { begins?: boolean } = {}) {
  const track = new EventTarget() as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  let callback: ((data: { mono: Int16Array }) => void) | null = null;
  const tab = {
    begun: [] as Array<{ tabId?: number; outputDeviceId?: string } | undefined>,
    ended: 0,
    async begin(options?: { tabId?: number; outputDeviceId?: string }) {
      tab.begun.push(options);
      return o.begins ?? true;
    },
    async record(fn: (data: { mono: Int16Array }) => void) {
      callback = fn;
      return true;
    },
    async end() {
      tab.ended += 1;
      callback = null;
    },
    getStream: () => stream,
    push: (pcm = new Int16Array(4)) => callback?.({ mono: pcm }),
    close: () => track.dispatchEvent(new Event('ended')),
  };
  return tab satisfies TabCapture;
}

function settingsFixture(o: { tabId?: number | null; outputDeviceId?: string; muted?: boolean } = {}) {
  let muted = o.muted ?? false;
  const settings: TabSettings = {
    tabId: () => (o.tabId === undefined ? 17 : o.tabId),
    outputDeviceId: () => o.outputDeviceId ?? 'speakers-1',
    muted: () => muted,
  };
  return { settings, mute: (next: boolean) => { muted = next; } };
}

const live = () => new AbortController().signal;

describe('openTab', () => {
  it('captures the meeting tab, played back on the monitor device, and delivers its chunks', async () => {
    const tab = fakeTab();
    const source = await openTab(settingsFixture().settings, live(), () => tab);
    const heard = vi.fn();
    source.onPcm(heard);
    tab.push();
    expect(tab.begun).toEqual([{ tabId: 17, outputDeviceId: 'speakers-1' }]);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('refuses to open when the side panel names no tab, rather than falling back to whichever tab is active', async () => {
    const tab = fakeTab();
    const createRecorder = vi.fn(() => tab);
    await expect(openTab(settingsFixture({ tabId: null }).settings, live(), createRecorder)).rejects.toThrow();
    expect(tab.begun).toEqual([]);
    // No recorder is touched at all: not even built.
    expect(createRecorder).not.toHaveBeenCalled();
  });

  it('rejects when the tab will not be captured', async () => {
    const tab = fakeTab({ begins: false });
    await expect(openTab(settingsFixture().settings, live(), () => tab)).rejects.toThrow();
    expect(tab.ended).toBe(0);
  });

  it('stops what it opened when the run was cancelled while it opened', async () => {
    const tab = fakeTab();
    const cancel = new AbortController();
    cancel.abort(new Error('the run ended'));
    await expect(openTab(settingsFixture().settings, cancel.signal, () => tab)).rejects.toThrow('the run ended');
    expect(tab.ended).toBe(1);
  });

  it('delivers nothing while muted', async () => {
    const tab = fakeTab();
    const { settings, mute } = settingsFixture();
    const source = await openTab(settings, live(), () => tab);
    const heard = vi.fn();
    source.onPcm(heard);
    mute(true);
    tab.push();
    expect(heard).not.toHaveBeenCalled();
  });

  it('ends when the tab closes', async () => {
    const tab = fakeTab();
    const source = await openTab(settingsFixture().settings, live(), () => tab);
    const ended = vi.fn();
    source.onEnded(ended);
    tab.close();
    expect(ended).toHaveBeenCalledWith(TRACK_ENDED);
  });

  it('stops once', async () => {
    const tab = fakeTab();
    const source = await openTab(settingsFixture().settings, live(), () => tab);
    await source.stop();
    await source.stop();
    expect(tab.ended).toBe(1);
  });
});
