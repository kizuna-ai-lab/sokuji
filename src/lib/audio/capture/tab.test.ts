import { describe, it, expect, vi } from 'vitest';
import { TRACK_ENDED } from './core';
import { openTab, type TabCapture, type TabSettings } from './tab';

function fakeTab(o: { begins?: boolean; failure?: unknown } = {}) {
  const track = new EventTarget() as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  let callback: ((data: { mono: Int16Array }) => void) | null = null;
  const tab = {
    begun: [] as Array<{ tabId?: number; outputDeviceId?: string; video?: boolean } | undefined>,
    ended: 0,
    beginFailure: o.failure,
    async begin(options?: { tabId?: number; outputDeviceId?: string; video?: boolean }) {
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

function settingsFixture(o: { tabId?: number | null; outputDeviceId?: string; muted?: boolean; video?: boolean } = {}) {
  let muted = o.muted ?? false;
  const settings: TabSettings = {
    tabId: () => (o.tabId === undefined ? 17 : o.tabId),
    outputDeviceId: () => o.outputDeviceId ?? 'speakers-1',
    muted: () => muted,
    video: () => o.video ?? false,
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
    expect(tab.begun).toEqual([{ tabId: 17, outputDeviceId: 'speakers-1', video: false }]);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('asks for the tab\'s video too when the screen context is on, and for audio alone otherwise', async () => {
    const withVideo = fakeTab();
    await openTab(settingsFixture({ video: true }).settings, live(), () => withVideo);
    expect(withVideo.begun).toEqual([{ tabId: 17, outputDeviceId: 'speakers-1', video: true }]);

    const audioOnly = fakeTab();
    await openTab(settingsFixture({ video: false }).settings, live(), () => audioOnly);
    expect(audioOnly.begun[0]?.video).toBe(false);
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

  it("names Chrome's reason and the icon when the extension was never invoked on the tab", async () => {
    const reason = 'Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.';
    const tab = fakeTab({ begins: false, failure: new Error(reason) });
    await expect(openTab(settingsFixture().settings, live(), () => tab)).rejects.toThrow(
      `The meeting tab could not be captured (${reason}). Click the Sokuji icon in the browser toolbar on the meeting tab, then start again.`,
    );
  });

  it('names the reason without the icon when the failure is not the missing permission', async () => {
    const tab = fakeTab({ begins: false, failure: new Error('The audio worklet did not load') });
    await expect(openTab(settingsFixture().settings, live(), () => tab)).rejects.toThrow(
      'The meeting tab could not be captured (The audio worklet did not load). Reload the tab and try again.',
    );
  });

  it('keeps the plain words when the recorder kept no reason', async () => {
    const tab = fakeTab({ begins: false });
    await expect(openTab(settingsFixture().settings, live(), () => tab)).rejects.toThrow(
      'The meeting tab could not be captured. Reload the tab and try again.',
    );
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
