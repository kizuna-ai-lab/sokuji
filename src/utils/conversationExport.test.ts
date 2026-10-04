import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadFile, exportFilename } from './conversationExport';

describe('exportFilename', () => {
  it('stamps local time and the extension', () => {
    const ts = new Date(2026, 8, 18, 9, 5, 7).getTime();
    expect(exportFilename('txt', ts)).toBe('sokuji-conversation-20260918-090507.txt');
    expect(exportFilename('json', ts)).toBe('sokuji-conversation-20260918-090507.json');
  });
});

describe('downloadFile', () => {
  afterEach(() => vi.useRealTimers());

  // Safari (the LAN viewer runs on iPhones) starts the download after the
  // click returns; a URL revoked in the same task leaves it nothing to fetch.
  it('keeps the blob URL alive past the click and revokes it later', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadFile('text', 'a.txt', 'text/plain');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:demo');
    create.mockRestore();
    revoke.mockRestore();
    click.mockRestore();
  });
});
