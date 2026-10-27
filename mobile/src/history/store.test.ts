import { describe, it, expect } from 'vitest';
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
