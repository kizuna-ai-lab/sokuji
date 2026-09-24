import { describe, it, expect, vi } from 'vitest';
import { sendToTabs, targetTabIdFromSearch, toPcmDataMessage, type TabsApi } from './tabMicrophone';

describe('toPcmDataMessage', () => {
  it("turns a chunk into the page microphone's PCM_DATA message, as 16-bit samples", () => {
    expect(toPcmDataMessage(Float32Array.of(0.5, -0.5, 1, -2), 42)).toEqual({
      type: 'PCM_DATA',
      pcmData: [16384, -16384, 32767, -32768],
      chunkIndex: 0,
      totalChunks: 1,
      sampleRate: 24000,
      trackId: 'default',
      timestamp: 42,
    });
  });

  it('skips a near-silent chunk, and an empty one', () => {
    expect(toPcmDataMessage(new Float32Array(2400).fill(0.002), 0)).toBeNull();
    expect(toPcmDataMessage(new Float32Array(0), 0)).toBeNull();
  });
});

function fakeTabs(tabs: Array<{ id?: number; url?: string }>, missing: number[] = []) {
  const sent: Array<[number, unknown]> = [];
  let lastError: unknown;
  // Like Chrome, `lastError` describes only the call whose callback is running.
  const api: TabsApi = {
    get(tabId, callback) {
      lastError = missing.includes(tabId) ? { message: 'No tab with id' } : undefined;
      callback(missing.includes(tabId) ? undefined : tabs.find((t) => t.id === tabId));
    },
    query(_info, callback) {
      lastError = undefined;
      callback(tabs);
    },
    sendMessage(tabId, message, callback) {
      lastError = undefined;
      sent.push([tabId, message]);
      callback();
    },
    lastError: () => lastError,
  };
  return { api, sent };
}

describe('sendToTabs', () => {
  const tabs = [
    { id: 1, url: 'https://meet.google.com/abc' },
    { id: 2, url: 'chrome://extensions' },
    { id: 3, url: 'chrome-extension://x/fullpage.html' },
    { id: 4, url: 'https://zoom.us/j/1' },
    { id: 5 },
  ];

  it('sends to the target tab only', () => {
    const { api, sent } = fakeTabs(tabs);
    sendToTabs(api, 4, 'm');
    expect(sent).toEqual([[4, 'm']]);
  });

  it('sends to every web tab when there is no target, or the target is gone', () => {
    const none = fakeTabs(tabs);
    sendToTabs(none.api, null, 'm');
    expect(none.sent).toEqual([[1, 'm'], [4, 'm']]);
    const gone = fakeTabs(tabs, [9]);
    sendToTabs(gone.api, 9, 'm');
    expect(gone.sent).toEqual([[1, 'm'], [4, 'm']]);
  });

  it('reads lastError inside every send callback, so Chrome never logs it as unchecked', () => {
    const { api } = fakeTabs([{ id: 1, url: 'https://a.example' }]);
    const lastError = vi.spyOn(api, 'lastError');
    sendToTabs(api, null, 'm');
    // Once in the query callback, once in the send callback.
    expect(lastError).toHaveBeenCalledTimes(2);
  });
});

describe('targetTabIdFromSearch', () => {
  it("reads the side panel's ?tabId=", () => {
    expect(targetTabIdFromSearch('?tabId=17')).toBe(17);
    expect(targetTabIdFromSearch('?preview=spine')).toBeNull();
    expect(targetTabIdFromSearch('?tabId=abc')).toBeNull();
  });
});
