// electron/transcript-save.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { saveTranscript, setupTranscriptSaveHandler } = nodeRequire('./transcript-save.js');

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sokuji-transcript-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const NOW = new Date(2026, 8, 18, 15, 30, 5);
const NAME = 'sokuji-conversation-20260918-153005';

describe('saveTranscript', () => {
  it('writes the text under a name it generates from the time', async () => {
    const res = await saveTranscript({ dir, content: 'hello\n', now: NOW });
    expect(res).toEqual({ ok: true, path: join(dir, `${NAME}.txt`), dir });
    expect(readFileSync(res.path, 'utf8')).toBe('hello\n');
  });

  it('never overwrites: a clash gets " (1)", then " (2)"', async () => {
    writeFileSync(join(dir, `${NAME}.txt`), 'older');
    const first = await saveTranscript({ dir, content: 'a', now: NOW });
    const second = await saveTranscript({ dir, content: 'b', now: NOW });
    expect(first.path).toBe(join(dir, `${NAME} (1).txt`));
    expect(second.path).toBe(join(dir, `${NAME} (2).txt`));
    expect(readFileSync(join(dir, `${NAME}.txt`), 'utf8')).toBe('older');
  });

  it('rejects content that is not a string and writes nothing', async () => {
    const res = await saveTranscript({ dir, content: { evil: true }, now: NOW });
    expect(res.ok).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports a directory it cannot write to', async () => {
    const res = await saveTranscript({ dir: join(dir, 'missing'), content: 'x', now: NOW });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ENOENT|no such file/i);
  });
});

describe('the transcript:save handler', () => {
  const MAIN = { id: 1 };
  const POPOVER = { id: 2 };

  /** Registers the handler against a fake ipcMain; returns the channel's function. */
  function register() {
    const handlers = new Map();
    setupTranscriptSaveHandler({
      ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
      getDownloadsDir: () => dir,
      isTrustedSender: (sender) => sender === MAIN,
    });
    return handlers.get('transcript:save');
  }

  it('ignores any name or path the renderer sends and writes into the downloads dir', async () => {
    const res = await register()({ sender: MAIN }, {
      content: 'x',
      filename: '../../evil.txt',
      path: '/etc/passwd',
    });

    expect(res.ok).toBe(true);
    expect(res.dir).toBe(dir);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(readdirSync(dir)[0]).toMatch(/^sokuji-conversation-\d{8}-\d{6}\.txt$/);
  });

  it("refuses anything but the main window's page (a popover child window) and writes nothing", async () => {
    const res = await register()({ sender: POPOVER }, { content: 'x' });

    expect(res).toEqual({ ok: false, error: 'Transcript save refused: not the main window' });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('main.js wiring of transcript:save', () => {
  it('trusts only the current main window, read at call time', () => {
    // A getter, not a captured webContents: the handler is registered before
    // the window exists, and the window can be recreated.
    const main = readFileSync(join(__dirname, 'main.js'), 'utf8');
    const start = main.indexOf('setupTranscriptSaveHandler({');
    expect(start).toBeGreaterThan(-1);
    const call = main.slice(start, main.indexOf('});', start));
    expect(call).toContain('isTrustedSender: (sender) => sender === mainWindow?.webContents');
  });
});
