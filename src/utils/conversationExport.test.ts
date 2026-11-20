import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyRichToClipboard, downloadFile, exportFilename } from './conversationExport';

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

// Design P1 §3: the notes copied in two forms at once; the app pasted into takes the one it reads.
describe('copyRichToClipboard', () => {
  afterEach(() => vi.unstubAllGlobals());
  class Item { constructor(readonly data: Record<string, Blob>) {} }

  it('puts HTML and plain text on the clipboard as one item', async () => {
    const write = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('ClipboardItem', Item);
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    expect(await copyRichToClipboard({ html: '<h1>T</h1>', text: '# T' })).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const [items] = write.mock.calls[0] as unknown as [Item[]];
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0].data).sort()).toEqual(['text/html', 'text/plain']);
    expect(items[0].data['text/html'].type).toBe('text/html');
    expect(items[0].data['text/html'].size).toBe('<h1>T</h1>'.length);
    expect(items[0].data['text/plain'].size).toBe('# T'.length);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the plain text when the host has no rich clipboard', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('ClipboardItem', undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyRichToClipboard({ html: '<h1>T</h1>', text: '# T' })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('# T');
  });

  it('copies the plain text when writing both is refused', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('ClipboardItem', Item);
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => { throw new Error('NotAllowedError'); }), writeText } });
    expect(await copyRichToClipboard({ html: '<h1>T</h1>', text: '# T' })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('# T');
  });
});
