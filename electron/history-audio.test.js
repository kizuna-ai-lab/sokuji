// electron/history-audio.test.js
//
// Recordings reach the player through the sokuji-history: scheme, which answers byte ranges.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { openHistory } = nodeRequire('./history-store.js');
const { HISTORY_SCHEME, registerHistoryScheme, trackResponse, saveTrackAs } = nodeRequire('./history-audio.js');

const ID = 'run-0001-aaaa';
let dir;
let s;
const url = (id = ID, source = 'speaker') => `${HISTORY_SCHEME}://track/${id}/${source}`;
const get = (u, range) => trackResponse(s, new Request(u, range ? { headers: { Range: range } } : {}));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sokuji-history-audio-'));
  s = openHistory({ dir });
  s.openRecord({ id: ID, startedAt: 1_800_000_000_000, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'fake', models: {} }, appVersion: '1' });
  const data = new Uint8Array(10_000);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  s.appendTrack({ recordId: ID, source: 'speaker', offsetMs: 0, durationMs: 1000, data });
});
afterEach(() => {
  s.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the recordings scheme', () => {
  it('is registered as a privileged, streaming scheme', () => {
    const calls = [];
    registerHistoryScheme({ registerSchemesAsPrivileged: (list) => calls.push(list) });
    expect(HISTORY_SCHEME).toBe('sokuji-history');
    expect(calls).toEqual([[{ scheme: 'sokuji-history', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]]);
  });

  it('answers the whole file with its length', async () => {
    const r = await get(url());
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Length')).toBe('10000');
    expect(r.headers.get('Accept-Ranges')).toBe('bytes');
    expect(r.headers.get('Content-Type')).toBe('audio/ogg');
    expect((await r.arrayBuffer()).byteLength).toBe(10_000);
  });

  it('lets no page read a recording: the player does not need it, and saving copies in the main process', async () => {
    for (const origin of ['null', 'file://', 'http://localhost:5173', 'https://example.com']) {
      const r = await trackResponse(s, new Request(url(), { headers: { Origin: origin } }));
      expect(r.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
    }
  });

  it('answers a byte range', async () => {
    const r = await get(url(), 'bytes=100-199');
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 100-199/10000');
    const body = new Uint8Array(await r.arrayBuffer());
    expect(body.length).toBe(100);
    expect(body[0]).toBe(100 % 251);
  });

  it('answers an open-ended range to the end of the file', async () => {
    const r = await get(url(), 'bytes=9990-');
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 9990-9999/10000');
    expect((await r.arrayBuffer()).byteLength).toBe(10);
  });

  it('refuses a range past the end', async () => {
    const r = await get(url(), 'bytes=20000-');
    expect(r.status).toBe(416);
    expect(r.headers.get('Content-Range')).toBe('bytes */10000');
  });

  it('finds nothing for a dropped track, an unknown source or record, or a bad address', async () => {
    expect((await get(url(ID, 'participant'))).status).toBe(404);
    expect((await get(url('run-0009-zzzz'))).status).toBe(404);
    expect((await get(`${HISTORY_SCHEME}://track/../../etc/passwd`)).status).toBe(404);
    expect((await get(`${HISTORY_SCHEME}://other/${ID}/speaker`)).status).toBe(404);
    s.dropTrack({ recordId: ID, source: 'speaker' });
    expect((await get(url())).status).toBe(404);
  });
});

describe('saving a recording', () => {
  const save = (over = {}) => {
    const asked = [];
    const answer = over.answer ?? { canceled: false, filePath: join(dir, 'out', 'chosen.opus') };
    const result = saveTrackAs({
      store: s,
      showSaveDialog: async (options) => { asked.push(options); return answer; },
      defaultDir: '/home/me/Downloads',
      recordId: ID,
      source: 'speaker',
      title: 'Save your side’s recording',
      defaultName: 'sokuji-recording-20270115-080000-me.opus',
      ...over,
    });
    return { asked, result };
  };
  beforeEach(() => mkdirSync(join(dir, 'out')));

  it('asks where with the system dialog and copies the file there', async () => {
    const { asked, result } = save();
    await expect(result).resolves.toEqual({ saved: true });
    expect(asked).toEqual([{
      title: 'Save your side’s recording',
      defaultPath: join('/home/me/Downloads', 'sokuji-recording-20270115-080000-me.opus'),
      filters: [{ name: 'Opus', extensions: ['opus'] }],
    }]);
    expect(readFileSync(join(dir, 'out', 'chosen.opus'))).toEqual(readFileSync(s.trackFile({ recordId: ID, source: 'speaker' })));
  });

  it('writes nothing when the user cancels', async () => {
    const { result } = save({ answer: { canceled: true, filePath: '' } });
    await expect(result).resolves.toEqual({ saved: false });
    expect(existsSync(join(dir, 'out', 'chosen.opus'))).toBe(false);
  });

  it('proposes only a file name, never a folder of the page\'s choosing', async () => {
    const { asked, result } = save({ defaultName: '../../secrets/x' });
    await result;
    expect(asked[0].defaultPath).toBe(join('/home/me/Downloads', 'x.opus'));
  });

  it('refuses a track that is not kept, without asking', async () => {
    const { asked, result } = save({ source: 'participant' });
    await expect(result).rejects.toMatchObject({ code: 'NO_TRACK' });
    expect(asked).toEqual([]);
  });
});
