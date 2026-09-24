import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Leg, Segment } from '../conversation/types';

const state = { autoSaveOnStop: true };
vi.mock('../../stores/settingsStore', () => ({ default: { getState: () => state } }));
vi.mock('../../locales', () => ({
  default: {
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      let s = opts?.defaultValue ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  },
}));
let electron = false;
vi.mock('../../utils/environment', () => ({ isElectron: () => electron }));
const reportError = vi.fn();
vi.mock('../diagnostics/report', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
  describeCause: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
const downloadFile = vi.fn();
vi.mock('../../utils/conversationExport', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));

import { autoSaveConversation } from './appAutoSave';

const seg = (over: Partial<Segment>): Segment => ({ id: 'x', ref: 1, side: 'source', text: '', final: true, openedAt: 1_700_000_000_000, marks: [], speech: [], ...over });
const legs: Leg[] = [{
  leg: 'speaker', session: 'r', languages: { source: 'ja', target: 'zh' }, notices: [],
  segments: [
    seg({ id: 'r:speaker:1', text: '今日は天気がいいですね。公園に行きましょう。', origin: 'c1' }),
    seg({ id: 'r:speaker:2', side: 'translation', text: '今天天气很好。我们去公园吧。', origin: 'c1' }),
  ],
}];
const participantLeg: Leg = {
  leg: 'participant', session: 'r', languages: { source: 'zh', target: 'ja' }, notices: [],
  segments: [
    seg({ id: 'r:participant:1', text: '你好。', origin: 'p1', openedAt: 1_700_000_010_000 }),
    seg({ id: 'r:participant:2', side: 'translation', text: 'こんにちは。', origin: 'p1', openedAt: 1_700_000_010_400 }),
  ],
};
const info = { provider: 'fake', models: { asrModel: 'fake' } };
const invoke = vi.fn();
const showToast = vi.fn();

beforeEach(() => {
  state.autoSaveOnStop = true;
  electron = false;
  invoke.mockReset();
  showToast.mockReset();
  reportError.mockReset();
  downloadFile.mockReset();
  (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
});

describe('autoSaveConversation', () => {
  it('saves the whole conversation, header first, one block per exchange', async () => {
    expect(await autoSaveConversation(legs, info, { showToast })).toBe('saved');
    const [content, filename, mime] = downloadFile.mock.calls[0];
    expect(content).toMatch(/^Sokuji conversation export\nGenerated: /);
    expect(content).toContain('Provider: fake\nModels: asr=fake\n');
    expect(content).toMatch(/\[\d{2}:\d{2}:\d{2}\] Me\n  今日は天気がいいですね。公園に行きましょう。\n  → 今天天气很好。我们去公园吧。\n/);
    expect(filename).toMatch(/^sokuji-conversation-\d{8}-\d{6}\.txt$/);
    expect(mime).toBe('text/plain;charset=utf-8');
  });

  it('auto-saves both legs, Me then Other, in time order', async () => {
    expect(await autoSaveConversation([legs[0], participantLeg], info, { showToast })).toBe('saved');
    const [content] = downloadFile.mock.calls[0];
    const meIndex = content.indexOf('] Me');
    const otherIndex = content.indexOf('] Other');
    expect(meIndex).toBeGreaterThan(-1);
    expect(otherIndex).toBeGreaterThan(-1);
    expect(meIndex).toBeLessThan(otherIndex);
  });

  it('does nothing while the switch is off, or when nothing was said', async () => {
    state.autoSaveOnStop = false;
    expect(await autoSaveConversation(legs, info, { showToast })).toBe('disabled');
    state.autoSaveOnStop = true;
    expect(await autoSaveConversation([{ ...legs[0], segments: [] }], info, { showToast })).toBe('empty');
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("desktop: hands the text to the main process and offers the folder, as today's auto-save does", async () => {
    electron = true;
    invoke.mockResolvedValueOnce({ ok: true, path: '/home/u/Downloads/sokuji-conversation-20260924-100100.txt', dir: '/home/u/Downloads' });
    expect(await autoSaveConversation(legs, info, { showToast })).toBe('saved');
    expect(invoke).toHaveBeenCalledWith('transcript:save', { content: expect.stringContaining('今天天气很好。我们去公园吧。') });
    expect(showToast.mock.calls[0][0]).toBe('Conversation saved: sokuji-conversation-20260924-100100.txt');
  });

  it('reports a failed save and tells the user how to save by hand', async () => {
    electron = true;
    invoke.mockResolvedValueOnce({ ok: false, error: 'disk full' });
    expect(await autoSaveConversation(legs, info, { showToast })).toBe('failed');
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toMatchObject({ variant: 'error' });
  });
});
