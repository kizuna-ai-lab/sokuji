import { describe, it, expect, vi } from 'vitest';
import { createHistoryStore, type StoredSession } from './store';
import { createTranscript } from '../session/transcript';

// A fake of the document directory: one folder per session, a JSON inside.
function memoryFs() {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, body: string) => { files.set(path, body); },
    removeDir: async (path: string) => { for (const k of [...files.keys()]) if (k.startsWith(`${path}/`)) files.delete(k); },
    listDirs: async (path: string) => [...new Set([...files.keys()].filter((k) => k.startsWith(`${path}/`)).map((k) => k.slice(path.length + 1).split('/')[0]))],
  };
}

function session(id: string, startedAt: number): StoredSession {
  const t = createTranscript({ source: 'en', target: 'zh', sessionId: id });
  t.message([{ text: 'Hello.', is_final: true, translation_status: 'original', language: 'en' }, { text: '<end>', is_final: true, translation_status: 'original' }]);
  return { id, startedAt, endedAt: startedAt + 60000, source: 'en', target: 'zh', leg: t.leg(), lastStatus: 'stopped' };
}

describe('history store', () => {
  it('round-trips a session and lists newest first', async () => {
    const store = createHistoryStore(memoryFs());
    await store.save(session('a', 1000));
    await store.save(session('b', 2000));
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
    const loaded = await store.load('a');
    expect(loaded?.leg.segments.map((s) => s.text)).toEqual(['Hello.']);
    expect(loaded?.lastStatus).toBe('stopped');
  });

  it('renames a session for both the list and the load', async () => {
    const store = createHistoryStore(memoryFs());
    await store.save(session('a', 1000));
    await store.rename('a', 'Lecture 3');
    expect((await store.list())[0].title).toBe('Lecture 3');
    expect((await store.load('a'))?.title).toBe('Lecture 3');
  });

  it('deletes a session', async () => {
    const fs = memoryFs();
    const store = createHistoryStore(fs);
    await store.save(session('a', 1000));
    await store.delete('a');
    expect(await store.list()).toEqual([]);
    expect(fs.files.size).toBe(0);
  });
});

describe('history store under a bad file system', () => {
  const broken = () => {
    const fs = memoryFs();
    return { fs, store: createHistoryStore(fs) };
  };

  it('skips a session whose file cannot be read, and keeps the rest', async () => {
    const { fs, store } = broken();
    await store.save(session('s1', 1000));
    await store.save(session('s2', 2000));
    const read = fs.read;
    fs.read = async (path: string) => { if (path.includes('/s1/')) throw new Error('EIO'); return read(path); };
    expect((await store.list()).map((s) => s.id)).toEqual(['s2']);
  });

  it('skips a session whose JSON has no leg', async () => {
    const { fs, store } = broken();
    await store.save(session('s1', 1000));
    fs.files.set('sessions/s2/session.json', JSON.stringify({ id: 's2', startedAt: 2000 }));
    expect((await store.list()).map((s) => s.id)).toEqual(['s1']);
  });

  it('does not throw out of save when the write fails', async () => {
    const { fs, store } = broken();
    fs.write = async () => { throw new Error('ENOSPC'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(store.save(session('s1', 1000))).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
