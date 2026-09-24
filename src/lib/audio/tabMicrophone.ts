/**
 * The extension's virtual microphone. The virtual bus's tap hands over 100 ms
 * chunks; each one becomes one `PCM_DATA` message in the format the page-side
 * microphone (`extension/content/virtual-microphone.js`) reads, sent to the
 * meeting tab the side panel was opened for, or to every web tab — the wire
 * format and routing of `ModernBrowserAudioService.sendPcmDataToTabs`. Today's
 * tabs path sends every chunk; this skips only chunks that are silent at 16
 * bits, which is what the bus carries when idle.
 */
import { SAMPLE_RATE } from '../contract/adapter';

export interface PcmDataMessage {
  type: 'PCM_DATA';
  pcmData: number[];
  chunkIndex: 0;
  totalChunks: 1;
  sampleRate: number;
  trackId: 'default';
  timestamp: number;
}

export function toPcmDataMessage(chunk: Float32Array, timestamp: number): PcmDataMessage | null {
  if (chunk.length === 0) return null;
  const pcmData = new Array<number>(chunk.length);
  let silent = true;
  for (let i = 0; i < chunk.length; i++) {
    const s = Math.max(-1, Math.min(1, chunk[i]));
    const sample = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    pcmData[i] = sample;
    if (sample !== 0) silent = false;
  }
  if (silent) return null;
  return { type: 'PCM_DATA', pcmData, chunkIndex: 0, totalChunks: 1, sampleRate: SAMPLE_RATE, trackId: 'default', timestamp };
}

export interface Tab {
  id?: number;
  url?: string;
}

/** The part of `chrome.tabs` this uses (the repo's own `chrome` typing lacks `get` and `sendMessage`), and `chrome.runtime.lastError`. */
export interface TabsApi {
  get(tabId: number, callback: (tab?: Tab) => void): void;
  query(info: Record<string, never>, callback: (tabs: Tab[]) => void): void;
  sendMessage(tabId: number, message: unknown, callback: () => void): void;
  /** Read inside a callback; reading it is what keeps Chrome from logging it as unchecked. */
  lastError(): unknown;
}

/** The side panel's `?tabId=` names the meeting tab it was opened for. */
export function targetTabIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('tabId');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Sends one message to the target tab or, when there is none or it is gone,
 * to every web tab. Send errors are ignored: not every tab has the content
 * script, and this runs ten times a second.
 */
export function sendToTabs(tabs: TabsApi, targetTabId: number | null, message: unknown): void {
  const checked = () => { void tabs.lastError(); };
  const toAll = () => tabs.query({}, (all) => {
    if (tabs.lastError() || !all) return;
    for (const tab of all) {
      // Chrome's own pages and extension pages never carry the content script.
      if (tab.id === undefined || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
      tabs.sendMessage(tab.id, message, checked);
    }
  });
  if (targetTabId === null) {
    toAll();
    return;
  }
  tabs.get(targetTabId, (tab) => {
    if (tabs.lastError() || !tab) {
      toAll();
      return;
    }
    tabs.sendMessage(targetTabId, message, checked);
  });
}
