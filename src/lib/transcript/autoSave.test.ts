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
  note.mockReset();
  reportError.mockReset();
  downloadFile.mockReset();
});

// Only the browser extension saves a conversation at the end of a session: on the desktop History keeps every one.
describe('saveTranscriptText', () => {
  it('downloads the file and leaves the confirmation to the browser', async () => {
    expect(await saveTranscriptText(CONTENT, FILENAME, notify)).toBe('saved');
    expect(downloadFile).toHaveBeenCalledWith(CONTENT, FILENAME, 'text/plain;charset=utf-8');
    expect(note).not.toHaveBeenCalled();
  });

  it('reports and tells the user how to save by hand when the download cannot start', async () => {
    downloadFile.mockImplementationOnce(() => { throw new Error('Blocked'); });

    await expect(saveTranscriptText(CONTENT, FILENAME, notify)).resolves.toBe('failed');

    expect(reportError).toHaveBeenCalledWith(
      'AutoSave',
      'Failed to auto-save the conversation: Blocked',
      expect.objectContaining({ cause: expect.any(Error) }),
    );
    const [input] = note.mock.calls[0];
    expect(input).toMatchObject({ severity: 'warning', code: 'autosave_failed', params: { action: 'Download as .txt' } });
    expect(input.action).toBeUndefined();
  });

  it('never asks the main process to write anything', async () => {
    const invoke = vi.fn();
    (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
    await saveTranscriptText(CONTENT, FILENAME, notify);
    expect(invoke).not.toHaveBeenCalled();
    delete (window as unknown as { electron?: unknown }).electron;
  });
});
