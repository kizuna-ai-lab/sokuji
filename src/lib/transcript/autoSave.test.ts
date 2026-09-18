import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExportItem } from '../../utils/conversationExport';

const state = {
  autoSaveOnStop: true,
  provider: 'openai',
  localInference: {},
  getCurrentProviderSettings: (): Record<string, unknown> => ({ sourceLanguage: 'EN', targetLanguage: 'JA' }),
};
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

let electron = true;
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

import { autoSaveTranscript } from './autoSave';

const invoke = vi.fn();
const showToast = vi.fn();
const notify = { showToast };

const row = (id: string, source: 'speaker' | 'participant', role: 'user' | 'assistant', text: string): ExportItem => ({
  id, source, role, type: 'message', status: 'completed', createdAt: 1_700_000_000_000, formatted: { text },
} as ExportItem);

const CONVERSATION = [
  row('1', 'speaker', 'user', 'MY-ORIGINAL'),
  row('2', 'speaker', 'assistant', 'MY-TRANSLATION'),
  row('3', 'participant', 'user', 'THEIR-ORIGINAL'),
  row('4', 'participant', 'assistant', 'THEIR-TRANSLATION'),
];

beforeEach(() => {
  state.autoSaveOnStop = true;
  state.getCurrentProviderSettings = () => ({ sourceLanguage: 'EN', targetLanguage: 'JA' });
  electron = true;
  invoke.mockReset();
  showToast.mockReset();
  reportError.mockReset();
  downloadFile.mockReset();
  (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
});

describe('autoSaveTranscript', () => {
  it('does nothing while the toggle is off', async () => {
    state.autoSaveOnStop = false;
    expect(await autoSaveTranscript(CONVERSATION, notify)).toBe('disabled');
    expect(invoke).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does nothing when nothing was said', async () => {
    const unfinished = { ...row('9', 'speaker', 'user', 'x'), status: 'in_progress' } as ExportItem;
    expect(await autoSaveTranscript([unfinished], notify)).toBe('empty');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('desktop: hands main the full conversation text only, then offers the folder', async () => {
    invoke.mockResolvedValueOnce({ ok: true, path: '/home/u/Downloads/sokuji-conversation-20260918-153000.txt', dir: '/home/u/Downloads' });

    expect(await autoSaveTranscript(CONVERSATION, notify)).toBe('saved');

    expect(invoke).toHaveBeenCalledTimes(1);
    const [channel, payload] = invoke.mock.calls[0];
    expect(channel).toBe('transcript:save');
    expect(Object.keys(payload)).toEqual(['content']);
    for (const text of ['MY-ORIGINAL', 'MY-TRANSLATION', 'THEIR-ORIGINAL', 'THEIR-TRANSLATION']) {
      expect(payload.content).toContain(text);
    }
    expect(payload.content).not.toContain('some lines were left out');

    const [text, opts] = showToast.mock.calls[0];
    expect(text).toBe('Conversation saved: sokuji-conversation-20260918-153000.txt');
    expect(opts).toMatchObject({ variant: 'success', durationMs: 6000 });
    opts.action.onClick();
    expect(invoke).toHaveBeenLastCalledWith('open-directory', '/home/u/Downloads');
  });

  it('browser: downloads the file and leaves the confirmation to the browser', async () => {
    electron = false;
    expect(await autoSaveTranscript(CONVERSATION, notify)).toBe('saved');
    const [content, filename, mime] = downloadFile.mock.calls[0];
    expect(content).toContain('THEIR-TRANSLATION');
    expect(filename).toMatch(/^sokuji-conversation-\d{8}-\d{6}\.txt$/);
    expect(mime).toBe('text/plain;charset=utf-8');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('reports and tells the user when main could not write the file', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'EACCES: permission denied' });

    expect(await autoSaveTranscript(CONVERSATION, notify)).toBe('failed');

    expect(reportError).toHaveBeenCalledWith(
      'AutoSave',
      'Failed to auto-save the conversation: EACCES: permission denied',
      expect.objectContaining({ cause: expect.any(Error) }),
    );
    const [text, opts] = showToast.mock.calls[0];
    expect(text).toContain('Download as .txt');
    expect(opts).toMatchObject({ variant: 'error' });
  });

  it('resolves, never rejects, when the IPC itself throws', async () => {
    invoke.mockRejectedValueOnce(new Error('No handler registered'));
    await expect(autoSaveTranscript(CONVERSATION, notify)).resolves.toBe('failed');
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('resolves when building the file throws', async () => {
    state.getCurrentProviderSettings = () => { throw new Error('store not loaded'); };
    await expect(autoSaveTranscript(CONVERSATION, notify)).resolves.toBe('failed');
    expect(invoke).not.toHaveBeenCalled();
  });
});
