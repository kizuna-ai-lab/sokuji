import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../../utils/conversationExport', () => ({
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));

import { saveTranscriptText } from './autoSave';

const invoke = vi.fn();
const note = vi.fn();
const notify = { note };

const CONTENT = [
  'Sokuji conversation export',
  'Generated: 2026-09-18 15:30:00',
  '',
  '[15:30:01] Me:    MY-ORIGINAL',
  '[15:30:02] Other: THEIR-TRANSLATION',
].join('\n') + '\n';
const FILENAME = 'sokuji-conversation-20260918-153000.txt';

beforeEach(() => {
  electron = true;
  invoke.mockReset();
  note.mockReset();
  reportError.mockReset();
  downloadFile.mockReset();
  (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
});

describe('saveTranscriptText', () => {
  it('desktop: hands main the text and filename only, then offers the folder', async () => {
    invoke.mockResolvedValueOnce({ ok: true, path: '/home/u/Downloads/sokuji-conversation-20260918-153000.txt', dir: '/home/u/Downloads' });

    expect(await saveTranscriptText(CONTENT, FILENAME, notify)).toBe('saved');

    expect(invoke).toHaveBeenCalledTimes(1);
    const [channel, payload] = invoke.mock.calls[0];
    expect(channel).toBe('transcript:save');
    expect(payload).toEqual({ content: CONTENT });

    const [input] = note.mock.calls[0];
    expect(input).toMatchObject({
      severity: 'info',
      code: 'autosave_saved',
      params: { filename: 'sokuji-conversation-20260918-153000.txt' },
      action: { kind: 'show-in-folder', dir: '/home/u/Downloads' },
    });
    expect(input.lifetime).toBeUndefined();
  });

  it('browser: downloads the file and leaves the confirmation to the browser', async () => {
    electron = false;
    expect(await saveTranscriptText(CONTENT, FILENAME, notify)).toBe('saved');
    expect(downloadFile).toHaveBeenCalledWith(CONTENT, FILENAME, 'text/plain;charset=utf-8');
    expect(note).not.toHaveBeenCalled();
  });

  it('reports and tells the user when main could not write the file', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'EACCES: permission denied' });

    expect(await saveTranscriptText(CONTENT, FILENAME, notify)).toBe('failed');

    expect(reportError).toHaveBeenCalledWith(
      'AutoSave',
      'Failed to auto-save the conversation: EACCES: permission denied',
      expect.objectContaining({ cause: expect.any(Error) }),
    );
    const [input] = note.mock.calls[0];
    expect(input).toMatchObject({ severity: 'warning', code: 'autosave_failed', params: { action: 'Download as .txt' } });
    expect(input.action).toBeUndefined();
  });

  it('resolves, never rejects, when the IPC itself throws', async () => {
    invoke.mockRejectedValueOnce(new Error('No handler registered'));
    await expect(saveTranscriptText(CONTENT, FILENAME, notify)).resolves.toBe('failed');
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
